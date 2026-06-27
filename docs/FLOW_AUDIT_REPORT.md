# Flow Audit Report

**Date:** 2026-06-04  
**Scope:** Content / Pipeline / Scheduling / Publishing UX and logic  
**Status:** Findings only — no code changes recommended yet

---

## 1. Current Flow Maps

### 1A — TTS Short Flow

```
[User/Cron]
     │
     ├─ /content page (manual)
     │    └─ generateContentAction()
     │         └─ creates contentGenerations row (status=completed, ttsStatus=pending)
     │
     └─ /api/cron/run (every minute)
          └─ runSchedulerJobAction(job.id)
               │
               ├─ content_gen job
               │    └─ suggestTopicsAction() + generateContentAction()
               │
               ├─ short_pipeline job  ← picks up ttsStatus=pending rows
               │    ├─ checkCapacityGate("short_pipeline")
               │    ├─ src/lib/pipeline/tts.ts      → VieNeu-TTS localhost:8765 (async poll)
               │    ├─ src/lib/pipeline/images.ts   → Fal.ai flux/schnell
               │    ├─ src/lib/pipeline/short-video.ts  → FFmpeg + subtitle validation
               │    │    └─ sets contentGenerations.videoStatus = "done"
               │    └─ autoScheduleVideoAction(id, "short")  [if enabled]
               │         └─ bulkScheduleAction() → inserts upload_queue row (status=queued)
               │
               └─ long_pipeline job  ← (similar to short, omitted for brevity)
```

**Other upload_queue creation paths (manual):**
- `/content/gallery` → `ScheduleUploadModal` → `scheduleUploadAction()` (per individual item)
- `/publishing` BulkScheduler → `bulkScheduleAction()` (for all ready items of a type)

**Publishing:**
```
[Cron tick]
  └─ processUploadQueueAction({ source: "cron", allowUpload: true })
       ├─ resets stuck uploading items (>10 min)
       ├─ picks queued items where scheduledAt <= now
       ├─ limit: 1 per platform per cron tick
       ├─ Facebook preflight check (token health)
       └─ uploads to YouTube / Facebook API
            └─ sets upload_queue.status = "done"
            └─ creates publishedVideos row

[Every cron tick, after upload]
  ├─ syncYouTubeAnalyticsAction()    ← updates publishedVideos.viewCount etc.
  ├─ syncFacebookAnalyticsAction()
  └─ backfillPublishedVideosAction() ← idempotent, no-op after first run
```

**Subtitle validation location:**
- `src/lib/pipeline/short-video.ts` calls `src/lib/video/subtitle.ts`
- Returns `subtitleHealthScore` and PASS/FAIL — written to `contentGenerations` row (not persisted per DB column currently)

---

### 1B — Legacy Quote Short Flow

```
[External process — not in this repo]
  └─ generates MP4 files + JSON manifest
       ├─ output/legacy-quote-short-v1/experiment-batch.json  (primary manifest)
       └─ output/legacy-quote-short-v1/*-legacy-quote-short.json  (sidecar per item)

[User at /content/quotes]
  └─ getLegacyQuoteSamplesAction()
       ├─ reads JSON files from disk (src/lib/quote-shorts-assets.ts)
       ├─ queries contentGenerations for createdAt (may return null — row may not exist yet)
       └─ queries uploadQueue for status per contentId

  └─ previewLegacyQuoteScheduleAction()  (dry-run — no DB writes)
       ├─ reads eligible items (not yet queued/published)
       ├─ computes slot assignments
       └─ returns preview rows with scheduledAtVn

  └─ executeLegacyQuoteScheduleAction()  (execute — writes DB)
       ├─ ensureLegacyContentRows()
       │    └─ INSERT contentGenerations rows IF they don't exist yet
       │         (synthetic rows: status=completed, videoStatus=done, videoPath=pre-rendered MP4)
       └─ INSERT upload_queue rows (status=queued, videoType="short")
```

**Publishing (same cron as TTS):**
```
[Cron picks up queued rows where scheduledAt <= now]
  └─ processUploadQueueAction → uploads via YouTube/Facebook API
```

**Differences from TTS Short:**

| Aspect | TTS Short | Legacy Quote Short |
|--------|-----------|-------------------|
| Source of truth | DB (`contentGenerations`) | JSON files on disk |
| DB row created | At script generation | At schedule time (lazy) |
| Pipeline | TTS → images → render | Pre-rendered, no pipeline |
| `contentId` format | UUID | Prefixed (varies) |
| `videoType` in queue | `"short"` | `"short"` (same!) |
| Identification in queue | `contentExperimentId = "LEGACY_QUOTE_SHORT"` or prefixed ID | same |
| Auto-schedule? | Yes (if enabled) | No — batch-only via `/content/quotes` |
| `ttsStatus` / `imagesStatus` | Populated | NULL / not set |

---

### 1C — Upload / Publishing Flow

**All places that create upload_queue rows:**

| Source | Function | Trigger | Context |
|--------|----------|---------|---------|
| cron short_pipeline | `autoScheduleVideoAction()` | automatic after render | if `autoScheduleEnabled` in config |
| cron long_pipeline | `autoScheduleVideoAction()` | automatic after render | same |
| `/content/gallery` | `scheduleUploadAction()` | manual per-item modal | individual TTS short or long |
| `/publishing` BulkScheduler | `bulkScheduleAction()` | manual batch button | all ready videos of a type |
| `/content/quotes` | `executeLegacyQuoteScheduleAction()` | manual batch execute | Legacy Quote Shorts only |
| cron backfill | `backfillLegacyUploadsAction()` | one-time idempotent | legacy migration only |

**All places that call processUploadQueueAction:**

| File | Source param | allowUpload | Uploads? |
|------|-------------|-------------|---------|
| `src/app/api/cron/run/route.ts` | `"cron"` | `true` | **YES** |
| All others | `"manual"` / `"scheduler_job"` / etc. | false/undefined | NO (dry-run) |

The guard in `processUploadQueueAction`:
```typescript
const dryRun = options.allowUpload !== true &&
               options.source != null &&
               options.source !== "cron"
```
Only `{ source: "cron", allowUpload: true }` enables real upload. This is correct and safe.

**Schedule guard behavior:**
- Stuck items in `"uploading"` for >10 min are reset to `"queued"` each cron tick
- Maximum 2 uploads per cron tick (1 per platform: YouTube + Facebook)
- Facebook preflight check: if token is unhealthy, all Facebook queue items are deferred 6h
- `not_due_yet` guard: `scheduledAt <= now` enforced — future-scheduled items not touched

**Timezone behavior:**
- `upload_queue.scheduled_at` stored in UTC
- `/content/quotes` uses `fromVietnamLocal()` → UTC before storing (correct)
- All UI display uses `Asia/Ho_Chi_Minh` (UTC+7) for formatting
- `bulkScheduleAction` uses `windowStart`/`windowEnd` in VN time via `toVietnamParts()` helpers

---

### 1D — Backpressure

**Capacity reasons and what each gates:**

| Reason | Blocks content_gen | Blocks short/long pipeline |
|--------|-------------------|---------------------------|
| `upload_queue_too_large` | YES | YES |
| `unpublished_rendered_videos_too_many` | YES | YES |
| `media_size_too_large` | YES | YES |
| `low_free_disk` | YES | YES |
| `daily_generation_limit_reached` | YES | NO |

**What backpressure does NOT block:**
- `processUploadQueueAction` — upload runs first on every cron tick, ungated
- Analytics sync — always runs
- `bulkScheduleAction` — no capacity check
- `scheduleUploadAction` — no capacity check
- `executeLegacyQuoteScheduleAction` — no capacity check (see Problem 8 below)
- Cleanup — always runs

**Quote scheduling vs system capacity:**
- `quote-shorts.ts` defines `const PENDING_QUEUE_THRESHOLD = 50` — a hardcoded copy
- `production-capacity.ts` defines `maxPendingUploadQueue: 50` from env `MAX_PENDING_UPLOAD_QUEUE`
- These happen to match, but they are independent constants with no connection
- Quote scheduling displays a warning when threshold exceeded but **does not block**
- This means Quote Shorts can be scheduled even when capacity is at risk

---

### 1E — UI Pages

| Page | Purpose | Creates content? | Creates queue rows? | Uploads? | Read-only? |
|------|---------|-----------------|-------------------|---------|-----------|
| `/content` | AI content generation (topic → script) | YES | Possibly (auto-schedule) | NO | NO |
| `/content/gallery` | Browse TTS shorts, individual scheduling | NO | YES (ScheduleUploadModal) | NO | PARTIAL |
| `/content/gallery/long` | Browse long videos | NO | YES (ScheduleUploadModal) | NO | PARTIAL |
| `/content/quotes` | Manage Legacy Quote Shorts batch | NO | YES (execute) | NO | PARTIAL |
| `/content/scheduler` | Job manager + cron logs + quick links | YES (Run button) | Possibly (pipeline jobs) | NO | NO |
| `/publishing` | Queue monitor + BulkScheduler + AutoSchedule config | NO | YES (BulkScheduler) | NO | PARTIAL |
| `/publishing/analytics` | Performance analytics | NO | NO | NO | YES |
| `/publishing/health` | System health / factory status | NO | NO | NO | YES (mostly) |

**Additional API endpoints (not surfaced in nav):**
- `POST /api/youtube/upload` — legacy direct-upload, bypasses queue (gated by `allowLegacyEnvFallback`)
- `POST /api/video/short/run` — manual short render trigger
- `POST /api/video/long/run` — manual long render trigger
- `POST /api/cron/run` — full cron tick (uploadQueue + jobs + analytics)

---

## 2. Problems / Confusion Points

### P-01 — Three separate scheduling UIs for the same action

Upload_queue rows can be created from:
- `/content/gallery` → ScheduleUploadModal (per item)
- `/publishing` → BulkScheduler (all ready items)
- `/content/quotes` → full batch scheduling panel

A user has to know which page to use for which type. There is no single "schedule this content" flow. The scheduling panels have different UX (per-item modal vs bulk form vs dedicated page with dry-run).

**Risk:** Duplicate rows if user schedules the same item from two places. `bulkScheduleAction` has deduplication, but `scheduleUploadAction` and `executeLegacyQuoteScheduleAction` have separate deduplication logic.

---

### P-02 — `/publishing` mixes two conceptually different concerns

The `/publishing` page contains:
1. `BulkScheduler` — creates upload_queue rows (scheduling action)
2. `AutoSchedulePanel` — configures auto-schedule settings (configuration action)
3. `ChannelGroup` / queue view — monitors existing queue (monitoring)

"Publishing" implies watching what has been published. But this page also does scheduling and configuration. A user looking at `/publishing` to see "what's live" gets a page that also asks them to do things.

---

### P-03 — "Quote Shorts" naming collision

Two completely different things share similar names:
- **Legacy Quote Short** = a short video where the visual content is a quote (pre-rendered MP4, `videoType: "short"` in queue, identified by `contentExperimentId = "LEGACY_QUOTE_SHORT"`)
- **Facebook quote/photo post** = a static image + caption posted to Facebook (`videoType: "quote"` in upload_queue)

The sidebar label "Quote Shorts" navigates to the Legacy Quote Short manager. But in `/publishing`, the same word "quote" appears in the BulkScheduler for "Bài ảnh Facebook" (`videoType: "quote"`). These are entirely different assets.

---

### P-04 — Legacy Quote Shorts have no DB row at creation time

The `contentGenerations` row for a Legacy Quote Short is created **lazily** at schedule time by `ensureLegacyContentRows()`, not when the video is rendered. This means:
- Before scheduling: the row may not exist in DB
- `getLegacyQuoteSamplesAction()` queries DB for `createdAt` — will return `null` for unscheduled items
- If the JSON manifest is lost, all Quote Short metadata is gone — there is no DB fallback
- The "source of truth" is a file on disk, which makes backup, migration, and testing harder

---

### P-05 — `upload_queue.videoType = "short"` covers two distinct content types

Both TTS Shorts and Legacy Quote Shorts use `videoType: "short"`. They are distinguished in the queue by:
- `contentExperimentId === "LEGACY_QUOTE_SHORT"` (set on the contentGenerations row)
- Or `contentId.startsWith("legacy-quote-v2-sample-")`

This is ad-hoc identification used in:
- `schedule-client.tsx` filter logic (`isLegacyQuoteShort()` function)
- Filter UI in `/publishing` ("TTS Short" vs "Legacy Quote" chips)

It works, but it means "was this a TTS short or a quote short?" requires inspecting content metadata, not the queue row itself.

---

### P-06 — Quote scheduling threshold is a detached copy

`src/actions/quote-shorts.ts` line 88:
```typescript
const PENDING_QUEUE_THRESHOLD = 50;
```

`src/lib/production-capacity.ts` line 44:
```typescript
maxPendingUploadQueue: envInt("MAX_PENDING_UPLOAD_QUEUE", 50),
```

These are the same number from different sources. If the operator changes `MAX_PENDING_UPLOAD_QUEUE` via env var, the production backpressure gate updates, but the Quote schedule warning threshold stays at 50.

Furthermore, Quote scheduling only warns — it does not block execution. Backpressure for TTS pipeline does block. This inconsistency means Quote Shorts can overflow the queue in a way that TTS content generation cannot.

---

### P-07 — `/content/scheduler` is a hub with unclear purpose

The page title is "Lập lịch tự động" (automatic scheduling), but the page contains:
- Quick links to TTS Gallery, Quote Shorts, and Publishing
- `SchedulerPanel`: manage `content_scheduler_jobs` (content gen and pipeline jobs)
- Cron logs

The page conflates two different meanings of "scheduler":
1. Content generation/pipeline scheduler (DB jobs that run on a cron tick to create content)
2. Upload scheduler (which uploads are scheduled to go out when)

A new user would not know which to use for "I want to schedule a video to be published."

---

### P-08 — Auto-schedule side effect is invisible to the user

When a `short_pipeline` job completes rendering a video, `autoScheduleVideoAction()` is called silently:
```typescript
await autoScheduleVideoAction(id, "short").catch(() => {});
await autoScheduleVideoAction(id, "quote").catch(() => {});
```

The user has no UI indication that a new queue row was just created. They would need to check `/publishing` to discover it. If auto-schedule settings are misconfigured (wrong channel, wrong window), queue rows silently accumulate with wrong schedules.

---

### P-09 — `/api/youtube/upload` is a legacy bypass path

`src/app/api/youtube/upload/route.ts` is a direct upload endpoint that bypasses the upload queue entirely. It is gated by `publishConfig.allowLegacyEnvFallback`, but it exists and is callable by anyone with API access. If this endpoint is accidentally triggered (old script, leftover automation), it publishes content outside the queue, and there is no `publishedVideos` row created through the standard path.

---

### P-10 — BulkScheduler appears for `videoType: "quote"` (Facebook photo posts) with zero items

In `bulkScheduleAction()`, when `input.videoType === "quote"` and no `contentIds` are provided:
```typescript
if (input.videoType === "quote") {
  targets = [];
}
```
The BulkScheduler shows "Bài ảnh Facebook · 0 chưa lên lịch" if no quote rows are ready. This reflects that Facebook photo posts (quote type) are not currently auto-populated from `getReadyVideosAction()`. The BulkScheduler for this type is effectively non-functional without explicit `contentIds`.

---

## 3. Recommended Simplified Architecture

### Target mental model

```
Content Layer     → create/manage content assets
Scheduling Layer  → decide when to publish
Monitoring Layer  → observe what's happening
```

### Target page responsibilities

**Content Layer (`/content/*`):**
- `/content` — Create TTS content (AI generation only)
- `/content/gallery` — Browse TTS short and long videos, status only. No scheduling controls. Show status badges (pending / rendered / queued / published). Link to scheduling: "Send to queue" navigates to `/publishing`.
- `/content/quotes` — Browse Legacy Quote Shorts, status only. "Send to batch schedule" opens a drawer or navigates to `/publishing` with quote context.

**Scheduling Layer (move into `/publishing`):**
- Keep `/publishing` as the single place to schedule anything.
- Move BulkScheduler from right sidebar to a dedicated "Lên lịch" tab or section.
- Add Quote Shorts batch scheduling controls here (dry-run + execute).
- Remove ScheduleUploadModal from gallery grid — it creates confusion about where scheduling lives.

**Monitoring Layer:**
- `/publishing` queue view — read-only queue status
- `/publishing/health` — factory health
- `/publishing/analytics` — performance metrics

**Job / Pipeline Layer:**
- `/content/scheduler` renamed to `/content/pipeline` or "Tự động hóa"
- Remove quick links to gallery/quotes/publishing (those are navigation concerns)
- Keep only: job management + cron logs

### Proposed routing

```
Nội dung (Content)
├─ /content             → Generate new content
├─ /content/gallery     → Browse TTS Shorts (status-only)
├─ /content/gallery/long→ Browse Long Videos (status-only)
├─ /content/quotes      → Browse Quote Shorts (status-only)
└─ /content/pipeline    → Pipeline jobs + cron logs

Đăng bài (Publishing)
├─ /publishing          → Queue monitor (+ Lên lịch tab)
├─ /publishing/analytics→ Analytics
└─ /publishing/health   → Factory health
```

### Where Quote scheduling should live

**Current:** Full batch scheduling controls (dry-run + execute) are inside `/content/quotes`.

**Recommended:** `/content/quotes` shows Quote Short items and their current status. A single "Lên lịch batch" button opens a drawer or navigates to the scheduling section in `/publishing`. This makes the content page a viewer and the publishing page the scheduler — consistent with TTS flow.

The dry-run preview is still needed before executing. The simplest option: keep dry-run preview inside the drawer/modal on `/content/quotes`, but have the final "execute" be equivalent to what `/publishing` does for other types.

---

## 4. Proposed Source-of-Truth Cleanup (Quote Shorts)

**Problem:** Quote Shorts live in JSON files on disk. DB rows are synthetic and created lazily.

**Proposed approach (not implemented yet):**

1. Add a `contentMode = "quote_short"` or `contentType` flag to `contentGenerations` to distinguish these rows cleanly.

2. Create DB rows at import/discovery time, not at schedule time. A new `importLegacyQuoteShortsAction()` reads the JSON manifest and creates `contentGenerations` rows immediately (idempotent, upsert by contentId).

3. The import action would populate:
   - `id` = contentId from manifest
   - `topic`, `shortContent` = quoteText
   - `videoPath` = pre-rendered outputVideoPath (relative)
   - `videoStatus = "done"`
   - `experimentId`, `experimentVariant` from manifest
   - Custom fields: `contentMode = "quote_short"` (or similar tag)

4. After import, `/content/quotes` reads from DB only, not JSON files. JSON files become a one-time source, not the ongoing truth.

5. Schedule status comes from `uploadQueue` as it does now.

**Benefits:**
- Single source of truth (DB)
- Consistent with TTS flow
- JSON files can be archived or deleted after import
- `contentId` presence in DB is guaranteed before scheduling
- Backup and migration are simpler

**Cost/risk:**
- Requires schema addition (small — `contentMode` or similar already near-exists)
- One-time migration script
- No change to rendering or cron logic

**Do not implement yet:** Validate design with the operator first.

---

## 5. Safe Next Steps (Ordered by Risk)

### Step 1 — Fix detached threshold (safe, no UI change)
Replace hardcoded `PENDING_QUEUE_THRESHOLD = 50` in `quote-shorts.ts` with a call to `getThresholds().maxPendingUploadQueue`. This makes Quote scheduling use the same threshold as the system.

### Step 2 — Make Quote schedule threshold a hard block (safe, UX only)
Change `executeLegacyQuoteScheduleAction` to reject execution (not just warn) when `pendingBefore + insertableRows > maxPendingUploadQueue`. This aligns behavior with TTS backpressure.

### Step 3 — Add a `contentMode = "quote_short"` column (small schema change)
Add a discriminator to `contentGenerations` so Quote Short rows are queryable without prefix-matching or experimentId heuristics. This is the foundation for source-of-truth cleanup.

### Step 4 — Import Quote Shorts to DB at page load (no UI change)
On `/content/quotes` page load, run `ensureLegacyContentRows()` for all samples (not just at schedule time). DB rows exist before the user clicks execute. This eliminates the lazy-creation gap.

### Step 5 — Remove ScheduleUploadModal from gallery grid (UX simplification)
Remove per-item scheduling from `/content/gallery`. Route users to `/publishing` for scheduling. This reduces scheduling entry points from 3 to 2 (auto-schedule + manual in /publishing).

### Step 6 — Move Quote batch scheduling to /publishing (UX clarification)
Move the batch scheduling panel from `/content/quotes` into `/publishing`. `/content/quotes` becomes a content viewer only. This aligns all scheduling in one place.

---

## 6. Things Not to Touch Yet

- `processUploadQueueAction` — upload guard logic is correct
- Cron flow and advisory lock — working correctly
- TTS/images/video pipeline engines — no bugs found
- Analytics sync — working correctly
- Facebook preflight and token handling
- Auto-schedule settings and slot logic
- `/api/youtube/upload` legacy endpoint — note its existence but do not remove (may be used by external tooling)
- Long content pipeline — similar to short, no audit gaps found
- DB schema (beyond the small `contentMode` proposal in Step 3)
- Anything in `src/lib/social/` — uploaders are not the problem

---

## 7. Summary Table

| Finding | Severity | Type | Safe to Fix Now? |
|---------|----------|------|-----------------|
| P-01 Three scheduling entry points | Medium | UX confusion | Step 5, 6 |
| P-02 `/publishing` mixes scheduling + monitoring | Medium | UX confusion | Step 6 |
| P-03 "Quote" naming collision (video vs photo post) | Medium | Naming | Rename "Legacy Quote Short" in UI only |
| P-04 Quote Shorts have no DB row at creation | Medium | Data integrity | Step 4 then Step 3 |
| P-05 `videoType="short"` covers two content types | Low | Code smell | After Step 3 |
| P-06 Quote threshold detached from system threshold | Low | Bug risk | Step 1, 2 |
| P-07 `/content/scheduler` unclear purpose | Low | UX confusion | Rename + restructure |
| P-08 Auto-schedule side effect invisible | Low | UX gap | Add audit log or notification |
| P-09 Legacy direct-upload API bypass exists | Low | Risk | Document, add logging |
| P-10 BulkScheduler "Bài ảnh" shows 0 items always | Low | UX/dead code | Remove or hide if unused |
