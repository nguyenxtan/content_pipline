import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { getStoryLibraryCrawlMonitorAction } from "@/actions/story-library";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildQueryString(
  current: {
    attentionOnly: boolean;
    level: string;
    eventType: string;
    showQueued: boolean;
  },
  overrides?: Partial<{
    attentionOnly: boolean;
    level: string;
    eventType: string;
    showQueued: boolean;
  }>
) {
  const next = { ...current, ...overrides };
  const params = new URLSearchParams();

  if (next.attentionOnly) {
    params.set("attention", "1");
  }
  if (next.level && next.level !== "all") {
    params.set("level", next.level);
  }
  if (next.eventType) {
    params.set("event_type", next.eventType);
  }
  if (next.showQueued) {
    params.set("show_queued", "1");
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function isPossiblyStale(heartbeatAt: Date | string | null | undefined) {
  if (!heartbeatAt) return false;
  return Date.now() - new Date(heartbeatAt).getTime() > 30 * 60 * 1000;
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

function getHealthTone(status: string) {
  if (status === "problem") return "bg-rose-500/15 text-rose-300";
  if (status === "watch") return "bg-amber-500/15 text-amber-300";
  return "bg-emerald-500/15 text-emerald-300";
}

function getCadenceReason(status: string, backlog: number, minutesSinceLastRun: number | null) {
  if (backlog === 0) {
    return "No chapter-text backlog is waiting, so a quiet chapter schedule is expected.";
  }
  if (status === "problem") {
    return minutesSinceLastRun === null
      ? "Chapter-text crawling has backlog but no successful recent run has been recorded yet."
      : "Chapter-text crawling is older than the expected safe window while backlog still remains.";
  }
  if (status === "watch") {
    return "Chapter-text crawling is slower than the ideal 30-minute cadence, but it is still within a watch window.";
  }
  return "Recent chapter-text crawling is fresh relative to the current safe schedule.";
}

function getShortWindowLabel(value: Date | string | null | undefined) {
  if (!value) return "last 2 hours";
  return `since ${formatDateTime(value)}`;
}

export default async function StoryLibraryCrawlMonitorPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const attentionOnly =
    pickValue(searchParams.attention) === "1" ||
    pickValue(searchParams.failed) === "1" ||
    pickValue(searchParams.view) === "attention";
  const levelParam = pickValue(searchParams.level);
  const level =
    levelParam === "info" || levelParam === "warn" || levelParam === "error"
      ? levelParam
      : "all";
  const eventType = pickValue(searchParams.event_type) ?? "";
  const showQueued = pickValue(searchParams.show_queued) === "1";
  const hideQueued = !showQueued;
  const monitor = await getStoryLibraryCrawlMonitorAction({
    attentionOnly,
    level,
    eventType,
    hideQueued,
  });
  const activeRun = monitor.activeRun;
  const activeRunIsStale = activeRun?.status === "running" && isPossiblyStale(activeRun.heartbeatAt);
  const currentFilters = {
    attentionOnly,
    level,
    eventType,
    showQueued,
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin/story-library" className="text-sm text-slate-400 hover:text-slate-200">
              ← Story Library
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">Crawl Monitor</h1>
            <p className="mt-1 text-sm text-slate-400">
              Track metadata discovery, chapter-link indexing, chapter-text crawling, and failures without leaving the admin UI.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href={`/admin/story-library/crawl-monitor${buildQueryString(currentFilters, { attentionOnly: false })}`}
              className={`rounded-lg px-3 py-2 text-sm ${!attentionOnly ? "bg-rose-600 text-white" : "border border-slate-700 text-slate-100 hover:border-slate-500"}`}
            >
              All events
            </Link>
            <Link
              href={`/admin/story-library/crawl-monitor${buildQueryString(currentFilters, { attentionOnly: true })}`}
              className={`rounded-lg px-3 py-2 text-sm ${attentionOnly ? "bg-rose-600 text-white" : "border border-slate-700 text-slate-100 hover:border-slate-500"}`}
            >
              Attention view
            </Link>
          </div>
        </div>

        <form className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-[1fr_1fr_auto_auto]" method="GET">
          {attentionOnly ? <input type="hidden" name="attention" value="1" /> : null}
          <select
            name="level"
            defaultValue={level}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="all">All levels</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <select
            name="event_type"
            defaultValue={eventType}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="">All event types</option>
            {monitor.eventTypes.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
            <input
              type="checkbox"
              name="show_queued"
              value="1"
              defaultChecked={showQueued}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950"
            />
            Show queued_chapter
          </label>
          <div className="flex gap-3">
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500">
              Apply
            </button>
            <Link
              href={`/admin/story-library/crawl-monitor${attentionOnly ? "?attention=1" : ""}`}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-100 hover:border-slate-500"
            >
              Reset
            </Link>
          </div>
        </form>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-slate-100">Active Run</h2>
            {activeRun ? (
              <span
                className={`rounded-full px-2 py-1 text-xs ${
                  activeRunIsStale ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-300"
                }`}
              >
                {activeRunIsStale ? "possibly stale" : activeRun.status}
              </span>
            ) : (
              <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">idle</span>
            )}
          </div>

          {!activeRun ? (
            <p className="mt-4 text-sm text-slate-400">No crawl run is currently marked as running.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <div><span className="text-slate-500">Mode:</span> {activeRun.mode}</div>
                <div><span className="text-slate-500">Started:</span> {new Date(activeRun.startedAt).toLocaleString("vi-VN")}</div>
                <div><span className="text-slate-500">Heartbeat:</span> {new Date(activeRun.heartbeatAt).toLocaleString("vi-VN")}</div>
                <div><span className="text-slate-500">Current URL:</span> {activeRun.currentUrl ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <div><span className="text-slate-500">Current story:</span> {activeRun.currentStoryTitle ?? "—"}</div>
                <div><span className="text-slate-500">Current chapter:</span> {activeRun.currentChapterTitle ?? "—"}</div>
                <div><span className="text-slate-500">Last error:</span> {activeRun.lastError ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                <div><span className="text-slate-500">Attempted stories:</span> {activeRun.attemptedStories}</div>
                <div><span className="text-slate-500">Attempted chapters:</span> {activeRun.attemptedChapters}</div>
                <div><span className="text-slate-500">Succeeded:</span> {activeRun.succeededChapters}</div>
                <div><span className="text-slate-500">Failed:</span> {activeRun.failedChapters}</div>
                <div><span className="text-slate-500">Skipped dupes:</span> {activeRun.skippedDuplicates}</div>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 xl:col-span-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium text-slate-100">Crawler Timing</h2>
              <span className={`rounded-full px-2 py-1 text-xs font-medium uppercase ${getHealthTone(monitor.cadenceSummary.chapterFreshnessStatus)}`}>
                {monitor.cadenceSummary.chapterFreshnessStatus}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              {getCadenceReason(
                monitor.cadenceSummary.chapterFreshnessStatus,
                monitor.cadenceSummary.remainingChapterBacklog,
                monitor.cadenceSummary.minutesSinceLastSuccessfulChapterRun
              )}
            </p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Catalog / indexing cadence</span>
                <span>{monitor.cadenceSummary.catalogCadenceLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Chapter-text cadence</span>
                <span>{monitor.cadenceSummary.chapterCadenceLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Failed-retry cadence</span>
                <span>{monitor.cadenceSummary.retryCadenceLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Last successful catalog run</span>
                <span>{formatDateTime(monitor.cadenceSummary.lastSuccessfulCatalogRunAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Last successful chapter-text run</span>
                <span>{formatDateTime(monitor.cadenceSummary.lastSuccessfulChapterRunAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Last successful retry run</span>
                <span>{formatDateTime(monitor.cadenceSummary.lastSuccessfulRetryRunAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Minutes since chapter-text success</span>
                <span>{monitor.cadenceSummary.minutesSinceLastSuccessfulChapterRun ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 xl:col-span-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium text-slate-100">Current Health</h2>
              <span className={`rounded-full px-2 py-1 text-xs font-medium uppercase ${getHealthTone(monitor.healthSummary.status)}`}>
                {monitor.healthSummary.status}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-400">{monitor.healthSummary.reason}</p>
            {monitor.healthSummary.hasResolvedHistoricalErrors ? (
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                Resolved historical events: 24h failed requests still exist in history, but no current-window failed requests were seen after the latest successful chapter-text run.
              </div>
            ) : null}
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Active run status</span>
                <span>{activeRun ? (activeRunIsStale ? "possibly stale" : activeRun.status) : "idle"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Heartbeat stale</span>
                <span>{monitor.healthSummary.activeRunStale ? "yes" : "no"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Current window</span>
                <span>{getShortWindowLabel(monitor.healthSummary.currentWindowStartedAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Current failed_request</span>
                <span>{monitor.healthSummary.failedRequestCurrentWindow}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Current blocked / Cloudflare</span>
                <span>{monitor.healthSummary.blockedCurrentWindow}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Stories discovered / metadata refreshed</span>
                <span>
                  {monitor.healthSummary.storiesDiscoveredLast24h} / {monitor.healthSummary.storiesIndexedLast24h}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Chapter links indexed</span>
                <span>{monitor.healthSummary.chapterLinksIndexedLast24h}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-lg font-medium text-slate-100">Runs In 24h</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">All runs</span>
                <span>{monitor.healthSummary.runsLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Completed</span>
                <span>{monitor.healthSummary.completedRunsLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Failed</span>
                <span>{monitor.healthSummary.failedRunsLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Chapters crawled</span>
                <span>{monitor.healthSummary.chaptersCrawledLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Catalog / indexing run rows</span>
                <span>{monitor.healthSummary.catalogIndexingRunsLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Chapter-text runs</span>
                <span>{monitor.healthSummary.chapterTextRunsLast24h}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-lg font-medium text-slate-100">24h History</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">skipped_overlap</span>
                <span>{monitor.healthSummary.skippedOverlapLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">stale_lock_replaced</span>
                <span>{monitor.healthSummary.staleLockReplacedLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">failed_request</span>
                <span>{monitor.healthSummary.failedRequestLast24h}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">blocked_or_cloudflare_detected</span>
                <span>{monitor.healthSummary.blockedLast24h}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-lg font-medium text-slate-100">Freshness</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Current run started</span>
                <span>{formatDateTime(activeRun?.startedAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Current heartbeat</span>
                <span>{formatDateTime(activeRun?.heartbeatAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Attention view</span>
                <span>{attentionOnly ? "on" : "off"}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="border-b border-slate-800 px-4 py-3">
              <h2 className="text-lg font-medium text-slate-100">Recent Runs</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-950/70 text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Mode</th>
                    <th className="px-4 py-3">Phase</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Heartbeat</th>
                    <th className="px-4 py-3">Counters</th>
                    <th className="px-4 py-3">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {monitor.recentRuns.map((run) => {
                    const stale = run.status === "running" && isPossiblyStale(run.heartbeatAt);
                    return (
                      <tr key={run.id} className="align-top">
                        <td className="px-4 py-3 font-medium text-slate-100">{run.mode}</td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {run.mode === "catalog" || run.mode === "story"
                            ? "catalog / indexing"
                            : "chapter text"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs ${stale ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-300"}`}>
                            {stale ? "possibly stale" : run.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">{formatDateTime(run.startedAt)}</td>
                        <td className="px-4 py-3 text-xs text-slate-400">{formatDateTime(run.heartbeatAt)}</td>
                        <td className="px-4 py-3 text-xs text-slate-300">
                          S:{run.attemptedStories} C:{run.attemptedChapters} OK:{run.succeededChapters} F:{run.failedChapters}
                        </td>
                        <td className="px-4 py-3 text-xs text-rose-300">{run.lastError ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="border-b border-slate-800 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-medium text-slate-100">Recent Events</h2>
                <span className="text-xs text-slate-400">
                  {hideQueued ? "queued_chapter hidden" : "queued_chapter shown"}
                </span>
              </div>
            </div>
            <div className="max-h-[860px] overflow-auto">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-950/70 text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Level</th>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3">Run</th>
                    <th className="px-4 py-3">URL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {monitor.recentEvents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                        No crawl events found for the current filters.
                      </td>
                    </tr>
                  ) : null}
                  {monitor.recentEvents.map((event) => (
                    <tr key={event.id} className="align-top">
                      <td className="px-4 py-3 text-xs text-slate-400">{formatDateTime(event.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            event.level === "error"
                              ? "bg-rose-500/15 text-rose-300"
                              : event.level === "warn"
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {event.level}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-100">{event.eventType}</td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        <div title={event.fullMessage}>{event.displayMessage}</div>
                        {event.fullMessage && event.fullMessage !== event.displayMessage ? (
                          <details className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                            <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-slate-500">
                              Details
                            </summary>
                            <div className="mt-2 whitespace-pre-wrap break-words text-[11px] text-slate-400">
                              {event.fullMessage}
                            </div>
                          </details>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{event.run?.mode ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-blue-300">{event.url ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
