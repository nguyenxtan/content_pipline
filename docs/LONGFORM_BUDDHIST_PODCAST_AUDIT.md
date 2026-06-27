# Long-form Buddhist Podcast Audit
**Date:** 2026-06-12  
**Scope:** Evaluate readiness to produce Buddhist/philosophy long-form videos  
**Method:** DB performance data, pipeline code audit, cost modeling  
**Rule:** Read-only audit. No code changes.

---

## Executive Summary

**The long-form pipeline is structurally complete and has never been triggered.**

All 298 content items in the DB already have `long_content` (long scripts) generated. Zero have `long_video_path`. The code chain — script → TTS → images → video assembly → thumbnail → upload — exists end-to-end. The bottleneck is not missing infrastructure; it is an untriggered pipeline and a visual approach that doesn't yet match the desired "meditative podcast" style.

The current pipeline produces a 5-image slideshow at 1920×1080. The desired style is a single premium static background with subtle ambient motion (smoke, particles, gentle Ken Burns). That ambient animation layer does not yet exist in the codebase. Everything else is ready.

**Recommendation:** Start with one 10-minute Buddhist long-form video using the existing pipeline as-is. Use a single premium Flux Pro Ultra background with a slow Ken Burns pass (a 5-second zoom over 10 minutes). This is implementable with one minor change to `long-video.ts` (not a refactor). The smoke/particle layer is a Phase 2 enhancement.

---

## 1. Current Long-form Pipeline Status

### What already exists

| Stage | File | Status | Notes |
|-------|------|--------|-------|
| Long script generation | `src/lib/script-engine.ts` | ✅ DONE (298 scripts exist) | Multi-stage: hook → outline → opening → sections → closing |
| Long TTS | `src/lib/pipeline/tts.ts` | ✅ CODE READY | `runTTS(id, "long")` sends full `longContent` as one job |
| Long image generation | `src/lib/pipeline/long-images.ts` | ✅ CODE READY | 5 images default; flux/dev for landscape; flux-pro-ultra for thumbnail |
| Thumbnail generation | `src/lib/pipeline/long-images.ts` | ✅ CODE READY | Separate model, separate LLM prompt |
| Long video assembly | `src/lib/pipeline/long-video.ts` | ✅ CODE READY | Slideshow mode (N images × even duration) or solid background mode |
| Subtitle generation | `src/lib/video/subtitle.ts` | ✅ CODE READY | Whisper word timestamps → chunk-based ASS subtitles |
| Long metadata | `src/lib/longform-engine.ts` | ✅ CODE READY | Title candidates, scoring, description, tags, pinned comment |
| Upload queue | `src/lib/db/schema.ts` | ✅ CODE READY | `video_type = 'long'` supported in upload_queue |

### What does NOT exist

| Feature | Impact | Effort |
|---------|--------|--------|
| TTS chunking for long scripts | Risky for 2000-word scripts (25-min timeout possible) | Medium |
| Single-background ambient animation (smoke, particles) | Missing the "meditative podcast" visual feel | Medium |
| Ken Burns on a single image (not slideshow) | Pipeline does slideshow, not slow-zoom-one-image | Low |
| Chapter timestamps in video (for YouTube chapters) | Nice-to-have, not blocking | Low |
| Long video specific upload API route | Must verify `/api/video/long/run/route.ts` works end-to-end | Low |

### DB State

```
298 content items:
  - long_content populated:  298 (100%)
  - long_video_path:           0 (0%)
  - long_audio_path:           0 (0%)
  - long_image_paths:          0 (0%)
  - long_thumbnail_path:       0 (0%)
```

Every content item has a long script ready. Nothing has ever been rendered to video.

---

## 2. Best Topics from Performance Data

### Methodology

Scored topics by: views ≥ 200, retention ≥ 55%, emotional depth, Buddhist/philosophy angle, and repeatability of the theme across multiple shorts (signal of audience affinity).

### Top 10 Long-form Candidates

| # | Topic (Short) | Views | Retention | Why suitable | Suggested long title | Angle |
|---|--------------|-------|-----------|--------------|---------------------|-------|
| 1 | **Tha thứ / Buông xả tổn thương** | 971–895 | 74–58% | Most recurring theme; 4+ shorts; emotional depth; Buddhist principle | *Nghệ Thuật Tha Thứ: Buông Gánh Nặng 10 Năm Trong 10 Phút* | Forgiveness as liberation, not weakness; storytelling with real-life examples |
| 2 | **Có những người nói rất nhiều nhưng không ai hiểu họ** | 1,557 | 71.9% | Highest retention + views in sample; universal emotional truth; storytelling potential | *Khi Không Ai Hiểu Bạn: Hành Trình Tìm Lại Chính Mình* | Loneliness beneath social performance; Buddhist teaching on attachment to being understood |
| 3 | **Sách hay không dạy ta sống, chỉ giúp ta thôi sống hời hợt** | 1,012 | 105.8% | Highest retention%; philosophy + wisdom angle; rare "book/learning" entry in top 30 | *Đọc Gì Không Quan Trọng Bằng Đọc Như Thế Nào: Triết Học Cho Người Bận Rộn* | Contemplative reading vs consumption; wisdom vs information |
| 4 | **Hạnh phúc bắt đầu từ bên trong tâm trí** | 574 | 310.2% | Extraordinarily high retention (watch time >> video duration); core Buddhist topic | *Bình Yên Từ Bên Trong: 5 Sự Thật Phật Giáo Về Hạnh Phúc Thật Sự* | Inner happiness vs external approval; practical Buddhist framework |
| 5 | **Có khi ta sống quá lâu trong phiên bản người khác mong muốn** | 1,424 | 81.0% | Very high views + good retention; identity/authenticity; relatable for urban Vietnamese | *Bạn Đang Sống Cho Ai: Khi Nào Ta Mới Dừng Đóng Vai Người Khác?* | Breaking free from social masks; Buddhist self-nature teaching |
| 6 | **Thiền Nguyên / Tỉnh Thức** | 388 | 101.3% | Retention > 100% = strong replays; meditation + spiritual practice; premium content | *Thiền 10 Phút Mỗi Ngày Có Thể Thay Đổi Gì? Khoa Học Và Phật Giáo Cùng Nói* | Meditation evidence + Buddhist practice; guided feel |
| 7 | **Nhân quả / Tiểu nhân đắc chí** | 452–981 | 69–72% | Karma cluster consistently performing; moral clarity; very Vietnamese Buddhist audience | *Nhân Quả Có Thật Không? Góc Nhìn Phật Giáo Và Tâm Lý Học Về Hành Động* | Karma as cause-and-effect psychology, not superstition |
| 8 | **Một phút lặng thinh / Im lặng đúng lúc** | 321–148 | 98–630% | Silence-themed videos have exceptional replay rates; meditative podcast niche | *Sức Mạnh Của Im Lặng: Phật Giáo Dạy Gì Về Nghệ Thuật Không Nói* | Silence as spiritual practice; practical guidance |
| 9 | **Nỗi lo lắng** | 1,337 | 75.6% | High views + solid retention; anxiety is the #1 driver for this channel's audience | *Lo Âu Không Phải Kẻ Thù: Phật Giáo Và Tâm Lý Học Về Cách Sống Với Sợ Hãi* | Anxiety as a signal, not a flaw; Buddhist impermanence + acceptance |
| 10 | **Mất lòng tin / Phản bội** | 704–857 | 58–59% | Strong view count cluster; betrayal → forgiveness arc; emotionally sticky | *Khi Bị Phản Bội: Con Đường Từ Vết Thương Đến Trí Tuệ* | Betrayal as a teaching; Buddhist non-attachment to loyalty |

### Topics NOT suitable for long-form yet

| Topic | Reason |
|-------|--------|
| Tìm kiếm sự chấp nhận (1,501 views, no retention) | No retention data yet; may be views-driven without depth |
| Trả giá vì tham lam (1,695 views, no retention) | No retention data; may be a one-time spike |
| Topics with < 2 published samples | Insufficient signal for long-form investment |
| Tầng Sâu philosophy topics (secular channel) | Separate channel brand; long-form Buddhist content should not cross channels |

---

## 3. Short → Long Expansion Strategy

### Family A: Forgiveness / Letting Go (highest ROI)

This is the single most repeated high-performer. Strong signal across 4+ shorts.

**10-minute version:**  
*Nghệ Thuật Tha Thứ — Buông Gánh Nặng Để Bước Tiếp*  
- Hook (1 min): "Có người bạn đã tha thứ mà vẫn cảm thấy cõi lòng nặng nề. Vì sao?"  
- Story (2 min): A relatable betrayal scenario (no names); the person who could not let go  
- Teaching (3 min): Buddhist distinction between forgiveness and forgetting; the two levels of release  
- Examples (2 min): Historical example (Buddha & Devadatta) + modern analog  
- Reflection (1 min): Guided contemplation — "Điều gì bạn chưa thật sự buông?"  
- Closing lesson (1 min): "Tha thứ không phải cho họ — mà là để tâm bạn được nhẹ"  

**20-minute version:**  
Add: neuroscience of holding grudges + deeper story arc with 3 characters + mindfulness exercise  

**30-minute version:**  
Add: guided forgiveness meditation (5 min), chapter on forgiving yourself vs others, Q&A format  

---

### Family B: Inner Happiness / Calm Mind

**10-minute version:**  
*Hạnh Phúc Thật Sự Không Đến Từ Bên Ngoài — Phật Giáo Dạy Điều Này*  
- Hook: "Bạn đã từng có đủ mọi thứ mà vẫn thấy trống không chưa?"  
- Story: A successful person at the peak of achievement who felt nothing  
- Teaching: The Three Buddhist sources of happiness (Dana, Sila, Bhavana)  
- Examples: Practical daily exercises for each source  
- Reflection: "Hôm nay bạn sống vì điều gì?"  
- Closing: Call to inner stillness as a daily practice  

---

### Family C: Silence / Mindfulness as Spiritual Practice

**10-minute version:**  
*Khi Ta Dừng Lại: Phật Giáo Và Nghệ Thuật Sống Chậm*  
- Hook: "Người ta nói hãy sống chậm. Nhưng chậm có nghĩa là gì?"  
- Story: A person who "paused" and what they discovered  
- Teaching: Mindfulness as attention, not emptiness  
- Examples: 3 concrete moments to practice silence daily  
- Reflection: "Lần cuối bạn thật sự lắng nghe tiếng lòng mình là khi nào?"  
- Closing: Peace is a practice, not a destination  

---

## 4. TTS Long-form Audit

### Current architecture

```
runTTS(contentId, "long")
  → item.longContent (full 2000-word script)
  → normalizeTextForTTS()
  → POST /tts/async { text: fullScript, ... }
  → poll every 15s up to 25 minutes
  → normalizeAudioWithLoudnorm()
  → injectPunctuationPauses() (Whisper-backed)
  → single output .wav file
```

### Risk assessment

| Factor | Short scripts | Long scripts | Risk level |
|--------|--------------|--------------|------------|
| Text length | ~300 words | ~2000 words | HIGH |
| TTS server timeout | Rarely triggered | 25-min max; VieNeu may time out at 7× load | HIGH |
| Whisper alignment | 30-50 words | 300-400 words | MEDIUM — alignment can degrade over long audio |
| Punctuation pause injection | Reliable | ~50-80 insertions; FFmpeg filter_complex grows | MEDIUM |
| Cache hit rate | High (scripts repeat) | Low (each long script is unique) | LOW risk |
| Audio duration expected | 30-90 seconds | 8-15 minutes | — |

### Critical gap: no chunking

The pipeline sends the entire long script as a single TTS call. For a 2000-word script at ~130 words/minute Vietnamese speech rate, expected audio duration is **15–18 minutes**. VieNeu-TTS was designed for short content (60-120 seconds). Sending 15 minutes of text in one call is an untested risk. The poll timeout is 25 minutes — barely enough.

### Recommended approach

Split the script into paragraph-based chunks before TTS submission:

```
Script (2000 words)
  → Split by paragraph (empty line or period-newline)
  → 10–14 chunks × ~140–200 words each
  → TTS each chunk (parallel, 3 concurrent max)
  → Normalize each chunk audio
  → Merge with 0.4s silence gaps between paragraphs
  → Total assembled audio file
```

This is not currently implemented. For the first MVP, test submitting the full script — the 25-min timeout may be sufficient. If VieNeu-TTS times out, chunking becomes required before any long video can be produced.

**Safe first-test approach:** Use a 600-word "short long" script (4-5 minutes) for the first long video attempt. This stays well under TTS risk threshold.

---

## 5. Visual System Audit

### Current long-form visual pipeline

| Setting | Current default | Notes |
|---------|----------------|-------|
| Background image model | `fal-ai/flux/dev` | $0.025/image, 28 steps, landscape_16_9 |
| Thumbnail model | `fal-ai/flux-pro/v1.1-ultra` | $0.060, premium quality |
| Image count | 5 | One image per `audioDuration / 5` seconds |
| Video mode | Slideshow — each image displayed for equal duration | Static, no Ken Burns |
| Ken Burns | NOT IMPLEMENTED | Only short video pipeline has zoompan |
| Ambient overlays | NOT IMPLEMENTED | No smoke, particles, leaf, lantern |
| Background resolution | 1920×1080 (landscape_16_9) | Correct for long-form |
| Buddhist style options | cinematic, watercolor, vintage | All landscape styles |
| Thumbnail style options | dramatic, mystical, painterly, vivid | All pre-defined |

### Gap analysis for "Buddhist podcast" visual

| Desired feature | Current state | Gap |
|----------------|--------------|-----|
| Single premium master background | Can use 1 image with `numImages=1` | ✅ trivial config change |
| Buddhist temple / incense / golden light | Buddhist landscape style prompts exist | ✅ already supported |
| Realistic cinematic photography style | "cinematic" style in `BUDDHIST_LANDSCAPE_STYLES` | ✅ exists |
| Very subtle Ken Burns on single image | NOT in long-video.ts | ❌ needs FFmpeg zoompan added |
| Incense smoke overlay | NOT in codebase | ❌ needs smoke asset or FFmpeg gen |
| Dust/light particle overlay | NOT in codebase | ❌ needs asset or FFmpeg gen |
| Leaf / lantern overlay | NOT in codebase | ❌ needs assets |
| Premium image model | Can override to `flux-pro/v1.1-ultra` via `overrides.falModel` | ✅ already supported |

### Recommended visual approach

**Phase 1 (MVP — now):**  
- 1 background image, `fal-ai/flux-pro/v1.1-ultra` (premium), `landscape_16_9`
- Style: "cinematic Buddhist temple interior, warm golden amber candlelight, incense smoke atmosphere, sacred serene, hyper-realistic, 8K" 
- Add minimal Ken Burns to `long-video.ts`: `zoompan=z='1+0.0005*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=25`  
  (Zoom in 0.05% per frame over 10 minutes = ~7% total zoom — imperceptible but alive)
- No ambient overlays yet

**Phase 2 (next sprint):**  
- Add smoke.png / particles.png overlay assets to `media/overlays/`
- Layer via FFmpeg `movie=overlaypath,loop,format=rgba,colorchannelmixer=aa=0.3[smoke]; [vraw][smoke]overlay` 
- Loop duration = audio duration

---

## 6. Thumbnail Audit

### Current state

The thumbnail pipeline is fully implemented in `long-images.ts`:
- LLM generates thumbnail intent (emotion, main visual, color mood, text suggestion)
- Separate LLM call for the Fal image prompt (using `LONG_THUMBNAIL_LLM_MODEL_DEFAULT`)
- Fal image generation at `1280×720` using `LONG_THUMBNAIL_FAL_MODEL_DEFAULT` = `fal-ai/flux-pro/v1.1-ultra`
- Downloaded to `media/images/{contentId}-long/thumbnail.jpg`
- Stored in `content_generations.long_thumbnail_path`

### Gap: no text rendered on thumbnail

The thumbnail image is generated but no Vietnamese title text is composited onto it. The `thumbnailText` field is generated (stored in `content_generations`) but never rendered by code. Thumbnails are pure AI-generated visuals without text overlay.

YouTube thumbnails with zero text have lower CTR for Vietnamese Buddhist content, where audiences respond strongly to emotional 2-4 word phrases.

### Recommended thumbnail spec

| Element | Recommendation |
|---------|---------------|
| Image model | `fal-ai/flux-pro/v1.1-ultra` (already default) — justified for thumbnails |
| Composition | Rule of thirds; main subject in left 2/3; clean sky or dark background in right 1/3 for text |
| Subject | Buddha statue, golden light rays, serene monk silhouette, lotus in golden pond |
| Color palette | Warm amber, deep teal, glowing gold — NOT dark moody |
| Text overlay | 2-4 word emotional phrase, large bold Vietnamese font, rendered via FFmpeg/canvas |
| Safe area | Title text in right 1/3, no overlap with main subject face/body |
| Style | "photorealistic, ultra-detailed, 8K HDR, dramatic warm lighting, sacred cinematic atmosphere" |

**Missing piece:** The text rendering step (SVG/canvas compositing on top of thumbnail) must be added before thumbnails are upload-ready for YouTube.

---

## 7. Animation Feasibility

| Animation technique | Complexity | Cost | Realism | Risk | Implementation time |
|--------------------|------------|------|---------|------|---------------------|
| **Subtle Ken Burns (single image, 0.05%/frame)** | Low | Free (FFmpeg) | High — looks like slow camera push | Low | 1 hour: add `zoompan` to `long-video.ts` |
| **Smoke overlay (PNG asset, alpha blend)** | Low-Medium | Free (local asset) | Medium — depends on asset quality | Low | 4 hours: find/create smoke PNG, add FFmpeg overlay chain |
| **Dust/light particles (FFmpeg geq filter)** | Medium | Free | Medium-Low | Medium | 8 hours: FFmpeg geq formula for particle simulation |
| **Animated smoke (video file loop)** | Low | Free (one-time asset creation) | High | Low | 2 hours once asset exists |
| **AI video generation per segment (Kling/RunwayML)** | High | $0.20–$0.50/clip | High | High: non-deterministic, requires curation | 40+ hours + $10-20/video |
| **Candle flicker (FFmpeg geq color modulation)** | High | Free | Medium | High: fragile formula | 16 hours |

**Recommendation:** Ken Burns + smoke PNG overlay. Total effort: ~5 hours once assets are sourced. Realistic, low risk, free at runtime.

**Ken Burns filter (ready to use):**
```
[0:v]scale=iw*1.1:ih*1.1,zoompan=z='1+0.00005*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=25[vkb]
```
This gives 0.005% zoom per frame at 25fps. Over 600 seconds = 7.5% total zoom. Imperceptible but the image "breathes."

---

## 8. Cost Analysis

### Per-video cost breakdown (10-minute Buddhist long video)

| Item | Cheap MVP | Premium image | Premium + animation |
|------|-----------|---------------|---------------------|
| Script (already done) | $0.00 | $0.00 | $0.00 |
| Long script TTS (local) | $0.00 | $0.00 | $0.00 |
| Background images (1×) | flux/schnell $0.003 | flux-pro/ultra $0.060 | flux-pro/ultra $0.060 |
| Thumbnail (1×) | flux/schnell $0.003 | flux-pro/ultra $0.060 | flux-pro/ultra $0.060 |
| LLM for image prompts | ~$0.002 | ~$0.002 | ~$0.002 |
| FFmpeg render (local) | $0.00 | $0.00 | $0.00 |
| Smoke overlay asset | $0.00 | $0.00 | $0.00 (one-time asset) |
| **Total** | **~$0.008** | **~$0.124** | **~$0.124** |

Note: 5 landscape images (current default): 5 × $0.025 = $0.125. Going to 1 premium image costs the same but looks better.

**AI video alternative (e.g. Kling or Wan2.1 per-segment):**
- 10 segments × ~$0.30/clip = $3.00+ per video + 20× more effort
- Not recommended for first long-form

**Recommendation:** Premium image version ($0.124/video). This is the same cost as the current 5-image default but delivers a single cinematic background instead of a slideshow.

---

## 9. MVP Long-form Recommendation

### First long-form video spec

| Field | Spec |
|-------|------|
| **Duration** | 8–10 minutes |
| **Topic** | Tha thứ / Buông xả tổn thương |
| **Title** | *Nghệ Thuật Tha Thứ — Khi Buông Gánh Nặng Là Giải Thoát Cho Chính Mình* |
| **Script structure** | Hook (90s) → Story (2m) → Teaching (3m) → Examples (2m) → Reflection (60s) → Closing (30s) |
| **Word count target** | ~1200 words (8-min at 150 wpm Vietnamese) — safer for TTS than full 2000 |
| **TTS method** | Single call to VieNeu-TTS; use `runTTS(id, "long")`; monitor for timeout |
| **Visual method** | 1 image, `fal-ai/flux-pro/v1.1-ultra`, Buddhist cinematic temple prompt, `landscape_16_9` |
| **Animation** | Minimal Ken Burns (0.005%/frame zoom); no overlays yet |
| **Thumbnail method** | `fal-ai/flux-pro/v1.1-ultra` (already implemented); add title text rendering before upload |
| **Subtitle method** | Whisper word timestamps (already in long-video.ts); standard ASS, no animation needed |
| **Music** | Use existing Buddhist music from `media/music/phat_phap/` |
| **Render method** | `runLongVideo()` with `numImages=1` override |
| **Upload schedule** | Manual first; then add to queue if successful |
| **Metrics to monitor** | avg_view_duration_sec, retention_pct, views at 24h/48h/7d, like count |

### Expected performance benchmark

Based on the existing long-format Short "Nghệ Thuật Tha Thứ" (1,008 views, 77.5% retention, 42s avg duration):
- The topic already performs well in short format
- A 10-minute long version targeting the same audience should expect higher avg_view_duration if the hook holds
- Success threshold: >200 views at 7 days, >40% retention

---

## 10. Risks and Rollback Plan

### Risk 1: TTS timeout on full long script (HIGH)

**Symptom:** `runTTS` times out at 25 minutes; `long_tts_status = 'error'`  
**Mitigation:** Test with a ~600-word script first (4-minute video). If it succeeds, scale to 1200 words.  
**Rollback:** Nothing to rollback; TTS error just marks the row. Re-trigger with shorter script.  

### Risk 2: Long video slideshow looks low quality (MEDIUM)

**Symptom:** The resulting video looks like a PowerPoint with image transitions  
**Mitigation:** Set `numImages=1` in overrides to avoid the slideshow. One cinematic image for the full duration.  
**Rollback:** Trivial — override to 1 image, re-render.  

### Risk 3: No thumbnail text renders (MEDIUM)

**Symptom:** YouTube thumbnail is a raw AI image with no title text  
**Mitigation:** Acceptable for the first test. Manual annotation or use `thumbnailText` field for reference. Full text rendering is Phase 2.  
**Rollback:** Replace thumbnail manually via YouTube Studio.  

### Risk 4: Long video upload route not tested (LOW)

**Symptom:** `src/app/api/video/long/run/route.ts` may have untested code paths  
**Mitigation:** Trigger `runLongVideo()` directly in isolation before wiring to upload. Verify output file exists and plays.  
**Rollback:** No queue entry created; nothing published accidentally.  

### Risk 5: Subtitle sync poor for 10-minute audio (LOW)

**Symptom:** Subtitles appear at wrong timestamps  
**Mitigation:** Whisper word-timestamp path is already used in `long-video.ts` (line 125). It has a 5-minute timeout for Whisper (`300_000ms`). For 10-minute audio this timeout may need to be increased to 600s.  
**Rollback:** Re-render with time-based fallback (`buildSubtitleChunks` without Whisper).  

### Risk 6: Wrong channel — long video published to Short channel (LOW)

**Symptom:** A 10-minute video appears in the YouTube Shorts feed  
**Mitigation:** Long videos must be scheduled with `video_type = 'long'`. The upload guard checks this.  
**Rollback:** Delete from YouTube immediately (within 24h before indexing).  

---

## Implementation Plan (Ordered by Dependency)

| Step | Action | File | Effort | Priority |
|------|--------|------|--------|----------|
| 1 | Generate a test 1200-word long script for "Tha thứ" topic via UI | Content generator | 5 min | P0 |
| 2 | Trigger `runTTS(id, "long")` — verify TTS completes | API or manual cron | 5 min + wait | P0 |
| 3 | Trigger `runLongImages(id, { numImages: 1, falModel: "fal-ai/flux-pro/v1.1-ultra" })` | API | 5 min + wait | P0 |
| 4 | Add single-image Ken Burns to `long-video.ts` | `src/lib/pipeline/long-video.ts` | 1 hour | P1 |
| 5 | Trigger `runLongVideo(id)` — verify MP4 output | API | 5 min + wait | P0 |
| 6 | Review output MP4 manually: subtitle timing, visual quality, music mix | Local playback | 15 min | P0 |
| 7 | Add title text compositing to thumbnail | New utility function | 4 hours | P1 |
| 8 | Schedule upload manually via upload queue | DB or UI | 5 min | P0 |
| 9 | Monitor 7-day metrics | Analytics dashboard | Ongoing | P0 |
| 10 | Add smoke overlay asset layer | `long-video.ts` | 4 hours | P2 |

**Note:** Steps 1, 2, 3, 5, 6, 8 require no code changes. The pipeline is ready as-is except for Ken Burns (Step 4) and thumbnail text (Step 7).
