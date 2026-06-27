import { NextResponse } from "next/server";
import {
  answerTelegramCallbackQuery,
} from "@/lib/social/telegram";
import {
  sendFactoryHealthTelegramReportAction,
} from "@/actions/factory-health";

type TelegramChat = { id: number | string };
type TelegramUser = { id: number | string };
type TelegramMessage = {
  text?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
};
type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: {
    chat?: TelegramChat;
  };
};
type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

const HEALTH_COMMANDS = new Set(["/health", "/factory", "/status"]);
const CALLBACK_DATA = "factory_health:check";

function normalizeCommand(text: string | undefined): string | null {
  if (!text) return null;
  const firstToken = text.trim().split(/\s+/)[0];
  if (!firstToken.startsWith("/")) return null;
  const [command] = firstToken.split("@");
  return command.toLowerCase();
}

function readAuthorizedChatId(): string | null {
  const value = process.env.TELEGRAM_CHAT_ID?.trim();
  return value ? value : null;
}

function readAuthorizedUserId(): string | null {
  const value = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  return value ? value : null;
}

function isAuthorizedTelegramSource(chatId: string | null, userId: string | null): boolean {
  const authorizedChatId = readAuthorizedChatId();
  const authorizedUserId = readAuthorizedUserId();
  if (!authorizedChatId) return false;
  if (chatId !== authorizedChatId) return false;
  if (authorizedUserId && userId !== authorizedUserId) return false;
  return true;
}

function hasValidWebhookSecret(req: Request): boolean {
  const configured = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!configured) return true;
  return req.headers.get("x-telegram-bot-api-secret-token") === configured;
}

export async function POST(req: Request) {
  // `/api/telegram` is public in the middleware so Telegram can reach it.
  // Security here relies on webhook secret validation plus allowed chat/user IDs.
  if (!hasValidWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  if (!update) {
    return NextResponse.json({ ok: true, ignored: "invalid_payload" });
  }

  const callback = update.callback_query;
  const message = update.message;

  const chatId = String(
    callback?.message?.chat?.id ??
    message?.chat?.id ??
    "",
  ) || null;
  const userId = String(
    callback?.from?.id ??
    message?.from?.id ??
    "",
  ) || null;

  if (!isAuthorizedTelegramSource(chatId, userId)) {
    if (callback?.id) {
      await answerTelegramCallbackQuery(callback.id, "Unauthorized");
    }
    return NextResponse.json({ ok: true, ignored: "unauthorized_chat" });
  }

  if (callback?.data === CALLBACK_DATA) {
    await sendFactoryHealthTelegramReportAction({
      chatId,
      includeButton: true,
    });
    await answerTelegramCallbackQuery(callback.id);
    return NextResponse.json({ ok: true, handled: "factory_health_callback" });
  }

  const command = normalizeCommand(message?.text);
  if (!command || !HEALTH_COMMANDS.has(command)) {
    return NextResponse.json({ ok: true, ignored: "unsupported_command" });
  }

  await sendFactoryHealthTelegramReportAction({
    chatId,
    includeButton: true,
  });

  return NextResponse.json({ ok: true, handled: "factory_health_command" });
}
