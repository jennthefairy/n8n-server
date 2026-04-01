import { Bot } from 'grammy';
import { airtableFetch, airtableCreate, airtableUpdate, sanitizeParam } from '../lib/airtable.js';
import { mainMenuKeyboard, campaignListKeyboard } from './keyboards.js';

export function registerCommands(bot: Bot) {
  bot.command('start', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const firstName = ctx.from?.first_name || 'there';

    // Check for deep link parameters (e.g., order success redirect)
    const param = ctx.match;
    if (param?.startsWith('order_success')) {
      await ctx.reply(
        'Your pre-order is confirmed! We\'ll keep you updated on the campaign progress.',
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    // Look up user by telegram_chat_id
    const data = await airtableFetch('USERS', {
      filterByFormula: `{telegram_chat_id}='${sanitizeParam(chatId)}'`,
      maxRecords: 1,
    });
    const user = data.records?.[0];

    if (!user) {
      // New user — create record and start onboarding
      await airtableCreate('USERS', {
        telegram_chat_id: chatId,
        first_name: firstName,
        bot_state: 'new',
      });

      await ctx.reply(
        `Hey ${firstName}! Welcome to *PageFairy*\n\nLaunch your beauty brand risk-free with pre-order campaigns. Only get charged when the goal is met.`,
        { parse_mode: 'Markdown' }
      );

      await new Promise((r) => setTimeout(r, 1500));

      await ctx.reply(
        'Here\'s how it works:\n\n1. Create a campaign for your product\n2. Share your link — customers pre-order\n3. Hit your goal? Orders ship! Miss it? Everyone gets refunded.\n\nZero risk. Pure momentum.',
      );

      await new Promise((r) => setTimeout(r, 1500));

      // Set state to awaiting_username
      const created = await airtableFetch('USERS', {
        filterByFormula: `{telegram_chat_id}='${sanitizeParam(chatId)}'`,
        maxRecords: 1,
      });
      if (created.records?.[0]) {
        await airtableUpdate('USERS', created.records[0].id, { bot_state: 'awaiting_username' });
      }

      await ctx.reply(
        'Let\'s set up your page! Choose a username (lowercase letters and numbers, 3-32 characters):',
      );
      return;
    }

    // Existing user without username
    if (!user.fields.username) {
      await airtableUpdate('USERS', user.id, { bot_state: 'awaiting_username' });
      await ctx.reply(
        `Welcome back, ${firstName}! You still need to pick a username. Enter one now (lowercase letters and numbers, 3-32 characters):`,
      );
      return;
    }

    // Returning user with username — show dashboard
    const campaigns = await airtableFetch('CAMPAIGNS', {
      filterByFormula: `AND(FIND('${user.id}', ARRAYJOIN({user_id})), {status}='active')`,
    });

    const campaignList = campaigns.records || [];
    let dashboardText = `Welcome back, ${firstName}!\n\n`;

    if (campaignList.length > 0) {
      dashboardText += 'Your active campaigns:\n\n';
      for (const c of campaignList) {
        const name = c.fields.campaign_name || 'Untitled';
        const current = c.fields.current_units || 0;
        const goal = c.fields.goal_units || 10;
        const pct = Math.round((current / goal) * 100);
        dashboardText += `${name} — ${current}/${goal} sold (${pct}%)\n`;
      }
    } else {
      dashboardText += 'No active campaigns right now.';
    }

    await ctx.reply(dashboardText, { reply_markup: mainMenuKeyboard() });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '*PageFairy Bot*\n\n' +
      'Available commands:\n' +
      '/start — Main menu & dashboard\n' +
      '/shop — Browse active campaigns\n' +
      '/help — Show this help message\n\n' +
      'Tap the buttons below to navigate!',
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
  });

  bot.command('shop', async (ctx) => {
    const campaigns = await airtableFetch('CAMPAIGNS', {
      filterByFormula: `{status}='active'`,
    });

    const campaignList = campaigns.records || [];
    if (campaignList.length === 0) {
      await ctx.reply('No active campaigns right now. Check back soon!', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    await ctx.reply('Browse active campaigns:', {
      reply_markup: campaignListKeyboard(campaignList),
    });
  });
}
