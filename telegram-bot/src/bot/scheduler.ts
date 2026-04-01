import { airtableFetch, airtableGetRecord, airtableUpdate, airtableCreate } from '../lib/airtable.js';
import { sendCampaignCloseNotification, sendAdminAlert } from './notifications.js';

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runCampaignAutoClose(): Promise<void> {
  console.log('[cron] Running campaign auto-close check...');
  try {
    const data = await airtableFetch('CAMPAIGNS', {
      filterByFormula: 'AND({status}="active", IS_BEFORE({end_date}, NOW()))',
    });
    const campaigns = data.records || [];

    if (campaigns.length === 0) {
      console.log('[cron] No expired campaigns found.');
      return;
    }

    for (const campaign of campaigns) {
      const campaignId = campaign.id;
      const currentUnits = campaign.fields.current_units || 0;
      const goalUnits = campaign.fields.goal_units || 10;
      const goalMet = currentUnits >= goalUnits;
      const campaignName = campaign.fields.campaign_name || campaignId;

      console.log(`[cron] Processing ${campaignName}: ${currentUnits}/${goalUnits} — goal ${goalMet ? 'met' : 'not met'}`);

      const ordersData = await airtableFetch('ORDERS', {
        filterByFormula: `AND({campaign_id_text}="${campaignId}", {capture_status}="pending")`,
      });
      const orders = ordersData.records || [];

      for (const order of orders) {
        const orderId = order.id;
        const state = order.fields.state;
        const paymentIntentId = order.fields.payment_intent_id;

        if (state !== 'Pre-Auth') {
          await airtableCreate('AUDIT_LOGS', {
            order_id: orderId,
            action: 'invalid_state_transition',
            details: `Expected Pre-Auth, got ${state}`,
            created_at: new Date().toISOString(),
          }).catch(() => {});
          continue;
        }

        if (!paymentIntentId) {
          console.log(`[cron] Order ${orderId} has no payment_intent_id, skipping`);
          continue;
        }

        try {
          if (goalMet) {
            const captureRes = await fetch(
              `https://api.stripe.com/v1/payment_intents/${paymentIntentId}/capture`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              }
            );
            const captureResult = (await captureRes.json()) as any;

            if (captureResult.error) {
              await airtableUpdate('ORDERS', orderId, {
                capture_status: 'error',
                state: 'Error',
                last_state_change: new Date().toISOString(),
              });
              await sendAdminAlert(`Capture failed for order ${orderId}: ${captureResult.error.message}`);
            } else {
              await airtableUpdate('ORDERS', orderId, {
                capture_status: 'captured',
                state: 'Charged',
                last_state_change: new Date().toISOString(),
              });
            }
          } else {
            const cancelRes = await fetch(
              `https://api.stripe.com/v1/payment_intents/${paymentIntentId}/cancel`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              }
            );
            const cancelResult = (await cancelRes.json()) as any;

            if (cancelResult.error) {
              await airtableUpdate('ORDERS', orderId, {
                capture_status: 'error',
                state: 'Error',
                last_state_change: new Date().toISOString(),
              });
              await sendAdminAlert(`Cancel failed for order ${orderId}: ${cancelResult.error.message}`);
            } else {
              await airtableUpdate('ORDERS', orderId, {
                capture_status: 'cancelled',
                state: 'Released',
                last_state_change: new Date().toISOString(),
              });
            }
          }
        } catch (err: any) {
          console.error(`[cron] Error processing order ${orderId}:`, err);
          await sendAdminAlert(`Error processing order ${orderId}: ${err.message}`).catch(() => {});
        }

        await delay(200);
      }

      const newStatus = goalMet ? 'successful' : 'failed';
      await airtableUpdate('CAMPAIGNS', campaignId, { status: newStatus });

      await sendCampaignCloseNotification(campaignId, goalMet).catch((err) => {
        console.error(`[cron] Failed to send close notification for ${campaignName}:`, err);
      });
    }

    console.log(`[cron] Auto-close complete. Processed ${campaigns.length} campaigns.`);
  } catch (err) {
    console.error('[cron] Campaign auto-close error:', err);
  }
}

export async function runStuckOrderWatchdog(): Promise<void> {
  console.log('[cron] Running stuck order watchdog...');
  try {
    const stuckData = await airtableFetch('ORDERS', {
      filterByFormula:
        'AND(NOT({state}="Delivered"), NOT({state}="Released"), NOT({state}="Refunded"), DATETIME_DIFF(NOW(), {last_state_change}, \'hours\') > 24)',
    });

    for (const order of stuckData.records || []) {
      const recentAlerts = await airtableFetch('AUDIT_LOGS', {
        filterByFormula: `AND({order_id}="${order.id}", {action}="watchdog_alert_sent", DATETIME_DIFF(NOW(), {created_at}, 'hours') < 4)`,
        maxRecords: 1,
      }).catch(() => ({ records: [] }));

      if (recentAlerts.records?.length > 0) continue;

      await sendAdminAlert(
        `Stuck order: ${order.id}\nState: ${order.fields.state}\nLast change: ${order.fields.last_state_change}`
      );

      await airtableCreate('AUDIT_LOGS', {
        order_id: order.id,
        action: 'watchdog_alert_sent',
        created_at: new Date().toISOString(),
      }).catch(() => {});

      await delay(200);
    }

    const aiPendingData = await airtableFetch('ORDERS', {
      filterByFormula:
        'AND({state}="AI_Pending", DATETIME_DIFF(NOW(), {created_at}, \'minutes\') > 90)',
    });

    for (const order of aiPendingData.records || []) {
      const minutesOld = order.fields.created_at
        ? Math.round((Date.now() - new Date(order.fields.created_at).getTime()) / 60000)
        : 0;

      if (minutesOld >= 120 && order.fields.workflow_name !== 't120_auto_patience_msg') {
        const campaignId = order.fields.campaign_id_text;
        if (campaignId) {
          const campaign = await airtableGetRecord('CAMPAIGNS', campaignId);
          if (campaign) {
            const linkedUserIds: string[] = campaign.fields.user_id || [];
            if (linkedUserIds[0]) {
              const user = await airtableGetRecord('USERS', linkedUserIds[0]);
              if (user?.fields.telegram_chat_id) {
                const { bot } = await import('./index.js');
                await bot.api.sendMessage(
                  user.fields.telegram_chat_id,
                  'Hang tight! Your order is being processed. We\'ll have an update for you soon.'
                ).catch(() => {});
              }
            }
          }
        }

        await airtableUpdate('ORDERS', order.id, {
          workflow_name: 't120_auto_patience_msg',
        }).catch(() => {});
      } else if (minutesOld < 120) {
        await sendAdminAlert(
          `AI_Pending order ${order.id} is ${minutesOld} minutes old`
        );
      }

      await delay(200);
    }

    console.log('[cron] Watchdog complete.');
  } catch (err) {
    console.error('[cron] Stuck order watchdog error:', err);
  }
}

export function startScheduler(): void {
  setInterval(runCampaignAutoClose, 60 * 60 * 1000);
  setInterval(runStuckOrderWatchdog, 60 * 60 * 1000);

  setTimeout(runCampaignAutoClose, 10_000);
  setTimeout(runStuckOrderWatchdog, 10_000);

  console.log('[cron] Scheduler started: auto-close (60m), watchdog (60m)');
}
