import {
  buildFactoryHealthTelegramMessage,
  type FactoryHealthTelegramSnapshot,
} from "@/lib/social/telegram-factory-health";

const mockData: FactoryHealthTelegramSnapshot = {
  factoryHealth: {
    status: "PAUSED",
    recommendedAction: "Chạy: pnpm cleanup:uploaded-assets:delete",
    violations: [
      {
        reason: "upload_queue_too_large",
        message: "Upload queue has 73 pending items (threshold 50)",
        current: 73,
        threshold: 50,
      },
    ],
    cronErrors: [
      {
        ranAt: "2026-06-02T13:00:00.000Z",
        summary: "youtube short upload failed: quotaExceeded",
      },
    ],
    flags: {
      shortCoverIntroEnabled: true,
      shortCoverDurationSec: "1.5",
      shortCoverFadeOutSec: "0.25",
      contentExperimentVariant: "COVER_INTRO_ON",
      contentExperimentId: "SHORT_COVER_INTRO",
      contentGenModel: "openai/gpt-4o-mini",
      longformModel: "google/gemini-2.0-flash",
    },
    capacity: {
      pendingUploadCount: 73,
      uploadingCount: 2,
      failedUploadCount: 4,
      pendingContentCount: 11,
      unpublishedRenderedCount: 29,
      todayGeneratedCount: 18,
      mediaTotalBytes: 4_200_000_000,
      mediaVideoBytes: 2_900_000_000,
      mediaAudioBytes: 400_000_000,
      mediaImagesBytes: 500_000_000,
      estimatedCleanupBytes: 650_000_000,
      freeDiskBytes: 28_400_000_000,
      nextScheduledPublishAt: null,
      thresholds: {
        maxPendingUploadQueue: 50,
        maxUnpublishedRendered: 30,
        maxMediaSizeGb: 10,
        minFreeDiskGb: 30,
        maxDailyNewContent: 20,
      },
      violations: [
        {
          reason: "upload_queue_too_large",
          message: "Upload queue has 73 pending items (threshold 50)",
          current: 73,
          threshold: 50,
        },
      ],
      isHealthy: false,
    },
  },
  publishingHealth: {
    today: {
      uploaded: 9,
      failed: 2,
      uploadedByPlatform: [],
      failedByPlatform: [],
    },
    cleanup: {
      scanned: 120,
      eligibleCount: 21,
      eligibleSizeBytes: 645_000_000,
      estimateLimit: 500,
    },
    analytics: {
      totalPublishedVideos: 88,
      videosWithAnalytics: 83,
      coveragePct: 94.3,
      youtubePublishedVideos: 79,
      videosWithRetention: 44,
      retentionCoveragePct: 55.7,
    },
  },
  dashboardUrl: "https://example.com/publishing/health",
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const message = buildFactoryHealthTelegramMessage(mockData);

assert(message.includes("Production status"), "status missing");
assert(message.includes("Blocking reasons"), "blocking reasons missing");
assert(message.includes("Recommended next action"), "recommended action missing");
assert(message.length < 4096, "message exceeds Telegram safe limit");

console.log(JSON.stringify({
  ok: true,
  length: message.length,
  preview: message,
}, null, 2));
