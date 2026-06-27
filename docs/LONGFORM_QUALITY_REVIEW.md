# Longform Quality Review — V3

**Date:** 2026-06-13
**Topic:** Nỗi Lo Lắng
**Content ID:** `66bab6b1-658d-47fd-8769-998f787a3251`
**Script model:** `anthropic/claude-sonnet-4-6`
**Prompt version:** `longform_planner_v3_sections`
**Status:** Script + Image generated — Video NOT rendered (per spec)


---

## Overall Readiness

| Score | Grade |
|-------|-------|
| Quality | 89/100 |
| Literary | 81/100 |
| Storytelling | 90/100 |
| Podcast | 81/100 |
| **Overall** | **85/100 — ✅ PRODUCTION READY** |

---

## Phase 1 — Script Quality Audit

### Metrics

| Metric | Value |
|--------|-------|
| Total words | 7,396 |
| Section count | 7 |
| Estimated duration | 49.3 min (at 150 WPM) |
| Paragraphs | 155 |
| Sentences | 536 |
| Avg sentence length | 13.7 words |

### Words per section

> Section-level word counts are not individually stored in DB (sections merged into `longContent`).
> See console output from `scripts/longform-quality-test.ts` for per-section breakdown.

### Forbidden phrases

| Phrase | Count | Severity |
|--------|-------|----------|
| — | — | ✅ none |

### Extra watch phrases

| Phrase | Count |
|--------|-------|
| `đôi khi` | 7× |
| `chúng ta` | 2× |

### Top 20 repeated phrases (3-grams + 4-grams)

| Count | Type | Phrase |
|-------|------|--------|
| 4× | 4-gram | `một thứ gì đó` |
| 3× | 4-gram | `cái cảm giác đó` |
| 3× | 4-gram | `lúc ba giờ sáng` |
| 3× | 4-gram | `nghe tiếng quạt trần` |
| 3× | 4-gram | `một chút — không` |
| 3× | 4-gram | `không phải vì bạn` |
| 2× | 4-gram | `— không có gì` |
| 2× | 4-gram | `nhưng lúc ba giờ` |
| 2× | 4-gram | `có điều gì đó` |
| 2× | 4-gram | `tất cả những thứ` |
| 2× | 4-gram | `là một trong những` |
| 2× | 4-gram | `và cái cảm giác` |
| 10× | 3-gram | `không có gì` |
| 8× | 3-gram | `không phải là` |
| 7× | 3-gram | `cái cảm giác` |
| 7× | 3-gram | `không phải vì` |
| 5× | 3-gram | `câu trả lời` |
| 5× | 3-gram | `thứ gì đó` |
| 5× | 3-gram | `ba giờ sáng` |
| 5× | 3-gram | `--- có một` |

### Repeated sentences

- "bắt đầu lại"
- "lo âu cũng vậy"
- "không có gì được giải quyết"

### V3 Density Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Sensory density | 2.6 per 100w | ≥ 2.0 | ✅ |
| Scene density | 3.2 per 100w | ≥ 1.5 | ✅ |
| Story density | 2 per 100w | ≥ 1.0 | ✅ |
| Abstract density | 0.1 per 100w | ≤ 0.5 | ✅ |
| Literary score (V3) | 59/100 | ≥ 75 | ⚠️ |

### Honest criticism

**Strengths:**
- Strong sensory imagery and metaphor usage detected.
- Good storytelling structure with opening scene and character.
- Sentence rhythm is suitable for spoken narration.

**Weaknesses:**
- No major forbidden phrase issues.
- 3 repeated sentence(s) detected — indicates AI templating.
- 1 4-grams appear 4+ times — script may feel repetitive to careful listeners.


---

## Phase 2 — Voice Discovery

### All voices

| # | ID | Name | Gender | Accent | Duration | WPM | Warmth | Depth | Narration | Buddhist | Overall |
|---|----|------|--------|--------|----------|-----|--------|-------|-----------|----------|---------|
| 1 | **Vinh** | Xuân Vĩnh (nam miền Nam) | Nam | Nam | 242.0s | 32.52 | 5/5 | 4/5 | 5/5 | 5/5 | **4.8** |
| 2 | **Sơn** | Thái Sơn (nam miền Nam) | Nam | Nam | 220.0s | 35.66 | 4/5 | 5/5 | 4/5 | 4/5 | **4.3** |
| 3 | **Doan** | Thục Đoan (nữ miền Nam) | Nữ | Nam | 202.0s | 38.9 | 4/5 | 3/5 | 4/5 | 4/5 | **3.8** |
| 4 | **Binh** | Thanh Bình (nam miền Bắc) | Nam | Bắc | 234.0s | 33.62 | 3/5 | 3/5 | 4/5 | 3/5 | **3.3** |
| 5 | **Tuyen** | Phạm Tuyên (nam miền Bắc) | Nam | Bắc | 212.0s | 37.12 | 3/5 | 3/5 | 3/5 | 3/5 | **3.0** |
| 6 | **Ly** | Trúc Ly (nữ miền Bắc) | Nữ | Bắc | 233.0s | 33.8 | 3/5 | 2/5 | 3/5 | 3/5 | **2.8** |
| 7 | **Ngoc** | Bích Ngọc (nữ miền Bắc) | Nữ | Bắc | 221.0s | 35.62 | 3/5 | 2/5 | 3/5 | 3/5 | **2.8** |

**Samples directory:** `media/audio/voice-samples/`
**Metadata:** `media/audio/voice-samples/voice-samples.json`

---

## Phase 3 — Voice Ranking

| # | Voice | Warmth | Depth | Narration | Buddhist | Notes |
|---|-------|--------|-------|-----------|----------|-------|
| 1 | Vinh | 5/5 | 4/5 | 5/5 | 5/5 | Nam miền Nam — ấm, trầm, tự nhiên. Tốt nhất cho nội dung tâm linh. |
| 2 | Sơn | 4/5 | 5/5 | 4/5 | 4/5 | Nam miền Nam — trầm sâu, có trọng lượng. Phù hợp narration triết học. |
| 3 | Doan | 4/5 | 3/5 | 4/5 | 4/5 | Nữ miền Nam — nhẹ nhàng, ấm. Phù hợp nhưng không phải ưu tiên cho kênh này. |
| 4 | Binh | 3/5 | 3/5 | 4/5 | 3/5 | Nam miền Bắc — rõ ràng, chuẩn mực. Ít ấm hơn cho podcast thiền định. |
| 5 | Tuyen | 3/5 | 3/5 | 3/5 | 3/5 | Nam miền Bắc — cứng, formal. Không phù hợp cho phong cách storytelling. |

### Recommended production voice

> **Vinh — Xuân Vĩnh (nam miền Nam)**

Nam miền Nam — ấm, trầm, tự nhiên. Tốt nhất cho nội dung tâm linh.

**Reasoning:** Southern male voices (Vinh, Sơn) carry warmth and natural weight ideal for emotional Buddhist narration. Northern male voices (Binh, Tuyen) are clearer but more formal — less suitable for the intimate, storytelling tone this channel targets.

> ⚠️ Production voice NOT changed. To switch, update `ttsVoice` in the longform planner configuration.

---

## Phase 4 — Premium Image Audit

| Key | Value |
|-----|-------|
| Master image | `media/images/66bab6b1-658d-47fd-8769-998f787a3251-long/master.jpg` |
| Master size | 1047 KB |
| Thumbnail | `media/images/66bab6b1-658d-47fd-8769-998f787a3251-long/thumbnail.jpg` |
| Thumbnail size | 383 KB |
| Model | `fal-ai/flux-pro/v1.1-ultra` |
| Visual variant | `master/pro-v1.1-ultra/landscape_16_9` |
| Thumbnail score | 85/100 |
| Longform suitability | 90/100 |
| Visual quality | 92/100 |

**Image prompt (excerpt):**
```
Cinematic Buddhist meditation space, ancient Vietnamese temple courtyard at golden hour, weathered stone Buddha statue, delicate moss and jade accents, incense smoke rising through volumetric shafts of warm amber light, lotus pond with mirror-still r
```

**Style target:** Cinematic Buddhist photography — temple courtyard, Buddha statue, incense smoke, golden hour, jade accents, lantern glow, volumetric lighting, realistic, premium, no people.

**Notes:** Premium Flux Pro Ultra — cinematic quality expected. Verify manually.

> ⚠️ Review image files manually before committing to production. Scores are proxy estimates based on file size + model tier.

---

## Final Readiness Assessment

| Component | Status | Score |
|-----------|--------|-------|
| Script model | `anthropic/claude-sonnet-4-6` | — |
| Script quality | ✅ | 89/100 |
| Literary quality | ✅ | 81/100 |
| Storytelling | ✅ | 90/100 |
| Podcast suitability | ✅ | 81/100 |
| Voice samples generated | ✅ | 7/7 voices |
| Production voice identified | ✅ | Vinh |
| Premium master image | ✅ | 92/100 |
| Video NOT rendered | ✅ | — |
| Shorts untouched | ✅ | — |

**Overall readiness: 85/100 — ✅ PRODUCTION READY**

### Next steps before production render

3. **Listen to voice samples** in `media/audio/voice-samples/` — confirm Vinh sounds right for the topic.
4. **Review master image** at `media/images/66bab6b1-658d-47fd-8769-998f787a3251-long/master.jpg` — verify cinematic quality.
5. **Only then**: trigger TTS render on the approved voice.

---

*Generated by `scripts/longform-audit.ts`*
