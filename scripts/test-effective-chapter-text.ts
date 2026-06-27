// Pure unit test for getEffectiveChapterTextState — no DB required. Confirms approved/
// pending/blocked manual audio_text correctly overrides a failed/empty raw source for
// effective word count and TTS readiness, while raw provenance fields stay untouched.
import assert from "node:assert/strict";
import { getEffectiveChapterTextState, type EffectiveChapterTextInput } from "@/lib/story-library/effective-text";

const CLEAN_TEXT = Array.from(
  { length: 30 },
  (_, i) => `Đây là phiên bản sạch số ${i + 1} kể về câu chuyện hôm nay rồi.`
).join(" ");

function baseChapter(overrides: Partial<EffectiveChapterTextInput>): EffectiveChapterTextInput {
  return {
    crawlStatus: "failed",
    lastError: "source_missing_chapter",
    contentText: null,
    wordCount: 0,
    audioText: null,
    audioTextStatus: "raw",
    audioTextSource: null,
    audioTextReviewedAt: null,
    ...overrides,
  };
}

function main() {
  // 1. raw failed + approved manual audio_text => effectiveWordCount > 0, isTtsReady.
  {
    const state = getEffectiveChapterTextState(
      baseChapter({ audioText: CLEAN_TEXT, audioTextStatus: "approved", audioTextSource: "manual_import" })
    );
    assert.ok(state.effectiveStatus.effectiveWordCount > 0, "approved manual audio_text must yield a non-zero effective word count");
    assert.equal(state.effectiveStatus.isTtsReady, true, "approved manual audio_text must be TTS-ready");
    assert.equal(state.effectiveStatus.effectiveTextSource, "approved_audio_text");
    assert.equal(state.effectiveStatus.label, "TTS-ready via approved manual audio text");
    assert.equal(state.rawStatus.rawWordCount, 0, "raw word count must stay 0 — never overwritten");
    assert.equal(state.rawStatus.crawlStatus, "failed", "raw crawl status must stay failed — provenance only");
  }

  // 2. raw failed + pass-but-unapproved manual audio_text => "Ready to approve", not missing.
  {
    const state = getEffectiveChapterTextState(
      baseChapter({ audioText: CLEAN_TEXT, audioTextStatus: "needs_review", audioTextSource: "manual_import" }),
      { liveAnalyzerStatus: "pass" }
    );
    assert.equal(state.effectiveStatus.needsApproval, true);
    assert.equal(state.effectiveStatus.isTtsReady, false);
    assert.equal(state.effectiveStatus.isBlocked, false);
    assert.equal(state.effectiveStatus.label, "Ready to approve for TTS");
    assert.ok(state.effectiveStatus.effectiveWordCount > 0, "pending-approval text must still report a real word count");
  }

  // 3. raw failed + blocked manual audio_text => blocked, not "ready to approve".
  {
    const state = getEffectiveChapterTextState(
      baseChapter({ audioText: CLEAN_TEXT + " Anh đ*i đâu vậy?", audioTextStatus: "blocked", audioTextSource: "manual_import" }),
      { liveAnalyzerStatus: "block" }
    );
    assert.equal(state.effectiveStatus.isBlocked, true);
    assert.equal(state.effectiveStatus.isTtsReady, false);
    assert.equal(state.effectiveStatus.needsApproval, false);
    assert.equal(state.effectiveStatus.label, "Blocked by audio text issues");
  }

  // 4. A "needs_review" DB status can be a human override on text that is still
  // genuinely blocked — liveAnalyzerStatus must win over the DB enum.
  {
    const state = getEffectiveChapterTextState(
      baseChapter({ audioText: CLEAN_TEXT + " Anh đ*i đâu vậy?", audioTextStatus: "needs_review", audioTextSource: "manual_import" }),
      { liveAnalyzerStatus: "block" }
    );
    assert.equal(state.effectiveStatus.isBlocked, true, "live re-analysis must override a stale needs_review DB status");
    assert.equal(state.effectiveStatus.needsApproval, false);
  }

  // 5. Raw word_count must remain 0/unchanged regardless of audio_text state — never
  // derived from or overwritten by the audio text layer.
  {
    const approved = getEffectiveChapterTextState(
      baseChapter({ audioText: CLEAN_TEXT, audioTextStatus: "approved", audioTextSource: "manual_import" })
    );
    assert.equal(approved.rawStatus.rawWordCount, 0, "raw word_count must stay 0 after manual import + approve");
    assert.equal(approved.rawStatus.rawCharCount, 0);
  }

  // 6. Effective word/char counts must be computed from audio_text content, not raw.
  {
    const state = getEffectiveChapterTextState(
      baseChapter({ audioText: CLEAN_TEXT, audioTextStatus: "approved", audioTextSource: "manual_import" })
    );
    assert.equal(state.effectiveStatus.effectiveWordCount, state.audioTextStatus.audioTextWordCount);
    assert.equal(state.effectiveStatus.effectiveCharCount, CLEAN_TEXT.length);
  }

  // 7. Normal chapter with raw text, no audio_text at all — falls back to raw_content_text.
  {
    const state = getEffectiveChapterTextState(
      baseChapter({ crawlStatus: "done", lastError: null, contentText: CLEAN_TEXT, wordCount: 30 })
    );
    assert.equal(state.effectiveStatus.effectiveTextSource, "raw_content_text");
    assert.equal(state.effectiveStatus.isTtsReady, true);
    assert.equal(state.effectiveStatus.effectiveWordCount, 30);
  }

  // 8. Neither usable raw nor audio_text — unresolved/missing for audio.
  {
    const state = getEffectiveChapterTextState(baseChapter({}));
    assert.equal(state.effectiveStatus.effectiveTextSource, "none");
    assert.equal(state.effectiveStatus.effectiveWordCount, 0);
    assert.equal(state.effectiveStatus.isTtsReady, false);
    assert.equal(state.effectiveStatus.label, "Missing usable text");
  }

  console.log("[STORY_CRAWLER] effective_chapter_text_smoke_ok");
}

main();
