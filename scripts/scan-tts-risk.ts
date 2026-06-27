/**
 * Scan upcoming TTS Short content for "nhX, nhY" phonological risk pattern
 * that triggers VieNeu-TTS (ngoc voice) elongation artifact.
 *
 * Risk pattern confirmed: two words sharing an initial consonant cluster
 * separated by a comma, e.g. "nhà, như" → TTS elongates second word.
 *
 * Does NOT mutate DB, queue, or any media.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// Confirmed risk pattern (GxR_7Ib73Nw audit):
// two "nh-" words across a comma e.g. "nhà, như", "nhỏ, nhẹ"
// Uses \p{L} (Unicode letter) — required for Vietnamese diacritics.
const NH_COMMA_NH = /(nh\p{L}+),\s*(nh)/gu;

function checkRiskyPatterns(text: string): string[] {
  const risks: string[] = [];
  const matches = [...text.matchAll(NH_COMMA_NH)];
  for (const m of matches) {
    risks.push(`nh-comma-nh: "${m[0]}"`);
  }
  return risks;
}

function normalizeTextForTTS(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/(nh\p{L}*),\s*(nh)/gu, "$1. $2")
    .trim();
}

async function main() {
  console.log("═══ TTS Risk Scan — queued/upcoming TTS Shorts ═══\n");

  const rows = await db.execute(sql`
    SELECT
      cg.id as content_id,
      cg.topic,
      cg.short_content,
      cg.channel_key,
      cg.tts_status,
      cg.audio_path,
      cg.created_at,
      uq.id as uq_id,
      uq.status as uq_status,
      uq.scheduled_at,
      uq.video_type,
      n.tts_voice
    FROM content_generations cg
    JOIN upload_queue uq ON uq.content_id = cg.id
    LEFT JOIN niches n ON n.id = cg.niche_id
    WHERE uq.status IN ('queued', 'uploading', 'pending')
      AND uq.video_type = 'short'
      AND cg.format_type = 'tts_short'
    ORDER BY uq.scheduled_at ASC
    LIMIT 200
  `);

  console.log(`Scanned: ${rows.rows.length} queued TTS Short items\n`);

  let riskyCount = 0;
  for (const row of rows.rows) {
    const rawText = row.short_content as string;
    if (!rawText) continue;
    const normalized = normalizeTextForTTS(rawText);
    const risks = checkRiskyPatterns(normalized);
    if (risks.length > 0) {
      riskyCount++;
      console.log(`─── RISKY CONTENT ──────────────────────────────────`);
      console.log(`  content_id:  ${row.content_id}`);
      console.log(`  topic:       ${row.topic}`);
      console.log(`  channel_key: ${row.channel_key}`);
      console.log(`  voice:       ${row.tts_voice ?? "default"}`);
      console.log(`  tts_status:  ${row.tts_status}`);
      console.log(`  audio_path:  ${row.audio_path}`);
      console.log(`  uq_status:   ${row.uq_status}`);
      console.log(`  scheduled:   ${row.scheduled_at}`);
      console.log(`  risks:`);
      for (const r of risks) {
        console.log(`    ⚠️  ${r}`);
      }
    }
  }

  if (riskyCount === 0) {
    console.log("✅ No risky patterns found in queued TTS Shorts.");
  } else {
    console.log(`\n⚠️  Found ${riskyCount} risky item(s). Review audio quality before they upload.`);
  }

  // Also scan for upcoming (not yet in queue but audio already exists)
  console.log("\n═══ Also scanning recent content with tts_status=done ═══");
  const recent = await db.execute(sql`
    SELECT
      cg.id as content_id,
      cg.topic,
      cg.short_content,
      cg.channel_key,
      cg.tts_status,
      cg.audio_path,
      cg.created_at,
      n.tts_voice
    FROM content_generations cg
    LEFT JOIN niches n ON n.id = cg.niche_id
    WHERE cg.tts_status = 'done'
      AND cg.format_type = 'tts_short'
      AND cg.created_at > NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM upload_queue uq
        WHERE uq.content_id = cg.id
          AND uq.status IN ('done', 'cancelled', 'error')
      )
    ORDER BY cg.created_at DESC
    LIMIT 100
  `);

  console.log(`Scanned: ${recent.rows.length} recent TTS Short items with audio\n`);

  let recentRiskyCount = 0;
  for (const row of recent.rows) {
    const rawText = row.short_content as string;
    if (!rawText) continue;
    const normalized = normalizeTextForTTS(rawText);
    const risks = checkRiskyPatterns(normalized);
    if (risks.length > 0) {
      recentRiskyCount++;
      console.log(`─── RISKY (audio exists, not yet uploaded) ──────────`);
      console.log(`  content_id:  ${row.content_id}`);
      console.log(`  topic:       ${row.topic}`);
      console.log(`  voice:       ${row.tts_voice ?? "default"}`);
      console.log(`  audio_path:  ${row.audio_path}`);
      console.log(`  created_at:  ${row.created_at}`);
      for (const r of risks) {
        console.log(`    ⚠️  ${r}`);
      }
    }
  }

  if (recentRiskyCount === 0) {
    console.log("✅ No risky patterns in recent TTS-done content.");
  } else {
    console.log(`\n⚠️  Found ${recentRiskyCount} item(s) with audio but not yet published that may be at risk.`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
