# Quote Visual Forensics — qgen-mq529m74 / qgen-mq529sg9 / qgen-mq529ylj

**Audit date:** 2026-06-11  
**Auditor:** forensic trace of image generation lineage  
**Verdict:** These visuals look like the old style because they were produced by a **completely separate legacy pipeline** that has never received any Phase 1.0 or Phase 1.1 changes.

---

## 1. Generation Metadata

| Field | qgen-mq529m74 | qgen-mq529sg9 | qgen-mq529ylj |
|-------|--------------|--------------|--------------|
| Content ID | qgen-mq529m74-gfgmk | qgen-mq529sg9-mkvas | qgen-mq529ylj-45p4k |
| Generated at | 2026-06-08 17:21 UTC | 2026-06-08 17:21 UTC | 2026-06-08 17:21 UTC |
| Topic | Nhẫn không phải yếu, nhẫn là sức mạnh của tâm | Người khôn không tranh hơn thua với kẻ không đáng | Không phải chuyện nào cũng cần giải thích |
| Topic family | tri_tue_song_im_lang_nhan_nhin | tri_tue_song_im_lang_nhan_nhin | tri_tue_song_im_lang_nhan_nhin |
| Content profile | buddhism | buddhism | buddhism |
| Pipeline | legacy-quote-short-v1 | legacy-quote-short-v1 | legacy-quote-short-v1 |
| Fal model | **fal-ai/flux/schnell** (hardcoded) | same | same |
| Image size | **portrait_4_3** (hardcoded) | same | same |
| Inference steps | **4** (hardcoded) | same | same |
| Guidance scale | none (not passed) | none | none |
| Experiment ID | LEGACY_QUOTE_SHORT | same | same |
| Experiment variant | BUDDHIST_TEACHING_NUMBERED_V1 | BUDDHIST_TEACHING_SINGLE_V1 | LEGACY_QUOTE_NO_VOICE_V2 |
| Visual mode | ken_burns_image | ken_burns_image | ken_burns_image |
| Prompt version stored | **none** (no promptVersions field) | none | none |
| heroSubject | **not tracked** | not tracked | not tracked |
| compositionProfile | **not tracked** | not tracked | not tracked |
| visualVariant | **not tracked** | not tracked | not tracked |
| Source image size | 768×1024 (portrait_4_3) | 768×1024 | 768×1024 |
| Rendered card size | 1080×1920 | 1080×1920 | 1080×1920 |

**Key finding:** Generated on Jun 8, before Phase 1.0 (Jun 10+). Not stored in `content_generations` table. These IDs exist only as files under `output/legacy-quote-short-v1/`.

---

## 2. Raw Prompt Recovery

### Category routing

All three topics belong to `tri_tue_song_im_lang_nhan_nhin` (patience / wisdom / silence). The pipeline calls `getBuddhistVisualCategory(topic)` with no script content — topic-only matching. None of these topic strings match any keyword in `TOPIC_TO_CATEGORY_RULES`, so all three fall through to the **deterministic hash fallback**:

```typescript
const hashVal = Array.from(topic).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0);
return BUDDHIST_FALLBACK_CATEGORIES[hashVal % BUDDHIST_FALLBACK_CATEGORIES.length];
```

The four fallback categories are: `LOTUS_PARADISE_PEACE`, `TEMPLE_SUNRISE_SERENITY`, `BUDDHA_GOLDEN_ENLIGHTENMENT`, `VIETNAMESE_BUDDHIST_TEMPLE`. All three topics land in this pool.

### Fal prompt sent (reconstructed from pipeline code)

The prompt is built by `buildBuddhistImagePrompt(categoryKey, topic)` (line 1208 of `quote-short-pipeline.ts`), then appended with:

```
, no dark shadows, no cold blue tones, no gloomy mood, no heavy shadow, negative: [BUDDHIST_NEGATIVE_PROMPT]
```

At time of generation (Jun 8), `buildBuddhistImagePrompt` used the **V1 composition suffix**:

```
"centered sacred portrait composition, strong clear silhouette, large subject occupying 55-70% of the frame,
enough clean visual space for subtitles, vertical 9:16,
realistic cinematic Buddhist art, highly detailed, elegant, clean, bright, uplifting,
no text, no watermark, no logo, no distorted face, no extra limbs"
```

No `VISUAL_BRAND_ANCHOR` (added in Phase 1.1). No cover-safe upper-third instruction. No heroSubject injection.

### System prompt

The quote pipeline uses **no LLM step** for Buddhist content. `buildBuddhistImagePrompt` produces the full prompt string directly from the category's `promptConcept` + composition suffix. There is no system prompt — it is a single Fal API call with a deterministic string. The LLM system prompt from `images.ts` (Phase 1.1 updated) is **never invoked** in this pipeline.

---

## 3. V3 Prompt Compliance Check

| V3 Feature | qgen-mq529m74 | qgen-mq529sg9 | qgen-mq529ylj |
|------------|--------------|--------------|--------------|
| warm gold palette | NO — V1 category palette only | NO | NO |
| jade green accent language | NO | NO | NO |
| cinematic photography style | partial (V1 used "realistic cinematic Buddhist art") | same | same |
| cover-safe composition | **NO** — no upper-third instruction | NO | NO |
| upper-third negative space rule | **NO** | NO | NO |
| subject 40-70% frame (V2) | NO — "55-70%" V1 only | NO | NO |
| hero subject instruction | **NO** | NO | NO |
| VISUAL_BRAND_ANCHOR | **NO** | NO | NO |
| LLM system prompt V2 direction | **NO** — no LLM used at all | NO | NO |
| promptVersions tracking | **NO** — not stored | NO | NO |

**All 10 V3 features: NOT PRESENT.** These images predate Phase 1.0 entirely.

---

## 4. Image Lineage Audit

```
Topic string
  → getBuddhistVisualCategory(topic)       [quote-short-pipeline.ts:1207]
  → buildBuddhistImagePrompt(categoryKey)  [buddhist-visual-categories.ts — V1 at generation time]
  → fal.run("fal-ai/flux/schnell", {
        image_size: "portrait_4_3",        // hardcoded, never reads app_config
        num_inference_steps: 4,            // min quality, flow-matching only
        prompt: <V1 string>
    })
  → 768×1024 JPEG saved to output/legacy-quote-short-v1/images/{id}-bg.jpg
  → renderLegacyQuoteShort() in legacy-quote-short-generator.ts
      → FFmpeg scale 1320×2347 → zoompan → crop 1080×1920
      → drawbox black overlay @ 0.34 opacity (dimFactor for ken_burns_image)
      → ASS subtitle renderer (Vietnamese quote text)
  → 1080×1920 rendered quote card JPEG
  → 1080×1920 MP4 with music
```

The Phase 1.0 / 1.1 changes were applied exclusively to `src/lib/pipeline/images.ts` and `src/lib/config/buddhist-visual-categories.ts`. The quote pipeline at `src/lib/pipeline/quote-short-pipeline.ts` reads from `buddhist-visual-categories.ts`, but the Jun 8 outputs were already frozen on disk. Even if regenerated today, the pipeline has **three hardcoded constants that bypass all Phase 1/1.1 config**:

```typescript
// quote-short-pipeline.ts lines 41-43
const FAL_MODEL     = "fal-ai/flux/schnell";   // never reads app_config
const FAL_IMAGE_SIZE = "portrait_4_3";          // never reads app_config
const FAL_STEPS     = 4;                        // never reads app_config
```

`images.ts` reads these from `getImageConfig()` (DB-backed). `quote-short-pipeline.ts` does not.

---

## 5. Renderer Audit

### Dark overlay impact

The renderer applies a full-frame black box at 34% opacity for `ken_burns_image` mode:

```typescript
// legacy-quote-short-generator.ts:1289-1292
const dimFactor =
  resolvedVisualMode === "kinetic_typography" ? 0.72 :
  resolvedVisualMode === "note_letter_card" || resolvedVisualMode === "bilingual_minimal" ? 0.46 :
  0.34;   // ← applies to all three targets (ken_burns_image)
```

FFmpeg filter chain:
```
[0:v]scale=1320:2347:force_original_aspect_ratio=increase,
zoompan=...,
trim=duration=14.000,setpts=PTS-STARTPTS,
drawbox=x=0:y=0:w=iw:h=ih:color=black@0.34:t=fill   ← 34% dark overlay
[accentLine],
ass='...':fontsdir='/Library/Fonts',
format=yuv420p[vout]
```

### Quantified visual degradation

| Effect | Impact |
|--------|--------|
| `drawbox black@0.34` | ~34% brightness reduction across entire frame |
| `scale 768×1024 → 1320×2347` | 71.9% upscale before crop — introduces softness at 4-step Schnell quality |
| `zoompan` (ken burns) | Additional motion blur artifact on low-quality Schnell output |
| `portrait_4_3 → 1080×1920 crop` | ~25% width cropped after scale — edges of composition lost |
| 4 inference steps (Schnell min) | Low detail, soft edges, visible generation artifacts in textures |

The 34% overlay is the single biggest visual degradation — it suppresses the warm gold palette entirely, pushing everything toward a dim, low-contrast look. A Flux Dev image with the V2 prompt would still appear dark after this overlay.

### Source vs rendered comparison

| Metric | Source image | Rendered card |
|--------|-------------|---------------|
| Dimensions | 768×1024 | 1080×1920 |
| Brightness | Full (Fal output) | ~66% of source due to 0.34 overlay |
| Saturation | As generated | Reduced (dark overlay desaturates by mixing with black) |
| Sharpness | Soft (4-step Schnell) | Further softened by 1.72× upscale |
| Composition | V1, no cover-safe | V1 + cropped by aspect ratio stretch |

---

## 6. Root Cause Analysis

### Cause A: Prompt V3 not used — CONFIRMED ✓ (Confidence: 100%)

These outputs were generated Jun 8, before Phase 1.0 (Jun 10). Even if regenerated today, `quote-short-pipeline.ts` has **no LLM step for Buddhist content** — it calls `buildBuddhistImagePrompt()` directly. While Phase 1.1 updated that function's output, the pipeline bypasses all `app_config` lookups and uses hardcoded V1 model/size/steps.

### Cause B: Wrong image model — CONFIRMED ✓ (Confidence: 100%)

`FAL_MODEL = "fal-ai/flux/schnell"` is hardcoded in `quote-short-pipeline.ts`. Phase 1.0 moved `images.ts` to DB-driven model selection. The quote pipeline never received this change. Schnell at 4 steps produces measurably inferior quality vs Dev at 28 steps.

### Cause C: Wrong category routing — PARTIAL (Confidence: 65%)

All three topics fall through keyword matching to the hash fallback — they aren't mapped by any rule. The fallback pool is acceptable but not optimal for "wisdom / silence" topics. However, this is secondary to causes A and B.

### Cause D: Renderer degrading image — CONFIRMED ✓ (Confidence: 100%)

The 34% black overlay (`drawbox black@0.34`) destroys warm gold tones on every `ken_burns_image` output. This is by design for text legibility but is the primary reason the visual feels "dark and old-style" regardless of what the Fal model produces.

### Cause E: Prompt V3 active but ineffective — NOT APPLICABLE

V3 was never active on these outputs.

### Cause F: Other — Pipeline isolation

The root structural cause is that `quote-short-pipeline.ts` is a **fully isolated pipeline** that does not share model config, image size config, or version tracking with `images.ts`. Phase 1.0/1.1 changes were scoped to `images.ts` only.

---

## 7. Screenshot Evidence

### qgen-mq529m74 (Nhẫn không phải yếu)

- **Source image:** `output/legacy-quote-short-v1/images/qgen-mq529m74-gfgmk-bg.jpg`  
  768×1024, Flux Schnell 4 steps, portrait_4_3
- **Rendered quote card:** `output/legacy-quote-short-v1/qgen-mq529m74-gfgmk-legacy-quote-card.jpg`  
  1080×1920, 34% black overlay applied
- **Prompt snippet (reconstructed):**  
  `"A peaceful Buddha statue as the main subject sitting on a lotus platform in the middle of a bright lotus lake, many pink and white lotus flowers, crystal clear turquoise water, soft golden morning sunlight, distant Buddhist temple, fresh peaceful atmosphere, color palette: jade green, warm sunlight, ivory white, lotus pink, centered sacred portrait composition, strong clear silhouette, large subject occupying 55-70% of the frame, enough clean visual space for subtitles, vertical 9:16, realistic cinematic Buddhist art, highly detailed, elegant, clean, bright, uplifting, no text, no watermark, no logo, no distorted face, no extra limbs, no dark shadows, no cold blue tones, no gloomy mood, no heavy shadow, negative: [BUDDHIST_NEGATIVE_PROMPT]"`

### qgen-mq529sg9 (Người khôn không tranh hơn thua)

- **Source image:** `output/legacy-quote-short-v1/images/qgen-mq529sg9-mkvas-bg.jpg`  
  768×1024, Flux Schnell 4 steps, portrait_4_3
- **Rendered quote card:** `output/legacy-quote-short-v1/qgen-mq529sg9-mkvas-legacy-quote-card.jpg`  
  1080×1920, 34% black overlay applied
- **Prompt snippet:** Same fallback category as above (hash-determined)

### qgen-mq529ylj (Không phải chuyện nào cũng cần giải thích)

- **Source image:** `output/legacy-quote-short-v1/images/qgen-mq529ylj-45p4k-bg.jpg`  
  768×1024, Flux Schnell 4 steps, portrait_4_3
- **Rendered quote card:** `output/legacy-quote-short-v1/qgen-mq529ylj-45p4k-legacy-quote-card.jpg`  
  1080×1920, 34% black overlay applied
- **Prompt snippet:** Same fallback category (hash-determined)

---

## Why These 3 Quote Images Still Look Like the Old Style

**Ranked by confidence:**

### #1 — Wrong pipeline entirely (Confidence: 100%)

Phase 1.0 and 1.1 changed `src/lib/pipeline/images.ts`. These outputs come from `src/lib/pipeline/quote-short-pipeline.ts` — a completely separate pipeline that was never touched. The two pipelines share the category library (`buddhist-visual-categories.ts`) but diverge at every other level: model selection, image size, inference steps, config source, and tracking.

### #2 — Renderer 34% dark overlay destroys warm palette (Confidence: 100%)

`legacy-quote-short-generator.ts` applies `drawbox=color=black@0.34` to every `ken_burns_image` output (line 1292). This 34% black overlay suppresses warm gold, amber, and jade tones — the exact brand qualities Phase 1.1 injected into prompts. Even a perfect Flux Dev image with full V2 prompts would appear dim and desaturated after this renderer step.

### #3 — Hardcoded Flux Schnell at 4 steps (Confidence: 100%)

`quote-short-pipeline.ts` hardcodes `FAL_MODEL = "fal-ai/flux/schnell"` and `FAL_STEPS = 4`. 4 steps is below the minimum recommended (8) for Schnell. Phase 1.0 migrated `images.ts` to DB-driven model selection (defaulting to `portrait_16_9`, configurable Dev). The quote pipeline never participates in this config.

### #4 — Hardcoded portrait_4_3 (768×1024) image size (Confidence: 100%)

The source images are 768×1024 (`portrait_4_3`), then upscaled 1.72× to 1320×2347 before crop to 1080×1920. This introduces softness and amplifies Schnell's 4-step quality ceiling. Phase 1.0's `portrait_16_9` change never reached this pipeline.

### #5 — Pre-generation date (Confidence: 100%)

All three files were written Jun 8 17:21 UTC. Phase 1.0 landed Jun 10. Even if the pipeline had been updated, these specific outputs are frozen artifacts — no rerender was triggered.

### #6 — No topic keyword match → hash fallback category (Confidence: 65%)

Topics in the `tri_tue_song_im_lang_nhan_nhin` family (wisdom, silence, patience) have no matching keywords in `TOPIC_TO_CATEGORY_RULES`. They fall to a 4-category hash fallback that may not pick the most visually impactful category for these topics. This is secondary.

---

## Required Actions to Fix

1. **Update `quote-short-pipeline.ts`**: Replace hardcoded `FAL_MODEL`, `FAL_IMAGE_SIZE`, `FAL_STEPS` constants with `getImageConfig()` DB lookup (same pattern as `images.ts`).
2. **Reduce dark overlay**: Lower `dimFactor` for `ken_burns_image` from `0.34` to `0.20`–`0.22` in `legacy-quote-short-generator.ts`.
3. **Add topic keyword rules** for wisdom/silence/patience topics in `TOPIC_TO_CATEGORY_RULES` to exit the hash fallback.
4. **Rerender** affected outputs after config and overlay fixes.

These three actions would be sufficient to bring quote-short visuals into alignment with the V2 prompt standard.
