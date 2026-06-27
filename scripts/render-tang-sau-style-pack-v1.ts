/**
 * Render preview videos for Tầng Sâu Text Style Pack V1.
 *
 * Renders 2× Note Letter Card, 2× Kinetic Text, 2× Bilingual Minimal, 1× Reflection Card.
 * Does NOT touch upload_queue, schedule, or DB records.
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import {
  renderLegacyQuoteShort,
  type KineticTextSidecar,
} from "@/lib/legacy-quote-short-generator";

config({ path: ".env.local" });
config();

// ── Resource helpers ─────────────────────────────────────────────────────────

const MUSIC_DIR = path.join(process.cwd(), "media", "music", "phat-phap");
const OUTPUT_DIR = path.join(process.cwd(), "output", "tang-sau-style-pack-v1-render");

function pickMusicRelative(seed: string): string {
  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|m4a|wav)$/i.test(f))
    .sort();
  if (files.length === 0) throw new Error("No music files found in " + MUSIC_DIR);
  const idx =
    Array.from(seed).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("media", "music", "phat-phap", files[idx]!);
}

function pickSourceImage(seed: string): string {
  const imgDir = path.join(process.cwd(), "output", "legacy-quote-short-v1");
  const files = fs
    .readdirSync(imgDir)
    .filter((f) => f.endsWith("-legacy-quote-card.jpg"))
    .sort();
  if (files.length === 0) throw new Error("No source images found in " + imgDir);
  const idx =
    Array.from(seed).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("output", "legacy-quote-short-v1", files[idx]!);
}

// ── Sample definitions ────────────────────────────────────────────────────────

const COMMON = {
  workspaceId: "tang_sau_workspace",
  channelProfileId: "tang_sau_v1",
  channelKey: "tang_sau",
  contentProfileKey: "philosophy",
  channelName: "Tầng Sâu",
  experimentId: "LEGACY_QUOTE_SHORT",
  outputDir: OUTPUT_DIR,
};

type SampleSpec = {
  contentId: string;
  topic: string;
  topicFamily: string;
  quoteText: string;
  experimentVariant: string;
  visualMode: Parameters<typeof renderLegacyQuoteShort>[0]["visualMode"];
  quoteStyle: Parameters<typeof renderLegacyQuoteShort>[0]["quoteStyle"];
  durationSec?: number;
  reflectionText?: string;
  noteLetterText?: string;
  englishLine?: string;
  kineticText?: KineticTextSidecar;
};

const SAMPLES: SampleSpec[] = [
  // ── Note Letter Card ─────────────────────────────────────────────────────────
  {
    contentId: "ts-nl-render-01",
    topic: "Có những ngày không muốn trả lời tin nhắn của ai",
    topicFamily: "modern_loneliness",
    quoteText: "Có những ngày, một tin nhắn cũng làm mình thấy mệt.",
    experimentVariant: "LEGACY_QUOTE_NOTE_LETTER_V1",
    visualMode: "note_letter_card",
    quoteStyle: "note_letter",
    noteLetterText:
      "Có những ngày,\nmột tin nhắn cũng làm mình thấy mệt.\n\nKhông phải vì ghét ai.\nChỉ là mình không còn đủ sức\nđể trả lời như chưa có gì xảy ra.",
  },
  {
    contentId: "ts-nl-render-02",
    topic: "Đôi khi im lặng không phải vì không có gì để nói",
    topicFamily: "meaning_silence",
    quoteText: "Đôi khi mình không im lặng vì không có gì để nói.",
    experimentVariant: "LEGACY_QUOTE_NOTE_LETTER_V1",
    visualMode: "note_letter_card",
    quoteStyle: "note_letter",
    noteLetterText:
      "Đôi khi mình không im lặng\nvì không có gì để nói.\n\nMình im lặng vì đã giải thích\nquá nhiều lần rồi.\nVà lần nào cũng không đến đâu.",
  },

  // ── Kinetic Text ──────────────────────────────────────────────────────────────
  {
    contentId: "ts-kt-render-01",
    topic: "Có những người dần dần im lặng rồi biến mất",
    topicFamily: "modern_loneliness",
    quoteText: "Có những người không rời đi họ chỉ im lặng dần.",
    experimentVariant: "LEGACY_QUOTE_KINETIC_TEXT_V1",
    visualMode: "kinetic_typography",
    quoteStyle: "kinetic_quote",
    durationSec: 8,
    kineticText: {
      chunks: [
        { text: "Có những người", emphasis: false, size: "medium" },
        { text: "không rời đi", emphasis: true, size: "large" },
        { text: "họ chỉ", emphasis: false, size: "small" },
        { text: "im lặng dần.", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["không rời đi", "im lặng dần."],
    },
  },
  {
    contentId: "ts-kt-render-02",
    topic: "Mệt không phải vì làm nhiều mà vì giả vờ ổn",
    topicFamily: "modern_loneliness",
    quoteText: "Không phải làm nhiều. Mà vì giả vờ ổn quá lâu.",
    experimentVariant: "LEGACY_QUOTE_KINETIC_TEXT_V1",
    visualMode: "kinetic_typography",
    quoteStyle: "kinetic_quote",
    durationSec: 8,
    kineticText: {
      chunks: [
        { text: "Không phải", emphasis: false, size: "medium" },
        { text: "làm nhiều.", emphasis: false, size: "small" },
        { text: "Mà vì", emphasis: false, size: "small" },
        { text: "giả vờ ổn", emphasis: true, size: "large" },
        { text: "quá lâu.", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["giả vờ ổn", "quá lâu."],
    },
  },

  // ── Bilingual Minimal ────────────────────────────────────────────────────────
  {
    contentId: "ts-bi-render-01",
    topic: "Có những người không rời đi mà chỉ dần im lặng",
    topicFamily: "modern_loneliness",
    quoteText: "Có những người không rời đi. Họ chỉ im lặng dần.",
    experimentVariant: "LEGACY_QUOTE_BILINGUAL_MINIMAL_V1",
    visualMode: "bilingual_minimal",
    quoteStyle: "bilingual_minimal",
    englishLine: "Some people don't leave.\nThey just go quiet.",
  },
  {
    contentId: "ts-bi-render-02",
    topic: "Cô đơn không phải vì ở một mình mà vì không ai thật sự hiểu",
    topicFamily: "modern_loneliness",
    quoteText: "Ở một mình và cảm thấy cô đơn là hai điều khác nhau.",
    experimentVariant: "LEGACY_QUOTE_BILINGUAL_MINIMAL_V1",
    visualMode: "bilingual_minimal",
    quoteStyle: "bilingual_minimal",
    englishLine: "Being alone and feeling lonely\nare two different things.",
  },

  // ── Tightened Reflection Card ────────────────────────────────────────────────
  {
    contentId: "ts-rc-render-01",
    topic: "Càng lớn càng ít nói vì đã quen rồi không ai thật sự hỏi",
    topicFamily: "modern_loneliness",
    quoteText: "Càng lớn càng ít nói. Không phải vì không có gì, mà vì đã quen rồi.",
    experimentVariant: "LEGACY_QUOTE_REFLECTION_V1",
    visualMode: "quote_reflection_card",
    quoteStyle: "reflection_card",
    reflectionText:
      "Có những câu hỏi về bản thân mà mình thôi không hỏi nữa. Không phải đã có đáp án, chỉ là không còn muốn nghe tiếng vang lại.",
  },
];

// ── Render loop ───────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let successCount = 0;
  let failCount = 0;
  const results: Array<{ contentId: string; ok: boolean; thumb?: string; sidecar?: string; error?: string }> = [];

  for (const sample of SAMPLES) {
    const musicPath = pickMusicRelative(sample.contentId);
    const sourceImagePath = pickSourceImage(sample.contentId);

    console.log(`\n▶ Rendering ${sample.contentId} [${sample.experimentVariant}]`);
    console.log(`  topic: ${sample.topic.slice(0, 60)}`);

    try {
      const meta = await renderLegacyQuoteShort({
        contentId: sample.contentId,
        topic: sample.topic,
        topicFamily: sample.topicFamily,
        sourceImagePath,
        quoteText: sample.quoteText,
        reflectionText: sample.reflectionText,
        noteLetterText: sample.noteLetterText,
        englishLine: sample.englishLine,
        kineticText: sample.kineticText,
        durationSec: sample.durationSec,
        musicPath,
        experimentVariant: sample.experimentVariant,
        visualMode: sample.visualMode,
        quoteStyle: sample.quoteStyle,
        visualMood: "editorial_stillness",
        musicMood: "ambient_reflection",
        ...COMMON,
      });

      // Verify sidecar fields
      const checks: Record<string, boolean> = {
        formatType: meta.formatType === "legacy_quote_short",
        experimentId: meta.experimentId === "LEGACY_QUOTE_SHORT",
        experimentVariant: meta.experimentVariant === sample.experimentVariant,
        visualMode: meta.visualMode === sample.visualMode,
        quoteStyle: meta.quoteStyle === sample.quoteStyle,
        workspaceId: meta.workspaceId === "tang_sau_workspace",
        channelProfileId: meta.channelProfileId === "tang_sau_v1",
        channelKey: meta.channelKey === "tang_sau",
        contentProfileKey: meta.contentProfileKey === "philosophy",
      };
      const allOk = Object.values(checks).every(Boolean);
      const failed = Object.entries(checks)
        .filter(([, v]) => !v)
        .map(([k]) => k);

      console.log(`  ✓ video: ${meta.videoPath}`);
      console.log(`  ✓ thumb: ${meta.renderedImagePath}`);
      console.log(`  ✓ duration: ${meta.durationSec}s`);
      console.log(`  ✓ audio: mean=${meta.audioValidation.meanVolumeDb?.toFixed(1)}dB`);
      if (!allOk) {
        console.log(`  ✗ sidecar field failures: ${failed.join(", ")}`);
      } else {
        console.log(`  ✓ sidecar fields all OK`);
      }

      results.push({
        contentId: sample.contentId,
        ok: allOk,
        thumb: meta.renderedImagePath,
        sidecar: meta.metadataPath,
      });
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ERROR: ${msg}`);
      results.push({ contentId: sample.contentId, ok: false, error: msg });
      failCount++;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════");
  console.log(`Rendered: ${successCount} OK  ${failCount} FAIL`);
  console.log("\nOutput thumbnails:");
  for (const r of results) {
    const status = r.ok ? "✓" : "✗";
    console.log(`  ${status} ${r.contentId}`);
    if (r.thumb) console.log(`     thumb: ${r.thumb}`);
    if (r.error) console.log(`     error: ${r.error}`);
  }
  console.log("\nupload_queue rows created: 0 (render-only script)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
