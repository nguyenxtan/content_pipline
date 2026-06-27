# Project Master Plan

Last updated: 2026-06-16 (session 4)  
Status: source of truth for roadmap planning.

This file consolidates the current project direction from the repo, local DB snapshots, and existing docs. Future roadmap work should update this file instead of creating another roadmap document, unless the user explicitly asks for a separate artifact.

## 1. Vision

This project is a multi-platform content factory and learning system, not just a video generator.

The system should generate, render, publish, measure, and learn from Vietnamese content across multiple platforms. The long-term advantage is not "more videos"; it is a feedback loop where published content teaches the pipeline which topics, hooks, covers, visuals, scripts, and formats actually work.

The target channels are:

- YouTube Shorts
- YouTube long videos
- Facebook Reels
- Facebook quote/photo posts
- future TikTok / Instagram Reels
- future affiliate channels such as books, philosophy, products, and education

The product direction should stay business-first:

- increase traffic
- increase CTR
- increase retention
- publish reliably
- learn from real data
- keep generation cost under control

Do not optimize for architecture purity unless it directly supports those outcomes.

## 2. Current State

### Completed foundations

- Reliability/retry:
  - Shared retry utility exists in `src/lib/llm/retry.ts`.
  - LLM and Fal.ai calls use retry across hook, script, image, and longform flows.
- Zod validation:
  - Schema validation exists in `src/lib/llm/schemas.ts` and `src/lib/validations/*`.
  - Verification script exists at `scripts/test-zod-schemas.ts`.
- Subtitle validation/repair:
  - Implemented in `src/lib/video/subtitle.ts`.
  - Short render returns `subtitleHealthScore` and PASS/FAIL state.
  - The current DB does not persist subtitle health per content row yet.
- Facebook caption repair:
  - `buildSafeFacebookCaption()` repairs unsafe/truncated captions at publish time.
  - Old queued captions may still look visually dirty in DB, but publish-time payload is protected.
- Facebook image enhancer:
  - Implemented in `src/lib/image/social-image-enhancer.ts`.
  - Facebook quote/photo images use SVG overlay text, not AI-rendered text.
- Missing image fallback:
  - Implemented in `src/lib/social/facebook-quote-source.ts`.
  - Quote/photo publishing prefers original generated image, then falls back to `media/videos/<contentId>-short-thumb.jpg`.
- Cleanup protection:
  - Implemented in `src/actions/cleanup-uploaded-assets.ts`.
  - Cleanup is dry-run by default.
  - Image assets are protected when Facebook quote/photo queue items are pending.
  - Cleanup eligibility intentionally requires YouTube Short + Facebook Reel completion. Facebook quote/photo upload does not count as Facebook video completion for media asset cleanup.
- YouTube/Facebook publishing:
  - YouTube Shorts publishing exists.
  - Facebook Reel publishing exists.
  - Facebook quote/photo publishing exists.
  - Upload queue tracks platform, video type, status, schedule, uploaded URL, errors, and uploaded time.
- YouTube Analytics retention:
  - YouTube Data API sync writes view/like/comment/duration metadata.
  - YouTube Analytics API writes `avg_view_duration_sec` and `retention_pct`.
  - CTR/impressions remain unavailable in the current public report scope.
- Topic performance:
  - `getTopicPerformanceAction()` ranks topics by avg views, avg view duration, avg retention, and video count.
- Topic summary:
  - `getTopicPerformanceSummaryAction()` categorizes high/medium/low performers and extracts keywords/observations.
- Topic coverage:
  - `getTopicCoverageReportAction()` groups topics into semantic clusters and marks under-sampled vs well-sampled clusters.
- Prompt versioning:
  - `content_generations.prompt_versions` exists.
  - Registry exists in `src/lib/prompt-version-registry.ts`.
  - New generation records can store prompt versions.
  - Quote Pipeline V1 adds `prompt_versions.quote` for explicit quote artifact metadata on new `phat_phap` Facebook quote/photo sidecars.
- Experiment tracking:
  - `content_generations.experiment_id` and `experiment_variant` exist.
  - Helper exists in `src/lib/content-experiments.ts`.
  - Current new assignment is `HOOK/HOOK_V1`.
- Short Cover Asset Generator (integrated):
  - `src/lib/short-cover-engine.ts` — rule-based coverText engine (no LLM).
  - `src/lib/image/short-cover-asset-generator.ts` — Sharp compositor, 1080×1920 JPEG.
  - Generates cover unconditionally before short/reel render (non-fatal). Reuses cached asset.
  - First-frame overlay gated behind `SHORT_COVER_INTRO_ENABLED=true` (default off, Phase 2).
  - DB columns: `short_cover_asset_path`, `short_cover_text`, `short_cover_generated_at` (migration 0037).
  - Cleanup guards cover asset until YT+FB publishing completes.
  - Test: `npx tsx --tsconfig tsconfig.json scripts/test-short-cover-asset.ts --content-id <uuid>`
- Hook Tracking (integrated):
  - `inferHookType()` in `src/lib/hook-engine.ts` — classifies hook into 13 English types.
  - DB columns: `hook_type`, `hook_variant`, `hook_generated_at` (migration 0038).
  - Saved at generation time with `[HOOK_TRACKING]` log.
  - `getHookTypePerformanceAction()` in publishing-analytics.ts aggregates by type.
  - Hook Type table visible in `/publishing/analytics` alongside per-hook table.
  - 335 existing rows backfilled via `scripts/backfill-hook-types.ts --execute`.
- AiMax TTS provider + settings UI (integrated):
  - AiMax is available as a second provider behind the shared TTS provider registry; VieNeu remains intact as fallback/default unless configured otherwise.
  - Admin UI now exists at `Settings -> TTS -> AiMax` for API settings, balance check, Vietnamese voice sync, default voice roles, and test generation.
  - AiMax longform is configured to prefer single-job narration by default, with chunking kept as an optional fallback.

### Scope Reduction (2026-06-26 decision, executed 2026-06-27)

The project owner narrowed active scope to: the `phat_phap` short pipeline (`tts_short` + `legacy_quote_short`, YouTube Short + Facebook Reel publishing, short cover/hook tracking/subtitle validation/upload queue/analytics) and the Story Library **crawler** only (metadata crawl, chapter-text crawl, resume, retry). `tang_sau`, the longform pipeline, Story Studio generation, Audio Story TTS/episode/publishing features, and (per a follow-up decision) the unused `finance_news` branch have been removed or disabled at the code level. AiMax TTS was kept as shared infra (it has its own first-class `phat_phap` voice config) — only its Audio Story/Story Studio/longform call sites were removed. Full classification, execution log, and remaining follow-ups (DB table cleanup, historical `tang_sau`/`long_video` row disposition — explicitly deferred, not done) are in `docs/SCOPE_REDUCTION_AUDIT_2026_06_26.md`. `tsc`/`eslint` were verified clean against the pre-existing baseline after each phase; no DB/queue mutation was performed in any phase.

### Current local DB signals

Snapshot captured on 2026-06-02:

- YouTube short: 79 published videos, 9,465 latest total views.
- Facebook short/Reel: 7 published videos, 377 latest total views.
- Facebook quote/photo: 2 published posts.
- Analytics coverage: 83/88 published videos have `latest_fetched_at`.
- Retention coverage: 44/79 YouTube videos have `retention_pct`.
- Topic sample depth is still thin: 73/75 topics had fewer than 2 videos in the captured topic summary.
- Experiment tracking is new: 112 content items were unassigned, 3 were `HOOK/HOOK_V1`.

### Publishing Reliability Status (June 2026)

Completed:
- P0 slot collision fix: `queued`, `uploading`, and `done` rows now all block their slot; `cancelled` rows do not. Facebook quote/photo insertion has slot-level collision guard. See ADR-027.
- Upload slot audit command exists: `npm run audit:upload-slots` (`scripts/audit-upload-slots.ts`). Run after any Docker downtime or queue cleanup.
- Queue recovery completed 2026-06-16 after Docker/Postgres outage. Current health: `overdue_queued = 0`, active slot collisions = 0.
- Quote style lock (2026-06-18): `phat_phap` and `tang_sau` quote content uses `static_deep_quote` with kinetic disabled. Quote validation now rejects cliché/list outputs for protected quote channels. Quote style work must not modify scheduler, cron, cooldown, or upload slot logic.
- Quote Pipeline V1 (2026-06-18): `phat_phap` Facebook quote/photo remains HH:05 sidecar, but new rows now attempt independent LLM quote text before falling back to extracted `shortContent` or safe fallback quote. The chosen quote artifact is persisted in `content_generations.prompt_versions.quote` with `quoteSourceType`, style, kinetic flag, validation status, source content linkage, and generator version. Publish-time Facebook quote rendering reads this stored artifact when available, so quote automation is explicit and auditable without changing queue timing. `tang_sau` keeps YouTube `legacy_quote_short` visibility only; `tang_sau` Facebook quote/photo remains blocked until a real Facebook channel/config exists.
- Tầng Sâu YouTube-first quote lane (2026-06-19): `tang_sau` quote automation is now an explicit YouTube-only `quote_pipeline` lane that generates `legacy_quote_short`, persists `prompt_versions.quote`, and schedules through the existing YouTube short slot helpers. It targets a small future queue only, caps inserts to one row per run, and must not add Facebook quote/photo or bypass queue reliability guards.
- Cross-channel quote safety lock (2026-06-19): runtime scheduling now fails closed if `content_generations.channel_key` and destination `social_channels.channel_key` do not match, and the Tầng Sâu YouTube quote lane additionally rejects non-`philosophy` / non-`legacy_quote_short` content before any `upload_queue` insert. The lane remains disabled until operator review is complete.
- YouTube quota rotation works across multiple OAuth credential rows for the same channel. Separate rows per GCP Project client are the rotation pool.
- Supporting incident record: `docs/DOCKER_DB_RECOVERY_AND_QUEUE_STATUS_2026_06_16.md`

Current publishing rhythm (do not change without explicit decision):
- phat_phap: YouTube short + Facebook short at HH:00, Facebook quote/photo at HH:05 same hour.
- tang_sau: YouTube standalone at HH:00.
- tang_sau quote lane is YouTube-first only. Do not add tang_sau Facebook quote/photo in this lane.

### Publishing Semantics — phat_phap Content Item Cadence

For `phat_phap` / Giới Định Tuệ, the scheduling unit is a generated content video item, not an individual `upload_queue` platform row.

A single generated video content item must publish to all required video platforms at the same scheduled slot.

Required platform set by content type:

- `tts_short`
  - YouTube Short
  - Facebook Reel
- `legacy_quote_short`
  - YouTube Short
  - Facebook Reel

Content rhythm:

- Publishing window is `06:00` to `22:00` VN time.
- Each hourly slot contains one content video item.
- Content video types alternate by slot:
  - TTS video
  - Quote video
  - TTS video
  - Quote video
- The hourly cadence applies to content items, not to platform upload rows.

Platform-row semantics for the same content item:

- Required platform rows must share the same `content_generation_id`.
- Required platform rows must share the same `scheduled_at`.
- A single hourly slot is complete only when the same content item is represented on every required platform row for that video type.
- Any operator repair/sync flow for `/publishing/queue` must preserve this content-item model. Safe sync is preview-first and fail-closed:
  - scope only `phat_phap` video short/reel rows for `tts_short` and `legacy_quote_short`
  - only future mutable rows (`queued` / `pending`) may be created or aligned
  - do not delete rows, move done/published rows, or mutate uploading rows
  - do not auto-repair ambiguous collisions; send those to manual review
  - `facebook/quote` photo-post sidecar remains a separate lane and is out of scope for queue-pair sync

Correct example:

```txt
06:00 TTS video A   -> YouTube Short   -> Facebook Reel
07:00 Quote video B -> YouTube Short   -> Facebook Reel
08:00 TTS video C   -> YouTube Short   -> Facebook Reel
09:00 Quote video D -> YouTube Short   -> Facebook Reel
```

Incorrect examples:

```txt
Wrong: platform rows are treated as separate hourly content slots

06:00 YouTube TTS video A
07:00 Facebook TTS video A
08:00 YouTube Quote video B
09:00 Facebook Quote video B
```

```txt
Wrong: different content items are posted to different platforms at the same slot

06:00 TTS video A   -> YouTube
06:00 Quote video B -> Facebook
```

Facebook photo post distinction:

- Facebook photo/image-caption posts are a separate lane.
- They must not be confused with `legacy_quote_short`.
- `legacy_quote_short` is a quote video, not a Facebook photo post.

Cleanup rule:

- Cleanup is content-level, not single-platform-row-level.
- `tts_short` cleanup is allowed only after both YouTube Short and Facebook Reel are done.
- `legacy_quote_short` cleanup is allowed only after both YouTube Short and Facebook Reel are done.
- If any required platform upload row is missing, queued, uploading, pending, failed-but-retryable, or otherwise not done, cleanup must not delete required assets.

### Story Library Crawl Scheduling

Story Library crawling is intentionally conservative and must stay isolated from TTS, rewrite, Story Studio runtime, scheduler, and publishing flows.

Safe cron examples:

```bash
# Metadata-first catalog discovery every 2 hours, bounded to 50 stories
0 */2 * * * cd /Users/bichtuyen/code/content_pipline && pnpm crawl:stories --site truyenfull.today --limit-stories 50

# Conservative chapter-text crawl every 30 minutes, bounded to 20 chapters total
*/30 * * * * cd /Users/bichtuyen/code/content_pipline && pnpm crawl:stories:resume --source-site truyenfull.today --max-stories 20 --max-chapters 20

# Failed-only retry every 6 hours, bounded to 10 chapters total
15 */6 * * * cd /Users/bichtuyen/code/content_pipline && pnpm crawl:stories:resume --source-site truyenfull.today --failed-only --max-stories 10 --max-chapters 10
```

Operational guardrails:

- Keep Story Library crawl concurrency at `1` for cron runs unless there is an explicit operator reason to raise it.
- Each invocation must stay bounded by the provided story/chapter caps and exit after that work is done.
- Overlapping invocations must skip cleanly with `[STORY_CRAWLER] skipped_overlap`.
- Do not add proxy rotation, CAPTCHA solving, Cloudflare bypass, or aggressive retry behavior.

### Story Library LaunchAgents

For the local macOS development/server machine, Story Library crawl scheduling can also be prepared as user-scoped LaunchAgents so crawling resumes after login or restart without touching the main publishing scheduler.

What the LaunchAgents do:

- catalog discovery/detail/indexing every 2 hours
- chapter resume every 30 minutes with `--max-chapters 20` (raised from 10 on 2026-06-22; validated against a clean post-fix window with zero `blocked_or_cloudflare_detected`, `failed_request`, or `stale_lock_replaced` events; concurrency and interval unchanged)
- failed-only retry every 6 hours with `--max-stories 5 --max-chapters 10`

Commands:

```bash
pnpm run story-library:schedule:install
pnpm run story-library:schedule:uninstall
pnpm run story-library:schedule:status
```

Related one-shot wrappers:

```bash
pnpm run story-library:crawl:catalog-once
pnpm run story-library:crawl:chapters-once
pnpm run story-library:crawl:retry-failed-once
```

Operational warning:

- Do not increase crawl rates until there are 24-48 hours of stable logs in `logs/story-crawler.log`, `logs/story-crawler.launchd.out.log`, and `logs/story-crawler.launchd.err.log`.
- Keep the current low-rate bounded defaults unless there is an explicit operator decision to change them.
- Do not add Cloudflare bypass, proxy rotation, CAPTCHA solving, or fingerprint evasion to this setup.

Audio Candidate Board (2026-06-22):

- Added `/admin/story-library/audio-candidates` — a read-only decision board answering "which crawled stories are clean enough to move toward TTS preview?" A story does not need to be fully crawled; it needs enough contiguous, usable chapter text from chapter 1 onward.
- Readiness scoring lives in `src/lib/story-library/audio-readiness.ts` (`computeAudioReadiness`) and is shared by the board action (`getStoryLibraryAudioCandidatesAction` in `src/actions/story-library.ts`) and a new "Audio readiness" card on the story detail page.
- Classifies each story into `ready_for_preview`, `needs_more_chapters`, `blocked_by_missing_chapters`, `has_failed_chapters`, `no_text_yet`, or `needs_review` based on contiguous chapter-1 text, missing/failed/recovered chapter counts, and an estimated-audio-minutes heuristic (2000 words ≈ 6 minutes, matching the Ngọc Huyền TTS test at speed 1.1/pitch 2.0).
- Does not create TTS jobs, audio files, or previews; does not touch crawler rate/order, publishing, or YouTube/Facebook flows.

Episode Builder Preview (2026-06-23):

- Added `/admin/story-library/audio-candidates/[storyId]/episode-preview` — a read-only chapter-boundary episode plan and TTS script preview built from already-crawled chapter text. Linked from "Build episode preview" on `ready_for_preview` candidate rows and from the story detail Audio readiness card.
- Planning logic lives in `src/lib/story-library/audio-episode-planner.ts` (`planEpisode`, `buildEpisodeScriptPreview`), reusing the same missing/failed/recovered chapter classification as `audio-readiness.ts`. Selects only consecutive whole chapters from a chosen start chapter, stopping at a chapter boundary once the target minute band (default 55–65 min) is reached or a missing/failed chapter blocks further extension before the floor.
- Script preview is fixed Tee Audio intro/outro plus a `[PAUSE_0.5S]` preview marker around verbatim, whitespace-normalized chapter text — chapter titles/numbers are never included in the spoken body.
- Does not call TTS, create audio files/jobs, or touch publishing/upload-queue/YouTube/Facebook flows. Smoke-tested via `npm run test:audio-episode-planner`.

TTS Preview Sample (2026-06-23):

- Added a "TTS Preview Sample" section on the Episode Preview page: renders a short 3 or 5 minute opening sample (intro → real 0.5s silence → story content; outro only if the sample naturally reaches the selected episode's end) using the existing Audio Story AiMax TTS provider and Ngọc Huyền voice (fixed at speed 1.1 / pitch 2.0 for this tool, independent of the global Audio Story settings page).
- Sample-script extraction (`src/lib/story-library/audio-preview-sample-script.ts`) is pure/testable — cuts at a sentence boundary near the target word count (1000 words ≈ 3 min, 1660 words ≈ 5 min) and never includes chapter titles/numbers. Synthesis (`src/lib/story-library/audio-preview-sample-tts.ts`) reuses `resolveChapterTtsProviderAndVoice` and `concatEpisodeAudioSegments` from the Audio Story pipeline — the `[PAUSE_0.5S]` marker is never sent to TTS as spoken text; it is inserted as real ffmpeg-generated silence between segments.
- Output is a single WAV under `media/story-audio/preview/{storyId}/` with a JSON sidecar (no new DB table), served through the existing `/api/story-audio-local/` route. `.gitignore` extended to cover `media/story-audio/**` (a pre-existing gap before this change). Smoke-tested via `npm run test:audio-preview-sample-script`; one real AiMax sample was generated end-to-end against the target story to validate the integration.
- Does not create a full episode, publish, or touch upload_queue/YouTube/Facebook. Does not change crawler rate/schedule or Missing Chapter Recovery.

Pre-TTS Content Verification (2026-06-23):

- Added a "Pre-TTS Content Verify" section on the Episode Preview page, before "TTS Preview Sample." `src/lib/story-library/audio-content-quality.ts` detects dot-obfuscated source-site profanity/violence-word masking (e.g. `c.h.ế.t` → `chết`, mechanical dot removal only — never guesses missing diacritics or invents corrections), glued/missing sentence spacing, scraper placeholder/gate boilerplate, leaked `Chương N` chapter markers, and too-short/suspicious chapter text. Status is `pass` / `warn` / `block`, with a `recoverableViaNormalization` flag distinguishing mechanically-fixable issues (dots/spacing) from unresolvable ones (placeholder noise, chapter markers, too-short text — normalization never deletes/rewrites real content, so these always block).
- `createStoryLibraryEpisodePreviewSampleAction` now gates every TTS Preview Sample call through `evaluateAudioContentForTts()`: blocked text never reaches the TTS provider (a `blocked` sample record is written instead, with the message "Content verification failed. Fix or review text before TTS." and no API call); mechanically-fixable blocks/warnings are retried against normalized text, and the UI/metadata clearly mark when normalized (not raw DB) text was used for that sample.
- Validated against the real corpus: 0 dot-obfuscation instances in the target story's current chapters 1–12 range (confirmed elsewhere in the crawled corpus — 2500+ real instances across other stories, e.g. `m.á.u`→`máu`, `đ.á.n.h`→`đánh`). Target story's current range status is `warn` (glued sentence-boundary spacing only) → sample generation proceeds using normalized text.
- Read-only/preview-only: never overwrites `story_source_chapters.content_text` in the DB. Does not call AI rewrite models, summarize, or change meaning. Smoke-tested via `npm run test:audio-content-quality`.

Pre-TTS Chapter Audio Text Normalization (2026-06-23):

- Added a persisted, chapter-level "audio text" layer: 7 new columns on `story_source_chapters` (`audio_text`, `audio_text_status` raw/normalized/needs_review/approved/blocked, `audio_text_issue_count`, `audio_text_normalization_version`, `audio_text_updated_at`, `audio_text_reviewed_at`, `audio_text_review_note` — migration `drizzle/0054_story_chapter_audio_text.sql`). Raw `content_text` is never overwritten. Critically, this status is fully independent from the pre-existing `reviewed_at` ("Đã kiểm tra") human read-through flag — a chapter can be marked reviewed and still be `audio_text_status = raw` with real unresolved obfuscation, exactly the bug this closes.
- New pure module `src/lib/story-library/audio-text-normalizer.ts` (`analyzeChapterAudioText`, `normalizeChapterAudioText`, `normalizeEpisodeAudioText`) adds **star-obfuscation** detection/resolution on top of the existing dot-obfuscation/spacing/placeholder/chapter-marker checks — e.g. `g**t ch*t` → `giết chết`, `l**m` → `làm`, via an exact hand-maintained dictionary only (never an algorithmic star-count guess). Unresolved tokens (no dictionary entry) are left untouched and escalate status to `block`.
- Chapter detail page (`/admin/story-library/[storyId]/chapters/[chapterId]`) gained an "Audio text quality" panel: live preview + persisted status, Analyze/Normalize, Approve, Mark needs review, and Reset buttons, plus a raw/normalized text toggle. Story detail page gained a bulk "Audio text review" section (read-only Analyze scan + a Normalize-all action over already-crawled chapters only — never crawls new chapters) with a "needs review" queue.
- Episode Builder Preview now prefers each selected chapter's `audio_text` over raw `content_text` once normalized/approved, shows an audio-text status summary for the selected range, and `createStoryLibraryEpisodePreviewSampleAction` now blocks on a per-chapter basis (unresolved star-obfuscation, placeholder noise, or `blocked` status) before any TTS call — superseding the prior turn's whole-script-only gate.
- Live validation on the target story: chapter 1 had `reviewed_at` set but `audio_text_status = raw` (the exact reported bug), with 5× `g**t ch*t` + 1× `l**m` resolved to `needs_review` after normalization. A full bulk scan of all 494 currently-crawled chapters found 1 pass / 234 warn / 48 needs_review / 211 blocked — the large blocked count is mostly **unresolved** star tokens with no safe dictionary entry yet (correctly left unresolved rather than guessed); a few additional high-confidence dictionary candidates (e.g. `kh*ng b*`, `k*ch th*ch`) were found during this scan but intentionally NOT added without explicit user confirmation, per this module's no-guessing rule. Confirmed live: attempting a TTS sample on the default chapter 1–12 range is correctly **blocked** (chapters 3/4/6 contain unresolved star tokens), with no TTS API call made.
- Smoke-tested via `npm run test:audio-text-normalizer`. No crawler/TTS-core/publishing files changed.

Manual Audio Text Import (2026-06-23):

- Added a "Manual Audio Text Import" form on the chapter detail page for chapters whose raw text has unresolved blockers (e.g. star-obfuscation with no safe dictionary mapping). Stores into the same `audio_text` column (never `content_text`); new `audio_text_source` column (migration `drizzle/0055_story_chapter_audio_text_source.sql`) distinguishes `manual_import` from automated-derived. Source URL/site/note are appended as structured text into the existing `audio_text_review_note` rather than adding more columns.
- Four explicit modes (`draft` / `analyze` / `needs_review` / `approve`) all re-analyze the pasted text first — manual import is not a bypass. "Save and approve" only sets `audio_text_status = approved` (and `audio_text_reviewed_at`) when the analysis has no blocking issue; otherwise it saves as `blocked` with the refusal reason recorded in the review note. `reviewed_at` ("Đã kiểm tra") is never touched by any of this.
- Episode Builder Preview's existing audio_text-preference logic (from the prior turn) already covers manual imports with no special-casing needed — it keys off `audio_text_status`/`audio_text_source` regardless of which path produced them. Chapter breakdown table and bulk review queue now show "Manual import" provenance. Bulk "Normalize" on the story detail page now skips `approved` chapters so it can never silently overwrite a curated import.
- Fixed a latent bug found while writing the DB-backed test: several `revalidatePath()` calls added across the last few turns threw outside a real Next.js request (e.g. when a server action is invoked directly from a script) — replaced with the existing `safeRevalidatePath` pattern already used elsewhere in this file.
- New DB-backed test `npm run test:audio-text-manual-import` (creates/deletes a throwaway test story) covers: raw text never overwritten, `reviewed_at` untouched, `audio_text_reviewed_at` only set on successful approve, blocked text cannot be approved, clean text can be approved, Episode Preview prefers approved manual text, and unapproved/blocked imports fall back to raw text (so the TTS gate still re-checks and blocks).

Manual Audio Text Import — bug audit & fix (2026-06-23, later same day):

- Root cause #1: `setStorySourceChapterAudioTextReview` (`src/lib/story-library/repository.ts`) set `audio_text_reviewed_at` unconditionally, even when called with `status: "needs_review"`. This is exactly why the reported chapter (`bd30c827...`, story `b8c7afd9...` chapter 513) showed a review timestamp despite never having been approved. Fixed to only stamp the timestamp on `status === "approved"`.
- Root cause #2 (the real-world trigger): the chapter detail page's "Analyze / Normalize audio text" button and "Reset to raw-derived normalized version" button both called the same action, which always re-derives `audio_text` from raw `content_text` — silently discarding any manual import the moment an admin clicked what looked like a safe "re-check" button. Split into two distinct actions: `reanalyzeStoryLibraryChapterAudioTextAction` (re-scores whatever is currently stored, preserving its text and provenance — safe to use after a manual import) and `resetStoryLibraryChapterAudioTextToRawAction` (the only action that discards a manual import and flips provenance back to derived-from-raw; UI now shows an explicit warning before this is used).
- Found and fixed a related gap while live-validating against `c0d4932a...` (chapter 309): chapters whose original crawl failed/was missing have raw `word_count = 0`. Episode selection math (`toEpisodePlannerChapterInput`) and the readiness card (`toAudioReadinessChapterInput`) both gated on that raw column even when an approved manual `audio_text` existed, so a fully-recovered chapter could still be skipped as "0 words". Both mappers now fall back to counting the actual `audio_text` when the raw word count is 0 and the audio text status is usable.
- Live-validated end to end against the reported chapter: imported clean text, analyzed (now correctly tagged `audio_text_source = manual_import` instead of "derived from raw"), approved, confirmed Episode Preview prefers it, confirmed `c0d4932a...` still behaves correctly (unresolved view excludes it, audio-text-recovered view includes it, Episode Preview selects it despite `crawl_status = failed`).
- New test coverage in `npm run test:audio-text-manual-import`: needs_review never sets `audio_text_reviewed_at`, approve refuses on a still-blocked stored audio_text, re-analyze preserves text/provenance/note while clearing a stale approval, reset discards the manual import and flips provenance to derived-from-raw, and the word_count=0 fallback keeps a fully-recovered chapter selectable.
- No schema changes. No crawler, TTS, or publishing/upload code touched.

Missing Chapters counters/labels — audit & fix (2026-06-23, later same day):

- Root cause of the "16" badge: the Missing Chapters page's "unresolved" count (`getStoryLibraryMissingChapterView` in `src/actions/story-library.ts`) only carved out `audio_text_recovered` (approved) and `fallback_recovered` (imported) from the generic bucket — every chapter with a manual `audio_text` import sitting in `needs_review`/`normalized`/`blocked` still counted as plain "missing", even though something had already been done for it. For story `b8c7afd9...`, all 16 were `needs_review` manual imports with zero actual blockers — nothing was genuinely unresolved.
- Split the bucket into 5 mutually-exclusive views: `unresolved` (nothing imported, nothing usable), `audio_text_needs_approval` (manual/derived audio_text exists, analyzer found no blockers, just needs an approve click), `audio_text_blocked` (audio_text exists but still has unresolved blockers), `audio_text_recovered` (approved), `fallback_recovered` (raw text recovered via URL). New `rawMissingCount` summary field reports the pure raw-provenance count (`last_error = 'source_missing_chapter'`) separately, never used for blocking.
- Found a subtlety while implementing: `audio_text_status = 'needs_review'` is ambiguous — `markStoryLibraryChapterAudioTextNeedsReviewAction` sets it unconditionally as a human override, so the underlying text can still genuinely be blocked. `getStoryLibraryMissingChaptersAction` now re-analyzes the stored `audio_text` live (`hasUnresolvedAudioTextBlockers`) to tell "safe, just needs approval" apart from "actually still blocked" rather than trusting the DB enum alone.
- `src/lib/story-library/audio-readiness.ts` (shared by the story detail card and Audio Candidate Board) gained the same breakdown: `unresolvedMissingForAudioCount` (renamed from `missingChapters`, narrower — excludes needs-approval/blocked), `rawMissingChapters`, `audioTextNeedsApprovalChapters`, `audioTextBlockedChapters`, `audioTextRecoveredChapters`. The Candidate Board's `hasMissingChapters` filter and default sort now key off the narrower count, so an approved manual audio_text no longer blocks a story's readiness ranking. Per-chapter episode-blocking logic (`isMissingClassified`, used by the episode planner) is unchanged — an unapproved chapter still correctly blocks the episode until approved.
- No sidebar/nav badge exists today next to "Missing Chapters" (it's a plain static link) — requirement G was conditional on one existing, so nothing was added there; the practical equivalent (the page's own default-tab count) now reflects the narrower number.
- Live-validated against `b8c7afd9...`: before the fix, "unresolved" = 16 (rawMissingCount 18, audioTextRecoveredCount 2, importedCount 2 — these 4 numbers don't sum to 16 because raw/recovered/imported aren't mutually exclusive with each other). After the fix: `unresolvedMissingForAudioCount` = 0, `audioTextNeedsApprovalCount` = 16, `audioTextBlockedCount` = 0 — confirming all 16 were safe manual imports awaiting approval, not genuinely missing chapters.
- New test coverage in `npm run test:audio-text-manual-import`: approved audio_text counted in recovered not unresolved, safe-unapproved import counted in needs_approval not unresolved, a needs_review override on still-blocked text correctly lands in blocked (not needs_approval) via the live re-analysis, a raw-missing chapter with no audio_text at all counts as unresolved, and the Candidate Board's `hasMissingChapters` filter/row data key off `unresolvedMissingForAudioCount`.
- No schema changes. No crawler, TTS, or publishing/upload code touched.

Missing Chapters default tab still showing needs-approval rows — fix (2026-06-24):

- Root cause: `getStoryLibraryMissingChapterView` classified `audio_text_needs_approval`/`audio_text_blocked` purely from `audio_text_status`, never checking `audio_text_source`. A chapter can carry a stale AUTO-DERIVED `needs_review`/`normalized`/`blocked` audio_text on a raw-missing chapter (e.g. left over from an old normalize pass on placeholder/garbage raw text) with no human ever having imported anything for it — that row was being counted as "needs approval" (or worse, surfaced in a tab the summary cards didn't agree with), inflating that bucket and shrinking "unresolved" incorrectly, or vice versa depending on live data drift.
- Fixed by requiring `audio_text_source === "manual_import"` for both `audio_text_needs_approval` and `audio_text_blocked` classification in `getStoryLibraryMissingChapterView` (`src/actions/story-library.ts`) — anything without manual provenance falls back to `unresolved`, since nobody has actually addressed that chapter yet. Applied the same gate to `isAudioTextNeedsApprovalClassified`/`isAudioTextBlockedClassified` in `src/lib/story-library/audio-readiness.ts` for consistency with the story detail card and Candidate Board.
- Also updated the missing-chapters page's row-label helper (`formatMissingChapterRecoveryLabel`) with the same gate, so the "All" view labels rows correctly too.
- Confirmed during this fix that the underlying view/tab/summary wiring from the previous turn (5 mutually-exclusive views, `unresolvedMissingForAudioCount` driving the default tab, live blocker re-analysis) was already correct in isolation — verified directly via the server action with a throwaway test story showing exactly 0 unresolved / 16 needs-approval, matching the summary cards. The live numbers the user observed differ from script-verified numbers because this is shared dev data that changes in the background between observations (no leftover test-story rows were found) — not a caching bug. The real, reproducible gap was the missing provenance check, found by diffing one real row (`audio_text_status='needs_review'`, `audio_text_source=null`, `last_error='source_missing_chapter'`) that the source-blind logic misclassified.
- New test coverage in `npm run test:audio-text-manual-import`: a non-manual (auto-derived) needs_review audio_text on a raw-missing chapter must NOT count as needs_approval and must stay unresolved; each view's row count must exactly equal its corresponding summary count; rawMissingCount must never gate the default unresolved view.
- No schema changes. No crawler, TTS, or publishing/upload code touched. View query-param name remains `unresolved` (not renamed to `unresolved_for_audio`) — behavior now matches the spec exactly, only the param string differs from the task's suggested name.

Chapter detail page still showing raw state as effective state — fix (2026-06-24):

- Root cause: the missing-chapters/readiness/episode-planner fixes from earlier turns already made approved manual `audio_text` the effective text for counts/selection at the story/board level, but the **chapter detail page itself** never used any of that — its header always printed the raw `chapter.wordCount` DB column, and its "TTS readiness" line was hand-rolled logic that only checked the DB `audio_text_status` enum (so a `needs_review` status always showed "Needs audio text review", even when the page's own live re-analysis (`audioTextPreview.status`) was `pass`/`warn` and the Approve button was already enabled).
- Added `src/lib/story-library/effective-text.ts` — a new pure module exporting `getEffectiveChapterTextState(chapter, { liveAnalyzerStatus? })`, returning `rawStatus` (crawl status, raw word/char counts, raw source state — provenance only, never written to), `audioTextStatus` (source, status, computed word/char counts, reviewed-at), and `effectiveStatus` (`effectiveTextSource`: `approved_audio_text | audio_text_pending_approval | raw_content_text | none`, effective word/char counts, `isTtsReady`/`needsApproval`/`isBlocked`, and a human label). Word/char counts are computed on read via the existing `countWords()` (no new schema columns — text is already in `audio_text`, so persisting a redundant count wasn't worth the migration).
- The optional `liveAnalyzerStatus` lets a caller with a fresh `analyzeChapterAudioText` result (the chapter detail page) override the persisted `needs_review` DB enum when the text is actually still blocked (mirrors the same ambiguity already handled in the Missing Chapters fix) — callers without a live analysis (bulk readiness/candidate board) fall back to trusting the DB status alone.
- Wired into the chapter detail page: header now shows `Raw: N words · Audio text: N words · Effective for TTS: N words`; the status card is split into three clearly labeled blocks (raw source / audio text / TTS readiness-effective) instead of one ambiguous mixed list. No change to the approve action itself — it already correctly preserved `content_text`/`crawl_status`/`reviewed_at`/provenance; this was purely a read-side display bug.
- Audio-readiness/episode-planner/candidate-board word-count-0 fallback (added in an earlier turn) was confirmed still correct and unaffected by this change — this fix only touches the chapter detail page's own rendering, which had never been wired to use that shared logic.
- New pure test `npm run test:effective-chapter-text` (no DB) covers: approved manual audio_text on a raw-failed/0-word chapter yields a non-zero effective word count and `isTtsReady`; pass-but-unapproved yields "Ready to approve for TTS" with `needsApproval`; blocked yields `isBlocked`; a live-analyzer override correctly catches a `needs_review` DB status that is actually still blocked; raw word/char counts never change regardless of audio_text state; effective counts are computed from `audio_text`, not raw; a normal chapter with only raw text still resolves via `raw_content_text`; a chapter with neither resolves to `none`/"Missing usable text".
- Live-validated against the reported chapter (`79dfa612...`): before — raw `word_count=0`, `audio_text_status='approved'`, `audio_text_source='manual_import'`, 8023-char/~1820-word audio text, but the page only ever showed the raw 0-word header and a generic readiness line. After — header reads "Raw: 0 words · Audio text: 1,820 words · Effective for TTS: 1,820 words", TTS readiness reads "TTS-ready via approved manual audio text". Also re-verified `c0d4932a...`, `bd30c827...`, `977b12b9...` and a pass-but-unapproved chapter (`41d231a5...`, approved live through the UI during validation) all render correctly.
- No schema changes. No crawler, TTS provider, or publishing/upload code touched.

Crawl priority: finish "Full" (completed) novels first (2026-06-25):

- User request (Vietnamese): prefer crawling completed novels and finish one story fully before scattering across many. `listStorySourcesForResumeWithFilters` (`src/lib/story-library/repository.ts`) drives which story the scheduled resume crawl picks each run — its shared per-run chapter budget (default 20, see `scripts/story-library/crawl-chapters-once.sh`) means the ORDER of this query, not just a tiebreak, decides which story actually gets chapters crawled.
- Added `status = 'Full'` as a second sort key, after the existing partial-first key and before the `createdAt` stable tiebreak: finish in-progress stories first (unchanged), then among not-yet-started stories prefer ones whose source-site status is `'Full'` (a completed novel has a fixed, finite chapter count — crawling it to completion is a well-defined task, unlike an ongoing novel that keeps growing).
- `storySources.status` already existed and is already populated by the catalog parser (100 of 108 current stories have `status = 'Full'`); no schema change needed.
- Did not change catalog/story-discovery crawling (`crawlStoryCatalog`, which walks `truyen-moi` "newest" listing pages) — that only adds new story rows to track, it doesn't crawl chapter text, so it isn't the lever the user was describing.
- No schema changes. No crawler rate/schedule changed — only the selection order within the existing budget.

Known operational risks (watch items, not immediate tasks):
- Docker/Postgres downtime creates upload backlog; unguarded drain can cause overposting. Run `audit:upload-slots` and defer/cancel overdue rows if backlog is large before releasing cron.
- YouTube per-channel daily upload count limit is separate from API quota and cannot be solved by OAuth credential rotation.
- `social_channels.last_error` may remain `'invalid_grant'` after OAuth reconnect because `connectYouTubeChannel` does not clear it. Stale flag is misleading but does not block uploads.
- Telegram success notifications can accumulate during backlog drain; they are non-blocking but noisy.
- One known historical cross-channel YouTube incident exists from 2026-06-05: a `phat_phap` `legacy_quote_short` was published to the `tang_sau` YouTube destination (`published_videos.id = d4c2c02b-9a60-4664-8549-212bcc030a25`, `upload_queue.id = fbace5a9-a4ad-4928-bc1e-232d12b8d35e`). No active bad queue rows remain, but manual YouTube disposition is still required.

### YouTube Destination Safety — OAuth Is Not the Publishing Target

For YouTube, the Gmail / OAuth login is authentication only. It is not the publishing destination.

This matters because multiple YouTube channels may be managed under the same Google account, including:

- `tang_sau` / Tầng Sâu
- `phat_phap` / Giới Định Tuệ
- Tee Audio

Operational rule:

- The real publishing destination is the explicit `social_channels` row selected for the upload.
- The upload worker must resolve and use the intended destination channel mapping, not just a shared Gmail / OAuth identity.
- Queue rows must preserve the exact YouTube destination through:
  - `upload_queue.channel_id`
  - `social_channels.id`
  - `social_channels.platform_channel_id`
- If the destination row cannot be validated at publish time, YouTube upload must fail closed.

Required publish-time checks:

- `upload_queue.platform` must be `youtube`.
- `upload_queue.channel_id` must exist.
- `social_channels.platform` must be `youtube`.
- `social_channels.platform_channel_id` must exist for the intended YouTube destination.
- `social_channels.channel_key` must still be consistent with the queued content ownership rules.
- A usable YouTube credential must exist on the selected destination row.
- Upload-time logging and audits must print both:
  - OAuth credential identity (safe non-secret identity only)
  - intended YouTube channel identity / destination channel id

Operator note:

- Shared Gmail / OAuth across Tầng Sâu, Giới Định Tuệ, and Tee Audio is allowed.
- Shared Gmail / OAuth must never be treated as proof that the upload target is correct.

Recommended follow-up reliability tasks (small, not roadmap):
1. Add max-overdue-per-cron-run guard or stale-overdue deferral policy to prevent overposting after outage.
2. Clear `social_channels.last_error` on successful YouTube reconnect in `connectYouTubeChannel`.
3. Fix `isTokenRevokedError` to detect structured `invalid_grant` from YouTube API response body (not only from `err.message`).
4. Batch Telegram success notifications during backlog recovery into one summary per drain window.

## 3. Model and Image Quality Strategy

Goal: improve content and image quality without increasing cost blindly.

The current repo already has technical configuration points for models:

- `CONTENT_GEN_MODEL`
- `NEXT_PUBLIC_LLM_TEST_MODEL`
- `LONGFORM_MODEL`
- per-niche `promptTemplates.model`
- image config keys in `app_config`
- Fal.ai model keys in `src/lib/image-config-constants.ts`

The missing layer is not another provider migration. The missing layer is a clear routing policy: cheap models for low-risk structured tasks, stronger-but-affordable models for script quality tests, and image post-processing before expensive provider changes.

### Current model usage audit

| Stage | Current source | Current/default model | Notes |
| --- | --- | --- | --- |
| Topic suggestion | `src/actions/content-generator.ts` | `openai/gpt-4o-mini` hardcoded/default param path | Low-cost task; output is short topic list. |
| Hook generation | `src/lib/hook-engine.ts`, `src/actions/hook-engine.ts` | `promptTemplates.model` / `CONTENT_GEN_MODEL` / `NEXT_PUBLIC_LLM_TEST_MODEL` / `openai/gpt-4o-mini` | Generates 20 hooks; quality matters, but call is cheap. |
| Hook scoring | `src/lib/hook-engine.ts` | same as hook generation | JSON/scoring task; cheap model is preferred. |
| Short script | `src/lib/script-engine.ts`, `src/actions/content-generator.ts` | same content model route | This is quality-critical and should be the first place to A/B test a stronger model. |
| Short repair | `src/lib/script-engine.ts` | same content model route | Repair loops multiply cost; monitor rewrite frequency. |
| Long script | `src/lib/script-engine.ts` | same content model route, usually from long prompt template/model | Quality-critical; stronger affordable model may be justified if retention improves or repair loops drop. |
| Long repair | `src/lib/script-engine.ts` | same content model route | High token volume; expensive if validation starts failing often. |
| Long metadata | `src/lib/longform-engine.ts` | `LONGFORM_MODEL` -> `google/gemini-2.0-flash` | Structured metadata, title, description, tags, pinned comment, thumbnail intent. |
| Image prompt, short | `src/lib/pipeline/images.ts` | `image_prompt_model` -> `openai/gpt-4o-mini` | JSON/English prompt writing; cheap model preferred. |
| Image prompt, long | `src/lib/pipeline/long-images.ts` | `long_image_prompt_model` -> `openai/gpt-4o-mini` | Cheap model preferred unless prompts are visibly poor. |
| Long thumbnail prompt | `src/lib/pipeline/long-images.ts` | `long_thumbnail_llm_model` -> `openai/gpt-4o-mini` | Prompt writing only; image quality mostly depends on render and post-processing. |
| Title scoring | `src/lib/longform-engine.ts` | `LONGFORM_MODEL` -> `google/gemini-2.0-flash` | Scoring/JSON task; cheap model preferred. |
| Short cover text | `src/lib/short-cover-engine.ts` | rule-based, no LLM/API | Keep local/read-only until tracking is useful. |

### Model Strategy

Use three routing tiers:

| Tier | Purpose | Recommended use | Current repo-compatible model policy |
| --- | --- | --- | --- |
| `cheap` | Fast, low-cost structured work | topic, hook scoring, title scoring, metadata, tags, pinned comment, image prompt, coverText if LLM is later added | Keep `openai/gpt-4o-mini` / `google/gemini-2.0-flash` style models. |
| `balanced` | Better language quality without premium cost | short script, long script, script repair tests | A/B test a stronger affordable model only for script stages; do not route every task to it. |
| `quality` | Expensive quality checks or one-off premium generation | controlled script quality experiments, not daily default | Use only behind explicit experiment variant and budget tracking. |

Recommended default:

- cheap/fast model for topic, hook, coverText, metadata, scoring, tags, and image prompt writing
- stronger but still affordable model only for short script and long script experiments
- no model change for image generation yet
- no global provider switch
- no prompt changes as part of model routing

The first model A/B test should compare script quality, not metadata/scoring. Metadata and scoring are already low-risk structured tasks where premium models are unlikely to improve views enough to justify cost.

### Image Cost/Quality Strategy

Keep Fal.ai as the default image provider for now.

Use three image modes:

| Image mode | Use case | Fal.ai model policy | Notes |
| --- | --- | --- | --- |
| `cheap` | Shorts/Reels background images, quote/photo fallback source | `fal-ai/flux/schnell` | Default for high-volume short assets. |
| `balanced` | long-video background images and higher-quality reusable assets | `fal-ai/flux/dev` | Current long-image default. |
| `quality` | long-video thumbnail image experiments only | `fal-ai/flux-pro/v1.1-ultra` or equivalent configured premium model | Do not use for all backgrounds. |

Important:

- Do not migrate image platforms now.
- Do not increase image generation quality globally.
- Use post-processing/enhancer first:
  - text overlay by code
  - gradient/vignette
  - crop/safe-area handling
  - contrast/readability improvements
  - reusable source image fallback
- For Shorts/Reels, cover quality should mostly come from layout, text, safe margins, and first-frame design, not more expensive AI image generation.

### When to upgrade models

Upgrade or A/B test a stronger model only when at least one of these is true:

- script quality issues are visible in final videos
- retention is weak despite good topic/hook/cover packaging
- repair loops become frequent enough that a stronger model may reduce total retries
- human review shows generic phrasing, weak emotional arc, or unnatural Vietnamese
- a controlled experiment can compare model variants with enough samples

Model upgrades should be scoped to:

- short script
- long script
- possibly hook generation if hook variety/quality is clearly weak

Do not upgrade every task together. That hides which change helped and can quietly multiply cost.

### When not to upgrade models

Do not upgrade models for:

- JSON scoring
- tags
- pinned comments
- basic metadata
- image prompt writing when the final issue is actually layout/post-processing
- topic suggestions before topic-family analytics is stable
- coverText while the current rule-based Short Cover Engine has not been integrated or measured

Also do not upgrade just because a model is newer. Upgrade only when it is attached to a measurable experiment or a clear quality failure.

### Cost risk

The largest cost risk is not topic/hook/metadata LLM usage. Existing cost docs show image generation dominates long-video cost, especially long backgrounds and premium thumbnails.

Current risk areas:

- accidental per-niche prompt template defaulting to expensive models
- repair loops multiplying script cost
- premium image models used for non-CTR-critical assets
- broad provider/model switches without A/B evidence

Preferred guardrail:

- keep cheap model for all structured tasks
- isolate stronger model tests to script stages
- keep image provider and image generation models stable while improving post-processing and cover layout

## 4. Main Diagnosis

The current bottleneck is not reliability anymore.

Reliability still matters, but the repo now has enough foundations that the highest-leverage work has shifted.

The current bottleneck is:

- traffic recovery
- CTR
- retention
- topic drift
- weak visual variation
- not enough data per topic family

The project should now prioritize measurable audience response over additional internal refactors.

### Topic drift diagnosis

Old higher-view content appears more educational, search-oriented, and curiosity-driven. Many older topics used angles like:

- "Nghệ thuật..."
- "Bí mật..."
- "Giải mã..."
- "Hành trình..."
- "Sức mạnh..."

Recent content appears more generic emotional self-help:

- fear
- loneliness
- insecurity
- being misunderstood
- regret
- self-healing

This newer direction may improve emotional resonance, but it may also reduce search/curiosity pull and make covers/hooks feel too similar. The roadmap must treat this as a hypothesis to test, not a conclusion.

The next phase should compare topic families and hook/cover structures against real retention and views, without automatically feeding signals back into generation yet.

## 5. Roadmap

### Phase 1 — Traffic Recovery

Goal: recover views and click interest before broad expansion.

Build:

- Short Cover Asset Generator:
  - Convert read-only cover text into actual cover assets/first-frame visuals.
  - Use existing images; render Vietnamese text by code, not AI.
  - Track cover text/version/layout.
- Hook Tracking / Hook Analytics:
  - Persist selected hook, hook candidate scores, hook structure, and hook opener pattern.
  - Join hook data to views, retention, and topic family.
  - Keep read-only analysis first.
- Topic Family Analytics:
  - Promote heuristic topic clusters into a stable topic-family layer.
  - Measure video count, avg views, avg retention, avg duration by family.
  - Identify under-sampled families before making generation changes.

Success signals:

- 30-50 new Shorts/Reels have tracked hook + cover metadata.
- At least 5 main topic families each have enough samples for human review.
- Analytics page can answer: "which topic family, hook style, and cover style is working?"

### Phase 2 — Visual Retention Engine

Goal: reduce visual sameness and improve first seconds / mid-video retention.

Build:

- Short cover as first frame:
  - Place cover frame at the start of Shorts/Reels.
  - Keep it visible long enough to register, approximately 1-1.5 seconds.
  - Avoid covering subtitles or important image content.
- Footage/B-roll Engine:
  - Add visual variation beyond one AI still image.
  - Start with simple, deterministic scene selection and safe asset reuse.
  - Compare against current AI-image-only shorts.
- Subtitle Style V2:
  - Chunking improved 2026-06-07: MAX_WORDS_PER_CHUNK 4→6, 8 protected Vietnamese phrase pairs, trailing-orphan merge, lighter outline/shadow.
  - Persist subtitle health where useful.
  - First-frame cover and retention comparison still pending.

Success signals:

- Retention improves versus AI-image-only baseline.
- First-frame cover does not hurt readability.
- Subtitle timing complaints decrease.

### Phase 3 — Content Intelligence

Goal: create a read-only intelligence layer before automatic optimization.

Build:

- Topic Family Generator:
  - Generate topic candidates by family, not only broad niche.
  - Ensure controlled sampling across families.
- Content Brain V1 read-only:
  - Summarize topic, hook, cover, prompt, and experiment performance.
  - Produce recommendations for the human operator.
  - Do not auto-change generation.
- Prompt/cover/hook performance comparison:
  - Compare experiment variants and prompt versions.
  - Show low confidence warnings.
  - Avoid declaring winners without enough sample size.

**Completed (2026-06-08):**
- [x] Content Intelligence V1 — Tang Sau baseline analytics (era/format/topic/hook/lineage).
- [x] Content Intelligence V2 — Buddhist first-class analytics (era/format/topic/hook/quality flags, CTA benchmarking, Visual Color note).
- [x] Content Intelligence V3 — Topic-first model: `phat_phap` owning YouTube (account 1) + Facebook (account 3) + TikTok (null). Platform filter selector. Time-window performance (24h/48h/7d/30d) with age badges. Cross-Platform lineage tab. Voice/Audio intelligence tab (WPM, pacing, script length, quality flags). Deep-link `?platform=` param. tsc+eslint clean. Read-only guaranteed.
- [x] YouTube Analytics Phase A — share_count, estimatedMinutesWatched, subscribersGained/Lost added to `video_metric_snapshots` schema and sync. Analytics API extended with graceful fallback on INVALID_ARGUMENT. Era Performance tab displays shares, share/view rate, avg minutes watched, subs gained/lost (YouTube-only, Facebook not affected). `engagedViews` column schema-reserved (not available per-video from current API scope). tsc+eslint clean. Read-only guaranteed.
- [x] YouTube Analytics Phase A Backfill — `scripts/backfill-yt-phase-a.ts` created. Backfills Phase A metrics for existing phat_phap published videos. Inserts new snapshot rows only, never modifies existing rows. Supports `--dry-run/--execute/--limit/--days/--all-days/--channel`. `node --env-file=.env.local` used for reliable ESM env loading. First run: 100 videos processed, 100 snapshots inserted (72 with full Phase A analytics, 28 Data API only). Phase A coverage: share_count 84→178, estimated_minutes_watched 57→134, subscribers_gained/lost 84→178. Remaining 70 videos in 90-day scope + all historical can be backfilled via `--all-days --limit 200`. Fixed Content Intelligence "use server" runtime error (removed `export` from `TOPIC_DESTINATION_PROFILES` const). tsc+eslint clean. Read-only guaranteed — no uploads, no queue mutations, no media deletion.
- [x] Tầng Sâu Visual Lightening — `TANG_SAU_SCENE_POOL` updated to brighter, less gloomy distribution: 39% bright interior, 25% bright city/transit, 19% airy nature, 11% warm evening (new category), 6% dark moody. Added `warm_evening` and `dark_moody` to `TangSauSceneCategory`. `buildQuoteShortImagePrompt` uses warm amber Kinfolk anchor for `warm_evening` scenes. Over 20 Tang Sau topics: 80% bright, 10% warm, 10% dark. Person scenes 14% (5/36). Zero Buddhist/spiritual scene descriptors. tsc+eslint clean.
- [x] Publishing Queue & Calendar pages fixed — `/publishing/queue` and `/publishing/calendar` now show all active rows. Root cause: `getUploadQueueAction` ordered by `scheduledAt ASC` with limit 300, causing old `done`/`cancelled` rows (past timestamps) to fill the window before the 67 queued rows (future timestamps). Fixed by changing ORDER BY to DESC so upcoming rows surface first. Added Suspense wrapper to calendar page for `useSearchParams()`. Improved empty-state diagnostics with total count, active count, current filter display, and reset button. tsc+eslint clean. Read-only guaranteed.
- [x] Pre-Publish Quality Audit — `scripts/pre-publish-quality-audit.ts` created (2026-06-08). Read-only scan of all queued/uploading items for TTS risks (Type A separator, Type B nh-pair, markdown bullets, short opening clause, ng-pair), visual/workspace mismatch, publishing readiness (duplicates, already-published, stale schedules, OAuth, media existence). 66 items scanned: 2 HIGH (already-published rows must be manually cancelled), 31 MEDIUM (24 duplicate queue rows, 7 TTS separator warnings), 13 LOW, 20 clean. Tầng Sâu: all 17 items clean. Output: `docs/PRE_PUBLISH_QUALITY_AUDIT.md` + `output/manifests/pre-publish-quality-audit.json`. tsc+eslint clean. No DB/queue/media mutations.
- [x] Posting window expanded to 06:00–22:00 VN (2026-06-08). Changed from 08:00–21:00 for all phat_phap destinations (YouTube/Giới Định Tuệ ch=1, Facebook/Trí Tuệ An Nhiên ch=6). 6 destinations updated: short(legacy), long(legacy), shortDest[0], shortDest[1], longDest[0], quoteDest[0]. DB: `app_config.auto_schedule_settings` updated directly (no rebalance triggered). Code defaults also fixed: `DEFAULT_QUOTE_DESTINATION` + `getFallbackDestinationSetting` quote case + `quoteFallback` in normalizeAutoScheduleSettings changed from 08:00/23:00 to 06:00/22:00. Tầng Sâu workspace (07:00–22:00) left unchanged. `buddhist_healing_workspace` registry was already 06:00–22:00. Dry-run confirmed: mixer produces slots at 06:00 VN for YouTube ch=3 and Facebook ch=6. Existing queued rows not moved (all 08:00–21:00, valid subset of new window). tsc+eslint clean. No upload/queue-row mutations.
- [x] Duplicate Facebook Queue Row Fix + Audit Script Bug Fix + HIGH blocker cancellation (2026-06-08). (1) Root cause: all automated dedupe checks only checked `status IN ('queued','uploading','done')`, missing 'cancelled'. When admin disabled FB on 2026-05-30 (rows → cancelled) then re-enabled, auto-refill-watcher/schedule-mixer/bulkScheduleAction re-scheduled the same content. Fix: added 'cancelled' to all four dedupe queries in auto-refill-watcher (×2), schedule-mixer, bulkScheduleAction. ADR-022 added. (2) Pre-publish audit script bug: `DUPLICATE_QUEUE_ROW` dedup key was `content_id:platform:channel_key` without `video_type` — caused 24 false-positive warnings for legitimate `short+quote` co-scheduled pairs. Fix: added `video_type` to dedup key. (3) Cancelled 2 HIGH blocker rows (ALREADY_PUBLISHED): `723d5781` (Nỗi sợ bị ruồng bỏ, fb, scheduled 09:00 UTC 9/6) and `61c9a65b` (Tìm kiếm sự thấu hiểu, fb, scheduled 10:00 UTC 9/6). Both set to status=cancelled, error_message=pre_publish_quality_audit_high_blocker. Pending queue: 65→63. Re-audit: 63 items — 0 HIGH, 9 MEDIUM, 33 LOW, 21 clean. tsc+eslint clean.
- [x] Publishing Queue Reliability Fix (2026-06-18). Root causes from audit: (1) cooldown deferral re-slotted overdue queued rows with `taken=[]`, collapsing many phat_phap rows into the same next legal slot (`2026-06-19 06:00 VN` pileup), (2) `tang_sau` had no live scheduler jobs, (3) `/publishing/config` legacy storage and runtime config had drifted, and (4) backpressure-skipped jobs were retried every minute. Fixes: canonical slot occupancy helper added at `src/lib/publishing/slot-occupancy.ts`; cooldown deferral now reads active taken slots before reassigning and preserves existing minute offsets, so fresh phat_phap FB quote rows stay on `HH:05`; `/publishing/config` now syncs `auto_schedule_settings` into runtime `channel_publish_configs_v1`; `getChannelPublishConfig()` can also derive per-channel fallback from legacy settings for `tang_sau`; backpressure now advances `nextRunAt` by 10 minutes instead of hammering the same due job each minute. Safety scripts added: `scripts/verify-upload-queue-cooldown-deferral.ts`, `scripts/repair-upload-queue-pileup.ts` (dry-run first), and `scripts/ensure-tang-sau-scheduler-jobs.ts` (dry-run first). Queue slot allocation is now protected logic: future edits must re-run cooldown deferral verification plus slot audit before rollout.
- [x] Quote Pipeline V1 (2026-06-18). `phat_phap` Facebook quote/photo remains on the existing HH:05 sidecar lane, but quote creation is now explicit and observable instead of hidden inside `buildFacebookQuoteText()` extraction only. New FB quote sidecars attempt independent LLM quote generation first, then fall back to validated extraction from `shortContent`, then to safe fallback quote text. The final quote artifact is stored in `content_generations.prompt_versions.quote` with `quoteSourceType`, `quoteStyle`, `kinetic=false`, validation status/reasons, source content linkage, generated timestamp, and generator version. Cost logging now records `quote_text` usage separately. New operator scripts: `scripts/audit-quote-pipeline.ts`, `scripts/preview-quote-pipeline.ts`, and `scripts/verify-quote-pipeline-v1.ts`. `tang_sau` YouTube `legacy_quote_short` visibility is now explicit in audit output; `tang_sau` Facebook quote/photo is still intentionally blocked until a real Facebook channel/config exists. No scheduler/cooldown/slot-occupancy logic changed. No live publishing triggered during implementation.
- [x] TTS Short Audio Pacing Audit + Emergency Option D Rollout (2026-06-12). (1) Pacing audit: root cause = DOUBLE-PAUSE STACKING. Pass 1 silenceremove change preserves natural TTS pauses (~150ms comma, ~400ms sentence); deterministic injection stacks on top → effective comma ~370ms (guideline max 180ms), sentence ~960ms (guideline max 450ms). 8/13 analyzed files had suspicious clusters (≥3 pauses/3s). Scripts: `scripts/audit-tts-pacing.ts`. (2) Option D approved: disable injection. Gate added to `src/lib/pipeline/tts.ts` behind `TTS_ENABLE_PUNCTUATION_PAUSES` env flag (default=false). ADR-023 added. (3) Emergency re-render: `scripts/emergency-rerender-tts-option-d.ts` ran; 12/26 items processed (14 had no queued entries). All 12 PASS — subtitle QA 100, silence clusters 0–2, ratio 0–5%. b9977f99 (Tìm kiếm sự chấp nhận) missed — uploaded by cron at 13:00 VN before script could re-render. Queue delta: 0. No published rows touched. No tang_sau. tsc+eslint clean. Next: Option E (net-addition logic) for proper fix.
- [x] VieNeu Native Prosody Test + Loudnorm-Only Rollout (ADR-024, 2026-06-12). (1) Prosody test: `scripts/test-vieneu-native-prosody.ts` ran 4 variants × 3 content IDs. Finding: silenceremove (stop_duration=0.80) strips 70–100% of VieNeu natural pauses; item 8d12d8ba→zero pauses after silenceremove. Loudnorm alone preserves them (Δ ≤0.5 avg). Verdict: Cause 3 — both VieNeu prosody is weak at sentence level AND silenceremove amplifies damage. (2) ADR-024 approved: switched phat_phap TTS to loudnorm-only. `normalizeAudioWithLoudnorm()` now accepts `{ useSilenceremove }` param routed by `channelKey`. Silenceremove code kept for other channels. New QA log fields: `channel_key`, `silenceremove`, `pauses_150ms`, `pauses_300ms`, `duration`. (3) Re-render: `scripts/rerender-tts-loudnorm-only.ts` ran 26 items — 11 processed (PASS), 15 skipped (no queued entries, already published). All 11 processed: avg 4–10 pauses >150ms, 0–3 pauses >300ms, subtitle QA 100, duration 33–43s. Scheduled slots covered through 2026-06-13 20:00 VN. Queue delta: 0. QA previews: 8d12d8ba, cbf59089 in `media/qa/loudnorm-only-rerender/`. tsc clean. Next: Option E net-addition injection (only after loudnorm baseline settled).
- [x] TTS Artifact Type B — "nhX, nhY" phonological pair elongation fixed (2026-06-08). Confirmed on `GxR_7Ib73Nw` (topic: Nỗi sợ bị ruồng bỏ, voice ngoc): Whisper analysis pinpointed word "như" elongated to 1.68s (10× normal) at 00:11. Root cause: VieNeu-TTS ngoc voice produces loop/stuck prosody on two consecutive "nh-" words across a comma ("nhà, như"). Fix: `normalizeTextForTTS` in `src/lib/pipeline/tts.ts` now converts `(nhX), (nhY)` → `(nhX). (nhY)` via `/(nh\p{L}*),\s*(nh)/gu`. Repair preview confirmed: repaired isolated phrase generates clean audio (no elongated words). Queue scan clean: 32 queued + 13 recent TTS items scanned, 0 at risk. Audit scripts: `scripts/audit-tts-artifact.ts`, `scripts/repair-tts-preview.ts`, `scripts/scan-tts-risk.ts`. Test: `scripts/test-tts-normalizer.ts` — 17/17 pass. No DB/queue mutations. Media impact: new cache hash for content with nh-comma-nh pattern; old published video cannot be auto-repaired.

Success signals:

- Human can decide next topics/covers from a clear dashboard.
- The system explains "why" a recommendation exists.
- No automatic feedback loop is active yet.

### Phase 4 — Multi-channel Monetization

Goal: expand after short-form quality and learning are stable.

Build:

- Reusable niche templates:
  - Make topic families, hook styles, cover styles, prompts, and publish settings reusable per niche.
- Affiliate-ready content system:
  - Support books, philosophy, products, and education-oriented content.
  - Keep attribution, links, and platform rules clean.
- Multi-platform analytics expansion:
  - Expand Facebook analytics if token/scopes are stable.
  - Prepare TikTok/Instagram Reels analytics mapping.
  - Normalize metrics only where the platform actually supports them.
- Future channels:
  - books
  - philosophy
  - affiliate products
  - education

Success signals:

- New niche can be launched without rewriting the pipeline.
- Multi-platform performance can be compared by channel and content type.
- Monetization experiments do not degrade core retention/quality.

## 6. Data Sufficiency Rules

Do not feed analytics back into generation automatically until there is enough data.

### Minimum for human analysis

- 100 published videos
- 70 videos with retention
- 5 videos per main topic family
- 30 videos with coverText + hook tracking

Human analysis may still use smaller samples as weak signals, but every UI/report must mark them as low confidence.

### Minimum for automated AI feedback

- 300 published videos
- 200 videos with retention
- 20 videos per main topic family
- at least 2-3 experiment variants with meaningful sample size

Automated feedback must be read-only first, then gated by explicit user approval.

### Interpretation rules

- Views alone are not enough.
- Retention alone is not enough.
- Topic, hook, cover, visual pacing, and publish timing are confounded unless tracked together.
- Low view count with high retention may mean the topic/cover failed to attract clicks but content held viewers.
- High view count with low retention may mean the cover/hook attracted clicks but the video failed to satisfy.

## 6b. Audio Story Pipeline

**Added: 2026-06-16**

Audio Story is a separate serialized fiction product line inside this application. It is **not** the same as Buddhist/tang_sau longform. phat_phap/tang_sau long videos are topic-driven spiritual content; Audio Story is story-driven serialized fiction (rebirth, system, CEO, revenge, etc.) with chapter/episode continuity.

**Detailed plan: `docs/AUDIO_STORY_PIPELINE_PLAN.md`** — update that file for all Audio Story roadmap work. Do not bury Audio Story decisions in this file.

### Hard boundary

- phat_phap, tang_sau, and healing flows remain fully separate in prompt templates, analytics, and data model.
- `content_generations` is not the primary store for Audio Story data.
- Audio Story uses isolated tables: `story_taxonomy`, `stories`, `story_characters`, `story_chapters`, `story_memories`, `story_quality_checks`.

### Shared infrastructure (allowed)

DB server, OpenRouter LLM client, storage directories, UI shell, TTS as a pluggable resource, and the short/reel publishing pipeline for teasers only.

### Current state

Story Studio MVP done and smoke-tested (2026-06-15). Covers taxonomy, trope builder, premise, bible, outline, chapter draft, continuity check, approve, lock. Routes at `/story-studio/`.

### Next task

Phase B — Multi-Chapter Continuity + Reader Preview UI. See `docs/AUDIO_STORY_PIPELINE_PLAN.md § 9` for acceptance criteria.

## 7. What Not To Build Yet

Explicitly postpone:

- automatic Content Brain optimization
- automatic feedback loop into prompts
- full queue rewrite
- more reliability refactors unless bugs appear
- CTR/impression chasing through unsupported YouTube Analytics metrics
- broad multi-platform expansion before short retention improves

Also avoid:

- creating more roadmap files
- replacing existing platform architecture without clear ROI
- adding many prompt variants before tracking is mature
- changing generation behavior based on thin samples
- expanding Facebook/TikTok/Instagram complexity before core Shorts/Reels retention improves

## 8. Operational Rules

Only build tasks that satisfy at least one of these:

1. increase view/CTR/retention
2. improve learning from data
3. fix a publish-blocking bug

Otherwise postpone.

Additional rules:

- Prefer read-only analytics before automated optimization.
- Prefer small measurable experiments over broad rewrites.
- Keep queue and publishing stable while experimenting with content quality.
- Do not require CTR/impressions until a supported API path exists.
- Preserve existing decisions unless there is evidence that the decision is no longer valid.
- Every proposed task should state which business metric it improves.

## 9. Project Execution Checklist

Legend:

- `[x]` Status: done
- `[ ]` Status: partial
- `[ ]` Status: planned
- `[ ]` Status: blocked

### P0 — Publishing Safety / Operational Guardrails

- [x] Upload queue schedule guard  
  Status: done  
  Priority: P0  
  Depends on: `upload_queue.scheduled_at` UTC storage, cron due-item selection, execution guard  
  Success criteria: future-scheduled rows are skipped with `not_due_yet`; overdue rows may catch up; manual/debug runs do not publish accidentally.

- [x] Cron-only publishing  
  Status: done  
  Priority: P0  
  Depends on: `processUploadQueueAction({ source: "cron", allowUpload: true })` guard  
  Success criteria: cron remains the only real upload path; scheduler/debug/manual flows create queue rows only.

- [x] Workspace/channel routing guard  
  Status: done  
  Priority: P0  
  Depends on: workspace registry, destination ownership validation, workspace-aware mixer filters  
  Success criteria: content is scheduled only to matching workspace/channel destinations; mixed-workspace leakage is blocked.

- [x] Wrong-channel guard  
  Status: done  
  Priority: P0  
  Depends on: `channelKey` ownership checks, destination channel metadata, queue retry safety  
  Success criteria: uploads fail closed when destination channel does not match content channel; wrong-channel retries require metadata repair, not guard removal.

- [x] Upload slot collision guard — done rows block slots (2026-06-15)
  Status: done — 2026-06-15
  Priority: P0
  Root cause: Slot dedupe in scheduling paths checked only `queued`/`uploading` rows, not `done` rows. A published slot could be re-used by the scheduler on the next run, causing overposting on Facebook Trí Tuệ An Nhiên (June 15 incident).
  Resolution: All key slot-occupancy checks now include `done` rows. Facebook quote/photo row insertion has a slot-level collision guard before insert. `cancelled` rows intentionally remain non-blocking (see ADR-027). Audit script `scripts/audit-upload-slots.ts` (`npm run audit:upload-slots`) added for operator verification after any queue event.

- [ ] Queue threshold / backpressure  
  Status: partial  
  Priority: P0  
  Depends on: shared threshold config, production capacity helper, mixer warnings, queue cleanup discipline  
  Success criteria: all queue guard users read the same threshold; queue remains below safe max; Facebook backlog cannot silently starve YouTube cadence.

- [x] Giới Định Tuệ YouTube publishing restoration (2026-06-07)  
  Status: done — 2026-06-07  
  Priority: P0  
  Root cause: Two layered issues — (1) `getDestinationCandidates` excluded content only by the current `channelId`, missing content already uploaded via sibling credential IDs for the same physical YouTube channel; this was fixed by broadening `usedContentIds` to include all credentials sharing the same `platformChannelId`. (2) The default `MAX_UNPUBLISHED_RENDERED_VIDEOS=30` threshold was exceeded by tang_sau's 44 queued videos + 15 Buddhist renders, blocking `short_pipeline` from rendering the 13 pending Buddhist TTS items. Fixed by setting `MAX_UNPUBLISHED_RENDERED_VIDEOS=80` in `.env.local`.  
  Resolution: 4 Buddhist TTS shorts scheduled for today (18:00–21:00 VN). Remaining 9 items rendering via subsequent cron ticks. Cross-credential dedup fix prevents recurrence.

- [x] Tầng Sâu visual reset guard (auto-refill permanent exclusion)  
  Status: done — 2026-06-07  
  Priority: P0  
  Depends on: `upload_queue.error_message = tang_sau_visual_topic_reset`, `getDestinationCandidates` usedContentIds extension  
  Success criteria: content_ids cancelled with `tang_sau_visual_topic_reset` can never be re-queued by auto-refill; no restart or code deploy required to block new bad ids.

- [x] Buddhist Visual Direction V1 (2026-06-09)
  Status: done — 2026-06-09
  Priority: P1
  Depends on: `contentProfileKey = buddhism`, `channelKey = phat_phap`, `buildQuoteShortImagePrompt`, `buildImagePromptPair`, `LegacyQuoteShortMetadata`
  Success criteria: All Buddhist image generation uses BUDDHIST_VISUAL_V1 — 12 categories, deterministic topic→category mapping, practical daily-life exception, visual metadata in sidecar/promptVersions, Tầng Sâu isolation preserved. tsc+eslint clean. No upload/queue/media mutation.

- [x] Visual color palette policy + format routing rebalance (2026-06-07)  
  Status: done  
  Priority: P1  
  Depends on: `TANG_SAU_FORMAT_POLICY`, `buildQuoteShortImagePrompt`, `LegacyQuoteShortMetadata`, `quote-shorts-manager.tsx`  
  Success criteria: Tầng Sâu format mix now routes 35/30/20/15 (kinetic/reflection/note/bilingual) instead of 40/30/20/10; Buddhist prompts use 4 seeded style anchors with explicit warm palette; `colorPalette`/`visualTemperature` written to every sidecar and surfaced in review UI; visual mismatch warning badge shown for any Tầng Sâu item with Buddhist keywords.

- [ ] Visible UI for queue/calendar/workspace schedule  
  Status: partial  
  Priority: P0  
  Depends on: Publishing Queue, Calendar, Workspace dashboard, workspace filters  
  Success criteria: operator can see next scheduled item, workspace schedule, queue status, and channel destination clearly in the app without CLI inspection.

### P1 — Traffic Recovery

- [x] Short Cover Asset Generator  
  Status: done (2026-06-15)  
  Priority: P1  
  Depends on: Short Cover Engine output, cover asset rendering, metadata persistence, first-frame experimentation  
  Success criteria: `coverText` is persisted and rendered into reusable short/reel cover assets with safe readability.  
  Notes: Sharp-based compositor outputs 1080x1920 JPEG to `media/covers/{id}-short-cover.jpg`. DB columns
  `short_cover_asset_path`, `short_cover_text`, `short_cover_generated_at` added (migration 0037). Generation
  runs unconditionally before render (non-fatal); reuses cached asset when file exists on disk. Cleanup guards
  cover asset until YT+FB publishing completes. Dry-run test: 8/8 synthetic PASS, full asset generation PASS
  (1080x1920, readability 9.2/10, safeArea=true). Run: `npx tsx --tsconfig tsconfig.json scripts/test-short-cover-asset.ts`

- [x] Hook Tracking / Hook Analytics  
  Status: done (2026-06-16)  
  Priority: P1  
  Depends on: hook candidate persistence, selected hook tracking, analytics joins  
  Success criteria: hook candidates, selected hook, opener pattern, and outcomes are comparable by views, retention, and duration.  
  Notes: `hook_type` (13 English types), `hook_variant`, `hook_generated_at` added (migration 0038). `inferHookType()`
  classifier in hook-engine.ts. Generation logs `[HOOK_TRACKING]`. `getHookTypePerformanceAction()` aggregates by
  type. Hook Type table in `/publishing/analytics`. 335 existing rows backfilled. Dry-run default;
  `--execute` to apply.

- [x] Content Intelligence V1 read-only dashboard (2026-06-07)  
  Status: done — 2026-06-07  
  Priority: P1  
  Depends on: `content_generations`, `published_videos`, `video_metric_snapshots`  
  Success criteria: dashboard at `/publishing/analytics/content-intelligence` shows Format Performance, Topic Family, Hook Pattern, Visual Style, and Learning Lineage for Tầng Sâu — all read-only, no auto-apply. Data sufficiency badges guard against premature conclusions. Retention/duration fields present but show "Cần YouTube Analytics API" until connected.

- [x] Content Intelligence V2 — Buddhist/Giới Định Tuệ first-class analytics (2026-06-08)  
  Status: done — 2026-06-08  
  Priority: P1  
  Depends on: Content Intelligence V1, platform_accounts (id 1 YouTube, id 3 Facebook), era taxonomy  
  Success criteria: channel selector (Giới Định Tuệ / Tầng Sâu) at top of dashboard; phat_phap profile shows Era Performance (5 eras × YouTube), Buddhist Topic Families (9 families), Buddhist Hook Patterns (8 patterns), Format tab (7 format groups), Quality Flags (CTA contamination critical flag + 4 others), Lineage; CTA-aware benchmarking warns HOOK_V1 like% is inflate; HOOK_V2 insufficient data flagged; visual color analysis shows "no metadata" note; Tầng Sâu tabs unchanged; tsc clean, eslint clean, read-only confirmed.

- [ ] Topic Family Analytics  
  Status: partial — basic inference in Content Intelligence V1; needs stable DB-level topicFamily tagging  
  Priority: P1  
  Depends on: stable `topicFamily` tagging, analytics joins, enough published samples  
  Success criteria: topic family performance is visible and comparable across videos, not only heuristic clusters.

- [ ] Publish enough content to collect retention  
  Status: blocked  
  Priority: P1  
  Depends on: queue health, render capacity, retention sync coverage, enough publish volume  
  Success criteria: enough new Shorts/Reels are published to make retention analysis meaningful under the data sufficiency rules.

- [ ] Quote Short experiment for Tầng Sâu / Buddhist workspace  
  Status: partial  
  Priority: P1  
  Depends on: workspace-tagged Quote Shorts, protected YouTube cadence, comparison reporting  
  Success criteria: both workspaces have enough Quote Short samples to compare style/topic response without mixing channels or profiles.

### P2 — Multi-niche / Workspace Foundation

- [ ] `channelKey = publishing destination`  
  Status: partial  
  Priority: P2  
  Depends on: queue ownership guard, channel config registry, social channel metadata hygiene  
  Success criteria: publishing destination is routed by `channelKey` only, and wrong-channel uploads are blocked safely.

- [ ] `contentProfileKey = niche/style/prompt/topic/voice profile`  
  Status: partial  
  Priority: P2  
  Depends on: niche records, content generation metadata, prompt/profile registry  
  Success criteria: content profile is explicitly stored and used for prompt/topic/voice routing without overloading `channelKey`.

- [x] `formatType = output/render/publishing format`  
  Status: done  
  Priority: P2  
  Depends on: canonical format inference, gallery/publishing filters  
  Success criteria: TTS Short, Quote Short, Long, and Facebook quote/photo are separated by format identity, not only content mode.

- [ ] Prompt Studio foundation  
  Status: partial  
  Priority: P2  
  Depends on: prompt/profile registry, read-only UI, option groups, suggestion helper  
  Success criteria: channel profiles, topic families, prompt templates, and option groups are visible and usable in opt-in flows without changing global generation behavior.

- [ ] Channel Workspace foundation  
  Status: partial  
  Priority: P2  
  Depends on: workspace registry, workspace dashboard, publishing filters, scheduler awareness  
  Success criteria: each workspace shows its channel, formats, schedule plan, ready content, and queued schedule clearly in the app.

- [ ] Tầng Sâu profile / routing  
  Status: partial  
  Priority: P2  
  Depends on: `tang_sau_workspace`, `tang_sau_v1`, active philosophy niche, YouTube destination metadata  
  Success criteria: Tầng Sâu content stays philosophy-first, quote-only for now, and does not inherit Buddhist-heavy defaults unless intentionally selected.

- [ ] Quote Short workspace tagging  
  Status: partial  
  Priority: P2  
  Depends on: sidecar metadata, workspace-aware loaders, mixer pool guards  
  Success criteria: Quote Shorts carry `workspaceId` and `channelProfileId`; untagged Buddhist pool is not inferred into Tầng Sâu scheduling.

- [ ] TTS profile routing for non-Buddhist channels, not yet global  
  Status: planned  
  Priority: P2  
  Depends on: content profile router, voice/profile metadata, prompt routing by `contentProfileKey`  
  Success criteria: non-Buddhist channels can use distinct TTS/prompt routing without changing Buddhist defaults globally.

### P3 — Retention Intelligence

- [~] Audience Intent metadata  
  Status: partial — `audienceProfileId` is now written to Quote Short sidecars via `tags.audienceIntent`; `PERFORMANCE_DIMENSIONS` defines the analytics segmentation schema in `src/lib/prompt-studio-registry.ts`; `AudienceProfileConfig` registry holds `buddhist_healing_v1` and `tang_sau_v1` profiles  
  Priority: P3  
  Depends on: content metadata model, analytics joins, enough sample volume  
  Success criteria: videos can be segmented by `comfort`, `awakening`, `bedtime`, `curiosity`, `wisdom_story`, `life_lesson`, `shareable_quote`, `self_understanding`, `emotional_clarity`.

- [ ] Script Format metadata  
  Status: planned  
  Priority: P3  
  Depends on: metadata persistence, script classification, analysis UI  
  Success criteria: videos can be compared by formats such as `teaching`, `story`, `parable`, `confession`, `mistake_lesson`, `question_answer`, `listicle`, `bedtime_reflection`, `hard_truth`, `inner_monologue`, `reflective_question`, `story_minimal`.

- [ ] Content Mood metadata  
  Status: planned  
  Priority: P3  
  Depends on: metadata persistence, prompt/profile tagging, analytics joins  
  Success criteria: videos can be segmented by `calm`, `warm`, `emotional`, `serious`, `mysterious`, `urgent`, `reflective`, `bedtime`, `uplifting`.

- [ ] Retention Device metadata  
  Status: planned  
  Priority: P3  
  Depends on: opening structure tagging, script analysis, retention comparison  
  Success criteria: retention can be compared by `open_loop`, `countdown`, `story_resolution`, `contrast_before_after`, `question_then_answer`, `emotional_build`, `quote_payoff`.

- [ ] Opening Scene Type metadata  
  Status: planned  
  Priority: P3  
  Depends on: visual metadata model, first-frame tagging, retention analysis  
  Success criteria: opening scenes such as `black_text_card`, `cinematic_face`, `temple_wide_shot`, `rainy_window`, `old_monk_story`, `lonely_person`, `book_page`, `nature_silence`, `dark_calm_background` are comparable by outcome.

- [ ] Voice Selection Engine V1  
  Status: planned  
  Priority: P3  
  Depends on: `contentProfileKey`, `topicFamily`, `scriptFormat`, `audienceIntent`, `contentMood`, `formatType`, data sufficiency  
  Success criteria: voice is selected by metadata and controlled experimentation, not random shuffle or one-voice hardcoding.

- [ ] Voice experiment tracking  
  Status: planned  
  Priority: P3  
  Depends on: TTS metadata persistence, experiment IDs, controlled selection modes  
  Success criteria: `ttsVoiceId`, `ttsVoiceGender`, `ttsVoiceRegion`, `ttsVoiceProfile`, `ttsVoiceSelectionMode`, `ttsVoiceSelectionReason`, `ttsVoiceCandidateIds`, `ttsExperimentId`, `ttsEmotion`, and `ttsSpeed` are trackable.

- [ ] Prompt / hook / cover / voice performance comparison  
  Status: planned  
  Priority: P3  
  Depends on: metadata persistence across prompt, hook, cover, voice, enough sample size  
  Success criteria: performance comparison is available in read-only form with confidence warnings and no auto-apply behavior.

### P4 — Longform / Content Cluster

- [ ] Longform Seed V1  
  Status: planned  
  Priority: P4  
  Depends on: stable short pipeline, longform metadata, reusable asset plan  
  Success criteria: lightweight 6–10 minute long videos can be produced without jumping to heavy 20–30 minute production.

- [ ] Chapter-to-Short candidates  
  Status: planned  
  Priority: P4  
  Depends on: longform chapters, chapter hooks, reusable clip metadata  
  Success criteria: long videos can emit structured short candidates from chapters.

- [ ] Quote mining  
  Status: planned  
  Priority: P4  
  Depends on: long script segmentation, quote candidate extraction  
  Success criteria: long scripts can produce reusable quote candidates for short or social assets.

- [ ] Content Cluster Engine  
  Status: planned  
  Priority: P4  
  Depends on: Longform Seed V1, derived short/quote metadata, reusable asset graph  
  Success criteria: one long video can spawn multiple short candidates, quote/photo candidates, and reusable captions/comments.

- [ ] Long-to-short reuse flow  
  Status: planned  
  Priority: P4  
  Depends on: source-long relationships, derivative metadata, scheduling support  
  Success criteria: derived Shorts and quotes retain a clear relationship to the source long video.

### P5 — Monetization / Reuse

- [ ] Reusable niche templates  
  Status: planned  
  Priority: P5  
  Depends on: workspace foundation, prompt studio, topic family routing, stable metrics  
  Success criteria: a new niche can launch from reusable profiles, prompts, topic families, and publish settings without rewriting the pipeline.

- [ ] Affiliate-ready content system  
  Status: planned  
  Priority: P5  
  Depends on: reusable templates, platform-safe attribution rules, stable retention baseline  
  Success criteria: books, philosophy, education, and product content can be produced with clean attribution and without hurting core content quality.

- [ ] Multi-channel expansion  
  Status: blocked  
  Priority: P5  
  Depends on: enough retention data, stable queue health, reusable niche templates  
  Success criteria: expansion does not outrun content quality, retention insight, or channel-specific prompt routing.

- [ ] Product / topic cluster reuse  
  Status: planned  
  Priority: P5  
  Depends on: Content Cluster Engine, reusable asset graph, enough analytics evidence  
  Success criteria: proven topic/product clusters can be reused across channels without breaking profile or audience fit.

## 10. Docs Consolidation Plan

Do not move or delete existing docs yet. The recommended durable docs structure is:

- `docs/PROJECT_MASTER_PLAN.md`
- `docs/OPERATIONS.md`
- `docs/ANALYTICS_GUIDE.md`
- `docs/DECISIONS.md`
- `docs/ARCHIVE/`

### Keep as source of truth

- `docs/PROJECT_MASTER_PLAN.md`
  - This file.
  - Roadmap, priorities, constraints, and future-agent instructions.
- `docs/DECISIONS.md`
  - Keep as the architectural decision record.
  - Refresh it when major decisions change.

### Merge into `docs/OPERATIONS.md`

- `docs/RELIABILITY_IMPROVEMENTS.md`
- `docs/PHASE1_PERFORMANCE_REPORT.md`
- `docs/CLEANUP_ELIGIBILITY_AUDIT.md`
- `docs/MISSING_PENDING_IMAGES_REPORT.md`
- `docs/SUBTITLE_HEALTH_REPORT.md`
- operational sections from `docs/COST_AUDIT.md`
- Shorts thumbnail note from `docs/youtube-video-analytics-notes.md`
- token/publishing/cleanup runbook content from future incidents

### Merge into `docs/ANALYTICS_GUIDE.md`

- `docs/ANALYTICS_STATE.md`
- `docs/YOUTUBE_ANALYTICS_API_PLAN.md`
- `docs/PHASE6_DATA_LOOP_REPORT.md`
- analytics sections from `docs/ROADMAP_CONTEXT_PACKAGE.md`
- topic performance/summary/coverage interpretation rules
- unsupported CTR/impressions explanation

### Archive after merging

- `docs/ARCHITECTURE_AUDIT.md`
- `docs/CONTENT_QUALITY_AUDIT.md`
- `docs/PERFORMANCE_AUDIT.md`
- `docs/RELIABILITY_AUDIT.md`
- `docs/ROADMAP_V2.md`
- `docs/PROJECT_REVIEW_FOR_ASSISTANT.md`
- `docs/ROADMAP_CONTEXT_PACKAGE.md`
- phase reports:
  - `docs/PHASE1_PERFORMANCE_REPORT.md`
  - `docs/PHASE2_THUMBNAIL_ENGINE_REPORT.md`
  - `docs/PHASE3_HOOK_ENGINE_REPORT.md`
  - `docs/PHASE4_SCRIPT_ENGINE_REPORT.md`
  - `docs/PHASE5_LONGFORM_ENGINE_REPORT.md`
  - `docs/PHASE6_DATA_LOOP_REPORT.md`

### Keep as technical references until replaced

- `docs/PROMPT_MAP.md`
- `docs/HOOK_ENGINE.md`
- `docs/THUMBNAIL_ENGINE.md`
- `docs/PROJECT_MEMORY.md`

These should eventually be either merged into `OPERATIONS.md`/`ANALYTICS_GUIDE.md` or summarized into this master plan.

## 11. Next 4 Sprints

### Sprint 1

Focus: recover click/traffic signals.

- Short Cover Asset Generator
- Hook Tracking
- Topic Family Analytics

Output:

- coverText/layout metadata persisted
- hook metadata persisted
- topic-family dashboard/report
- no automatic generation changes

### Sprint 2

Focus: test the first-frame hypothesis.

- Attach short cover to first 1-1.5 seconds of short/reel
- Generate/publish 30-50 new shorts
- Collect retention

Output:

- new shorts have cover + hook tracking
- retention coverage increases
- compare against older baseline

### Sprint 3

Focus: visual retention.

- Footage/B-roll Engine V1
- Compare retention against AI-image-only shorts

Output:

- measurable visual-variation experiment
- no broad visual system rewrite
- clear retention comparison report

### Sprint 4

Focus: read-only intelligence.

- Content Brain V1 read-only
- No auto-generation changes yet

Output:

- human-readable recommendations
- confidence labels
- topic/hook/cover/prompt comparison
- explicit "do not auto-apply" guard

## 12. MoneyPrinterV2 / MoneyPrinterTurbo Lessons

Borrow these ideas:

- modular assembly-line thinking
- job/queue mindset
- scheduler-based automation
- batch-oriented production
- asset cache
- script/tts/image/video separation
- affiliate expansion mindset

Do not copy blindly:

- generic auto-topic spam
- code architecture if it conflicts with the current repo
- automation before content quality
- generating too many variants before enough data exists
- treating "more output" as a substitute for retention
- replacing existing working modules without ROI

Practical takeaway:

Use MoneyPrinter-style systems as inspiration for production flow, not as a product-quality standard. This repo already has a richer content/analytics direction; the next step is better learning and stronger Shorts/Reels packaging, not blind high-volume automation.

## 13. Final Instruction For Future AI Agents

This file is the source of truth.

Do not create new roadmap files unless explicitly requested.

Update this file instead.

Do not restart analysis from zero.

Respect existing decisions.

Prioritize traffic recovery and learning from real data.

Before proposing or implementing work, check:

1. Does it increase view/CTR/retention?
2. Does it improve learning from data?
3. Does it fix a publish-blocking bug?

If the answer is no, postpone it.

When the project needs a new plan, update:

- this file for strategy and roadmap
- `docs/DECISIONS.md` for architectural decisions
- future `docs/OPERATIONS.md` for runbooks
- future `docs/ANALYTICS_GUIDE.md` for metrics and interpretation

Do not bury roadmap changes in one-off audit docs.
