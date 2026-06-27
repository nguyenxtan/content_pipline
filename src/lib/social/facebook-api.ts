import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { socialChannels } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { notifyFacebookPageDisconnected } from "@/lib/social/telegram";
import { buildSafeFacebookCaption } from "@/lib/social/youtube-metadata";
import { DEFAULT_CHANNEL_KEY, normalizeChannelKey, resolveChannelKey } from "@/lib/config/channel-configs";

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION ?? "v25.0";
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

export function isFacebookAuthError(message: string): boolean {
  return /access token|session has expired|invalid oauth|error validating access token|permissions? error|missing permissions?/i.test(message);
}

export function isFacebookRateLimitError(message: string): boolean {
  return /rate limit|request limit|too many calls|user request limit reached|application request limit reached/i.test(message);
}

export function isFacebookTransientError(message: string): boolean {
  return /temporarily unavailable|try again later|timed out|timeout|internal error|please reduce the amount of data/i.test(message);
}

function graphUrl(endpoint: string, params?: Record<string, string>) {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/${endpoint.replace(/^\//, "")}`,
  );
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json.error) {
    const msg = json?.error?.message ?? text ?? `Facebook API error ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

type PagingResponse<T> = {
  data: T[];
  paging?: { next?: string };
};

// ─── Env-based page config ─────────────────────────────────────────────────

export function hasFacebookEnvConfig(): boolean {
  return !!(PAGE_ID && PAGE_ACCESS_TOKEN);
}

export function hasFacebookAppConfig(): boolean {
  return !!(APP_ID && APP_SECRET);
}

async function getStoredFacebookChannelByPageId(
  pageId: string,
  channelKey: string = DEFAULT_CHANNEL_KEY,
) {
  return db.query.socialChannels.findFirst({
    where: and(
      eq(socialChannels.platform, "facebook"),
      eq(socialChannels.platformChannelId, pageId),
      eq(socialChannels.channelKey, channelKey),
    ),
  });
}

async function resolveFacebookPageToken(pageId: string): Promise<string | null> {
  if (PAGE_ACCESS_TOKEN) return PAGE_ACCESS_TOKEN;
  const stored = await getStoredFacebookChannelByPageId(pageId, DEFAULT_CHANNEL_KEY);
  if (stored?.accessToken) return stored.accessToken;
  return null;
}

export type FacebookEnvHealth =
  | {
      ok: true;
      pageId: string;
      pageName: string;
      needsReconnect: false;
      message: string;
      channelId?: number;
    }
  | {
      ok: false;
      pageId: string | null;
      pageName: null;
      needsReconnect: boolean;
      message: string;
      channelId?: number;
    };

/** Verify FACEBOOK_PAGE_ACCESS_TOKEN bằng cách gọi GET /{PAGE_ID}?fields=id,name */
export async function verifyFacebookEnvToken(): Promise<
  { id: string; name: string } | { error: string }
> {
  if (!PAGE_ID) {
    return { error: "Chưa cấu hình FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN trong .env.local" };
  }
  const resolvedToken = await resolveFacebookPageToken(PAGE_ID);
  if (!resolvedToken) {
    return { error: "Chưa cấu hình Facebook Page token" };
  }
  try {
    const page = await fetchJson<{ id: string; name: string }>(
      graphUrl(PAGE_ID, { access_token: resolvedToken, fields: "id,name" }),
    );
    if (!page?.id) return { error: "Facebook API không trả về page info" };
    return page;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Facebook API error" };
  }
}

/** Verify token rồi upsert page vào socialChannels — tạo/cập nhật channel entry để upload queue dùng */
export async function syncFacebookEnvPageToDb(): Promise<
  { channelId: number; name: string; pageId: string } | { error: string }
> {
  const info = await verifyFacebookEnvToken();
  if ("error" in info) return info;

  const ownershipConflict = await db.query.socialChannels.findFirst({
    where: and(
      eq(socialChannels.platform, "facebook"),
      eq(socialChannels.platformChannelId, info.id),
    ),
  });
  if (ownershipConflict && normalizeChannelKey(ownershipConflict.channelKey) !== DEFAULT_CHANNEL_KEY) {
    return {
      error: `Facebook Page "${info.name}" đã được gán cho channelKey "${ownershipConflict.channelKey}", không thể sync vào Phật Pháp env fallback.`,
    };
  }

  const existing = await db.query.socialChannels.findFirst({
    where: and(
      eq(socialChannels.platform, "facebook"),
      eq(socialChannels.platformChannelId, info.id),
      eq(socialChannels.channelKey, DEFAULT_CHANNEL_KEY),
    ),
  });

  const data = {
    platform: "facebook" as const,
    channelKey: DEFAULT_CHANNEL_KEY,
    name: info.name,
    platformChannelId: info.id,
    platformHandle: null,
    thumbnailUrl: null,
    platformAccountId: null,
    accessToken: await resolveFacebookPageToken(info.id) ?? PAGE_ACCESS_TOKEN!,
    refreshToken: null,
    tokenExpiresAt: null,
    scope: null,
    isActive: true,
    needsReconnect: false,
    quotaExceededUntil: null,
    lastError: null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(socialChannels).set(data).where(eq(socialChannels.id, existing.id));
    return { channelId: existing.id, name: info.name, pageId: info.id };
  }

  const [row] = await db.insert(socialChannels).values(data).returning();
  return { channelId: row.id, name: info.name, pageId: info.id };
}

export async function refreshFacebookEnvHealth(): Promise<FacebookEnvHealth> {
  if (!PAGE_ID) {
    return {
      ok: false,
      pageId: PAGE_ID ?? null,
      pageName: null,
      needsReconnect: true,
      message: "Chưa cấu hình FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN",
    };
  }

  const info = await verifyFacebookEnvToken();
  if ("error" in info) {
    const existing = await db.query.socialChannels.findFirst({
      where: and(
        eq(socialChannels.platform, "facebook"),
        eq(socialChannels.platformChannelId, PAGE_ID),
        eq(socialChannels.channelKey, DEFAULT_CHANNEL_KEY),
      ),
    });
    if (existing) {
      const nextNeedsReconnect = isFacebookAuthError(info.error);
      await db.update(socialChannels).set({
        needsReconnect: nextNeedsReconnect,
        lastError: info.error.slice(0, 500),
        updatedAt: new Date(),
      }).where(eq(socialChannels.id, existing.id));
      if (nextNeedsReconnect && !existing.needsReconnect) {
        await notifyFacebookPageDisconnected(existing.name, info.error).catch(() => null);
      }
    }
    return {
      ok: false,
      pageId: PAGE_ID,
      pageName: null,
      needsReconnect: isFacebookAuthError(info.error),
      message: info.error,
      channelId: existing?.id,
    };
  }

  const synced = await syncFacebookEnvPageToDb();
  if ("error" in synced) {
    return {
      ok: false,
      pageId: info.id,
      pageName: null,
      needsReconnect: true,
      message: synced.error,
    };
  }

  return {
    ok: true,
    pageId: info.id,
    pageName: info.name,
    needsReconnect: false,
    message: "Facebook Page token hợp lệ",
    channelId: synced.channelId,
  };
}

type FacebookAccountsResponse = {
  data: Array<{
    id: string;
    name: string;
    access_token?: string;
    tasks?: string[];
  }>;
};

export type FacebookTokenRotationResult =
  | {
      ok: true;
      channelId: number;
      pageId: string;
      pageName: string;
      tokenSource: "page";
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function rotateFacebookPageToken(userAccessToken: string): Promise<FacebookTokenRotationResult> {
  if (!PAGE_ID) {
    return { ok: false, error: "Chưa cấu hình FACEBOOK_PAGE_ID" };
  }

  const trimmed = userAccessToken.trim();
  if (!trimmed) {
    return { ok: false, error: "Thiếu user access token" };
  }

  try {
    try {
      const directPage = await fetchJson<{ id: string; name: string }>(
        graphUrl("me", {
          access_token: trimmed,
          fields: "id,name",
        }),
      );
      if (directPage.id === PAGE_ID) {
        const existing = await getStoredFacebookChannelByPageId(directPage.id, DEFAULT_CHANNEL_KEY);
        const data = {
          platform: "facebook" as const,
          channelKey: DEFAULT_CHANNEL_KEY,
          name: directPage.name,
          platformChannelId: directPage.id,
          platformHandle: null,
          thumbnailUrl: null,
          platformAccountId: existing?.platformAccountId ?? null,
          accessToken: trimmed,
          refreshToken: null,
          tokenExpiresAt: null,
          scope: "page_token_direct",
          isActive: true,
          needsReconnect: false,
          quotaExceededUntil: null,
          lastError: null,
          updatedAt: new Date(),
        };
        let channelId = existing?.id;
        if (existing) {
          await db.update(socialChannels).set(data).where(eq(socialChannels.id, existing.id));
        } else {
          const [created] = await db.insert(socialChannels).values(data).returning({ id: socialChannels.id });
          channelId = created.id;
        }
        return {
          ok: true,
          channelId: channelId!,
          pageId: directPage.id,
          pageName: directPage.name,
          tokenSource: "page",
          message: "Đã nhận và lưu trực tiếp page access token.",
        };
      }
    } catch {
      // not a direct page token; continue with user-token exchange flow
    }

    if (!APP_ID || !APP_SECRET) {
      return { ok: false, error: "Chưa cấu hình FACEBOOK_APP_ID / FACEBOOK_APP_SECRET" };
    }

    const exchange = await fetchJson<{ access_token: string; expires_in?: number }>(
      graphUrl("oauth/access_token", {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: trimmed,
      }),
    );

    const accounts = await fetchJson<FacebookAccountsResponse>(
      graphUrl("me/accounts", {
        access_token: exchange.access_token,
        fields: "id,name,access_token,tasks",
      }),
    );

    const page = accounts.data.find((row) => row.id === PAGE_ID);
    if (!page?.access_token) {
      return { ok: false, error: `Không tìm thấy Page ${PAGE_ID} trong /me/accounts hoặc token không có quyền truy cập Page` };
    }

    const existing = await getStoredFacebookChannelByPageId(page.id, DEFAULT_CHANNEL_KEY);
    const tokenExpiresAt = exchange.expires_in
      ? new Date(Date.now() + exchange.expires_in * 1000)
      : null;
    const data = {
      platform: "facebook" as const,
      channelKey: DEFAULT_CHANNEL_KEY,
      name: page.name,
      platformChannelId: page.id,
      platformHandle: null,
      thumbnailUrl: null,
      platformAccountId: existing?.platformAccountId ?? null,
      accessToken: page.access_token,
      refreshToken: exchange.access_token,
      tokenExpiresAt,
      scope: "pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata",
      isActive: true,
      needsReconnect: false,
      quotaExceededUntil: null,
      lastError: null,
      updatedAt: new Date(),
    };

    let channelId = existing?.id;
    if (existing) {
      await db.update(socialChannels).set(data).where(eq(socialChannels.id, existing.id));
    } else {
      const [created] = await db.insert(socialChannels).values(data).returning({ id: socialChannels.id });
      channelId = created.id;
    }

    return {
      ok: true,
      channelId: channelId!,
      pageId: page.id,
      pageName: page.name,
      tokenSource: "page",
      message: tokenExpiresAt
        ? `Đã lấy page token mới. User token nguồn còn hạn khoảng ${Math.round((tokenExpiresAt.getTime() - Date.now()) / 86400000)} ngày.`
        : "Đã lấy page token mới.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Không thể rotate Facebook token",
    };
  }
}

export type ManualFacebookPageConnectInput = {
  channelKey: string;
  pageId: string;
  pageAccessToken: string;
};

export type ManualFacebookPageConnectResult =
  | {
      ok: true;
      channelId: number;
      pageId: string;
      pageName: string;
      channelKey: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function connectFacebookPageManual(
  input: ManualFacebookPageConnectInput,
): Promise<ManualFacebookPageConnectResult> {
  const channelKey = resolveChannelKey(input.channelKey);
  const pageId = input.pageId.trim();
  const pageAccessToken = input.pageAccessToken.trim();

  if (!pageId) {
    return { ok: false, error: "Thiếu Facebook Page ID" };
  }
  if (!pageAccessToken) {
    return { ok: false, error: "Thiếu Facebook Page access token" };
  }

  try {
    const page = await fetchJson<{ id: string; name: string }>(
      graphUrl(pageId, {
        access_token: pageAccessToken,
        fields: "id,name",
      }),
    );
    if (!page?.id) {
      return { ok: false, error: "Facebook API không trả về page info hợp lệ" };
    }

    const ownershipConflict = await db.query.socialChannels.findFirst({
      where: and(
        eq(socialChannels.platform, "facebook"),
        eq(socialChannels.platformChannelId, page.id),
      ),
    });
    if (ownershipConflict && normalizeChannelKey(ownershipConflict.channelKey) !== channelKey) {
      return {
        ok: false,
        error: `Facebook Page "${page.name}" đã được gán cho channelKey "${ownershipConflict.channelKey}".`,
      };
    }

    const existing = await getStoredFacebookChannelByPageId(page.id, channelKey);
    const data = {
      platform: "facebook" as const,
      channelKey,
      name: page.name,
      platformChannelId: page.id,
      platformHandle: null,
      thumbnailUrl: null,
      platformAccountId: existing?.platformAccountId ?? null,
      accessToken: pageAccessToken,
      refreshToken: null,
      tokenExpiresAt: null,
      scope: "manual_page_token",
      isActive: true,
      needsReconnect: false,
      quotaExceededUntil: null,
      lastError: null,
      updatedAt: new Date(),
    };

    let channelId = existing?.id;
    if (existing) {
      await db.update(socialChannels).set(data).where(eq(socialChannels.id, existing.id));
    } else {
      const [created] = await db.insert(socialChannels).values(data).returning({ id: socialChannels.id });
      channelId = created.id;
    }

    return {
      ok: true,
      channelId: channelId!,
      pageId: page.id,
      pageName: page.name,
      channelKey,
      message: "Đã lưu Facebook Page cho kết nối thủ công.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Không thể kết nối Facebook Page",
    };
  }
}

// ─── Upload ────────────────────────────────────────────────────────────────

export type FacebookReelUploadParams = {
  videoPath: string;
  description: string;
};

export type FacebookReelUploadResult =
  | { success: true; reelId: string; reelUrl: string }
  | { success: false; error: string };

export type FacebookPhotoPostParams = {
  imagePath: string;
  message: string;
};

export type FacebookPhotoPostResult =
  | { success: true; postId: string; postUrl: string | null; photoId: string | null }
  | { success: false; error: string };

// ─── Token inspection ──────────────────────────────────────────────────────

export type FacebookTokenInfo = {
  isValid: boolean;
  expiresAt: string | null;  // ISO string | null = không hết hạn (page token)
  daysLeft: number | null;   // null = vĩnh viễn
  scopes: string[];
  tokenType: string;
  appId: string | null;
  error?: string;
};

/**
 * Gọi /debug_token để kiểm tra token hiện tại của page.
 * Cần APP_ID + APP_SECRET để tạo app access token dùng làm input_token.
 */
export async function inspectFacebookToken(channelId?: number): Promise<FacebookTokenInfo> {
  if (!APP_ID || !APP_SECRET) {
    return { isValid: false, expiresAt: null, daysLeft: null, scopes: [], tokenType: "unknown", appId: null, error: "Chưa cấu hình FACEBOOK_APP_ID / FACEBOOK_APP_SECRET" };
  }

  // Lấy token cần kiểm tra
  let tokenToCheck: string | null = null;
  if (channelId) {
    const ch = await db.query.socialChannels.findFirst({ where: eq(socialChannels.id, channelId) });
    tokenToCheck = ch?.accessToken ?? null;
  }
  if (!tokenToCheck) tokenToCheck = PAGE_ACCESS_TOKEN ?? null;
  if (!tokenToCheck) {
    return { isValid: false, expiresAt: null, daysLeft: null, scopes: [], tokenType: "unknown", appId: null, error: "Không tìm thấy token để kiểm tra" };
  }

  try {
    const appToken = `${APP_ID}|${APP_SECRET}`;
    const data = await fetchJson<{
      data: {
        is_valid?: boolean;
        expires_at?: number;
        scopes?: string[];
        type?: string;
        app_id?: string;
        error?: { message?: string };
      };
    }>(graphUrl("debug_token", { input_token: tokenToCheck, access_token: appToken }));

    const info = data.data;
    const isValid = info.is_valid ?? false;
    const expiresDate = info.expires_at && info.expires_at > 0 ? new Date(info.expires_at * 1000) : null;
    const expiresAt = expiresDate ? expiresDate.toISOString() : null;
    const daysLeft = expiresDate ? Math.round((expiresDate.getTime() - Date.now()) / 86400000) : null;

    return {
      isValid,
      expiresAt,
      daysLeft,
      scopes: info.scopes ?? [],
      tokenType: info.type ?? "unknown",
      appId: info.app_id ?? null,
      error: isValid ? undefined : (info.error?.message ?? "Token không hợp lệ"),
    };
  } catch (e) {
    return {
      isValid: false,
      expiresAt: null,
      daysLeft: null,
      scopes: [],
      tokenType: "unknown",
      appId: null,
      error: e instanceof Error ? e.message : "Lỗi khi gọi debug_token",
    };
  }
}

export async function uploadToFacebookReel(
  channelId: number,
  params: FacebookReelUploadParams,
): Promise<FacebookReelUploadResult> {
  const channel = await db.query.socialChannels.findFirst({ where: eq(socialChannels.id, channelId) });
  const pageId = channel?.platformChannelId ?? PAGE_ID;
  const accessToken = PAGE_ACCESS_TOKEN ?? channel?.accessToken ?? null;

  if (!pageId || !accessToken) {
    return { success: false, error: "Chưa cấu hình FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN" };
  }

  const absPath = params.videoPath.startsWith("/")
    ? params.videoPath
    : path.join(process.cwd(), params.videoPath);
  if (!fs.existsSync(absPath)) {
    return { success: false, error: `Video file không tồn tại: ${absPath}` };
  }

  try {
    const start = await fetchJson<{ video_id: string; upload_url: string }>(
      graphUrl(`${pageId}/video_reels`),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: accessToken,
          upload_phase: "start",
        }),
      },
    );

    const buffer = fs.readFileSync(absPath);
    const uploadRes = await fetch(start.upload_url, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        offset: "0",
        file_size: String(buffer.length),
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    });
    const uploadText = await uploadRes.text();
    if (!uploadRes.ok) {
      throw new Error(uploadText || `Facebook upload error ${uploadRes.status}`);
    }

    const finishRes = await fetchJson<{ success: boolean }>(
      graphUrl(`${pageId}/video_reels`),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: accessToken,
          upload_phase: "finish",
          video_id: start.video_id,
          video_state: "PUBLISHED",
          description: buildSafeFacebookCaption(params.description),
        }),
      },
    );

    if (finishRes.success === false) {
      throw new Error("Facebook từ chối publish reel (success=false)");
    }

    return {
      success: true,
      reelId: start.video_id,
      reelUrl: `https://www.facebook.com/reel/${start.video_id}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await db
      .update(socialChannels)
      .set({ lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(socialChannels.id, channelId));
    return { success: false, error: msg.slice(0, 500) };
  }
}

export async function uploadToFacebookPhotoPost(
  channelId: number,
  params: FacebookPhotoPostParams,
): Promise<FacebookPhotoPostResult> {
  const channel = await db.query.socialChannels.findFirst({ where: eq(socialChannels.id, channelId) });
  const pageId = channel?.platformChannelId ?? PAGE_ID;
  const accessToken = PAGE_ACCESS_TOKEN ?? channel?.accessToken ?? null;

  if (!pageId || !accessToken) {
    return { success: false, error: "Chưa cấu hình FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN" };
  }

  const absPath = params.imagePath.startsWith("/")
    ? params.imagePath
    : path.join(process.cwd(), params.imagePath);
  if (!fs.existsSync(absPath)) {
    return { success: false, error: `Image file không tồn tại: ${absPath}` };
  }

  try {
    const form = new FormData();
    form.set("access_token", accessToken);
    form.set("message", buildSafeFacebookCaption(params.message));
    form.set("published", "true");
    form.set("source", new Blob([fs.readFileSync(absPath)], { type: "image/jpeg" }), path.basename(absPath));

    const res = await fetch(graphUrl(`${pageId}/photos`), {
      method: "POST",
      body: form,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok || json.error) {
      const msg = json?.error?.message ?? text ?? `Facebook API error ${res.status}`;
      throw new Error(msg);
    }

    const postId = typeof json.post_id === "string" ? json.post_id : "";
    const photoId = typeof json.id === "string" ? json.id : null;
    const postUrl = postId ? `https://www.facebook.com/${postId.replace("_", "/posts/")}` : null;
    return { success: true, postId: postId || photoId || "", postUrl, photoId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await db
      .update(socialChannels)
      .set({ lastError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(socialChannels.id, channelId));
    return { success: false, error: msg.slice(0, 500) };
  }
}

// ─── Bulk delete helpers ───────────────────────────────────────────────────

export type FacebookPageContentItem = {
  objectType: "post" | "video";
  id: string;
  createdTime: Date | null;
  permalinkUrl: string | null;
  title: string | null;
};

type FacebookDeletePreview = {
  channelId: number;
  pageId: string;
  pageName: string;
  cutoff: string;
  totalCandidates: number;
  feedPosts: number;
  videos: number;
  items: FacebookPageContentItem[];
};

type FacebookDeleteResult = FacebookDeletePreview & {
  deleted: number;
  failed: number;
  failures: Array<{ objectType: "post" | "video"; id: string; error: string }>;
};

function toAbsDateEnd(input: string): Date {
  return new Date(`${input}T23:59:59.999+07:00`);
}

function isOlderThanCutoff(value: string | undefined, cutoff: Date): boolean {
  if (!value) return false;
  const dt = new Date(value);
  return !Number.isNaN(dt.getTime()) && dt.getTime() <= cutoff.getTime();
}

async function collectPaged<T extends { id: string; created_time?: string }>(
  initialUrl: string,
  cutoff: Date,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | undefined = initialUrl;
  let pages = 0;

  while (nextUrl && pages < maxPages) {
    const res: PagingResponse<T> = await fetchJson<PagingResponse<T>>(nextUrl);
    const rows = res.data ?? [];
    for (const row of rows) {
      if (isOlderThanCutoff(row.created_time, cutoff)) out.push(row);
    }
    nextUrl = res.paging?.next;
    pages += 1;
    if (!rows.length) break;
  }

  return out;
}

async function getFacebookChannelOrThrow(channelId: number) {
  const channel = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, channelId),
  });
  if (!channel || channel.platform !== "facebook" || !channel.accessToken || !channel.platformChannelId) {
    throw new Error("Facebook Page chưa được kết nối trong app");
  }
  return {
    id: channel.id,
    name: channel.name,
    platformChannelId: channel.platformChannelId,
    accessToken: channel.accessToken,
  };
}

export async function previewFacebookPageDelete(
  channelId: number,
  cutoffDate: string,
): Promise<FacebookDeletePreview> {
  const channel = await getFacebookChannelOrThrow(channelId);
  const cutoff = toAbsDateEnd(cutoffDate);

  const feedUrl = graphUrl(`${channel.platformChannelId}/feed`, {
    access_token: channel.accessToken,
    fields: "id,created_time,message,permalink_url",
    limit: "100",
  });
  const videosUrl = graphUrl(`${channel.platformChannelId}/videos`, {
    access_token: channel.accessToken,
    fields: "id,created_time,title,description,permalink_url",
    limit: "100",
  });

  const [feedRows, videoRows] = await Promise.all([
    collectPaged<{ id: string; created_time?: string; message?: string; permalink_url?: string }>(
      feedUrl, cutoff,
    ),
    collectPaged<{ id: string; created_time?: string; title?: string; description?: string; permalink_url?: string }>(
      videosUrl, cutoff,
    ),
  ]);

  const items: FacebookPageContentItem[] = [
    ...feedRows.map((row) => ({
      objectType: "post" as const,
      id: row.id,
      createdTime: row.created_time ? new Date(row.created_time) : null,
      permalinkUrl: row.permalink_url ?? null,
      title: row.message?.slice(0, 120) ?? null,
    })),
    ...videoRows.map((row) => ({
      objectType: "video" as const,
      id: row.id,
      createdTime: row.created_time ? new Date(row.created_time) : null,
      permalinkUrl: row.permalink_url ?? null,
      title: row.title?.slice(0, 120) ?? row.description?.slice(0, 120) ?? null,
    })),
  ].sort((a, b) => (b.createdTime?.getTime() ?? 0) - (a.createdTime?.getTime() ?? 0));

  return {
    channelId,
    pageId: channel.platformChannelId,
    pageName: channel.name,
    cutoff: cutoffDate,
    totalCandidates: items.length,
    feedPosts: feedRows.length,
    videos: videoRows.length,
    items,
  };
}

export async function deleteFacebookPageContentBefore(
  channelId: number,
  cutoffDate: string,
): Promise<FacebookDeleteResult> {
  const preview = await previewFacebookPageDelete(channelId, cutoffDate);
  const channel = await getFacebookChannelOrThrow(channelId);

  let deleted = 0;
  let failed = 0;
  const failures: FacebookDeleteResult["failures"] = [];

  for (const item of preview.items) {
    try {
      await fetchJson<{ success?: boolean }>(
        graphUrl(item.id, { access_token: channel.accessToken }),
        { method: "DELETE" },
      );
      deleted += 1;
    } catch (error) {
      failed += 1;
      failures.push({
        objectType: item.objectType,
        id: item.id,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
    }
  }

  return { ...preview, deleted, failed, failures };
}
