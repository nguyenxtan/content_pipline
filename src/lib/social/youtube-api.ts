import { google, youtube_v3 } from "googleapis";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { platformAccounts, socialChannels, youtubeOauthClients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notifyChannelDisconnected } from "@/lib/social/telegram";
import { DEFAULT_CHANNEL_KEY, normalizeChannelKey, resolveChannelKey } from "@/lib/config/channel-configs";

const REDIRECT_URI =
  process.env.YOUTUBE_REDIRECT_URI ??
  `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/youtube/callback`;

/** Build OAuth2 client — uses stored client credentials if provided, else env vars */
export function getOAuth2Client(clientId?: string | null, clientSecret?: string | null) {
  return new google.auth.OAuth2(
    clientId   ?? process.env.YOUTUBE_CLIENT_ID,
    clientSecret ?? process.env.YOUTUBE_CLIENT_SECRET,
    REDIRECT_URI,
  );
}

type YouTubeAuthState = {
  clientConfigId?: number;
  channelKey?: string;
  targetPlatformChannelId?: string;
};

function encodeYouTubeAuthState(state: YouTubeAuthState): string {
  const params = new URLSearchParams();
  if (state.clientConfigId) params.set("clientConfigId", String(state.clientConfigId));
  if (state.channelKey) params.set("channelKey", state.channelKey);
  if (state.targetPlatformChannelId) {
    params.set("targetPlatformChannelId", state.targetPlatformChannelId.trim());
  }
  return params.toString();
}

export function decodeYouTubeAuthState(raw: string | null): YouTubeAuthState {
  if (!raw) return {};
  if (/^\d+$/.test(raw)) {
    return { clientConfigId: Number(raw) || undefined };
  }
  const params = new URLSearchParams(raw);
  const clientConfigId = params.get("clientConfigId");
  const channelKey = normalizeChannelKey(params.get("channelKey")) ?? undefined;
  const targetPlatformChannelId = params.get("targetPlatformChannelId")?.trim() || undefined;
  return {
    clientConfigId: clientConfigId ? Number(clientConfigId) || undefined : undefined,
    channelKey,
    targetPlatformChannelId,
  };
}

/** Generate auth URL. If clientConfigId provided, embed it in state so callback knows which client to use. */
export async function getYouTubeAuthUrl(
  clientConfigId?: number,
  channelKey?: string,
  targetPlatformChannelId?: string,
): Promise<string> {
  let clientId: string | null = null;
  let clientSecret: string | null = null;

  if (clientConfigId) {
    const cfg = await db.query.youtubeOauthClients.findFirst({
      where: eq(youtubeOauthClients.id, clientConfigId),
    });
    if (cfg) { clientId = cfg.clientId; clientSecret = cfg.clientSecret; }
  }

  const oauth2 = getOAuth2Client(clientId, clientSecret);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    prompt: "consent",
    state: encodeYouTubeAuthState({
      clientConfigId,
      channelKey: normalizeChannelKey(channelKey) ?? DEFAULT_CHANNEL_KEY,
      targetPlatformChannelId,
    }),
  });
}

/** Exchange code → tokens, save channel to DB.
 *  Uses clientConfigId to pick correct OAuth credentials and deduplicate per client. */
export async function connectYouTubeChannel(
  code: string,
  clientConfigId?: number,
  channelKey?: string,
  targetPlatformChannelId?: string,
): Promise<{ channelId: number } | { error: string }> {
  try {
    const resolvedChannelKey = resolveChannelKey(channelKey);
    const expectedPlatformChannelId = targetPlatformChannelId?.trim() || null;
    let clientId: string | null = null;
    let clientSecret: string | null = null;

    if (clientConfigId) {
      const cfg = await db.query.youtubeOauthClients.findFirst({
        where: eq(youtubeOauthClients.id, clientConfigId),
      });
      if (cfg) { clientId = cfg.clientId; clientSecret = cfg.clientSecret; }
    }

    const oauth2 = getOAuth2Client(clientId, clientSecret);
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    const yt = google.youtube({ version: "v3", auth: oauth2 });
    const channelRes = await yt.channels.list({ part: ["snippet"], mine: true });
    const candidates = channelRes.data.items ?? [];
    const ch = expectedPlatformChannelId
      ? candidates.find((item) => item.id === expectedPlatformChannelId)
      : candidates.length === 1
        ? candidates[0]
        : null;
    if (!expectedPlatformChannelId && candidates.length > 1) {
      return {
        error: "Google account này có nhiều kênh YouTube. Hãy nhập đúng YouTube Channel ID để kết nối an toàn.",
      };
    }
    if (expectedPlatformChannelId && !ch) {
      return {
        error: `Không tìm thấy YouTube channel ID "${expectedPlatformChannelId}" trong tài khoản Google vừa cấp quyền.`,
      };
    }
    if (!ch) return { error: "Không lấy được thông tin kênh YouTube" };

    const ownershipConflict = await db.query.socialChannels.findFirst({
      where: (t, { and, eq: e, ne }) =>
        and(
          e(t.platform, "youtube"),
          e(t.platformChannelId, ch.id ?? ""),
          ne(t.channelKey, resolvedChannelKey),
        ),
    });
    if (ownershipConflict) {
      return {
        error: `YouTube channel "${ch.snippet?.title ?? ch.id ?? "unknown"}" đã được gán cho channelKey "${ownershipConflict.channelKey}".`,
      };
    }

    let account = await db.query.platformAccounts.findFirst({
      where: (t, { and, eq: e }) =>
        and(e(t.platform, "youtube"), e(t.platformAccountId, ch.id ?? "")),
    });
    if (!account) {
      const [created] = await db.insert(platformAccounts).values({
        platform: "youtube",
        platformAccountId: ch.id ?? "",
        displayName: ch.snippet?.title ?? "YouTube Channel",
        handle: ch.snippet?.customUrl ?? null,
        thumbnailUrl: ch.snippet?.thumbnails?.default?.url ?? null,
        isActive: true,
        updatedAt: new Date(),
      }).returning();
      account = created;
    } else {
      const [updated] = await db.update(platformAccounts).set({
        displayName: ch.snippet?.title ?? account.displayName,
        handle: ch.snippet?.customUrl ?? account.handle,
        thumbnailUrl: ch.snippet?.thumbnails?.default?.url ?? account.thumbnailUrl,
        isActive: true,
        updatedAt: new Date(),
      }).where(eq(platformAccounts.id, account.id)).returning();
      account = updated;
    }

    // Deduplicate: one DB row per (platformChannelId, oauthClientConfigId)
    const existing = await db.query.socialChannels.findFirst({
      where: (t, { and, eq: e, isNull }) =>
        and(
          e(t.platform, "youtube"),
          e(t.platformChannelId, ch.id ?? ""),
          clientConfigId
            ? e(t.oauthClientConfigId, clientConfigId)
            : isNull(t.oauthClientConfigId),
        ),
    });

    const channelData = {
      platform: "youtube" as const,
      channelKey: resolvedChannelKey,
      name: ch.snippet?.title ?? "YouTube Channel",
      platformChannelId: ch.id ?? "",
      platformHandle: ch.snippet?.customUrl ?? null,
      thumbnailUrl: ch.snippet?.thumbnails?.default?.url ?? null,
      platformAccountId: account.id,
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
      oauthClientConfigId: clientConfigId ?? null,
      isActive: true,
      needsReconnect: false,
      quotaExceededUntil: null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(socialChannels).set(channelData).where(eq(socialChannels.id, existing.id));
      return { channelId: existing.id };
    }

    const [row] = await db.insert(socialChannels).values(channelData).returning({ id: socialChannels.id });
    return { channelId: row.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "OAuth error" };
  }
}

export function isTokenRevokedError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("invalid_grant") || msg.includes("token has been expired or revoked");
}

export function isQuotaExceededError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes("quotaexceeded") ||
    msg.includes("quota exceeded") ||
    msg.includes("dailylimitexceeded") ||
    msg.includes("daily limit exceeded") ||
    msg.includes("uploadlimitexceeded") ||
    msg.includes("video uploads per day") ||
    msg.includes("user rate limit exceeded") ||
    msg.includes("ratelimitexceeded")
  ) return true;
  // Also check structured gaxios error reason (when err is the raw exception, not yet stringified)
  type GaxiosLike = { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } };
  const reason = ((err as GaxiosLike)?.response?.data?.error?.errors?.[0]?.reason ?? "").toLowerCase();
  return reason.includes("quotaexceeded") || reason.includes("dailylimit") ||
         reason.includes("uploadlimit") || reason.includes("ratelimit");
}

export function isAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("unauthorized") || msg.includes("invalid_token") ||
         msg.includes("authorizationerror") ||
         (msg.includes("401") && !msg.includes("quota"));
}

export function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout") ||
    msg.includes("socket hang up") || msg.includes("network error") || msg.includes("fetch failed") ||
    msg.includes("connection reset") || msg.includes("request timeout") ||
    msg.includes("service unavailable") ||
    (msg.includes("503") && !msg.includes("quota")) ||
    (msg.includes("502") && !msg.includes("quota")) ||
    (msg.includes("500") && !msg.includes("quota") && !msg.includes("invalid"))
  );
}

/** Next YouTube quota reset: midnight Pacific (07:00 UTC) + 1h buffer = 08:00 UTC */
export function nextQuotaResetUtc(): Date {
  const now = new Date();
  const reset = new Date(now);
  reset.setUTCHours(8, 0, 0, 0);
  if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

/** Pacific midnight in UTC (quota resets here) */
export function pacificMidnightUtc(): Date {
  const now = new Date();
  const reset = new Date(now);
  reset.setUTCHours(7, 0, 0, 0);
  if (reset > now) reset.setUTCDate(reset.getUTCDate() - 1);
  return reset;
}

/** Refresh OAuth token if needed. Reads client credentials from DB per channel. */
async function hasHealthyAlternateYouTubeCredential(
  currentChannelId: number,
  platformChannelId: string | null,
): Promise<boolean> {
  if (!platformChannelId) return false;
  const rows = await db.query.socialChannels.findMany({
    where: (t, { and: a, eq: e, ne: neq }) => a(
      e(t.platform, "youtube"),
      e(t.platformChannelId, platformChannelId),
      neq(t.id, currentChannelId),
      e(t.isActive, true),
    ),
  });
  return rows.some((row) => !!row.accessToken && !row.needsReconnect);
}

export async function getFreshOAuth2Client(channelId: number) {
  const ch = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, channelId),
    with: { oauthClient: true },
  });
  if (!ch || !ch.accessToken) throw new Error("Kênh không có access token");

  const clientId     = ch.oauthClient?.clientId     ?? process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = ch.oauthClient?.clientSecret ?? process.env.YOUTUBE_CLIENT_SECRET;

  const oauth2 = getOAuth2Client(clientId, clientSecret);
  oauth2.setCredentials({
    access_token:  ch.accessToken,
    refresh_token: ch.refreshToken ?? undefined,
    expiry_date:   ch.tokenExpiresAt ? ch.tokenExpiresAt.getTime() : undefined,
  });

  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring = ch.tokenExpiresAt && (ch.tokenExpiresAt.getTime() - Date.now()) < fiveMinutes;
  if (isExpiring && ch.refreshToken) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      await db.update(socialChannels).set({
        accessToken:    credentials.access_token ?? ch.accessToken,
        tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : ch.tokenExpiresAt,
        needsReconnect: false,
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(socialChannels.id, channelId));
    } catch (err) {
      if (isTokenRevokedError(err)) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await db.update(socialChannels).set({
          needsReconnect: true,
          lastError: errorMsg.slice(0, 500),
          updatedAt: new Date(),
        }).where(eq(socialChannels.id, channelId));
        const hasAlt = await hasHealthyAlternateYouTubeCredential(
          channelId,
          ch.platformChannelId ?? null,
        );
        if (!hasAlt) {
          await notifyChannelDisconnected(ch.name, errorMsg);
        }
      }
      throw err;
    }
  }

  return oauth2;
}

export type YouTubeUploadParams = {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "public" | "private" | "unlisted";
  madeForKids?: boolean;
  thumbnailPath?: string;
};

export type YouTubeUploadResult =
  | { success: true; videoId: string; videoUrl: string }
  | { success: false; error: string };

export type YouTubeVideoResource = youtube_v3.Schema$Video;
export type YouTubeChannelUploadItem = {
  videoId: string;
  title: string | null;
  publishedAt: string | null;
};

export type YouTubeUploadDestinationVerification =
  | {
      ok: true;
      channelId: number;
      destinationChannelId: string;
      destinationChannelName: string;
      oauthCredentialIdentity: string;
      oauthClientConfigId: number | null;
      candidateCount: number;
      accessibleChannelIds: string[];
    }
  | {
      ok: false;
      error: string;
      oauthCredentialIdentity: string | null;
      destinationChannelId: string | null;
      destinationChannelName: string | null;
      oauthClientConfigId: number | null;
      candidateCount: number;
      accessibleChannelIds: string[];
    };

function buildSafeCredentialIdentity(channel: {
  id: number;
  oauthClientConfigId: number | null;
  refreshToken: string | null;
  accessToken: string | null;
}): string {
  const tokenSource = channel.refreshToken ?? channel.accessToken ?? "";
  const tokenFingerprint = tokenSource
    ? crypto.createHash("sha256").update(tokenSource).digest("hex").slice(0, 8)
    : "none";
  const clientLabel = channel.oauthClientConfigId == null
    ? "env-default"
    : `oauth-client-${channel.oauthClientConfigId}`;
  return `${clientLabel}/token:${tokenFingerprint}`;
}

export async function uploadToYouTube(
  channelId: number,
  params: YouTubeUploadParams,
): Promise<YouTubeUploadResult> {
  const absPath = params.videoPath.startsWith("/")
    ? params.videoPath
    : path.join(process.cwd(), params.videoPath);

  if (!fs.existsSync(absPath)) {
    return { success: false, error: `Video file không tồn tại: ${absPath}` };
  }

  try {
    const oauth2 = await getFreshOAuth2Client(channelId);
    const yt = google.youtube({ version: "v3", auth: oauth2 });

    const res = await yt.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: params.title.slice(0, 100),
          description: params.description.slice(0, 5000),
          tags: params.tags.slice(0, 500),
          categoryId: "22",
        },
        status: {
          privacyStatus: params.privacyStatus,
          madeForKids: params.madeForKids ?? false,
        },
      },
      media: { body: fs.createReadStream(absPath) },
    });

    const videoId = res.data.id;
    if (!videoId) return { success: false, error: "YouTube không trả về video ID" };

    if (params.thumbnailPath) {
      const absThumbnail = params.thumbnailPath.startsWith("/")
        ? params.thumbnailPath
        : path.join(process.cwd(), params.thumbnailPath);
      if (fs.existsSync(absThumbnail)) {
        try {
          await yt.thumbnails.set({
            videoId,
            media: { mimeType: "image/jpeg", body: fs.createReadStream(absThumbnail) },
          });
        } catch { /* non-fatal */ }
      }
    }

    return { success: true, videoId, videoUrl: `https://www.youtube.com/watch?v=${videoId}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Embed structured gaxios reason so string-based checks work after catch
    type GaxiosLike = { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } };
    const reason = (err as GaxiosLike)?.response?.data?.error?.errors?.[0]?.reason;
    const fullMsg = reason ? `${msg} [reason: ${reason}]` : msg;

    if (isTokenRevokedError(err)) {
      await db.update(socialChannels).set({
        needsReconnect: true,
        lastError: fullMsg.slice(0, 500),
        updatedAt: new Date(),
      }).where(eq(socialChannels.id, channelId));
      const ch = await db.query.socialChannels.findFirst({ where: eq(socialChannels.id, channelId) });
      if (ch) {
        const hasAlt = await hasHealthyAlternateYouTubeCredential(
          channelId,
          ch.platformChannelId ?? null,
        );
        if (!hasAlt) await notifyChannelDisconnected(ch.name, fullMsg);
      }
    }
    return { success: false, error: fullMsg.slice(0, 500) };
  }
}

export async function verifyYouTubeUploadDestination(
  channelId: number,
): Promise<YouTubeUploadDestinationVerification> {
  const credential = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, channelId),
  });
  if (!credential) {
    return {
      ok: false,
      error: "youtube_destination_missing",
      oauthCredentialIdentity: null,
      destinationChannelId: null,
      destinationChannelName: null,
      oauthClientConfigId: null,
      candidateCount: 0,
      accessibleChannelIds: [],
    };
  }

  const oauthCredentialIdentity = buildSafeCredentialIdentity(credential);
  if (credential.platform !== "youtube") {
    return {
      ok: false,
      error: "youtube_destination_platform_mismatch",
      oauthCredentialIdentity,
      destinationChannelId: credential.platformChannelId ?? null,
      destinationChannelName: credential.name,
      oauthClientConfigId: credential.oauthClientConfigId ?? null,
      candidateCount: 0,
      accessibleChannelIds: [],
    };
  }
  if (!credential.platformChannelId) {
    return {
      ok: false,
      error: "youtube_destination_channel_id_missing",
      oauthCredentialIdentity,
      destinationChannelId: null,
      destinationChannelName: credential.name,
      oauthClientConfigId: credential.oauthClientConfigId ?? null,
      candidateCount: 0,
      accessibleChannelIds: [],
    };
  }
  if (!credential.accessToken && !credential.refreshToken) {
    return {
      ok: false,
      error: "youtube_destination_credential_missing",
      oauthCredentialIdentity,
      destinationChannelId: credential.platformChannelId,
      destinationChannelName: credential.name,
      oauthClientConfigId: credential.oauthClientConfigId ?? null,
      candidateCount: 0,
      accessibleChannelIds: [],
    };
  }

  try {
    const oauth2 = await getFreshOAuth2Client(channelId);
    const yt = google.youtube({ version: "v3", auth: oauth2 });
    const channelRes = await yt.channels.list({
      part: ["id", "snippet"],
      mine: true,
      maxResults: 50,
    });
    const candidates = channelRes.data.items ?? [];
    const accessibleChannelIds = candidates
      .map((item) => item.id ?? null)
      .filter((value): value is string => Boolean(value));
    const matched = candidates.find((item) => item.id === credential.platformChannelId);
    if (!matched) {
      return {
        ok: false,
        error: "youtube_destination_not_accessible_for_credential",
        oauthCredentialIdentity,
        destinationChannelId: credential.platformChannelId,
        destinationChannelName: credential.name,
        oauthClientConfigId: credential.oauthClientConfigId ?? null,
        candidateCount: candidates.length,
        accessibleChannelIds,
      };
    }

    return {
      ok: true,
      channelId,
      destinationChannelId: credential.platformChannelId,
      destinationChannelName: matched.snippet?.title ?? credential.name,
      oauthCredentialIdentity,
      oauthClientConfigId: credential.oauthClientConfigId ?? null,
      candidateCount: candidates.length,
      accessibleChannelIds,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
      oauthCredentialIdentity,
      destinationChannelId: credential.platformChannelId,
      destinationChannelName: credential.name,
      oauthClientConfigId: credential.oauthClientConfigId ?? null,
      candidateCount: 0,
      accessibleChannelIds: [],
    };
  }
}

export type YouTubeMetadataUpdateParams = {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
};

export type YouTubeMetadataUpdateResult = { success: true } | { success: false; error: string };

/**
 * Updates only snippet fields (title/description/tags) on an existing
 * video. Does not touch status (privacyStatus/madeForKids) unless the
 * caller also passes a privacyStatus override — most callers should not.
 */
export async function updateYouTubeVideoMetadata(
  channelId: number,
  params: YouTubeMetadataUpdateParams & { privacyStatus?: "public" | "private" | "unlisted" },
): Promise<YouTubeMetadataUpdateResult> {
  try {
    const oauth2 = await getFreshOAuth2Client(channelId);
    const yt = google.youtube({ version: "v3", auth: oauth2 });

    const current = await yt.videos.list({ id: [params.videoId], part: ["snippet", "status"] });
    const existing = current.data.items?.[0];
    if (!existing?.snippet) return { success: false, error: "Video not found" };

    const parts = ["snippet"];
    const requestBody: youtube_v3.Schema$Video = {
      id: params.videoId,
      snippet: {
        title: params.title.slice(0, 100),
        description: params.description.slice(0, 5000),
        tags: params.tags.slice(0, 500),
        categoryId: existing.snippet.categoryId,
      },
    };

    if (params.privacyStatus) {
      parts.push("status");
      requestBody.status = {
        privacyStatus: params.privacyStatus,
        madeForKids: existing.status?.madeForKids ?? false,
      };
    }

    await yt.videos.update({ part: parts, requestBody });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg.slice(0, 500) };
  }
}

export async function listYouTubeVideos(
  channelId: number,
  videoIds: string[],
): Promise<YouTubeVideoResource[]> {
  if (videoIds.length === 0) return [];

  const oauth2 = await getFreshOAuth2Client(channelId);
  const yt = google.youtube({ version: "v3", auth: oauth2 });
  const items: YouTubeVideoResource[] = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await yt.videos.list({
      id: batch,
      part: ["snippet", "statistics", "contentDetails", "status"],
      maxResults: batch.length,
    });
    items.push(...(res.data.items ?? []));
  }

  return items;
}

export async function listYouTubeChannelUploads(
  channelId: number,
  input?: {
    since?: Date;
    maxPages?: number;
  },
): Promise<{
  channelId: string | null;
  channelTitle: string | null;
  uploadsPlaylistId: string | null;
  items: YouTubeChannelUploadItem[];
}> {
  const oauth2 = await getFreshOAuth2Client(channelId);
  const yt = google.youtube({ version: "v3", auth: oauth2 });
  const credential = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, channelId),
  });

  const channelRes = await yt.channels.list({
    part: ["contentDetails", "snippet"],
    ...(credential?.platformChannelId
      ? { id: [credential.platformChannelId] }
      : { mine: true }),
    maxResults: 1,
  });
  const channel = channelRes.data.items?.[0] ?? null;
  const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads ?? null;
  if (!uploadsPlaylistId) {
    return {
      channelId: channel?.id ?? credential?.platformChannelId ?? null,
      channelTitle: channel?.snippet?.title ?? credential?.name ?? null,
      uploadsPlaylistId: null,
      items: [],
    };
  }

  const items: YouTubeChannelUploadItem[] = [];
  let pageToken: string | undefined;
  let page = 0;
  const maxPages = Math.max(1, Math.min(input?.maxPages ?? 200, 500));
  const sinceMs = input?.since?.getTime() ?? null;

  do {
    const res = await yt.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: ["contentDetails", "snippet"],
      maxResults: 50,
      pageToken,
    });
    const pageItems = res.data.items ?? [];
    let pageHadAnySince = false;

    for (const item of pageItems) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId ?? null;
      if (!videoId) continue;
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null;
      const publishedMs = publishedAt ? new Date(publishedAt).getTime() : null;
      const isSince = sinceMs === null || publishedMs === null || publishedMs >= sinceMs;
      if (isSince) {
        pageHadAnySince = true;
        items.push({
          videoId,
          title: item.snippet?.title ?? null,
          publishedAt,
        });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
    page++;
    if (sinceMs !== null && pageItems.length > 0 && !pageHadAnySince) {
      break;
    }
  } while (pageToken && page < maxPages);

  return {
    channelId: channel?.id ?? credential?.platformChannelId ?? null,
    channelTitle: channel?.snippet?.title ?? credential?.name ?? null,
    uploadsPlaylistId,
    items,
  };
}

export type YouTubeAnalyticsMetrics = {
  ctr: number | null;
  avgViewDurationSec: number | null;
  retentionPct: number | null;
  impressions: number | null;
  // Phase A additions
  shareCount: number | null;
  estimatedMinutesWatched: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
};

/**
 * Fetch per-video watch-time / retention metrics from YouTube Analytics API v2.
 *
 * Returns an empty Map (no throw) when the token lacks yt-analytics.readonly scope (403).
 * Caller must check if the Map is empty and skip the analytics update gracefully.
 *
 * Column-header order is NOT guaranteed by the API; parsing is always by name.
 *
 * Note:
 * The current public YouTube Analytics v2 metrics reference exposes
 * `averageViewDuration` and `averageViewPercentage` for channel/video reports,
 * but not thumbnail impressions / thumbnail CTR metrics for this scope.
 * Keep `ctr` and `impressions` null unless Google exposes a supported metric here.
 */
export async function fetchYouTubeAnalyticsMetrics(
  channelId: number,
  videoIds: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, YouTubeAnalyticsMetrics>> {
  if (videoIds.length === 0) return new Map();

  const oauth2 = await getFreshOAuth2Client(channelId);
  const analyticsClient = google.youtubeAnalytics({ version: "v2", auth: oauth2 });

  const BATCH_SIZE = 40;
  const result = new Map<string, YouTubeAnalyticsMetrics>();

  // Phase A: extended metrics. Falls back to baseline on INVALID_ARGUMENT (400).
  // `engagedViews` is not a valid Analytics API metric — omitted intentionally.
  const EXTENDED_METRICS = "averageViewDuration,averageViewPercentage,shares,estimatedMinutesWatched,subscribersGained,subscribersLost";
  const BASELINE_METRICS = "averageViewDuration,averageViewPercentage";

  for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
    const batch = videoIds.slice(i, i + BATCH_SIZE);

    let res;
    let useExtended = true;
    try {
      res = await analyticsClient.reports.query({
        ids: "channel==MINE",
        startDate,
        endDate,
        dimensions: "video",
        metrics: EXTENDED_METRICS,
        filters: `video==${batch.join(",")}`,
      });
    } catch (extErr) {
      type GaxiosLike = { response?: { status?: number; data?: { error?: { status?: string } } } };
      const gaxExt = extErr as GaxiosLike;
      const extHttpStatus = gaxExt?.response?.status;
      const extErrStatus = (gaxExt?.response?.data?.error?.status ?? "").toLowerCase();
      const extErrMsg = String(extErr).toLowerCase();

      if (extHttpStatus === 403 || extErrStatus.includes("permission_denied") || extErrMsg.includes("insufficientpermissions")) {
        console.warn(`[analytics] channel ${channelId} missing yt-analytics.readonly scope — re-authorization required`);
        return new Map();
      }

      if (extHttpStatus === 400 || extErrStatus.includes("invalid_argument") || extErrMsg.includes("invalid metric")) {
        // Phase A metrics not supported for this scope — fall back to baseline
        console.warn(`[analytics] channel ${channelId} Phase A metrics rejected, falling back to baseline`);
        useExtended = false;
        try {
          res = await analyticsClient.reports.query({
            ids: "channel==MINE",
            startDate,
            endDate,
            dimensions: "video",
            metrics: BASELINE_METRICS,
            filters: `video==${batch.join(",")}`,
          });
        } catch (baseErr) {
          const gaxBase = baseErr as GaxiosLike;
          if ((gaxBase?.response?.status) === 403) {
            console.warn(`[analytics] channel ${channelId} missing yt-analytics.readonly scope`);
            return new Map();
          }
          throw baseErr;
        }
      } else {
        throw extErr;
      }
    }

    const headers = res.data.columnHeaders ?? [];
    const rows = res.data.rows ?? [];

    const colIdx = (name: string) => headers.findIndex((h) => h.name === name);
    const videoIdx          = colIdx("video");
    const durationIdx       = colIdx("averageViewDuration");
    const retentionIdx      = colIdx("averageViewPercentage");
    const sharesIdx         = colIdx("shares");
    const minutesIdx        = colIdx("estimatedMinutesWatched");
    const subsGainedIdx     = colIdx("subscribersGained");
    const subsLostIdx       = colIdx("subscribersLost");

    for (const row of rows) {
      if (!Array.isArray(row) || videoIdx === -1) continue;
      const videoId = String(row[videoIdx]);

      const durationRaw  = durationIdx  !== -1 ? row[durationIdx]  : null;
      const retentionRaw = retentionIdx !== -1 ? row[retentionIdx] : null;
      const sharesRaw    = useExtended && sharesIdx     !== -1 ? row[sharesIdx]     : null;
      const minutesRaw   = useExtended && minutesIdx    !== -1 ? row[minutesIdx]    : null;
      const subGainRaw   = useExtended && subsGainedIdx !== -1 ? row[subsGainedIdx] : null;
      const subLostRaw   = useExtended && subsLostIdx   !== -1 ? row[subsLostIdx]   : null;

      result.set(videoId, {
        ctr: null,
        impressions: null,
        avgViewDurationSec: typeof durationRaw  === "number" && durationRaw  > 0 ? Math.round(durationRaw) : null,
        retentionPct:       typeof retentionRaw === "number" && retentionRaw > 0 ? retentionRaw : null,
        shareCount:         typeof sharesRaw    === "number" && sharesRaw    >= 0 ? Math.round(sharesRaw) : null,
        estimatedMinutesWatched: typeof minutesRaw  === "number" && minutesRaw  > 0 ? Math.round(minutesRaw) : null,
        subscribersGained:  typeof subGainRaw   === "number" ? Math.round(subGainRaw) : null,
        subscribersLost:    typeof subLostRaw   === "number" ? Math.round(subLostRaw) : null,
      });
    }
  }

  return result;
}
