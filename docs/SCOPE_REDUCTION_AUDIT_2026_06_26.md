# Scope Reduction Audit — 2026-06-26

Source of truth referenced: `docs/PROJECT_MASTER_PLAN.md`, `docs/DECISIONS.md`.

## Status (updated 2026-06-27)

- **Phase 1 (audit):** done — this document.
- **Phase 2 (delete fully isolated directories/files):** done. See §12.
- **Phase 3 (surgical shared-file edits):** done. See §13.
- **DB tables/columns:** untouched. No `DROP TABLE`, no `ALTER TABLE`, no data migration run in any phase. REMOVE-classified tables (§8) and `tang_sau` `channel_key` rows remain in the database, now orphaned/inert at the code level.
- **Cleanup/upload queue safety rules:** untouched (ADR-022, ADR-027, ADR-028, ADR-034 logic in `social-channels.ts`/slot-occupancy not touched).
- Verified after Phase 2 and after Phase 3: `npx tsc --noEmit` and `npx eslint .` both return to the exact same 19-file pre-existing baseline error set that existed before this audit touched anything (zero new errors). A real `--dry-run` of `crawl-story-library.ts stories --limit-stories 1` completed end-to-end with `savedStories: 0`. A module-load smoke test confirmed `validateShortScript`/`runScriptEngine` (short mode) and the channel registries (`getChannelWorkspaces`, `CHANNEL_PROFILES`, `CHANNEL_DEFINITIONS`, `getYoutubeQuoteSchedulerPolicy`) all load and behave correctly with `tang_sau` fully absent/disabled and `phat_phap` fully intact.

## 1. Target Scope (as instructed)

Keep:
1. `phat_phap` short generation pipeline — `tts_short` + `legacy_quote_short`, YouTube Short publishing, Facebook Reel publishing (already configured), short cover, hook tracking, subtitle validation, upload queue, analytics.
2. Story Library **crawler** only — crawl story metadata, crawl chapter text, resume crawl, retry failed crawl.

Remove or disable:
1. `tang_sau` / Tầng Sâu channel flows.
2. Longform pipeline.
3. Story Studio generation product.
4. Audio Story TTS / episode preview / story publishing.
5. Any scheduler lane unrelated to `phat_phap` shorts or story crawling.

## 2. Legend

- **KEEP** — in scope, no change.
- **REMOVE** — fully out of scope, isolated code/table/page, safe to delete once disabled and verified unused.
- **DISABLE_ONLY** — out of scope but routed through shared infra (cron dispatcher, registries, UI nav); turn off without deleting the shared file.
- **REVIEW_SHARED_DEPENDENCY** — single file/table contains both in-scope and out-of-scope logic; needs a surgical edit, not a delete.

---

## 3. Findings not in the original instructions — RESOLVED 2026-06-27

Both ambiguities flagged in the original pass have been resolved by explicit owner decision. No DB/queue mutation was made to act on these decisions; this section records the decision and the verified facts behind it for Phase 2/3 execution.

### 3.1 `finance_news` branch — Decision: REMOVE (same treatment as tang_sau/longform/story-studio)

Re-verified scope, corrected from the initial pass (the initial 5-file count was incomplete):

- `src/lib/finance-news/` — **8 files**: `candidate-pack.ts`, `draft-script.ts`, `image-cache.ts`, `photo-news-renderer.ts`, `relevance-scorer.ts`, `render-draft.ts`, `rss-collector.ts`, `theme-classifier.ts`.
- `scripts/finance-news-*.ts` — **8 files**: `finance-news-cache-images.ts`, `finance-news-collect.ts`, `finance-news-render-photo.ts`, `finance-news-latest.ts`, `finance-news-render-draft.ts`, `finance-news-pack.ts`, `finance-news-draft-script.ts`, `finance-news-sources.ts`.
- `package.json` — 8 script entries (`finance:news:collect`, `:latest`, `:sources`, `:cache-images`, `:pack`, `:draft-script`, `:render-draft`, `:render-photo`).
- `src/lib/db/schema.ts` — `financeNewsSources`, `financeRawItems` tables.

This is **not** a "harmless historical doc reference" — it is real, runnable code with its own CLI entrypoints. However, it is fully isolated: confirmed zero references from `src/app/**`, `src/actions/**`, or the cron dispatcher (`grep` for `finance` across `src/app` and `src/actions` returns no matches). It is a standalone, never-wired-into-the-app branch, reachable only via manual `pnpm finance:news:*` script invocation.

**Classification: REMOVE** — lib files + scripts + package.json entries (Phase 2/3). Tables: **mark for later DB cleanup, do not drop** (per standing instruction not to drop tables in this pass).

### 3.2 AiMax TTS — Decision: KEEP shared registry/phat_phap path, REMOVE only Audio Story / Story Studio / longform-specific usage

Verified call sites via `grep -rl "aimax" src`:

**KEEP (shared infra + phat_phap-compatible, no change needed):**
- `src/lib/pipeline/tts-providers/registry.ts` — provider registry/dispatch, channel-agnostic.
- `src/services/tts/providers/AiMaxProvider.ts`, `src/services/tts/TTSService.ts` — provider implementation.
- `src/lib/aimax-settings.ts`, `src/lib/aimax-voice-metadata.ts`, `src/actions/aimax-settings.ts`, `src/actions/aimax-usage.ts` — settings/usage layer. Confirmed `AIMAX_CONFIG_KEYS` includes `phatPhapSpeed`/`phatPhapPitch`/`phatPhapVolume`/`phatPhapNormalize`/`defaultPhatPhapVoiceId` — phat_phap has its own first-class AiMax voice config, so this layer is in scope and must not be deleted.
- `src/app/settings/tts/aimax/**`, `src/app/settings/tts/aimax/usage/**`, `src/components/settings/aimax-settings-client.tsx`, `aimax-usage-client.tsx`, `tts-subnav.tsx` — Settings UI, channel-agnostic.
- `src/lib/pipeline/tts.ts`, `src/lib/pipeline/short-video.ts` — phat_phap short TTS call sites.
- `src/lib/cost/cost-settings.ts`, `cost-constants.ts`, `src/actions/cost-dashboard.ts`, `src/components/dashboard/cost-dashboard-client.tsx` — cost tracking, shared.

**REMOVE (Audio Story / Story Studio / longform-specific AiMax usage — already covered by the broader removals in Phase 2/3, no separate action needed):**
- `src/lib/audio-story/chapter-tts-runner.ts` — removed with the rest of `src/lib/audio-story/` (Phase 2).
- `src/lib/story-studio/audio-settings.ts` — removed with the rest of `src/lib/story-studio/` (Phase 2).
- `src/components/story-studio/episodes-client.tsx` — removed with `src/components/story-studio/` (Phase 2).
- `src/lib/pipeline/longform-narration.ts`, `longform-segment-cache.ts`, `src/lib/pipeline/story-tts.ts` — already classified REMOVE under longform/audio-story pipeline (§5.1/§5.4 below).

**Dead-but-harmless config keys, not urgent:** `AIMAX_CONFIG_KEYS.defaultStoryVoiceId` and `defaultLongformVoiceId` in `src/lib/aimax-settings.ts` become unused once the above files are gone. Leaving them in place is harmless (unread keys in `appConfig`); clean up opportunistically in a later pass, not blocking.

**Net effect: no AiMax-specific deletion step is required.** Its only out-of-scope consumers are files already being deleted for other reasons.

---

## 4. src/actions/*.ts

| File | Classification | Notes |
|---|---|---|
| `ai-usage.ts`, `app-config.ts`, `auth.ts`, `channels.ts`, `cleanup-uploaded-assets.ts`, `content.ts`, `cost-dashboard.ts`, `exchange-rate.ts`, `factory-health.ts`, `music.ts`, `niches.ts`, `prompt-studio.ts`, `prompts.ts`, `publishing-analytics.ts`, `publishing-health.ts`, `youtube-clients.ts`, `youtube-historical.ts` | **KEEP** | Shared infra, no niche-specific branching. |
| `quote-generator.ts`, `quote-shorts.ts` | **KEEP** | phat_phap short/quote generation. |
| `social-channels.ts` | **KEEP** | Upload queue processor — core to required scope. |
| `hook-engine.ts` (action wrapper) | **KEEP** | Hook tracking is explicitly in scope; underlying `src/lib/hook-engine.ts` is short-only already. |
| `content-generator.ts` | **REVIEW_SHARED_DEPENDENCY** | `runSchedulerJobAction` branches on `jobType ===` `"content_gen"`, `"short_pipeline"`, `"quote_pipeline"`, `"long_pipeline"` (verified at lines 1314/1366/1438/1661). `long_pipeline` branch is pure REMOVE; `quote_pipeline`/`short_pipeline` branches must be filtered to `channelKey = "phat_phap"` only, not deleted. |
| `script-engine.ts` (action) | **REVIEW_SHARED_DEPENDENCY** | Thin wrapper over `src/lib/script-engine.ts`, see §5. |
| `schedule-mixer.ts` | **REVIEW_SHARED_DEPENDENCY** | Workspace-aware mixer; must drop `tang_sau_workspace` from candidate pools, keep phat_phap logic untouched. |
| `channel-workspace.ts` | **REVIEW_SHARED_DEPENDENCY** | CRUD over the registry in §6; disable tang_sau workspace record only. |
| `content-intelligence.ts` | **DISABLE_ONLY** | `type ChannelProfile = "tang_sau" | "phat_phap"`. Restrict to phat_phap; do not delete (phat_phap analytics depend on this file). |
| `story-library.ts` | **REVIEW_SHARED_DEPENDENCY** | Single file mixes crawler actions (KEEP: crawl metadata/chapters, resume, retry) with audio-readiness/audio-text/manual-import/episode-preview-sample actions (REMOVE). Needs function-level split, not file deletion. |
| `story-studio.ts` | **REMOVE** | Entire file is Story Studio generation (taxonomy/premise/bible/outline/chapters). No crawler logic inside. |
| `aimax-settings.ts`, `aimax-usage.ts` | **REVIEW** (see §3) | Pending the AiMax cross-use question above. |

---

## 5. src/lib/** — pipeline & engines

### 5.1 Longform — REMOVE (isolated, no crawler/short coupling found)

`src/lib/longform-engine.ts`, `longform-planner.ts`, `longform-planner-script.ts`, `longform-planner-types.ts`, `longform-planner-view.ts`, `src/lib/pipeline/long-video.ts`, `long-images.ts`, `longform-narration.ts`, `longform-segment-cache.ts`, `longform-tts-validation.ts`.

### 5.2 script-engine.ts — REVIEW_SHARED_DEPENDENCY (confirmed, not REMOVE)

Verified directly: `src/lib/script-engine.ts` (1099 lines) contains both `mode: "short" | "long"` in its public generation entrypoint (~line 1069) and long-specific helpers (`long_outline`, `long_opening`, `long_section_N`, `long_closing`, `long_script_repair_N` prompt-version tags, `longBasePrompt` param, `longSentenceWarnings`). This is **one file serving both pipelines** — the long-mode branches must be deleted from inside this file (not the whole file), while the short-mode path stays. Do this only after `longform-engine.ts` (its only caller for long mode) is confirmed disabled, to avoid dead-code drift.

### 5.3 Story Library (`src/lib/story-library/`) — split file-by-file

| File | Classification |
|---|---|
| `crawler.ts`, `repository.ts`, `tracker.ts`, `logger.ts`, `types.ts`, `text.ts`, `parsers/*.ts` (5 site parsers) | **KEEP** — crawl metadata/chapters, resume, retry. |
| `audio-content-quality.ts`, `audio-episode-planner.ts`, `audio-preview-sample-script.ts`, `audio-preview-sample-tts.ts`, `audio-readiness.ts`, `audio-text-normalizer.ts` | **REMOVE** — audio-story-only, confirmed no crawler function calls into these. |
| `effective-text.ts` | **REVIEW_SHARED_DEPENDENCY** — per Master Plan §2 this module computes "raw vs audio-text vs effective" state for the chapter detail page. Confirm whether any KEEP-scope crawler/chapter page reads raw word counts through this helper before deleting; if only the audio-text UI calls it, REMOVE. |

### 5.4 Audio Story (`src/lib/audio-story/`) — REMOVE entire directory

25 files (chapter TTS, episode assembly/mix/render, intro/outro, background music, local preview, story cover, YouTube episode metadata template). All audio-story-specific; no references found from crawler or phat_phap short code.

### 5.5 Story Studio (`src/lib/story-studio/`) — REMOVE entire directory

8 files (audio-settings, audio-compatibility, chapter-generation-guard, duration-calibration, episode-metadata, episode-readiness, production-progress, youtube-channel). All Story Studio generation-only.

### 5.6 Registries — REVIEW_SHARED_DEPENDENCY (edit, don't delete)

| File | tang_sau touchpoint |
|---|---|
| `src/lib/channel-workspace-registry.ts` | `workspaceId: "tang_sau_workspace"`, `promptProfileId: "tang_sau_v1"`, `channelKey: "tang_sau"` (line ~144-148) — one workspace entry in an array; remove the entry, keep the registry. |
| `src/lib/prompt-studio-registry.ts` | `tang_sau_v1` channel profile id appears 9+ times (lines 256, 324, 331, 338, 345, 352, 371, 378, 385, 455) across `CHANNEL_PROFILES`, format lists, and quote-style option lists. Several entries are **co-listed with `buddhist_healing_v1`** (e.g. line 378/385) — those array entries need `tang_sau_v1` removed from a shared array, not the whole entry deleted. |
| `src/lib/config/channel-configs.ts` | tang_sau channel definition in `CHANNEL_KEYS`/`CHANNEL_DEFINITIONS` — remove entry. |
| `src/lib/content-format-type.ts` | **KEEP, no change needed.** Verified content: only `tts_short`, `legacy_quote_short`, `long_video`, `facebook_quote_photo` literals — all four are referenced by in-scope logic (long_video must stay a recognized-but-unused type until upload_queue rows referencing it are gone; do not remove the literal while any historical row still uses it). |

### 5.7 Everything else under src/lib (publishing/, social/, video/, quotes/, analytics/, pipeline/tts*.ts, pipeline/images.ts, pipeline/short-video.ts, pipeline/quote-short-pipeline.ts, db/*) — **KEEP**, no tang_sau/longform/story-studio coupling found.

---

## 6. src/app — pages & API routes

### REMOVE (isolated route trees)

- `src/app/story-studio/**` (dashboard, new, reader, bible, premises, outline, chapters, episodes, settings/audio) — 9 route segments.
- `src/app/admin/story-library/audio-candidates/**` (including `[storyId]/episode-preview`).
- `src/app/admin/longform-planner/`
- `src/app/content/gallery/long/`
- `src/app/api/video/long/run/route.ts`, `src/app/api/images/long/run/route.ts`, `src/app/api/longform/image/route.ts`
- `src/app/api/story-audio-*` (3 routes), `src/app/api/story-cover-assets/`, `src/app/api/story-render-local/`

### KEEP (crawler-facing)

- `src/app/admin/story-library/[storyId]/`, `.../chapters/[chapterId]/`, `.../crawl-monitor/`, `.../missing-chapters/`

### DISABLE_ONLY / REVIEW_SHARED_DEPENDENCY

- `src/app/api/cron/run/route.ts` — single dispatcher, see §7. **REVIEW_SHARED_DEPENDENCY.**
- `src/components/layout/sidebar.tsx` — has nav links to Story Studio/longform-planner pages; **DISABLE_ONLY** (remove links, file stays).
- `src/app/settings/channels/page.tsx`, `src/components/channels/channel-manager-client.tsx`, `src/components/channels/auto-schedule-config-panel.tsx`, `src/components/content/schedule-mixer-panel.tsx`, `src/components/content/quote-generator-panel.tsx`, `src/components/content/quote-shorts-manager.tsx`, `src/components/channels/content-intelligence-client.tsx` — all **REVIEW_SHARED_DEPENDENCY**: tang_sau appears as one option among phat_phap in dropdowns/filters/arrays inside otherwise-needed shared UI.
- `src/app/publishing/analytics/content-intelligence/page.tsx`, `src/app/publishing/mixer/` — **DISABLE_ONLY** the tang_sau selector option; page itself stays for phat_phap.

Everything else under `src/app/publishing/**`, `src/app/content/**` (excluding `gallery/long`), `src/app/settings/tts/**`, `src/app/api/tts/**`, `src/app/api/quote-shorts/**`, `src/app/api/youtube/**`, `src/app/api/admin/**` — **KEEP**, no out-of-scope coupling found.

---

## 7. Cron dispatcher — `src/app/api/cron/run/route.ts` (REVIEW_SHARED_DEPENDENCY)

Verified call chain:

```
acquireCronLock()
detectCronGap()
processUploadQueueAction({ source: "cron", allowUpload: true })   -> processes ALL upload_queue rows, no channel filter at dispatch level
SELECT contentSchedulerJobs WHERE isEnabled AND nextRunAt <= now()
  -> runSchedulerJobAction(job.id) per due job
     -> branches internally on job.jobType: "content_gen" | "short_pipeline" | "quote_pipeline" | "long_pipeline"
backfillLegacyUploadsAction()
cleanupMediaFilesAction()
syncYouTubeAnalyticsAction({ limitVideos: 20 })
syncFacebookAnalyticsAction({ limitVideos: 20 })
runAutoRefillWatcher({ dryRun: false, source: "cron" })
maybeSendFactoryHealthSummaryAction(...)
maybeSendScheduledAnalyticsReportAction(...)
```

The dispatcher itself does not hardcode `tang_sau` or `long_pipeline` — it is generic and trusts `contentSchedulerJobs` row data (`jobType`, `nicheName`/`channelKey`) to decide what runs. This means the actual scope cut for cron-driven work happens at two levels, **not** in this route file:

1. **DB row level** (not done in this pass per "do not mutate DB in first audit pass"): any `content_scheduler_jobs` row with `jobType = "long_pipeline"` or `channelKey = "tang_sau"` needs `isEnabled = false` to stop without code change.
2. **Code level**: `runSchedulerJobAction`'s `long_pipeline` branch (content-generator.ts:1661) should be removed/guarded once longform is confirmed disabled at the DB level, so a stray enabled long_pipeline row can't silently resurrect longform runs.

`processUploadQueueAction` and `runAutoRefillWatcher` already operate on existing `upload_queue`/`social_channels` rows — once tang_sau/longform queue rows are absent (because their producing jobs are disabled), these shared functions naturally stop touching out-of-scope content without needing per-channel filtering logic added. Confirmed no special-casing is required here beyond stopping the producers.

**Classification: REVIEW_SHARED_DEPENDENCY at the job-type level inside `content-generator.ts`, not at the route file.**

---

## 8. Database schema (`src/lib/db/schema.ts`) — verified table list

Counted directly: 40 `pgTable(...)` calls.

### KEEP (core shorts + publishing + crawler)

`niches`, `promptTemplates`, `contentPieces`, `contentOutputs`, `agentSuggestions`, `ttsVoices`, `ttsJobs`, `generatedContents`, `promptTestRuns`, `contentGenerations`, `contentSchedulerJobs`, `apiUsageLogs`, `musicTracks`, `youtubeOauthClients`, `platformAccounts`, `socialChannels`, `uploadQueue`, `publishedVideos`, `videoMetricSnapshots`, `appConfig`, `cronRunLogs`, `generationCostEvents`, `storySources`, `storySourceChapters`, `storyCrawlRuns`, `storyCrawlEvents`.

Note: `contentGenerations` carries both phat_phap and tang_sau rows (`channel_key`/`niche_id` discriminated) and both short and long columns (`shortScript`/`longScript`, etc.) in the same wide table — this is the God Object table per ADR-015. **It cannot be split or have columns dropped without a data migration; treat the long-* and tang_sau-tagged columns as dead/unused going forward, not as something to ALTER TABLE in this pass.**

`storySourceChapters` also carries the audio-text columns (`audioText`, `audioTextStatus`, `audioTextIssueCount`, `audioTextNormalizationVersion`, `audioTextSource`, `audioTextUpdatedAt`, `audioTextReviewedAt`, `audioTextReviewNote` — confirmed at schema.ts:1122-1132). **Correction to initial pass:** these are columns on the crawler's own chapter table, not a separate `storyChapterAudioText`/`storyChapterAudioTextSource` table as initially assumed — there is no standalone audio-text table in the current schema. **REVIEW_SHARED_DEPENDENCY**: the table itself is KEEP (crawler), but these 8 columns are audio-story-only and unused once audio-text UI/actions are removed. Leave the columns in place (schema/DB mutation is out of scope for this pass); just stop writing to them.

### REMOVE (Story Studio + Audio Story generation tables, mark for later DB cleanup — do not drop now)

`storyTaxonomy`, `stories`, `storyCharacters`, `storyChapters`, `storyMemories`, `storyEpisodes`, `storyQualityChecks`, `storyEpisodeMetadata`, `storyAudioAssets`, `storyVideoAssets`, `storyUploadPackages`, `storyManualUploadValidations`, `financeNewsSources`, `financeRawItems`.

(`financeNewsSources`/`financeRawItems` added per the 2026-06-27 decision in §3.1 — finance_news gets the same treatment as tang_sau/longform/story-studio.)

**Per your rule "do not mutate DB," none of the REMOVE tables should be dropped in this pass** — classification is for the eventual migration/cleanup phase, after code referencing them is confirmed disabled.

---

## 9. Scripts / package.json entrypoints

### KEEP — Story Library crawler cron/launchd entrypoints (verified in package.json)

```
crawl:stories, crawl:story, crawl:story-chapters, crawl:stories:resume
story-library:schedule:install / :uninstall / :status
story-library:crawl:catalog-once / :chapters-once / :retry-failed-once
```
These match exactly the "crawl story metadata / crawl chapter text / resume crawl / retry failed crawl" scope. No change needed.

### REMOVE-adjacent scripts (not re-verified individually, inherited from initial sweep — re-check each before deleting)

Longform: `phase5-longform-engine-test.ts` and other `*longform*` test/audit scripts.
Audio Story: `test-audio-story-*.ts`, `test-audio-text-manual-import.ts`, `mix-audio-story-background-music.ts`.
Tầng Sâu: ~91 files under `src`+`scripts` contain the string `tang_sau` (grep-verified count); most are one-off verify/audit scripts (`verify-mixer-destinations.ts`, `verify-tang-sau-scene-pool.ts`, `verify-quote-style-quality.ts`, `ensure-tang-sau-scheduler-jobs.ts`, `audit-quote-pipeline.ts`, etc.) — these are operator tools, not runtime entrypoints; safe to leave until end-of-pass cleanup, **DISABLE_ONLY at most** (no harm in leaving inert scripts behind temporarily, but they should eventually be deleted alongside the registries they test).

### finance_news scripts — REMOVE (decision 2026-06-27, §3.1)

`scripts/finance-news-cache-images.ts`, `finance-news-collect.ts`, `finance-news-render-photo.ts`, `finance-news-latest.ts`, `finance-news-render-draft.ts`, `finance-news-pack.ts`, `finance-news-draft-script.ts`, `finance-news-sources.ts`, plus the 8 matching `finance:news:*` entries in `package.json`. Verified standalone — no app/action/cron caller.

---

## 10. Summary table

| Bucket | Count (approx, verified subset) | Action |
|---|---|---|
| Story Studio generation (`src/lib/story-studio/`, `src/app/story-studio/`, `src/components/story-studio/`, `storyTaxonomy`/`stories`/`storyCharacters`/`storyChapters`/`storyMemories`/`storyQualityChecks` tables) | 8 lib + 9 routes + 9 components + 6 tables | **REMOVE** |
| Audio Story (`src/lib/audio-story/`, audio-* files in `src/lib/story-library/`, `audio-candidates` routes, `story-audio-*`/`story-cover-assets`/`story-render-local` API routes, `storyEpisodes`/`storyEpisodeMetadata`/`storyAudioAssets`/`storyVideoAssets`/`storyUploadPackages`/`storyManualUploadValidations` tables, audio_text columns on `storySourceChapters`) | 25 lib + 6 story-library files + 2 routes + 3 API routes + 6 tables + 8 columns | **REMOVE** (audio_text columns: leave in place, stop writing) |
| Longform pipeline (`longform-*.ts`, `pipeline/long-*.ts`, long-mode branch inside `script-engine.ts`, long-mode branch inside `content-generator.ts`, longform routes/pages) | 9 lib files + 1 internal branch split + 3 routes | **REMOVE**, except the two internal branch-splits which are **REVIEW_SHARED_DEPENDENCY** |
| `tang_sau` channel (registry entries, mixer/UI dropdown options, scheduler-job rows, queue rows) | 91 files contain the string; ~6 are registry/shared-logic files needing edits, rest are scripts/tests | **DISABLE_ONLY** at the registry/job level (no shared file deletion) |
| `finance_news` branch | 8 lib files + 8 scripts + 8 package.json entries + 2 tables | **REMOVE** — decision 2026-06-27 (§3.1), fully isolated, no app/cron wiring |
| AiMax TTS | shared registry/provider/settings/UI + phat_phap voice config | **KEEP** — decision 2026-06-27 (§3.2); only its Audio Story/Story Studio/longform call sites go away, as a side effect of those files being deleted |
| `phat_phap` short pipeline + Story Library crawler | everything else | **KEEP**, unchanged |

---

## 11. Recommended execution order

1. ~~Decide on the two §3 flags (finance-news, AiMax cross-use)~~ — **done, 2026-06-27.**
2. Disable, don't delete yet: flip `isEnabled = false` is a DB action and excluded from this pass — so the safest *code-level* first step is gating the `long_pipeline` and `tang_sau`-channel branches in `content-generator.ts` and `schedule-mixer.ts` behind an early return, leaving the functions in place.
3. Remove fully isolated directories with zero inbound references from kept code (`src/lib/audio-story/`, `src/lib/story-studio/`, `src/app/story-studio/`, `src/components/story-studio/`, `src/app/admin/story-library/audio-candidates/`, `src/app/admin/longform-planner/`, `src/app/content/gallery/long/`, longform `pipeline/long-*.ts`/`longform-*.ts`).
4. Do the surgical edits on REVIEW_SHARED_DEPENDENCY files (`script-engine.ts` long-mode removal, registry entries, UI dropdown options, cron-adjacent job-type branch).
5. Run `tsc`/`eslint` after each of steps 3 and 4 (per your instruction to typecheck/lint after each phase) before moving on, to catch dangling imports from deleted files immediately.
6. Only after code-level removal is verified clean: plan the DB migration to drop the REMOVE tables and disable/retire stale `content_scheduler_jobs`/`upload_queue`/`social_channels` rows for `tang_sau` and `long_video` — as a separate, explicitly-approved pass, not part of this audit. **Not done in this pass — still pending, see §14.**

---

## 12. Phase 2 execution log (2026-06-27)

Deleted, all confirmed zero inbound references from kept code before deletion:

- `src/lib/audio-story/` (25 files), `src/lib/story-studio/` (8 files), `src/app/story-studio/` (9 routes), `src/components/story-studio/` (9 components), `src/actions/story-studio.ts`.
- `src/app/admin/story-library/audio-candidates/` (incl. `[storyId]/episode-preview`).
- `src/app/api/story-render-local/`, `src/app/api/story-cover-assets/`, `src/app/api/story-audio-local/`.
- `src/app/admin/longform-planner/`, `src/app/content/gallery/long/`, `src/app/api/video/long/`, `src/app/api/images/long/`, `src/app/api/longform/`.
- `src/actions/longform-planner.ts`, `src/actions/longform-engine.ts` (zero callers — dead), `src/components/admin/longform-planner-client.tsx`.
- `src/lib/longform-planner.ts`, `longform-planner-view.ts`, `longform-planner-script.ts`, `longform-planner-types.ts`.
- `src/lib/pipeline/longform-tts-validation.ts`, `story-tts.ts`, `story-upload-package.ts`, `story-video.ts` (only caller of each was `story-studio.ts`/`longform-planner.ts`, deleted in the same batch).
- `src/lib/finance-news/` (8 files: `candidate-pack.ts`, `draft-script.ts`, `image-cache.ts`, `photo-news-renderer.ts`, `relevance-scorer.ts`, `render-draft.ts`, `rss-collector.ts`, `theme-classifier.ts`) + 8 matching `scripts/finance-news-*.ts` + 8 `package.json` entries.
- **Cascade discovered during typecheck** (not in the original Phase 2 list, added with explicit user confirmation after a permission block — see conversation): ~64 orphaned operator/test scripts under `scripts/` that statically imported the now-deleted audio-story/story-studio/longform/finance-news modules (full list available in conversation history; includes `test-audio-story-*.ts`, `create-audio-story-*.ts`, `*-longform-*.ts`, `package-long-video.ts`, etc.), plus their `package.json` entries (54 dangling script keys removed).

`npx tsc --noEmit` and `npx eslint .` after Phase 2: returned to the pre-existing 19-file baseline (zero new errors) except one expected, intentionally-deferred file (`src/lib/story-library/audio-preview-sample-tts.ts`, fixed in Phase 3).

## 13. Phase 3 execution log (2026-06-27)

- **`script-engine.ts` long-mode removal:** removed `LongChapter`, `LongOutlineSection`, `LongOutline`, `LongScriptEngineResult` types; `validateLongScript`; `buildLongOutlinePrompt`/`buildLongOpeningPrompt`/`buildLongSectionPrompt`/`buildLongClosingPrompt`/`buildLongRepairPrompt`; `parseLongOutline`; `buildChapters`; `generateLongScriptInternal`; simplified `runScriptEngine` to short-only. Short-mode path (`generateShortScriptInternal`, `validateShortScript`, `validateShortScriptProsody`) untouched and verified via a module-load smoke test. `src/actions/script-engine.ts` (a dead action wrapper, zero callers) trimmed to match.
- **`content-generator.ts`:** `long_pipeline` job branch replaced with a fail-closed stub; `generateContentAction`'s `needLong` branch (called `runScriptEngine` with the now-removed `mode: "long"`) replaced with an early fail-closed return; `expandToLongAction` (long-only, only caller was the gallery's now-removed "Tạo video dài" button) deleted entirely; dead `contentMode === "long"` ternaries simplified since `needLong` makes them unreachable; unused `runLongImages`/`runLongVideo`/`getRecommendedLongBatchSize`/`getRecommendedLongConcurrency` imports removed.
- **`tang_sau` quote_pipeline lane:** rather than editing the generic (and otherwise-shared) `quote_pipeline` branch in `content-generator.ts`, disabled at the source: `getYoutubeQuoteSchedulerPolicy()` in `src/lib/quotes/youtube-quote-scheduler-policy.ts` now always returns `null` (was `tang_sau`-only); the `quote_pipeline` branch already no-ops cleanly on `null` (`skipped: "unsupported_channel"`). `TANG_SAU_YOUTUBE_QUOTE_POLICY` object and its `getWorkspaceById("tang_sau_workspace")` dependency removed.
- **Registries — `tang_sau` entries removed:**
  - `src/lib/channel-workspace-registry.ts`: `tang_sau_workspace` entry removed from `WORKSPACES`.
  - `src/lib/prompt-studio-registry.ts`: `tang_sau_v1` `ChannelProfile` removed; 5 tang_sau-only `TOPIC_FAMILIES` entries removed; `modern_reflective` `AUDIENCE_PROFILES` entry (the whole Tầng Sâu audience profile object, ADR-025) removed; `quote_reflective_modern` `PROMPT_VARIANTS` entry removed (and its `variantIds` reference); 12 tang_sau-only `PROMPT_OPTION_GROUPS` option objects removed; 4 co-listed option objects (`gentle_nature`, `warm_piano`, `contrast_insight`, `nature_peaceful`) had `"tang_sau_v1"` stripped from their `channelProfileIds` array while staying available for `buddhist_healing_v1`.
  - `src/lib/config/channel-configs.ts`: **kept** the `tang_sau` entry in `CHANNEL_KEYS`/`ChannelKey`/`CHANNEL_DEFINITIONS` (a type-union removal would cascade into every file that reads historical `channelKey = "tang_sau"` rows for display/analytics) and instead hard-disabled it: `publishingEnabled: false` (was `true`). This is the real runtime gate checked in `social-channels.ts:140` and `api/youtube/upload/route.ts:40`.
- **Audio Story episode-preview/candidate-board removed from the Story Library crawler's own files** (these had been left as `lib/story-library/*` despite being audio-story features, per the original audit's note that `actions/story-library.ts` "mixes crawler actions with audio-readiness/audio-text/manual-import/episode-preview-sample actions" — §4):
  - Deleted `src/lib/story-library/audio-readiness.ts`, `audio-episode-planner.ts`, `audio-preview-sample-script.ts`, `audio-preview-sample-tts.ts`, `audio-content-quality.ts` (5 files — the entire "is this story ready to become an audio episode" + TTS preview-sample stack).
  - Removed from `src/actions/story-library.ts`: `toAudioReadinessChapterInput`, `StoryLibraryAudioCandidateFilters`/`Row` types, `matchesAudioCandidateFilters`, `compareAudioCandidateRows`, `getStoryLibraryAudioCandidatesAction`, `toEpisodePlannerChapterInput`, `StoryLibraryEpisodePreviewOptions`, `getStoryLibraryEpisodePreviewAction`, `getStoryLibraryEpisodePreviewSampleAction`, `parseSampleDurationMinutes`, `createStoryLibraryEpisodePreviewSampleAction`; simplified `getStoryLibraryStoryAction` to stop computing/returning `audioReadiness`.
  - Removed the `AudioReadinessCard` component and its "Build episode preview" / "Recover missing chapters" buttons from `src/app/admin/story-library/[storyId]/page.tsx` (the card's only real dangling-link risk was the now-deleted episode-preview route).
  - `src/lib/story-library/audio-text-normalizer.ts` had its own internal dependency on the deleted `audio-episode-planner.ts` (`EPISODE_SCRIPT_PAUSE_MARKER`, a string constant) — re-homed as a local constant since the rest of the normalizer (dot/star-obfuscation cleanup, glued-sentence repair) does not touch TTS/episode production and was kept (judgment call: chapter text quality-of-crawl tooling, not an audio-story feature — see reasoning in conversation).
  - Deleted matching orphaned test scripts: `scripts/test-audio-content-quality.ts`, `test-audio-preview-sample-script.ts`, `test-audio-episode-planner.ts`, `test-audio-text-manual-import.ts` (the last one tested the now-removed episode-preview/candidate-board integration specifically) + 4 `package.json` entries.
- **UI nav cleanup (`src/components/layout/sidebar.tsx`):** removed the "Long" content-gallery tab link, "Longform Planner" publishing-nav link, top-level "Story Studio" nav link, and "Audio Candidates" Story Library sub-nav link. Removed now-unused `BookOpen`/`PenLine`/`Headphones` icon imports and the now-dead `isStoryStudioActive` pathname check.
- **Gallery "Expand to Long" removed:** `onExpandToLong`/`isExpandLoading`/`handleExpandToLong` prop-threading and the "Tạo video dài" button removed from `content-gallery.tsx` → `content-gallery-grid.tsx` → `content-gallery-card.tsx` (3 files), since its only backing action (`expandToLongAction`) was deleted. Unused `TrendingUp` icon import removed.
- **`tts.ts`:** removed the `contentType === "long"` early-return + `runLongformNarration` import; `runTTS`'s `contentType` param narrowed from `"short" | "long"` to `"short"`. `src/app/api/tts/run/route.ts` request-body type narrowed to match.
- **Not changed, by explicit judgment call (see conversation for full reasoning), because they are chapter-text data-quality tooling rather than "Audio Story TTS / episode preview / story publishing":** the Manual Audio Text Import actions (`reanalyzeStoryLibraryChapterAudioTextAction`, `resetStoryLibraryChapterAudioTextToRawAction`, `approveStoryLibraryChapterAudioTextAction`, `markStoryLibraryChapterAudioTextNeedsReviewAction`, `importStoryLibraryChapterAudioTextAction`, `importStoryLibraryChapterAudioTextFromFallbackAction`), `audio-text-normalizer.ts`, the "Audio text quality" panel on the chapter detail page, and the Missing Chapters page's audio-text-aware classification (`getStoryLibraryMissingChaptersAction`). These don't call any deleted module and don't do TTS/episode/publishing themselves — they clean/score the crawled text itself. Flagged here for your review in case you'd rather these go too.
- **Not changed:** `getRecommendedLongBatchSize`/`getRecommendedLongConcurrency` definitions in `src/lib/pipeline/perf.ts` itself (the functions, not just their content-generator.ts call sites) — left in place since `perf.ts` is shared infra and the functions are harmless if unused; not worth a separate edit. `AIMAX_CONFIG_KEYS.defaultStoryVoiceId`/`defaultLongformVoiceId` in `aimax-settings.ts` — dead-but-harmless config keys, per the original §3.2 decision.

Verification after Phase 3: `npx tsc --noEmit` and `npx eslint .` both back to the exact pre-existing 19-file baseline (zero new errors, confirmed file-by-file against the very first baseline captured before any change in this audit). `crawl-story-library.ts stories --dry-run --limit-stories 1` ran end-to-end (`savedStories: 0`). Module-load smoke tests confirmed `validateShortScript`/`runScriptEngine` (short mode) and all edited registries behave correctly with `tang_sau` absent/disabled and `phat_phap` unaffected.

## 14. Still pending (not done in this pass)

1. **DB cleanup migration** — drop the REMOVE-classified tables (§8) and decide disposition of historical `tang_sau`/`long_video` rows in `content_generations`/`upload_queue`/`published_videos`/`content_scheduler_jobs`/`social_channels`. Explicitly out of scope per your instruction; needs its own approved pass.
2. **`AIMAX_CONFIG_KEYS.defaultStoryVoiceId`/`defaultLongformVoiceId`** — dead config keys, harmless, opportunistic cleanup only.
3. **Your call from §13's flagged item** — whether the Manual Audio Text Import / chapter audio-text-quality tooling should also be removed, or stays as crawler-adjacent data-quality tooling.
4. Operator scripts and ADRs (`DECISIONS.md` ADR-031/032/033/034, `PROJECT_MASTER_PLAN.md` tang_sau-specific operational notes) were not rewritten — they remain historically accurate descriptions of what existed, not currently-active behavior. Consider a documentation pass once the DB cleanup (item 1) lands.
