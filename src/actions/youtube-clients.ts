"use server";

import { db } from "@/lib/db";
import { youtubeOauthClients, socialChannels, uploadQueue } from "@/lib/db/schema";
import { eq, and, gte, count } from "drizzle-orm";
import { pacificMidnightUtc, nextQuotaResetUtc } from "@/lib/social/youtube-api";

// ─── OAuth Client Management ───────────────────────────────────────────────

export async function getYoutubeOauthClientsAction() {
  return db.query.youtubeOauthClients.findMany({
    orderBy: (t, { asc }) => asc(t.id),
  });
}

export async function createYoutubeOauthClientAction(input: {
  name: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ id: number } | { error: string }> {
  if (!input.name.trim() || !input.clientId.trim() || !input.clientSecret.trim()) {
    return { error: "Thiếu thông tin" };
  }
  const [row] = await db.insert(youtubeOauthClients).values({
    name:         input.name.trim(),
    clientId:     input.clientId.trim(),
    clientSecret: input.clientSecret.trim(),
  }).returning({ id: youtubeOauthClients.id });
  return { id: row.id };
}

export async function deleteYoutubeOauthClientAction(id: number): Promise<void> {
  await db.delete(youtubeOauthClients).where(eq(youtubeOauthClients.id, id));
}

export async function toggleYoutubeOauthClientAction(id: number, isActive: boolean): Promise<void> {
  await db.update(youtubeOauthClients)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(youtubeOauthClients.id, id));
}

// ─── Quota Stats ───────────────────────────────────────────────────────────

const UNITS_PER_UPLOAD    = 1650; // 1600 video.insert + ~50 thumbnail
const QUOTA_LIMIT         = 10_000;
const SAFE_UPLOAD_LIMIT   = Math.floor(QUOTA_LIMIT / UNITS_PER_UPLOAD); // 6

export type ChannelQuotaStat = {
  channelId:          number;
  channelName:        string;
  platformHandle:     string | null;
  clientId:           number | null;
  clientName:         string | null;
  oauthClientShort:   string | null; // first 20 chars of client_id
  uploadsToday:       number;
  unitsUsed:          number;
  unitsRemaining:     number;
  usagePct:           number;
  isExceeded:         boolean;
  quotaExceededUntil: Date | null;
  nextReset:          Date;
  isActive:           boolean;
  needsReconnect:     boolean;
  hasToken:           boolean;
};

export async function getYoutubeQuotaStatsAction(): Promise<ChannelQuotaStat[]> {
  const channels = await db.query.socialChannels.findMany({
    where: eq(socialChannels.platform, "youtube"),
    with: { oauthClient: true },
    orderBy: (t, { asc }) => asc(t.id),
  });

  const midnight = pacificMidnightUtc();
  const nextReset = nextQuotaResetUtc();

  const stats = await Promise.all(channels.map(async (ch) => {
    const result = await db
      .select({ cnt: count() })
      .from(uploadQueue)
      .where(and(
        eq(uploadQueue.channelId, ch.id),
        eq(uploadQueue.status, "done"),
        gte(uploadQueue.uploadedAt, midnight),
      ));

    const uploadsToday    = Number(result[0]?.cnt ?? 0);
    const unitsUsed       = uploadsToday * UNITS_PER_UPLOAD;
    const unitsRemaining  = Math.max(0, QUOTA_LIMIT - unitsUsed);
    const usagePct        = Math.min(100, Math.round((unitsUsed / QUOTA_LIMIT) * 100));
    const isExceeded      = !!(ch.quotaExceededUntil && ch.quotaExceededUntil > new Date());

    return {
      channelId:          ch.id,
      channelName:        ch.name,
      platformHandle:     ch.platformHandle,
      clientId:           ch.oauthClientConfigId,
      clientName:         ch.oauthClient?.name ?? null,
      oauthClientShort:   ch.oauthClient?.clientId.slice(0, 24) ?? null,
      uploadsToday,
      unitsUsed,
      unitsRemaining,
      usagePct,
      isExceeded,
      quotaExceededUntil: ch.quotaExceededUntil,
      nextReset,
      isActive:           ch.isActive,
      needsReconnect:     ch.needsReconnect,
      hasToken:           !!ch.accessToken,
    } satisfies ChannelQuotaStat;
  }));

  return stats;
}
