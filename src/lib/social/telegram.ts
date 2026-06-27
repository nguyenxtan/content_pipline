const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export type TelegramInlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineButton[][];
};

type TelegramSendOptions = {
  chatId?: string | number | null;
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  replyMarkup?: TelegramInlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
};

async function callTelegramApi(method: string, payload: Record<string, unknown>): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function sendTelegramMessage(text: string, options?: TelegramSendOptions): Promise<void> {
  const targetChatId = options?.chatId ?? CHAT_ID;
  if (!BOT_TOKEN || !targetChatId) return; // silent — not configured
  try {
    await callTelegramApi("sendMessage", {
      chat_id: targetChatId,
      text,
      parse_mode: options?.parseMode ?? "HTML",
      reply_markup: options?.replyMarkup,
      disable_web_page_preview: options?.disableWebPagePreview ?? true,
    });
  } catch {
    /* không làm gián đoạn luồng chính */
  }
}

export async function sendTelegram(text: string): Promise<void> {
  await sendTelegramMessage(text);
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  if (!BOT_TOKEN || !callbackQueryId) return;
  try {
    await callTelegramApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch {
    /* best effort */
  }
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
