# Reset And Reschedule Dry Run

Generated: 2026-06-04T12:53:41.972Z

## Scope

- Dry-run only. No queue rows were cancelled. No files were deleted.
- Published records, analytics snapshots, music library, docs, and `.env.local` are protected.
- Render-ready unpublished TTS shorts are intentionally protected as carry-forward candidates for the new alternating schedule.

## 1. Upload Queue Counts

| Platform | Video Type | Status | Count | Past Due | Future |
|---|---:|---:|---:|---:|---:|
| facebook | quote | cancelled | 2 | 2 | 0 |
| facebook | quote | done | 26 | 26 | 0 |
| facebook | quote | queued | 82 | 0 | 82 |
| facebook | short | cancelled | 2 | 2 | 0 |
| facebook | short | done | 23 | 23 | 0 |
| facebook | short | queued | 14 | 0 | 14 |
| youtube | short | done | 113 | 113 | 0 |

## 2. Content Generations Snapshot

- Total content rows: **126**
- Published or partially published rows: **108**
- Fully unpublished rows: **18**
- Rows with media already cleaned: **79**

### TTS Status

- `done`: 109
- `pending`: 17

### Image Status

- `done`: 109
- `pending`: 17

### Video Status

- `done`: 109
- `pending`: 17

## 3. Carry-Forward Protection

- Protected render-ready TTS candidates: **1**
- Resettable unpublished rows after protection: **17**
- Queued/uploading/error rows safe to cancel: **0**
- Resettable rendered rows contributing to backpressure: **0**

| Protected TTS Content | Topic | Created | Video | Audio |
|---|---|---|---|---|
| 99b7f393-37ea-4716-98a4-e6b8fc7d69c0 | Tìm kiếm sự chấp nhận | 20:22 1/6/26 | yes | yes |

## 4. Asset Audit For Resettable Unpublished Content

- Audio files: **0** (0 B)
- Video files: **0** (0 B)
- Image files: **0** (0 B)
- Cover files: **0** (0 B)
- Total resettable asset bytes: **0 B**

| Content ID | Topic | TTS | Images | Video | Audio Path | Video Path |
|---|---|---|---|---|---|---|
| f61f7627-95a0-4186-a593-3d0b37a45a32 | Chờ đợi hụt hẫng | pending | pending | pending | no | no |
| 3eb087fc-0fbe-4f5c-9ea2-e4b5ade633b0 | Tìm kiếm ý nghĩa | pending | pending | pending | no | no |
| 69ad72e8-c38c-4dac-b1d5-11f389b682a9 | Sợ hãi tương lai | pending | pending | pending | no | no |
| d279c32c-04be-4972-a42a-8da4024e26b9 | Mất phương hướng | pending | pending | pending | no | no |
| 7c43a859-cc12-419c-9391-3eeebd568f52 | Chấp nhận thực tại | pending | pending | pending | no | no |
| d467b576-37d2-4c89-8209-8a011b3d1e94 | Mong mỏi sự kết nối | pending | pending | pending | no | no |
| a0de49a5-a8d2-4e49-9a50-746533f603c9 | Buông xả tổn thương | pending | pending | pending | no | no |
| d7ad530a-cc3a-47c4-9868-b0034ba02901 | Mất niềm tin | pending | pending | pending | no | no |
| 146ad564-0e16-41ad-8d40-1bb58582335b | Nỗi đau mất mát | pending | pending | pending | no | no |
| 8ca3db9f-55c9-43c4-85d6-cf8adcb2912d | Nỗi sợ thất bại | pending | pending | pending | no | no |
| 45b70b76-af4e-4b4e-b8f2-d38f0438a742 | Tìm kiếm sự bình yên | pending | pending | pending | no | no |
| eea488b9-f909-4fb9-a6a0-b570d0d011a0 | Nỗi sợ bị ruồng bỏ | pending | pending | pending | no | no |
| 97fe3abb-0154-416d-a2ef-0e057f0bcab9 | Tìm kiếm sự tha thứ | pending | pending | pending | no | no |
| 9e80334b-032c-450e-b999-9455a00fc116 | Mất kết nối | pending | pending | pending | no | no |
| f8c52f6f-4824-43df-8f5d-5c99541db287 | Mất niềm vui | pending | pending | pending | no | no |
| 727efb87-7809-40f5-9293-add17dd04a58 | Sợ hãi sự thay đổi | pending | pending | pending | no | no |
| c10ff065-54c7-4e0f-916e-4d843cb47160 | Nỗi đau thất vọng | pending | pending | pending | no | no |

## 5. Safe To Remove / Cancel

- Queue rows safe to cancel: queued/uploading/error rows attached to fully unpublished content only.
- Assets safe to delete on execute: `media/audio/<contentId>.wav`, `media/videos/<contentId>-short.mp4`, `media/images/<contentId>/`, `media/covers/<contentId>-short-cover.jpg` for resettable unpublished content.
- Legacy Quote V1.5 batch is **not** included in delete scope because it is the source for the new alternating schedule.

### Output Artifacts Safe To Remove Manually

| Path | Size | Reason |
|---|---:|---|
| output/tts-debug | 30.7 MB | debug/verification artifact safe to remove manually |
| output/short-cover-intro-experiment | 6.1 KB | debug/verification artifact safe to remove manually |
| output/facebook-quote-style | 0 B | debug/verification artifact safe to remove manually |
| output/phase4 | 0 B | debug/verification artifact safe to remove manually |
| output/phase5 | 0 B | debug/verification artifact safe to remove manually |
| output/short-cover-hook | 0 B | debug/verification artifact safe to remove manually |
| output/short-cover-intro-batch | 0 B | debug/verification artifact safe to remove manually |
| output/social-image-enhancer | 0 B | debug/verification artifact safe to remove manually |

## 6. Must Keep

- `published_videos`
- `video_metric_snapshots`
- Historical YouTube import data
- `media/music`
- Analytics snapshots and docs
- `.env.local`

### Output Paths Explicitly Kept

| Path | Size | Reason |
|---|---:|---|
| output/legacy-quote-short-v1 | 56.3 MB | needed for alternating Legacy Quote schedule input |
| output/manifests | 2.6 KB | contains repo manifests |

## 7. Legacy Batch Readiness

- Legacy experiment samples found: **5**
- legacy-quote-v2-sample-01: Bình an từ chính chánh niệm -> output/legacy-quote-short-v1/legacy-quote-v2-sample-01-legacy-quote-short.mp4
- legacy-quote-v2-sample-02: Buông bỏ khổ đau -> output/legacy-quote-short-v1/legacy-quote-v2-sample-02-legacy-quote-short.mp4
- legacy-quote-v2-sample-03: Nhân quả không quên -> output/legacy-quote-short-v1/legacy-quote-v2-sample-03-legacy-quote-short.mp4
- legacy-quote-v2-sample-04: Từ bi chữa lành -> output/legacy-quote-short-v1/legacy-quote-v2-sample-04-legacy-quote-short.mp4
- legacy-quote-v2-sample-05: Đời nhẹ hơn khi biết đủ -> output/legacy-quote-short-v1/legacy-quote-v2-sample-05-legacy-quote-short.mp4

## 8. Capacity Impact Preview

- Current pending upload count: **96**
- Current failed upload count: **0**
- Current unpublished rendered count: **30**
- Current media total: **1.15 GB**

### Projected After Execute

- pendingUploadCount: **96**
- failedUploadCount: **0**
- unpublishedRenderedCount: **30**
- mediaTotalBytes: **1.15 GB (from 1.15 GB)**
- estimatedBytesFreed: **0 B**

## 9. Execute Safety

- Execute mode is opt-in only: `pnpm reset:unpublished-backlog:execute`.
- If any candidate shows published evidence during execute, the script aborts before deleting files.
- Execute mode cancels queue rows first, then deletes files, then marks reset rows with `status = cancelled` and `mediaCleanedAt`.

