/**
 * Topic Family Analytics V1 — Runner
 *
 * Run with:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/run-topic-family-analytics.ts
 *
 * Outputs:
 *   reports/topic-family-analytics/YYYY-MM-DD.json   (machine-readable)
 *   reports/topic-family-analytics/YYYY-MM-DD.md     (human-readable planner report)
 *
 * Read-only. No DB writes. No publishing changes.
 */

import path from "path";
import fs from "fs";
import { runTopicFamilyAnalytics, type FamilyAnalytics } from "@/lib/analytics/topic-family-analytics";
import { FAMILY_TAXONOMY } from "@/lib/analytics/topic-family-classifier";

const REPORT_DIR = path.join(process.cwd(), "reports/topic-family-analytics");
const DATE = new Date().toISOString().slice(0, 10);

function bar(value: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function trendEmoji(trend: string): string {
  return { rising: "↑", stable: "→", declining: "↓", saturated: "⚠" }[trend] ?? "?";
}

function recTag(rec: string): string {
  return { scale: "[SCALE]", maintain: "[HOLD]", reduce: "[REDUCE]", stop: "[STOP]" }[rec] ?? "[?]";
}

function writeMarkdown(report: ReturnType<typeof buildMarkdown>, filePath: string): void {
  fs.writeFileSync(filePath, report, "utf8");
}

function buildMarkdown(report: Awaited<ReturnType<typeof runTopicFamilyAnalytics>>): string {
  const lines: string[] = [];
  const maxViews = Math.max(...report.families.map(f => f.cgAvgViews));

  lines.push(`# Topic Family Analytics V1`);
  lines.push(`**Generated:** ${report.generatedAt.slice(0, 19).replace("T", " ")} UTC`);
  lines.push(`**Channel:** ${report.channelCount} channels · ${report.totalPublished.toLocaleString()} published · ${report.totalViews.toLocaleString()} total views · ${report.overallAvgViews} avg/video\n`);

  lines.push(`---\n`);
  lines.push(`## 1. Family Rankings\n`);
  lines.push(`| # | Family | CG Vids (+Legacy) | CG Avg Views | CG Median | CG P90 | Ret% | Dur | Trend | Rec |`);
  lines.push(`|---|--------|-------------------|--------------|-----------|--------|------|-----|-------|-----|`);
  report.families.forEach((f, i) => {
    const ret = f.cgAvgRetentionPct !== null ? `${f.cgAvgRetentionPct}%` : "—";
    const dur = f.cgAvgViewDurationSec !== null ? `${f.cgAvgViewDurationSec}s` : "—";
    const vids = `${f.cgVideos}${f.legacyVideos > 0 ? ` +${f.legacyVideos}L` : ""}`;
    lines.push(`| ${i+1} | **${f.label}** | ${vids} | ${f.cgAvgViews.toLocaleString()} | ${f.cgMedianViews.toLocaleString()} | ${f.cgP90Views.toLocaleString()} | ${ret} | ${dur} | ${trendEmoji(f.cgTrend)} ${f.cgTrend} | ${recTag(f.recommendation)} |`);
  });

  lines.push(`\n---\n`);
  lines.push(`## 2. Family Deep-Dive\n`);

  for (const f of report.families) {
    const def = FAMILY_TAXONOMY[f.family];
    lines.push(`### ${f.label} (\`${f.family}\`)`);
    lines.push(`**${trendEmoji(f.cgTrend)} ${f.cgTrend.toUpperCase()}** · saturation: ${f.cgSaturationScore}/100 · recommendation: **${f.recommendation.toUpperCase()}**`);
    lines.push(`- CG videos: ${f.cgVideos} (${f.autoClassifiedCount} auto-classified) · Legacy: ${f.legacyVideos}`);
    lines.push(`- CG avg views: ${f.cgAvgViews} · Median: ${f.cgMedianViews} · P90: ${f.cgP90Views} · Max: ${f.cgMaxViews}`);
    lines.push(`- CG avg likes: ${f.cgAvgLikes} · Like/view ratio: ${(f.cgLikeViewRatio * 100).toFixed(1)}%`);
    if (f.cgAvgRetentionPct !== null) lines.push(`- CG avg retention: ${f.cgAvgRetentionPct}% · CG avg view duration: ${f.cgAvgViewDurationSec}s`);
    lines.push(`- Trend delta (recent vs earlier CG): ${f.cgTrendDeltaPct > 0 ? '+' : ''}${f.cgTrendDeltaPct}%`);
    lines.push(`- Longform suitability: ${(f.longformSuitability * 100).toFixed(0)}% · Target age: ${def?.audienceAge ?? "?"} · Monetization: ${def?.monetizationPotential ?? "?"}`);
    lines.push(`- Bar: \`${bar(f.cgAvgViews, maxViews)}\` ${f.cgAvgViews}v CG avg`);
    lines.push(``);
    lines.push(`**Top topics:**`);
    for (const t of f.topTopics) {
      const ret = t.retentionPct !== null ? `, ${t.retentionPct}% ret` : "";
      lines.push(`  - [${t.viewCount}v${ret}] ${t.topic}`);
    }
    lines.push(``);
  }

  lines.push(`---\n`);
  lines.push(`## 3. Unclassified High-Performers\n`);
  lines.push(`Top ${Math.min(20, report.unclassified.length)} by views:\n`);
  lines.push(`| Views | Topic | Auto-Family | Confidence |`);
  lines.push(`|-------|-------|-------------|------------|`);
  for (const uv of report.unclassified.slice(0, 20)) {
    const cls = uv.classification;
    const famStr = cls ? `\`${cls.family}\`` : "—";
    const confStr = cls ? `${(cls.confidence * 100).toFixed(0)}%` : "—";
    lines.push(`| ${uv.viewCount} | ${uv.topic} | ${famStr} | ${confStr} |`);
  }

  lines.push(`\n---\n`);
  lines.push(`## 4. Emerging Families\n`);
  if (report.emergingFamilies.length === 0) {
    lines.push(`No new families detected beyond existing taxonomy.`);
  } else {
    for (const ef of report.emergingFamilies) {
      lines.push(`### ${ef.label} (\`${ef.proposedFamily}\`) — proposed new family`);
      lines.push(`- ${ef.videoCount} auto-classified videos · avg ${ef.avgViews} views`);
      lines.push(`- ${ef.rationale}`);
      lines.push(`- Representative topics:`);
      for (const t of ef.representativeTopics) lines.push(`  - ${t}`);
      lines.push(``);
    }
  }

  lines.push(`---\n`);
  lines.push(`## 5. Top 20 Longform Candidates\n`);
  lines.push(`Scoring: 35% views signal · 25% retention · 15% likes · 15% family fit · 10% longform suitability\n`);
  lines.push(`| # | Topic | Family | Views | Ret% | Score | Has LF |`);
  lines.push(`|---|-------|--------|-------|------|-------|--------|`);
  for (const c of report.top20LongformCandidates) {
    const ret = c.retentionPct !== null ? `${c.retentionPct}%` : "—";
    const hasLF = c.alreadyHasLongform ? "✓" : "—";
    const legacy = c.isLegacy ? " [legacy]" : "";
    lines.push(`| ${c.rank} | ${c.topic.slice(0, 55)}${legacy} | ${c.familyLabel} | ${c.viewCount} | ${ret} | ${(c.longformScore * 100).toFixed(0)} | ${hasLF} |`);
  }
  lines.push(``);
  for (const c of report.top20LongformCandidates) {
    lines.push(`#### #${c.rank} — ${c.topic}`);
    lines.push(`- Family: **${c.familyLabel}** · Views: ${c.viewCount} · Likes: ${c.likeCount} · Retention: ${c.retentionPct !== null ? c.retentionPct + "%" : "—"} · Dur: ${c.avgViewDurationSec !== null ? c.avgViewDurationSec + "s" : "—"}`);
    lines.push(`- Score: ${(c.longformScore * 100).toFixed(1)}/100 (views:${(c.scoreBreakdown.viewsSignal*100).toFixed(0)} ret:${(c.scoreBreakdown.retentionSignal*100).toFixed(0)} likes:${(c.scoreBreakdown.likeSignal*100).toFixed(0)} family:${(c.scoreBreakdown.familySignal*100).toFixed(0)})`);
    lines.push(`- Already has longform: ${c.alreadyHasLongform ? "Yes" : "No"}`);
    lines.push(`- **Suggested angle:** ${c.suggestedAngle}`);
    lines.push(``);
  }

  lines.push(`---\n`);
  lines.push(`## 6. Planner Recommendations\n`);
  for (const rec of report.plannerRecommendations) {
    const icon = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" }[rec.priority] ?? "○";
    lines.push(`${icon} **[${rec.priority.toUpperCase()}]** \`${rec.action}\` → \`${rec.family}\``);
    lines.push(`  ${rec.reason}`);
    lines.push(``);
  }

  return lines.join("\n");
}

async function main() {
  console.log("Running Topic Family Analytics V1...\n");
  const t0 = Date.now();

  const report = await runTopicFamilyAnalytics();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Console summary
  console.log(`=== ANALYTICS COMPLETE (${elapsed}s) ===\n`);
  console.log(`Total published:  ${report.totalPublished}`);
  console.log(`Total views:      ${report.totalViews.toLocaleString()}`);
  console.log(`Overall avg:      ${report.overallAvgViews} views/video`);
  console.log(`Channels:         ${report.channelCount}`);
  console.log(`Families found:   ${report.families.length}`);
  console.log(`Unclassified:     ${report.unclassified.length} (${report.unclassified.filter(u => u.classification).length} auto-classified)`);
  console.log(`Emerging families:${report.emergingFamilies.length}`);
  console.log(``);

  console.log("FAMILY RANKINGS:");
  const maxV = Math.max(...report.families.map(f => f.cgAvgViews));
  for (const f of report.families) {
    const ret = f.cgAvgRetentionPct !== null ? ` | ret:${f.cgAvgRetentionPct}%` : "";
    const trend = trendEmoji(f.cgTrend);
    const legacy = f.legacyVideos > 0 ? ` +${f.legacyVideos}L` : "";
    console.log(`  ${recTag(f.recommendation).padEnd(9)} ${f.label.padEnd(36)} cg:${String(f.cgAvgViews).padStart(5)} ${trend} ${bar(f.cgAvgViews, maxV, 15)}${ret}${legacy}`);
  }

  console.log("\nTOP 10 LONGFORM CANDIDATES:");
  for (const c of report.top20LongformCandidates.slice(0, 10)) {
    const lf = c.alreadyHasLongform ? " [has LF]" : "";
    console.log(`  #${c.rank} [${(c.longformScore*100).toFixed(0)}/100] [${c.viewCount}v] ${c.topic.slice(0, 55)}${lf}`);
  }

  console.log("\nPLANNER RECOMMENDATIONS:");
  for (const rec of report.plannerRecommendations) {
    console.log(`  [${rec.priority.toUpperCase()}] ${rec.action} → ${rec.family}`);
    console.log(`    ${rec.reason}`);
  }

  // Write outputs
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const jsonPath = path.join(REPORT_DIR, `${DATE}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const md = buildMarkdown(report);
  const mdPath = path.join(REPORT_DIR, `${DATE}.md`);
  writeMarkdown(md, mdPath);

  console.log(`\nReports written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  process.exit(0);
}

main().catch(e => {
  console.error("Fatal:", e.cause?.message || e.message);
  console.error(e.stack);
  process.exit(1);
});
