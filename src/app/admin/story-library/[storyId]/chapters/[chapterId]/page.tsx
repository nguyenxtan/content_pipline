import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import {
  getStoryLibraryChapterAction,
  reanalyzeStoryLibraryChapterAudioTextAction,
  resetStoryLibraryChapterAudioTextToRawAction,
  approveStoryLibraryChapterAudioTextAction,
  markStoryLibraryChapterAudioTextNeedsReviewAction,
  importStoryLibraryChapterAudioTextAction,
  importStoryLibraryChapterAudioTextFromFallbackAction,
} from "@/actions/story-library";
import { AUDIO_TEXT_STATUS_LABELS, AUDIO_TEXT_ISSUE_LABELS } from "@/lib/story-library/audio-text-normalizer";
import { getEffectiveChapterTextState } from "@/lib/story-library/effective-text";
import { ChapterReaderActions } from "@/components/story-library/chapter-reader-actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getAudioTextStatusTone(status: string) {
  switch (status) {
    case "approved":
      return "bg-emerald-500/15 text-emerald-300";
    case "normalized":
      return "bg-sky-500/15 text-sky-300";
    case "needs_review":
      return "bg-amber-500/15 text-amber-300";
    case "blocked":
      return "bg-rose-500/15 text-rose-300";
    default:
      return "bg-slate-800 text-slate-300";
  }
}

// Labels for the persisted DB column (story_source_chapters.audio_text_status):
// raw | normalized | needs_review | approved | blocked — distinct from the pure
// analyzer's own pass/warn/needs_review/block status (AUDIO_TEXT_STATUS_LABELS).
const AUDIO_TEXT_DB_STATUS_LABELS: Record<string, string> = {
  raw: "Raw (not yet processed)",
  normalized: "Normalized",
  needs_review: "Needs review",
  approved: "Approved",
  blocked: "Blocked",
};

export default async function StoryLibraryChapterPage(props: {
  params: Promise<{ storyId: string; chapterId: string }>;
  searchParams: SearchParams;
}) {
  const { storyId, chapterId } = await props.params;
  const searchParams = await props.searchParams;
  const data = await getStoryLibraryChapterAction(storyId, chapterId);
  if (!data) notFound();

  const { story, chapter, previousChapter, nextChapter, audioTextPreview, rawAudioTextPreview } = data;
  const audioView = pickValue(searchParams.audio_view) === "normalized" ? "normalized" : "raw";
  const audioTextStatusLabel = AUDIO_TEXT_DB_STATUS_LABELS[chapter.audioTextStatus] ?? chapter.audioTextStatus;
  const canApproveAudioText = Boolean((chapter.audioText ?? "").trim()) && audioTextPreview.status !== "block";
  const audioTextReadyForTts = chapter.audioTextStatus === "approved";
  const rawSourceStillMissing = chapter.lastError === "source_missing_chapter";
  // Live analyzer status (audioTextPreview) is more authoritative than the persisted
  // DB enum alone — a "needs_review" status can be a human override on text that is
  // still genuinely blocked, so pass the fresh re-analysis result through.
  const effective = getEffectiveChapterTextState(chapter, { liveAnalyzerStatus: audioTextPreview.status });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href={`/admin/story-library/${story.id}`} className="text-sm text-slate-400 hover:text-slate-200">
              ← {story.title}
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">
              {chapter.chapterTitle ?? `Chuong ${chapter.chapterNumber}`}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Chapter {chapter.chapterNumber} · Raw: {effective.rawStatus.rawWordCount.toLocaleString("vi-VN")} words
              {effective.audioTextStatus.audioTextWordCount > 0 ? (
                <> · Audio text: {effective.audioTextStatus.audioTextWordCount.toLocaleString("vi-VN")} words</>
              ) : null}
              {" · "}
              <span className="text-slate-300">
                Effective for TTS: {effective.effectiveStatus.effectiveWordCount.toLocaleString("vi-VN")} words
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {previousChapter ? (
              <Link
                href={`/admin/story-library/${story.id}/chapters/${previousChapter.id}`}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
              >
                Previous
              </Link>
            ) : null}
            {nextChapter ? (
              <Link
                href={`/admin/story-library/${story.id}/chapters/${nextChapter.id}`}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
            <div className="grid gap-2">
              <div>
                <span className="text-slate-500">Source URL:</span>{" "}
                <a href={chapter.chapterUrl} target="_blank" rel="noreferrer" className="break-all text-blue-300 hover:text-blue-200">
                  {chapter.chapterUrl}
                </a>
              </div>
              <div>
                <span className="text-slate-500">Crawled at:</span>{" "}
                {chapter.crawledAt ? new Date(chapter.crawledAt).toLocaleString("vi-VN") : "—"}
              </div>
              {chapter.recoveredFromUrl ? (
                <div>
                  <span className="text-slate-500">Recovered from:</span>{" "}
                  <a
                    href={chapter.recoveredFromUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-blue-300 hover:text-blue-200"
                  >
                    {chapter.recoveredFromUrl}
                  </a>
                </div>
              ) : null}

              <div className="mt-2 grid gap-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Raw source (provenance only)</p>
                <div>
                  <span className="text-slate-500">Crawl status:</span> {effective.rawStatus.crawlStatus}
                </div>
                <div>
                  <span className="text-slate-500">Recovery status:</span> {chapter.recoveryStatus ?? "—"}
                </div>
                <div>
                  <span className="text-slate-500">Raw source state:</span>{" "}
                  {rawSourceStillMissing ? "Raw source missing" : effective.rawStatus.rawSourceState}
                </div>
                <div>
                  <span className="text-slate-500">Raw words / chars:</span>{" "}
                  {effective.rawStatus.rawWordCount.toLocaleString("vi-VN")} words ·{" "}
                  {effective.rawStatus.rawCharCount.toLocaleString("vi-VN")} chars
                </div>
              </div>

              <div className="mt-2 grid gap-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Audio text</p>
                <div>
                  <span className="text-slate-500">Source:</span>{" "}
                  {effective.audioTextStatus.audioTextSource === "manual_import" ? "Manual import" : "Derived from raw text"}
                </div>
                <div>
                  <span className="text-slate-500">Status:</span> {audioTextStatusLabel}
                </div>
                <div>
                  <span className="text-slate-500">Words / chars:</span>{" "}
                  {effective.audioTextStatus.audioTextWordCount.toLocaleString("vi-VN")} words ·{" "}
                  {effective.audioTextStatus.audioTextCharCount.toLocaleString("vi-VN")} chars
                </div>
                <div>
                  <span className="text-slate-500">Reviewed at:</span>{" "}
                  {effective.audioTextStatus.audioTextReviewedAt
                    ? new Date(effective.audioTextStatus.audioTextReviewedAt).toLocaleString("vi-VN")
                    : "—"}
                </div>
              </div>

              <div className="mt-2 grid gap-1 rounded-xl border border-emerald-800/40 bg-emerald-500/5 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">TTS readiness (effective)</p>
                <div>
                  <span className="text-slate-500">Status:</span>{" "}
                  <span
                    className={
                      effective.effectiveStatus.isTtsReady
                        ? "text-emerald-300"
                        : effective.effectiveStatus.isBlocked
                          ? "text-rose-300"
                          : effective.effectiveStatus.needsApproval
                            ? "text-amber-300"
                            : "text-slate-300"
                    }
                  >
                    {effective.effectiveStatus.label}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Effective text source:</span> {effective.effectiveStatus.effectiveTextSource}
                </div>
                <div>
                  <span className="text-slate-500">Effective words / chars:</span>{" "}
                  {effective.effectiveStatus.effectiveWordCount.toLocaleString("vi-VN")} words ·{" "}
                  {effective.effectiveStatus.effectiveCharCount.toLocaleString("vi-VN")} chars
                </div>
              </div>
            </div>
          </div>

          <ChapterReaderActions
            chapterId={chapter.id}
            contentText={chapter.contentText ?? ""}
            reviewedAt={chapter.reviewedAt ? new Date(chapter.reviewedAt).toISOString() : null}
          />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-slate-100">Audio text quality</h2>
            <span className={`rounded-full px-2 py-1 text-xs ${getAudioTextStatusTone(chapter.audioTextStatus)}`}>
              {audioTextStatusLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Pre-TTS text normalization. Raw chapter text above is never modified — this is a separate, derived
            audio text layer. &ldquo;Đã kiểm tra&rdquo; (reviewed) above is a manual read-through flag only and does
            not approve audio text for TTS by itself.
          </p>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Row label="Current audio text analyzer status" value={AUDIO_TEXT_STATUS_LABELS[audioTextPreview.status]} />
            <Row label="Current audio text issue count" value={String(audioTextPreview.stats.issueCount)} />
            <Row label="Raw source analyzer status" value={AUDIO_TEXT_STATUS_LABELS[rawAudioTextPreview.status]} />
            <Row label="Raw source issue count" value={String(rawAudioTextPreview.stats.issueCount)} />
            <Row
              label="Issue count (last saved)"
              value={chapter.audioTextStatus === "raw" ? "—" : String(chapter.audioTextIssueCount)}
            />
            <Row
              label="Audio text updated"
              value={chapter.audioTextUpdatedAt ? new Date(chapter.audioTextUpdatedAt).toLocaleString("vi-VN") : "—"}
            />
            <Row
              label="Audio text reviewed"
              value={chapter.audioTextReviewedAt ? new Date(chapter.audioTextReviewedAt).toLocaleString("vi-VN") : "—"}
            />
            <Row label="Audio text source" value={chapter.audioTextSource === "manual_import" ? "Manual import" : "Derived from raw text"} />
            {chapter.audioTextReviewNote ? <Row label="Review note" value={chapter.audioTextReviewNote} /> : null}
          </dl>

          {audioTextPreview.stats.issueCount > 0 && (
            <div className="mt-4 space-y-2 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Detected issues (live preview)</p>
              {audioTextPreview.issues.slice(0, 15).map((issue, index) => (
                <div
                  key={`${issue.issueType}-${index}`}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    issue.severity === "block"
                      ? "border-rose-700/40 bg-rose-500/10 text-rose-300"
                      : "border-amber-700/40 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  <span className="font-medium">{AUDIO_TEXT_ISSUE_LABELS[issue.issueType]}:</span> &ldquo;{issue.snippet}&rdquo;
                  {issue.replacement ? <> → &ldquo;{issue.replacement}&rdquo;</> : null} — {issue.reason}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <form action={reanalyzeStoryLibraryChapterAudioTextAction}>
              <input type="hidden" name="chapter_id" value={chapter.id} />
              <button
                title="Re-checks whatever is currently saved as audio text (manual import or derived) — never discards a manual import."
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500"
              >
                Re-analyze current audio text
              </button>
            </form>
            <form action={approveStoryLibraryChapterAudioTextAction}>
              <input type="hidden" name="chapter_id" value={chapter.id} />
              <button
                disabled={!canApproveAudioText}
                title={!canApproveAudioText ? "Cannot approve: unresolved blockers remain" : undefined}
                className="rounded-lg border border-emerald-700/60 px-3 py-2 text-sm font-medium text-emerald-300 hover:border-emerald-500 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
              >
                Approve audio text for TTS
              </button>
            </form>
            <form action={markStoryLibraryChapterAudioTextNeedsReviewAction}>
              <input type="hidden" name="chapter_id" value={chapter.id} />
              <button className="rounded-lg border border-amber-700/60 px-3 py-2 text-sm font-medium text-amber-300 hover:border-amber-500">
                Mark needs review
              </button>
            </form>
            <form action={resetStoryLibraryChapterAudioTextToRawAction}>
              <input type="hidden" name="chapter_id" value={chapter.id} />
              <button
                title="Discards the current audio text (including any manual import) and replaces it with a fresh derivation from raw chapter text."
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
              >
                Reset to raw-derived normalized version
              </button>
            </form>
          </div>
          {!canApproveAudioText && Boolean((chapter.audioText ?? "").trim()) && (
            <p className="mt-3 text-xs text-rose-300">Cannot approve: unresolved blockers remain in the current audio text.</p>
          )}
          {audioTextReadyForTts && (
            <p className="mt-3 text-xs text-emerald-300">
              Approved audio text will be used for Episode Preview and later TTS instead of the raw chapter text.
            </p>
          )}
          {chapter.audioTextSource === "manual_import" && chapter.audioTextStatus !== "approved" && (
            <p className="mt-3 text-xs text-amber-300">
              ⚠ This chapter has a manual import that is not yet approved. &ldquo;Reset to raw-derived normalized
              version&rdquo; below will discard it and replace it with a fresh derivation from the raw chapter text.
              Use &ldquo;Re-analyze current audio text&rdquo; instead to re-check the manual import without losing it.
            </p>
          )}

          <div className="mt-4 flex items-center gap-3 text-xs">
            <Link
              href={`?audio_view=raw`}
              className={`rounded-lg border px-3 py-1.5 ${audioView === "raw" ? "border-rose-500 text-rose-300" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
            >
              Raw text
            </Link>
            <Link
              href={`?audio_view=normalized`}
              className={`rounded-lg border px-3 py-1.5 ${audioView === "normalized" ? "border-rose-500 text-rose-300" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}
            >
              Normalized audio text {chapter.audioTextStatus === "raw" ? "(live preview — not yet saved)" : ""}
            </Link>
          </div>

          <pre className="mt-3 max-h-[400px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm leading-7 text-slate-200">
            {audioView === "normalized" ? (chapter.audioText ?? audioTextPreview.normalizedText) : (chapter.contentText ?? "")}
          </pre>
        </div>

        <div id="manual-audio-text-import" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-medium text-slate-100">Manual Audio Text Import</h2>
          <p className="mt-1 text-xs text-slate-500">
            Paste clean text for TTS use only — this never overwrites the raw crawled chapter text above. Use this
            when automated normalization leaves unresolved star-obfuscation or other blockers (e.g. a token with no
            safe dictionary mapping). The imported text is still analyzed before saving; it cannot be approved if it
            still has blocking issues.
          </p>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <h3 className="text-sm font-medium text-slate-100">Import audio text from public fallback URL</h3>
            <p className="mt-1 text-xs text-slate-500">
              Inspect exactly one public fallback chapter URL and import its extracted text into the separate audio
              text layer. This supports existing fallback sources, including manual-only{" "}
              <span className="text-slate-300">metruyenchuvn.com</span> URLs. Pages that require code, login, captcha,
              or unlock steps are rejected and never auto-imported.
            </p>

            <form action={importStoryLibraryChapterAudioTextFromFallbackAction} className="mt-4 space-y-3">
              <input type="hidden" name="chapter_id" value={chapter.id} />
              <input
                type="url"
                name="fallback_url"
                required
                placeholder="https://metruyenchuvn.com/... or another supported fallback URL"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <input
                type="text"
                name="note"
                placeholder="Note (optional)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  name="import_mode"
                  value="draft"
                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
                >
                  Inspect URL and save draft
                </button>
                <button
                  type="submit"
                  name="import_mode"
                  value="analyze"
                  className="rounded-lg border border-sky-700/60 px-3 py-2 text-sm font-medium text-sky-300 hover:border-sky-500"
                >
                  Inspect URL and analyze
                </button>
                <button
                  type="submit"
                  name="import_mode"
                  value="needs_review"
                  className="rounded-lg border border-amber-700/60 px-3 py-2 text-sm font-medium text-amber-300 hover:border-amber-500"
                >
                  Inspect URL and mark needs review
                </button>
                <button
                  type="submit"
                  name="import_mode"
                  value="approve"
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500"
                >
                  Inspect URL and approve if safe
                </button>
              </div>
              <p className="text-xs text-slate-500">
                metruyenchuvn.com is manual URL only — do not paste generated guesses. If the inspected page is gated
                or unreadable, the import is refused and the review note records why.
              </p>
            </form>
          </div>

          <form action={importStoryLibraryChapterAudioTextAction} className="mt-4 space-y-3">
            <input type="hidden" name="chapter_id" value={chapter.id} />
            <textarea
              name="audio_text"
              rows={10}
              required
              placeholder="Paste clean audio text here…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
              defaultValue={chapter.audioTextSource === "manual_import" ? chapter.audioText ?? "" : ""}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="text"
                name="source_url"
                placeholder="Source URL (optional)"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <input
                type="text"
                name="source_site"
                placeholder="Source site (optional)"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <input
                type="text"
                name="note"
                placeholder="Note (optional)"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                name="import_mode"
                value="draft"
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
              >
                Save as audio text draft
              </button>
              <button
                type="submit"
                name="import_mode"
                value="analyze"
                className="rounded-lg border border-sky-700/60 px-3 py-2 text-sm font-medium text-sky-300 hover:border-sky-500"
              >
                Save and analyze
              </button>
              <button
                type="submit"
                name="import_mode"
                value="needs_review"
                className="rounded-lg border border-amber-700/60 px-3 py-2 text-sm font-medium text-amber-300 hover:border-amber-500"
              >
                Save and mark needs review
              </button>
              <button
                type="submit"
                name="import_mode"
                value="approve"
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500"
              >
                Save and approve if safe
              </button>
            </div>
            <p className="text-xs text-slate-500">
              &ldquo;Save and approve&rdquo; only succeeds if the pasted text has no blocking issues — otherwise it
              is saved as blocked instead (check the review note above for why).
            </p>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6">
          <article className="whitespace-pre-wrap text-base leading-8 text-slate-100">
            {chapter.contentText ?? "Chapter text has not been crawled yet."}
          </article>
        </div>
      </div>
    </AppShell>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-3">
      <dt className="text-slate-500">{props.label}</dt>
      <dd className="break-words text-slate-200">{props.value}</dd>
    </div>
  );
}
