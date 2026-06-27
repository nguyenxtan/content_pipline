import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import {
  attachStoryLibraryFallbackUrlAction,
  getStoryLibraryMissingChaptersAction,
  importStoryLibraryFallbackAction,
  inspectStoryLibraryFallbackAction,
  rejectStoryLibraryFallbackAction,
  type StoryLibraryMissingChaptersView,
} from "@/actions/story-library";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

function formatRecoveryTone(status: string | null) {
  switch (status) {
    case "valid_fallback":
      return "bg-emerald-500/15 text-emerald-300";
    case "imported":
      return "bg-sky-500/15 text-sky-300";
    case "audio_text_approved":
      return "bg-emerald-500/15 text-emerald-300";
    case "audio_text_needs_approval":
      return "bg-amber-500/15 text-amber-300";
    case "audio_text_blocked":
    case "rejected":
    case "gated_or_unreadable":
    case "wrong_story_or_chapter":
    case "empty_or_placeholder":
      return "bg-rose-500/15 text-rose-300";
    case "fallback_pending":
      return "bg-amber-500/15 text-amber-300";
    default:
      return "bg-slate-800 text-slate-300";
  }
}

// Mirrors getStoryLibraryMissingChapterView's precedence (server-side) for the row
// badge/label specifically — approved audio text > fallback-imported raw text >
// blocked audio text > needs-approval audio text > generic recovery status.
function formatMissingChapterRecoveryLabel(row: {
  audioTextStatus: string | null;
  audioTextSource: string | null;
  lastError: string | null;
  recoveryStatus: string | null;
  hasUnresolvedAudioTextBlockers: boolean;
}): { tag: string; label: string; note: string } {
  if (row.audioTextStatus === "approved" && row.lastError === "source_missing_chapter") {
    return {
      tag: "audio_text_approved",
      label: "TTS-ready via approved manual audio text",
      note: "Raw source gap is preserved separately; TTS uses the approved audio text.",
    };
  }
  if (row.recoveryStatus === "imported") {
    return { tag: "imported", label: "imported", note: "Raw source text recovered via a fallback URL." };
  }
  // needs_approval/blocked require a manual import specifically — a stale auto-derived
  // status on a raw-missing chapter (no human ever imported anything) is still
  // genuinely unresolved, not "something is in flight awaiting a decision".
  if (row.audioTextSource === "manual_import" && row.hasUnresolvedAudioTextBlockers) {
    return {
      tag: "audio_text_blocked",
      label: "Audio text blocked",
      note: "A manual audio text import exists but still has unresolved blockers — not approvable yet.",
    };
  }
  if (row.audioTextSource === "manual_import" && (row.audioTextStatus === "needs_review" || row.audioTextStatus === "normalized")) {
    return {
      tag: "audio_text_needs_approval",
      label: "Manual audio text imported — needs approval",
      note: "Analyzer found no blockers. An admin still needs to approve it for TTS.",
    };
  }
  return { tag: row.recoveryStatus ?? "not_inspected", label: row.recoveryStatus ?? "not inspected", note: "" };
}

export default async function StoryLibraryMissingChaptersPage(props: { searchParams: SearchParams }) {
  const searchParams = await props.searchParams;
  const view = (pickValue(searchParams.view) as StoryLibraryMissingChaptersView | undefined) ?? "unresolved";
  const { rows, summary } = await getStoryLibraryMissingChaptersAction(view);

  return (
    <AppShell>
      <div suppressHydrationWarning className="space-y-6">
        <div suppressHydrationWarning className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/admin/story-library" className="text-sm text-slate-400 hover:text-slate-200">
              ← Story Library
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">Missing Chapter Recovery</h1>
            <p className="mt-1 text-sm text-slate-400">
              Review chapters whose primary source is missing content, then attach, inspect, and optionally import a
              public fallback URL.
            </p>
          </div>
        </div>

        <div suppressHydrationWarning className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <SummaryCard label="Unresolved for audio" value={String(summary.unresolvedMissingForAudioCount)} />
          <SummaryCard label="Raw source gaps" value={String(summary.rawMissingCount)} />
          <SummaryCard label="TTS-ready via audio text" value={String(summary.audioTextRecoveredCount)} />
          <SummaryCard label="Needs audio approval" value={String(summary.audioTextNeedsApprovalCount)} />
          <SummaryCard label="Audio text blocked" value={String(summary.audioTextBlockedCount)} />
          <SummaryCard label="Fallback recovered" value={String(summary.importedCount)} />
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          <FilterLink href="/admin/story-library/missing-chapters" active={view === "unresolved"}>
            Unresolved for audio
          </FilterLink>
          <FilterLink href="/admin/story-library/missing-chapters?view=audio_text_needs_approval" active={view === "audio_text_needs_approval"}>
            Needs audio approval
          </FilterLink>
          <FilterLink href="/admin/story-library/missing-chapters?view=audio_text_blocked" active={view === "audio_text_blocked"}>
            Audio text blocked
          </FilterLink>
          <FilterLink href="/admin/story-library/missing-chapters?view=fallback_recovered" active={view === "fallback_recovered"}>
            Recovered by fallback
          </FilterLink>
          <FilterLink href="/admin/story-library/missing-chapters?view=audio_text_recovered" active={view === "audio_text_recovered"}>
            Audio text recovered
          </FilterLink>
          <FilterLink href="/admin/story-library/missing-chapters?view=all" active={view === "all"}>
            All
          </FilterLink>
        </div>

        <div suppressHydrationWarning className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-lg font-medium text-slate-100">Missing chapters</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/70 text-left text-slate-400">
                <tr>
                  <th className="px-4 py-3">Story / chapter</th>
                  <th className="px-4 py-3">Primary status</th>
                  <th className="px-4 py-3">Fallback URL</th>
                  <th className="px-4 py-3">Recovery</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {rows.map((row) => (
                  <tr key={row.chapterId} className="align-top">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/story-library/${row.storyId}/chapters/${row.chapterId}`}
                        className="font-medium text-slate-100 hover:text-rose-300"
                      >
                        {row.storyTitle}
                      </Link>
                      <div className="mt-1 text-xs text-slate-400">
                        Chapter {row.chapterNumber}
                        {row.chapterTitle ? ` · ${row.chapterTitle}` : ""}
                      </div>
                      <div className="mt-2 break-all text-xs text-slate-500">{row.primaryUrl}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium bg-amber-500/15 text-amber-300">
                        {row.lastError ?? row.crawlStatus}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">Updated {formatDateTime(row.updatedAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="mb-2 text-xs text-slate-500">
                        Priority: <span className="text-slate-300">1. webtruyendich.com</span> ·{" "}
                        <span className="text-slate-300">2. tvtruyen.fit</span> ·{" "}
                        <span className="text-slate-300">3. itruyenchu.org</span> ·{" "}
                        <span className="text-slate-300">4. metruyenchuvn.com manual URL</span> ·{" "}
                        <span className="text-slate-300">5. manual paste/import</span>
                      </div>
                      <form action={attachStoryLibraryFallbackUrlAction} className="space-y-2">
                        <input type="hidden" name="chapter_id" value={row.chapterId} />
                        <input
                          type="url"
                          name="fallback_url"
                          defaultValue={row.fallbackUrl ?? ""}
                          placeholder={`https://${"webtruyendich.com"}/...`}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
                        />
                        <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:border-slate-500">
                          Save fallback URL
                        </button>
                      </form>
                      <div className="mt-2 text-xs text-slate-500">
                        Source {row.fallbackSourceSite ?? "—"} · length{" "}
                        {row.fallbackContentLength?.toLocaleString("vi-VN") ?? "—"} · checked{" "}
                        {formatDateTime(row.fallbackLastCheckedAt)}
                      </div>
                      {row.suggestions?.length ? (
                        <div className="mt-3 space-y-1 text-xs text-slate-400">
                          {row.suggestions.map((suggestion) => (
                            <div key={`${row.chapterId}-${suggestion.sourceSite}-${suggestion.kind}`}>
                              <span className="text-slate-500">{suggestion.sourceSite}:</span>{" "}
                              {suggestion.url ? (
                                <a
                                  href={suggestion.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="break-all text-sky-300 hover:text-sky-200"
                                >
                                  {suggestion.url}
                                </a>
                              ) : (
                                <span>{suggestion.label}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const recoveryLabel = formatMissingChapterRecoveryLabel(row);
                        const isGenericUnresolved =
                          recoveryLabel.tag !== "audio_text_approved" &&
                          recoveryLabel.tag !== "imported" &&
                          recoveryLabel.tag !== "audio_text_blocked" &&
                          recoveryLabel.tag !== "audio_text_needs_approval";
                        return (
                          <>
                            <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${formatRecoveryTone(recoveryLabel.tag)}`}>
                              {recoveryLabel.label}
                            </div>
                            <div className="mt-2 max-w-md text-xs leading-5 text-slate-400">
                              {recoveryLabel.note || row.recoveryNote || "—"}
                            </div>
                            {row.recoveredAt ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Imported {formatDateTime(row.recoveredAt)} from {row.recoveredFromSourceSite ?? "fallback"}.
                              </div>
                            ) : null}
                            {row.audioTextStatus === "approved" && row.audioTextReviewedAt ? (
                              <div className="mt-2 text-xs text-emerald-300">
                                Audio text approved {formatDateTime(row.audioTextReviewedAt)}.
                              </div>
                            ) : null}
                            {!row.recoveredAt && row.lastError === "source_missing_chapter" && isGenericUnresolved ? (
                              <div className="mt-2 text-xs text-amber-300">Unresolved missing chapter. Audio readiness stays blocked.</div>
                            ) : null}
                          </>
                        );
                      })()}
                      {row.recoveredFromUrl ? (
                        <div className="mt-1 break-all text-xs text-slate-500">{row.recoveredFromUrl}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {row.audioTextStatus === "needs_review" ||
                        row.audioTextStatus === "normalized" ||
                        row.audioTextStatus === "blocked" ? (
                          <Link
                            href={`/admin/story-library/${row.storyId}/chapters/${row.chapterId}`}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
                          >
                            Review / approve audio text
                          </Link>
                        ) : null}
                        <form action={inspectStoryLibraryFallbackAction}>
                          <input type="hidden" name="chapter_id" value={row.chapterId} />
                          <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 hover:border-slate-500">
                            Inspect fallback
                          </button>
                        </form>
                        <form action={importStoryLibraryFallbackAction}>
                          <input type="hidden" name="chapter_id" value={row.chapterId} />
                          <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500">
                            Import recovered text
                          </button>
                        </form>
                        <form action={rejectStoryLibraryFallbackAction}>
                          <input type="hidden" name="chapter_id" value={row.chapterId} />
                          <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500">
                            Reject fallback
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                      No source-missing chapters are queued for recovery right now.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SummaryCard(props: { label: string; value: string }) {
  return (
    <div suppressHydrationWarning className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <p suppressHydrationWarning className="text-xs uppercase tracking-wide text-slate-500">{props.label}</p>
      <p suppressHydrationWarning className="mt-2 text-lg font-semibold text-slate-100">{props.value}</p>
    </div>
  );
}

function FilterLink(props: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={props.href}
      className={`rounded-full border px-3 py-1.5 ${
        props.active
          ? "border-rose-500 bg-rose-500/10 text-rose-300"
          : "border-slate-700 text-slate-300 hover:border-slate-500"
      }`}
    >
      {props.children}
    </Link>
  );
}
