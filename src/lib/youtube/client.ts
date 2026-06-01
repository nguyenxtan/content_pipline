import { google } from "googleapis";
import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID!;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET!;
const REDIRECT_URI  = process.env.YOUTUBE_REDIRECT_URI!;

export function createOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
    prompt: "consent",
  });
}

export async function getAuthorizedClient() {
  const [refreshRow, accessRow, expiryRow] = await Promise.all([
    db.query.appConfig.findFirst({ where: eq(appConfig.key, "youtube_refresh_token") }),
    db.query.appConfig.findFirst({ where: eq(appConfig.key, "youtube_access_token") }),
    db.query.appConfig.findFirst({ where: eq(appConfig.key, "youtube_token_expiry") }),
  ]);

  if (!refreshRow) return null;

  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: refreshRow.value,
    access_token:  accessRow?.value,
    expiry_date:   expiryRow ? parseInt(expiryRow.value) : undefined,
  });

  // Auto-refresh if expired
  const expiry = expiryRow ? parseInt(expiryRow.value) : 0;
  if (Date.now() > expiry - 60_000) {
    const { credentials } = await client.refreshAccessToken();
    await saveTokens(
      credentials.refresh_token ?? refreshRow.value,
      credentials.access_token!,
      credentials.expiry_date!,
    );
    client.setCredentials(credentials);
  }

  return client;
}

export async function saveTokens(
  refreshToken: string,
  accessToken: string,
  expiryDate: number,
) {
  const upsert = (key: string, value: string) =>
    db
      .insert(appConfig)
      .values({ key, value })
      .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });

  await Promise.all([
    upsert("youtube_refresh_token", refreshToken),
    upsert("youtube_access_token",  accessToken),
    upsert("youtube_token_expiry",  String(expiryDate)),
  ]);
}

export async function isYoutubeConnected(): Promise<boolean> {
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, "youtube_refresh_token"),
  });
  return !!row;
}
