import type { ChannelDestinationConfig, ChannelKey } from "@/lib/config/channel-configs";

export type YoutubeQuoteSchedulerMode = "independent_youtube_quote_short";
export type YoutubeQuoteSchedulerJobType = "quote_pipeline";

export type YoutubeQuoteSchedulerPolicy = {
  channelKey: ChannelKey;
  enabled: boolean;
  primaryPlatform: "youtube";
  facebookQuotePhotoEnabled: boolean;
  formatType: "legacy_quote_short";
  quoteStyle: "static_deep_quote";
  kinetic: false;
  mode: YoutubeQuoteSchedulerMode;
  schedulerJobType: YoutubeQuoteSchedulerJobType;
  frequency: "hourly";
  targetPerDay: number;
  targetUpcomingQueueRows: number;
  maxQueueInsertPerRun: number;
  slotMinute: 0;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  workspaceId: string;
  channelProfileId: string;
  durationSec: number;
};

export type YoutubeQuoteLanePlan = {
  configAction: "insert" | "update" | "no_op";
  jobAction: "insert" | "update" | "no_op";
};

// tang_sau is out of scope (see docs/SCOPE_REDUCTION_AUDIT_2026_06_26.md). The YouTube-first
// quote_pipeline lane was tang_sau-only; it is now permanently disabled by always returning
// null. quote_pipeline's caller in content-generator.ts already no-ops cleanly on null.
export function getYoutubeQuoteSchedulerPolicy(
  _value: string | null | undefined,
): YoutubeQuoteSchedulerPolicy | null {
  return null;
}

export function buildYoutubeQuoteDestinationConfig(
  policy: YoutubeQuoteSchedulerPolicy,
  channelId: number,
): ChannelDestinationConfig {
  return {
    enabled: true,
    channelId,
    windowStart: policy.windowStart,
    windowEnd: policy.windowEnd,
    intervalMin: policy.intervalMin,
    privacyStatus: "public",
  };
}

export function isSameDestinationConfig(
  left: ChannelDestinationConfig | null | undefined,
  right: ChannelDestinationConfig,
): boolean {
  return Boolean(
    left &&
    left.enabled === right.enabled &&
    left.channelId === right.channelId &&
    left.windowStart === right.windowStart &&
    left.windowEnd === right.windowEnd &&
    left.intervalMin === right.intervalMin &&
    left.privacyStatus === right.privacyStatus,
  );
}

export function buildYoutubeQuoteLanePlan(input: {
  configMatches: boolean;
  jobMatches: boolean;
}): YoutubeQuoteLanePlan {
  return {
    configAction: input.configMatches ? "no_op" : "update",
    jobAction: input.jobMatches ? "no_op" : "update",
  };
}
