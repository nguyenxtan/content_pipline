import { AppShell } from "@/components/layout/app-shell";
import {
  getStoryLibraryBacklogStatsAction,
  getStoryLibraryCrawlMonitorAction,
  getStoryLibraryDashboardStatsAction,
  getStoryLibraryDedupeStatsAction,
  getStoryLibraryDiscoveryEstimateAction,
  getStoryLibraryFilterOptionsAction,
  getStoryLibraryGenreStatsAction,
  getStoryLibraryOverviewAction,
} from "@/actions/story-library";
import Link from "next/link";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

function formatNumber(value: number) {
  return value.toLocaleString("vi-VN");
}

function formatEtaDays(value: number) {
  return value === 0 ? "0 days" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} days`;
}

function normalizeStoryStatus(status: string | null | undefined) {
  if (!status) return "unknown";

  const normalized = status.trim().toLowerCase();
  if (["đang ra", "dang ra", "ongoing", "updating"].includes(normalized)) {
    return "ongoing";
  }
  if (["full", "completed", "hoàn thành"].includes(normalized)) {
    return "completed";
  }
  return status;
}

function getCrawlStatusTone(status: string) {
  if (status === "failed") return "bg-rose-500/15 text-rose-300";
  if (status === "partial") return "bg-amber-500/15 text-amber-300";
  if (status === "done") return "bg-emerald-500/15 text-emerald-300";
  return "bg-slate-800 text-slate-300";
}

function getProgressTone(progressPercentage: number, failedChapterCount: number) {
  if (failedChapterCount > 0) return "bg-amber-500";
  if (progressPercentage >= 100) return "bg-emerald-500";
  if (progressPercentage > 0) return "bg-sky-500";
  return "bg-slate-700";
}

export default async function StoryLibraryPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const filters = {
    search: pickValue(searchParams.search) ?? "",
    genre: pickValue(searchParams.genre) ?? "",
    crawlStatus: pickValue(searchParams.crawl_status) ?? "",
    status: pickValue(searchParams.status) ?? "",
    sourceSite: pickValue(searchParams.source_site) ?? "",
    hasFailedChapters: pickValue(searchParams.has_failed_chapters) === "1",
    hasZeroChapters: pickValue(searchParams.has_zero_chapters) === "1",
    readyCandidate: pickValue(searchParams.ready_candidate) === "1",
    sort: pickValue(searchParams.sort) ?? "last_crawled_at_desc",
  };

  const [stories, filterOptions, dashboardStats, backlogStats, genreStats, dedupeStats, monitorSummary, discoveryEstimate] = await Promise.all([
    getStoryLibraryOverviewAction(filters),
    getStoryLibraryFilterOptionsAction(),
    getStoryLibraryDashboardStatsAction(),
    getStoryLibraryBacklogStatsAction(),
    getStoryLibraryGenreStatsAction(),
    getStoryLibraryDedupeStatsAction(),
    getStoryLibraryCrawlMonitorAction({ attentionOnly: true, hideQueued: true }),
    getStoryLibraryDiscoveryEstimateAction(),
  ]);

  const recommendedNextAction = getRecommendedNextAction({
    totalStories: dashboardStats.totals.totalStories,
    totalIndexedChapters: dashboardStats.totals.totalIndexedChapters,
    totalCrawledChapters: dashboardStats.totals.totalCrawledChapters,
    hasAttentionSignals:
      monitorSummary.healthSummary.blockedLast24h > 0 ||
      monitorSummary.healthSummary.failedRequestLast24h > 0 ||
      monitorSummary.healthSummary.skippedOverlapLast24h > 0 ||
      monitorSummary.healthSummary.staleLockReplacedLast24h > 0,
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Story Library</h1>
            <p className="mt-1 text-sm text-slate-400">
              Crawl metadata, chapter lists, and chapter text for manual review before any TTS or publishing work.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/admin/story-library/missing-chapters"
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
            >
              Missing Chapters
            </Link>
            <Link
              href="/admin/story-library/crawl-monitor"
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:border-slate-500"
            >
              Open Crawl Monitor
            </Link>
          </div>
        </div>

        <form className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 xl:grid-cols-[1.2fr_repeat(5,minmax(0,1fr))]">
          <input
            type="text"
            name="search"
            defaultValue={filters.search}
            placeholder="Search title"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          />
          <select
            name="genre"
            defaultValue={filters.genre}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">All genres</option>
            {filterOptions.genres.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
          <select
            name="crawl_status"
            defaultValue={filters.crawlStatus}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">All crawl status</option>
            <option value="pending">pending</option>
            <option value="queued">queued</option>
            <option value="crawling">crawling</option>
            <option value="partial">partial</option>
            <option value="completed">completed</option>
            <option value="done">done</option>
            <option value="failed">failed</option>
          </select>
          <select
            name="status"
            defaultValue={filters.status}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">All story status</option>
            <option value="ongoing">ongoing</option>
            <option value="completed">completed</option>
            <option value="unknown">unknown</option>
            {filterOptions.statuses
              .filter((status) => !["ongoing", "completed", "unknown"].includes(normalizeStoryStatus(status)))
              .map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
          </select>
          <select
            name="source_site"
            defaultValue={filters.sourceSite}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">All sites</option>
            {filterOptions.sourceSites.map((sourceSite) => (
              <option key={sourceSite} value={sourceSite}>
                {sourceSite}
              </option>
            ))}
          </select>
          <select
            name="sort"
            defaultValue={filters.sort}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="last_crawled_at_desc">Last crawled desc</option>
            <option value="created_at_desc">Created desc</option>
            <option value="progress_asc">Progress asc</option>
            <option value="failed_chapter_count_desc">Failed chapters desc</option>
            <option value="total_word_count_desc">Total words desc</option>
            <option value="chapter_count_desc">Chapter count desc</option>
          </select>

          <label
            suppressHydrationWarning
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300"
          >
            <input
              suppressHydrationWarning
              type="checkbox"
              name="has_failed_chapters"
              value="1"
              defaultChecked={filters.hasFailedChapters}
              className="h-4 w-4"
            />
            Failed chapters
          </label>
          <label
            suppressHydrationWarning
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300"
          >
            <input
              suppressHydrationWarning
              type="checkbox"
              name="has_zero_chapters"
              value="1"
              defaultChecked={filters.hasZeroChapters}
              className="h-4 w-4"
            />
            Zero chapters
          </label>
          <label
            suppressHydrationWarning
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300"
          >
            <input
              suppressHydrationWarning
              type="checkbox"
              name="ready_candidate"
              value="1"
              defaultChecked={filters.readyCandidate}
              className="h-4 w-4"
            />
            Ready candidate
          </label>
          <div className="flex gap-3 xl:col-span-3">
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500">
              Filter
            </button>
            <Link
              href="/admin/story-library"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-100 hover:border-slate-500"
            >
              Reset
            </Link>
          </div>
        </form>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Stories discovered" value={formatNumber(dashboardStats.totals.totalStories)} />
          <SummaryCard label="Chapter links indexed" value={formatNumber(dashboardStats.totals.totalIndexedChapters)} />
          <SummaryCard label="Chapter text crawled" value={formatNumber(dashboardStats.totals.totalCrawledChapters)} />
          <SummaryCard label="Chapter text remaining" value={formatNumber(backlogStats.chaptersRemainingToCrawl)} />
          <SummaryCard label="Ready candidates" value={formatNumber(dashboardStats.totals.storiesReadyForAudioCandidateCount)} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Missing chapters" value={formatNumber(dashboardStats.totals.totalMissingChapters)} tone="rose" />
          <SummaryCard label="Recovered chapters" value={formatNumber(dashboardStats.totals.totalRecoveredChapters)} />
          <SummaryCard label="Needs manual recovery" value={formatNumber(dashboardStats.totals.totalNeedsManualRecoveryChapters)} tone="rose" />
          <SummaryCard
            label="Stories blocked by missing chapters"
            value={formatNumber(dashboardStats.totals.storiesBlockedByMissingChapters)}
            tone="rose"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_1.2fr_1fr_1fr]">
          <Panel title="Metadata-First Summary">
            <MetricList
              items={[
                ["Story links discovered today", formatNumber(dashboardStats.totals.storiesDiscoveredToday)],
                ["Chapter links indexed today", formatNumber(dashboardStats.totals.chaptersIndexedToday)],
                ["Chapter texts crawled today", formatNumber(dashboardStats.totals.chaptersCrawledToday)],
                ["Stories with zero chapters", formatNumber(dashboardStats.totals.storiesWithZeroChapters)],
                ["Stories with failed chapters", formatNumber(dashboardStats.totals.storiesWithFailedChapters)],
                ["Missing chapters", formatNumber(dashboardStats.totals.totalMissingChapters)],
                ["Recovered chapters", formatNumber(dashboardStats.totals.totalRecoveredChapters)],
                ["Ready candidates", formatNumber(dashboardStats.totals.storiesReadyForAudioCandidateCount)],
                ["Last catalog crawl", formatDateTime(dashboardStats.lastCatalogCrawlAt)],
                ["Last chapter text crawl", formatDateTime(dashboardStats.lastChapterCrawlAt)],
              ]}
            />
          </Panel>

          <Panel title="Recommended Next Action">
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Advice</div>
                <div className="mt-2 font-medium text-slate-100">{recommendedNextAction.title}</div>
                <p className="mt-2 text-slate-400">{recommendedNextAction.description}</p>
              </div>
              <MetricList
                items={[
                  ["Stories discovered", formatNumber(dashboardStats.totals.totalStories)],
                  ["Chapter links indexed", formatNumber(dashboardStats.totals.totalIndexedChapters)],
                  ["Chapter text crawled", formatNumber(dashboardStats.totals.totalCrawledChapters)],
                  ["Needs manual recovery", formatNumber(dashboardStats.totals.totalNeedsManualRecoveryChapters)],
                  ["Attention signals in 24h", monitorSummary.healthSummary.status === "healthy" ? "none" : monitorSummary.healthSummary.status],
                ]}
              />
            </div>
          </Panel>

          <Panel title="Crawl Status Split">
            <MetricList
              items={[
                ["Pending", formatNumber(dashboardStats.totals.pendingStories)],
                ["Partial", formatNumber(dashboardStats.totals.partialStories)],
                ["Completed", formatNumber(dashboardStats.totals.completedStories)],
                ["Failed", formatNumber(dashboardStats.totals.failedStories)],
              ]}
            />
          </Panel>

          <Panel title="Story Status Split">
            <MetricList
              items={[
                ["Ongoing", formatNumber(dashboardStats.totals.ongoingStories)],
                ["Completed", formatNumber(dashboardStats.totals.completedStatusStories)],
                ["Unknown", formatNumber(dashboardStats.totals.unknownStatusStories)],
              ]}
            />
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel title="Crawl Backlog">
            <MetricList
              items={[
                ["Stories pending chapter-text crawl", formatNumber(backlogStats.storiesPendingChapterCrawl)],
                ["Chapter text remaining", formatNumber(backlogStats.chaptersRemainingToCrawl)],
                ["Failed chapter texts waiting retry", formatNumber(backlogStats.failedChaptersWaitingRetry)],
                [`ETA at ${formatNumber(backlogStats.conservativePerDay)} chapters/day (conservative)`, formatEtaDays(backlogStats.etaDaysAtConservative)],
                [`ETA at ${formatNumber(backlogStats.theoreticalPerDay)} chapters/day (theoretical max)`, formatEtaDays(backlogStats.etaDaysAtTheoretical)],
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">
              Chapter-text resume runs every 30 minutes, up to 20 chapters per run (concurrency stays at 1). Conservative
              derates for typical lock-overlap/failure skips; theoretical assumes every run completes cleanly. No audio or
              publish jobs are implied here.
            </p>
          </Panel>

          <Panel title="Dedupe / Source Integrity">
            <MetricList
              items={[
                ["Distinct source URLs", formatNumber(dedupeStats.distinctSourceUrlCount)],
                ["Total story_sources rows", formatNumber(dedupeStats.totalStorySourcesCount)],
                ["Possible duplicate titles", formatNumber(dedupeStats.possibleDuplicateTitleCount)],
                ["Possible duplicate title + author", formatNumber(dedupeStats.possibleDuplicateTitleAuthorCount)],
                ["Duplicate chapter URLs", formatNumber(dedupeStats.duplicateChapterUrlCount)],
                ["Stories missing source_url", formatNumber(dedupeStats.storiesMissingSourceUrl)],
                ["Chapters missing chapter_url", formatNumber(dedupeStats.chaptersMissingChapterUrl)],
              ]}
            />
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Metadata Discovery Pace">
            <MetricList
              items={[
                ["Stories discovered (total)", formatNumber(discoveryEstimate.storiesDiscoveredTotal)],
                ["Stories discovered (last 24h)", formatNumber(discoveryEstimate.storiesDiscoveredLast24h)],
                [
                  "Catalog cadence",
                  `${discoveryEstimate.catalogPaceStoriesPer2h} stories / ${discoveryEstimate.catalogCadenceHours}h`,
                ],
                ["Theoretical max stories/day", formatNumber(discoveryEstimate.theoreticalMaxStoriesPerDay)],
                ["Actual discovered stories/day (last 24h)", formatNumber(discoveryEstimate.storiesDiscoveredLast24h)],
                ["Chapter links indexed (total)", formatNumber(discoveryEstimate.chapterLinksIndexedTotal)],
                ["Chapter links indexed (last 24h)", formatNumber(discoveryEstimate.chapterLinksIndexedLast24h)],
                [
                  "Avg chapter links / discovered story",
                  discoveryEstimate.averageChapterLinksPerDiscoveredStory > 0
                    ? discoveryEstimate.averageChapterLinksPerDiscoveredStory.toLocaleString("en-US")
                    : "—",
                ],
                ["Full site total", discoveryEstimate.fullSiteTotalKnown ? "known" : "unknown"],
                [
                  "ETA to full-site discovery",
                  discoveryEstimate.fullSiteTotalKnown ? "—" : "unavailable until total catalog pages/story count is known",
                ],
              ]}
            />
          </Panel>

          <Panel title="Next-Step Recommendation">
            <div className="space-y-2 text-sm text-slate-300">
              <p>
                If the goal is to map the source site first, continue the metadata-first schedule: catalog discovery and chapter-link
                indexing before heavy chapter-text crawling.
              </p>
              <p>Current safe catalog pace is up to {formatNumber(discoveryEstimate.theoreticalMaxStoriesPerDay)} stories/day (theoretical).</p>
              <p>Actual pace depends on dedupe, catalog pagination, site response, and rate limits.</p>
              <p>Do not increase rate until 24–48h have passed with no block events.</p>
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr_1.2fr_1.2fr]">
          <Panel title="Stories by Site">
            <MetricList
              items={dashboardStats.sourceSites.length > 0
                ? dashboardStats.sourceSites.map((row) => [row.sourceSite, formatNumber(row.storyCount)] as const)
                : [["No source sites", "0"]]}
            />
          </Panel>

          <GenrePanel title="Top genres by story count" rows={genreStats.topByStoryCount} valueKey="storyCount" valueLabel="stories" />
          <GenrePanel
            title="Top genres by crawled chapters"
            rows={genreStats.topByCrawledChapters}
            valueKey="crawledChapterCount"
            valueLabel="chapters"
          />
          <GenrePanel title="Top genres by total words" rows={genreStats.topByTotalWords} valueKey="totalWordCount" valueLabel="words" />
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-slate-800 text-sm" style={{ minWidth: "1280px" }}>
              <thead className="bg-slate-950/70 text-left text-slate-400">
                <tr>
                  <th className="px-4 py-3" style={{ minWidth: "300px" }}>
                    Title
                  </th>
                  <th className="px-4 py-3 whitespace-nowrap">Source</th>
                  <th className="px-4 py-3" style={{ minWidth: "140px" }}>
                    Author
                  </th>
                  <th className="px-4 py-3" style={{ minWidth: "180px" }}>
                    Genres
                  </th>
                  <th className="px-4 py-3 whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 whitespace-nowrap">Crawl</th>
                  <th className="px-4 py-3 whitespace-nowrap text-right">Links Indexed</th>
                  <th className="px-4 py-3 whitespace-nowrap text-right">Text Crawled</th>
                  <th className="px-4 py-3 whitespace-nowrap text-right">Failed</th>
                  <th className="px-4 py-3 whitespace-nowrap text-right">Words</th>
                  <th className="px-4 py-3" style={{ minWidth: "120px" }}>
                    Progress
                  </th>
                  <th className="px-4 py-3 whitespace-nowrap">Last Crawled</th>
                  <th className="px-4 py-3" style={{ maxWidth: "160px" }}>
                    Last Error
                  </th>
                  <th className="px-4 py-3 whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {stories.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-4 py-10 text-center text-slate-500">
                      No crawled stories yet for the current filters.
                    </td>
                  </tr>
                ) : (
                  stories.map((story) => (
                    <tr key={story.id} className="align-top">
                      <td className="px-4 py-3" style={{ minWidth: "300px" }}>
                        <div
                          title={story.title}
                          className="font-medium text-slate-100 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-words"
                        >
                          {story.title}
                        </div>
                        <div title={story.sourceUrl || story.slug} className="mt-1 truncate text-xs text-slate-500">
                          {story.slug}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-300">{story.sourceSite}</td>
                      <td className="px-4 py-3" style={{ minWidth: "140px" }}>
                        <div className="[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-words">
                          {story.author ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ minWidth: "180px" }}>
                        {story.genres.length === 0 ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : (
                          <div className="flex max-h-14 flex-wrap gap-1 overflow-hidden">
                            {story.genres.map((genre) => (
                              <span
                                key={genre}
                                className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
                              >
                                {genre}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                          {normalizeStoryStatus(story.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-1 text-xs ${getCrawlStatusTone(story.crawlStatus)}`}>
                          {story.crawlStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">{formatNumber(story.chapterCount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">{formatNumber(story.crawledChapterCount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">{formatNumber(story.failedChapterCount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">{formatNumber(story.totalWordCount)}</td>
                      <td className="px-4 py-3" style={{ minWidth: "120px" }}>
                        <div className="min-w-28">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>{story.progressPercentage}%</span>
                            <span>
                              {formatNumber(story.crawledChapterCount)}/{formatNumber(story.chapterCount)}
                            </span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full ${getProgressTone(story.progressPercentage, story.failedChapterCount)}`}
                              style={{ width: `${story.progressPercentage}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">{formatDateTime(story.lastCrawledAt)}</td>
                      <td className="px-4 py-3 text-xs text-rose-300" style={{ maxWidth: "160px" }}>
                        <div title={story.lastError ?? undefined} className="truncate">
                          {story.lastError ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/admin/story-library/${story.id}`}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:border-slate-500"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SummaryCard(props: { label: string; value: string; tone?: "default" | "rose" }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-sm text-slate-400">{props.label}</div>
      <div className={`mt-2 text-2xl font-semibold ${props.tone === "rose" ? "text-rose-300" : "text-slate-100"}`}>
        {props.value}
      </div>
    </div>
  );
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-lg font-medium text-slate-100">{props.title}</h2>
      <div className="mt-4">{props.children}</div>
    </div>
  );
}

function MetricList(props: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className="space-y-3 text-sm">
      {props.items.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4">
          <span className="text-slate-400">{label}</span>
          <span className="font-medium text-slate-100">{value}</span>
        </div>
      ))}
    </div>
  );
}

function GenrePanel(props: {
  title: string;
  rows: Array<{ genre: string; storyCount: number; crawledChapterCount: number; totalWordCount: number }>;
  valueKey: "storyCount" | "crawledChapterCount" | "totalWordCount";
  valueLabel: string;
}) {
  return (
    <Panel title={props.title}>
      <div className="space-y-3 text-sm">
        {props.rows.length === 0 ? (
          <p className="text-slate-500">No genre metadata has been indexed yet.</p>
        ) : (
          props.rows.map((row) => (
            <div key={row.genre} className="flex items-center justify-between gap-4">
              <span className="truncate text-slate-300">{row.genre}</span>
              <span className="font-medium text-slate-100">
                {formatNumber(row[props.valueKey])} {props.valueLabel}
              </span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function getRecommendedNextAction(input: {
  totalStories: number;
  totalIndexedChapters: number;
  totalCrawledChapters: number;
  hasAttentionSignals: boolean;
}) {
  if (input.hasAttentionSignals) {
    return {
      title: "Slow down and review crawler health",
      description: "Attention events were recorded recently. Keep the crawl conservative and inspect the crawl monitor before pushing harder on discovery or chapter text work.",
    };
  }

  if (input.totalStories < 500) {
    return {
      title: "Prioritize metadata discovery",
      description: "The library is still building out story coverage. Keep catalog discovery prominent so more story URLs and metadata land before heavy chapter-text crawling.",
    };
  }

  if (input.totalIndexedChapters < 5000) {
    return {
      title: "Prioritize chapter-link indexing",
      description: "There are enough discovered stories to justify more detail/indexing passes. Focus on keeping chapter lists fresh before spending the budget on text crawling.",
    };
  }

  if (input.totalCrawledChapters < 300) {
    return {
      title: "Continue conservative chapter-text crawling",
      description: "Discovery and indexing are established. Keep chapter-text crawling bounded so operators can review the library quality before any downstream work.",
    };
  }

  return {
    title: "Maintain the current metadata-first rhythm",
    description: "Discovery, indexing, and chapter-text crawling all have meaningful coverage. Keep the current conservative schedule and watch the monitor for any attention signals.",
  };
}
