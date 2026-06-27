process.env.TTS_ENABLE_PUNCTUATION_PAUSES = "false";
import { config } from "dotenv"; config({ path: ".env.local" }); config();
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const ids = [
    "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd",
    "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621",
    "cbf59089-fc7e-4ab2-82aa-f62e06990dcb",
  ];
  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, ids),
    columns: { id: true, shortContent: true, topicFamily: true },
  });
  for (const r of rows) {
    console.log(`\n=== ${r.id} (${r.topicFamily}) ===`);
    console.log(r.shortContent);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
