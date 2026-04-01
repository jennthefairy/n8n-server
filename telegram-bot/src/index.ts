import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleTelegramWebhook } from './bot/index.js';
import { startScheduler } from './bot/scheduler.js';
import { handleStripeWebhook } from './routes/webhook.js';

const app = new Hono();

app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

// Health check
app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'pagefairy-telegram-bot' });
});

// Telegram bot webhook
app.post('/api/webhook/telegram', async (c) => {
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return handleTelegramWebhook(c.req.raw);
});

// Stripe webhook — raw body needed for signature verification
app.post('/api/webhook/stripe', handleStripeWebhook);

// 404 fallback
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('App error:', err);
  return c.json({ error: err.message }, 500);
});

const port = parseInt(process.env.PORT || '3000', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`PageFairy Telegram Bot running on http://localhost:${port}`);
  startScheduler();
});

export default app;
