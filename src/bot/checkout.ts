import { airtableGetRecord, airtableCreate, airtableUpdate } from '../lib/airtable.js';

export async function createBotCheckoutSession(params: {
  campaignId: string;
  email: string;
  name: string;
  campaignName: string;
  amount: number;
  username: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  const { campaignId, email, name, campaignName, amount, username } = params;
  const appUrl = process.env.APP_URL || 'https://pagefairy.com';

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'payment',
      ...(email ? { customer_email: email } : {}),
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': amount.toString(),
      'line_items[0][price_data][product_data][name]': campaignName,
      'line_items[0][quantity]': '1',
      'payment_intent_data[capture_method]': 'manual',
      'payment_intent_data[metadata][campaign_id]': campaignId,
      'payment_intent_data[metadata][customer_name]': name,
      'payment_intent_data[metadata][customer_email]': email,
      'metadata[campaign_id]': campaignId,
      'metadata[customer_name]': name,
      success_url: `https://t.me/PageFairyBot?start=order_success`,
      cancel_url: `${appUrl}/${username}?cancelled=1`,
    }),
  });

  const session = (await stripeRes.json()) as any;
  if (session.error) throw new Error(session.error.message);

  // Create order record
  await airtableCreate('ORDERS', {
    campaign_id: [campaignId],
    campaign_id_text: campaignId,
    customer_email: email,
    customer_name: name,
    amount_cents: amount,
    stripe_session_id: session.id,
    capture_status: 'pending',
    state: 'Pre-Auth',
    last_state_change: new Date().toISOString(),
  });

  // Update campaign sold count
  const campaign = await airtableGetRecord('CAMPAIGNS', campaignId);
  if (campaign) {
    const currentSold = campaign.fields.current_units || 0;
    await airtableUpdate('CAMPAIGNS', campaignId, { current_units: currentSold + 1 });
  }

  return { checkoutUrl: session.url, sessionId: session.id };
}
