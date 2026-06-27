import type { ChannelDestinationConfig, ChannelKey } from "@/lib/config/channel-configs";
import { getWorkspaceById } from "@/lib/channel-workspace-registry";

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

const tangSauWorkspace = getWorkspaceById("tang_sau_workspace");

const TANG_SAU_YOUTUBE_QUOTE_POLICY: YoutubeQuoteSchedulerPolicy = {
  channelKey: "tang_sau",
  enabled: true,
  primaryPlatform: "youtube",
  facebookQuotePhotoEnabled: false,
  formatType: "legacy_quote_short",
  quoteStyle: "static_deep_quote",
  kinetic: false,
  mode: "independent_youtube_quote_short",
  schedulerJobType: "quote_pipeline",
  frequency: "hourly",
  targetPerDay: 2,
  targetUpcomingQueueRows: 2,
  maxQueueInsertPerRun: 1,
  slotMinute: 0,
  windowStart: tangSauWorkspace?.schedulePlan.postingWindows[0]?.start ?? "07:00",
  windowEnd: tangSauWorkspace?.schedulePlan.postingWindows[0]?.end ?? "22:00",
  intervalMin: tangSauWorkspace?.schedulePlan.intervalMinutes ?? 60,
  workspaceId: "tang_sau_workspace",
  channelProfileId: "tang_sau_v1",
  durationSec: 14,
};

export function getYoutubeQuoteSchedulerPolicy(
  value: string | null | undefined,
): YoutubeQuoteSchedulerPolicy | null {
  if (value === "tang_sau") return TANG_SAU_YOUTUBE_QUOTE_POLICY;
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
