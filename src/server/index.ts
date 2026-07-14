import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { menu } from './routes/menu';
import { mission } from './routes/mission';
import { puzzle } from './routes/puzzle';
import { shop } from './routes/shop';
import { triggers } from './routes/triggers';
import { chatter } from './routes/chatter';
import { schedulerRoutes } from './routes/scheduler';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/triggers', triggers);
internal.route('/scheduler', schedulerRoutes);

app.route('/api', api);
app.route('/api/mission', mission);
app.route('/api/puzzle', puzzle);
app.route('/api/shop', shop);
app.route('/api/chatter', chatter);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
