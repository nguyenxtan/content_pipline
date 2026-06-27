# Facebook Queue Backlog Audit

Generated: 2026-06-04T12:58:00Z  
Mode: read-only audit only. No queue rows were modified. No files were deleted. No publish was triggered.

## Summary

Facebook pending backlog is the main reason production is paused.

Current snapshot:

- Total pending across all platforms: **96**
- Pending Facebook rows: **95**
- Facebook quote queued: **81**
- Facebook short/reel queued: **14**
- Facebook photo rows: **0** separate `videoType` rows found. Quote/photo is represented by `videoType = quote`.

Key finding:

- The backlog is **not** a media failure backlog.
- It is mostly an **old Facebook quote backlog**.
- All queued Facebook captions are valid after the current safe caption builder.
- All queued Facebook quote rows have an available source image:
  - original generated image: **22**
  - short-thumb fallback: **59**
  - missing: **0**
- All queued Facebook short/reel rows have video + audio assets available and are already published on YouTube.

## 1. Pending Queue Breakdown

| Group | Count |
|---|---:|
| Facebook quote queued | 81 |
| Facebook short/reel queued | 14 |
| Facebook total queued | 95 |
| Non-Facebook pending queued | 1 |
| All-platform pending total | 96 |

### By category

| Category | Count | Meaning |
|---|---:|---|
| `keep_and_publish` | 14 | healthy pending reels worth keeping |
| `safe_to_cancel_old_quote` | 67 | old quote rows with safe media/caption, but low priority and blocking throughput |
| `duplicate_or_low_value` | 14 | quote rows paired with the same content already queued as Facebook reel |
| `needs_media_repair` | 0 | no missing media/source image found |
| `unknown_review_needed` | 0 | no rows fell into an unclear state |

### Age distribution

By queue row created age:

| Age bucket | Count |
|---|---:|
| 24–72h | 8 |
| 3–7d | 87 |

By scheduled time distance from now:

| Distance bucket | Count |
|---|---:|
| <24h | 16 |
| 24–72h | 32 |
| 3–7d | 47 |

All 95 pending Facebook rows are still scheduled in the future. None are overdue.

## 2. Media, Caption, and Duplicate Risk

### Media availability

| Check | Result |
|---|---|
| Pending Facebook short rows with video file present | 14 / 14 |
| Pending Facebook short rows with audio file present | 14 / 14 |
| Pending Facebook quote rows with original image present | 22 / 81 |
| Pending Facebook quote rows using short-thumb fallback successfully | 59 / 81 |
| Pending Facebook quote rows with missing source image | 0 / 81 |

### Caption safety

| Check | Result |
|---|---|
| Invalid captions after `buildSafeFacebookCaption()` | 0 |
| Captions exceeding safe length | 0 |
| Broken Vietnamese tail after repair | 0 |

### Duplicate risk

| Risk | Count | Notes |
|---|---:|---|
| Duplicate topic rows | 28 | these are mostly short + quote pairs for the same content |
| Duplicate normalized caption rows | 0 | caption builder keeps them distinct enough |

Interpretation:

- Duplicate risk is driven by **same-content multi-format queueing**, not by broken caption generation.
- The 14 `duplicate_or_low_value` rows are all **quote rows** whose corresponding **reel rows are already queued** for the same content/topic.

## 3. YouTube Published Status

All 14 queued Facebook short/reel rows are already published on YouTube.

That means:

- these reels are not waiting on YouTube;
- they are safe to keep as Facebook-side distribution;
- cancelling them would remove actual cross-platform coverage, not just clutter.

Most queued Facebook quote rows are also tied to content already published on YouTube. They are optional distribution, not primary delivery.

## 4. Top 20 Oldest Queued Facebook Items

| Queue ID | Content ID | Type | Topic | Queue Age (h) | Scheduled (UTC) | YT Published | Image Source | Category |
|---|---|---|---|---:|---|---|---|---|
| `c5dd7dc5-3e8a-4e4a-bd3c-3d95488f24e9` | `675990ee-6f1e-4fc0-8d12-d717789e5796` | quote | Bị tổn thương | 77.9 | 2026-06-04T14:00:00.000Z | yes | original | safe_to_cancel_old_quote |
| `b761b93d-72cf-46ae-a0ed-6b87e006257d` | `b2b330b7-806d-4836-84e3-54158502f371` | short | Nỗi sợ thành công | 76.9 | 2026-06-05T01:00:00.000Z | yes | — | keep_and_publish |
| `0363ec19-5ee4-406e-9dbd-e594d6d16e30` | `b2b330b7-806d-4836-84e3-54158502f371` | quote | Nỗi sợ thành công | 76.9 | 2026-06-05T02:00:00.000Z | yes | original | duplicate_or_low_value |
| `cc5180f5-916f-40bc-bffb-dd10787f8b15` | `97808e6a-aa99-430e-a639-9aa64f07d6de` | short | Nỗi buồn không tên | 76.9 | 2026-06-05T03:00:00.000Z | yes | — | keep_and_publish |
| `918ce788-6989-4912-ac6b-9d2902d0dcbb` | `97808e6a-aa99-430e-a639-9aa64f07d6de` | quote | Nỗi buồn không tên | 76.9 | 2026-06-05T04:00:00.000Z | yes | original | duplicate_or_low_value |
| `16b8d715-57a0-4392-bc84-507f4275cc8a` | `87efd7ed-70a6-445a-9188-cbc21faec831` | short | Chần chừ | 76.9 | 2026-06-05T05:00:00.000Z | yes | — | keep_and_publish |
| `a30fc4f8-2d5d-41c1-a4cb-373d680a4da4` | `87efd7ed-70a6-445a-9188-cbc21faec831` | quote | Chần chừ | 76.9 | 2026-06-05T06:00:00.000Z | yes | original | duplicate_or_low_value |
| `44641fbd-bc44-4f85-88c0-bf6c3e1ed11f` | `60ab4944-5ca3-41ec-b300-9d1cd7ea1196` | quote | Nỗi cô đơn | 75.9 | 2026-06-05T07:00:00.000Z | yes | original | safe_to_cancel_old_quote |
| `252f007d-212e-4a45-9ddd-a34c6e8a0d85` | `0a24014f-2f80-4a80-99e6-2ee5b5bceea9` | short | Khát khao yêu thương | 75.8 | 2026-06-05T08:00:00.000Z | yes | — | keep_and_publish |
| `492c2bd0-fcfc-466c-b9bb-035c2e955db5` | `0a24014f-2f80-4a80-99e6-2ee5b5bceea9` | quote | Khát khao yêu thương | 75.8 | 2026-06-05T09:00:00.000Z | yes | original | duplicate_or_low_value |
| `d6bdd2d7-3eba-438e-90eb-c896ee14fb13` | `62f9c8c1-cef2-444d-896a-c585d9c009d0` | short | Sợ cô đơn | 75.8 | 2026-06-05T10:00:00.000Z | yes | — | keep_and_publish |
| `c7f2b148-3a6a-404c-a130-0ade40ac413b` | `62f9c8c1-cef2-444d-896a-c585d9c009d0` | quote | Sợ cô đơn | 75.8 | 2026-06-05T11:00:00.000Z | yes | original | duplicate_or_low_value |
| `2c7ecd02-d5ac-4e7d-99eb-6b01122fe9f2` | `ac597251-376d-4ef4-bf33-bc320d73ffe5` | short | Mất mát tình thương | 74.9 | 2026-06-05T12:00:00.000Z | yes | — | keep_and_publish |
| `696fb470-48e7-4df4-bdb5-133d30b95754` | `ac597251-376d-4ef4-bf33-bc320d73ffe5` | quote | Mất mát tình thương | 74.9 | 2026-06-05T13:00:00.000Z | yes | original | duplicate_or_low_value |
| `c0c595bc-6656-434e-aaad-5c04aca15613` | `f86006b4-5470-4a03-a442-27f37bd36aa9` | short | Sợ hãi mất kiểm soát | 74.8 | 2026-06-05T14:00:00.000Z | yes | — | keep_and_publish |
| `1933bb24-bf5a-49b1-8701-acb19d6b2a7e` | `f86006b4-5470-4a03-a442-27f37bd36aa9` | quote | Sợ hãi mất kiểm soát | 74.8 | 2026-06-06T01:00:00.000Z | yes | original | duplicate_or_low_value |
| `5e8cb549-d945-4af9-86e1-502821f3c5b8` | `20f391d8-efd9-45a9-8adf-979879637dbe` | short | Tìm kiếm bản thân | 74.8 | 2026-06-06T02:00:00.000Z | yes | — | keep_and_publish |
| `7b2aa338-e8cd-4ed3-9c33-3f382829b2d3` | `20f391d8-efd9-45a9-8adf-979879637dbe` | quote | Tìm kiếm bản thân | 74.8 | 2026-06-06T03:00:00.000Z | yes | original | duplicate_or_low_value |
| `82c61f0e-4d34-4aa9-85d2-0b14bb191c3f` | `3013c1b5-db20-4f8e-899d-a2cbc87dd7ad` | quote | Sợ bị tổn thương | 72.8 | 2026-06-06T04:00:00.000Z | yes | original | safe_to_cancel_old_quote |
| `c5d338be-d831-4954-9de5-7ef5c00223a3` | `6962bb6f-c136-4c52-866b-a994835ef2d0` | short | Mắc kẹt trong quá khứ | 72.6 | 2026-06-06T05:00:00.000Z | yes | — | keep_and_publish |

## 5. Category Logic

### `keep_and_publish`

Used for Facebook reels where:

- `videoType = short`
- local video exists
- local audio exists
- content is already published on YouTube

Current count: **14**

Interpretation: these are the highest-value remaining Facebook rows.

### `safe_to_cancel_old_quote`

Used for Facebook quote rows where:

- `videoType = quote`
- source image is available (`original` or `short_thumb_fallback`)
- caption is already safe
- content is already published on YouTube
- queue row is old enough to be stale operationally (`createdAge > 48h`)
- there is no paired reel row for the same content/topic in this category set

Current count: **67**

Interpretation: these are healthy but low-priority quote posts that mostly represent old distribution backlog.

### `duplicate_or_low_value`

Used for Facebook quote rows where:

- same content/topic already has a queued Facebook reel
- quote row adds more queue pressure than learning value

Current count: **14**

Interpretation: these are good review candidates, but not auto-safe by default if you still want quote coverage for every reel topic.

### `needs_media_repair`

Current count: **0**

No missing video, no missing audio, and no missing quote image source were found in the pending Facebook backlog.

## 6. Backpressure Impact

### If cancelling only `safe_to_cancel_old_quote`

- Current all-platform pending: **96**
- Safe cancellation count: **67**
- Pending after cancellation: **29**
- Backpressure result: **ALLOWED**

### If also cancelling `duplicate_or_low_value` after review

- Additional review-cancel candidates: **14**
- Pending could drop to: **15**

That second step is optional. The first 67 cancellations are already enough to unblock production.

## 7. Recommended Action

### Recommended now

1. **Keep all 14 Facebook short/reel rows.**
2. **Cancel the 67 `safe_to_cancel_old_quote` rows.**
3. **Review the 14 `duplicate_or_low_value` quote rows separately.**

This gives the cleanest operational result:

- production unblocks immediately;
- Facebook reel coverage remains intact;
- quote-post backlog stops dominating queue capacity.

### Why not keep all old quote rows?

Because:

- they are 3–7 days old;
- they add little operational value compared with reels;
- they are not blocked by media or caption issues;
- they are the direct reason queue depth is above the threshold.

## 8. Exact Safe Cancellation Criteria

For this backlog, a Facebook queue row is safe to cancel automatically only if **all** are true:

1. `platform = facebook`
2. `status = queued`
3. `videoType = quote`
4. content already has YouTube publish evidence
   - `youtube_video_url IS NOT NULL` or
   - matching `published_videos(platform = youtube)`
5. caption is valid after `buildSafeFacebookCaption()`
6. quote source image resolves successfully
   - original image exists, or
   - short-thumb fallback exists
7. queue row age is older than **48 hours**
8. row is not one of the explicitly retained Facebook reel rows
9. row has not already been published on Facebook

For this audit, those rules matched **67** rows.

## 9. Audit Conclusion

The Facebook backlog is mostly a **policy/scheduling backlog**, not a broken-content backlog.

What to do next:

- cancel **67** old quote rows first;
- keep the **14** reel rows;
- decide separately whether paired quote rows should continue to exist alongside reels.

This is enough to bring pending queue from **96** down to **29**, which should make production backpressure **ALLOWED** again.
