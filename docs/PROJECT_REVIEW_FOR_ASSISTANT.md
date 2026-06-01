# PROJECT REVIEW — Content Automation Pipeline
> Ngày review: 2026-05-30 | Reviewer: Claude Sonnet 4.6

---

## A. TỔNG QUAN REPO

### Repo đang làm được gì?

Hệ thống tự động hóa toàn bộ quy trình sản xuất video YouTube cho kênh nội dung **Phật pháp / chữa lành / chiêm nghiệm đời sống**, bao gồm:

- **Tạo nội dung**: LLM sinh topic → hook (30 ứng viên) → chọn hook tốt nhất → viết script
- **TTS**: chuyển script thành audio WAV qua VieNeu-TTS server (Python)
- **Ảnh**: LLM sinh prompt ảnh → FAL.ai (Flux model) render ảnh
- **Video**: FFmpeg dựng video từ audio + ảnh + subtitle ASS karaoke
- **Upload**: tự động lên lịch và đăng YouTube / Facebook Reels
- **Analytics**: theo dõi view/like từ YouTube & Facebook API
- **Scheduler**: cron job mỗi N phút/giờ, tự chạy toàn bộ pipeline

### Flow tổng quát: Topic → Video hoàn chỉnh

```
[Cron Job: content_gen]
        │
        ▼
suggestTopicsAction()          ← LLM gợi ý topic 1–4 từ (vd: "Tha thứ")
        │
        ▼
generateShortHooksAndScript()
  ├─ buildShortHookPrompt()    ← LLM sinh 30 hook ứng viên
  ├─ buildShortHookSelectionPrompt() ← LLM chấm điểm top 5 → winner
  └─ buildShortScriptFromHooksPrompt() ← LLM viết script 130–170 từ
        │
        ▼
DB: content_generations (status: completed)
        │
        ▼
[Cron Job: short_pipeline]
  ├─ runTTS()                  ← HTTP → VieNeu-TTS server → poll đến khi xong
  │       └─ output: media/audio/{id}.wav
  ├─ runImages()               ← LLM sinh prompt → FAL.ai × N ảnh
  │       └─ output: media/images/{id}/{0..n}.jpg
  └─ runShortVideo()
          ├─ getAudioDuration() ← FFmpeg probe
          ├─ whisperTimestamps() ← Python + Whisper (optional)
          ├─ silenceDetect()    ← FFmpeg silencedetect (fallback)
          ├─ buildSubtitleChunks() → .ass file
          ├─ FFmpeg render (libx264, crf 23, preset fast)
          └─ output: media/videos/{id}-short.mp4
                │
                ▼
        autoScheduleVideoAction()  ← tính slot upload
                │
                ▼
        upload_queue (status: queued, scheduledAt: T+...)
                │
                ▼
[Cron: processUploadQueueAction]
        └─ uploadToYouTube() / uploadToFacebookReel()
                │
                ▼
        published_videos (analytics record)
```

### Entry point chính

| Mục đích | File |
|---|---|
| Pipeline orchestrator | `src/actions/content-generator.ts` |
| Cron trigger | `src/app/api/cron/run/route.ts` |
| Short video render | `src/lib/pipeline/short-video.ts` |
| Long video render | `src/lib/pipeline/long-video.ts` |
| TTS | `src/lib/pipeline/tts.ts` |
| Images | `src/lib/pipeline/images.ts` |
| Long images + thumbnail | `src/lib/pipeline/long-images.ts` |
| Upload | `src/actions/social-channels.ts` |
| DB schema | `src/lib/db/schema.ts` |

### Chạy bằng lệnh gì?

```bash
npm run dev          # Khởi động Next.js dev server (port 3000)
# TTS server (riêng): cd tts-server && python server.py (port 8765)
# PostgreSQL: Docker container cp_postgres (port 5433)
# Cron: POST http://localhost:3000/api/cron/run  ← trigger thủ công hoặc hệ thống cron ngoài
```

---

## B. PIPELINE CHI TIẾT

### Short video (9:16, ≤60s)

```
topic (1–4 từ)
    ↓
[LLM] 30 hook ứng viên  (temp 0.95, ~700 tokens out)
    ↓
[LLM] Chấm điểm 4 tiêu chí → top 5 → winner  (temp 0.3, ~400 tokens)
    ↓
[LLM] Script 130–170 từ từ hook winner  (temp 0.75, ~450 tokens)
    ↓  DB insert (content_generations)
[TTS] VieNeu-TTS async → poll 15s interval → WAV file
    ↓  (sequential, sau TTS xong mới làm ảnh)
[LLM + FAL.ai] Image prompts → 3 ảnh 9:16  (sequential per image)
    ↓  (sequential, sau images xong mới render)
[FFmpeg] Probe audio duration
[Python/Whisper] Word timestamps  (optional, ~30–60s)
[FFmpeg] Silencedetect fallback
[ASS builder] Subtitle file
[FFmpeg] Render: images loop + audio + subtitle → mp4
    ↓
[FFmpeg] Extract thumbnail (1 frame)
    ↓
[DB] video_status = done
    ↓
upload_queue insert → scheduledAt
    ↓
[YouTube API / Facebook API] Upload
```

### Long video (16:9, 15–18 phút)

```
topic
    ↓
[LLM] Script 2000–2400 từ
    ↓
[TTS] → WAV (dài hơn đáng kể)
    ↓  song song với:
[LLM + FAL.ai] 5–7 landscape images 16:9
[LLM + FAL.ai] 1 thumbnail 1280×720  (model khác: claude-sonnet)
[LLM] SEO description tiếng Việt
    ↓
[FFmpeg] Render 15–18 phút
    ↓
[YouTube API] Upload
```

---

## C. BOTTLENECK HIỆN TẠI

### C1. TTS — Bottleneck lớn nhất

- **Async polling**: gửi job → poll mỗi 15 giây → timeout 25 phút
- **Blocking**: `runShortVideo()` phải đợi TTS xong hoàn toàn mới chạy
- **Không cache**: mỗi lần generate là 1 lần gọi TTS mới, kể cả script giống hệt nhau
- **Long video TTS** có thể mất 5–15 phút cho 2000+ từ

### C2. Images — 3 API calls tuần tự

- FAL.ai calls chạy **tuần tự** trong vòng lặp `for`
- 3 ảnh × ~3–8 giây/ảnh = 9–24 giây tổng
- **Không có parallel calls** dù hoàn toàn independent

### C3. TTS → Images tuần tự, không song song

```typescript
// src/actions/content-generator.ts (short_pipeline job)
const tts = await runTTS(id, "short", ttsVoice);   // đợi xong
const imgs = await runImages(id, imageCount, style); // mới bắt đầu
const vid = await runShortVideo(id);                 // mới bắt đầu
```
TTS và Images hoàn toàn **độc lập** nhưng đang chạy nối tiếp.

### C4. FFmpeg — Không có hardware acceleration

```typescript
// src/lib/pipeline/short-video.ts:308
"-c:v", "libx264",   // SOFTWARE encoder
"-preset", "fast",
"-crf", "23",
```
Máy M4 có **VideoToolbox** (Apple Silicon hardware encoder) nhưng chưa dùng. `h264_videotoolbox` nhanh hơn 3–5× so với `libx264 preset fast`.

### C5. Whisper — Python subprocess mỗi video

- Mỗi video short gọi 1 Python subprocess chạy Whisper
- Spawn Python interpreter + load model: ~3–5 giây overhead
- Không có model warm-up / persistent process

### C6. Batch size = 1

```
short_pipeline job: batch_size = 1
```
Pipeline xử lý **1 video tại 1 thời điểm**. Với Mac M4 16GB có thể chạy 2–3 song song.

### C7. Không có audio normalization

FFmpeg render không có `loudnorm` filter → volume không đồng đều giữa các video.

---

## D. RENDER VIDEO

### Công nghệ đang dùng

- **FFmpeg** (qua `@ffmpeg-installer/ffmpeg` npm package)
- `execFile()` wrapped bởi `promisify` → chạy trong Node.js process
- Không dùng MoviePy
- Timeout: 5 phút cho render chính

### Hardware acceleration: CHƯA dùng

| | Hiện tại | Có thể dùng trên M4 |
|---|---|---|
| Encoder | `libx264` (CPU) | `h264_videotoolbox` (GPU) |
| Decoder | Software | `videotoolbox` hwaccel |
| Speed | ~1× | ~3–5× |

Thêm `-hwaccel videotoolbox -c:v h264_videotoolbox` sẽ giảm render time đáng kể.

### Cache output trung gian: KHÔNG CÓ

- Mỗi lần `runShortVideo()` đều render lại từ đầu
- Không check xem video file đã tồn tại chưa (hoặc chỉ check status DB)
- Nếu render fail giữa chừng → phải render lại toàn bộ

### Có render lại không đổi không?

- Subtitle file được tạo mới mỗi lần (dù script không đổi)
- Cover ASS file tạo mới mỗi lần
- Whisper timestamps fetch mới mỗi lần

### Generate quá nhiều ảnh không?

- Short: 3 ảnh (config `numImages`, default 3) — hợp lý
- Long: 5–7 ảnh — hợp lý
- Không có deduplication/cache giữa các video cùng topic

### Resize/crop ảnh lặp lại?

- FFmpeg `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920` trong filter_complex
- Mỗi lần render đều scale lại — không pre-resize trước khi encode

---

## E. TTS

### Cách chạy

- **Async/polling**: POST `/tts/async` → nhận `job_id` → poll `/tts/status/{job_id}` mỗi 15s
- Chạy **toàn bộ script** một lần (không chia đoạn)
- Timeout tối đa: 25 phút

### Cache: KHÔNG CÓ

- Không hash nội dung script để tránh re-generate
- Nếu cùng nội dung được tạo 2 lần → 2 TTS calls

### Tái sử dụng audio: KHÔNG CÓ

- Mỗi content record có 1 audio file riêng
- Không tái sử dụng dù script giống nhau

### Output format

- `media/audio/{id}.wav` (short)
- `media/audio/{id}-long.wav` (long)
- WAV (lossless, dung lượng lớn hơn MP3)

### Normalize âm lượng: KHÔNG CÓ

- Không có `-af loudnorm` trong FFmpeg render
- Volume background music: 0.12 (hardcoded) — không cân đối với TTS

---

## F. THUMBNAIL

### Short video thumbnail

- **Cách hiện tại**: extract 1 frame từ video bằng FFmpeg (`-ss {thumbSec} -vframes 1`)
- `thumbSec`: 35% of first image duration, clamped 0.4–0.9s
- Đây là **frame từ video**, không phải thumbnail riêng
- Kết quả: chỉ là 1 frame tĩnh từ video, không có text overlay, không có branding

### Long video thumbnail

- **Riêng biệt hơn**: LLM (Claude Sonnet) sinh prompt → FAL.ai render ảnh 1280×720
- Có 4 style presets: dramatic, mystical, painterly, vivid
- Prompt có thể dựa trên nội dung script
- **Không có text overlay** trên thumbnail (số liệu, title text, face/person)

### Điểm yếu thumbnail

| Tiêu chí | Short | Long |
|---|---|---|
| Text tiếng Việt | ❌ Không có | ❌ Không có |
| Branding (logo, color) | ❌ Không | ❌ Không |
| Click-through optimization | ❌ | Partial |
| Font tiếng Việt | N/A | N/A |
| Readability check | ❌ | ❌ |
| Consistent style | ❌ Random frame | ✅ Style preset |
| Human face / emotion | ❌ | Partial (AI style) |

---

## G. SCRIPT & HOOK

### Hook pipeline (đã cải thiện)

- **Bước 1**: 30 hook ứng viên (LLM, temp 0.95) — persona Phật pháp, danh sách KHÔNG ĐƯỢC/BẮT BUỘC
- **Bước 2**: Chấm điểm 4 tiêu chí (tò mò/cảm xúc/gần gũi/giữ chân) → top 5 → winner
- **Bước 3**: Script dựa trên hook winner

### Phân biệt Shorts vs Long

- ✅ Short: 130–170 từ, hook-first, đời thường
- ✅ Long: 2000–2400 từ, kể chuyện, pháp thoại style
- ✅ Prompt template riêng biệt cho từng type

### Title/Description/Tags

- ✅ Long video: LLM sinh SEO description tiếng Việt
- ✅ YouTube metadata: `buildYouTubeVideoMetadata()` — title, description, tags
- ⚠️ Short video: title lấy từ topic + shortContent (không có LLM-generated title riêng)
- ❌ Chưa có tags tối ưu cho Shorts

### Kiểm tra độ dài script theo thời lượng

- ❌ Không có validation: script 170 từ có thể ra audio 60–90s (vượt limit Shorts)
- Short pipeline dùng `-t 60` trong FFmpeg để cắt cứng ở 60s
- Không warning nếu script quá dài → audio bị cắt giữa chừng

### Tránh kiểu văn AI chung chung

- ✅ Đã có `DISALLOWED_TOPIC_PATTERNS` trong code
- ✅ Prompt có danh sách cấm chi tiết (KHÔNG ĐƯỢC mở đầu bằng...)
- ⚠️ Chưa có post-generation validator để reject output nếu vi phạm

---

## H. SHORTS VS LONG VIDEO

| Tính năng | Short (9:16) | Long (16:9) |
|---|---|---|
| Resolution | ✅ 1080×1920 | ✅ 1920×1080 |
| Duration limit | ✅ 60s (FFmpeg -t) | Không giới hạn |
| Subtitle (ASS karaoke) | ✅ | ✅ |
| Subtitle style | ✅ 6 color presets | Minimal (margin 80px) |
| Whisper word timing | ✅ Optional | ✅ Optional |
| Background music | ✅ (0.12 vol) | ❌ Chưa có |
| Cover/intro overlay | ✅ 10s cover với title | ❌ Không có |
| Thumbnail | ❌ Frame extract | ✅ FAL.ai render |
| SEO description | ❌ | ✅ LLM generate |
| Chapter/timestamps | ❌ | ❌ |
| Script length check | ❌ | ❌ |

---

## I. CẤU TRÚC DỮ LIỆU

### Bảng `content_generations` (đầy đủ)

```typescript
// Core
id, topic, nicheId, nicheName, contentMode
script, shortContent, longContent
shortHookCandidates (jsonb), shortSelectedHook
totalTokens, totalCost, generationTime
status, errorMessage, createdAt

// Short pipeline
ttsStatus, ttsErrorMessage, audioPath, ttsDurationMs
imagesStatus, imagesErrorMessage, imagePaths, imagesDurationMs, imagesCostUsd
videoStatus, videoErrorMessage, videoPath

// Long pipeline
longTtsStatus, longTtsErrorMessage, longAudioPath, longTtsDurationMs
longImagesStatus, longImagesErrorMessage, longImagePaths, longImagesDurationMs, longImagesCostUsd
longThumbnailPath, longYoutubeDescription
longVideoStatus, longVideoErrorMessage, longVideoPath

// Upload
youtubeUploadStatus, youtubeUploadError, youtubeVideoUrl, youtubeScheduledAt
longYoutubeUploadStatus, longYoutubeUploadError, longYoutubeVideoUrl, longYoutubeScheduledAt
facebookUploadStatus, facebookUploadError, facebookVideoUrl

// Operations
isLocked, lockedAt, lockedBy
completedAt, mediaScheduledCleanAt, mediaCleanedAt
```

### Các trường còn thiếu (đề xuất thêm)

```typescript
// Chưa có trong schema:
shortVideoDurationSec    // thực tế duration video output
shortAudioDurationSec    // duration audio TTS
shortWordCount           // số từ shortContent
longVideoDurationSec
longAudioDurationSec
longWordCount
renderDurationMs         // thời gian FFmpeg render (short)
longRenderDurationMs     // thời gian FFmpeg render (long)
thumbnailPath            // short video thumbnail (hiện lưu riêng qua naming convention)
youtubeTitle             // title đã dùng khi upload (hiện chỉ lưu ở upload_queue)
youtubeTags              // tags đã dùng
```

---

## J. ĐỀ XUẤT ƯU TIÊN

### Priority 1 — Giảm render time, tiết kiệm chi phí

| # | Task | Impact | Effort |
|---|---|---|---|
| P1.1 | **Bật Apple Silicon hardware encoding** (`h264_videotoolbox`) trong FFmpeg render | Render nhanh 3–5× | Thấp (2 dòng code) |
| P1.2 | **Song song TTS + Images** thay vì tuần tự | Giảm ~50% thời gian pipeline | Thấp |
| P1.3 | **Song song 3 FAL.ai calls** thay vì tuần tự | Giảm ~65% image gen time | Thấp |
| P1.4 | **Cache TTS theo hash script** — không re-gen nếu script không đổi | Tránh call TTS thừa | Trung bình |
| P1.5 | **Tăng batch_size short_pipeline** từ 1 lên 2–3 | Tận dụng concurrency | Thấp |
| P1.6 | **Pre-resize ảnh** trước khi đưa vào FFmpeg | Giảm filter_complex load | Trung bình |

### Priority 2 — Cải thiện hook / script / thumbnail

| # | Task | Impact | Effort |
|---|---|---|---|
| P2.1 | **Thumbnail short video** có text overlay tiếng Việt (title + branding) | CTR cao hơn | Cao |
| P2.2 | **Validate độ dài script** → warning nếu script > 150 từ có thể bị cắt | Tránh audio bị cut | Thấp |
| P2.3 | **Post-generation validator** — reject script nếu câu đầu vi phạm KHÔNG ĐƯỢC | Chất lượng ổn định | Trung bình |
| P2.4 | **LLM-generated title cho Shorts** thay vì dùng topic | SEO tốt hơn | Thấp |
| P2.5 | **Audio loudnorm** trong FFmpeg (`-af loudnorm`) | Volume đồng đều | Thấp (1 dòng) |

### Priority 3 — Scale sản xuất hàng loạt

| # | Task | Impact | Effort |
|---|---|---|---|
| P3.1 | **Persistent Whisper server** thay vì spawn Python mỗi lần | Giảm 3–5s per video | Trung bình |
| P3.2 | **Queue-based parallel pipeline** — multiple content IDs process cùng lúc | 2–3× throughput | Cao |
| P3.3 | **Topic deduplication nâng cao** — semantic similarity check | Tránh nội dung lặp | Trung bình |
| P3.4 | **Multi-niche support** — nhiều kênh song song | Scale kênh | Trung bình |

### Priority 4 — Upload / Analytics

| # | Task | Impact | Effort |
|---|---|---|---|
| P4.1 | **Fix Facebook pipeline** (đang broken) | Mở lại kênh FB | Cao |
| P4.2 | **YouTube chapters/timestamps** cho long video | Watch time tốt hơn | Trung bình |
| P4.3 | **YouTube tags tối ưu** cho Shorts (trending tags) | Discovery | Thấp |
| P4.4 | **Analytics dashboard** — view/revenue tracking per video | Insight | Đang có partial |

---

## K. KẾ HOẠCH REFACTOR (nếu cần)

Code hiện tại không rối — cấu trúc pipeline khá rõ ràng. Vấn đề chính là **thiếu parallelism** và **thiếu hardware acceleration**, không phải architecture. Không cần refactor lớn.

Nếu scale lên multi-niche hoặc 20+ video/ngày, đề xuất tách:

```
src/lib/pipeline/
├── shared/
│   ├── ffmpeg.ts          # Shared FFmpeg utilities + hw detection
│   ├── cache.ts           # Hash-based cache manager
│   └── queue.ts           # Parallel job queue
├── short/
│   ├── tts.ts
│   ├── images.ts
│   ├── subtitle.ts
│   ├── render.ts          # FFmpeg render (hardware-aware)
│   └── thumbnail.ts       # Short thumbnail với text overlay
├── long/
│   ├── tts.ts
│   ├── images.ts
│   ├── thumbnail.ts       # FAL.ai thumbnail
│   └── render.ts
└── upload/
    ├── youtube.ts
    └── facebook.ts
```

---

## L. GHI CHÚ KỸ THUẬT QUAN TRỌNG

### FFmpeg binary

- Dùng `@ffmpeg-installer/ffmpeg` npm package (bundled binary)
- Binary này **không được build với VideoToolbox** trên macOS
- Để dùng hardware accel cần cài FFmpeg native: `brew install ffmpeg`
- Sau đó đổi `FFMPEG_PATH` sang `/opt/homebrew/bin/ffmpeg`

### TTS server

- Python server tại `tts-server/` (không trong repo Next.js)
- Venv: `~/venv-tts-new/bin/python3`
- Whisper script: `tts-server/whisper_timestamps.py`
- Port: 8765 (configurable qua `TTS_API_URL`)

### Database

- PostgreSQL 15, Docker container `cp_postgres`, port 5433
- Drizzle ORM với migrations tại `drizzle/`
- 19 tables, schema đầy đủ tại `src/lib/db/schema.ts`

---

## TỔNG KẾT: 10 PHÁT HIỆN QUAN TRỌNG

1. **FFmpeg dùng software encoder `libx264`** — M4 có VideoToolbox nhưng chưa dùng → render chậm không cần thiết
2. **TTS → Images → Video đang chạy tuần tự** — TTS và Images hoàn toàn độc lập, có thể chạy song song
3. **3 FAL.ai image calls chạy tuần tự** thay vì `Promise.all()`
4. **Không có TTS cache** — cùng script có thể bị re-generate nhiều lần
5. **Thumbnail short video chỉ là frame extract** — không có text, không có branding, CTR thấp
6. **Script length không được validate** — script dài có thể bị FFmpeg cắt cứng ở 60s
7. **Batch size = 1** trong short_pipeline — M4 16GB có thể xử lý 2–3 song song
8. **Không có audio normalization** (`loudnorm`) — volume không đồng đều giữa videos
9. **FFmpeg binary từ npm package không có VideoToolbox** — cần cài native FFmpeg qua Homebrew
10. **Topic suggestion đã fix** (1–4 từ thay vì tiêu đề YouTube dài) nhưng parser filter cũ đã remove
