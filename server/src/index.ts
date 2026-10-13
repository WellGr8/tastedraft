import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { config } from './config.ts';

const app = createApp();

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`TasteDraft API listening on http://${info.address}:${info.port}`);
});
