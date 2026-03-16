import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { htmlHead } from './lib/render.js';
import { renderBioPage, render404Page } from './routes/bio.js';
import { renderCampaignPage } from './routes/campaign.js';
import { handleCheckout } from './routes/checkout.js';
import { handleStripeWebhook } from './routes/webhook.js';
import { handleWaitlist } from './routes/waitlist.js';

const app = new Hono();

app.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }));

// Homepage
app.get('/', (c) => {
  const html = `${htmlHead('PageFairy - Launch Your Beauty Brand Risk-Free', 'dark')}
<body class="bg-base-100 text-base-content min-h-screen">
  <div class="hero min-h-screen">
    <div class="hero-content text-center">
      <div>
        <h1 class="text-5xl font-bold mb-4">PageFairy</h1>
        <p class="text-base-content/60 text-xl mb-8">Launch your beauty brand risk-free</p>
        <div class="flex gap-3 justify-center flex-wrap">
          <a href="https://t.me/PageFairyBot" class="btn btn-neutral">
            Start on Telegram
          </a>
          <span class="badge badge-ghost badge-lg self-center">@PageFairyBot</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  return c.html(html);
});

// API routes
app.post('/api/checkout', handleCheckout);
app.post('/api/waitlist', handleWaitlist);

// Stripe webhook — raw body needed for signature verification
app.post('/api/webhook/stripe', handleStripeWebhook);

// Bio page
app.get('/:username', renderBioPage);

// Campaign page
app.get('/:username/:slug', renderCampaignPage);

// 404 fallback
app.notFound((c) => render404Page(c, c.req.path.replace(/^\//, '')));

// Error handler
app.onError((err, c) => {
  console.error('App error:', err);
  return c.json({ error: err.message }, 500);
});

const port = parseInt(process.env.PORT || '3000', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`PageFairy running on http://localhost:${port}`);
});

export default app;
