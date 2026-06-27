# YouTube Analytics API v2 — Connection Plan

> Audit date: 2026-06-01  
> Scope: read-only audit + plan. No code changes in this document.

---

## 1. Current YouTube OAuth Scopes

There are **two separate OAuth clients** in the codebase. They have different scopes and store tokens in different places.

### Primary client — `src/lib/social/youtube-api.ts`

Used for: channel connection, video upload, Data API v3 `videos.list`.  
Tokens stored in: `social_channels.access_token` / `social_channels.refresh_token` (per channel row).

Scopes requested in `getYouTubeAuthUrl()` (line 37–41):
```
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube
https://www.googleapis.com/auth/youtube.readonly
```

### Legacy upload-only client — `src/lib/youtube/client.ts`

Used for: a single-channel upload path keyed off env vars.  
Tokens stored in: `app_config` table (`youtube_refresh_token`, `youtube_access_token`, `youtube_token_expiry`).

Scope requested in `getAuthUrl()` (line 18):
```
https://www.googleapis.com/auth/youtube.upload
```

**Neither client requests the Analytics API scope.** The `youtube.readonly` scope grants read access to the YouTube Data API v3 — it does not extend to the Analytics API v2, which is a separate API with its own scope.

---

## 2. Scopes Required for CTR and Retention

The YouTube Analytics API v2 (`youtubeAnalytics.reports.query`) requires exactly one additional scope:

```
https://www.googleapis.com/auth/yt-analytics.readonly
```

This scope grants read access to `impressions`, `impressionClickThroughRate`, `averageViewDuration`, `averageViewPercentage`, and all other Analytics API v2 metrics.

The `yt-analytics-monetary.readonly` scope is an alternative that also works, but it additionally grants access to revenue/CPM data, which is a broader grant than necessary. Do not request it.

**The three scopes currently in `getYouTubeAuthUrl()` do not include `yt-analytics.readonly` and are insufficient.** A call to the Analytics API with an existing token will return HTTP 403 `insufficientPermissions`.

---

## 3. Must Existing Tokens Be Regenerated?

**Yes. Every connected YouTube channel must be re-authorized.**

### Why regeneration is mandatory

Google OAuth2 refresh tokens encode the set of scopes that were approved at the time the user clicked "Allow" on the consent screen. This scope set is fixed — it is embedded in the token itself and cannot be extended after the fact. Calling `oauth2.refreshAccessToken()` returns a new access token with the same scope set as the original refresh token; it does not expand scopes.

The current refresh tokens in `social_channels.refresh_token` were issued with `youtube.upload + youtube + youtube.readonly`. When any of these tokens is used to call the Analytics API, Google returns:

```json
{ "error": "insufficientPermissions", "status": 403 }
```

The `social_channels.scope` column stores the exact scope string returned with each token (line 121 of `youtube-api.ts`). After re-authorization the new scope string will include `yt-analytics.readonly`, and this can be used to verify that a channel has been upgraded.

### What re-authorization looks like

The fix to `getYouTubeAuthUrl()` adds `yt-analytics.readonly` to the scope array. The next time a user clicks "Connect YouTube Channel" (or a new "Re-authorize" button), they go through the standard OAuth consent screen. The flow in `connectYouTubeChannel()` is unchanged — new tokens are upserted into the existing `social_channels` row.

Existing channels connected before the scope change will continue to work for video uploads (the old scopes still cover that), but the Analytics API calls will fail for them until they re-authorize. This needs a graceful degradation path in the implementation (log warning, skip analytics, do not break the sync).

### The legacy `src/lib/youtube/client.ts` client

This client uses `app_config` tokens and only requests `youtube.upload`. It is not used for Data API reads and is not wired to analytics. It does not need to be changed and its tokens do not need regeneration — its scope is correct for its purpose.

---

## 4. Exact API Endpoint and Metrics

### Endpoint

```
GET https://youtubeanalytics.googleapis.com/v2/reports
```

Via the googleapis SDK:
```typescript
const analyticsClient = google.youtubeAnalytics({ version: "v2", auth: oauth2 });
const res = await analyticsClient.reports.query({ ... });
```

### Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| `ids` | `channel==MINE` | Scoped to the authenticated channel |
| `startDate` | `YYYY-MM-DD` (video's publish date or 90 days ago) | Required |
| `endDate` | `YYYY-MM-DD` (today) | Required |
| `dimensions` | `video` | Returns one row per video |
| `metrics` | See below | Comma-separated |
| `filters` | `video==vidId1,vidId2,...` | Max 500 chars; roughly 20–25 video IDs |

### Metrics to request

| Metric name | Maps to schema column | Description |
|------------|----------------------|-------------|
| `impressions` | `rawJson` (no dedicated column yet) | Total times thumbnail shown in YouTube feed |
| `impressionClickThroughRate` | `videoMetricSnapshots.ctr` | Fraction of impressions that became views (0–1) |
| `averageViewDuration` | `videoMetricSnapshots.avg_view_duration_sec` | Mean watch time in seconds |
| `averageViewPercentage` | `videoMetricSnapshots.retention_pct` | Mean % of video watched |

Note: `views` is also available from the Analytics API but the Data API v3 `statistics.viewCount` is more real-time and is already fetched. No need to duplicate it.

### Batching strategy

The `filters=video==...` string has a practical limit of ~500 characters. With 11-character YouTube video IDs and commas that gives roughly 40 IDs per query. The Data API sync already processes videos in groups — the Analytics API call should use the same batch groups.

The Analytics API quota cost is **1 unit per query** (not per video) with a 200,000 unit daily limit. At 40 videos per query, fetching 120 videos costs 3 units. This is negligible and does not need the rate-limiting logic that the Data API sync uses.

### Data freshness caveat

YouTube Analytics data is delayed by approximately 24–72 hours. `impressionClickThroughRate` requires at least 10 impressions to be calculated; the API returns 0 or omits the row for very new or low-traffic videos. The implementation must treat `null`/missing values as `null` in the DB, not 0.

---

## 5. Where to Store Results in Existing Schema

All needed columns already exist. **No schema migration is required.**

### `video_metric_snapshots` table

| Column | Type | Analytics metric | Current state |
|--------|------|-----------------|---------------|
| `ctr` | `numeric(6,4)` | `impressionClickThroughRate` | Reserved, never written |
| `avg_view_duration_sec` | `integer` | `averageViewDuration` | Reserved, never written |
| `retention_pct` | `numeric(5,2)` | `averageViewPercentage` | Reserved, never written |
| `raw_json` | `jsonb` | Full Analytics API row (incl. `impressions`) | Currently holds Data API row |

`impressions` has no dedicated column. Store it in `rawJson` alongside the existing Data API fields in the snapshot row. This avoids a schema migration and keeps raw data available.

### Write strategy

The Analytics API fetch runs **after** `writeYouTubeMetrics()` within the same sync cycle. The Analytics data should be written to the **same snapshot row** that `writeYouTubeMetrics()` just inserted, not as a separate row. This keeps each snapshot self-consistent: one row = one point in time with both Data API and Analytics API fields.

Implementation detail: `writeYouTubeMetrics()` currently inserts the snapshot and returns the count of updated rows, but not the inserted snapshot IDs. This will need to be adjusted — either return the inserted IDs or run the Analytics update by matching `publishedVideoId + fetchedAt`.

---

## 6. Minimal Implementation Plan

Four steps. Each is independently deployable and each earlier step is a prerequisite for the next.

### Step A — Add scope to auth URL

**File:** `src/lib/social/youtube-api.ts`, `getYouTubeAuthUrl()`

Add `"https://www.googleapis.com/auth/yt-analytics.readonly"` to the scope array.

**Effect:** New channel connections and re-authorizations will get tokens that include the Analytics scope. Existing channels are unaffected until they re-authorize.

**Deploy this first.** It is a one-line change and has zero runtime risk — it only affects the OAuth consent screen URL.

---

### Step B — Add `fetchYouTubeAnalyticsMetrics()` function

**File:** New function in `src/lib/social/youtube-api.ts` (or new file `src/lib/social/youtube-analytics-api.ts`)

```typescript
// Pseudocode — not for implementation yet
async function fetchYouTubeAnalyticsMetrics(
  channelId: number,           // socialChannels.id
  videoIds: string[],          // platformVideoIds
  startDate: string,           // YYYY-MM-DD
  endDate: string,
): Promise<Map<string, { ctr: number | null; avgViewDurationSec: number | null; retentionPct: number | null; impressions: number | null }>>
```

Call `google.youtubeAnalytics({ version: "v2", auth: oauth2 }).reports.query(...)`. Parse response column headers dynamically (the API returns `columnHeaders` + `rows` rather than a typed object).

Return a Map keyed by video ID so the caller can match to snapshot rows.

**Graceful degradation:** If the token lacks the Analytics scope (403 `insufficientPermissions`), log a single `[analytics] channel ${channelId} missing yt-analytics.readonly scope — re-authorization required` warning and return an empty Map. Do not throw; the Data API sync must continue uninterrupted.

---

### Step C — Wire into `syncYouTubeAnalyticsAction()`

**File:** `src/actions/publishing-analytics.ts`

After `writeYouTubeMetrics()` writes Data API data and inserts a snapshot row, call `fetchYouTubeAnalyticsMetrics()` and update the snapshot row with CTR + retention:

```sql
UPDATE video_metric_snapshots
SET ctr = $1, avg_view_duration_sec = $2, retention_pct = $3, raw_json = raw_json || $4
WHERE published_video_id = $5 AND fetched_at = $6
```

The `||` (jsonb merge) appends Analytics fields to the existing Data API json in `raw_json` without overwriting.

**Quota note:** The Analytics API call is per-account (not per-video), runs once per sync cycle, and costs 1 unit per batch of ~40 videos. Add a separate error entry to `result.errors[]` if the Analytics fetch fails — it should not count as a video sync failure.

---

### Step D — UI notice for re-authorization

**File:** `src/components/channels/channel-manager-client.tsx` (the channel settings UI)

Add a warning banner on each YouTube channel row where `socialChannels.scope` does not contain `yt-analytics.readonly`. The banner should say: "CTR and retention data require re-authorization. Click Reconnect."

This uses the existing `scope` column that `connectYouTubeChannel()` already saves.

---

## 7. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Token regeneration blocks rollout** — existing channels get no CTR data until re-authorized | Medium | Graceful degradation in Step B; CTR columns stay null, existing views/likes sync unaffected |
| **Analytics data delay (24–72h)** — CTR for videos < 2 days old will show 0 or null | Low | Store null, not 0. Downstream feedback loop already reads the most recent snapshot, so stale null clears on the next sync |
| **`impressionClickThroughRate` requires ≥10 impressions** — small channels or new videos return 0 | Low | Treat 0 as null for CTR specifically; a 0% CTR is indistinguishable from "not enough data" |
| **Analytics API column order is not fixed** — the response returns `columnHeaders[]` + `rows[][]`; parsing must not assume column position | High | Parse by matching `columnHeaders[i].name` to extract values, never by index. This is non-obvious and is the most likely source of a silent data corruption bug |
| **Quota on re-auth scope change** — `prompt: "consent"` is already set in `getYouTubeAuthUrl()`, so users will see the consent screen again and may be confused | Low | Add a UI tooltip: "We need analytics permission to show CTR and watch time data" |
| **Legacy `app_config` client** — uploading through the legacy client is unrelated; does not need the analytics scope and should not be changed | Informational | No action needed |
| **Multiple GCP projects** — the app supports multiple `youtube_oauth_clients` rows. Each GCP project's OAuth consent screen must have the YouTube Analytics API enabled in Google Cloud Console | Medium | Document this in the re-auth instructions; a 403 from Analytics API may mean the API is not enabled in that GCP project, not just a scope issue |

---

## 8. Test Strategy

### Unit test: `fetchYouTubeAnalyticsMetrics()` response parsing

This is the highest-risk function. Test the column-header parsing logic with mocked API responses:

```typescript
// Mock response: columns in different orders (API does not guarantee order)
const mockResponse = {
  columnHeaders: [
    { name: "video" },
    { name: "averageViewPercentage" },
    { name: "impressionClickThroughRate" },
    { name: "averageViewDuration" },
    { name: "impressions" },
  ],
  rows: [
    ["dQw4w9WgXcQ", 45.2, 0.0823, 312, 15000],
    ["xvFZjo5PgG0", 38.7, null,   280, 800],   // null CTR (< 10 impressions)
  ],
};
// Assertions: videoId "dQw4w9WgXcQ" → ctr=0.0823, retentionPct=45.2, avgViewDurationSec=312
// Assertions: videoId "xvFZjo5PgG0" → ctr=null (API returns null for insufficient data)
```

### Integration test: scope detection

Add an assertion to the existing reliability test suite that verifies `fetchYouTubeAnalyticsMetrics()` returns an empty Map (not a throw) when called with a 403 `insufficientPermissions` error.

### Scope verification script

Extend `scripts/verify-thumbnail-text.ts` pattern: query `social_channels` where `platform = 'youtube'` and check whether `scope` contains `yt-analytics.readonly`. Report which channels need re-authorization.

```typescript
const channels = await db.query.socialChannels.findMany({
  where: eq(socialChannels.platform, "youtube"),
});
for (const ch of channels) {
  const hasScope = ch.scope?.includes("yt-analytics.readonly") ?? false;
  console.log(`  ${ch.name}: analytics scope ${hasScope ? "✓" : "✗ NEEDS RE-AUTH"}`);
}
```

### Smoke test against live API

After Step A is deployed and at least one channel is re-authorized:

1. Call `syncYouTubeAnalyticsAction({ force: true, limitVideos: 1 })`
2. Query the latest `video_metric_snapshots` row for that channel's most viewed video
3. Verify `ctr IS NOT NULL` and `ctr BETWEEN 0 AND 1`
4. Verify `avg_view_duration_sec > 0`
5. Verify `retention_pct BETWEEN 0 AND 100`
6. Check `raw_json` contains `impressions` key

### Quota monitoring

After first production run, check the Google Cloud Console API dashboard for `YouTube Analytics API` quota consumption. Expected: < 10 units per sync cycle for a channel with 50 videos.
