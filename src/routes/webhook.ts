import { Context } from 'hono';
import Stripe from 'stripe';
import { airtableFetch, airtableUpdate, airtableGetRecord } from '../lib/airtable.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function handleStripeWebhook(c: Context): Promise<Response> {
  const body = await c.req.text();
  const sig = c.req.header('stripe-signature');

  if (!sig) return c.json({ error: 'Missing stripe-signature header' }, 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook signature failed:', err.message);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const ordersData = await airtableFetch('ORDERS', {
      filterByFormula: `{stripe_session_id}='${session.id}'`,
      maxRecords: 1,
    });
    const order = ordersData.records?.[0];
    if (order) {
      await airtableUpdate('ORDERS', order.id, {
        capture_status: 'pending',
        payment_intent_id: session.payment_intent,
      });
    }
  }

  if (event.type === 'payment_intent.amount_capturable_updated') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const ordersData = await airtableFetch('ORDERS', {
      filterByFormula: `{payment_intent_id}='${pi.id}'`,
      maxRecords: 1,
    });
    const order = ordersData.records?.[0];
    if (order) {
      await airtableUpdate('ORDERS', order.id, {
        capture_status: 'captured',
        state: 'Paid',
      });
    }
  }

  if (event.type === 'payment_intent.canceled') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const ordersData = await airtableFetch('ORDERS', {
      filterByFormula: `{payment_intent_id}='${pi.id}'`,
      maxRecords: 1,
    });
    const order = ordersData.records?.[0];
    if (order) {
      await airtableUpdate('ORDERS', order.id, {
        capture_status: 'cancelled',
        state: 'Released',
      });
      const campaignIds: string[] = order.fields.campaign_id || [];
      if (campaignIds[0]) {
        const campaign = await airtableGetRecord('CAMPAIGNS', campaignIds[0]);
        if (campaign) {
          const currentSold = campaign.fields.current_units || 1;
          await airtableUpdate('CAMPAIGNS', campaign.id, {
            current_units: Math.max(0, currentSold - 1),
          });
        }
      }
    }
  }

  return c.json({ received: true });
}
