/**
 * Verify hook tracking and hook performance data.
 *
 * Usage: npx tsx scripts/verify-hook-performance.ts
 */

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { isNotNull, desc } from "drizzle-orm";
import { getHookPerformanceAction } from "@/actions/publishing-analytics";
import { inferHookPattern } from "@/lib/hook-engine";

async function main() {
  // 1. Recent content generations with hook metadata
  const rows = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      nicheName: contentGenerations.nicheName,
      shortSelectedHook: contentGenerations.shortSelectedHook,
      hookScore: contentGenerations.hookScore,
      hookPattern: contentGenerations.hookPattern,
      createdAt: contentGenerations.createdAt,
    })
    .from(contentGenerations)
    .where(isNotNull(contentGenerations.shortSelectedHook))
    .orderBy(desc(contentGenerations.createdAt))
    .limit(5);

  console.log("\n=== Recent content generations with selected hooks ===");
  for (const row of rows) {
    const hookPreview = (row.shortSelectedHook ?? "").slice(0, 90);
    console.log(`[${row.id.slice(0, 8)}] ${row.topic} (${row.nicheName})`);
    console.log(`  hook    : ${hookPreview}`);
    console.log(`  score   : ${row.hookScore ?? "null (pre-migration)"}`);
    console.log(`  pattern : ${row.hookPattern ?? "null (pre-migration)"}`);
    if (!row.hookPattern && row.shortSelectedHook) {
      const inferred = inferHookPattern(row.shortSelectedHook);
      console.log(`  inferred: ${inferred}`);
    }
  }

  // 2. Coverage stats
  const allWithHook = await db
    .select({
      hookScore: contentGenerations.hookScore,
      hookPattern: contentGenerations.hookPattern,
    })
    .from(contentGenerations)
    .where(isNotNull(contentGenerations.shortSelectedHook));

  const withScore = allWithHook.filter((r) => r.hookScore !== null).length;
  const withPattern = allWithHook.filter((r) => r.hookPattern !== null).length;
  const patternCounts: Record<string, number> = {};
  for (const r of allWithHook) {
    if (r.hookPattern) {
      patternCounts[r.hookPattern] = (patternCounts[r.hookPattern] ?? 0) + 1;
    }
  }

  console.log("\n=== Hook metadata coverage ===");
  console.log(`Total content with selected hook : ${allWithHook.length}`);
  console.log(`With hook_score persisted        : ${withScore}`);
  console.log(`With hook_pattern persisted      : ${withPattern}`);
  if (Object.keys(patternCounts).length > 0) {
    console.log("Pattern breakdown:");
    for (const [pattern, count] of Object.entries(patternCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${pattern}: ${count}`);
    }
  }

  // 3. Hook performance (join with analytics)
  console.log("\n=== Hook performance (YouTube, top 10 by retention) ===");
  const performance = await getHookPerformanceAction({ platform: "youtube", limit: 10 });
  if (performance.length === 0) {
    console.log("No hook performance rows yet (hooks need to be published + analytics synced).");
  } else {
    for (const row of performance) {
      const conf = row.lowConfidence ? " [LOW_CONF]" : "";
      const retention = row.avgRetentionPct != null ? `${row.avgRetentionPct.toFixed(2)}%` : "n/a";
      const duration = row.avgViewDurationSec != null ? `${row.avgViewDurationSec}s` : "n/a";
      console.log(`pattern: ${row.hookPattern ?? "n/a"} | views: ${row.avgViews} | retention: ${retention} | duration: ${duration}${conf}`);
      console.log(`  topic: ${row.topic ?? "n/a"} | niche: ${row.niche ?? "n/a"}`);
      console.log(`  hook: ${row.hookText.slice(0, 90)}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
