import { Hono } from 'hono';
import type { Context } from 'hono';
import { safeErrorMessage } from './shared/files.js';
import { RotatorOperationError, RotatorService } from './rotator-service.js';

interface RotatorAppOptions {
  service: RotatorService;
  token: string;
}

type JsonObject = Record<string, unknown>;

async function readBody(c: Context): Promise<JsonObject> {
  const body = await c.req.json<unknown>().catch(() => undefined);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? body as JsonObject : {};
}

function requiredString(body: JsonObject, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0) throw new RotatorOperationError(`invalid_${name}`, 400);
  return value;
}

function statusFor(error: unknown): 400 | 404 | 409 | 500 | 503 {
  return error instanceof RotatorOperationError && [400, 404, 409, 500, 503].includes(error.httpStatus)
    ? error.httpStatus as 400 | 404 | 409 | 500 | 503
    : 500;
}

export function createRotatorApp(options: RotatorAppOptions): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.post('/v1/rotator/*', async (c) => {
    const authorization = c.req.header('Authorization') ?? '';
    if (authorization !== `Bearer ${options.token}`) return c.json({ error: 'unauthorized' }, 401);

    try {
      const body = await readBody(c);
      const operation = c.req.path.split('/').at(-1);
      if (operation === 'issue_replacement') {
        const result = await options.service.issueReplacement(requiredString(body, 'credential_id'));
        return c.json({ credential_id: result.credential_id, fingerprint: result.fingerprint, state: result.state });
      }
      if (operation === 'activate_replacement') {
        const result = await options.service.activateReplacement(
          requiredString(body, 'credential_id'),
          requiredString(body, 'fingerprint'),
        );
        return c.json(result);
      }
      if (operation === 'update_consumer') {
        const result = await options.service.updateConsumer(
          requiredString(body, 'credential_id'),
          requiredString(body, 'fingerprint'),
        );
        return c.json(result);
      }
      if (operation === 'verify_new_works') {
        const result = await options.service.verifyNewWorks(requiredString(body, 'credential_id'));
        return c.json(result);
      }
      if (operation === 'revoke_old_key') {
        const result = await options.service.revokeOldKey(
          requiredString(body, 'credential_id'),
          requiredString(body, 'fingerprint'),
        );
        return c.json(result);
      }
      if (operation === 'verify_old_rejected') {
        const result = await options.service.verifyOldRejected(
          requiredString(body, 'credential_id'),
          requiredString(body, 'fingerprint'),
        );
        return c.json(result);
      }
      if (operation === 'rotate') {
        const result = await options.service.rotate(
          requiredString(body, 'credential_id'),
          requiredString(body, 'leaked_fingerprint'),
        );
        return c.json(result);
      }
      if (operation === 'status') {
        return c.json(options.service.status(requiredString(body, 'credential_id')));
      }
      return c.json({ error: 'unknown_operation' }, 404);
    } catch (error) {
      return c.json({ error: safeErrorMessage(error) }, statusFor(error));
    }
  });

  return app;
}
