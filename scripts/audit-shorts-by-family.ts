import { config } from "dotenv";
import path from "path";
config({ path: path.join(process.cwd(), ".env.local"), override: true });

import { db } from "@/lib/db";
import { contentGenerations, publishedVideos } from "@/lib/db/schema";
import { isNotNull, eq, sql } from "drizzle-orm";

async function main() {
  // Pull published shorts with analytics
  const rows = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      topicFamily: contentGenerations.topicFamily,
      shortContent: contentGenerations.shortContent,
    })
    .from(contentGenerations)
    .where(isNotNull(contentGenerations.topicFamily));

  // Group by family
  const families: Record<string, string[]> = {};
  for (const r of rows) {
    const fam = r.topicFamily!;
    if (!families[fam]) families[fam] = [];
    if (r.topic && !families[fam].includes(r.topic)) families[fam].push(r.topic);
  }
  
  console.log("Topic families in DB:");
  for (const [fam, topics] of Object.entries(families).sort((a,b) => b[1].length - a[1].length)) {
    console.log(`\n${fam} (${topics.length} unique topics):`);
    topics.slice(0, 5).forEach(t => console.log(`  - ${t}`));
    if (topics.length > 5) console.log(`  ... +${topics.length - 5} more`);
  }

  // Count total per family
  console.log("\n\nCount by family (all content):");
  const countRes = await db.execute(sql`
    SELECT topic_family, COUNT(*) as cnt, COUNT(DISTINCT topic) as unique_topics
    FROM content_generations 
    WHERE topic_family IS NOT NULL
    GROUP BY topic_family 
    ORDER BY cnt DESC
  `);
  for (const r of countRes.rows as any[]) {
    console.log(`  ${r.topic_family}: ${r.cnt} rows, ${r.unique_topics} unique topics`);
  }
  
  process.exit(0);
}
main().catch(e => { console.error("Fatal:", e.cause?.message || e.message); process.exit(1); });
