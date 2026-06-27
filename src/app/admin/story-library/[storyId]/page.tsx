import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import {
  getStoryLibraryStoryAction,
  scanStoryLibraryAudioTextAction,
  bulkNormalizeStoryLibraryAudioTextAction,
  getStoryLibraryAudioTextReviewQueueAction,
  getStoryLibraryAudioTextStatusCountsAction,
  type StoryLibraryAudioTextScanSummary,
} from "@/actions/story-library";
import type { StorySource, StorySourceChapter } from "@/lib/db/schema";
import { AUDIO_CANDIDATE_STATUS_LABELS, type AudioReadinessResult } from "@/lib/story-library/audio-readiness";

const RESUME_ELIGIBLE_STORY_STATUSES = new Set(["queued", "crawling", "partial", "failed"]);

function getResumeEligibility(story: StorySource, chapters: StorySourceChapter[]) {
  const queuedChapters = chapters.filter((c) => c.crawlStatus === "queued" || c.crawlStatus === "failed");
  const nextChapter = [...queuedChapters].sort((a, b) => a.chapterNumber - b.chapterNumber)[0] ?? null;
  const lastCrawledChapter = chapters
    .filter((c) => c.crawlStatus === "done")
    .sort((a, b) => b.chapterNumber - a.chapterNumber)[0] ?? null;

  let eligible = true;
  let reason = "Eligible — has queued chapters and an eligible crawl status.";

  if (!RESUME_ELIGIBLE_STORY_STATUSES.has(story.crawlStatus)) {
    eligible = false;
    reason = `Not eligible — story crawl_status is "${story.crawlStatus}" (resume only selects queued/crawling/partial/failed).`;
  } else if (queuedChapters.length === 0) {
    eligible = false;
    reason = "Not eligible — no queued or failed chapters remain for this story.";
  }

  return {
    nextChapter,
    remainingQueuedChapters: queuedChapters.length,
    lastCrawledChapter,
    eligible,
    reason,
  };
}

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function StoryLibraryDetailPage(props: {
  params: Promise<{ storyId: string }>;
  searchParams: SearchParams;
}) {
  const { storyId } = await props.params;
  const searchParams = await props.searchParams;
  const data = await getStoryLibraryStoryAction(storyId);
  if (!data) notFound();

  const { story, chapters, audioReadiness } = data;
  const resumeInfo = getResumeEligibility(story, chapters);

  const runScan = pickValue(searchParams.audio_scan) === "1";
  const [statusCounts, reviewQueue, scanSummary] = await Promise.all([
    getStoryLibraryAudioTextStatusCountsAction(storyId),
    getStoryLibraryAudioTextReviewQueueAction(storyId),
    runScan ? scanStoryLibraryAudioTextAction(storyId) : Promise.resolve(null),
  ]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/admin/story-library" className="text-sm text-slate-400 hover:text-slate-200">
              ← Story Library
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">{story.title}</h1>
            <p className="mt-1 text-sm text-slate-400">{story.author ?? "Unknown author"}</p>
          </div>
          <a
            href={story.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
          >
            Open source
          </a>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Crawl status" value={story.crawlStatus} />
          <StatCard label="Chapter progress" value={`${story.crawledChapterCount}/${story.chapterCount}`} />
          <StatCard label="Total words" value={story.totalWordCount.toLocaleString("vi-VN")} />
          <StatCard
            label="Last crawled"
            value={story.lastCrawledAt ? new Date(story.lastCrawledAt).toLocaleString("vi-VN") : "—"}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[1.1fr_1.4fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-medium text-slate-100">Metadata</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Source site" value={story.sourceSite} />
              <Row label="Status" value={story.status ?? "—"} />
              <Row label="Genres" value={story.genres.join(", ") || "—"} />
              <Row label="Last error" value={story.lastError ?? "—"} />
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="text-lg font-medium text-slate-100">Intro</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">{story.intro ?? "No intro crawled yet."}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-medium text-slate-100">Resume status</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Row
              label="Next queued chapter"
              value={
                resumeInfo.nextChapter
                  ? `#${resumeInfo.nextChapter.chapterNumber} ${resumeInfo.nextChapter.chapterTitle ?? ""}`.trim()
                  : "—"
              }
            />
            <Row label="Remaining queued chapters" value={String(resumeInfo.remainingQueuedChapters)} />
            <Row
              label="Last crawled chapter"
              value={
                resumeInfo.lastCrawledChapter
                  ? `#${resumeInfo.lastCrawledChapter.chapterNumber} ${resumeInfo.lastCrawledChapter.chapterTitle ?? ""}`.trim()
                  : "—"
              }
            />
            <Row label="Eligible for resume" value={resumeInfo.eligible ? "Yes" : "No"} />
          </dl>
          <p className="mt-3 text-xs text-slate-500">{resumeInfo.reason}</p>
        </div>

        <AudioReadinessCard storyId={story.id} readiness={audioReadiness} />

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-medium text-slate-100">Audio text review (crawled chapters only)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Operates only on already-crawled chapters of this story — never crawls new chapters, never overwrites
            raw chapter text. Run &ldquo;Analyze&rdquo; for a free read-only report, then &ldquo;Normalize&rdquo; to
            persist a derived audio text + status for every crawled chapter so blocking/needs-review ones surface below.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-5">
            <StatCard label="Raw" value={String(statusCounts.raw)} />
            <StatCard label="Normalized" value={String(statusCounts.normalized)} />
            <StatCard label="Approved" value={String(statusCounts.approved)} />
            <StatCard label="Needs review" value={String(statusCounts.needs_review)} />
            <StatCard label="Blocked" value={String(statusCounts.blocked)} />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/admin/story-library/${story.id}?audio_scan=1`}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
            >
              Analyze audio text for crawled chapters
            </Link>
            <form action={bulkNormalizeStoryLibraryAudioTextAction}>
              <input type="hidden" name="story_id" value={story.id} />
              <button className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500">
                Normalize audio text for crawled chapters
              </button>
            </form>
          </div>

          {scanSummary && <AudioTextScanSummaryView summary={scanSummary} />}

          {reviewQueue.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-slate-200">Chapters needing review ({reviewQueue.length})</h3>
              <div className="mt-2 overflow-hidden rounded-xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-sm">
                  <thead className="bg-slate-950/70 text-left text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Chapter</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Issues</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {reviewQueue.map((row) => (
                      <tr key={row.chapterId}>
                        <td className="px-3 py-2">
                          #{row.chapterNumber} {row.chapterTitle ?? ""}
                        </td>
                        <td className="px-3 py-2">
                          <span className={row.audioTextStatus === "blocked" ? "text-rose-300" : "text-amber-300"}>
                            {row.audioTextStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2">{row.audioTextIssueCount}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <Link
                              href={`/admin/story-library/${story.id}/chapters/${row.chapterId}`}
                              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:border-slate-500"
                            >
                              Review
                            </Link>
                            <Link
                              href={`/admin/story-library/${story.id}/chapters/${row.chapterId}#manual-audio-text-import`}
                              className="rounded-lg border border-rose-700/60 px-3 py-1.5 text-xs font-medium text-rose-300 hover:border-rose-500"
                            >
                              Import clean audio text
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-lg font-medium text-slate-100">Chapters</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/70 text-left text-slate-400">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Words</th>
                  <th className="px-4 py-3">Crawl status</th>
                  <th className="px-4 py-3">Crawled at</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {chapters.map((chapter) => (
                  <tr key={chapter.id}>
                    <td className="px-4 py-3">{chapter.chapterNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">{chapter.chapterTitle ?? `Chương ${chapter.chapterNumber}`}</div>
                      <div className="text-xs text-slate-500">{chapter.chapterUrl}</div>
                    </td>
                    <td className="px-4 py-3">{chapter.wordCount.toLocaleString("vi-VN")}</td>
                    <td className="px-4 py-3">{chapter.crawlStatus}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {chapter.crawledAt ? new Date(chapter.crawledAt).toLocaleString("vi-VN") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/story-library/${story.id}/chapters/${chapter.id}`}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:border-slate-500"
                      >
                        Read
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function AudioReadinessCard(props: { storyId: string; readiness: AudioReadinessResult }) {
  const { readiness } = props;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-slate-100">Audio readiness</h2>
        <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
          {AUDIO_CANDIDATE_STATUS_LABELS[readiness.status]}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Row label="Contiguous from #1" value={String(readiness.contiguousDoneFromStart)} />
        <Row
          label="Estimated audio time"
          value={`${readiness.estimatedAudioMinutes.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} min`}
        />
        <Row label="Missing for audio" value={String(readiness.unresolvedMissingForAudioCount)} />
        <Row label="Raw source gaps" value={String(readiness.rawMissingChapters)} />
        <Row label="TTS-ready via manual audio text" value={String(readiness.audioTextRecoveredChapters)} />
        <Row label="Needs audio approval" value={String(readiness.audioTextNeedsApprovalChapters)} />
        <Row label="Audio text blocked" value={String(readiness.audioTextBlockedChapters)} />
        <Row label="Failed chapters" value={String(readiness.failedChapters)} />
        <Row label="Recovered chapters" value={String(readiness.recoveredChapters)} />
        <Row label="Ready for ~1h episode" value={readiness.readyForOneHourEpisode ? "Yes" : "No"} />
      </dl>
      <p className="mt-3 text-xs text-slate-500">Next: {readiness.nextAction.label}</p>
      {readiness.status === "blocked_by_missing_chapters" && (
        <Link
          href="/admin/story-library/missing-chapters"
          className="mt-3 inline-block rounded-lg border border-rose-700/60 px-3 py-1.5 text-xs font-medium text-rose-300 hover:border-rose-500"
        >
          Recover missing chapters
        </Link>
      )}
      {readiness.status === "ready_for_preview" && (
        <Link
          href={`/admin/story-library/audio-candidates/${props.storyId}/episode-preview`}
          className="mt-3 inline-block rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
        >
          Build episode preview
        </Link>
      )}
    </div>
  );
}

function AudioTextScanSummaryView(props: { summary: StoryLibraryAudioTextScanSummary }) {
  const { summary } = props;
  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Live analyze report — read-only, computed fresh from raw text, nothing persisted
      </p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <Row label="Chapters scanned" value={String(summary.totalScanned)} />
        <Row label="Pass" value={String(summary.passCount)} />
        <Row label="Warn" value={String(summary.warnCount)} />
        <Row label="Needs review" value={String(summary.needsReviewCount)} />
        <Row label="Blocked" value={String(summary.blockedCount)} />
      </dl>
      {summary.topIssueExamples.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-slate-400">
          <p className="uppercase tracking-wide text-slate-500">Top issue examples</p>
          {summary.topIssueExamples.slice(0, 10).map((issue, index) => (
            <div key={index}>
              Ch.{issue.chapterNumber} [{issue.issueType}] &ldquo;{issue.snippet}&rdquo;
              {issue.replacement ? <> → &ldquo;{issue.replacement}&rdquo;</> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{props.label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-100">{props.value}</p>
    </div>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="text-slate-500">{props.label}</dt>
      <dd className="break-words text-slate-200">{props.value}</dd>
    </div>
  );
}
