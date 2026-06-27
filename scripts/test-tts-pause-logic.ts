/**
 * Test script: validate TTS punctuation-pause logic on sample Vietnamese text.
 *
 * Does NOT call TTS server or modify any DB/files.
 * Tests parseTextWordPuncts and alignAndBuildInsertions with mock Whisper words.
 *
 * Run:  npx tsx scripts/test-tts-pause-logic.ts
 */

// ── Inline copies of the pure functions from tts.ts for isolated testing ─────

type TextWordEntry = { wordLower: string; pause: "comma" | "sentence" | null };
type WhisperWord   = { word: string; start: number; end: number };
type PauseInsertion = { insertAfterSec: number; pauseMs: number; type: "comma" | "sentence" };
type PauseProfile  = { name: string; commaPauseMs: number; sentencePauseMs: number; paragraphPauseMs: number };

const BUDDHIST_CALM_PROFILE: PauseProfile = {
  name: "buddhist_calm",
  commaPauseMs: 220,
  sentencePauseMs: 560,
  paragraphPauseMs: 850,
};

function normWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
}

function parseTextWordPuncts(text: string): TextWordEntry[] {
  const result: TextWordEntry[] = [];
  const tokens = text.split(/\s+/);
  for (const token of tokens) {
    if (!token) continue;
    const m = /^([\p{L}\d]+)(.*)/u.exec(token);
    if (!m) continue;
    const wordLower = m[1].toLowerCase();
    const punct = m[2] ?? "";
    let pause: "comma" | "sentence" | null = null;
    if (/[,;:]/.test(punct)) pause = "comma";
    else if (/[.!?…]/.test(punct)) pause = "sentence";
    result.push({ wordLower, pause });
  }
  return result;
}

function alignAndBuildInsertions(
  whisperWords: WhisperWord[],
  textWords: TextWordEntry[],
  profile: PauseProfile,
): PauseInsertion[] {
  const insertions: PauseInsertion[] = [];
  let ti = 0;

  for (let wi = 0; wi < whisperWords.length && ti < textWords.length; wi++) {
    const wNorm = normWord(whisperWords[wi].word);
    if (!wNorm) continue;

    let matched = -1;
    for (let look = 0; look < 4 && ti + look < textWords.length; look++) {
      const tNorm = textWords[ti + look].wordLower;
      if (
        wNorm === tNorm ||
        (wNorm.length >= 2 && tNorm.length >= 2 && (wNorm.startsWith(tNorm) || tNorm.startsWith(wNorm)))
      ) {
        matched = ti + look;
        break;
      }
    }

    if (matched < 0) continue;

    ti = matched + 1;
    const tw = textWords[matched];
    const endSec = whisperWords[wi].end;

    if (tw.pause === "comma") {
      insertions.push({ insertAfterSec: endSec, pauseMs: profile.commaPauseMs, type: "comma" });
    } else if (tw.pause === "sentence") {
      insertions.push({ insertAfterSec: endSec, pauseMs: profile.sentencePauseMs, type: "sentence" });
    }
  }

  return insertions;
}

// ── Test ─────────────────────────────────────────────────────────────────────

const SAMPLE_TEXT = "Đừng vội trả thù. Người làm tổn thương bạn, rồi cũng sẽ học bài học của họ. Bạn chỉ cần im lặng, sống tử tế, và bước tiếp.";

console.log("═══════════════════════════════════════════════════════════");
console.log("  TTS pause-logic test — sample Vietnamese Buddhist text");
console.log("═══════════════════════════════════════════════════════════");
console.log(`\nInput: "${SAMPLE_TEXT}"\n`);

// 1. Parse text word/punct pairs
const textWords = parseTextWordPuncts(SAMPLE_TEXT);
console.log("── parseTextWordPuncts ──────────────────────────────────────");
console.log("idx | word              | pause");
console.log("─".repeat(45));
for (const [i, tw] of textWords.entries()) {
  console.log(`${String(i).padStart(3)} | ${tw.wordLower.padEnd(18)} | ${tw.pause ?? "(none)"}`);
}

const punctCount = textWords.filter(tw => tw.pause !== null).length;
const sentenceCount = textWords.filter(tw => tw.pause === "sentence").length;
const commaCount = textWords.filter(tw => tw.pause === "comma").length;
console.log(`\nTotal words: ${textWords.length}`);
console.log(`Words with pause: ${punctCount} (sentence=${sentenceCount}, comma=${commaCount})`);

// 2. Simulate Whisper timestamps (approximate, word-by-word timing at ~4 syllables/sec)
// Vietnamese words average ~0.3s spoken duration
const simulatedWhisper: WhisperWord[] = [];
let t = 0.1; // start 100ms in
for (const tw of textWords) {
  const dur = 0.25 + (tw.wordLower.length * 0.03); // rough duration
  simulatedWhisper.push({ word: tw.wordLower, start: t, end: t + dur });
  t += dur + (tw.pause === "sentence" ? 0.1 : tw.pause === "comma" ? 0.05 : 0.02);
}
const totalRawDuration = t;

console.log(`\n── Simulated Whisper (${simulatedWhisper.length} words, ~${totalRawDuration.toFixed(2)}s) ──`);

// 3. Build insertions
const insertions = alignAndBuildInsertions(simulatedWhisper, textWords, BUDDHIST_CALM_PROFILE);

console.log("\n── Pause insertions ─────────────────────────────────────────");
console.log("type     | after_sec | pause_ms");
console.log("─".repeat(40));
for (const ins of insertions) {
  console.log(`${ins.type.padEnd(8)} | ${ins.insertAfterSec.toFixed(3).padStart(9)} | ${ins.pauseMs}`);
}

const totalSilenceMs = insertions.reduce((s, i) => s + i.pauseMs, 0);
const totalSilenceSec = totalSilenceMs / 1000;
console.log(`\nTotal pauses: ${insertions.length} (${insertions.filter(i => i.type === "sentence").length} sentence, ${insertions.filter(i => i.type === "comma").length} comma)`);
console.log(`Total silence injected: ${totalSilenceMs}ms (${totalSilenceSec.toFixed(3)}s)`);
console.log(`Final audio duration: ~${(totalRawDuration + totalSilenceSec).toFixed(2)}s (was ${totalRawDuration.toFixed(2)}s)`);

// 4. Assertions
console.log("\n── Assertions ───────────────────────────────────────────────");
let pass = true;

function assert(label: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    pass = false;
  }
}

assert("parseTextWordPuncts finds 3 sentence pauses (.)", sentenceCount === 3);
assert("parseTextWordPuncts finds 3 comma pauses (,)", commaCount === 3);
assert("alignAndBuildInsertions returns >= 4 insertions", insertions.length >= 4);
assert("all sentence insertions use sentencePauseMs=560", insertions.filter(i => i.type === "sentence").every(i => i.pauseMs === 560));
assert("all comma insertions use commaPauseMs=220", insertions.filter(i => i.type === "comma").every(i => i.pauseMs === 220));
assert("total silence injected > 500ms", totalSilenceMs > 500);
assert("insertions are in temporal order", insertions.every((ins, i) => i === 0 || ins.insertAfterSec >= insertions[i - 1].insertAfterSec));

console.log(`\n${pass ? "✓ ALL ASSERTIONS PASS" : "✗ SOME ASSERTIONS FAILED"}`);
console.log("═══════════════════════════════════════════════════════════");

if (!pass) process.exit(1);
