import { Hono } from 'hono';
import type { Context } from 'hono';
import { readJsonFile } from './shared/files.js';
import { hashKey, isValidKey, matchesHash } from './shared/credentials.js';
import type { CredentialRecord, RegistryFile } from './shared/types.js';

interface ApiOptions {
  registryPath: string;
}

function unauthorized(c: Context): Response {
  return c.json({ error: 'unauthorized' }, 401);
}

async function findCredentialForKey(registryPath: string, key: string): Promise<CredentialRecord | undefined> {
  if (!isValidKey(key)) return undefined;
  const registry = await readJsonFile<RegistryFile>(registryPath);
  const keyHash = hashKey(key);
  for (const credential of Object.values(registry.credentials)) {
    const record = credential.keys.find(
      (candidate) => candidate.state !== 'revoked' && candidate.hash === keyHash && matchesHash(key, candidate.hash),
    );
    if (record) return credential;
  }
  return undefined;
}

export function createApiApp(options: ApiOptions): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/v1/orders', async (c) => {
    const authorization = c.req.header('Authorization') ?? '';
    const match = authorization.match(/^Bearer (.+)$/);
    if (!match || !match[1]) return unauthorized(c);

    try {
      const credential = await findCredentialForKey(options.registryPath, match[1]);
      if (!credential) return unauthorized(c);
    } catch {
      return c.json({ error: 'service_unavailable' }, 503);
    }

    return c.json({
      orders: [
        { id: 'order-1001', status: 'processing', total_cents: 4200 },
        { id: 'order-1002', status: 'ready', total_cents: 1850 },
      ],
    });
  });

  return app;
}
