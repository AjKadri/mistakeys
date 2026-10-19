import { deepStrictEqual, equal, match, notEqual, ok, rejects } from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createApiApp } from '../src/api-app.js';
import { createConsumerApp } from '../src/consumer-app.js';
import { ConsumerWorker } from '../src/consumer-worker.js';
import { createRotatorApp } from '../src/rotator-app.js';
import { RotatorOperationError, RotatorService } from '../src/rotator-service.js';
import { fingerprintForKey, isValidKey } from '../src/shared/credentials.js';
import { readJsonFile } from '../src/shared/files.js';
import type { RegistryFile, RotationResult } from '../src/shared/types.js';

interface TestContext {
  directory: string;
  registryPath: string;
  auditLogPath: string;
  consumerKeyPath: string;
  api: ReturnType<typeof createApiApp>;
  service: RotatorService;
  rotator: ReturnType<typeof createRotatorApp>;
  logs: string[];
}

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeContext(options: { maxOverlapSeconds?: number; failingOldVerification?: boolean } = {}): Promise<TestContext> {
  const directory = await mkdtemp(join(tmpdir(), 'mistakeys-test-'));
  cleanup.push(directory);
  const registryPath = join(directory, 'registry.json');
  const auditLogPath = join(directory, 'audit.jsonl');
  const consumerKeyPath = join(directory, 'orders-api.key');
  const api = createApiApp({ registryPath });
  const logs: string[] = [];
  let oldRawKey: string | undefined;
  const service = new RotatorService({
    registryPath,
    auditLogPath,
    consumerKeyPath,
    apiUrl: 'http://api',
    maxOverlapSeconds: options.maxOverlapSeconds ?? 120,
    logger: (line) => logs.push(line),
    fetchFn: async (_input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization');
      if (options.failingOldVerification && oldRawKey && authorization === `Bearer ${oldRawKey}`) {
        return new Response(JSON.stringify({ error: 'forced_test_failure' }), { status: 503 });
      }
      return api.request('/v1/orders', init);
    },
  });
  await service.init();
  oldRawKey = (await readFile(consumerKeyPath, 'utf8')).trim();
  const rotator = createRotatorApp({ service, token: 'test-rotator-token' });
  return { directory, registryPath, auditLogPath, consumerKeyPath, api, service, rotator, logs };
}

async function post(app: ReturnType<typeof createRotatorApp>, path: string, body: unknown, token = 'test-rotator-token') {
  return app.request(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function seed(ctx: TestContext): Promise<{ fingerprint: string; rawKey: string }> {
  const registry = await readJsonFile<RegistryFile>(ctx.registryPath);
  const firstKey = registry.credentials['orders-api']?.keys[0];
  if (!firstKey) throw new Error('test seed missing');
  const rawKey = (await readFile(ctx.consumerKeyPath, 'utf8')).trim();
  equal(firstKey.fingerprint, fingerprintForKey(rawKey));
  return { fingerprint: firstKey.fingerprint, rawKey };
}

describe('api authentication', () => {
  it('allows active and pending keys, rejects revoked or invalid keys, and keeps health public', async () => {
    const ctx = await makeContext();
    const initial = await seed(ctx);

    equal((await ctx.api.request('/healthz')).status, 200);
    equal((await ctx.api.request('/v1/orders')).status, 401);
    equal((await ctx.api.request('/v1/orders', { headers: { Authorization: `Bearer ${initial.rawKey}` } })).status, 200);

    const issued = await ctx.service.issueReplacement('orders-api');
    equal((await ctx.api.request('/v1/orders', { headers: { Authorization: `Bearer ${issued.rawKey}` } })).status, 200);

    await ctx.service.revokeOldKey('orders-api', initial.fingerprint);
    equal((await ctx.api.request('/v1/orders', { headers: { Authorization: `Bearer ${initial.rawKey}` } })).status, 401);
    equal((await ctx.api.request('/v1/orders', { headers: { Authorization: `Bearer ${issued.rawKey}` } })).status, 200);
  });
});

describe('rotator operations', () => {
  it('uses typed bearer-authenticated operations and never returns a raw key', async () => {
    const ctx = await makeContext();
    const initial = await seed(ctx);
    const unauthorized = await post(ctx.rotator, '/v1/rotator/status', { credential_id: 'orders-api' }, 'wrong-token');
    equal(unauthorized.status, 401);

    const issueResponse = await post(ctx.rotator, '/v1/rotator/issue_replacement', { credential_id: 'orders-api' });
    equal(issueResponse.status, 200);
    const issueBody = await json<{ credential_id: string; fingerprint: string; state: string }>(issueResponse);
    equal(issueBody.credential_id, 'orders-api');
    equal(issueBody.state, 'pending');
    match(issueBody.fingerprint, /^sha256:[0-9a-f]{12}$/);
    const serializedIssue = JSON.stringify(issueBody);
    equal(serializedIssue.includes('mk_live_'), false);

    const updateResponse = await post(ctx.rotator, '/v1/rotator/update_consumer', {
      credential_id: 'orders-api',
      fingerprint: issueBody.fingerprint,
    });
    equal(updateResponse.status, 200);
    const updatedKey = (await readFile(ctx.consumerKeyPath, 'utf8')).trim();
    equal(fingerprintForKey(updatedKey), issueBody.fingerprint);
    ok(isValidKey(updatedKey));

    const activateResponse = await post(ctx.rotator, '/v1/rotator/activate_replacement', {
      credential_id: 'orders-api',
      fingerprint: issueBody.fingerprint,
    });
    equal(activateResponse.status, 200);
    equal((await json<{ outcome: string }>(activateResponse)).outcome, 'activated');

    const statusResponse = await post(ctx.rotator, '/v1/rotator/status', { credential_id: 'orders-api' });
    const statusBody = await json<unknown>(statusResponse);
    equal(JSON.stringify(statusBody).includes('mk_live_'), false);
    notEqual(initial.fingerprint, issueBody.fingerprint);
  });

  it('runs a verified rotation, records one audit line, and is idempotent', async () => {
    const ctx = await makeContext();
    const initial = await seed(ctx);

    const firstResponse = await post(ctx.rotator, '/v1/rotator/rotate', {
      credential_id: 'orders-api',
      leaked_fingerprint: initial.fingerprint,
    });
    equal(firstResponse.status, 200);
    const first = await json<RotationResult>(firstResponse);
    equal(first.status, 'success');
    equal(first.failed_step, undefined);
    equal(first.steps.map((step) => step.step).join(','), 'issue_replacement,update_consumer,verify_new_works,activate_replacement,revoke_old_key,verify_old_rejected');
    match(first.new_fingerprint ?? '', /^sha256:[0-9a-f]{12}$/);
    equal(JSON.stringify(first).includes('mk_live_'), false);
    equal((await ctx.service.status('orders-api')).keys.find((key) => key.fingerprint === first.new_fingerprint)?.state, 'active');

    const newRawKey = (await readFile(ctx.consumerKeyPath, 'utf8')).trim();
    equal(fingerprintForKey(newRawKey), first.new_fingerprint);
    equal((await ctx.api.request('/v1/orders', { headers: { Authorization: `Bearer ${initial.rawKey}` } })).status, 401);
    equal((await ctx.api.request('/v1/orders', { headers: { Authorization: `Bearer ${newRawKey}` } })).status, 200);

    const secondResponse = await post(ctx.rotator, '/v1/rotator/rotate', {
      credential_id: 'orders-api',
      leaked_fingerprint: initial.fingerprint,
    });
    equal(secondResponse.status, 200);
    const second = await json<{ status: string; earlier_result: RotationResult }>(secondResponse);
    equal(second.status, 'already_handled');
    deepStrictEqual(second.earlier_result, first);

    const auditLines = (await readFile(ctx.auditLogPath, 'utf8')).trim().split('\n');
    equal(auditLines.length, 1);
    equal(auditLines[0]?.includes('mk_live_'), false);
    const registryText = await readFile(ctx.registryPath, 'utf8');
    equal(registryText.includes('mk_live_'), false);
    equal(ctx.logs.some((line) => line.includes('mk_live_')), false);
  });

  it('never transitions a revoked key back to pending or active', async () => {
    const ctx = await makeContext();
    const initial = await seed(ctx);
    await ctx.service.revokeOldKey('orders-api', initial.fingerprint);

    await rejects(
      ctx.service.activateReplacement('orders-api', initial.fingerprint),
      (error: unknown) => error instanceof RotatorOperationError && error.message === 'revoked_key_cannot_be_activated',
    );
    const registry = await readJsonFile<RegistryFile>(ctx.registryPath);
    equal(registry.credentials['orders-api']?.keys[0]?.state, 'revoked');
  });

  it('keeps the old key revoked and requires a human after a post-revoke failure', async () => {
    const ctx = await makeContext({ failingOldVerification: true });
    const initial = await seed(ctx);
    const result = await ctx.service.rotate('orders-api', initial.fingerprint);
    if (result.status === 'already_handled') throw new Error('unexpected idempotence result');
    equal(result.status, 'failed_needs_human');
    equal(result.failed_step, 'verify_old_rejected');
    equal(result.steps.at(-1)?.ok, false);

    const registry = await readJsonFile<RegistryFile>(ctx.registryPath);
    equal(registry.credentials['orders-api']?.keys.find((key) => key.fingerprint === initial.fingerprint)?.state, 'revoked');
    const audit = await readFile(ctx.auditLogPath, 'utf8');
    equal(JSON.parse(audit).final_status, 'failed_needs_human');
    equal(audit.includes('mk_live_'), false);
  });

  it('reports an overlap limit breach but still revokes the old key', async () => {
    const ctx = await makeContext({ maxOverlapSeconds: 0 });
    const initial = await seed(ctx);
    const result = await ctx.service.rotate('orders-api', initial.fingerprint);
    if (result.status === 'already_handled') throw new Error('unexpected idempotence result');
    equal(result.status, 'success');
    equal(result.overlap_exceeded, true);
    equal((await ctx.service.status('orders-api')).keys.find((key) => key.fingerprint === initial.fingerprint)?.state, 'revoked');
  });
});

describe('consumer', () => {
  it('re-reads the key file on every call and exposes only safe status', async () => {
    const ctx = await makeContext();
    const initial = await seed(ctx);
    const worker = new ConsumerWorker({
      apiUrl: 'http://api',
      keyPath: ctx.consumerKeyPath,
      fetchFn: (_input, init) => ctx.api.request('/v1/orders', init),
      logger: (line) => ctx.logs.push(line),
    });
    const first = await worker.callOnce();
    equal(first.last_result, 200);
    equal(first.fingerprint, initial.fingerprint);

    const rotation = await ctx.service.rotate('orders-api', initial.fingerprint);
    if (rotation.status === 'already_handled') throw new Error('unexpected idempotence result');
    const second = await worker.callOnce();
    equal(second.last_result, 200);
    equal(second.fingerprint, rotation.new_fingerprint);
    equal(JSON.stringify(worker.status()).includes('mk_live_'), false);
    const statusResponse = await createConsumerApp(worker).request('/status');
    equal(statusResponse.status, 200);
    equal((await statusResponse.text()).includes('mk_live_'), false);
  });
});
