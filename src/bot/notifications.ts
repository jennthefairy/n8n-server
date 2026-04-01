import { bot } from './index.js';
import { airtableGetRecord } from '../lib/airtable.js';

interface OrderNotificationData {
  campaign_id: string;
  campaign_name: string;
  customer_email: string;
  customer_name?: string;
  amount_cents: number;
  current_units: number;
  goal_units: number;
}

export async function sendOrderNotification(data: OrderNotificationData): Promise<void> {
  const campaign = await airtableGetRecord('CAMPAIGNS', data.campaign_id);
  if (!campaign) return;

  const linkedUserIds: string[] = campaign.fields.user_id || [];
  const userRecordId = linkedUserIds[0];
  if (!userRecordId) return;

  const user = await airtableGetRecord('USERS', userRecordId);
  if (!user?.fields.telegram_chat_id) return;

  const chatId = user.fields.telegram_chat_id;
  const retail = parseFloat(campaign.fields.retail_price ?? 0);
  const wholesale = parseFloat(campaign.fields.wholesale_cost ?? 0);
  const pct = data.goal_units > 0 ? Math.round((data.current_units / data.goal_units) * 100) : 0;
  const remaining = Math.max(0, data.goal_units - data.current_units);
  const earnings = (data.current_units * (retail - wholesale)).toFixed(2);
  const amountDollars = (data.amount_cents / 100).toFixed(2);

  const progressLine = remaining > 0
    ? `${remaining} more to reach goal!`
    : 'Goal reached!';

  const message =
    `New Order!\n\n` +
    `Campaign: ${data.campaign_name}\n` +
    `Customer: ${data.customer_email}\n` +
    `Amount: $${amountDollars}\n\n` +
    `Progress: ${data.current_units}/${data.goal_units} (${pct}%)\n` +
    `${progressLine}\n\n` +
    `Your earnings so far: $${earnings}`;

  await bot.api.sendMessage(chatId, message);

  // Upsell after brief delay
  await new Promise((r) => setTimeout(r, 2000));
  await bot.api.sendMessage(
    chatId,
    'Order confirmed! Want us to build your PageFairy brand setup while you wait? Reply MAGIC to add Magic Wand+ for $99.'
  );
}

export async function sendCampaignCloseNotification(
  campaignId: string,
  goalMet: boolean
): Promise<void> {
  const campaign = await airtableGetRecord('CAMPAIGNS', campaignId);
  if (!campaign) return;

  const linkedUserIds: string[] = campaign.fields.user_id || [];
  const userRecordId = linkedUserIds[0];
  if (!userRecordId) return;

  const user = await airtableGetRecord('USERS', userRecordId);
  if (!user?.fields.telegram_chat_id) return;

  const chatId = user.fields.telegram_chat_id;
  const name = campaign.fields.campaign_name || 'Your campaign';
  const current = campaign.fields.current_units || 0;
  const goal = campaign.fields.goal_units || 10;

  if (goalMet) {
    await bot.api.sendMessage(
      chatId,
      `${name} hit its goal! (${current}/${goal})\n\n` +
      `All pre-orders have been charged and your campaign is now marked as successful. ` +
      `Time to ship those orders!`
    );
  } else {
    await bot.api.sendMessage(
      chatId,
      `${name} ended without reaching its goal (${current}/${goal}).\n\n` +
      `All pre-order holds have been released — no one was charged. ` +
      `You can always try again with a new campaign!`
    );
  }
}

export async function sendAdminApprovalRequest(data: {
  campaignId: string;
  campaignName: string;
  username: string;
}): Promise<void> {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (!adminChatId) return;

  const { InlineKeyboard } = await import('grammy');
  const kb = new InlineKeyboard()
    .text('Approve', `approve:${data.campaignId}`)
    .text('Reject', `reject:${data.campaignId}`);

  await bot.api.sendMessage(
    adminChatId,
    `New campaign needs approval:\n\n` +
    `Name: ${data.campaignName}\n` +
    `Creator: @${data.username}\n` +
    `ID: ${data.campaignId}`,
    { reply_markup: kb }
  );
}

export async function sendAdminAlert(message: string): Promise<void> {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (!adminChatId) return;
  await bot.api.sendMessage(adminChatId, `[ALERT] ${message}`);
}
