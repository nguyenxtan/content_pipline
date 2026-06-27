# Docker DB Recovery and Queue Status — 2026-06-16

**Written:** 2026-06-16 20:25 VN (13:25 UTC)  
**Author:** Claude (automated operator recovery note)  
**Status:** Active drain in progress — watch only, no mutation needed

---

## Summary

| Item | Status |
|---|---|
| Docker Desktop | ✅ Running |
| cp_postgres (5433) | ✅ Healthy (Up ~6 min at check time) |
| cp_tts (8765) | ✅ Healthy |
| DB connectivity | ✅ OK — `content_pipeline` db accessible |
| `youtube_oauth_clients` table | ✅ Exists, 3 rows, all columns correct |
| `/settings/channels` | ✅ HTTP 200 (confirmed in dev log) |
| Cron | ✅ Draining — 10 rows done in last 7 min |
| DB time (UTC) | `2026-06-16T13:23:12Z` |
| DB time (VN) | `2026-06-16 20:23 Asia/Ho_Chi_Minh` |
| OS time (VN) | `Tue Jun 16 20:23:07 +07 2026` ✅ consistent |

---

## What Happened

**Root cause:** Docker Desktop stopped running at some point between the 2026-06-15 evening incident and 2026-06-16 morning. The `cp_postgres` container (which serves `content_pipeline` DB on port 5433) was taken down with it.

**Cascade:**
1. DB → `ECONNREFUSED` on port 5433
2. Drizzle/postgres-js in Next.js → all DB queries failed
3. `/settings/channels` server component threw 500 error → Next.js showed generic runtime error page (`"missing required error components, refreshing..."`)
4. `/api/cron/run` → failed to acquire pg advisory lock → returned 500 → no queue processing
5. `upload_queue` rows with `scheduled_at` in past accumulated with `status='queued'`

**Timeline (approximate):**
- ~2026-06-15 22:05 VN: Last known successful drain (slot VN 22:00/22:05 for "Sự im lặng đáng sợ" partially done)
- 2026-06-15 22:xx VN onwards: Docker went down — exact time unknown
- 2026-06-16 20:18 VN (13:18 UTC): Docker restarted (containers "Up 6 minutes" at 13:24 UTC)
- 2026-06-16 20:18 VN (13:18 UTC): Cron resumed drain

---

## What Is Fixed

| Component | Was | Now |
|---|---|---|
| Docker | Down | Up |
| cp_postgres | Down | Healthy |
| DB connection | ECONNREFUSED | OK |
| `youtube_oauth_clients` query | Failed | Returns 3 rows |
| `/settings/channels` | HTTP 500 | HTTP 200 |
| Cron | All 500 | HTTP 200, draining |
| Code/schema/migrations | No change needed | No change needed |

**No code was changed. No schema was modified. This was a pure infrastructure (Docker) outage.**

Migration `0022_youtube_oauth_clients.sql` was confirmed applied — table structure matches `src/lib/db/schema.ts:473` exactly.

---

## Current Queue State

**Snapshot at 2026-06-16T13:23 UTC (VN 20:23)**

| Metric | Value |
|---|---|
| Total queued | 37 |
| Overdue queued (past due) | 33 |
| Future queued | 4 |
| Currently uploading | 1 (be608970 youtube/phat_phap/short) |
| Active collisions | **0** |
| Overdue oldest | 2026-06-15T15:00 UTC (= VN 22:00) |
| Overdue newest | 2026-06-16T12:00 UTC (= VN 19:00) |

### Overdue breakdown by group

| Platform | Channel | Type | Overdue rows | Oldest (VN) | Newest (VN) |
|---|---|---|---|---|---|
| youtube | phat_phap | short | 12 | 2026-06-15 22:00 | 2026-06-16 16:00 |
| youtube | tang_sau | short | 5 | 2026-06-16 07:00 | 2026-06-16 19:00 |
| facebook | phat_phap | short | 11 | 2026-06-16 07:00 | 2026-06-16 16:00 |
| facebook | phat_phap | quote | 5 | 2026-06-15 22:05 | 2026-06-16 09:05 |

### All overdue rows (ordered oldest → newest)

```
be608970  youtube   phat_phap  short   UPLOADING  | 2026-06-15 22:00 VN | Sự im lặng đáng sợ
698147e2  facebook  phat_phap  quote   queued     | 2026-06-15 22:05 VN | Sự im lặng đáng sợ
122acbcc  youtube   phat_phap  short   queued     | 2026-06-16 07:00 VN | Chối bỏ cảm xúc
f9650d99  facebook  phat_phap  short   queued     | 2026-06-16 07:00 VN | Chối bỏ cảm xúc
1359a90f  youtube   tang_sau   short   queued     | 2026-06-16 07:00 VN | Một ý tưởng đúng lúc có thể thay đổ
7a564311  facebook  phat_phap  quote   queued     | 2026-06-16 07:05 VN | Chối bỏ cảm xúc
3ad2d795  youtube   tang_sau   short   queued     | 2026-06-16 08:00 VN | Điều mệt nhất không phải bận rộn mà
b0307dd0  youtube   phat_phap  short   queued     | 2026-06-16 08:00 VN | Sự bất công
c3ab9c8b  facebook  phat_phap  short   queued     | 2026-06-16 08:00 VN | Sự bất công
8d113e7e  facebook  phat_phap  quote   queued     | 2026-06-16 08:05 VN | Sự bất công
9caf2c75  youtube   phat_phap  short   queued     | 2026-06-16 09:00 VN | Ác nghiệp trong lặng im
4973e43c  youtube   tang_sau   short   queued     | 2026-06-16 09:00 VN | Bản ngã thích chiến thắng
4a87ecbf  facebook  phat_phap  short   queued     | 2026-06-16 09:00 VN | Ác nghiệp trong lặng im
5bfecf5d  facebook  phat_phap  quote   queued     | 2026-06-16 09:05 VN | Ác nghiệp trong lặng im
cce08c6b  facebook  phat_phap  short   queued     | 2026-06-16 10:00 VN | Bị cô lập
7127f967  youtube   phat_phap  short   queued     | 2026-06-16 10:00 VN | Bị cô lập
02d62aae  youtube   phat_phap  short   queued     | 2026-06-16 11:00 VN | Mất kết nối
bc4f8a09  youtube   tang_sau   short   queued     | 2026-06-16 11:00 VN | Tự do nhất là khi không còn phải đó
4ae96d70  facebook  phat_phap  short   queued     | 2026-06-16 11:00 VN | Mất kết nối
2126e4e7  youtube   phat_phap  short   queued     | 2026-06-16 12:00 VN | Chưa được chấp nhận
007e65bf  facebook  phat_phap  short   queued     | 2026-06-16 12:00 VN | Chưa được chấp nhận
7254c9ec  youtube   phat_phap  short   queued     | 2026-06-16 13:00 VN | Sự hối hận
1408491d  facebook  phat_phap  short   queued     | 2026-06-16 13:00 VN | Sự hối hận
420a7b70  youtube   tang_sau   short   queued     | 2026-06-16 13:00 VN | Có khi ta sống quá lâu trong phiên
38d5e8f2  facebook  phat_phap  short   queued     | 2026-06-16 14:00 VN | Mất mát yêu thương
cda0687f  youtube   phat_phap  short   queued     | 2026-06-16 14:00 VN | Mất mát yêu thương
1c126b6a  youtube   tang_sau   short   queued     | 2026-06-16 15:00 VN | Nhiều lựa chọn không làm ta tự do h
fbcbd5ec  youtube   phat_phap  short   queued     | 2026-06-16 15:00 VN | Sự phản bội chính mình
d5816bd7  facebook  phat_phap  short   queued     | 2026-06-16 15:00 VN | Sự phản bội chính mình
c6c7130b  facebook  phat_phap  short   queued     | 2026-06-16 16:00 VN | Mất mát tình yêu
055828e9  youtube   phat_phap  short   queued     | 2026-06-16 16:00 VN | Mất mát tình yêu
80a84386  youtube   tang_sau   short   queued     | 2026-06-16 17:00 VN | Một ý tưởng đúng lúc có thể thay đổ
392a2f13  youtube   tang_sau   short   queued     | 2026-06-16 19:00 VN | Sự im lặng đúng lúc nói nhiều hơn m
```

### Future rows (next 24h)

Slot: **2026-06-16 21:00 VN** (UTC 14:00)

```
3167a9a8  youtube   tang_sau   short  | Tự do nhất là khi không còn phải đó
3e3422bf  youtube   phat_phap  short  | Trả giá cho lỗi lầm (freshly generated)
b44186a3  facebook  phat_phap  short  | Trả giá cho lỗi lầm (freshly generated)
27192710  facebook  phat_phap  quote  | Trả giá cho lỗi lầm (freshly generated)
```

Rhythm đúng: YT+FB short at HH:00, FB quote at HH:05, 1 content group/hour ✅

### Drained since Docker recovery (13:00–13:25 UTC)

```
13:18  facebook  phat_phap  short   done | Buông bỏ quá khứ      ← incident row
13:20  youtube   tang_sau   short   done | Một ý tưởng đúng lúc  ← incident row
13:20  facebook  phat_phap  quote   done | Buông bỏ quá khứ      ← incident row
13:21  facebook  phat_phap  short   done | Nỗi đau phản bội
13:22  facebook  phat_phap  quote   done | Nỗi đau phản bội
13:23  youtube   tang_sau   short   done | Có khi ta sống quá lâu
13:23  facebook  phat_phap  short   done | Sự im lặng đáng sợ
13:24  facebook  phat_phap  quote   done | Sự im lặng đáng sợ
13:25  facebook  phat_phap  short   done | Chối bỏ cảm xúc
13:25  youtube   phat_phap  short   done | Chối bỏ cảm xúc
```

Rate: ~10 rows / 7 minutes ≈ 1.4 rows/min (1 YT + 1 FB per cron tick, alternating types).

---

## Risk Assessment

### Collision risk: NONE ✅
- 0 active slot collisions
- Each overdue row has a unique (slot, platform, channel, video_type) combination
- No duplicate content — `already_done_for_content = false` for all 33 rows
- This is a **backlog drain**, not a **slot collision** (different from June 15 incident)

### Overposting risk: MEDIUM ⚠️
- **Facebook:** ~16 FB posts remaining. At ~1 FB/minute rate → ~16 minutes of burst
- YT API quota used today: 3 uploads (well within daily quota)
- FB last 10 min: 7 posts — fast but each is unique content for a unique slot
- Root cause differs from June 15: this is delayed legitimate content, not same-slot collision overpost
- Facebook page may see ~16 posts in ~16 minutes, which could trigger soft rate-limiting or reduced distribution

### Comparison with 2026-06-15 incident

| Factor | June 15 incident | June 16 recovery |
|---|---|---|
| Root cause | Slot collision (10 items/slot) | Docker downtime backlog |
| FB posts in burst | 13 in 37 min | ~16 in ~16 min |
| Duplicate content? | No (content dedup worked) | No |
| Same slot collision? | YES (10 per slot) | NO (0 collisions) |
| Content variety | Same slots, different content | Different slots, different content |
| Action needed? | Operator manually cancelled | Drain continuing normally |

### Estimated recovery ETA
At 1.4 rows/min, 33 overdue rows → fully drained by **~2026-06-16 20:50 VN (13:47 UTC)**. Future rows at VN 21:00 will queue normally after backlog clears.

---

## Recommended Operator Action

**WATCH ONLY — No queue mutation needed.**

Cron is already draining correctly:
- No slot collisions
- No duplicate posts
- Each row is unique legitimate content
- Drain rate is stable at ~1.4 rows/min

If FB burst is a concern, operator may cancel remaining FB rows manually — but this is optional, not required. The content is legitimate backlog, not overposting.

**If operator wants to reduce FB burst** (optional), these are the remaining FB overdue rows:

```sql
-- Read-only check (do not execute without explicit approval):
SELECT id, scheduled_at, video_type FROM upload_queue
WHERE status = 'queued'
  AND platform = 'facebook'
  AND scheduled_at < NOW()
ORDER BY scheduled_at ASC;
```

Cancel command (requires explicit operator approval before running):
```sql
UPDATE upload_queue
SET status = 'cancelled',
    error_message = 'skipped_by_operator_docker_downtime_backlog',
    updated_at = NOW()
WHERE status = 'queued'
  AND platform = 'facebook'
  AND scheduled_at < '2026-06-16T07:00:00Z'  -- only rows from before VN 14:00
  AND id IN (/* paste specific IDs from read check */);
```

---

## Do Not Touch

- Scheduler code
- Cron code
- Upload processor code
- Working channel flows
- Docker volumes
- `upload_queue` rows (unless operator explicitly approves specific mutation above)

---

## Verification Commands Used (Read-Only)

```bash
# OS time
date

# Docker status
docker compose ps

# DB time
SELECT NOW() AS db_now_utc, NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh' AS db_now_vn;

# Queue totals
SELECT COUNT(*) FILTER (WHERE status='queued' AND scheduled_at < NOW()) AS overdue_queued, ...
FROM upload_queue;

# Overdue detail
SELECT uq.id, uq.platform, sc.channel_key, uq.video_type, uq.scheduled_at, cg.topic, ...
FROM upload_queue uq JOIN social_channels sc ... JOIN content_generations cg ...
WHERE uq.status='queued' AND uq.scheduled_at < NOW();

# Collision check
SELECT ... HAVING COUNT(*) FILTER (WHERE status='queued') > 1;

# Drain since recovery
SELECT ... WHERE status IN ('done','uploading') AND updated_at >= '2026-06-16T13:00:00Z';

# Quota check
SELECT COUNT(*) FILTER (WHERE platform='youtube' AND status='done' AND updated_at >= ...) FROM upload_queue;
```

---

*No code was changed. No DB rows were mutated. All checks are read-only.*

---

## Post-Recovery Reconciliation — 2026-06-16 20:36 VN (13:36 UTC)

### Live DB Time

```
DB UTC : 2026-06-16T13:36:32Z
DB VN  : 2026-06-16 20:36 Asia/Ho_Chi_Minh
OS VN  : Tue Jun 16 20:31:41 +07 2026
```

---

### Queue Health Summary (13:36 UTC)

| Metric | Value |
|---|---|
| Overdue queued | **7** (was 33 at 13:23 UTC — drain is working) |
| Future queued | **7** (4 for VN 21:00 + 3 invalid_grant retry night slots) |
| Errors | **3** (all youtube/phat_phap/short, `invalid_grant`) |
| Uploading | 0 |
| Done last 1h | 26 |
| Drain rate | ~2 rows/min (consistent since recovery) |

**Backlog ETA to clear:** ~3-4 more minutes from snapshot time.

---

### Error / Retry / Stale Uploading Rows

**No stale uploading rows.** 3 permanent error rows:

| queue_id | content_id | topic | sched (VN) | error |
|---|---|---|---|---|
| `be608970` | `747a07ac` | Sự im lặng đáng sợ | 2026-06-15 22:00 | `invalid_grant` |
| `b76622ec` | `86124423` | Buông bỏ quá khứ | 2026-06-15 20:00 | `invalid_grant` |
| `658f28c6` | `ff378092` | Nỗi đau phản bội | 2026-06-15 21:00 | `invalid_grant` |

**Root cause:** YouTube OAuth refresh token revoked/expired for **phat_phap channel (Giới Định Tuệ)**.
- `isTokenRevokedError("invalid_grant")` → tried `findAvailableYouTubeChannel` → no alt channel found → set `status='error'`
- `notifyChannelDisconnected()` + Telegram `❌ Lỗi đăng YouTube` already fired for each

**Each of these 3 content IDs has an additional NIGHT RETRY ROW** (created by the processor's alt-channel rotation path, then rescheduled to next available phat_phap YT slot):

| queue_id | content_id | topic | sched (VN) |
|---|---|---|---|
| `ec4a563f-6ee5-4def-bef5-91172aeb41f7` | `747a07ac` | Sự im lặng đáng sợ | 2026-06-17 **06:00** VN |
| `1b4c553d-acb5-49d7-a6d4-8eca32a5a89f` | `ff378092` | Nỗi đau phản bội | 2026-06-17 **07:00** VN |
| `1c718684-5fb6-4744-abdf-5a75ff22dacd` | `86124423` | Buông bỏ quá khứ | 2026-06-17 **08:00** VN |

⚠️ These will also fail with `invalid_grant` unless OAuth is fixed before VN 06:00 tomorrow.

---

### phat_phap Content Reconciliation (last 48h)

| content_id | topic | YT | FB | pubs | classification |
|---|---|---|---|---|---|
| `eeee860b` | Bị cô lập | ✓ | ✓ | 2 | OK |
| `90aeb728` | Mất kết nối | ✓ | ✓ | 2 | OK |
| `14449d75` | Ác nghiệp trong lặng im | ✓ | ✓ | 3 | OK |
| `3e64be92` | Chưa được chấp nhận | ✓ | ✓ | 2 | OK |
| `0236652f` | Sự hối hận | ✓ | ✓ | 2 | OK (draining) |
| `40a02378` | Sự bất công | ✓ | ✓ | 3 | OK |
| `4386b161` | Chối bỏ cảm xúc | ✓ | ✓ | 3 | OK |
| `36eeeed8` | Nỗi đau bị phản bội | ✓ | ✓ | 3 | OK |
| `26096f96` | Mất mát niềm tin | ✓ | ✓ | 3 | OK |
| `dff8c84a` | Mất lòng tự trọng | ✓ | ✓ | 2 | OK (FB quote cancelled from incident) |
| `cb9651c4` | Nỗi đau vô hình | ✓ | cancelled | 1 | Intentional (incident cleanup) |
| `f0aa5c39` | Nỗi đau bất công | ✓ | cancelled | 1 | Intentional (incident cleanup) |
| `c8e1db4d` | Mất mát yêu thương | queued | ✓ | 1 | Draining now |
| `d1286eeb` | Sự phản bội chính mình | queued | queued | 0 | Draining now |
| `9867c708` | Mất mát tình yêu | queued | queued | 0 | Draining now |
| `c321384c` | Trả giá cho lỗi lầm | future | future | 0 | Scheduled VN 21:00 |
| **`747a07ac`** | **Sự im lặng đáng sợ** | **error** | ✓ | 2 | **Class C — needs YT OAuth fix** |
| **`ff378092`** | **Nỗi đau phản bội** | **error** | ✓ | 2 | **Class C — needs YT OAuth fix** |
| **`86124423`** | **Buông bỏ quá khứ** | **error** | ✓ | 2 | **Class C — needs YT OAuth fix** |
| `0925534d` | Ác nghiệp không được quên | — | — | 0 | **Class D — `video_status=error`** (content pipeline failed, not queue issue) |

### tang_sau Content Reconciliation (last 48h)

All 4 tang_sau content items: YT ✓, 1 pub each. No issues. No FB pair expected (correct).

---

### Already Published Duplicates

**None.** All done rows match expected content/platform/channel/type combinations exactly.
- 3 content IDs with `error` YT rows have FB already published — the error rows are NOT duplicates, they're failed uploads.

---

### Telegram Notification Flow

**Events that send Telegram:**

| Event | Message | Per-item? | Blocks upload? |
|---|---|---|---|
| Cron gap recovery (>2.5× interval) | `⚠️ Cron đã khôi phục` | Once | No |
| YT quota auto-rotate | `🔄 Auto-rotate quota YouTube` | Per-item | No |
| YT quota exceeded (all channels) | `⏸ Hết quota tất cả kênh` | Per-item | No |
| YT permanent upload error | `❌ Lỗi đăng YouTube` | Per-item | No |
| FB auth failed (token expired) | `⚠️ Facebook cần cập nhật token` | Per-item | No |
| YT/FB channel disconnected | `⚠️ Kênh YouTube mất kết nối` | Per-item | No |
| Cron run has errors | `❌ Cron job thất bại` | Once/run (max 5 lines) | No |
| **Batch success** | **`✅ Đã đăng N video lúc HH:MM`** | **Once per cron run** | **No** |

**Key findings:**
- Telegram errors are swallowed in `try/catch` → **never block publishing** ✅
- No per-item success Telegram (correct)
- Batch summary fires `if (successCount > 0)` — **during backlog drain (~26 successful uploads in 30 minutes), this sends ~26 messages** ⚠️

**Spam risk during drain:**
- At 1.4 successful uploads/minute × 30 min drain = ~26-30 Telegram messages
- Each says `✅ Đã đăng 1 video lúc HH:MM` (N=1 since only 1 upload succeeded per cron run per platform limiter)
- Not catastrophic, but noisy. A cooldown or batch aggregation would reduce spam.

**Recommendation (do not implement without approval):**
- Add: if `successCount > 0 AND lastTelegramSuccessAt > (now - 5min)`, skip success Telegram
- Or: accumulate success count in DB/KV for the run window and send once every 5 minutes

---

### Current Publishing Flow Map

#### phat_phap channel group

```
content_generations (channel_key='phat_phap', format_type='tts_short')
  → short_pipeline job
  → tts audio → image generation → cover asset → short video render
  → upload_queue INSERT:
      - (platform='youtube', channel_id=1 [Giới Định Tuệ], video_type='short', scheduled_at=HH:00)
  → insertPhatPhapCampaignFbRow:
      - (platform='facebook', channel_id=6 [Trí Tuệ An Nhiên], video_type='short', scheduled_at=HH:00)
      - (platform='facebook', channel_id=6, video_type='quote', scheduled_at=HH:05)

processUploadQueueAction (per cron tick, 1 per platform):
  YouTube phat_phap short:
    → uploadToYouTube(channelId, videoPath, title, description, tags, ...)
    → if ok: update CG (youtubeVideoUrl, youtubeUploadStatus='done')
           + insert published_videos
           + sendTelegram batch summary
    → if invalid_grant: findAvailableYouTubeChannel → rotate OR set status='error'
    → if quota: findAvailableYouTubeChannel → rotate OR defer to next quota reset

  Facebook phat_phap short (Reel):
    → uploadToFacebookReel(channelId, videoPath, description)
    → if ok: update CG (facebookVideoUrl, facebookUploadStatus='done')
           + insert published_videos

  Facebook phat_phap quote (photo):
    → resolveFacebookQuoteImageSource → renderFacebookQuoteImage (Sharp)
    → uploadToFacebookPhotoPost(channelId, imagePath, message)
    → cleanup temp image
    → if ok: insert published_videos

Status mirrors:
  content_generations.youtube_video_url / youtube_upload_status
  content_generations.facebook_video_url / facebook_upload_status
```

#### tang_sau channel group

```
content_generations (channel_key='tang_sau', format_type='legacy_quote_short' or 'tts_short')
  → short_pipeline job
  → render short video
  → upload_queue INSERT:
      - (platform='youtube', channel_id=10 [Tầng Sâu canonical], video_type='short', scheduled_at=HH:00)
  → NO FB pair (tang_sau does not call insertPhatPhapCampaignFbRow)

processUploadQueueAction:
  YouTube tang_sau short:
    → uploadToYouTube(channelId=10, ...)
    → if quota exceeded: rotate to ch7 (backup) or defer
    → auto-refill watcher: checks tang_sau slot coverage, fills gaps
```

---

### Recommended Operator Actions

**⚡ Action 1 — CANCEL 3 night retry rows (pre-approved pattern, minimal risk)**

These rows will fail with `invalid_grant` at VN 06-08h tomorrow. Cancel them now.
Requires operator approval before execution.

```sql
-- SAFE: cancel 3 night retry rows for content already failed on YT OAuth
-- All 3 content IDs have FB already published (Reels + quotes done)
-- YT will be rescheduled separately after OAuth fix
UPDATE upload_queue
SET status = 'cancelled',
    error_message = 'cancelled_by_operator_invalid_grant_retry_not_needed_2026_06_16',
    updated_at = NOW()
WHERE id IN (
  'ec4a563f-6ee5-4def-bef5-91172aeb41f7',  -- Sự im lặng đáng sợ, VN 06:00 Jun 17
  '1b4c553d-acb5-49d7-a6d4-8eca32a5a89f',  -- Nỗi đau phản bội, VN 07:00 Jun 17
  '1c718684-5fb6-4744-abdf-5a75ff22dacd'   -- Buông bỏ quá khứ, VN 08:00 Jun 17
)
AND status = 'queued';
-- Expected: UPDATE 3
```

**⚡ Action 2 — FIX YouTube OAuth (operator action, in /settings/channels)**

Go to `/settings/channels` → YouTube Giới Định Tuệ → Re-authorize OAuth.
All 3 GCP project credentials may be affected (all returned no-alt-channel).
After re-authorization, verify by checking `social_channels.needs_reconnect = false`.

**⚡ Action 3 — REQUEUE YT rows after OAuth fix (requires operator approval)**

Only run AFTER confirming OAuth is working. Reschedule at proper VN daytime slots.

```sql
-- Run ONLY after OAuth is re-authorized and tested
-- Slot VN 09:00 Jun 17 (= UTC 02:00)
UPDATE upload_queue
SET status = 'queued',
    scheduled_at = '2026-06-17T02:00:00Z',
    error_message = 'rescheduled_by_operator_after_oauth_fix_2026_06_16',
    updated_at = NOW()
WHERE id = 'be608970-8742-4350-8d7c-def8107ba2f4'
  AND status = 'error';
-- Expected: UPDATE 1 (Sự im lặng đáng sợ)

-- Slot VN 10:00 Jun 17 (= UTC 03:00)
UPDATE upload_queue
SET status = 'queued',
    scheduled_at = '2026-06-17T03:00:00Z',
    error_message = 'rescheduled_by_operator_after_oauth_fix_2026_06_16',
    updated_at = NOW()
WHERE id = '658f28c6-c1ad-4663-bf4b-ce2e0e6c7ae7'
  AND status = 'error';
-- Expected: UPDATE 1 (Nỗi đau phản bội)

-- Slot VN 11:00 Jun 17 (= UTC 04:00)
UPDATE upload_queue
SET status = 'queued',
    scheduled_at = '2026-06-17T04:00:00Z',
    error_message = 'rescheduled_by_operator_after_oauth_fix_2026_06_16',
    updated_at = NOW()
WHERE id = 'b76622ec-d4b3-4b6d-86ec-b7058cc80d36'
  AND status = 'error';
-- Expected: UPDATE 1 (Buông bỏ quá khứ)
```

**⚠️ Action 4 — Investigate `0925534d` content pipeline failure (non-blocking)**

Content `0925534d` "Ác nghiệp không được quên" has `video_status=error`. Pipeline failed to generate the video. This is separate from queue/publishing. No queue rows, no publications.
Check `short_pipeline` job logs for this content_id to find the failure step.

---

### Do Not Touch
- Scheduler code
- Cron code
- Upload processor code (`processUploadQueueAction`)
- Docker volumes
- `upload_queue` rows not listed in the exact SQL plans above

---

*Reconciliation completed 2026-06-16 20:36 VN. All checks read-only. SQL plans printed but NOT executed.*

---

## Emergency Backlog Stop — 2026-06-16T13:47 UTC (VN 20:47)

### Context
Operator sent URGENT request to stop queue drain at ~13:36 UTC. Script execution was delayed by context compaction. When the script finally ran at 13:47 UTC, cron had already drained the full backlog on its own (39 rows done in ~24 minutes since Docker recovery).

### Outcome
- **overdue_queued = 0** — cron drained all 39 rows before script ran; no manual defer needed
- **3 invalid_grant retry rows CANCELLED**: `ec4a563f`, `1b4c553d`, `1c718684`
  - `error_message = 'cancelled_by_operator_invalid_grant_retry_not_needed_2026_06_16'`
- **0 collisions** in queue
- **4 clean rows remain for tonight** (VN 21:00–21:05):
  - `3167a9a8` youtube/tang_sau/short VN 21:00
  - `3e3422bf` youtube/phat_phap/short VN 21:00
  - `b44186a3` facebook/phat_phap/short VN 21:00
  - `27192710` facebook/phat_phap/quote VN 21:05

### Post-drain status
- 39 rows published successfully during drain window (13:23–13:47 UTC)
- 3 error rows remain: `be608970`, `b76622ec`, `658f28c6` (invalid_grant — do not touch until OAuth re-auth)
- Advisory lock acquired + released cleanly via single pg.Client

### Next actions (pending)
1. Fix YouTube OAuth `invalid_grant`: go to `/settings/channels`, re-authorize phat_phap channel (Giới Định Tuệ)
2. After OAuth fix: requeue 3 error rows at VN 09:00/10:00/11:00 on 2026-06-17
3. Investigate `0925534d` "Ác nghiệp không được quên" video_status=error (pipeline failure, separate issue)

---

## YouTube OAuth Re-authorization Verification — 2026-06-16T14:08 UTC (VN 21:08)

### DB time at verification
- UTC: 2026-06-16T14:05:47 UTC
- VN: 2026-06-16 21:05 VN (+7)

### Credential row status

| id | oauth_client_name | needs_reconnect | last_error | quota_exceeded_until | has_access_token | has_refresh_token | token_expires_at | updated_at | safe_candidate |
|----|-------------------|-----------------|------------|----------------------|------------------|-------------------|-----------------|------------|----------------|
| 1 | env (YOUTUBE_CLIENT_ID) | false | invalid_grant (STALE) | null | yes | yes | 14:24 UTC | 13:24 UTC | YES (verified) |
| 2 | GCP Project 1 | false | invalid_grant (STALE) | null | yes | yes | 14:25 UTC | 13:25 UTC | YES (verified) |
| 3 | GCP Project 2 | false | invalid_grant (STALE) | null | yes | yes | 14:25 UTC | 13:25 UTC | YES (verified) |
| 4 | GCP Project 3 | false | invalid_grant (STALE) | null | yes | yes | 14:25 UTC | 13:25 UTC | YES (verified) |

Note: `last_error='invalid_grant'` is STALE — all tokens verified live (see below).
Note: No row has `updated_at` after 13:25 UTC — no re-authorization reflected in DB.

### Re-authorization detection

No `social_channels` row for phat_phap YouTube was updated after 13:25 UTC.
The operator's re-authorization either:
a) Did not update DB (connectYouTubeChannel may have returned an error silently — known cause: Google account with multiple channels + no targetPlatformChannelId triggers early error return), OR
b) Was not needed — the tokens healed on their own (transient Google OAuth error during Docker startup window)

### Safe token verification (Step 4)

All 4 credentials tested via force `refreshAccessToken()` + `channels.list?mine=true`. No upload attempted.

| Row | Client | Refresh | channels.list | Channel ID match | Title |
|-----|--------|---------|---------------|-----------------|-------|
| 1 | env | ✅ PASS | ✅ PASS | ✅ UCRDTFiA408h3gzo85edXCcw | Giới Định Tuệ |
| 2 | GCP Project 1 | ✅ PASS | ✅ PASS | ✅ UCRDTFiA408h3gzo85edXCcw | Giới Định Tuệ |
| 3 | GCP Project 2 | ✅ PASS | ✅ PASS | ✅ UCRDTFiA408h3gzo85edXCcw | Giới Định Tuệ |
| 4 | GCP Project 3 | ✅ PASS | ✅ PASS | ✅ UCRDTFiA408h3gzo85edXCcw | Giới Định Tuệ |

### Upload target selection (Step 5 — read-only simulation)

If the 3 error rows are requeued:
- be608970 (channel_id=1): direct upload on row 1 (env) → if quota hit → rotates to row 2 (GCP Project 1, done_today=0)
- 658f28c6 (channel_id=1): same as above
- b76622ec (channel_id=4): direct upload on row 4 (GCP Project 3, done_today=0) → token valid
- Note: row 1 (env) has done_today=11 and is over Google quota. Rotation to row 2 will occur on first attempt.
- Recommend: requeue be608970 and 658f28c6 with channel_id=2 (GCP Project 1) to skip over-quota env client.

### Telegram alert

Not sent — verification PASS, no alert needed.

### Code issue flagged

`connectYouTubeChannel` (src/lib/social/youtube-api.ts) does NOT clear `last_error` when updating an existing row on re-authorization. After a successful re-auth, `last_error` stays as 'invalid_grant' indefinitely. This is misleading in the UI and in DB audits. Minor bug, separate fix.

### Verdict

**PASS** — All 4 phat_phap YouTube OAuth credentials are currently valid and return the correct channel.

### Next action

Safe to requeue the 3 failed YouTube rows. Recommended slot schedule:
- be608970 → VN 09:00 2026-06-17 (channel_id=2, GCP Project 1)
- 658f28c6 → VN 10:00 2026-06-17 (channel_id=2, GCP Project 1)
- b76622ec → VN 11:00 2026-06-17 (channel_id=4, GCP Project 3)
Clear `last_error` and `needs_reconnect` on each row at requeue time.

---

## YouTube Missed Upload Requeue — 2026-06-16T14:12 UTC (VN 21:12)

### DB time
- UTC: 2026-06-16T14:12:54
- VN: 2026-06-16 21:12

### Pre-update safety checks
- overdue_queued = 0 ✅
- collisions_48h = 0 ✅
- All 3 target rows confirmed: status=error, platform=youtube, video_type=short, channel_key=phat_phap ✅
- Published YouTube check: CLEAN (none of the 3 content_ids appear in published_videos for youtube) ✅
- Duplicate active queue check: CLEAN ✅

### Rows requeued

| Row | Topic | channel_id | OAuth Client | Slot (VN) | Slot (UTC) |
|-----|-------|-----------|-------------|-----------|-----------|
| be608970 | Sự im lặng đáng sợ | 2 | GCP Project 1 | 2026-06-17 09:00 | 2026-06-17T02:00:00Z |
| 658f28c6 | Nỗi đau phản bội | 2 | GCP Project 1 | 2026-06-17 10:00 | 2026-06-17T03:00:00Z |
| b76622ec | Buông bỏ quá khứ | 4 | GCP Project 3 | 2026-06-17 11:00 | 2026-06-17T04:00:00Z |

Rationale for channel selection: channel_id=1 (env) had done_today=11 (over conservative limit); channel_id=2 (GCP Project 1) and channel_id=4 (GCP Project 3) had done_today=0.

### Stale auth flags cleared
- social_channels ids 1,2,3,4 (all phat_phap YouTube rows): last_error set to NULL ✅
- needs_reconnect unchanged (all were false)

### Post-update verification
- be608970: status=queued, channel_id=2, VN 09:00 Jun-17, error_message=NULL ✅
- 658f28c6: status=queued, channel_id=2, VN 10:00 Jun-17, error_message=NULL ✅
- b76622ec: status=queued, channel_id=4, VN 11:00 Jun-17, error_message=NULL ✅
- overdue_queued = 0 ✅
- collisions_48h = 0 ✅

### Tonight observations (non-blocking, auto-handled by cron)

**27192710** (facebook/phat_phap/quote, originally VN 21:05):
- Rescheduled by cron to VN 22:00 with error_message='Dời lịch để giữ khoảng cách 60 phút'
- This is expected 60-minute-gap enforcement behavior, not an error

**3167a9a8** (youtube/tang_sau/short, originally VN 21:00):
- Failed with "The user has exceeded the number of videos" (YouTube per-channel daily upload count limit)
- Auto-deferred by cron to VN Jun-17 15:00 (UTC Jun-17 08:00)
- Channel Tầng Sâu may have hit daily upload count limit from today's backlog drain
- Not related to OAuth; resolves itself at tomorrow's quota reset

### Next 30h schedule (at time of verification)
- VN Jun-16 22:00 — youtube/phat_phap/short "Chờ đợi sự thấu hiểu"
- VN Jun-16 22:00 — facebook/phat_phap/short "Chờ đợi sự thấu hiểu"
- VN Jun-16 22:00 — facebook/phat_phap/quote "Trả giá cho lỗi lầm" (deferred 27192710)
- VN Jun-16 22:05 — facebook/phat_phap/quote "Chờ đợi sự thấu hiểu"
- VN Jun-17 09:00 — youtube/phat_phap/short "Sự im lặng đáng sợ" ← requeued
- VN Jun-17 10:00 — youtube/phat_phap/short "Nỗi đau phản bội" ← requeued
- VN Jun-17 11:00 — youtube/phat_phap/short "Buông bỏ quá khứ" ← requeued
- VN Jun-17 15:00 — youtube/tang_sau/short "Tự do nhất là khi không còn" (auto-deferred)

### Remaining risks
1. **3 requeued rows** will upload via GCP Project 1 (rows be608970, 658f28c6) and GCP Project 3 (b76622ec). If oauth refresh fails again, rotation has rows 3 (GCP Project 2) as fallback. All tokens verified live at 14:05 UTC.
2. **tang_sau daily upload limit**: 3167a9a8 deferred to tomorrow — may need monitoring if tang_sau has other scheduled content tomorrow.
3. **connectYouTubeChannel** bug: does not clear last_error on re-auth. Manually cleared now. Will recur on next invalid_grant incident. Consider fixing separately.
4. **env client (channel_id=1)** is over API quota (16,500/10,000 units reported earlier today). Rotation to GCP Project rows is active and working.
