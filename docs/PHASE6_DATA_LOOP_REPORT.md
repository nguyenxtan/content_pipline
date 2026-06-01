# Phase 6 Observability & Data Loop Report

## Scope

Phase 6 thêm observability cho pipeline: mỗi video có một manifest JSON file đầy đủ,
DB schema có các field còn thiếu, và analytics fields được chuẩn bị sẵn để nhận dữ liệu thật
khi YouTube Analytics API được kết nối.

Không thay đổi pipeline render hay output hiện tại. Không breaking change.

## Deliverables

- `src/lib/video-manifest.ts` — manifest module (write, read, update analytics, list)
- `drizzle/0027_phase6_observability.sql` — migration
- `scripts/phase6-observability-test.ts` — test script
- `docs/PHASE6_DATA_LOOP_REPORT.md` — file này

## Schema Changes

### `content_generations` — thêm 3 columns

| Column | Type | Mô tả |
|---|---|---|
| `thumbnail_text` | `text` | Text đã render lên thumbnail |
| `render_time_total_ms` | `integer` | Tổng thời gian render pipeline (ms) |
| `main_model_used` | `varchar(100)` | Model dùng cho hook + script generation |

> Các field đã có sẵn trước Phase 6: `topic`, `shortSelectedHook`, `script`, `audioPath`,
> `videoPath`, `imagePaths`, `ttsDurationMs`, `imagesDurationMs`, `status`, `createdAt`,
> `nicheName`.

### `video_metric_snapshots` — thêm 4 columns

| Column | Type | Mô tả |
|---|---|---|
| `share_count` | `bigint` | Số lần chia sẻ |
| `ctr` | `numeric(6,4)` | Click-through rate (0.0000–1.0000) |
| `avg_view_duration_sec` | `integer` | Thời gian xem trung bình (giây) |
| `retention_pct` | `numeric(5,2)` | Phần trăm xem trung bình |

> Các field đã có sẵn: `view_count`, `like_count`, `comment_count`, `favorite_count`.
> CTR, retention, avg_view_duration cần YouTube Analytics API — chưa gọi trong phase này.

## Video Manifest

Mỗi video được ghi một file JSON tại `output/manifests/{id}.json`.

### Schema đầy đủ

```json
{
  "id": "uuid",
  "platform": "youtube | facebook | both",
  "videoType": "short | long",
  "createdAt": "ISO-8601",

  "topic": "",
  "nicheName": "",
  "hook": "",
  "script": "",
  "title": "",
  "thumbnailText": "",

  "imagePaths": [],
  "audioPath": "",
  "videoPath": "",
  "thumbnailPath": "",

  "durationSec": 0,
  "renderTimeTotalMs": 0,
  "mainModelUsed": "",
  "status": "",

  "analytics": {
    "views": null,
    "ctr": null,
    "avgViewDurationSec": null,
    "retentionPct": null,
    "likes": null,
    "comments": null,
    "shares": null,
    "fetchedAt": null
  }
}
```

### API module (`src/lib/video-manifest.ts`)

| Function | Mô tả |
|---|---|
| `writeVideoManifest(manifest)` | Ghi manifest JSON ra disk |
| `readVideoManifest(id)` | Đọc manifest theo ID |
| `updateManifestAnalytics(id, analytics)` | Cập nhật analytics vào manifest |
| `listManifests()` | Liệt kê tất cả manifests, sort by createdAt desc |
| `buildManifestFromGeneration(params)` | Build manifest từ DB row |

## Test Results

Test ngày 2026-05-30:

| Step | Kết quả |
|---|---|
| Write 5 manifests (3 shorts + 2 longs) | **5/5 OK** |
| Read-back và verify | **5/5 OK** |
| Update analytics (mock YouTube data) | **2/2 OK** |
| List all manifests | **5 found, sorted by date** |

### Sample manifest (short, sau khi update analytics)

```json
{
  "id": "test-short-001",
  "videoType": "short",
  "topic": "Sợ hãi mất mát",
  "hook": "Người ta thường chỉ thấy giá trị của điều gì khi đã mất đi.",
  "thumbnailText": "MẤT ĐI MỚI THẤY",
  "durationSec": 57,
  "renderTimeTotalMs": 72000,
  "mainModelUsed": "google/gemini-2.5-flash",
  "analytics": {
    "views": 12400,
    "ctr": 0.0712,
    "avgViewDurationSec": 48,
    "retentionPct": 84.2,
    "likes": 380,
    "comments": 45
  }
}
```

## CLI

```bash
# Chạy test
npm run test:phase6

# Đọc manifest thủ công
node -e "
const {readVideoManifest} = require('./src/lib/video-manifest');
console.log(JSON.stringify(readVideoManifest('video-id'), null, 2));
"
```

## Trạng thái Analytics Fields

| Field | Nguồn | Sẵn sàng? |
|---|---|---|
| views | YouTube Data API v3 | ✅ Đã có trong `publishedVideos.latestViewCount` |
| likes | YouTube Data API v3 | ✅ Đã có trong `publishedVideos.latestLikeCount` |
| comments | YouTube Data API v3 | ✅ Đã có trong `publishedVideos.latestCommentCount` |
| shares | YouTube Data API v3 | ⚠️ Cần thêm vào fetch logic |
| CTR | YouTube Analytics API | 🔒 Cần OAuth + Analytics API (chưa implement) |
| avg_view_duration | YouTube Analytics API | 🔒 Cần OAuth + Analytics API (chưa implement) |
| retention_pct | YouTube Analytics API | 🔒 Cần OAuth + Analytics API (chưa implement) |

## Bottlenecks & Notes

- Manifest file dùng `output/manifests/` (local disk). Nếu cần multi-machine thì cần chuyển sang DB hoặc object storage.
- `render_time_total_ms` cần được tính và lưu từ pipeline code khi gọi `writeVideoManifest`. Chưa có integration hook — cần thêm ở Phase 7 hoặc khi refactor pipeline.
- YouTube Analytics API (CTR, retention) cần scope `yt-analytics.readonly` riêng, chưa có trong OAuth flow hiện tại.

## Đề xuất Phase tiếp theo

Tất cả 6 phase đã hoàn thành. Các bước tiếp theo khả dĩ:
1. Integrate manifest write vào pipeline cuối (sau khi video render xong)
2. Kết nối YouTube Analytics API để điền CTR/retention thật
3. Dashboard đơn giản để xem manifest data (Phase 7 nếu cần)
