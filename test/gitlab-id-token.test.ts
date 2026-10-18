import { equal } from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createRotatorApp } from '../src/rotator-app.js';
import {
  createGitLabIdTokenVerifier,
  DEFAULT_GITLAB_AUDIENCE,
  DEFAULT_GITLAB_ISSUER,
  DEFAULT_GITLAB_PROJECT_PATH,
} from '../src/gitlab-id-token.js';
import type { RotatorService } from '../src/rotator-service.js';

let jwksServer: Server | undefined;

afterEach(async () => {
  if (!jwksServer) return;
  await new Promise<void>((resolve, reject) => {
    jwksServer?.close((error) => error ? reject(error) : resolve());
  });
  jwksServer = undefined;
});

async function startJwksServer(publicJwk: Record<string, unknown>, statusCode = 200): Promise<string> {
  jwksServer = createServer((request, response) => {
    if (request.url !== '/jwks') {
      response.writeHead(404).end();
      return;
    }
    if (statusCode !== 200) {
      response.writeHead(statusCode).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve, reject) => {
    jwksServer?.once('error', reject);
    jwksServer?.listen(0, '127.0.0.1', () => resolve());
  });
  const address = jwksServer.address();
  if (!address || typeof address === 'string') throw new Error('JWKS test server did not bind to a port');
  return `http://127.0.0.1:${address.port}/jwks`;
}

async function makeToken(
  privateKey: Parameters<SignJWT['sign']>[0],
  options: { audience?: string; projectPath?: string; expirationTime?: number | string } = {},
): Promise<string> {
  return new SignJWT({ project_path: options.projectPath ?? DEFAULT_GITLAB_PROJECT_PATH })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(DEFAULT_GITLAB_ISSUER)
    .setAudience(options.audience ?? DEFAULT_GITLAB_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expirationTime ?? '5m')
    .sign(privateKey);
}

async function postStatus(app: ReturnType<typeof createRotatorApp>, token: string): Promise<Response> {
  return app.request('/v1/rotator/status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credential_id: 'orders-api' }),
  });
}

describe('GitLab ID-token rotator authentication', () => {
  it('accepts a valid token and rejects invalid claims or signatures with 401', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = 'test-key';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    const jwksUrl = await startJwksServer(publicJwk);
    const verifier = createGitLabIdTokenVerifier({ jwksUrl });
    const service = {
      status: () => ({ credential_id: 'orders-api', keys: [], rotations: [] }),
    } as unknown as RotatorService;
    const app = createRotatorApp({ service, token: 'manual-static-token', idTokenVerifier: verifier });

    const valid = await makeToken(privateKey);
    equal((await postStatus(app, valid)).status, 200);

    const wrongAudience = await makeToken(privateKey, { audience: 'https://wrong.example' });
    equal((await postStatus(app, wrongAudience)).status, 401);

    const wrongProject = await makeToken(privateKey, { projectPath: 'gitlab-ai-hackathon/other-project' });
    equal((await postStatus(app, wrongProject)).status, 401);

    const expired = await makeToken(privateKey, { expirationTime: Math.floor(Date.now() / 1000) - 60 });
    equal((await postStatus(app, expired)).status, 401);

    const otherKeyPair = await generateKeyPair('RS256');
    const badSignature = await makeToken(otherKeyPair.privateKey);
    equal((await postStatus(app, badSignature)).status, 401);
  });

  it('reports a single safe callback when the JWKS endpoint fails', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const jwksUrl = await startJwksServer({}, 503);
    let failureCount = 0;
    const verifier = createGitLabIdTokenVerifier({
      jwksUrl,
      onJwksFetchFailure: () => { failureCount += 1; },
    });
    const token = await makeToken(privateKey);

    equal(await verifier.verify(token), false);
    equal(await verifier.verify(token), false);
    equal(failureCount, 1);
  });
});
