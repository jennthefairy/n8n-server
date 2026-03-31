import { Bot } from 'grammy';
import { airtableFetch, airtableGetRecord, sanitizeParam } from '../lib/airtable.js';
import { mainMenuKeyboard, campaignListKeyboard, campaignDetailKeyboard } from './keyboards.js';
import { createBotCheckoutSession } from './checkout.js';

export function registerCallbacks(bot: Bot) {
  // Shop — list active campaigns
  bot.callbackQuery('shop', async (ctx) => {
    await ctx.answerCallbackQuery();
    const campaigns = await airtableFetch('CAMPAIGNS', {
      filterByFormula: `{status}='active'`,
    });
    const list = campaigns.records || [];
    if (list.length === 0) {
      await ctx.editMessageText('No active campaigns right now. Check back soon!', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }
    await ctx.editMessageText('Browse active campaigns:', {
      reply_markup: campaignListKeyboard(list),
    });
  });

  // Help callback
  bot.callbackQuery('help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '*PageFairy Bot*\n\n' +
      'Available commands:\n' +
      '/start — Main menu & dashboard\n' +
      '/shop — Browse active campaigns\n' +
      '/help — Show this help message\n\n' +
      'Tap the buttons below to navigate!',
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
  });

  // My orders
  bot.callbackQuery('myorders', async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = String(ctx.chat!.id);

    const userData = await airtableFetch('USERS', {
      filterByFormula: `{telegram_chat_id}='${sanitizeParam(chatId)}'`,
      maxRecords: 1,
    });
    const user = userData.records?.[0];

    if (!user?.fields.username) {
      await ctx.editMessageText('Set up your account first with /start', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    const campaigns = await airtableFetch('CAMPAIGNS', {
      filterByFormula: `FIND('${user.id}', ARRAYJOIN({user_id}))`,
    });
    const campaignIds = (campaigns.records || []).map((c: any) => c.id);

    if (campaignIds.length === 0) {
      await ctx.editMessageText('No orders yet. Browse campaigns with /shop!', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    let orderText = 'Your campaign orders:\n\n';
    for (const cId of campaignIds.slice(0, 5)) {
      const campaign = await airtableGetRecord('CAMPAIGNS', cId);
      if (!campaign) continue;
      const name = campaign.fields.campaign_name || 'Campaign';
      const current = campaign.fields.current_units || 0;
      const goal = campaign.fields.goal_units || 10;
      const status = campaign.fields.status || 'unknown';
      orderText += `${name}\n  ${current}/${goal} sold — Status: ${status}\n\n`;
    }

    await ctx.editMessageText(orderText, { reply_markup: mainMenuKeyboard() });
  });

  // Campaign detail
  bot.callbackQuery(/^campaign:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const campaignId = ctx.match[1];
    const campaign = await airtableGetRecord('CAMPAIGNS', campaignId);

    if (!campaign) {
      await ctx.editMessageText('Campaign not found.', { reply_markup: mainMenuKeyboard() });
      return;
    }

    const f = campaign.fields;
    const name = f.campaign_name || 'Campaign';
    const description = f.description || 'No description available.';
    const price = f.retail_price ? `$${parseFloat(f.retail_price).toFixed(2)}` : 'TBD';
    const current = f.current_units || 0;
    const goal = f.goal_units || 10;
    const pct = Math.round((current / goal) * 100);

    const filled = Math.round(pct / 10);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);

    const text =
      `*${name}*\n\n` +
      `${description}\n\n` +
      `Price: ${price}\n` +
      `Progress: ${bar} ${current}/${goal} (${pct}%)\n\n` +
      (current >= goal ? 'Goal reached! Orders will ship soon.' : `${goal - current} more needed to reach the goal.`);

    if (f.image_url) {
      try {
        await ctx.deleteMessage();
        await ctx.replyWithPhoto(f.image_url, {
          caption: text,
          parse_mode: 'Markdown',
          reply_markup: campaignDetailKeyboard(campaignId),
        });
        return;
      } catch {
        // Fall through to text if photo fails
      }
    }

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: campaignDetailKeyboard(campaignId),
    });
  });

  // Pre-order
  bot.callbackQuery(/^preorder:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Creating your checkout link...');
    const campaignId = ctx.match[1];
    const campaign = await airtableGetRecord('CAMPAIGNS', campaignId);

    if (!campaign) {
      await ctx.reply('Campaign not found.');
      return;
    }

    const chatId = String(ctx.chat!.id);
    const userData = await airtableFetch('USERS', {
      filterByFormula: `{telegram_chat_id}='${sanitizeParam(chatId)}'`,
      maxRecords: 1,
    });
    const user = userData.records?.[0];
    const email = user?.fields.email || '';
    const name = user?.fields.first_name || ctx.from?.first_name || '';
    const username = user?.fields.username || 'shop';

    const f = campaign.fields;
    const amount = Math.round((parseFloat(f.retail_price) || 0) * 100);

    if (!amount) {
      await ctx.reply('This campaign doesn\'t have a price set yet.');
      return;
    }

    try {
      const result = await createBotCheckoutSession({
        campaignId,
        email,
        name,
        campaignName: f.campaign_name || 'Product',
        amount,
        username,
      });

      await ctx.reply(
        `Here's your checkout link:\n\n${result.checkoutUrl}\n\nComplete payment to secure your pre-order!`
      );
    } catch (err: any) {
      console.error('Bot checkout error:', err);
      await ctx.reply('Something went wrong creating your checkout. Please try again.');
    }
  });

  // Back navigation
  bot.callbackQuery('back:menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    const firstName = ctx.from?.first_name || 'there';

    try {
      await ctx.editMessageText(`Welcome back, ${firstName}!`, {
        reply_markup: mainMenuKeyboard(),
      });
    } catch {
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply(`Welcome back, ${firstName}!`, {
        reply_markup: mainMenuKeyboard(),
      });
    }
  });

  bot.callbackQuery('back:shop', async (ctx) => {
    await ctx.answerCallbackQuery();
    const campaigns = await airtableFetch('CAMPAIGNS', {
      filterByFormula: `{status}='active'`,
    });
    const list = campaigns.records || [];

    try {
      await ctx.editMessageText('Browse active campaigns:', {
        reply_markup: campaignListKeyboard(list),
      });
    } catch {
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply('Browse active campaigns:', {
        reply_markup: campaignListKeyboard(list),
      });
    }
  });
}
