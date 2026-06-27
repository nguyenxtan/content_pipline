/**
 * Channel Workspace Registry
 *
 * Source of truth for workspace configuration.
 * Stored as TypeScript constants so that DB CRUD can be layered on top
 * without changing the consumer API — just replace the static arrays with
 * a database fetch inside the action layer.
 *
 * Design:
 *  - WorkspaceTopicFamily references a TOPIC_FAMILIES id and adds
 *    workspace-specific overrides (priority, enabled, seedIdeas, avoidTerms).
 *  - promptProfileId corresponds to CHANNEL_PROFILES[].id in prompt-studio-registry.ts.
 *  - channelKey corresponds to ChannelKey in channel-configs.ts.
 */

import { TOPIC_FAMILIES, type TopicFamilyProfile } from "@/lib/prompt-studio-registry";
import type { ContentFormatType } from "@/lib/content-format-type";

// ── Types ─────────────────────────────────────────────────────────────────

export type WorkspaceStatus = "active" | "paused";

export type WorkspaceTopicFamily = {
  /** References TOPIC_FAMILIES[].id in prompt-studio-registry.ts */
  familyId: string;
  priority: "high" | "medium" | "low";
  enabled: boolean;
  avoidTerms?: string[];
  seedIdeas?: string[];
};

/** WorkspaceTopicFamily merged with the matching TopicFamilyProfile fields */
export type ResolvedTopicFamily = WorkspaceTopicFamily & {
  label: string;
  description: string;
  exampleTopics: string[];
};

export type WorkspacePlatformAccount = {
  platform: "youtube" | "facebook";
  /**
   * The platform's own channel/page ID (social_channels.platform_channel_id).
   * Used to find the correct DB credential row regardless of channel_key value.
   * YouTube: UCxxxxxx  |  Facebook: numeric page ID
   */
  platformChannelId: string;
  displayName: string;
};

export type WorkspaceFormatConfig = {
  [K in ContentFormatType]?: boolean;
};

export type WorkspaceFormatMix = {
  ttsShortWeight: number;
  quoteShortWeight: number;
  longWeight: number;
};

export type WorkspaceSchedulePlan = {
  timezone: string;
  /**
   * Primary posting window. For phat_phap this is the video-campaign window (06:00–21:00).
   * Both auto-refill and schedule-mixer inherit this for video-campaign slot calculation.
   */
  postingWindows: Array<{ start: string; end: string }>;
  intervalMinutes: number;
  maxDailyPosts: number;
  platforms: Array<"youtube" | "facebook">;
  /**
   * Window for video campaigns: YouTube Short + Facebook Reel paired at the same slot.
   * Applies to tts_short and legacy_quote_short (both are MP4 video content).
   * When absent, postingWindows[0] is used.
   */
  videoCampaignWindow?: { start: string; end: string };
  /**
   * Window for Facebook-only posts (quote/photo/text — non-video).
   * These posts use a separate calendar and must NOT block or count against video campaign slots.
   * When absent, FB-only posts are not auto-scheduled.
   */
  fbOnlyWindow?: { start: string; end: string };
};

export type ChannelWorkspace = {
  workspaceId: string;
  displayName: string;
  description: string;
  /** References CHANNEL_PROFILES[].id in prompt-studio-registry.ts */
  promptProfileId: string;
  /** References ChannelKey in channel-configs.ts */
  channelKey: string;
  platformAccounts: WorkspacePlatformAccount[];
  topicFamilies: WorkspaceTopicFamily[];
  defaultFormats: WorkspaceFormatConfig;
  formatMix: WorkspaceFormatMix;
  schedulePlan: WorkspaceSchedulePlan;
  status: WorkspaceStatus;
};

// ── Initial workspaces ─────────────────────────────────────────────────────

const WORKSPACES: ChannelWorkspace[] = [
  {
    workspaceId: "buddhist_healing_workspace",
    displayName: "Giới Định Tuệ / Trí Tuệ An Nhiên",
    description: "Kênh Phật pháp và chữa lành. TTS Shorts và Quote Shorts xen kẽ, cả YouTube lẫn Facebook.",
    promptProfileId: "buddhist_healing_v1",
    channelKey: "phat_phap",
    platformAccounts: [
      { platform: "youtube",  platformChannelId: "UCRDTFiA408h3gzo85edXCcw", displayName: "Giới Định Tuệ" },
      { platform: "facebook", platformChannelId: "1044981732043016",          displayName: "Trí Tuệ An Nhiên" },
    ],
    topicFamilies: [
      { familyId: "peace_mindfulness",     priority: "high",   enabled: true },
      { familyId: "letting_go_forgiveness",priority: "high",   enabled: true },
      { familyId: "fear_anxiety",          priority: "medium", enabled: true },
      { familyId: "karma",                 priority: "medium", enabled: true },
      { familyId: "hurt_loneliness",       priority: "medium", enabled: true },
      { familyId: "buddhist_life_wisdom",  priority: "low",    enabled: true },
    ],
    defaultFormats: {
      tts_short: true,
      legacy_quote_short: true,
      long_video: false,
      facebook_quote_photo: false,
    },
    formatMix: { ttsShortWeight: 2, quoteShortWeight: 1, longWeight: 0 },
    schedulePlan: {
      timezone: "Asia/Ho_Chi_Minh",
      // postingWindows[0] = video-campaign window: one paired YT Short + FB Reel per hour.
      // 06:00–21:00 VN → 15 campaign slots per day (06, 07, …, 20).
      postingWindows: [{ start: "06:00", end: "21:00" }],
      videoCampaignWindow: { start: "06:00", end: "21:00" },
      // FB-only posts (quote/photo/text) use a narrower window and are scheduled
      // independently; they must NOT block or count against video campaign slots.
      fbOnlyWindow: { start: "08:00", end: "21:00" },
      intervalMinutes: 60,
      maxDailyPosts: 15,
      platforms: ["youtube", "facebook"],
    },
    status: "active",
  },
  // tang_sau_workspace removed — tang_sau is out of scope (see docs/SCOPE_REDUCTION_AUDIT_2026_06_26.md)
];

// ── Registry API ──────────────────────────────────────────────────────────

export function getChannelWorkspaces(): ChannelWorkspace[] {
  return WORKSPACES;
}

export function getWorkspaceById(workspaceId: string): ChannelWorkspace | null {
  return WORKSPACES.find((w) => w.workspaceId === workspaceId) ?? null;
}

export function getWorkspaceTopicFamiliesResolved(
  workspaceId: string,
): ResolvedTopicFamily[] {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) return [];
  const tfMap = new Map<string, TopicFamilyProfile>(
    TOPIC_FAMILIES.map((tf) => [tf.id, tf]),
  );
  return workspace.topicFamilies
    .filter((wf) => wf.enabled)
    .map((wf) => {
      const tf = tfMap.get(wf.familyId);
      return {
        ...wf,
        label: tf?.label ?? wf.familyId,
        description: tf?.description ?? "",
        exampleTopics: tf?.exampleTopics ?? wf.seedIdeas ?? [],
      };
    });
}

/** Returns the workspace whose promptProfileId matches the given channelProfileId */
export function getWorkspaceByProfileId(channelProfileId: string): ChannelWorkspace | null {
  return WORKSPACES.find((w) => w.promptProfileId === channelProfileId) ?? null;
}

export function getWorkspaceByChannelKey(
  channelKey: string | null | undefined,
): ChannelWorkspace | null {
  if (!channelKey) return null;
  return WORKSPACES.find((w) => w.channelKey === channelKey) ?? null;
}

export function getWorkspaceByPlatformDestination(
  platform: string | null | undefined,
  platformChannelId: string | null | undefined,
): ChannelWorkspace | null {
  if (!platform || !platformChannelId) return null;
  return (
    WORKSPACES.find((w) =>
      w.platformAccounts.some(
        (account) =>
          account.platform === platform && account.platformChannelId === platformChannelId,
      ),
    ) ?? null
  );
}

export function inferWorkspaceFromSignals(input: {
  workspaceId?: string | null;
  channelProfileId?: string | null;
  channelKey?: string | null;
  platform?: string | null;
  platformChannelId?: string | null;
}): ChannelWorkspace | null {
  return (
    (input.workspaceId ? getWorkspaceById(input.workspaceId) : null) ??
    (input.platform && input.platformChannelId
      ? getWorkspaceByPlatformDestination(input.platform, input.platformChannelId)
      : null) ??
    (input.channelKey ? getWorkspaceByChannelKey(input.channelKey) : null) ??
    (input.channelProfileId ? getWorkspaceByProfileId(input.channelProfileId) : null)
  );
}
