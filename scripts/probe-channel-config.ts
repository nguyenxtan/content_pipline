import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";
import { getChannelPublishConfig } from "@/lib/config/channel-configs";

async function main() {
  const rows = await db.select().from(appConfig);
  console.log(`\n=== app_config rows (${rows.length}) ===\n`);
  for (const r of rows) {
    console.log(`KEY: ${r.key}`);
    try { console.log("VALUE:", JSON.stringify(JSON.parse(r.value), null, 2)); }
    catch { console.log("VALUE (raw):", r.value?.slice(0, 300)); }
    console.log("---");
  }

  console.log("\n=== getChannelPublishConfig('phat_phap') ===\n");
  const cfg = await getChannelPublishConfig("phat_phap");
  if (cfg) {
    console.log("source:", cfg.source);
    console.log("shortDestinations:", JSON.stringify(cfg.shortDestinations, null, 2));
    console.log("longDestinations:", JSON.stringify(cfg.longDestinations, null, 2));
    console.log("quoteDestinations:", JSON.stringify(cfg.quoteDestinations, null, 2));
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
