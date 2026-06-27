import type { FactoryHealthPayload } from "@/actions/factory-health";
import type { PublishingHealthPayload } from "@/actions/publishing-health";
import type { TelegramInlineKeyboardMarkup } from "@/lib/social/telegram";

export type FactoryHealthTelegramSnapshot = {
  factoryHealth: Pick<
    FactoryHealthPayload,
    | "status"
    | "violations"
    | "capacity"
    | "cronErrors"
    | "flags"
    | "recommendedAction"
  >;
  publishingHealth: Pick<
    PublishingHealthPayload,
    | "today"
    | "cleanup"
    | "analytics"
  >;
  dashboardUrl?: string | null;
};

const GB = 1_000_000_000;
const MB = 1_048_576;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  return `${(bytes / MB).toFixed(0)} MB`;
}

function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function takeRecentErrorLines(errors: FactoryHealthPayload["cronErrors"]): string[] {
  if (!errors.length) return ["• Không có lỗi cron gần đây"];
  return errors.slice(0, 3).map((error) => {
    const time = new Date(error.ranAt).toLocaleString("vi-VN", {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    return `• ${time}: ${escapeHtml(error.summary.slice(0, 140))}`;
  });
}

export function buildFactoryHealthTelegramMessage(
  snapshot: FactoryHealthTelegramSnapshot,
): string {
  const { factoryHealth, publishingHealth } = snapshot;
  const { capacity, flags } = factoryHealth;
  const statusIcon = factoryHealth.status === "ALLOWED" ? "✅" : "⛔";

  const lines: string[] = [
    "🏭 <b>Factory Health</b>",
    "",
    `${statusIcon} Production status: <b>${factoryHealth.status}</b>`,
  ];

  if (factoryHealth.violations.length > 0) {
    lines.push("<b>Blocking reasons</b>");
    for (const violation of factoryHealth.violations.slice(0, 4)) {
      lines.push(`• ${escapeHtml(violation.message)}`);
    }
  } else {
    lines.push("<b>Blocking reasons</b>");
    lines.push("• Không có");
  }

  lines.push(
    "",
    `Upload queue pending: <b>${capacity.pendingUploadCount}</b>`,
    `Rendered videos on disk: <b>${capacity.unpublishedRenderedCount}</b>`,
    `Uploaded today: <b>${publishingHealth.today.uploaded}</b>`,
    `Failed today: <b>${publishingHealth.today.failed}</b>`,
    `Analytics coverage: <b>${publishingHealth.analytics.videosWithAnalytics}/${publishingHealth.analytics.totalPublishedVideos}</b> (${fmtPct(publishingHealth.analytics.coveragePct)})`,
    `Retention coverage: <b>${publishingHealth.analytics.videosWithRetention}/${publishingHealth.analytics.youtubePublishedVideos}</b> (${fmtPct(publishingHealth.analytics.retentionCoveragePct)})`,
    `Media size: <b>${fmtBytes(capacity.mediaTotalBytes)}</b>`,
    `Free disk: <b>${fmtBytes(capacity.freeDiskBytes)}</b>`,
    `Cleanup eligible: <b>${publishingHealth.cleanup.eligibleCount}</b> (~${fmtBytes(publishingHealth.cleanup.eligibleSizeBytes)})`,
    `Short cover intro: <b>${flags.shortCoverIntroEnabled ? "ON" : "OFF"}</b> (${flags.shortCoverDurationSec}s / fade ${flags.shortCoverFadeOutSec}s)`,
    `Experiment: <b>${escapeHtml(flags.contentExperimentId)}</b> / <b>${escapeHtml(flags.contentExperimentVariant)}</b>`,
    "",
    "<b>Recent cron/job errors</b>",
    ...takeRecentErrorLines(factoryHealth.cronErrors),
    "",
    `<b>Recommended next action</b>`,
    escapeHtml(factoryHealth.recommendedAction),
  );

  if (snapshot.dashboardUrl) {
    lines.push("", `🔗 <a href="${snapshot.dashboardUrl}">Mở dashboard</a>`);
  }

  return lines.join("\n");
}

export function getFactoryHealthTelegramReplyMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🏭 Check Factory Health", callback_data: "factory_health:check" }],
    ],
  };
}
