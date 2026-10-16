import { serve } from '@hono/node-server';
import { createApiApp } from './api-app.js';

const port = Number(process.env.PORT ?? '3000');
const registryPath = process.env.REGISTRY_PATH ?? '/data/registry.json';

serve({ fetch: createApiApp({ registryPath }).fetch, port, hostname: '0.0.0.0' });
console.log(JSON.stringify({ event: 'api_started', port }));
