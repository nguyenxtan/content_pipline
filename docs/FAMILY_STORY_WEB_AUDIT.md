# Family Story Web — Pre-Implementation Audit

Date: 2026-06-25
Status: Audit report. Not a roadmap. No code or schema was changed to produce this report.
Scope: Read-only inspection of existing Story Library data/modules to determine what is safe to build for a future, separate `family-story-web/` app.

---

## 1. Executive summary

- **Is the repo ready to support a separate `family-story-web` app?** Mostly yes, with one important caveat: the recommended "effective text" logic already exists in code (`src/lib/story-library/effective-text.ts`) and matches the business rule in this task almost exactly. A new app can read the same Postgres DB and reimplement (or port) this logic without any schema change.
- **Are story tables present?** Yes. `story_sources` and `story_source_chapters` exist exactly as named in this task, defined in [src/lib/db/schema.ts:1063-1151](../src/lib/db/schema.ts#L1063-L1151), created by [drizzle/0051_story_library_sources.sql](../drizzle/0051_story_library_sources.sql) and extended by three later migrations.
- **Are audio text approval fields present?** Yes. `audio_text`, `audio_text_status`, `audio_text_source`, `audio_text_issue_count`, `audio_text_normalization_version`, `audio_text_updated_at`, `audio_text_reviewed_at`, `audio_text_review_note` all exist on `story_source_chapters` (migrations 0054, 0055).
- **Is the effective text rule implementable with current DB fields?** Yes, fully. No new column or migration is required for Phase 1. There is no separate "recovered text" column — recovered/fallback text is written into `audio_text` with `audio_text_source = 'manual_import'`, not into a distinct field (see §5).
- **Main blockers:** none structural. The only real risks are (a) accidentally reusing/duplicating the existing effective-text logic instead of importing it, and (b) DB exposure if `family-story-web` is deployed without care (see §8, §11).

---

## 2. Files inspected

Schema / migrations:
- [src/lib/db/schema.ts:1063-1216](../src/lib/db/schema.ts#L1063-L1216) — `storySources`, `storySourceChapters`, `storyCrawlRuns`, `storyCrawlEvents` table defs and relations
- `drizzle/0051_story_library_sources.sql` — base `story_sources` / `story_source_chapters` tables
- `drizzle/0052_story_crawl_monitor.sql` — `story_crawl_runs`, `story_crawl_events`
- `drizzle/0053_story_library_missing_chapter_recovery.sql` — fallback/recovery columns
- `drizzle/0054_story_chapter_audio_text.sql` — pre-TTS `audio_text*` columns
- `drizzle/0055_story_chapter_audio_text_source.sql` — `audio_text_source` provenance column

Crawler / recovery:
- `src/lib/story-library/crawler.ts`, `repository.ts`, `tracker.ts`, `text.ts`, `types.ts`
- `src/lib/story-library/parsers/{truyenfull-today,webtruyendich,tvtruyen-fit,itruyenchu,metruyenchu}.ts`

Audio readiness / episode / TTS preview:
- `src/lib/story-library/audio-readiness.ts`
- `src/lib/story-library/audio-episode-planner.ts`
- `src/lib/story-library/audio-text-normalizer.ts`
- `src/lib/story-library/audio-content-quality.ts`
- `src/lib/story-library/audio-preview-sample-script.ts`
- `src/lib/story-library/audio-preview-sample-tts.ts`
- `src/lib/story-library/effective-text.ts`

Actions / pages:
- `src/actions/story-library.ts`
- `src/app/admin/story-library/page.tsx`, `[storyId]/page.tsx`, `[storyId]/chapters/[chapterId]/page.tsx`, `audio-candidates/page.tsx`, `audio-candidates/[storyId]/episode-preview/page.tsx`, `crawl-monitor/page.tsx`, `missing-chapters/page.tsx`

Docs:
- `docs/PROJECT_MASTER_PLAN.md` (source of truth, §"Story Library Crawl Scheduling", "Audio Candidate Board", "Episode Builder Preview", "TTS Preview Sample", "Pre-TTS Content Verification", "Pre-TTS Chapter Audio Text Normalization", "Manual Audio Text Import", and subsequent bug-fix entries through 2026-06-24/25)
- `docs/DECISIONS.md` (ADR index — no ADR is specifically about Story Library, but ADR-001/019/010 govern shared infra this app would touch: LLM proxy, relative file paths, cron orchestration)
- `docs/AUDIO_STORY_PIPELINE_PLAN.md` — confirmed this governs a **different**, isolated feature (serialized fiction generation via `stories`/`story_chapters`/etc., not the crawler). Do not confuse with Story Library.

---

## 3. Database tables found

### `story_sources`
- Purpose: one row per crawled story/novel (catalog + crawl progress).
- Primary key: `id` (text/UUID).
- Important fields: `sourceSite`, `sourceUrl` (unique), `slug`, `title`, `author`, `genres` (jsonb string[]), `status` (e.g. `"Full"`), `intro`, `chapterCount`, `crawledChapterCount`, `totalWordCount`, `crawlStatus` (`queued|crawling|done|partial|failed`), `lastError`, `lastCrawledAt`, `createdAt`, `updatedAt`.
- Missing vs. the task's expected field list: `indexed_chapter_count` does not exist as a separate column — `chapterCount` (target on source site) and `crawledChapterCount` (rows actually crawled) cover this; "indexed" chapter count in this codebase means `count(story_source_chapters rows)`, computed on read, not stored.
- Indexes: `idx_story_sources_site`, `idx_story_sources_slug`, `idx_story_sources_crawl_status`, `idx_story_sources_updated`.
- `family-story-web` access: **read-only**.

### `story_source_chapters`
- Purpose: one row per chapter, raw crawl text + recovery + pre-TTS audio text layer.
- Primary key: `id` (text/UUID). FK `storyId → story_sources.id` (cascade delete).
- Important fields (raw/provenance): `chapterNumber`, `chapterTitle`, `chapterUrl` (unique), `contentText`, `wordCount`, `contentHash`, `crawlStatus` (`queued|crawling|done|failed`), `lastError`, `crawledAt`, `reviewedAt` (human read-through flag, independent of audio text).
- Recovery fields (migration 0053): `fallbackUrl`, `fallbackSourceSite`, `fallbackContentLength`, `fallbackLastCheckedAt`, `recoveryStatus`, `recoveryMethod`, `recoveryNote`, `recoveredAt`, `recoveredFromSourceSite`, `recoveredFromUrl`.
- Pre-TTS audio text fields (migrations 0054, 0055): `audioText`, `audioTextStatus` (`raw|normalized|needs_review|approved|blocked`, default `raw`), `audioTextIssueCount`, `audioTextNormalizationVersion`, `audioTextSource` (`null` = auto-derived, `"manual_import"` = admin-pasted), `audioTextUpdatedAt`, `audioTextReviewedAt` (set only on approval), `audioTextReviewNote`.
- All fields named in the task's "Chapter-level fields" list exist except `recovery_status`/`recovered_from_*` are present, but there is **no separate "recovered text content" column** — see §5 for why this matters.
- Indexes: `idx_story_source_chapters_story`, `idx_story_source_chapters_status`, `idx_story_source_chapters_recovery_status`, `idx_story_source_chapters_audio_text_status`, unique `(storyId, chapterNumber)`.
- `family-story-web` access: **read-only**.

### `story_crawl_runs` / `story_crawl_events` (migration 0052)
- Purpose: crawler run/heartbeat tracking and event log. Not required for `family-story-web` reading UI, but useful read-only context if a future "crawl health" widget is wanted. **Read-only, optional** for this app — not in Phase 1 scope.

### Note on naming collision
There is a *separate* feature called "Story Studio" / "Audio Story" with its own isolated tables (`stories`, `story_chapters`, `story_characters`, etc. — see `docs/AUDIO_STORY_PIPELINE_PLAN.md` and `ADR` boundary notes in `PROJECT_MASTER_PLAN.md` §6b). **`family-story-web` should read `story_sources` / `story_source_chapters` (Story Library crawler tables), not the Story Studio tables.** These are unrelated data models that happen to share the word "story."

---

## 4. Story/chapter status model

Three independent status dimensions exist per chapter, and conflating them is the historical bug pattern already fixed multiple times in this codebase (see `PROJECT_MASTER_PLAN.md` 2026-06-23/24 entries):

1. **Raw crawl status** (`crawlStatus`, `lastError`, `wordCount`, `contentText`) — pure provenance. `crawl_status = failed` with `word_count = 0` only means the scrape failed; it says nothing about whether the chapter is usable for reading/TTS today.
2. **Recovery status** (`recoveryStatus`, `recoveryMethod`, `recoveredFromSourceSite/Url`) — tracks fallback-site investigation, but recovered text itself is **not** stored in a dedicated column; it lands in `audioText` (see §5).
3. **Audio text status** (`audioTextStatus`, `audioTextSource`, `audioTextReviewedAt`) — the actual usability gate. Only `audioTextStatus = 'approved'` (regardless of `audioTextSource`) makes text trustworthy for reading/TTS without further review.

`reviewedAt` ("Đã kiểm tra") is a fourth, independent flag — a human "I read this" marker that is **not** a usability signal and must never be treated as equivalent to `audioTextStatus = 'approved'`. This exact confusion was a real bug fixed on 2026-06-23 (see master plan entry "Chapter detail page still showing raw state as effective state").

Usability summary:
- Provenance-only (do not gate usability): `crawlStatus`, `lastError`, raw `wordCount`, `reviewedAt`.
- Usability-determining: `audioTextStatus` + `audioTextSource`, and `crawlStatus === 'done'` as the fallback path when no audio text exists.

---

## 5. Effective text rule recommendation

**This already exists in code** at [src/lib/story-library/effective-text.ts](../src/lib/story-library/effective-text.ts), function `getEffectiveChapterTextState()`. It matches the task's requested rule almost exactly. `family-story-web` should port/reuse this logic rather than reinvent it, since it has already been live-validated against real data and bug-fixed twice.

Recommended rule (matches existing implementation):

```ts
function getEffectiveText(chapter) {
  if (chapter.audioText && chapter.audioTextStatus === "approved") {
    return {
      text: chapter.audioText,
      source: chapter.audioTextSource === "manual_import"
        ? "approved_audio_text_manual"
        : "approved_audio_text",
      usable: true,
    };
  }

  if (chapter.audioText && chapter.audioTextStatus !== "approved") {
    // exists but not yet trusted — needs human approval before use
    return { text: null, source: "needs_audio_approval", usable: false };
  }

  if (chapter.contentText && chapter.crawlStatus === "done") {
    return { text: chapter.contentText, source: "raw_content_text", usable: true };
  }

  return { text: null, source: "missing", usable: false };
}
```

Important deviation from the task's suggested pseudo-code: **there is no separate "recovered/fallback text" branch**, because no such column exists. Recovered text is written into `audioText` with `audioTextSource = "manual_import"` and must still pass through `audioTextStatus`. Do not invent a `recoveredText` field — confirmed not present in schema or migrations.

### Edge cases (cross-checked against existing `effective-text.ts` / `audio-readiness.ts` behavior)

| Edge case | Resolution |
|---|---|
| Raw failed but approved `audio_text` exists | Usable. `source = approved_audio_text` (or `_manual`). This is the core design point of the whole audio-text layer. |
| Raw done but `audio_text` exists, unapproved | **Not** usable by default. `source = needs_audio_approval`. Do not silently fall back to raw text if an unapproved `audio_text` exists for a chapter — surface it as "needs approval," not "ready." |
| Recovered chapter exists (`recoveryStatus = imported`) | Only usable if the imported text was promoted into `audio_text` and approved. `recoveryStatus` alone does not make a chapter usable. |
| Empty content (`contentText` null, no `audio_text`) | `source = missing`, not usable. |
| Chapter gap (missing `chapterNumber` in sequence) | Not a per-chapter text-rule edge case — it's a sequence-continuity check the episode grouping logic (§6) must detect separately, by scanning `chapterNumber` for gaps, not by relying on `crawlStatus`. |
| Duplicate chapter number | Prevented at the DB level by `uniq_story_source_chapter_number` unique index — cannot occur within a single story's row set as currently ingested. |
| Missing word count (`wordCount = 0` but text recovered via approved `audio_text`) | Known, already-fixed bug pattern: raw `wordCount` stays 0 (it is a raw-crawl provenance field and must never be backfilled from `audio_text`). Word count for grouping/duration must be computed from the **effective** text length, not the raw `wordCount` column. |
| Story still crawling (`crawlStatus = 'crawling'` or `'partial'`) | Story-level `crawlStatus` should be surfaced as a banner ("story still being crawled — chapter list may be incomplete"), but should not block reading of already-`done` chapters. |

---

## 6. Episode grouping recommendation (Phase 1 logic, not implemented)

Recommended pure-function grouping algorithm:

```ts
function groupChaptersIntoEpisodes(chapters, opts = {
  targetWords: 20_000, minWords: 18_000, maxWords: 22_000,
}) {
  const episodes = [];
  let current = { chapters: [], words: 0 };

  for (const ch of chaptersSortedByNumber) {
    const eff = getEffectiveText(ch);
    if (!eff.usable) {
      // stop/mark gap — do not span an episode across an unusable chapter
      if (current.chapters.length) episodes.push(current);
      episodes.push({ gap: true, atChapter: ch.chapterNumber });
      current = { chapters: [], words: 0 };
      continue;
    }

    const words = countWords(eff.text); // computed, not raw wordCount column
    if (current.words + words > opts.maxWords && current.words >= opts.minWords) {
      episodes.push(current);
      current = { chapters: [], words: 0 };
    }

    current.chapters.push(ch);
    current.words += words;

    if (current.words >= opts.targetWords) {
      episodes.push(current);
      current = { chapters: [], words: 0 };
    }
  }
  if (current.chapters.length) episodes.push(current);
  return episodes;
}
```

Rules carried over directly from the task spec and consistent with the existing `audio-episode-planner.ts` precedent (which uses the same `2000 words ≈ 6 minutes` constant and the same "stop at a chapter boundary, never split mid-chapter" rule, just tuned for ~55–65 min target instead of ~20k words):
- Never split a chapter across two episodes.
- Stop extension and mark a gap the moment an unusable chapter is hit — do not skip over it silently.
- Duration estimate: `estimatedMinutes = words / 2000 * 6`.

---

## 7. Proposed `family-story-web` architecture (not created yet)

```txt
content_pipline/
  src/                  (existing app — untouched)
  docs/
  family-story-web/
    app/
    lib/
    components/
    Dockerfile
    docker-compose.yml
    .env.example
    README.md
```

- Separate `package.json`, separate `node_modules`, separate Next.js (or equivalent) runtime — does not share a build with the main app.
- Separate `Dockerfile` / `docker-compose.yml` for independent deploy lifecycle.
- Connects to the **same** Postgres instance via `DATABASE_URL` env var, read-only queries only (no migrations owned by this app; it must never run `drizzle-kit push` against the shared DB).
- Simple shared-password gate via `APP_PASSWORD` env var (basic auth or a single session cookie) — sufficient for an internal family tool, not a multi-user auth system.
- No public Postgres exposure: Postgres stays bound to localhost/internal network; only the `family-story-web` HTTP port is exposed via ngrok (or equivalent), never the DB port.

---

## 8. Safe implementation boundaries

**May read:**
- `story_sources` (all columns)
- `story_source_chapters` (all columns, including `audio_text*` and recovery fields)

**Must not touch (read or write):**
- Crawler runtime (`src/lib/story-library/crawler.ts`, `repository.ts`, `tracker.ts`, cron-driven resume scripts)
- Scheduler / cron (`src/app/api/cron/run/route.ts`, LaunchAgents)
- Upload queue (`upload_queue`, `published_videos`)
- YouTube / Facebook integration code and credentials
- TTS provider core (`src/lib/pipeline/tts.ts`, VieNeu/AiMax clients) — `family-story-web`'s "manual TTS preparation" means presenting text for an operator to copy/use elsewhere, not calling a TTS API itself in Phase 1
- Story Studio / Audio Story tables and pipeline (separate feature, see §3 note)
- Main pipeline runtime in general (`contentGenerations`, `socialChannels`, etc.)

---

## 9. Phase 1 implementation plan (proposed, not started)

1. Create `family-story-web/` as a separate Next.js app with its own `package.json`.
2. `GET /stories` — read-only list from `story_sources` (title, author, crawlStatus, chapter counts).
3. `GET /stories/[storyId]` — chapter list with effective-text status badge per chapter.
4. `GET /stories/[storyId]/episodes/[episodeIndex]` — grouped episode view using the grouping helper (§6).
5. Port `getEffectiveChapterTextState` logic (or import the existing module directly if build-sharing turns out to be acceptable — needs a build-time decision, see §12).
6. Implement the episode-grouping helper (§6) as a pure function with unit tests.
7. "Copy full text" button on the episode view for manual TTS prep elsewhere.
8. `Dockerfile`, `docker-compose.yml`, `.env.example` (`DATABASE_URL`, `APP_PASSWORD`), `README.md`.

Explicitly excluded from Phase 1 (per task instructions): spelling dictionary UI, thumbnail generation.

---

## 10. Phase 2+ TODOs (future only, not for Phase 1)

- Spelling dictionary / spelling candidate scanner exposure in this app
- Apply spelling rules at runtime
- Manual correction cache
- Reviewed-episode status (persisted, app-specific — would need a new table/column, out of scope for Phase 1)
- Fal.ai thumbnail generation
- Thumbnail metadata table
- NAS/ngrok hardening
- Eventual repo cleanup of older/unused modules, only after current short/crawl usage is stable

---

## 11. Risk assessment

| Risk | Notes |
|---|---|
| Schema mismatch | Low — verified directly against `schema.ts` and all 5 relevant migration files; field names match exactly. |
| Missing fields | Low — every field in the task's checklist exists except `indexed_chapter_count` (derivable) and a dedicated "recovered text" column (does not exist by design; recovered text lives in `audio_text`). |
| Unclear recovered text source | Resolved by this audit — recovered text is **not** separate from `audio_text`; `audio_text_source = 'manual_import'` plus `recovered_from_source_site/url` together tell the full story. Do not invent a new field. |
| Unapproved `audio_text` accidentally used | Real risk if a future implementer copies the "raw content_text fallback" logic without the approval gate. Mitigation: reuse `effective-text.ts` rather than re-deriving the rule. |
| Accidentally touching pipeline runtime | Low if `family-story-web` is a fully separate app/package with read-only DB credentials. Recommend a Postgres role with `SELECT`-only grants on `story_sources`/`story_source_chapters` if practical. |
| Exposing DB publicly | Must enforce: only the web app's HTTP port goes through ngrok; Postgres must stay on localhost/internal Docker network. |
| Over-refactoring old code | This audit's instructions already forbid it; flag explicitly in the next implementation prompt to prevent scope creep into the crawler/recovery modules. |

---

## 12. Final recommendation

- **Proceed with Phase 1**: yes. Database is ready; the effective-text rule is already implemented and validated in the main app and can be reused.
- **Create `family-story-web/` inside the same repo**: yes, as a sibling top-level folder with its own `package.json`/runtime, per the proposed structure in §7.
- **DB migration required before Phase 1**: no. All needed columns already exist.
- **One open implementation decision** (not answered by this audit, needs a quick call before coding starts): should `family-story-web` import `src/lib/story-library/effective-text.ts` directly from the main app's source tree (via a relative import or a tiny shared package), or should it duplicate a minimal read-only copy of that logic to keep the two apps fully decoupled at build time? Recommend duplicating a minimal pure-function copy (no DB/runtime imports) to avoid coupling the new app's build to the main app's full dependency graph.
- **Recommended next prompt for Phase 1 implementation:**
  > "Using the findings in docs/FAMILY_STORY_WEB_AUDIT.md, scaffold `family-story-web/` as a separate Next.js app per §7/§9: read-only `/stories`, `/stories/[storyId]`, `/stories/[storyId]/episodes/[episodeIndex]`, a pure-function port of the effective-text rule (§5) and episode-grouping helper (§6), `DATABASE_URL`/`APP_PASSWORD` env config, Dockerfile, docker-compose.yml, and README. Do not modify anything under content_pipline/src or content_pipline/docs."

**Confirmation: no pipeline behavior was changed during this audit.** Only `docs/FAMILY_STORY_WEB_AUDIT.md` was created; no source files, schema, or migrations were modified.
