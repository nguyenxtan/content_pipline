import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { socialChannels } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const rows = await db.select({
    id: socialChannels.id,
    name: socialChannels.name,
    platform: socialChannels.platform,
    channelKey: socialChannels.channelKey,
    platformChannelId: socialChannels.platformChannelId,
    platformHandle: socialChannels.platformHandle,
    isActive: socialChannels.isActive,
    needsReconnect: socialChannels.needsReconnect,
    tokenExpiresAt: socialChannels.tokenExpiresAt,
    lastError: socialChannels.lastError,
    createdAt: socialChannels.createdAt,
    scope: socialChannels.scope,
  }).from(socialChannels).where(eq(socialChannels.channelKey, "tang_sau"));

  console.log(`Tang Sau channels: ${rows.length}\n`);
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2));
  }

  // Also show ALL youtube channels for full picture
  const allYt = await db.select({
    id: socialChannels.id,
    name: socialChannels.name,
    channelKey: socialChannels.channelKey,
    platformChannelId: socialChannels.platformChannelId,
    isActive: socialChannels.isActive,
    needsReconnect: socialChannels.needsReconnect,
    tokenExpiresAt: socialChannels.tokenExpiresAt,
    lastError: socialChannels.lastError,
  }).from(socialChannels).where(eq(socialChannels.platform, "youtube"));

  console.log(`\nAll YouTube channels (${allYt.length}):`);
  for (const r of allYt) {
    console.log(JSON.stringify(r));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
