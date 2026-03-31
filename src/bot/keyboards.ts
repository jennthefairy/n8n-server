import { InlineKeyboard } from 'grammy';

const MINI_APP_URL = process.env.MINI_APP_URL || '';

export function mainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('\ud83d\udecd Shop', 'shop')
    .text('\ud83d\udce6 My Orders', 'myorders')
    .row()
    .text('\u2753 Help', 'help');

  if (MINI_APP_URL) {
    kb.row().webApp('\ud83d\ude80 Open App', MINI_APP_URL);
  }

  return kb;
}

export function campaignListKeyboard(
  campaigns: Array<{ id: string; fields: Record<string, any> }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of campaigns) {
    const name = c.fields.campaign_name || 'Campaign';
    const current = c.fields.current_units || 0;
    const goal = c.fields.goal_units || 10;
    kb.text(`${name} (${current}/${goal})`, `campaign:${c.id}`).row();
  }
  kb.text('\u2b05\ufe0f Back to Menu', 'back:menu');
  return kb;
}

export function campaignDetailKeyboard(campaignId: string): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('\ud83d\udcb3 Pre-order Now', `preorder:${campaignId}`)
    .row()
    .text('\u2b05\ufe0f Back to Shop', 'back:shop');

  if (MINI_APP_URL) {
    kb.row().webApp('\ud83d\udd0d View Details', `${MINI_APP_URL}/campaign/${campaignId}`);
  }

  return kb;
}

export function backKeyboard(destination: string): InlineKeyboard {
  return new InlineKeyboard().text('\u2b05\ufe0f Back', `back:${destination}`);
}
