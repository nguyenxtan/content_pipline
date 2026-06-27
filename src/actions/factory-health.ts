"use server";

import {
  getProductionCapacityStatus,
  type ProductionCapacityStatus,
  type CapacityViolation,
} from "@/lib/production-capacity";
import { db } from "@/lib/db";
import { cronRunLogs, appConfig } from "@/lib/db/schema";
import { desc, gte, eq } from "drizzle-orm";
import { sendTelegram, sendTelegramMessage } from "@/lib/social/telegram";
import {
  getAutoRefillHealthSnapshot,
  type AutoRefillHealthSnapshot,
} from "@/lib/auto-refill-watcher";
import { getPublishingHealthAction } from "@/actions/publishing-health";
import {
  buildFactoryHealthTelegramMessage,
  getFactoryHealthTelegramReplyMarkup,
  type FactoryHealthTelegramSnapshot,
} from "@/lib/social/telegram-factory-health";

const FACTORY_HEALTH_SUMMARY_CONFIG_KEY = "factory_health_summary_config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FactoryHealthSummaryConfig {
  enabled: boolean;
  sendHour: number;
  sendMinute: number;
  lastSentMarker: string | null;
}

export interface FactoryHealthCronError {
  ranAt: string;
  summary: string;
}

export interface FactoryHealthFlags {
  shortCoverIntroEnabled: boolean;
  shortCoverDurationSec: string;
  shortCoverFadeOutSec: string;
  contentExperimentVariant: string;
  contentExperimentId: string;
  contentGenModel: string;
  longformModel: string;
}

export interface FactoryHealthPayload {
  generatedAt: string;
  isHealthy: boolean;
  status: "ALLOWED" | "PAUSED";
  violations: CapacityViolation[];
  capacity: ProductionCapacityStatus;
  cronErrors: FactoryHealthCronError[];
  lastCronRunAt: string | null;
  lastCronDurationMs: number | null;
  cronStaleSec: number | null;
  flags: FactoryHealthFlags;
  recommendedAction: string;
  telegramSummaryConfig: FactoryHealthSummaryConfig;
  autoRefill: AutoRefillHealthSnapshot;
}

export type FactoryHealthTelegramReportPayload = FactoryHealthTelegramSnapshot;

// ── Config helpers ────────────────────────────────────────────────────────────

function getDefaultSummaryConfig(): FactoryHealthSummaryConfig {
  return { enabled: false, sendHour: 8, sendMinute: 0, lastSentMarker: null };
}

function normalizeSummaryConfig(
  input: Partial<FactoryHealthSummaryConfig> | null | undefined,
): FactoryHealthSummaryConfig {
  const base = getDefaultSummaryConfig();
  return {
    enabled: Boolean(input?.enabled),
    sendHour: Math.min(23, Math.max(0, Number(input?.sendHour ?? base.sendHour))),
    sendMinute: Math.min(59, Math.max(0, Number(input?.sendMinute ?? base.sendMinute))),
    lastSentMarker:
      typeof input?.lastSentMarker === "string" ? input.lastSentMarker : null,
  };
}

function buildRecommendedAction(capacity: ProductionCapacityStatus): string {
  if (!capacity.isHealthy) {
    const top = capacity.violations[0];
    switch (top?.reason) {
      case "upload_queue_too_large":
        return "Upload queue đầy. Chờ upload drain hoặc kiểm tra lỗi upload.";
      case "unpublished_rendered_videos_too_many":
        return "Chạy: pnpm cleanup:uploaded-assets:delete";
      case "media_size_too_large":
        return "Chạy: pnpm storage:report rồi pnpm cleanup:uploaded-assets:delete";
      case "low_free_disk":
        return "Giải phóng dung lượng ổ đĩa rồi kiểm tra lại.";
      case "daily_generation_limit_reached":
        return "Đã đạt giới hạn ngày. Chờ đến nửa đêm UTC hoặc tăng MAX_DAILY_NEW_CONTENT.";
    }
  }
  if (capacity.estimatedCleanupBytes > 200 * 1024 * 1024) {
    return "Hệ thống ổn. Nên chạy: pnpm cleanup:uploaded-assets:delete";
  }
  return "Tất cả hệ thống bình thường.";
}

// ── Main action ───────────────────────────────────────────────────────────────

export async function getFactoryHealthAction(): Promise<FactoryHealthPayload> {
  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  const [capacity, recentCronRows, lastCronRow, summaryConfigRow, autoRefill] =
    await Promise.all([
      getProductionCapacityStatus(),

      db
        .select({
          ranAt: cronRunLogs.ranAt,
          errorSummary: cronRunLogs.errorSummary,
        })
        .from(cronRunLogs)
        .where(gte(cronRunLogs.ranAt, threeHoursAgo))
        .orderBy(desc(cronRunLogs.ranAt))
        .limit(20),

      db
        .select({ ranAt: cronRunLogs.ranAt, durationMs: cronRunLogs.durationMs })
        .from(cronRunLogs)
        .orderBy(desc(cronRunLogs.ranAt))
        .limit(1)
        .then((r) => r[0] ?? null),

      db.query.appConfig.findFirst({
        where: eq(appConfig.key, FACTORY_HEALTH_SUMMARY_CONFIG_KEY),
      }),
      getAutoRefillHealthSnapshot(),
    ]);

  const cronErrors: FactoryHealthCronError[] = recentCronRows
    .filter((r) => r.errorSummary)
    .map((r) => ({ ranAt: r.ranAt!.toISOString(), summary: r.errorSummary! }));

  const lastCronRunAt = lastCronRow?.ranAt?.toISOString() ?? null;
  const lastCronDurationMs = lastCronRow?.durationMs ?? null;
  const cronStaleSec = lastCronRow?.ranAt
    ? Math.floor((now.getTime() - lastCronRow.ranAt.getTime()) / 1000)
    : null;

  const rawVariant = process.env.CONTENT_EXPERIMENT_VARIANT ?? "HOOK_V1";
  const inferredId = (() => {
    const idx = rawVariant.lastIndexOf("_V");
    return idx > 0 ? rawVariant.slice(0, idx) : "HOOK";
  })();

  const flags: FactoryHealthFlags = {
    shortCoverIntroEnabled: ["1", "true", "yes", "on"].includes(
      (process.env.SHORT_COVER_INTRO_ENABLED ?? "").trim().toLowerCase(),
    ),
    shortCoverDurationSec: process.env.SHORT_COVER_DURATION_SEC ?? "1.5",
    shortCoverFadeOutSec: process.env.SHORT_COVER_FADE_OUT_SEC ?? "0.25",
    contentExperimentVariant: rawVariant,
    contentExperimentId: process.env.CONTENT_EXPERIMENT_ID ?? inferredId,
    contentGenModel: process.env.CONTENT_GEN_MODEL ?? "openai/gpt-4o-mini",
    longformModel: process.env.LONGFORM_MODEL ?? "google/gemini-2.0-flash",
  };

  const telegramSummaryConfig = summaryConfigRow
    ? normalizeSummaryConfig(
        JSON.parse(summaryConfigRow.value) as Partial<FactoryHealthSummaryConfig>,
      )
    : getDefaultSummaryConfig();

  return {
    generatedAt: now.toISOString(),
    isHealthy: capacity.isHealthy,
    status: capacity.isHealthy ? "ALLOWED" : "PAUSED",
    violations: capacity.violations,
    capacity,
    cronErrors,
    lastCronRunAt,
    lastCronDurationMs,
    cronStaleSec,
    flags,
    recommendedAction: buildRecommendedAction(capacity),
    telegramSummaryConfig,
    autoRefill,
  };
}

export async function getFactoryHealthTelegramReportAction(): Promise<FactoryHealthTelegramReportPayload> {
  const [factoryHealth, publishingHealth] = await Promise.all([
    getFactoryHealthAction(),
    getPublishingHealthAction(),
  ]);

  return {
    factoryHealth,
    publishingHealth,
    dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/publishing/health`,
  };
}

export async function sendFactoryHealthTelegramReportAction(input?: {
  chatId?: string | number | null;
  includeButton?: boolean;
}): Promise<{ sent: boolean; text: string }> {
  const payload = await getFactoryHealthTelegramReportAction();
  const text = buildFactoryHealthTelegramMessage(payload);
  await sendTelegramMessage(text, {
    chatId: input?.chatId,
    replyMarkup: input?.includeButton ? getFactoryHealthTelegramReplyMarkup() : undefined,
  });
  return { sent: true, text };
}

// ── Telegram config ───────────────────────────────────────────────────────────

export async function saveFactoryHealthSummaryConfigAction(
  input: FactoryHealthSummaryConfig,
): Promise<{ success: boolean }> {
  const normalized = normalizeSummaryConfig(input);
  await db
    .insert(appConfig)
    .values({
      key: FACTORY_HEALTH_SUMMARY_CONFIG_KEY,
      value: JSON.stringify(normalized),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: JSON.stringify(normalized), updatedAt: new Date() },
    });
  return { success: true };
}

// ── Scheduled Telegram summary (called from cron) ─────────────────────────────

export async function maybeSendFactoryHealthSummaryAction(): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, FACTORY_HEALTH_SUMMARY_CONFIG_KEY),
  });
  const config = row
    ? normalizeSummaryConfig(
        JSON.parse(row.value) as Partial<FactoryHealthSummaryConfig>,
      )
    : getDefaultSummaryConfig();

  if (!config.enabled) return { sent: false, reason: "disabled" };

  // Vietnam time = UTC+7
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hour = vnNow.getUTCHours();
  const minute = vnNow.getUTCMinutes();

  if (hour !== config.sendHour || minute !== config.sendMinute) {
    return { sent: false, reason: "not_due_time" };
  }

  const todayMarker = vnNow.toISOString().slice(0, 10);
  if (config.lastSentMarker === todayMarker) {
    return { sent: false, reason: "already_sent" };
  }

  const capacity = await getProductionCapacityStatus();
  const GB = 1_000_000_000;
  const fmtBytes = (b: number) =>
    b >= GB
      ? `${(b / GB).toFixed(2)} GB`
      : `${(b / 1_048_576).toFixed(0)} MB`;

  const statusIcon = capacity.isHealthy ? "✅" : "❌";
  const lines: string[] = [
    `🏭 <b>Factory Health - ${todayMarker}</b>`,
    "",
    `${statusIcon} Status: <b>${capacity.isHealthy ? "ALLOWED" : "PAUSED"}</b>`,
    "",
    `Upload queue: ${capacity.pendingUploadCount} / ${capacity.thresholds.maxPendingUploadQueue}`,
    `Rendered trên disk: ${capacity.unpublishedRenderedCount} / ${capacity.thresholds.maxUnpublishedRendered}`,
    `Tạo hôm nay: ${capacity.todayGeneratedCount} / ${capacity.thresholds.maxDailyNewContent}`,
    `Media: ${fmtBytes(capacity.mediaTotalBytes)} / ${capacity.thresholds.maxMediaSizeGb} GB`,
    `Disk trống: ${fmtBytes(capacity.freeDiskBytes)}`,
  ];

  if (capacity.violations.length > 0) {
    lines.push("", "<b>Lý do tạm dừng:</b>");
    for (const v of capacity.violations) {
      lines.push(`• ${v.message}`);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  lines.push("", `👉 <a href="${appUrl}/publishing/health">Mở dashboard</a>`);

  await sendTelegram(lines.join("\n"));

  const newConfig: FactoryHealthSummaryConfig = {
    ...config,
    lastSentMarker: todayMarker,
  };
  await db
    .insert(appConfig)
    .values({
      key: FACTORY_HEALTH_SUMMARY_CONFIG_KEY,
      value: JSON.stringify(newConfig),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: JSON.stringify(newConfig), updatedAt: new Date() },
    });

  return { sent: true };
}
