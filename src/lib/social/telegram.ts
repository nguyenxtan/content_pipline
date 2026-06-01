const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return; // silent — not configured
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch { /* không làm gián đoạn luồng chính */ }
}

export async function notifyChannelDisconnected(channelName: string, error: string): Promise<void> {
  const msg =
    `⚠️ <b>Kênh YouTube mất kết nối</b>\n\n` +
    `Kênh: <b>${channelName}</b>\n` +
    `Lỗi: <code>${error.slice(0, 200)}</code>\n\n` +
    `👉 Vào <a href="${APP_URL}/settings/channels">Settings → Kênh</a> để kết nối lại.`;
  await sendTelegram(msg);
}

export async function notifyFacebookPageDisconnected(pageName: string, error: string): Promise<void> {
  const msg =
    `⚠️ <b>Facebook Page mất kết nối</b>\n\n` +
    `Page: <b>${pageName}</b>\n` +
    `Lỗi: <code>${error.slice(0, 200)}</code>\n\n` +
    `👉 Vào <a href="${APP_URL}/settings/channels">Settings → Kênh</a> để cập nhật token.`;
  await sendTelegram(msg);
}
