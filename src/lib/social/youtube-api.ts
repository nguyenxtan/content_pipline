import { google, youtube_v3 } from "googleapis";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { platformAccounts, socialChannels, youtubeOauthClients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notifyChannelDisconnected } from "@/lib/social/telegram";

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

/** Generate auth URL. If clientConfigId provided, embed it in state so callback knows which client to use. */
export async function getYouTubeAuthUrl(clientConfigId?: number): Promise<string> {
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
    ],
    prompt: "consent",
    state: clientConfigId ? String(clientConfigId) : "",
  });
}

/** Exchange code → tokens, save channel to DB.
 *  Uses clientConfigId to pick correct OAuth credentials and deduplicate per client. */
export async function connectYouTubeChannel(
  code: string,
  clientConfigId?: number,
): Promise<{ channelId: number } | { error: string }> {
  try {
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
    const ch = channelRes.data.items?.[0];
    if (!ch) return { error: "Không lấy được thông tin kênh YouTube" };

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

export async function listYouTubeVideos(
  channelId: number,
  videoIds: string[],
): Promise<YouTubeVideoResource[]> {
  if (videoIds.length === 0) return [];

  const oauth2 = await getFreshOAuth2Client(channelId);
  const yt = google.youtube({ version: "v3", auth: oauth2 });
  const res = await yt.videos.list({
    id: videoIds.slice(0, 50),
    part: ["snippet", "statistics", "contentDetails", "status"],
    maxResults: Math.min(videoIds.length, 50),
  });
  return res.data.items ?? [];
}
