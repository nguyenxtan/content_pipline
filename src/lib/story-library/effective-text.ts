// Pure, read-only resolver for "what text/word-count/readiness should every UI and
// pipeline consumer treat as authoritative for this chapter". Raw provenance (crawl
// status, raw word_count, raw content_text) is never modified by this module — it
// only computes a derived view on top of it, the same way audio-text-normalizer.ts
// derives audio_text without touching content_text.
//
// Centralizes a rule that was previously duplicated (and inconsistently applied)
// across the chapter detail page, audio-readiness.ts, and audio-episode-planner.ts:
// an approved/pass manual audio_text is the effective text for TTS purposes, even
// when the raw crawl failed or has 0 words. Raw status stays visible as provenance,
// it just stops driving "is this chapter usable" once a human has approved better text.

import { countWords } from "./text";
import type { AudioTextStatus } from "./audio-text-normalizer";

export type EffectiveTextSource = "approved_audio_text" | "audio_text_pending_approval" | "raw_content_text" | "none";

export type EffectiveChapterTextInput = {
  crawlStatus: string;
  lastError: string | null;
  contentText: string | null;
  wordCount: number;
  audioText: string | null;
  audioTextStatus: string;
  audioTextSource: string | null;
  audioTextReviewedAt: Date | null;
};

export type EffectiveChapterTextState = {
  rawStatus: {
    crawlStatus: string;
    rawWordCount: number;
    rawCharCount: number;
    rawSourceState: string;
  };
  audioTextStatus: {
    audioTextStatus: string;
    audioTextSource: string | null;
    audioTextWordCount: number;
    audioTextCharCount: number;
    audioTextReviewedAt: Date | null;
  };
  effectiveStatus: {
    effectiveTextSource: EffectiveTextSource;
    effectiveWordCount: number;
    effectiveCharCount: number;
    isTtsReady: boolean;
    needsApproval: boolean;
    isBlocked: boolean;
    label: string;
  };
};

/**
 * `liveAnalyzerStatus` is optional: when the caller already has a fresh
 * `analyzeChapterAudioText` result (e.g. the chapter detail page), pass its `.status`
 * so a human "Mark needs review" override on text that is still genuinely blocked is
 * correctly reported as blocked rather than trusted at face value. Callers without a
 * live analysis (bulk readiness/candidate board, which intentionally avoid re-analyzing
 * every chapter's text for performance) fall back to the persisted DB status alone.
 */
export function getEffectiveChapterTextState(
  chapter: EffectiveChapterTextInput,
  options?: { liveAnalyzerStatus?: AudioTextStatus }
): EffectiveChapterTextState {
  const rawWordCount = chapter.wordCount;
  const rawCharCount = chapter.contentText?.length ?? 0;
  const rawSourceState = chapter.lastError === "source_missing_chapter" ? "source_missing_chapter" : (chapter.lastError ?? chapter.crawlStatus);

  const hasAudioText = Boolean(chapter.audioText?.trim());
  const audioTextWordCount = hasAudioText ? countWords(chapter.audioText!) : 0;
  const audioTextCharCount = chapter.audioText?.length ?? 0;

  const isApproved = chapter.audioTextStatus === "approved";
  const isActuallyBlocked = options?.liveAnalyzerStatus
    ? options.liveAnalyzerStatus === "block"
    : chapter.audioTextStatus === "blocked";

  let effectiveTextSource: EffectiveTextSource;
  let effectiveWordCount: number;
  let effectiveCharCount: number;
  let isTtsReady = false;
  let needsApproval = false;
  let isBlocked = false;
  let label: string;

  if (hasAudioText && isApproved) {
    effectiveTextSource = "approved_audio_text";
    effectiveWordCount = audioTextWordCount;
    effectiveCharCount = audioTextCharCount;
    isTtsReady = true;
    label = chapter.audioTextSource === "manual_import"
      ? "TTS-ready via approved manual audio text"
      : "TTS-ready via approved audio text";
  } else if (hasAudioText && isActuallyBlocked) {
    effectiveTextSource = "audio_text_pending_approval";
    effectiveWordCount = audioTextWordCount;
    effectiveCharCount = audioTextCharCount;
    isBlocked = true;
    label = "Blocked by audio text issues";
  } else if (hasAudioText) {
    // needs_review/normalized with no real (live-checked) blockers — analyzer pass/warn,
    // just awaiting an explicit approve click.
    effectiveTextSource = "audio_text_pending_approval";
    effectiveWordCount = audioTextWordCount;
    effectiveCharCount = audioTextCharCount;
    needsApproval = true;
    label = "Ready to approve for TTS";
  } else if (chapter.contentText?.trim() && rawWordCount > 0) {
    effectiveTextSource = "raw_content_text";
    effectiveWordCount = rawWordCount;
    effectiveCharCount = rawCharCount;
    isTtsReady = chapter.crawlStatus === "done";
    label = isTtsReady ? "TTS-ready via raw chapter text" : "Missing usable text";
  } else {
    effectiveTextSource = "none";
    effectiveWordCount = 0;
    effectiveCharCount = 0;
    label = "Missing usable text";
  }

  return {
    rawStatus: { crawlStatus: chapter.crawlStatus, rawWordCount, rawCharCount, rawSourceState },
    audioTextStatus: {
      audioTextStatus: chapter.audioTextStatus,
      audioTextSource: chapter.audioTextSource,
      audioTextWordCount,
      audioTextCharCount,
      audioTextReviewedAt: chapter.audioTextReviewedAt,
    },
    effectiveStatus: {
      effectiveTextSource,
      effectiveWordCount,
      effectiveCharCount,
      isTtsReady,
      needsApproval,
      isBlocked,
      label,
    },
  };
}
