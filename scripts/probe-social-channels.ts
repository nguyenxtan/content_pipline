import { db } from "@/lib/db";
import { socialChannels } from "@/lib/db/schema";

async function main() {
  const rows = await db.select().from(socialChannels);
  for (const r of rows) {
    console.log(`id=${r.id} name="${r.name}" platform=${r.platform} channelKey=${r.channelKey} active=${r.isActive} platformChannelId=${r.platformChannelId}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
