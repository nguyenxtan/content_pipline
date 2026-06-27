# Cleanup Eligibility Audit

Date: 2026-06-02

## Goal

Audit whether uploaded-asset cleanup is reading the correct upload-completion source.

The dry-run skip reasons were:

- `short_youtube_url_missing`: 37
- `facebook_video_url_missing`: 12

This audit compares:

- `content_generations`
- `upload_queue`
- `published_videos`
- platform/account tables

No cleanup code was changed during this audit.

## Data Sources

### `content_generations`

This table stores generated content state and convenience upload mirrors:

- YouTube short:
  - `youtube_upload_status`
  - `youtube_video_url`
- YouTube long:
  - `long_youtube_upload_status`
  - `long_youtube_video_url`
- Facebook Reel:
  - `facebook_upload_status`
  - `facebook_video_url`

Current DB counts:

| Field | Count |
|---|---:|
| total content rows | 113 |
| `youtube_video_url` present | 76 |
| `long_youtube_video_url` present | 0 |
| `facebook_video_url` present | 4 |
| `youtube_upload_status = done` | 76 |
| `facebook_upload_status = done` | 4 |
| both short YouTube URL and Facebook URL present | 3 |
| not cleaned (`media_cleaned_at is null`) | 52 |

### `upload_queue`

This is the strongest operational source for upload completion because it stores:

- `platform`
- `video_type`
- `status`
- `platform_video_id`
- `platform_video_url`
- `uploaded_at`

Current done rows:

| Platform | Type | Done Rows | URL Count | Uploaded At Count |
|---|---|---:|---:|---:|
| YouTube | short | 80 | 80 | 80 |
| Facebook | short/Reel | 4 | 4 | 4 |
| Facebook | quote/photo | 2 | 2 | 2 |

### `published_videos`

This is the strongest analytics-facing source. It stores the normalized published video/post rows:

- `platform`
- `video_type`
- `platform_video_id`
- `platform_video_url`
- `published_at`
- `content_id`
- `upload_queue_id`

Current rows:

| Platform | Type | Rows | URL Count | Published At Count | Content ID Count |
|---|---|---:|---:|---:|---:|
| YouTube | short | 77 | 77 | 77 | 76 |
| Facebook | short/Reel | 5 | 5 | 5 | 4 |
| Facebook | quote/photo | 2 | 2 | 2 | 2 |

### Platform-Specific Tables

`social_channels` and `platform_accounts` are account/channel identity tables. They are useful for knowing which account/channel owns a post, but they are not the canonical per-upload completion source.

No separate YouTube/Facebook platform-specific upload table was found beyond:

- `upload_queue`
- `published_videos`

## Code Write Paths

### YouTube

When YouTube upload succeeds:

- `upload_queue.status = done`
- `upload_queue.platform_video_url = res.videoUrl`
- `upload_queue.uploaded_at = now`
- `content_generations.youtube_upload_status = done`
- `content_generations.youtube_video_url = res.videoUrl`
- `published_videos` is upserted from `upload_queue`

So for YouTube short uploads, `content_generations.youtube_video_url` is a valid mirror.

### Facebook Reel

When Facebook Reel upload succeeds:

- `upload_queue.status = done`
- `upload_queue.platform_video_url = res.reelUrl`
- `upload_queue.uploaded_at = now`
- `content_generations.facebook_upload_status = done`
- `content_generations.facebook_video_url = res.reelUrl`
- `published_videos` is upserted from `upload_queue`

So for Facebook Reel uploads, `content_generations.facebook_video_url` is a valid mirror.

### Facebook Quote/Photo

When Facebook quote/photo post succeeds:

- `upload_queue.status = done`
- `upload_queue.platform_video_url = res.postUrl`
- `upload_queue.uploaded_at = now`
- `published_videos` is upserted from `upload_queue`

But it does **not** update:

- `content_generations.facebook_upload_status`
- `content_generations.facebook_video_url`

So `content_generations.facebook_video_url` is not a valid source for Facebook quote/photo posts.

## Mismatch Counts

Across all content:

| Mismatch | Count |
|---|---:|
| YouTube short done in `upload_queue`, URL present, but `content_generations.youtube_video_url` missing | 0 |
| YouTube long done in `upload_queue`, URL present, but `content_generations.long_youtube_video_url` missing | 0 |
| Facebook Reel done in `upload_queue`, URL present, but `content_generations.facebook_video_url` missing | 0 |
| Facebook quote/photo done in `upload_queue`, URL present, but `content_generations.facebook_video_url` missing | 2 |

For currently uncleaned rows only:

| Check | Count |
|---|---:|
| `content_generations.youtube_video_url` missing | 37 |
| YouTube URL missing in `content_generations` but present in `upload_queue` | 0 |
| YouTube URL missing in `content_generations` but present in `published_videos` | 0 |
| `content_generations.facebook_video_url` missing | 48 |
| Facebook URL missing in `content_generations` but present in `upload_queue` | 0 |
| Facebook URL missing in `content_generations` but present in `published_videos` | 0 |

Interpretation: the current dry-run skip reasons are real for currently uncleaned rows. The 37 missing YouTube URLs and 12 Facebook URL misses from the dry-run are not caused by cleanup reading the wrong table for those rows.

## Five Uploaded Content Examples

### 1. `701c2ba5-c485-44d7-b53b-abeb4d1c7a2a`

Topic: `Nghệ Thuật Vượt Qua Định Kiến: Hành Trình Khám Phá Sự Thật Vượt Trên Nhận Thức Hạn Hẹp`

| Source | YouTube | Facebook | Status Source |
|---|---|---|---|
| `content_generations` | `youtube_video_url = https://www.youtube.com/watch?v=0ChR8cbfIZQ` | `facebook_video_url = https://www.facebook.com/reel/959516466897520` | `youtube_upload_status = done`, `facebook_upload_status = done` |
| `upload_queue` | `platform=youtube`, `video_type=short`, `status=done`, URL present | `platform=facebook`, `video_type=short`, `status=done`, URL present | `uploaded_at` present for both |
| `published_videos` | YouTube short row exists | Facebook short/Reel row exists | `published_at` present for both |

### 2. `565a987a-31d1-4cfa-8103-7161c45c0b24`

Topic: `Tha thứ`

| Source | YouTube | Facebook | Status Source |
|---|---|---|---|
| `content_generations` | `youtube_video_url = https://www.youtube.com/watch?v=ZGTU1kc3F7c` | `facebook_video_url = https://www.facebook.com/reel/1023175710240260` | `youtube_upload_status = done`, `facebook_upload_status = done` |
| `upload_queue` | `platform=youtube`, `video_type=short`, `status=done`, URL present | `platform=facebook`, `video_type=short`, `status=done`, URL present | `uploaded_at` present for both |
| `published_videos` | YouTube short row exists | Facebook short/Reel row exists | `published_at` present for both |

### 3. `e61ba336-a521-43c6-a9d7-b0865d224ee3`

Topic: `Tiếc nuối`

| Source | YouTube | Facebook | Status Source |
|---|---|---|---|
| `content_generations` | `youtube_video_url = https://www.youtube.com/watch?v=nkJc3uqEroU` | `facebook_video_url = https://www.facebook.com/reel/2543033299501106` | `youtube_upload_status = done`, `facebook_upload_status = done` |
| `upload_queue` | `platform=youtube`, `video_type=short`, `status=done`, URL present | `platform=facebook`, `video_type=short`, `status=done`, URL present | `uploaded_at` present for both |
| `published_videos` | YouTube short row exists | Facebook short/Reel row exists | `published_at` present for both |

### 4. `f38a6de1-9804-47a7-872d-c118e8067612`

Topic: `Sợ bị lãng quên`

| Source | YouTube | Facebook | Status Source |
|---|---|---|---|
| `content_generations` | `youtube_video_url = https://www.youtube.com/watch?v=qX27QJmsXAU` | `facebook_video_url = null` | `youtube_upload_status = done`, `facebook_upload_status = pending` |
| `upload_queue` | `platform=youtube`, `video_type=short`, `status=done`, URL present | `platform=facebook`, `video_type=quote`, `status=done`, URL present | `uploaded_at` present for both |
| `published_videos` | YouTube short row exists | Facebook quote/photo row exists | `published_at` present for both |

This is a quote/photo case. `content_generations` does not mirror the Facebook upload even though `upload_queue` and `published_videos` show it is uploaded.

### 5. `58d0efe7-9031-470a-8712-fbdb3add92a5`

Topic: `Sợ thay đổi`

| Source | YouTube | Facebook | Status Source |
|---|---|---|---|
| `content_generations` | `youtube_video_url = https://www.youtube.com/watch?v=J3OcUzz1DRw` | `facebook_video_url = null` | `youtube_upload_status = done`, `facebook_upload_status = pending` |
| `upload_queue` | `platform=youtube`, `video_type=short`, `status=done`, URL present | `platform=facebook`, `video_type=quote`, `status=done`, URL present | `uploaded_at` present for both |
| `published_videos` | YouTube short row exists | Facebook quote/photo row exists | `published_at` present for both |

This is also a quote/photo case. The Facebook upload is real, but not mirrored into `content_generations.facebook_video_url`.

## Answer: Are Cleanup Checks Correct?

Current cleanup checks are correct for:

- YouTube short uploads
- Facebook Reel uploads
- currently uncleaned rows in this DB snapshot

Important decision: cleanup eligibility intentionally requires YouTube Short + Facebook Reel completion. Facebook quote/photo uploads do not count as Facebook video completion for media asset cleanup.

If that policy changes in the future, the stronger general eligibility source would be:

1. `upload_queue` rows with:
   - `status = done`
   - `platform_video_url is not null`
   - `uploaded_at` older than the safe delay
2. Or `published_videos` rows with:
   - matching `content_id`
   - `platform_video_url is not null`
   - `published_at` older than the safe delay

`content_generations` is best treated as a convenience mirror, not the canonical upload-completion source, because quote/photo Facebook posts do not update its Facebook URL/status fields.

## Why Dry Run Showed Those Skip Reasons

For currently uncleaned rows:

- `short_youtube_url_missing: 37` is genuine. Those rows also do not have matching done YouTube rows in `upload_queue` or `published_videos`.
- `facebook_video_url_missing: 12` is genuine for currently uncleaned rows. Those rows also do not have matching done Facebook rows in `upload_queue` or `published_videos`.

So the dry-run result is not currently hiding cleanup-eligible rows due to the wrong source.

The source mismatch exists historically for 2 Facebook quote/photo rows, but both already have `media_cleaned_at` set and are not part of the current cleanup candidate set.

## Recommendation

No change is required for the current cleanup policy: YouTube Short plus Facebook Reel only.

If cleanup policy later changes to include quote/photo posts, update cleanup eligibility to use `upload_queue` or `published_videos` as the canonical source rather than `content_generations.facebook_video_url`.

The safest future implementation would:

- Keep `content_generations` as a fast display mirror.
- Use `upload_queue` or `published_videos` for cleanup eligibility.
- Treat Facebook `video_type in ('short', 'quote')` as Facebook completion when the asset group being deleted is short assets.
- Preserve the 24-hour safe delay based on `uploaded_at` or `published_at`.
