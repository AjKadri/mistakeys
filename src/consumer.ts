import { serve } from '@hono/node-server';
import { createConsumerApp } from './consumer-app.js';
import { ConsumerWorker } from './consumer-worker.js';

const port = Number(process.env.PORT ?? '3001');
const worker = new ConsumerWorker({
  apiUrl: process.env.API_URL ?? 'http://api:3000',
  keyPath: process.env.CONSUMER_KEY_PATH ?? '/secrets/orders-api.key',
});

serve({ fetch: createConsumerApp(worker).fetch, port, hostname: '0.0.0.0' });
worker.start(Number(process.env.CONSUMER_POLL_SECONDS ?? '3') * 1000);
console.log(JSON.stringify({ event: 'consumer_started', port }));
