# Phase 5 Longform Engine Report

## Scope

Phase 5 tạo đầy đủ YouTube metadata package cho video long — không chỉ video file.
Input là topic + script. Output là title, description, chapters, tags, pinned comment, thumbnail intent, và metadata JSON.

Không thay đổi pipeline render hiện tại. Không breaking change.

## Deliverables

- `src/lib/longform-engine.ts` — core engine
- `src/actions/longform-engine.ts` — server action wrapper
- `scripts/phase5-longform-engine-test.ts` — test script (3 long video packages)
- `scripts/package-long-video.ts` — CLI standalone
- `docs/PHASE5_LONGFORM_ENGINE_REPORT.md` — file này

## Architecture

```
topic + script + outline + rawChapters + audioDurationSec
  → generateTitles()          # 10 titles, LLM score từng title
  → generateDescription()     # description 150–250 từ
  → generateTags()            # BASE_TAGS + 5 topic-specific tags
  → generatePinnedComment()   # 1 pinned comment tương tác
  → generateThumbnailIntent() # emotion + mainVisual + text + colorMood
  → buildTimestampedChapters()# chapters với timestamp từ audio duration
  → return LongformPackage JSON
```

### Title scoring (5 chiều)

| Chiều | Mô tả |
|---|---|
| curiosity | Gây tò mò, muốn click |
| clarity | Rõ ràng, dễ hiểu ngay |
| emotion | Chạm cảm xúc |
| searchPotential | Có từ khóa tìm kiếm |
| notClickbait | Không rẻ tiền, hợp Phật pháp (10 = hoàn toàn tốt) |

### Tags cơ bản (luôn có)

phật pháp, lời phật dạy, chữa lành, buông xả, nhân quả, vô thường, bình an, chiêm nghiệm, sống đẹp, tâm lý

## Test Results

Test ngày 2026-05-30, model: `google/gemini-2.5-flash` (OpenRouter).

### Pass rate: 3/3

| Topic | Best Title | Emotion | Thumb Text | Tags | Chapters |
|---|---|---|---|---|---|
| Khi người thân ra đi... | Khoảnh khắc mất mát, khoảnh khắc thức tỉnh | buon_ba | MẤT ĐI MỚI THẤY | 15 | 6 |
| Tại sao người im lặng... | Vì sao người ít nói lại thường sâu sắc? | binh_an | IM LẶNG HIỂU ĐỜI | 14 | 6 |
| Sống chậm lại... | Dừng lại, bạn đang bỏ lỡ gì? | hoi_tiec | BỎ LỠ ĐIỀU GÌ? | 15 | 6 |

### Sample output (topic 1)

**Title**: Khoảnh khắc mất mát, khoảnh khắc thức tỉnh

**Description** (preview):
> Cuộc sống đôi khi là những cuộc rượt đuổi không ngừng, cho đến khi một biến cố lớn ập đến, kéo bạn dừng lại. Và biến cố đó, thường là cái chết của một người thân yêu...

**Chapters**:
```
00:00 Mở đầu: Cú sốc thức tỉnh
01:59 Vỡ vụn: Khi mọi thứ đảo lộn
03:58 Thế giới thu nhỏ: Cái gì còn quan trọng?
05:57 Giá trị thật: Yêu thương và kết nối
07:55 Sống trọn vẹn: Bài học từ mất mát
09:54 Kết: Tìm thấy chính mình
```

**Pinned comment**: Khi trải qua mất mát, có điều gì đã thay đổi sâu sắc trong cách nhìn nhận cuộc sống của quý vị không? Hãy chia sẻ với chúng mình nhé.

## CLI Usage

### Chạy test
```bash
OPENROUTER_API_KEY=... SCRIPT_MODEL=google/gemini-2.5-flash LONGFORM_MODEL=google/gemini-2.5-flash \
  npm run test:phase5
```

### Tạo package cho 1 video cụ thể
```bash
npm run package:long -- \
  --topic "Khi người thân ra đi..." \
  --script output/scripts/my_script.txt \
  --video output/videos/my_video.mp4 \
  --thumbnail output/thumbnails/my_thumb.jpg \
  --duration 720 \
  --output output/packages/my_package.json
```

## Config

| Env var | Mặc định | Mô tả |
|---|---|---|
| `LONGFORM_MODEL` | `google/gemini-2.0-flash` | Model cho title/description/tags |
| `SCRIPT_MODEL` | `google/gemini-2.0-flash` | Model cho hook + script (dùng ở test) |
| `OPENROUTER_API_KEY` | — | Required |

**Lưu ý**: `google/gemini-2.0-flash` là ID cũ không còn hợp lệ trên OpenRouter. Cần dùng `google/gemini-2.0-flash-001` hoặc `google/gemini-2.5-flash`. Nên cập nhật default trong config/env.

## Test Output Location

`output/phase5/` — 3 JSON packages đầy đủ + 3 script text files + `summary.json`.

## Bottlenecks

- Chapter timestamps là **approximate** dựa trên word count / 2.8 wps chia đều cho sections. Khi có audio file thực, cần dùng audio duration thật.
- Model `google/gemini-2.0-flash` (ID cũ) trong default cần cập nhật thành `google/gemini-2.0-flash-001`.
- Upload lên YouTube chưa được thực hiện trong phase này (cần flag xác nhận riêng).
- Chapters chỉ được tạo nếu có `rawChapters` từ script engine. Nếu chỉ truyền script text thì chapters = [].

## Đề xuất Phase tiếp theo

Phase 6 — Observability & Data Loop: lưu metadata đầy đủ cho mọi video (topic, hook, script, title, thumbnail_text, paths, duration, render_time, model_used, status) và chuẩn bị field analytics.
