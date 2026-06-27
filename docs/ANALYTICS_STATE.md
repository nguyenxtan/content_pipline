# Analytics State

> Audit date: 2026-06-01

---

## 1. What Analytics Are Currently Collected

### YouTube (Data API v3 — `videos.list`)
Sync is triggered by cron or manual action (`syncYouTubeAnalyticsAction`).
The API call uses `part: ["snippet", "statistics", "contentDetails", "status"]`.

| Field | Source | Written to DB |
|-------|--------|---------------|
| `viewCount` | `statistics.viewCount` | `publishedVideos.latestViewCount`, `videoMetricSnapshots.viewCount` |
| `likeCount` | `statistics.likeCount` | `publishedVideos.latestLikeCount`, `videoMetricSnapshots.likeCount` |
| `commentCount` | `statistics.commentCount` | `publishedVideos.latestCommentCount`, `videoMetricSnapshots.commentCount` |
| `favoriteCount` | `statistics.favoriteCount` | `videoMetricSnapshots.favoriteCount` |
| `durationSeconds` | `contentDetails.duration` (ISO 8601 parsed) | `publishedVideos.durationSeconds`, `videoMetricSnapshots.durationSeconds` |
| `privacyStatus` | `status.privacyStatus` | `publishedVideos.privacyStatus`, `videoMetricSnapshots.privacyStatus` |
| `publishedAt` | `snippet.publishedAt` | `publishedVideos.publishedAt` |
| `title`, `description`, `tags` | `snippet.*` | `publishedVideos.*` |
| `rawJson` | Full API response | `videoMetricSnapshots.rawJson` |

### Facebook (Graph API — `/video_reels`)
Fields requested: `id,description,created_time,permalink_url,length,views`.

| Field | Source | Written to DB |
|-------|--------|---------------|
| `viewCount` | `views` | `publishedVideos.latestViewCount`, `videoMetricSnapshots.viewCount` |
| `durationSeconds` | `length` | `publishedVideos.durationSeconds`, `videoMetricSnapshots.durationSeconds` |
| `publishedAt` | `created_time` | `publishedVideos.publishedAt` |
| `description` | `description` | `publishedVideos.description` |
| `rawJson` | Full API response | `videoMetricSnapshots.rawJson` |

Facebook `likeCount` and `commentCount` in snapshots are copied from the existing DB row (`row.latestLikeCount ?? 0`), not fetched from the API. The Graph API `/video_reels` endpoint does not return reaction/comment counts in the current query.

### Sync cadence (`shouldSyncVideo`)
| Video age | Re-fetch after |
|-----------|---------------|
| < 48 hours | 6 hours |
| 48 hours – 30 days | 24 hours |
| > 30 days | 72 hours |

---

## 2. Database Tables Involved

| Table | Role |
|-------|------|
| `published_videos` | One row per (platform, video). Holds the **latest** counts. FK to `platform_accounts`, `content_generations`. |
| `video_metric_snapshots` | One row per sync. Time-series of counts at a point in time. FK to `published_videos`. |
| `platform_accounts` | Canonical channel/page identity. Holds `lastSyncedAt`. |
| `social_channels` | OAuth credentials, quota state. FK to `platform_accounts`. |
| `content_generations` | Source of `topic`, `nicheName`, `thumbnailText`, `longThumbnailPath`. Linked via `published_videos.contentId`. |
| `upload_queue` | Maps `contentId` → `platformVideoId`; source for backfill into `published_videos`. |
| `app_config` | Stores `publishing_analytics_report_config_v1` (period, schedule, platform, account). |

---

## 3. Metrics Available

The following can be queried today with existing data:

- **Total / per-video views** — cumulative as of last sync
- **Total / per-video likes** (YouTube only; Facebook broken, see §1)
- **Total / per-video comments** (YouTube only)
- **View delta over a period** — computed from earliest/latest snapshot in the report window
- **Duration** (seconds) — from API for YouTube; from `length` for Facebook reels
- **Video type** (`short` / `long`)
- **Topic** — via `content_generations.topic` join
- **Niche** — via `content_generations.nicheName` join
- **Published date**
- **Platform / channel** — account hierarchy is fully modelled

The Telegram report surfaces: total views, delta views, likes, comments, top-5 by views, top-3 by view growth.

---

## 4. Metrics Missing

> Update 2026-06-02:
> Live verification against YouTube Analytics API v2 confirmed that
> `averageViewDuration` and `averageViewPercentage` are available for the
> current `ids=channel==MINE` + `dimensions=video` report, and the integration
> now writes them into `video_metric_snapshots.avg_view_duration_sec` and
> `retention_pct`.
>
> The same live verification also confirmed that `impressions` and
> `impressionClickThroughRate` are rejected by the public API in this report
> scope with `Unknown identifier ... given in field parameters.metrics`. Treat
> `ctr` and thumbnail impressions as unavailable in the current public
> integration unless Google exposes a supported report/metric combination.

### CTR (click-through rate)
- Schema column `video_metric_snapshots.ctr` (precision 6, scale 4) **exists but is never written**.
- `writeYouTubeMetrics()` does not populate it.
- The YouTube Data API v3 (`videos.list`) **does not return CTR**. CTR is only available from the YouTube Analytics API v2 (`youtubeAnalytics.reports.query`), which requires a separate OAuth scope (`https://www.googleapis.com/auth/youtube.readonly` + `yt-analytics.readonly`).

### Average view duration / retention
- Schema columns `video_metric_snapshots.avg_view_duration_sec` and `retention_pct` **exist but are never written**.
- Same blocker: requires YouTube Analytics API v2, not Data API v3.

### Impressions
- Not in schema at all. Also requires YouTube Analytics API v2.

### Share count
- Schema column `video_metric_snapshots.share_count` exists but is never written. Facebook Graph API can return shares; YouTube Data API does not.

### Facebook reactions and comments
- The Graph API `/video_reels` endpoint does not return reaction counts or comment counts with the current field selection. The snapshot rows store the stale DB value as a placeholder.

### Thumbnail text / visual
- `content_generations.thumbnail_text` exists in schema but is **never written during pipeline runs** — it appears only in the seed script and `video-manifest.ts` type definition. The column has no data in production.
- `content_generations.long_thumbnail_path` is correctly written by `long-images.ts`, but has no metric attached to it (no CTR data).

---

## 5. CTR: Available?

**No.**

The column is reserved. No code exists to call the YouTube Analytics API. All fetching goes through Data API v3 `videos.list`, which omits impression and CTR data entirely. Enabling CTR collection requires:
1. Adding `yt-analytics.readonly` OAuth scope to existing Google OAuth flow
2. Calling `youtubeAnalytics.reports.query` per channel per batch of video IDs
3. Writing results into `video_metric_snapshots.ctr`

---

## 6. Retention: Available?

**No.**

Same blocker as CTR. `avgViewDurationSec` and `retentionPct` are schema placeholders. The Analytics API `averageViewDuration` and `averageViewPercentage` dimensions are the source.

---

## 7. Thumbnail Performance: Measurable?

**No — two separate gaps block this.**

**Gap A — CTR not fetched.** Without CTR there is no performance signal to attach to a thumbnail.

**Gap B — `thumbnailText` not written.** The `content_generations.thumbnail_text` column that would carry the text overlay (e.g. "BÌNH AN KHÔNG XA") is never populated by the pipeline. `longThumbnailPath` (the image file path) is written, but the text component is absent.

To make thumbnail performance measurable you need both gaps fixed: CTR fetched via Analytics API, and `thumbnailText` written during content generation.

---

## 8. Topic Performance: Measurable?

**Partially — view counts per topic are available; CTR and retention are not.**

The analytics action joins `published_videos` → `content_generations` and exposes `topic` and `nicheName` on every `AnalyticsVideoRow`. A query grouping by `topic` and averaging `latestViewCount` is possible today.

What is missing:
- No aggregation by topic exists in any current query or report. The Telegram report lists top individual videos, not top topics.
- No niche-level or topic-level breakdown in `getPublishingAnalyticsAction()`.
- Without CTR and retention (Analytics API), you cannot distinguish "good topic" from "good thumbnail" — views alone conflate the two signals.

---

## 9. Minimum Changes Required for a Feedback Loop

A feedback loop means: the pipeline can read past performance and use it to influence future content selection (topic, hook style, niche allocation).

The minimum set of changes — ordered by dependency — is:

### Step 1 — Connect YouTube Analytics API (prerequisite for everything)

**What:** Add `yt-analytics.readonly` to the OAuth consent screen scopes and call `youtubeAnalytics.reports.query` during each sync, then write `ctr`, `avgViewDurationSec`, `retentionPct` into `videoMetricSnapshots`.

**Why it's the blocker:** Without CTR and retention, you cannot distinguish retention-driven performance from thumbnail-driven performance. Views alone are too noisy a signal to use for content decisions.

**Scope:** New function `fetchYouTubeAnalyticsMetrics()` alongside existing `writeYouTubeMetrics()`. Calls `youtubeAnalytics.reports.query` with `dimensions=video`, `metrics=views,averageViewDuration,averageViewPercentage,annotationClickThroughRate`. Writes into existing snapshot columns. No schema migration needed.

**Risk:** Analytics API quota is 50 units/query vs Data API's 1 unit/call. Batching by channel (not per-video) keeps quota low.

---

### Step 2 — Write `thumbnailText` during pipeline

**What:** When `generateThumbnailIntent()` produces a result in `longform-engine.ts`, persist `thumbnailIntent.text` into `contentGenerations.thumbnailText` via a DB update.

**Why:** Without it, thumbnail A/B analysis is impossible even when CTR is available.

**Scope:** One `db.update(contentGenerations).set({ thumbnailText: intent.text })` call in the long pipeline after metadata generation. No schema migration needed.

---

### Step 3 — Add topic-level aggregation query

**What:** A new query/action (e.g. `getTopicPerformanceAction()`) that groups `published_videos` by `content_generations.topic` and returns: avg views, avg CTR (once available), avg retention, video count, latest `publishedAt`.

**Why:** This is the signal the feedback loop will read — which topics outperform vs underperform.

**Scope:** One new server action, ~40 lines. No schema migration needed.

---

### Step 4 — Expose topic scores to topic suggestion

**What:** When `suggestTopicsAction()` is called to auto-fill a scheduler job's topic, pass it the output of the topic performance query so it can include "top-performing topics: X, Y, Z" and "underperforming: A, B" in the prompt context.

**Why:** This closes the loop — the LLM generating new topics gets actual performance context, not just niche description.

**Scope:** Modify `suggestTopicsAction()` to accept and inject performance data. No schema migration needed.

---

### What is explicitly out of scope for a minimum feedback loop

- Facebook Analytics (Graph API Insights) — marginal signal given Facebook's algorithm dependency; defer until YouTube loop is validated
- Retention curve (per-video second-by-second) — requires separate Analytics API call; aggregate `averageViewPercentage` from Step 1 is sufficient
- Automated prompt rewriting based on scores — too complex before signal quality is validated
- New DB tables — all columns needed already exist in `videoMetricSnapshots` and `contentGenerations`
