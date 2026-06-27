# Publish Flow Audit — Quote Short / Real Video / Facebook Quote Photo

**Audit date:** 2026-06-15  
**Incident window:** từ ~15:00 VN (UTC 08:00) ngày 2026-06-15  
**Scope:** read-only — no code changed, no DB mutated  
**Constraints respected:** ADR-010, ADR-016, ADR-022

---

## Executive Summary

**Overposting confirmed** on **Facebook Trí Tuệ An Nhiên** (`channel_id = 6`, `channel_key = phat_phap`).

Từ khoảng UTC 10:18–10:55 ngày 2026-06-15 (= VN 17:18–17:55), pipeline xả ra **ít nhất 13 Facebook posts** trong ~37 phút — gồm ~7 `video_type=short` (Reel) và ~6 `video_type=quote` (ảnh). Tất cả đều có `scheduled_at = UTC 08:00` (= VN 15:00) nhưng được publish muộn hơn ~2 giờ do hàng đợi đã ngập. YouTube phat_phap (ch1) cũng bị ảnh hưởng nhẹ hơn: 4 YT short đăng liên tiếp trong 30 phút cho các slot từ VN 15:00 đến 17:00.

YouTube Tầng Sâu và các giờ trước VN 15:00 **bình thường** — 1 bài/giờ/kênh.

Nguyên nhân gốc rễ là **xung đột slot** do nhiều content item được gán cùng `scheduled_at`, kết hợp với processor chỉ xử lý 1 upload/platform/tick → hàng đợi tồn đọng rồi drain ồ ạt. Lỗi tương tự đã xảy ra ngày 2026-06-11 và được operator cancel thủ công (`skipped_by_operator_fb_backlog_clear`).

**Platforms bị ảnh hưởng:** Facebook (nghiêm trọng), YouTube phat_phap (nhẹ).  
**Platform bình thường:** YouTube Tầng Sâu.

---

## Current Pipeline Map

### Quote Short Generation Flow (formatType = `legacy_quote_short`)

```
contentGenerations (formatType=legacy_quote_short)
  → short_pipeline scheduler job
  → tạo video MP4 (âm nhạc + ảnh quote)
  → upload_queue (videoType='short', channelId = youtube_tang_sau OR youtube_gioi_dinh_tue)
  → processUploadQueueAction → YouTube upload
```

- **Không phải FB photo post.** Đây là video MP4 đăng lên YouTube Shorts.
- auto-refill-watcher tạo `legacy_quote_short` cho `youtube_tang_sau` và xen kẽ TTS/Quote cho `youtube_gioi_dinh_tue`.
- Khi đăng lên YouTube Giới Định Tuệ → `insertPhatPhapCampaignFbRow` tạo thêm:
  - 1 hàng FB short (Reel) tại `scheduledAt` của YT
  - 1 hàng FB quote (ảnh) tại `scheduledAt + 5 phút`

### Real Video / TTS Short Flow (formatType = `tts_short`)

```
contentGenerations (formatType=tts_short)
  → short_pipeline scheduler job
  → tạo video TTS + ảnh nền
  → upload_queue (videoType='short', channelId theo niche)
  → processUploadQueueAction → YouTube / Facebook upload
```

- phat_phap TTS short → YT Giới Định Tuệ (ch1); kèm FB Reel + FB quote photo.
- tang_sau TTS short → YT Tầng Sâu (ch10 / ch7); kèm paired FB Reel (tri_tue_an_nhien).

### Facebook Quote/Photo Flow (videoType = `quote`)

```
upload_queue (videoType='quote', channelId = 6 facebook_tri_tue_an_nhien)
  → processUploadQueueAction
  → Facebook Graph API photo post (không phải video)
```

- Được tạo bởi `insertPhatPhapCampaignFbRow` khi có YT phat_phap short.
- **Hoàn toàn tách biệt với `legacy_quote_short`** — không bị nhầm.
- Không được tạo bởi auto-refill-watcher (watcher chỉ tạo `videoType='short'`).

### Alternating Schedule Flow (schedule-mixer)

```
operator → bulkScheduleAction (manual)
  → getTakenTimesByDest → taken slots (chỉ ['queued','uploading'])
  → buildFormatSequence (alternate TTS/Quote)
  → insertScheduledRows → upload_queue
```

- Xen kẽ TTS/Quote cho các slot trống theo giờ.
- **Gap**: `getTakenTimesByDest` bỏ qua `status='done'` → slot đã publish không bị coi là bận.

---

## Incident Analysis Since 2026-06-15 12:00 +07

### Queue by Hour (Facebook channel_id=6, ngày 2026-06-15)

Dữ liệu từ `upload_queue` nhóm theo `hour_vn` (UTC+7):

| Hour VN | video_type | done | queued | cancelled | Ghi chú |
|---------|-----------|------|--------|-----------|---------|
| 07:00   | quote     | 1    | 0      | 0         | Bình thường |
| 07:00   | short     | 1    | 0      | 0         | Bình thường |
| 08:00   | quote     | 1    | 0      | 0         | Bình thường |
| 08:00   | short     | 1    | 0      | 0         | Bình thường |
| 09:00   | quote     | 1    | 0      | 0         | Bình thường |
| 09:00   | short     | 1    | 0      | 0         | Bình thường |
| ...     | ...       | ...  | ...    | ...       | 1/giờ bình thường |
| **15:00** | **quote** | **6** | **2** | **1** | ⚠️ Collision — 9 rows, 8 content IDs |
| **15:00** | **short** | **7** | **3** | **0** | ⚠️ Collision — 10 content IDs |
| 16:00   | short     | 1    | 0      | 0         | Draining tiếp |

> **Ghi chú timezone:** `scheduled_at` lưu dạng UTC. AT TIME ZONE output từ pg driver có thể hiển thị `.000Z` — đọc là UTC thực tế, cộng +7 để ra VN.

### Same-slot Collisions

```
Slot UTC 08:00 (= VN 15:00) | platform=facebook | channel_id=6:

  video_type=short  → same_slot_count = 10
  Content IDs: aad329d6, deaf7587, 1edadfaa, a3ed2e7b, dfe7ca4b,
               dff8c84a, a977958a, 36eeeed8, 19ed6429, a40169d9

  video_type=quote  → same_slot_count = 8 (1 đã cancelled)
  Content IDs: bc583b3d (cancelled), 36eeeed8, 19ed6429, a3ed2e7b,
               dfe7ca4b, a977958a, a32f0426, a40169d9
```

10 content items khác nhau cùng `scheduled_at = UTC 08:00`. Mỗi item chỉ có 1 row FB/content — dedup theo `content_id` hoạt động đúng. Vấn đề là **nhiều content item được assign cùng 1 slot**.

### Duplicate Candidates

Query `GROUP BY content_id, platform, channel_key, video_type HAVING COUNT(*) > 1` → **0 rows**.

Kết luận: ADR-022 dedup theo `content_id` hoạt động tốt. Không có content item nào bị nhân đôi. Lỗi là ở **slot timing dedup**, không phải content dedup.

### Published/Uploaded by Hour (published_videos, 2026-06-15 từ VN 05:00)

| Thời gian publish (UTC) | Platform | video_type | content_id | scheduled_at UTC | Trạng thái |
|------------------------|---------|-----------|-----------|-----------------|-----------|
| 00:00 | youtube/phat_phap | short | 1edadfaa | 00:00 | ✓ Normal |
| 00:00 | facebook/phat_phap | quote | 1edadfaa | 00:00 | ✓ Normal |
| 01:00 | facebook/phat_phap | short | f103c40c | 01:00 | ✓ Normal |
| 01:00 | youtube/tang_sau | short | qgen-mqd... | 01:00 | ✓ Normal |
| 01:02 | youtube/phat_phap | short | 19ed6429 | 01:00 | ✓ Normal |
| 02:00 | facebook/phat_phap | quote | f103c40c | 02:00 | ✓ Normal |
| ... | ... | ... | ... | ... | ✓ Normal 1/hr |
| **10:18** | **facebook/phat_phap** | **short** | 36eeeed8 | **08:00** | ⚠️ 2h late |
| **10:18** | **youtube/phat_phap** | **short** | dff8c84a | **08:00** | ⚠️ 2h late |
| **10:19** | **facebook/phat_phap** | **quote** | 36eeeed8 | **08:00** | ⚠️ 2h late |
| **10:19** | **youtube/tang_sau** | **short** | qgen-mqb7ud3f | **08:00** | ⚠️ |
| **10:20** | **facebook/phat_phap** | **short** | dff8c84a | **08:00** | ⚠️ |
| **10:20** | **youtube/phat_phap** | **short** | f103c40c | **08:00** | ⚠️ 2nd YT publish for this slot |
| **10:21** | **facebook/phat_phap** | **quote** | 19ed6429 | **08:00** | ⚠️ |
| **10:21** | **youtube/phat_phap** | **short** | f0aa5c39 | **09:00** | ⚠️ |
| **10:47** | **facebook/phat_phap** | **short** | aad329d6 | **08:00** | ⚠️ |
| 10:47 | youtube/phat_phap | short | cb9651c4 | 10:00 | (drain tiếp) |
| **10:48** | **facebook/phat_phap** | **short** | a3ed2e7b | **08:00** | ⚠️ |
| **10:49** | **facebook/phat_phap** | **quote** | a3ed2e7b | **08:00** | ⚠️ |
| **10:50** | **facebook/phat_phap** | **short** | dfe7ca4b | **08:00** | ⚠️ |
| **10:51** | **facebook/phat_phap** | **quote** | dfe7ca4b | **08:00** | ⚠️ |
| **10:52** | **facebook/phat_phap** | **quote** | a977958a | **08:00** | ⚠️ |
| **10:53** | **facebook/phat_phap** | **quote** | a32f0426 | **08:00** | ⚠️ |
| **10:54** | **facebook/phat_phap** | **short** | a977958a | **08:00** | ⚠️ |
| **10:55** | **facebook/phat_phap** | **short** | a40169d9 | **08:00** | ⚠️ |

**Tổng burst VN 17:18–17:55:** 13 Facebook posts + 5 YouTube posts trong ~37 phút.  
Tất cả FB burst items đều target `scheduled_at = UTC 08:00` (= VN 15:00) nhưng bị delay ~2h.

### Cron / Processor Risk

**Advisory lock** (`pg_try_advisory_lock(72400131)`) — **hoạt động đúng**. Không có dấu hiệu concurrent cron ticks.

**One-upload-per-platform-per-tick limiter** — hoạt động đúng. Đây chính là lý do burst drain theo từng phút thay vì tất cả cùng lúc.

**Interval throttle** (`upload_interval_deferred`) — hoạt động đúng cho từng platform+channel nhưng không ngăn được queue buildup vì mỗi lần defer chỉ push 1 item, các item còn lại vẫn ở hàng đợi.

**Gap:** Không có backlog cap — processor drain tất cả past-due items không giới hạn độ tuổi.

---

## Findings

### F-01 — Slot dedup loại trừ `status='done'` (Critical)

**Severity:** Critical  
**Code:** `src/lib/schedule-mixer.ts` (getTakenTimesByDest), `src/actions/social-channels.ts` (bulkScheduleAction taken array)  

```typescript
// schedule-mixer.ts — getTakenTimesByDest
where: and(
  inArray(uploadQueue.status, ["queued", "uploading"]),  // ← 'done' bị bỏ qua
  eq(uploadQueue.videoType, "short"),
  inArray(uploadQueue.channelId, allChannelIds),
)

// social-channels.ts — bulkScheduleAction taken array
inArray(uploadQueue.status, ["queued", "uploading"]),  // ← 'done' bị bỏ qua
```

**DB evidence:** 10 FB short + 8 FB quote content IDs khác nhau đều được assign `scheduled_at = UTC 08:00`. Dedup theo content_id hoạt động (0 duplicate candidates), nhưng dedup theo slot timing thì không.

**Why it matters:** Khi lịch mới được tạo cho ngày hôm sau, các slot đã có `done` rows (từ hôm trước hoặc từ batch trước) không bị tính là "bận". Scheduler tự do assign nhiều content item vào cùng slot.

**Safe fix direction (không implement ngay):** Thêm `'done'` vào taken-slot check trong `getTakenTimesByDest` và `bulkScheduleAction`. Cần xem xét kỹ vì phat_phap có pattern: cùng slot UTC, khác date (08:00 VN/ngày) → taken check cần có date scope rõ ràng.

---

### F-02 — Nhiều scheduling path độc lập không coordinate (High)

**Severity:** High  
**Code:** `src/lib/auto-refill-watcher.ts`, `src/actions/social-channels.ts` (bulkScheduleAction), `src/actions/social-channels.ts` (insertPhatPhapCampaignFbRow)

**Evidence:** 3 scheduling source cho FB phat_phap:
1. `auto-refill-watcher` (tự động, mỗi cron tick)
2. `insertPhatPhapCampaignFbRow` (triggered khi YT phat_phap short được schedule)
3. `bulkScheduleAction` (manual operator)

Mỗi source tự tính "free slots" độc lập dựa trên snapshot thời điểm chạy. Nếu 2 sources chạy gần nhau hoặc với stale state, cùng slot có thể bị claim 2 lần.

**Why it matters:** Không có single source of truth cho "slot này đã được dùng". Đặc biệt nguy hiểm khi operator chạy manual bulk schedule sau khi auto-refill đã chạy.

**Safe fix direction:** Thêm row-level lock (SELECT FOR UPDATE SKIP LOCKED) khi insert FB pair rows, hoặc thêm unique constraint trên `(channel_id, scheduled_at, video_type)` với partial index `WHERE status NOT IN ('cancelled')`.

---

### F-03 — Past-due items drain không giới hạn (High)

**Severity:** High  
**Code:** `src/actions/social-channels.ts` — processUploadQueueAction

```typescript
// Lấy TẤT CẢ items đã đến hạn, không giới hạn độ tuổi
.where(and(
  eq(uploadQueue.status, "queued"),
  lte(uploadQueue.scheduledAt, now),  // bất kỳ scheduled_at nào <= now
))
.orderBy(uploadQueue.scheduledAt)
.limit(25)
```

**Evidence:** 13 FB posts trong 37 phút — tất cả đều có `scheduled_at` quá hạn ~2 giờ. Processor drain hết mà không hỏi "item này có còn relevant không?"

**Why it matters:** Khi có queue backlog lớn, tất cả items past-due đều ngay lập tức eligible. Drain diễn ra ở tốc độ 1/platform/minute → 13 items = 13 phút minimum, nhưng thực tế 37 phút do interval throttle xen kẽ.

**Safe fix direction (không implement ngay):** Cân nhắc thêm `max_overdue_minutes` config — items quá hạn quá X phút (ví dụ 120 phút) có thể bị defer hoặc alert thay vì drain ồ ạt. Cần đánh giá kỹ để không bỏ lỡ content.

---

### F-04 — Pattern tái phát: operator đã cancel thủ công một lần (Medium)

**Severity:** Medium (operational risk)

**Evidence:** 
```sql
-- Row trong upload_queue:
created_at: 2026-06-11
error_message: 'skipped_by_operator_fb_backlog_clear'
status: 'cancelled'
channel_id: 6
```

Operator đã cancel hàng đọng FB ngày 2026-06-11 bằng thủ công. Pattern giống hệt nhau xảy ra lại ngày 2026-06-15.

**Why it matters:** Cancel thủ công là symptom fix, không phải root cause fix. Không có thay đổi code/logic giữa 2 lần → F-01 và F-02 sẽ tiếp tục sinh ra lỗi này.

---

### F-05 — Không có alert khi publish volume bất thường (Medium)

**Severity:** Medium  
**Code:** `src/app/api/cron/run/route.ts` — chỉ có alert khi cron lỗi hoặc cron gap

**Evidence:** Cron Telegram alert bắn khi `errors.length > 0` (upload errors) hoặc khi cron recovery gap. Không có alert khi 1 platform publish >N bài trong 1 khoảng thời gian ngắn.

**Why it matters:** Incident diễn ra ~37 phút mà không có alert. Phát hiện muộn = nhiều bài đã được đăng.

**Safe fix direction:** Thêm check trong processUploadQueueAction: nếu 1 platform đăng >3 items trong 1 cron run, gửi Telegram warning.

---

### F-06 — YT phat_phap ch1 cũng bị ảnh hưởng (Low)

**Severity:** Low (ít item hơn FB)

**Evidence:** 4 YT phat_phap shorts published liên tiếp UTC 10:18–10:47:
- dff8c84a, f103c40c: `sched_at=08:00 UTC` (= VN 15:00)
- f0aa5c39: `sched_at=09:00 UTC` (= VN 16:00)
- cb9651c4: `sched_at=10:00 UTC` (= VN 17:00)

YT YouTube có rate limit riêng nên ít rủi ro bị restrict hơn FB, nhưng vẫn gây gap trong lịch đăng tự nhiên.

---

## Recommended Next Step (P0/P1/P2 — no implementation)

### P0 — Ngay lập tức (trước cron tick tiếp theo)

- **Kiểm tra queue hiện tại** để xem còn bao nhiêu `status='queued'` FB items với `scheduled_at` đã qua. Nếu còn >2 items/slot, cân nhắc cancel thủ công phần thừa tương tự như 2026-06-11.
- **Verify** cron advisory lock vẫn hoạt động: xem log gần nhất không có `skipped: "cron_locked"` liên tục.

### P1 — Trong 1-2 ngày (fix cấu trúc nhỏ, không thay kiến trúc)

1. **Fix taken-slot dedup**: Thêm `'done'` vào filter trong `getTakenTimesByDest` (schedule-mixer) và `bulkScheduleAction` (social-channels). Cần giữ nguyên date scope (chỉ exclude done của cùng ngày/slot, không phải tất cả done của mọi ngày). Đây là fix nhỏ nhất có tác động lớn nhất.

2. **Add dedup constraint hoặc insert guard** trong `insertPhatPhapCampaignFbRow`: trước khi insert, kiểm tra xem đã có bất kỳ `status NOT IN ('cancelled')` row nào cho `(channel_id=6, scheduled_at, video_type)` chưa — kể cả các content_id khác. Hiện tại chỉ dedup theo `content_id` + channel + videoType.

3. **Add volume alert**: Nếu 1 cron run xử lý >3 uploads cho cùng 1 platform, gửi Telegram warning (không cần block upload).

### P2 — Trong 1 tuần (cải thiện observability)

- Thêm metric/log: mỗi cron run log số items per platform + số items per slot. Dễ trace khi có incident.
- Thêm cron run dashboard page (hiện đã có log table, cần thêm aggregation view).
- Cân nhắc `max_overdue_hours` soft cap trong processUploadQueueAction: items quá hạn >4h → alert + defer thay vì drain (cần tuning để không miss normal content).

---

## Appendix: Code References

| Component | File | Relevant Lines |
|-----------|------|---------------|
| Cron entry | `src/app/api/cron/run/route.ts` | L63-71 (advisory lock), L163-205 (job loop) |
| Upload processor | `src/actions/social-channels.ts` | processUploadQueueAction, ONE/platform/tick limiter |
| Slot dedup gap | `src/lib/schedule-mixer.ts` | getTakenTimesByDest — `['queued','uploading']` only |
| Bulk schedule gap | `src/actions/social-channels.ts` | bulkScheduleAction taken array — `['queued','uploading']` only |
| FB pair insert | `src/actions/social-channels.ts` | insertPhatPhapCampaignFbRow — dedup by contentId only |
| Auto-refill | `src/lib/auto-refill-watcher.ts` | getBusySlotTimesAcrossSiblings, insertQueueRows |
| Schema | `src/lib/db/schema.ts` | upload_queue (status, scheduled_at, channel_id, video_type) |

---

*Audit completed 2026-06-15. Read-only. No code or DB mutated.*
