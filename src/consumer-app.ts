import { Hono } from 'hono';
import type { ConsumerWorker } from './consumer-worker.js';

export function createConsumerApp(worker: ConsumerWorker): Hono {
  const app = new Hono();
  app.get('/status', (c) => c.json(worker.status()));
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  return app;
}
