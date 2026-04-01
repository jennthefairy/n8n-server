import { Context } from 'hono';
import { airtableGetRecord, airtableCreate, airtableUpdate, airtableFetch, sanitizeParam } from '../lib/airtable.js';

export async function handleCheckout(c: Context): Promise<Response> {
  const body = await c.req.json<{
    campaign_id: string;
    email: string;
    name?: string;
    amount: number;
    referrer?: string;
  }>();

  const { campaign_id, email, name, amount, referrer } = body;

  if (!campaign_id || !email || !amount) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const campaign = await airtableGetRecord('CAMPAIGNS', campaign_id);
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404);

  const productName = campaign.fields.campaign_name || 'Product';
  const linkedUserIds: string[] = campaign.fields.user_id || [];
  const userRecordId = linkedUserIds[0];

  let username = 'shop';
  if (userRecordId) {
    const user = await airtableGetRecord('USERS', userRecordId);
    if (user) username = user.fields.username || user.fields.first_name || 'shop';
  }

  const reqUrl = new URL(c.req.url);
  const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'payment',
      customer_email: email,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': amount.toString(),
      'line_items[0][price_data][product_data][name]': productName,
      'line_items[0][quantity]': '1',
      'payment_intent_data[capture_method]': 'manual',
      'payment_intent_data[metadata][campaign_id]': campaign_id,
      'payment_intent_data[metadata][customer_name]': name || '',
      'payment_intent_data[metadata][customer_email]': email,
      'metadata[campaign_id]': campaign_id,
      'metadata[customer_name]': name || '',
      success_url: `${baseUrl}/${username}?success=1`,
      cancel_url: `${baseUrl}/${username}?cancelled=1`,
    }),
  });

  const session = await stripeRes.json() as any;
  if (session.error) return c.json({ error: session.error.message }, 400);

  await airtableCreate('ORDERS', {
    campaign_id: [campaign_id],
    campaign_id_text: campaign_id,
    customer_email: email,
    customer_name: name || '',
    amount_cents: amount,
    stripe_session_id: session.id,
    capture_status: 'pending',
    state: 'Pre-Auth',
    last_state_change: new Date().toISOString(),
  });

  const currentSold = campaign.fields.current_units || 0;
  await airtableUpdate('CAMPAIGNS', campaign_id, { current_units: currentSold + 1 });

  if (referrer) {
    (async () => {
      try {
        const refUsersData = await airtableFetch('USERS', { filterByFormula: `{username}='${sanitizeParam(referrer)}'`, maxRecords: 1 });
        const refUser = refUsersData.records?.[0];
        if (refUser && refUser.id !== userRecordId) {
          await airtableCreate('REFERRALS', {
            referrer_id: [refUser.id],
            stripe_session_id: session.id,
            referred_email: email,
            status: 'pending',
            created_at: new Date().toISOString(),
          });
        }
      } catch {}
    })();
  }

  // Send order notification via Telegram bot
  import('../bot/notifications.js').then(({ sendOrderNotification }) => {
    sendOrderNotification({
      campaign_id,
      campaign_name: campaign.fields.campaign_name,
      customer_email: email,
      customer_name: name,
      amount_cents: amount,
      current_units: currentSold + 1,
      goal_units: campaign.fields.goal_units || 10,
    }).catch((err: any) => console.error('Order notification failed:', err));
  });

  return c.json({ success: true, checkout_url: session.url, session_id: session.id });
}
