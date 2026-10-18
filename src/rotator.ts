import { serve } from '@hono/node-server';
import { createRotatorApp } from './rotator-app.js';
import { RotatorService } from './rotator-service.js';
import { createGitLabIdTokenVerifier } from './gitlab-id-token.js';
import { safeErrorMessage } from './shared/files.js';

const port = Number(process.env.PORT ?? '3002');
const token = process.env.ROTATOR_TOKEN;
const idTokenVerifier = createGitLabIdTokenVerifier({
  projectPath: process.env.GITLAB_PROJECT_PATH,
  onJwksFetchFailure: () => console.error(JSON.stringify({ event: 'gitlab_jwks_fetch_failed' })),
});

const service = new RotatorService({
  registryPath: process.env.REGISTRY_PATH ?? '/data/registry.json',
  auditLogPath: process.env.AUDIT_LOG_PATH ?? '/data/audit.jsonl',
  consumerKeyPath: process.env.CONSUMER_KEY_PATH ?? '/secrets/orders-api.key',
  apiUrl: process.env.API_URL ?? 'http://api:3000',
  maxOverlapSeconds: Number(process.env.ROTATION_MAX_OVERLAP_SECONDS ?? '120'),
});

try {
  await service.init();
  serve({ fetch: createRotatorApp({ service, token, idTokenVerifier }).fetch, port, hostname: '0.0.0.0' });
  console.log(JSON.stringify({ event: 'rotator_started', port }));
} catch (error) {
  console.error(JSON.stringify({ event: 'rotator_start_failed', error: safeErrorMessage(error) }));
  process.exitCode = 1;
}
