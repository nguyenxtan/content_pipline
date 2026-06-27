# Longform Quality Upgrade Report

**Date:** 2026-06-13
**Topic tested:** Nỗi Lo Lắng
**Content ID:** 66bab6b1-658d-47fd-8769-998f787a3251
**Status:** Script + Image generated — Video NOT rendered (per spec)

---

## Phase 1 — Script Model

| Key | Value |
|-----|-------|
| Model used | `anthropic/claude-sonnet-4-6` |
| Env var | `LONGFORM_SCRIPT_MODEL` |
| Fallback chain | LONGFORM_SCRIPT_MODEL → CONTENT_GEN_MODEL → anthropic/claude-sonnet-4-6 |
| Previous default | openai/gpt-4o-mini (removed) |

---

## Phase 2 — Script Structure V2

| Metric | Value |
|--------|-------|
| Word count | 7396 |
| Section count | 7 |
| Est. duration | 49.3 min |
| Generation time | 14m 28s |
| Input tokens | 37527 |
| Output tokens | 34899 |

### Sections generated

| # | Title | Words |
|---|-------|-------|
| 1 | Ba Giờ Sáng Và Một Màn Hình Sáng | 965 |
| 2 | Người Luôn Chuẩn Bị Cho Điều Tệ Nhất | 858 |
| 3 | Tại Sao Não Bộ Không Cho Ta Nghỉ | 972 |
| 4 | Lo Âu Là Một Làn Sóng, Không Phải Bản Thân Ta | 914 |
| 5 | Khi Ta Ngồi Với Nỗi Lo Thay Vì Chạy Khỏi Nó | 1168 |
| 6 | Nỗi Lo Đang Cố Nói Điều Gì Với Ta | 1291 |
| 7 | Buổi Sáng Vẫn Đến Dù Đêm Dài Đến Đâu | 1228 |

### Repetition analysis

| Metric | Value |
|--------|-------|
| Score | 0.540 (0=clean, 1=heavy) |
| Repeated sentences | 1 |
| Repeated 4-grams (3+x) | 6 |
| Forbidden phrases found | 0 |

No forbidden phrases detected. ✓

### Section V2 structure (fixed roles)

1. **emotional_opening** — Mở đầu bằng cảnh cảm xúc cụ thể
2. **human_story** — Câu chuyện của một người thật
3. **why_we_suffer** — Phân tích ngọn nguồn của nỗi khổ
4. **buddhist_teaching** — Góc nhìn Phật pháp, không thuyết giáo
5. **modern_examples** — Ví dụ đời sống hiện đại
6. **deep_reflection** — Dẫn vào chiều sâu nội tâm
7. **calm_closing** — Kết thúc nhẹ nhàng

---

## Phase 3 — Voice Discovery

| Voice | Name | Gender | Accent | Duration | WPM |
|-------|------|--------|--------|----------|-----|
| Binh | Thanh Bình (nam miền Bắc) | male | north | 33.6 | 234 |
| Tuyen | Phạm Tuyên (nam miền Bắc) | male | north | 37.1 | 212 |
| Vinh | Xuân Vĩnh (nam miền Nam) | male | south | 32.5 | 242 |
| Doan | Thục Đoan (nữ miền Nam) | female | south | 38.9 | 202 |
| Ly | Trúc Ly (nữ miền Bắc) | female | north | 33.8 | 233 |
| Sơn | Thái Sơn (nam miền Nam) | male | south | 35.7 | 220 |
| Ngoc | Bích Ngọc (nữ miền Bắc) | female | north | 35.6 | 221 |

### Top recommended voices (male, southern accent — warm narrator)

1. **Vinh** — Xuân Vĩnh (nam miền Nam) (Nam) | 32.5s | 242 WPM
2. **Sơn** — Thái Sơn (nam miền Nam) (Nam) | 35.7s | 220 WPM

**Voice samples directory:** `media/audio/voice-samples/`
**Metadata file:** `media/audio/voice-samples/voice-samples.json`

> ⚠️ Production voice NOT changed. Change `ttsVoice` in the planner to switch.

---

## Phase 4 — Premium Longform Visual

| Key | Value |
|-----|-------|
| Mode | Single master image (NOT slideshow) |
| Model | `fal-ai/flux-pro/v1.1-ultra` |
| Visual variant | `master/pro-v1.1-ultra/landscape_16_9` |
| Master image | `media/images/66bab6b1-658d-47fd-8769-998f787a3251-long/master.jpg` |
| Thumbnail | `media/images/66bab6b1-658d-47fd-8769-998f787a3251-long/thumbnail.jpg` |
| Generation time | 15s |
| Cost | $0.1200 |

**Image prompt (excerpt):**
```
Cinematic Buddhist meditation space, ancient Vietnamese temple courtyard at golden hour, weathered stone Buddha statue, delicate moss and jade accents, incense smoke rising through volumetric shafts of warm amber light, lotus pond with mirror-still reflections, traditional stone lanterns casting sof…
```

Style target: cinematic Buddhist photography — temple courtyard, Buddha statue, incense smoke, golden hour, jade accents, lantern glow, volumetric lighting, realistic, premium, no people.

---

## Production Readiness

| Item | Status |
|------|--------|
| Script model upgraded | ✅ Claude Sonnet via OpenRouter |
| Script structure V2 (7 fixed roles) | ✅ Implemented |
| Repetition detection | ✅ Implemented (score: 0.540) |
| Voice samples generated | ✅ 7 voices |
| Premium master image | ✅ fal-ai/flux-pro/v1.1-ultra |
| Video NOT rendered | ✅ (per spec — await quality review) |
| Short pipeline untouched | ✅ |
| DB rows preserved | ✅ |

**Recommended voice:** `Vinh` — Xuân Vĩnh (nam miền Nam)

**Estimated production readiness:** Script quality ready for audio render. Review script excerpt and voice samples before triggering TTS.

---

## Rollback Plan

| Component | Rollback action |
|-----------|----------------|
| Script model | Remove `LONGFORM_SCRIPT_MODEL` from .env.local → falls back to CONTENT_GEN_MODEL |
| Script prompts | Revert `src/lib/longform-planner-script.ts` (prompt constants + section structure) |
| Master image | Call `runLongImages(contentId)` instead of `runLongMasterImage(contentId)` |
| Image model default | Revert `LONGFORM_MASTER_IMAGE_FAL_MODEL_DEFAULT` in image-config-constants.ts |
| DB content | Content ID `66bab6b1-658d-47fd-8769-998f787a3251` can be re-generated — long_tts/video/images statuses are pending |

---

*Generated by `scripts/longform-quality-test.ts`*
