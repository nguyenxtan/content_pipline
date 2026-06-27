# Roadmap Context Package

Generated: 2026-06-02  
Scope: repository and local DB state for 3-6 month roadmap planning.  
Constraint: this package is read-only context. It does not change generation, publishing, analytics, prompts, or product code.

## 1. Docs Inventory

Inventory count: 26 files under `docs/`, including this context package. Before this file was added, the repo had 25 docs files.

| Doc | Purpose | Currency | Recommendation |
| --- | --- | --- | --- |
| `docs/ANALYTICS_STATE.md` | Current analytics collection, missing metrics, feedback-loop feasibility. | Current with caveat: YouTube retention is now implemented; CTR/impressions note remains current. | Keep; merge into `ANALYTICS_GUIDE.md`. |
| `docs/ARCHITECTURE_AUDIT.md` | End-to-end pipeline audit, services, failure points, tech debt. | Mostly current, but some issues have since been addressed. | Keep as historical audit; merge stable architecture into `PROJECT_MASTER_PLAN.md`; archive old findings. |
| `docs/CLEANUP_ELIGIBILITY_AUDIT.md` | Audit of cleanup eligibility data sources and YouTube/Facebook completion requirements. | Current. | Keep; merge operational rule into `OPERATIONS.md`. |
| `docs/CONTENT_QUALITY_AUDIT.md` | Prompt/content quality assessment and improvement ideas. | Partially outdated because hook/script engines have advanced. | Merge still-valid quality principles into `ROADMAP.md`; archive detailed old prompt critique. |
| `docs/COST_AUDIT.md` | Cost drivers and model/image generation cost risks. | Partially current; model/image choices may have changed. | Keep; merge into `OPERATIONS.md` and refresh before budget planning. |
| `docs/DECISIONS.md` | Architectural Decision Records and instructions for future agents. | Current as the main ADR file, though some ADR details need refresh. | Keep as long-term `DECISIONS.md`. |
| `docs/HOOK_ENGINE.md` | Hook Engine design and integration notes. | Current enough for Phase 3 foundation. | Keep; merge into `ANALYTICS_GUIDE.md`/`ROADMAP.md` when hook analytics is activated. |
| `docs/MISSING_PENDING_IMAGES_REPORT.md` | Missing Facebook quote/photo source image investigation and recovery options. | Current historical incident report. | Archive after fallback/protection rules are documented in `OPERATIONS.md`. |
| `docs/PERFORMANCE_AUDIT.md` | Performance bottleneck audit. | Partially outdated after Phase 1 improvements. | Merge open bottlenecks into `ROADMAP.md`; archive rest. |
| `docs/PHASE1_PERFORMANCE_REPORT.md` | Performance optimization implementation report. | Current implementation report. | Keep short-term; merge into `OPERATIONS.md`; archive after roadmap consolidation. |
| `docs/PHASE2_THUMBNAIL_ENGINE_REPORT.md` | Local thumbnail engine report. | Current for standalone Python thumbnail engine. | Merge into `ANALYTICS_GUIDE.md` or `OPERATIONS.md`; archive phase report. |
| `docs/PHASE3_HOOK_ENGINE_REPORT.md` | Hook Engine implementation report. | Current foundation, but roadmap should add analytics activation. | Merge into `ROADMAP.md`; archive phase report. |
| `docs/PHASE4_SCRIPT_ENGINE_REPORT.md` | Script Engine refactor and validation report. | Current foundation. | Merge into `PROJECT_MASTER_PLAN.md` and `OPERATIONS.md`; archive phase report. |
| `docs/PHASE5_LONGFORM_ENGINE_REPORT.md` | Longform engine report. | Current for longform foundation. | Merge into `PROJECT_MASTER_PLAN.md`; archive phase report. |
| `docs/PHASE6_DATA_LOOP_REPORT.md` | Observability and data loop report. | Partially current; newer topic analytics now exists. | Merge into `ANALYTICS_GUIDE.md`; archive phase report. |
| `docs/PROJECT_MEMORY.md` | Compact project overview, stack, philosophy, priorities. | Useful but should become canonicalized. | Merge into `PROJECT_MASTER_PLAN.md`. |
| `docs/PROJECT_REVIEW_FOR_ASSISTANT.md` | Broad review for future assistant context. | Partially outdated; still useful orientation. | Merge into `PROJECT_MASTER_PLAN.md`; archive detailed old review. |
| `docs/PROMPT_MAP.md` | Detailed prompt inventory and model mapping. | Mostly current but should be checked against prompt version registry. | Keep as source; merge stable map into `OPERATIONS.md`. |
| `docs/RELIABILITY_AUDIT.md` | Reliability gaps and recommended fixes. | Partially outdated; several gaps have been implemented. | Archive after implemented/open items are moved to `ROADMAP.md`. |
| `docs/RELIABILITY_IMPROVEMENTS.md` | Implemented retry/cron alert improvements. | Current implementation report. | Merge into `OPERATIONS.md`; archive phase report. |
| `docs/ROADMAP_CONTEXT_PACKAGE.md` | Current repo/DB context package for 3-6 month roadmap planning. | Current snapshot. | Keep until `PROJECT_MASTER_PLAN.md` and `ROADMAP.md` are created. |
| `docs/ROADMAP_V2.md` | Earlier multi-phase roadmap. | Partially outdated by implemented features. | Use as input; replace with `ROADMAP.md`. |
| `docs/SUBTITLE_HEALTH_REPORT.md` | Real unpublished-video subtitle health scan. | Current snapshot from 2026-06-02. | Keep short-term; merge summary into `OPERATIONS.md`; archive old scan. |
| `docs/THUMBNAIL_ENGINE.md` | Python thumbnail pipeline design and usage. | Current for standalone long-video thumbnail module. | Keep or merge into `OPERATIONS.md`; note Shorts need cover-frame strategy instead. |
| `docs/YOUTUBE_ANALYTICS_API_PLAN.md` | YouTube Analytics API scope/metric plan and known CTR limitation. | Partially current: scope is implemented, CTR/impressions limitation remains current. | Merge into `ANALYTICS_GUIDE.md`. |
| `docs/youtube-video-analytics-notes.md` | Earlier YouTube analytics and Shorts thumbnail notes. | Partially outdated by implemented analytics tables, still useful for Shorts thumbnail note. | Merge Shorts note into `OPERATIONS.md`; archive rest. |

## 2. Current Feature State

### Reliability

- Retry layer: implemented via `src/lib/llm/retry.ts`; used by hook, script, longform, short image, and long image flows.
- Zod validation: implemented in `src/lib/llm/schemas.ts` and validation modules under `src/lib/validations/`; verification script exists at `scripts/test-zod-schemas.ts`.
- Cron failure alerting: implemented in `src/app/api/cron/run/route.ts` with Telegram alerts via `src/lib/social/telegram.ts`; code inspects per-item pipeline failures as well as top-level job failures.
- Subtitle validation/repair: implemented in `src/lib/video/subtitle.ts`; short video rendering returns `subtitleHealthScore`/status in `src/lib/pipeline/short-video.ts`. Current DB does not persist subtitle health score on `content_generations`.
- Cleanup protection: implemented in `src/actions/cleanup-uploaded-assets.ts`; dry-run default; protects image assets for pending Facebook quote/photo rows with `protectedImageAssetsReason: pending_facebook_quote_or_photo`.

### Content Generation

- Topic generation: implemented inside `src/actions/content-generator.ts`, using niche context, dedupe, and prompt templates.
- Hook generation: implemented in `src/lib/hook-engine.ts`; generate-then-score pattern with 20 hooks and top selection.
- Script generation: implemented in `src/lib/script-engine.ts`; hook-first short script flow and validator foundation.
- Image generation: implemented in `src/lib/pipeline/images.ts` and `src/lib/pipeline/long-images.ts`; Fal.ai calls use retry and multi-image generation uses concurrent calls.
- Short Cover Engine: implemented in `src/lib/short-cover-engine.ts`; read-only engine returns `{ coverText, coverReason, confidence }`; no thumbnail/render/upload integration yet.
- Social image enhancer: implemented in `src/lib/image/social-image-enhancer.ts`; Facebook quote/photo render path uses SVG text overlay through `src/lib/social/facebook-quote.ts`.
- Prompt versioning: schema column `content_generations.prompt_versions` exists; registry in `src/lib/prompt-version-registry.ts`; write path in `src/actions/content-generator.ts`.
- Experiment tracking: schema columns `experiment_id`/`experiment_variant`; helper in `src/lib/content-experiments.ts`; current new assignment is `HOOK/HOOK_V1`.

### Publishing

- YouTube: upload queue and YouTube API integration implemented in `src/lib/social/youtube-api.ts`, `src/actions/social-channels.ts`, and `src/app/api/youtube/upload/route.ts`.
- Facebook Reel: Graph API publishing implemented in `src/lib/social/facebook-api.ts` and `src/actions/social-channels.ts`; env-only Page token config is used.
- Facebook quote/photo: queue type exists as `facebook/quote`; caption safety is implemented in `src/lib/social/youtube-metadata.ts`; quote image render/enhancer and fallback source exist.
- Upload queue: `upload_queue` table stores platform, video type, status, scheduled time, platform ID/URL, uploaded time, and errors.
- Cleanup job: `cleanupUploadedAssetsAction({ dryRun?: boolean, limit?: number })`; API route at `src/app/api/admin/cleanup-uploaded-assets/route.ts`; script at `scripts/cleanup-uploaded-assets.ts`; package scripts were added for dry-run/delete.

### Analytics

- YouTube Data API: implemented for metadata/stats snapshots using `videos.list`.
- YouTube Analytics API retention metrics: implemented via `fetchYouTubeAnalyticsMetrics()` in `src/lib/social/youtube-api.ts`; writes `avg_view_duration_sec` and `retention_pct`.
- CTR/impressions: intentionally not queried because current public channel/video report scope rejects `impressions` and `impressionClickThroughRate` as unknown identifiers.
- Topic performance: implemented as `getTopicPerformanceAction()` in `src/actions/publishing-analytics.ts`.
- Topic summary: implemented as `getTopicPerformanceSummaryAction()` with high/medium/low performer groups, keywords, and observations.
- Topic coverage: implemented as `getTopicCoverageReportAction()` with semantic cluster grouping and under/well-sampled labels.
- Prompt/experiment tracking: implemented in DB and surfaced by Publishing Health Dashboard distribution tables.

## 3. Analytics Page Snapshot

Route inspected: `src/app/publishing/analytics/page.tsx` and `src/components/channels/publishing-analytics-client.tsx`.

### Components rendered

- `AppShell`
- `PublishingAnalyticsClient`
- Internal UI blocks:
  - platform selector: YouTube, Facebook, TikTok
  - channel selector
  - summary cards
  - manual sync button
  - analytics report controls
  - topic performance summary
  - topic coverage report
  - topic performance table
  - YouTube channel cards
  - published video table

### Data/actions used

Server page loads these actions in parallel:

- `getPublishingAnalyticsAction({ platform: "youtube", limit: 120 })`
- `getTopicPerformanceAction({ platform: "youtube", limit: 50 })`
- `getTopicPerformanceSummaryAction({ platform: "youtube", limit: 100 })`
- `getTopicCoverageReportAction({ platform: "youtube", limit: 100 })`

Client actions:

- `syncYouTubeAnalyticsAction`
- `syncFacebookAnalyticsAction`
- `buildPublishingAnalyticsReportAction`
- `getAnalyticsReportConfigAction`
- `saveAnalyticsReportConfigAction`
- reload variants of the four query actions above.

### Sections currently visible

- Platform/channel overview.
- Top cards: total videos, total views, total likes, total comments, last sync.
- Report panel: period selector (`7d`, `14d`, `30d`, `monthly`), auto-send toggle, hour/minute config, preview, send Telegram.
- Topic Performance Summary:
  - High Performers
  - Medium Performers
  - Low Performers
  - Top Keywords
  - Weak Keywords
  - Observations
- Topic Coverage Report:
  - cluster name
  - under/well sampled status
  - video count
  - avg views
  - avg retention
  - avg watch duration
  - representative topics
- Topic Performance table:
  - topic
  - niche
  - videoCount
  - avgViews
  - avgViewDurationSec
  - avgRetentionPct
  - lastPublishedAt
  - default sorting by retention; user can sort by views.
- YouTube-only sections:
  - channel cards
  - published video table.

### Metrics shown

- Total videos, views, likes, comments.
- Stale videos and last sync.
- Per-channel video/views/likes/comments/latest publish/sync.
- Per-video views/likes/comments/duration/privacy/published/sync.
- Topic-level average views, average view duration, average retention.
- Cluster-level average views, average watch duration, average retention.
- Report preview and Telegram send control.

### Missing metrics

- CTR and impressions are not shown and should not be required for current topic analytics.
- Facebook deep video insights/watch time are not available in the current page; UI note says current token lacks deeper insight scope.
- TikTok sync is a placeholder only.
- Hook-level stop-rate/retention impact is not yet tracked.
- Cover/thumbnail performance is not tracked.
- Subtitle health is not visible on analytics page; it is on Publishing Health Dashboard as non-persisted/unknown if DB has no score.

### Low-confidence warnings

- Topic performance table highlights `videoCount < 2` as low confidence.
- Topic summary shows a low-confidence banner when at least 50% of topics have fewer than 2 videos.
- Topic coverage labels clusters with `< 5 videos` as under-sampled and `>= 5` as well-sampled.

### Sample outputs captured

Local DB snapshot on 2026-06-02:

- Published counts:
  - YouTube short: 79 videos, 9,465 total latest views.
  - Facebook short/Reel: 7 videos, 377 total latest views.
  - Facebook quote: 2 posts, 0 latest views.
- Analytics coverage:
  - 83/88 published videos have `latest_fetched_at`.
  - 44/79 YouTube videos have `retention_pct`.
- Topic performance sample:
  - `Nghệ Thuật Tha Thứ...`: 1 video, 1,007 avg views, 42s avg duration, 77.78% retention.
  - `Tha thứ`: 1 video, 915 avg views, retention unavailable.
  - `Thiền Nguyên...`: 1 video, 386 avg views, 62s avg duration, 101.80% retention.
  - `Sợ già`: 3 videos, 289 avg views, retention unavailable.
- Topic summary sample:
  - Top keywords: `chuyển`, `hóa`, `linh`, `sợ`, `trình`, `bị`, `kiến`, `nghiệp`.
  - Weak keywords: `trình`, `hóa`, `ngã`, `chuyển`, `bản`, `trí`, `ẩn`, `lặng`.
  - Observation: `73/75 topic hiện mới có dưới 2 video`.
- Topic coverage sample:
  - Well-sampled: `Thiền định và tĩnh lặng` (17 videos, 54 avg views, 48.56% avg retention).
  - Well-sampled: `Buông bỏ và tha thứ` (9 videos, 266 avg views, 54.99% avg retention).
  - Under-sampled: `Nhân quả và nghiệp lực` (4 videos).
  - Under-sampled: `Quan hệ và xung đột` (2 videos).
  - Under-sampled: `Vô thường và chia ly` (1 video).
- Experiment distribution sample:
  - `UNASSIGNED/UNASSIGNED`: 112 content items.
  - `HOOK/HOOK_V1`: 3 content items.

## 4. Latest Short Pipeline Snapshot

Two relevant snapshots were inspected:

1. Latest short content by creation time: `d467b576-37d2-4c89-8209-8a011b3d1e94`, topic `Mong mỏi sự kết nối`, created `2026-06-02T04:02:11.947Z`. It is still pending TTS/images/video/upload, so it has no media paths or analytics yet.
2. A recent published short with analytics retention data: `42c749b7-971b-4426-ac58-7d31064d330a`, topic `Cô đơn`. This is used below because it shows the full short/publish/analytics chain.

### Content record

- Content ID: `42c749b7-971b-4426-ac58-7d31064d330a`
- Topic: `Cô đơn`
- Niche: `Phật Pháp`
- Hook: `Cô đơn có thể đến bất cứ lúc nào, ngay cả trong đám đông.`
- Script excerpt: `Cô đơn có thể đến bất cứ lúc nào, ngay cả trong đám đông. Tôi nhớ một lần ngồi trong quán cà phê đông đúc...`
- Prompt versions: `{}`; this content was created before prompt version metadata was assigned.
- Experiment ID: `null`
- Experiment variant: `null`
- Image paths:
  - `media/images/42c749b7-971b-4426-ac58-7d31064d330a/0.jpg`
- Audio path:
  - `/media/audio/42c749b7-971b-4426-ac58-7d31064d330a.wav`
- Video path:
  - `media/videos/42c749b7-971b-4426-ac58-7d31064d330a-short.mp4`
- Subtitle health score: not persisted in DB for this item.
- Short cover text: not persisted; `thumbnail_text` is null.

### Publish status

- YouTube short:
  - Queue status: `done`
  - Uploaded at: `2026-05-31T04:01:05.794Z`
  - URL: `https://www.youtube.com/watch?v=GRmLs52FH3U`
- Facebook quote/photo:
  - Queue status: `queued`
  - Scheduled at: `2026-06-06T00:00:00.000Z`
- Facebook Reel:
  - No queue row found for this content in the sampled query.
- Content mirror fields:
  - `youtube_upload_status = done`
  - `facebook_upload_status = pending`

### Latest analytics

- Platform: YouTube short.
- Views: 103.
- Avg view duration: 8 seconds.
- Avg retention: 14.33%.
- Snapshot fetched at: `2026-06-01T23:43:44.849Z`.

### Newer published short without retention yet

- Content ID: `e7c3adb7-dd9b-4573-916d-1219f09b7a21`
- Topic: `Mất phương hướng`
- Published at: `2026-06-02T04:00:19.551Z`
- URL: `https://www.youtube.com/watch?v=D-dSEk4AZIY`
- Views at latest snapshot: 0.
- Avg duration/retention: null, likely because the video is too new and has no meaningful analytics yet.

## 5. Current Known Problems

- View decline/weak views remain an active business concern. Recent topic changes improved hook quality, but data is still thin.
- Many topics have `videoCount < 2`; current topic recommendations should be treated as early signals, not conclusions.
- Topic coverage still has under-sampled clusters: `Nhân quả và nghiệp lực`, `Quan hệ và xung đột`, and `Vô thường và chia ly`.
- Old Facebook queued captions may contain visually dirty/truncated DB text, but publish-time `buildSafeFacebookCaption()` repairs before sending.
- Old missing Facebook quote/photo source images were recovered by short-thumb fallback; cleanup protection now prevents deleting image assets while quote/photo posts are pending.
- CTR/impressions are unavailable from the current public YouTube Analytics channel/video report scope and should remain excluded from topic performance.
- Subtitle health is validated during render but not persisted into `content_generations`, limiting dashboard/report accuracy after render.
- Prompt versioning and experiment tracking are only present for new content; older rows are `UNASSIGNED`.
- Facebook publishing remains more operationally fragile than YouTube because token validity can still be revoked by Meta policy/security/admin events.
- Facebook quote/photo backlog is large: local DB snapshot showed 102 queued quote posts and 27 queued Facebook Reels.
- Cleanup is intentionally conservative: it requires YouTube Short + Facebook Reel completion; Facebook quote/photo completion does not count as video completion for media asset cleanup.
- Topic summary keywords can be noisy because old long generated topics contain repeated generic words such as `nghệ thuật`, `hành trình`, `chuyển hóa`.

## 6. Recommended Roadmap Inputs

These are possible roadmap inputs based only on repo evidence.

### P1

- Short Cover Asset Generator:
  - The read-only Short Cover Engine exists, but it is not yet integrated into cover-frame/video rendering.
  - Next step should generate actual Shorts/Reels cover assets with code-rendered Vietnamese text and safe margins.
- Hook tracking / hook analytics:
  - Hook Engine exists and selected hooks are stored.
  - Need link between selected hook, cover text, first-frame design, and retention/view outcomes.
- Topic Family System:
  - Topic coverage exists via heuristic clusters, but generation does not use topic families.
  - Need controlled sampling plans per cluster to raise under-sampled topics to useful confidence.
- Publishing Health Dashboard:
  - Already implemented at `/publishing/health`; roadmap should keep it as the operational home for queue, cleanup, prompt/experiment, and analytics coverage.
  - Add persisted subtitle health when schema support is added.

### P2

- Footage/B-roll Engine:
  - Current short videos appear to rely on generated still image(s). A B-roll/scene pacing layer may improve viewer retention.
- Thumbnail/Cover performance tracking:
  - Long thumbnail engine and short cover engine exist separately.
  - Need capture `coverText`, cover layout/version, and correlate against views/retention.
- Prompt A/B testing activation:
  - Experiment tracking foundation exists but generation behavior is not changed.
  - Need controlled assignment, holdout/baseline handling, and enough sample size per variant.

### P3

- Content Brain:
  - Use topic performance, hook outcome, cover outcome, and cluster coverage as a planning layer.
- Automatic topic feedback loop:
  - Currently read-only; do not activate until sample sizes improve and bad feedback loops are guarded.
- Multi-platform analytics expansion:
  - Facebook/TikTok slots exist conceptually, but deep metrics are not at YouTube parity.
  - Add platform-specific metric normalization only after stable tokens and API access are solved.

## 7. Files/Areas Most Relevant For Future Planning

### Content generation actions

- `src/actions/content-generator.ts`: main content generation, prompt versions, experiments, queue creation.
- `src/lib/content-prompts.ts`: default prompt/content prompt helpers.
- `src/lib/topics.ts`: topic utilities.

### Hook/script/long pipeline

- `src/lib/hook-engine.ts`: 20-hook generation and scoring.
- `src/lib/script-engine.ts`: short/long script generation and validation.
- `src/lib/longform-engine.ts`: longform metadata, title, tags, thumbnail intent.
- `src/actions/hook-engine.ts`: server action wrapper for Hook Engine.
- `src/actions/script-engine.ts`: server action wrapper for Script Engine.
- `src/actions/longform-engine.ts`: server action wrapper for Longform Engine.

### Media pipeline

- `src/lib/pipeline/tts.ts`: TTS generation and cache.
- `src/lib/pipeline/images.ts`: short image prompts and Fal.ai images.
- `src/lib/pipeline/long-images.ts`: long images and thumbnail image generation.
- `src/lib/pipeline/short-video.ts`: short video render, subtitles, cover-frame timing area.
- `src/lib/pipeline/long-video.ts`: long video render.
- `src/lib/video/subtitle.ts`: subtitle validation and repair.
- `src/lib/video-manifest.ts`: manifest/observability for rendered media.

### Analytics actions

- `src/actions/publishing-analytics.ts`: platform overview, sync, report config, topic performance, topic summary, topic coverage.
- `src/lib/social/youtube-api.ts`: YouTube Data API upload/sync and YouTube Analytics retention metrics.
- `src/app/publishing/analytics/page.tsx`: analytics page server loader.
- `src/components/channels/publishing-analytics-client.tsx`: analytics page UI.

### Social publishing

- `src/actions/social-channels.ts`: upload queue processing and platform publish orchestration.
- `src/lib/social/youtube-api.ts`: YouTube upload/API client.
- `src/lib/social/facebook-api.ts`: Facebook Graph API publish client.
- `src/lib/social/facebook-quote.ts`: quote/photo image rendering.
- `src/lib/social/facebook-quote-source.ts`: original image vs short-thumb fallback resolver.
- `src/lib/social/youtube-metadata.ts`: YouTube metadata and Facebook-safe caption builder.
- `src/lib/social/telegram.ts`: Telegram notifications.

### Image/cover

- `src/lib/image/social-image-enhancer.ts`: SVG overlay enhancer for Facebook quote/photo assets.
- `src/lib/short-cover-engine.ts`: read-only cover text engine for Shorts/Reels.
- `thumbnail_pipeline/`: standalone Python local thumbnail generator for long-video thumbnails.

### Cleanup

- `src/actions/cleanup-uploaded-assets.ts`: cleanup eligibility, dry-run/delete, protected image asset rules.
- `src/app/api/admin/cleanup-uploaded-assets/route.ts`: cleanup API route.
- `scripts/cleanup-uploaded-assets.ts`: cleanup script.
- `scripts/verify-cleanup-image-protection.ts`: cleanup image-protection verification.

### Prompt/version/experiment tracking

- `src/lib/prompt-version-registry.ts`: prompt version registry.
- `src/lib/content-experiments.ts`: experiment assignment foundation.
- `drizzle/0028_prompt_versions.sql`: prompt version migration.
- `drizzle/0029_content_experiments.sql`: experiment tracking migration.
- `scripts/verify-prompt-versions.ts`: verification script.
- `scripts/verify-content-experiments.ts`: verification script.

### Health/operations

- `src/actions/publishing-health.ts`: read-only factory health aggregation.
- `src/app/publishing/health/page.tsx`: health dashboard route.
- `src/components/channels/publishing-health-dashboard.tsx`: health dashboard UI.
- `src/app/api/cron/run/route.ts`: cron orchestration and Telegram failure/recovery alerting.

## 8. Suggested Docs Consolidation

No existing docs should be deleted or moved yet. Recommended future targets:

### `docs/PROJECT_MASTER_PLAN.md`

Merge:

- `docs/PROJECT_MEMORY.md`
- stable architecture sections from `docs/ARCHITECTURE_AUDIT.md`
- stable overview sections from `docs/PROJECT_REVIEW_FOR_ASSISTANT.md`
- core pipeline state from this `docs/ROADMAP_CONTEXT_PACKAGE.md`

Purpose:

- One canonical product/technical overview for future AI/PM planning.

### `docs/ROADMAP.md`

Merge:

- `docs/ROADMAP_V2.md`
- open/unimplemented items from `docs/PERFORMANCE_AUDIT.md`
- open/unimplemented items from `docs/CONTENT_QUALITY_AUDIT.md`
- open/unimplemented items from `docs/RELIABILITY_AUDIT.md`
- roadmap inputs from this package.

Purpose:

- 3-6 month implementation plan with P1/P2/P3 priorities, sequencing, and measurable outcomes.

### `docs/OPERATIONS.md`

Merge:

- `docs/RELIABILITY_IMPROVEMENTS.md`
- `docs/PHASE1_PERFORMANCE_REPORT.md`
- `docs/CLEANUP_ELIGIBILITY_AUDIT.md`
- `docs/MISSING_PENDING_IMAGES_REPORT.md`
- `docs/SUBTITLE_HEALTH_REPORT.md`
- operational parts of `docs/COST_AUDIT.md`
- Shorts thumbnail note from `docs/youtube-video-analytics-notes.md`

Purpose:

- Daily operation, cron, queues, publishing, cleanup, token handling, and failure response.

### `docs/ANALYTICS_GUIDE.md`

Merge:

- `docs/ANALYTICS_STATE.md`
- `docs/YOUTUBE_ANALYTICS_API_PLAN.md`
- `docs/PHASE6_DATA_LOOP_REPORT.md`
- topic performance/summary/coverage sections from this package.

Purpose:

- Canonical analytics source: what is collected, what is impossible/unavailable, how to interpret low-confidence signals.

### `docs/DECISIONS.md`

Keep as the canonical ADR file.

Refresh:

- Mark implemented ADR assumptions.
- Add decisions for Facebook token strategy, Shorts cover-frame strategy, cleanup protection, and read-only analytics before feedback activation.

### `docs/ARCHIVE/`

Archive after consolidation:

- Phase reports: `PHASE1_*` through `PHASE6_*`.
- Old incident reports after operational rules are merged.
- Old audits once open items are carried into `ROADMAP.md`.

## 9. Roadmap Signals Found

Top 10 signals:

1. Topic analytics exists but sample size is thin: 73/75 topics had fewer than 2 videos in the captured summary.
2. Retention metrics work for many older YouTube videos: 44/79 YouTube videos had `retention_pct`.
3. CTR/impressions should stay out of current planning because the public report scope rejects them.
4. `Buông bỏ và tha thứ` has strong early average views in coverage sample, but still needs controlled sampling to avoid overfitting.
5. Under-sampled clusters include `Nhân quả và nghiệp lực`, `Quan hệ và xung đột`, and `Vô thường và chia ly`.
6. Prompt/experiment tracking is ready for new content but most historical content is unassigned.
7. Short Cover Engine is read-only and ready for the next step: actual cover asset/render integration.
8. Facebook quote/photo queue has many pending rows; token and operational stability should remain a priority before aggressive expansion.
9. Cleanup has been made safer after missing image incidents, but media cleanup remains conservative and should be monitored.
10. Subtitle validation works at render time, but lack of persistence limits long-term analytics and dashboard reliability.

## 10. Missing Information

Information that could not be fully inferred from repo/local DB:

- Exact current production deployment topology and external cron provider.
- Whether the local DB exactly matches production state.
- Current Facebook token validity and permission state at the time a PM reads this.
- Actual viewer retention by hook/cover because hook/cover analytics is not wired yet.
- Actual subtitle health history for published videos because score is not persisted in DB.
- Exact image generation cost after any model/config changes not reflected in docs.
- Whether long-video publishing is operational in production; current local published counts are dominated by Shorts.
- Current browser screenshot of analytics page was not captured; code and DB/script outputs were inspected instead.
