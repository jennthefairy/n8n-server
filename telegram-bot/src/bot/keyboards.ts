import { InlineKeyboard } from 'grammy';

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('\ud83d\udecd Shop', 'shop')
    .text('\ud83d\udce6 My Orders', 'myorders')
    .row()
    .text('\u2753 Help', 'help');
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
  return new InlineKeyboard()
    .text('\ud83d\udcb3 Pre-order Now', `preorder:${campaignId}`)
    .row()
    .text('\u2b05\ufe0f Back to Shop', 'back:shop');
}

export function backKeyboard(destination: string): InlineKeyboard {
  return new InlineKeyboard().text('\u2b05\ufe0f Back', `back:${destination}`);
}
