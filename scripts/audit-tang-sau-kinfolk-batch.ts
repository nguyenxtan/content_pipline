/**
 * Audit Tầng Sâu queue batches relative to the Kinfolk/Monocle visual prompt hotfix.
 *
 * Reports:
 *  - All queued/recent Tang Sau batches, labelled pre- or post-hotfix
 *  - Format distribution per batch
 *  - Scene category + brightness (inferred from TANG_SAU_SCENE_POOL + seedIndex)
 *  - Visual guard on source images for the most recent batch
 *  - Buddhist/spiritual vs text/signage flag breakdown
 *  - visualSearchKeywords spiritual term warning (sidecar metadata field)
 *  - kinetic layoutWarnings
 *  - destination / platform distribution
 *  - upload_queue impact summary
 *
 * Safety: no mutations, no uploads, no queue changes.
 * upload_queue rows created = 0.
 *
 * Hotfix reference:
 *   Before: prompt used Buddhist negative list + generic "modern editorial" anchor
 *           → fal.ai generated Buddhist imagery on 8/8 attempts (100%)
 *   After:  prompt uses Kinfolk/Monocle magazine anchors, Buddhist terms removed entirely
 *           → fal.ai generated Buddhist imagery on 0/8 attempts (0%)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "fs";
import path from "path";
import { Pool } from "pg";

import {
  TANG_SAU_SCENE_POOL,
  inspectTangSauBackground,
  type TangSauSceneCategory,
} from "@/lib/pipeline/quote-short-pipeline";

const OUTPUT_DIR = path.join(process.cwd(), "output", "legacy-quote-short-v1");
const TANG_SAU_CHANNEL_ID = 10;
const VIETNAM_TZ = "Asia/Ho_Chi_Minh";

// The hotfix landed during the Jun 6 session; Batch 3 (created 2026-06-06T03:02 UTC)
// was generated with the old prompt. Any batch created after this session starts is post-hotfix.
// We approximate the hotfix boundary as the time this script is first run.
const HOTFIX_BOUNDARY_UTC = new Date("2026-06-06T03:10:00Z"); // after Batch 3 creation

const VARIANT_LABELS: Record<string, string> = {
  LEGACY_QUOTE_KINETIC_TEXT_V1: "kinetic_text",
  LEGACY_QUOTE_BILINGUAL_MINIMAL_V1: "bilingual_minimal",
  LEGACY_QUOTE_NOTE_LETTER_V1: "note_letter",
  LEGACY_QUOTE_REFLECTION_V1: "reflection",
  LEGACY_QUOTE_NO_VOICE_V2: "short_quote",
};

const SPIRITUAL_KEYWORDS = [
  "spiritual", "temple", "old temple", "monk", "lotus", "incense",
  "prayer", "Buddha", "meditation", "pagoda", "shrine", "religious",
  "cinematic spiritual",
];

function fmtVn(d: Date | string): string {
  return new Date(d).toLocaleString("vi-VN", {
    timeZone: VIETNAM_TZ,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function seedIndex(seed: string, length: number): number {
  return Array.from(seed).reduce((s, c) => s + (c.codePointAt(0) ?? 0), 0) % length;
}

function inferSceneEntry(topic: string) {
  const idx = seedIndex(topic, TANG_SAU_SCENE_POOL.length);
  return TANG_SAU_SCENE_POOL[idx] ?? null;
}

function readSidecar(contentId: string): Record<string, unknown> | null {
  const p = path.join(OUTPUT_DIR, `${contentId}-legacy-quote-short.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>; }
  catch { return null; }
}

function detectSpiritualKeywords(keywords: string[]): string[] {
  return keywords.filter(k =>
    SPIRITUAL_KEYWORDS.some(s => k.toLowerCase().includes(s.toLowerCase()))
  );
}

// ── Visual guard on source images ─────────────────────────────────────────────

async function runGuardOnBatch(
  rows: Array<{ content_id: string; topic: string }>,
  label: string,
): Promise<{ ok: number; buddhist: number; text: number; errors: number; details: string[] }> {
  console.log(`\n  Running visual guard on ${rows.length} images for "${label}"…`);
  let ok = 0; let buddhist = 0; let text = 0; let errors = 0;
  const details: string[] = [];

  for (const row of rows) {
    const sidecar = readSidecar(row.content_id);
    const imgPath = sidecar?.sourceImagePath as string | undefined;

    if (!imgPath || !fs.existsSync(imgPath)) {
      console.log(`    [${row.content_id}] ✗ source image not found`);
      errors++;
      details.push(`${row.content_id}: image_not_found`);
      continue;
    }

    try {
      const guard = await inspectTangSauBackground(imgPath);
      if (guard.ok) {
        ok++;
        details.push(`${row.content_id}: ✓ clean`);
        console.log(`    [${row.content_id}] ✓ clean`);
      } else {
        // Classify: Buddhist/spiritual vs text/signage
        const reason = guard.reason.toLowerCase();
        const isBuddhist =
          reason.includes("phật") || reason.includes("tượng") ||
          reason.includes("bàn thờ") || reason.includes("tu hành") ||
          reason.includes("tôn giáo") || reason.includes("buddha") ||
          reason.includes("buddhist") || reason.includes("spiritual") ||
          reason.includes("monk") || reason.includes("religious") ||
          reason.includes("altar") || reason.includes("statue");
        const isText =
          reason.includes("chữ") || reason.includes("bảng") ||
          reason.includes("typography") || reason.includes("signage") ||
          reason.includes("text") || reason.includes("tranh treo");

        if (isBuddhist) buddhist++;
        else if (isText) text++;
        else buddhist++; // default to buddhist if unclear

        const flagType = isBuddhist ? "buddhist" : "text/signage";
        details.push(`${row.content_id}: ✗ FLAGGED [${flagType}] — ${guard.reason.slice(0, 80)}`);
        console.log(`    [${row.content_id}] ✗ FLAGGED [${flagType}]: ${guard.reason.slice(0, 80)}`);
      }
    } catch (e) {
      errors++;
      details.push(`${row.content_id}: guard_error — ${e instanceof Error ? e.message : e}`);
      console.log(`    [${row.content_id}] guard error: ${e instanceof Error ? e.message : e}`);
    }

    await new Promise<void>(r => setTimeout(r, 60));
  }

  return { ok, buddhist, text, errors, details };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log("══════════════════════════════════════════════════════════════");
    console.log("  Tầng Sâu — Kinfolk/Monocle Hotfix Batch Audit");
    console.log(`  Hotfix boundary: ${fmtVn(HOTFIX_BOUNDARY_UTC)} VN`);
    console.log("  Safety: upload_queue rows = 0 | DB mutations = 0 | Uploads = 0");
    console.log("══════════════════════════════════════════════════════════════\n");

    // ── 1. Fetch all tang_sau rows since Jun 5 ────────────────────────────────
    const since = new Date("2026-06-05T00:00:00Z");
    const { rows: queueRows } = await pool.query<{
      id: string; content_id: string; channel_id: number;
      platform: string; status: string; scheduled_at: string; created_at: string;
      topic: string; experiment_variant: string;
    }>(
      `SELECT uq.id, uq.content_id, uq.channel_id, uq.platform, uq.status,
              uq.scheduled_at, uq.created_at,
              cg.topic, cg.experiment_variant
       FROM upload_queue uq
       JOIN content_generations cg ON uq.content_id = cg.id
       WHERE uq.channel_id = $1 AND uq.created_at >= $2
       ORDER BY uq.created_at ASC`,
      [TANG_SAU_CHANNEL_ID, since],
    );

    const { rows: channelRows } = await pool.query<{ name: string; platform: string }>(
      `SELECT name, platform FROM social_channels WHERE id = $1`,
      [TANG_SAU_CHANNEL_ID],
    );
    const channelName = channelRows[0]?.name ?? `channel_${TANG_SAU_CHANNEL_ID}`;
    const channelPlatform = channelRows[0]?.platform ?? "youtube";

    console.log(`  Channel: ${channelName} (id=${TANG_SAU_CHANNEL_ID}, ${channelPlatform})`);
    console.log(`  Total rows since Jun 5: ${queueRows.length}\n`);

    // ── 2. Cluster into batches (rows within 60s = same batch) ────────────────
    const batches: Array<{ batchAt: Date; rows: typeof queueRows; isPostHotfix: boolean }> = [];
    for (const row of queueRows) {
      const ts = new Date(row.created_at);
      const last = batches[batches.length - 1];
      if (!last || ts.getTime() - last.batchAt.getTime() > 60_000) {
        batches.push({ batchAt: ts, rows: [row], isPostHotfix: ts >= HOTFIX_BOUNDARY_UTC });
      } else {
        last.rows.push(row);
      }
    }

    const preBatches = batches.filter(b => !b.isPostHotfix);
    const postBatches = batches.filter(b => b.isPostHotfix);

    console.log(`  Batches total: ${batches.length}`);
    console.log(`    Pre-hotfix:  ${preBatches.length} batches`);
    console.log(`    Post-hotfix: ${postBatches.length} batches ${postBatches.length === 0 ? "⚠ NONE YET — next auto-refill will be first post-hotfix batch" : "✓"}`);

    // ── 3. Per-batch summary ──────────────────────────────────────────────────
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const batchLabel = batch.isPostHotfix ? "POST-HOTFIX ✓" : "pre-hotfix";
      console.log(`\n── Batch ${i + 1}/${batches.length}  [${batchLabel}]  created ${fmtVn(batch.batchAt)} VN  (${batch.rows.length} items) ─`);

      const formatCounts: Record<string, number> = {};
      const catCounts: Record<string, number> = {};
      const brightCounts = { bright: 0, dark: 0, unknown: 0 };
      let layoutWarnings = 0;
      let spiritualKwWarnings = 0;
      const spiritualKwItems: string[] = [];

      for (const row of batch.rows) {
        const variant = row.experiment_variant ?? "unknown";
        const label = VARIANT_LABELS[variant] ?? variant;
        formatCounts[label] = (formatCounts[label] ?? 0) + 1;

        // Scene inference from topic
        const sceneEntry = inferSceneEntry(row.topic ?? "");
        const cat: TangSauSceneCategory | "unknown" = sceneEntry?.category ?? "unknown";
        catCounts[cat] = (catCounts[cat] ?? 0) + 1;
        if (sceneEntry) {
          if (sceneEntry.isDark) brightCounts.dark++;
          else brightCounts.bright++;
        } else {
          brightCounts.unknown++;
        }

        // Sidecar inspection
        const sidecar = readSidecar(row.content_id);
        const kineticText = sidecar?.kineticText as { layoutWarnings?: string[] } | undefined;
        if (kineticText?.layoutWarnings?.length) {
          layoutWarnings += kineticText.layoutWarnings.length;
        }

        // Spiritual keywords in visualSearchKeywords (sidecar metadata — not the fal.ai prompt)
        const vskw = sidecar?.visualSearchKeywords as string[] | undefined ?? [];
        const hits = detectSpiritualKeywords(vskw);
        if (hits.length > 0) {
          spiritualKwWarnings++;
          spiritualKwItems.push(`${row.content_id}: [${hits.join(", ")}]`);
        }

        // Per-row line
        const schedVn = fmtVn(row.scheduled_at);
        const sceneInfo = sceneEntry ? `${sceneEntry.category}/${sceneEntry.isDark ? "dark" : "bright"}` : "scene_unknown";
        const topicShort = (row.topic ?? "").slice(0, 55);
        console.log(`  ${row.content_id.padEnd(26)}  ${label.padEnd(20)}  ${sceneInfo.padEnd(22)}  → ${schedVn}`);
        if (topicShort) console.log(`    "${topicShort}"`);
      }

      const total = batch.rows.length;
      console.log(`\n  Format distribution:`);
      for (const [f, n] of Object.entries(formatCounts).sort())
        console.log(`    ${f.padEnd(22)} ${n}/${total}`);
      console.log(`\n  Scene category (inferred):`);
      for (const [c, n] of Object.entries(catCounts).sort())
        console.log(`    ${c.padEnd(22)} ${n}/${total}`);
      console.log(`\n  Brightness: bright=${brightCounts.bright}/${total}  dark=${brightCounts.dark}/${total}  unknown=${brightCounts.unknown}/${total}`);
      console.log(`  kinetic layoutWarnings: ${layoutWarnings}`);

      if (spiritualKwWarnings > 0) {
        console.log(`\n  ⚠ visualSearchKeywords spiritual terms (metadata field, NOT fal.ai prompt):`);
        console.log(`    ${spiritualKwWarnings}/${total} items have spiritual keywords in sidecar metadata`);
        for (const s of spiritualKwItems) console.log(`    ${s}`);
        console.log(`    Note: visualSearchKeywords do not affect fal.ai generation for Tang Sau.`);
        console.log(`    The fal.ai prompt uses TANG_SAU_SCENE_POOL, not these keywords.`);
        console.log(`    Recommend: update getLegacyQuoteVisualKeywords to strip spiritual terms for Tang Sau.`);
      } else {
        console.log(`  visualSearchKeywords: ✓ no spiritual terms`);
      }
    }

    // ── 4. Visual guard on most recent batch ──────────────────────────────────
    const mostRecent = batches[batches.length - 1];
    if (mostRecent) {
      const batchLabel = mostRecent.isPostHotfix ? "POST-hotfix" : "PRE-hotfix";
      console.log(`\n── Visual guard: most recent batch (${batchLabel}, ${mostRecent.rows.length} items) ─────────`);
      const guardResult = await runGuardOnBatch(
        mostRecent.rows.map(r => ({ content_id: r.content_id, topic: r.topic ?? "" })),
        `Batch ${batches.length} [${batchLabel}]`,
      );
      const total = mostRecent.rows.length;
      const checked = total - guardResult.errors;
      console.log(`\n  Guard results (${checked}/${total} images checked):`);
      console.log(`    ✓ clean:          ${guardResult.ok}/${checked}`);
      console.log(`    ✗ Buddhist/spir:  ${guardResult.buddhist}/${checked}  ${guardResult.buddhist === 0 ? "(hotfix target met ✓)" : "⚠ FOUND"}`);
      console.log(`    ✗ text/signage:   ${guardResult.text}/${checked}  ${guardResult.text <= 1 ? "✓" : "⚠ above 1"}`);
      console.log(`    ✗ errors:         ${guardResult.errors}/${total}`);
      for (const d of guardResult.details) console.log(`    ${d}`);
    }

    // ── 5. Destination / upload_queue impact ──────────────────────────────────
    const statusCounts: Record<string, number> = {};
    for (const r of queueRows) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }
    console.log(`\n── Upload queue impact ───────────────────────────────────────────────`);
    console.log(`  Destination: ${channelName} (id=${TANG_SAU_CHANNEL_ID}, ${channelPlatform}) only`);
    console.log(`  Total rows since Jun 5: ${queueRows.length}`);
    for (const [s, n] of Object.entries(statusCounts).sort())
      console.log(`    status=${s.padEnd(8)} ${n}`);
    console.log(`\n  This audit: no mutations. No uploads. No queue changes.`);

    // ── 6. Post-hotfix status ─────────────────────────────────────────────────
    console.log(`\n── Post-hotfix status ────────────────────────────────────────────────`);
    if (postBatches.length === 0) {
      console.log(`  ⚠ No post-hotfix batch found yet.`);
      console.log(`  The Kinfolk/Monocle prompt change is live in the codebase but`);
      console.log(`  the auto-refill has not run since the hotfix was applied.`);
      console.log(`  Next auto-refill will be the first post-hotfix batch.`);
      console.log(`  Re-run this script after the next refill to compare guard results.`);
    } else {
      console.log(`  ✓ ${postBatches.length} post-hotfix batch(es) found.`);
    }

    // ── 7. Summary ────────────────────────────────────────────────────────────
    console.log(`\n══════════════════════════════════════════════════════════════`);
    console.log(`  SUMMARY`);
    console.log(`══════════════════════════════════════════════════════════════`);
    console.log(`  Total batches:       ${batches.length}`);
    console.log(`  Pre-hotfix batches:  ${preBatches.length}`);
    console.log(`  Post-hotfix batches: ${postBatches.length}`);
    console.log(`  Total queued rows:   ${queueRows.length}`);
    console.log(`  upload_queue rows created this audit: 0`);
    console.log(`  DB mutations: 0`);
    console.log(`  Uploads: 0`);

  } finally {
    await pool.end();
    // Clean up temp file if exists
    const tmpFile = path.join(process.cwd(), "scripts", "_tmp_query_recent.ts");
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
