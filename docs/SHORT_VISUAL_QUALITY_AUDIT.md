# Short Visual Quality Audit

Date: 2026-06-10  
Scope: YouTube Shorts pipeline — image generation, prompt quality, renderer, motion feasibility, cost, and experiment tracking.  
Status: audit only — no code changes.

---

## 1. Current Image Pipeline

### Flow

```
Script (Vietnamese)
  → LLM generates English image prompts (1 prompt per image)
  → Fal.ai generates image (1 image per Short by default)
  → Image downloaded to media/images/<contentId>/0.jpg
  → FFmpeg renders video: scale → concat → drawbox → cover ASS → subtitle ASS → encode
  → Thumbnail extracted at ~0.35 × image[0] duration
```

### Files

| File | Role |
|------|------|
| `src/lib/pipeline/images.ts` | Main image generation pipeline for Shorts |
| `src/lib/pipeline/long-images.ts` | Long-video image pipeline (separate model/config) |
| `src/lib/pipeline/short-video.ts` | FFmpeg renderer for Shorts |
| `src/lib/image-config-constants.ts` | Default keys and default model values |
| `src/actions/app-config.ts` | DB-backed getImageConfig() / setFalImageModel() |
| `src/lib/config/buddhist-visual-categories.ts` | BUDDHIST_VISUAL_V1 category system |
| `src/lib/config/content-profiles.ts` | Profile routing (buddhism vs. psychology) |
| `src/lib/prompt-studio-registry.ts` | Audience profiles used by prompt builder |

---

## 2. Current Fal.ai Configuration

### Short video (production defaults)

| Parameter | Value | Source |
|-----------|-------|--------|
| Fal model | `fal-ai/flux/schnell` | `FAL_IMAGE_MODEL_DEFAULT` in `image-config-constants.ts:6` |
| Image size | `portrait_4_3` | Hardcoded in `images.ts:42` |
| Aspect ratio | 4:3 portrait (approx 768×1024 at Schnell native) | `IMAGE_SIZE = "portrait_4_3"` |
| Inference steps (Schnell) | **8** (auto) | `FAL_DEFAULT_STEPS["fal-ai/flux/schnell"] = 8` |
| Inference steps (Dev) | 28 (auto if switched) | `FAL_DEFAULT_STEPS["fal-ai/flux/dev"] = 28` |
| Guidance scale | Not set — Fal default | No `guidance_scale` param passed |
| Seed | Not set — random every run | No `seed` param passed |
| Safety checker | Disabled | `enable_safety_checker: false` |
| Images per call | 1 | `num_images: 1` |
| Images per Short | **1** by default | `IMAGE_COUNT_DEFAULT = 1` in `image-config-constants.ts:9` |
| Retry | Yes — `callWithRetry`, `baseDelayMs: 2000` | `images.ts:309` |
| Fallback model | None | No fallback to a different model on error |

### Cost map (in-code)

| Model | Cost/image |
|-------|-----------|
| `fal-ai/flux/schnell` | $0.003 |
| `fal-ai/flux/dev` | $0.025 |
| `fal-ai/flux-pro/v1.1` | $0.040 |
| `fal-ai/flux-pro/v1.1-ultra` | $0.060 |

### DB override

`app_config` table keys `fal_image_model`, `image_count`, `image_steps` can be changed at runtime via `setFalImageModel()` / `setImageCount()` / `setImageSteps()` in `src/actions/app-config.ts`. **No code deploy required** to switch models.

### Can it switch models?

| Target | Can switch? | How |
|--------|------------|-----|
| Flux Dev | **Yes, immediately** | `setFalImageModel("fal-ai/flux/dev")` — already in cost map and steps map |
| Flux Pro v1.1 | Yes | Same pattern — model key already in `FAL_COST` map |
| Flux Pro Ultra | Yes | `fal-ai/flux-pro/v1.1-ultra` already in `FAL_COST` and `LONG_THUMBNAIL_FAL_MODEL_DEFAULT` |
| Per-niche override | No | Short image model is global (single `app_config` key); no per-niche short image model routing exists |

---

## 3. Prompt Quality Audit

### Prompt construction flow

1. `buildImagePromptPair()` builds system + user prompt based on `contentProfileKey`.
2. LLM (gpt-4o-mini via OpenRouter) generates N English prompts as JSON.
3. `validateImagePromptsForProfile()` checks forbidden terms.
4. `resolveImageStyle()` appends a style suffix — either a random BUDDHIST_IMAGE_STYLES entry or a random PSYCHOLOGY_IMAGE_STYLES entry.
5. `PROMPT_NO_TEXT` suffix is appended to prevent text in image.

### Buddhist profile prompt quality

The BUDDHIST_VISUAL_V1 system is well-designed:

**Strengths:**
- 13 distinct visual categories with specific prompt concepts — not generic.
- Keyword-to-category routing is deterministic (topic keyword matching → category → `promptConcept`).
- Each `promptConcept` is 30–60 words and covers: subject, pose, setting, lighting, color palette, mood, composition.
- `BUDDHIST_COMPOSITION_SUFFIX` appends: "centered sacred portrait composition, strong clear silhouette, large subject occupying 55-70% of the frame, enough clean visual space for subtitles, vertical 9:16, realistic cinematic Buddhist art, highly detailed, elegant, clean, bright, uplifting".
- Negative prompt is explicit and comprehensive (24+ exclusions including: text, watermark, dark horror, gloomy, crying, cyberpunk, cartoon, oversaturated, tiny subject).
- Three style anchors in `BUDDHIST_IMAGE_STYLES` add variety at generation time.

**Weaknesses / gaps:**
1. **`portrait_4_3` may not be optimal for 9:16 Shorts.** The size string `portrait_4_3` produces approximately 768×1024 (4:3 ratio). Shorts display at 1080×1920 (9:16). FFmpeg scales and crops this to fill the frame — but a native 9:16 image would remove the need for aggressive cropping and would use the full subject height better. The prompts say "vertical 9:16" but the API call uses `portrait_4_3`.
2. **Seed is not set.** Every generation is random. The same prompt never produces a reproducible result. No way to A/B the same scene across model upgrades.
3. **No guidance scale control.** Flux Schnell at guidance=0 (default) produces softer, less directed outputs vs. guidance=3–4. Dev model defaults to guidance≈3.5 which is noticeably more aligned.
4. **Style is randomly selected each run.** The three `BUDDHIST_IMAGE_STYLES` entries vary significantly. There is no content-topic → style routing. For a given category there is only one `promptConcept` but 3 possible style suffix variations — any of the 3 can appear regardless of category mood.
5. **The LLM-generated prompts are redundant with category prompts.** The system tells the LLM "follow BUDDHIST_VISUAL_V1 direction" and also provides the `categoryPromptHint` — but the final LLM output is then appended with the style anchor again via `resolveImageStyle()`. In practice the category concept and style anchor overlap, and the LLM may not faithfully follow the category direction. The LLM output is not validated for visual specificity.
6. **Psychology prompts have no category system.** The 3 PSYCHOLOGY_IMAGE_STYLES are generic moods (cinematic / editorial / moody). No keyword → style routing. All psychology topics get one random mood — a "sad relationship" topic might get the same "moody neon" style as a "work stress" topic.

### Example of final prompt structure (Buddhist)

```
[LLM-generated 15-30 word scene], [one of BUDDHIST_IMAGE_STYLES styles],
single unified composition, no text, no words, no letters, ...
```

The LLM instruction also includes the full `categoryPromptHint` as a reference. This is strong in theory but the final quality depends on whether gpt-4o-mini follows the direction faithfully. There is no post-generation validation of visual specificity.

### Prompt optimization opportunities

| Issue | Impact | Effort |
|-------|--------|--------|
| Change `portrait_4_3` → `portrait_16_9` or `9_16` | High — better frame use, less crop distortion | Very low |
| Add seed for reproducible experiments | Medium | Very low |
| Add `guidance_scale: 3.5` for Schnell/Dev | Medium | Very low |
| Route psychology topics to style by keyword (not random) | Medium | Low |
| Validate LLM output for visual concreteness (reject abstractions) | Medium | Medium |
| Direct-compose prompts for Buddhism instead of LLM relay | Low-medium | Medium |

---

## 4. Renderer Audit (Shorts)

### FFmpeg pipeline

Source: `src/lib/pipeline/short-video.ts`

**Input pipeline:**
- One or more static JPEG images (`-loop 1 -t <duration> -i <img>`)
- One audio track (TTS mp3, capped at 60s)
- Optional background music (volume 0.12, looped)
- Optional short cover asset (PNG overlay, fade out)

**Filter pipeline (no background music, no cover intro):**
```
scale=1080:1920:force_original_aspect_ratio=increase, crop=1080:1920, setsar=1 [v0]
[v0]concat=n=1:v=1:a=0 [vraw]
[vraw]drawbox  black@0.15  fill  (cover window)  [vdim]
[vdim]drawbox  black@0.14  top gradient  [vscrim]
[vscrim]drawbox  white bar  left accent  [vband]
[vband]ass='<cover-title.ass>'  [vcover]
[vcover]ass='<subtitles.ass>'   [vout]
```

**Video codec:** VideoToolbox (h264_videotoolbox) on Apple Silicon, libx264 fallback.

### Is the image completely static?

**Yes. The image is completely static.** There is no zoom, pan, Ken Burns, or any motion applied to the image itself. The only motion in the video is:
- Subtitles appearing/disappearing
- Cover title with `fade(70,120)` — 70ms fade-in, 120ms fade-out
- Optional cover overlay with alpha fade-out

### Motion effects currently present

| Effect | Present? | Details |
|--------|---------|---------|
| Ken Burns (zoom/pan) | **No** | Not in filter chain |
| Zoom | **No** | — |
| Pan | **No** | — |
| Particles / smoke overlay | **No** | — |
| Background music | Optional | Volume 0.12, from niche musicFolder |
| Subtitle animation | Yes | ASS-based fade per chunk |
| Cover title fade | Yes | `fad(70,120)` in ASS |
| Image sequence | Possible | Multiple images supported but `IMAGE_COUNT_DEFAULT = 1` |

---

## 5. Motion Feasibility Audit

### General notes

All options below assume FFmpeg-only implementation on the existing local render pipeline. No AI video generation. No new infrastructure.

---

### Option A: Slow zoom (Ken Burns) — 100% → 103–105% over 50–60s

**Description:** `zoompan=z='1+0.0005*n':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` applied to each image before concat.

| Property | Assessment |
|----------|-----------|
| Complexity | Low — single FFmpeg filter |
| Risk | Low — pure math transform, no quality loss |
| Performance impact | Moderate — `zoompan` is CPU-intensive; on Apple Silicon with VideoToolbox encoding this adds ~10-20s per Short |
| Quality gain | High CTR impact — static images feel "alive", reduces scroll-past rate |
| Publish pipeline impact | None — output is still H264 mp4 |
| Implementation | Add `zoompan` filter before scale in `scaleFilters` in `short-video.ts` |
| Verdict | **Recommended as Phase 1 — highest gain, lowest risk** |

---

### Option B: Smoke/particle overlay

**Description:** Pre-rendered semi-transparent smoke/particle webp or PNG sequence overlaid via `overlay` filter.

| Property | Assessment |
|----------|-----------|
| Complexity | Medium — requires pre-rendered asset library |
| Risk | Medium — must match visual theme; wrong overlay looks bad |
| Performance impact | Low if using pre-rendered file; overlay is fast |
| Quality gain | Medium — very visible on Buddhist content (incense, temple) |
| Publish pipeline impact | None |
| Implementation | Requires creating/sourcing ~5-10 smoke/particle loops (PNG sequence or webm alpha); add conditional overlay filter |
| Verdict | Worth building, but after Ken Burns is validated |

---

### Option C: Gentle vignette pulse

**Description:** Time-varying vignette using `vignette=angle=PI/4:eval=frame` — very subtle brightness pulse.

| Property | Assessment |
|----------|-----------|
| Complexity | Low |
| Risk | Very low — barely visible, no distortion |
| Performance impact | Low |
| Quality gain | Low — creates subtle "breathing" feel |
| Implementation | Single filter addition |
| Verdict | Optional enhancement, not a priority |

---

### Option D: Color grade / LUT

**Description:** Apply a warm Buddhist color grade via `lut3d` filter with a pre-built `.cube` LUT.

| Property | Assessment |
|----------|-----------|
| Complexity | Low once LUT is chosen |
| Risk | Low — reversible |
| Performance impact | Negligible |
| Quality gain | Medium — warm golden tone consistent with Buddhist aesthetic |
| Implementation | Download/create a warm LUT, add `lut3d` before subtitle pass |
| Verdict | Useful for visual consistency, low effort |

---

### Option E: Floating lantern / leaf (via overlay PNG sequences)

| Property | Assessment |
|----------|-----------|
| Complexity | High — requires per-frame animation assets |
| Risk | High — likely to look cheap without quality assets |
| Performance impact | Medium |
| Quality gain | Uncertain — risk of kitsch vs. improvement |
| Verdict | Postpone — high risk relative to effort |

---

## 6. Cost Analysis

Daily volume: ~15–16 Shorts/day × 1 image each = 15–16 images/day.

### Scenario A: Flux Schnell (current)

| Metric | Value |
|--------|-------|
| Cost/image | $0.003 |
| Daily cost | ~$0.045–0.048 |
| Monthly cost | ~$1.40 |
| Steps | 8 |
| Speed | ~1–2s per image |
| Quality | Fast draft quality. Good for high-volume backgrounds. Visible softness and detail loss at small feature level. |

### Scenario B: Flux Dev

| Metric | Value |
|--------|-------|
| Cost/image | $0.025 |
| Daily cost | ~$0.375–0.40 |
| Monthly cost | ~$11.50 |
| Steps | 28 |
| Speed | ~5–8s per image |
| Quality | Significantly sharper detail, better prompt adherence, more accurate anatomy/faces. Stronger guidance alignment. |
| Δ cost vs. Schnell | +$10/month |

### Scenario C: Flux Pro v1.1

| Metric | Value |
|--------|-------|
| Cost/image | $0.040 |
| Daily cost | ~$0.60–0.64 |
| Monthly cost | ~$18.50 |
| Steps | 28 |
| Speed | ~5–10s |
| Quality | Highest detail, professional photography quality. Diminishing returns for abstract Buddhist scenes. |
| Δ cost vs. Dev | +$7/month |

### Scenario D: Flux Pro Ultra

| Metric | Value |
|--------|-------|
| Cost/image | $0.060 |
| Daily cost | ~$0.90–0.96 |
| Monthly cost | ~$28 |
| Quality | Highest available. Most benefit for portrait-style photography. Less clear benefit for temple/statue compositions. |
| Δ cost vs. Pro | +$9.50/month |
| Operational complexity | Same API call, higher cost, no other change |

### Recommendation

**Schnell → Dev is the correct first upgrade.** $10/month delta is negligible given the volume (15-16/day). Dev produces noticeably sharper details, better guidance adherence, and more accurate Buddhist compositions — directly supporting CTR recovery.

Pro adds limited incremental gain for sacred statue/temple scenes (where overall composition matters more than micro-detail) and costs 60% more than Dev. Save Pro for thumbnail experiments only (already used for long-video thumbnails).

Pro Ultra: no justification for Shorts backgrounds at $0.06/image.

---

## 7. Experiment Tracking Audit

### What is currently tracked

| Field | Tracked? | Location |
|-------|---------|---------|
| `experimentId` | Yes | `content_generations.experiment_id` |
| `experimentVariant` | Yes | `content_generations.experiment_variant` |
| `promptVersions` | Yes (JSON) | `content_generations.prompt_versions` — includes `falModel`, `imageCount`, `styleOverride`, `buddhistVisualCategory` |
| Image model | Yes — in `promptVersions.image.details.falModel` | Written at generation time in `images.ts:352` |
| Buddhist visual category | Yes — in `promptVersions.image.details.buddhistVisualCategory` | Written at generation time |
| Inference steps | No | Not written to `promptVersions` |
| Guidance scale | No | Not passed, not tracked |
| Seed | No | Not passed, not tracked |
| Prompt text | No | The raw final prompt sent to Fal is not persisted |
| Cover text | Partial — `short_cover_engine` computes it but integration is partial (P1 planned) |
| Hook | Partial — `shortSelectedHook` stored but candidates/scores not fully joined to analytics |
| Views | Yes — `video_metric_snapshots` |
| Retention | Yes (44/79 YouTube videos) — `avg_view_duration_sec`, `retention_pct` |
| CTR / impressions | Not available (YouTube API scope limitation) |

### Can visual experiments be measured?

**Partially.** The `experimentId` + `experimentVariant` columns exist and can be assigned. `falModel` is stored per content item in `promptVersions`. However:

1. The **raw prompt** sent to Fal is not stored — impossible to attribute outcome to a specific prompt string.
2. **Inference steps** and **guidance scale** are not stored — two Dev generations with different steps can't be distinguished.
3. **Cover text** integration is P1-planned but not complete — visual experiments can't be joined to cover style.
4. Sample size (79 published, 44 with retention) is below the 300/200 threshold for automated feedback, but sufficient for human-readable experiment comparison.

### Minimum tracking additions needed before experiment

To measure Schnell vs. Dev reliably, add to `promptVersions.image.details`:
- `inferenceSteps` (numeric)
- `guidanceScale` (numeric or null)
- `seed` (numeric or null)
- `rawPrompt` (string) — the final prompt sent to Fal (first image only to save space)

---

## 8. Files Requiring Modification

Listed by experiment phase. **Audit only — no changes made.**

### Phase 1: Schnell → Dev + aspect ratio fix

| File | Change needed |
|------|--------------|
| `src/lib/image-config-constants.ts` | No code change — use `setFalImageModel("fal-ai/flux/dev")` via DB/admin UI |
| `src/lib/pipeline/images.ts:42` | Change `IMAGE_SIZE = "portrait_4_3"` → `"portrait_16_9"` (verify Fal API supports this string) |
| `src/lib/pipeline/images.ts:309–318` | Add `guidance_scale: 3.5` to Fal input; add `seed` param if reproducibility needed |
| `src/lib/pipeline/images.ts:350–362` | Add `inferenceSteps`, `guidanceScale`, `seed`, `rawPrompt` to `promptVersions.image.details` |

### Phase 2: Prompt improvements

| File | Change needed |
|------|--------------|
| `src/lib/pipeline/images.ts:55–58` | Expand `BUDDHIST_IMAGE_STYLES` — add more style anchors matching visual categories |
| `src/lib/pipeline/images.ts:76–89` | Route style by category instead of random selection for Buddhist profile |
| `src/lib/pipeline/images.ts:55–74` | Expand `PSYCHOLOGY_IMAGE_STYLES` — add keyword-to-style routing for Tầng Sâu |
| `src/lib/config/buddhist-visual-categories.ts` | (no urgent change — BUDDHIST_VISUAL_V1 is solid) |

### Phase 3: Ken Burns motion

| File | Change needed |
|------|--------------|
| `src/lib/pipeline/short-video.ts:348–351` | Replace `scaleFilters` with a zoompan variant before scale |
| `src/lib/pipeline/short-video.ts` | Add env flag `SHORT_ZOOM_ENABLED` to gate the effect |

### Phase 4: Selective Pro testing

| File | Change needed |
|------|--------------|
| `src/actions/app-config.ts` | Already supports `setFalImageModel()` — no code change needed |
| `src/lib/pipeline/images.ts` | Add per-experiment-variant model override path |

---

## 9. Risks

### Model upgrade risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Dev images are slower — pipeline render window increases | Medium | Dev takes ~5–8s vs 1–2s; at 15-16 images/day this adds ~1-2 min/day total. Acceptable. |
| Cost increase is larger than expected | Low | $10/month is negligible at current volume |
| Dev output looks different from what prompts expect | Low | Dev is better at following direction, not worse |
| `portrait_4_3` → `portrait_16_9` breaks aspect ratio crop | Medium | Verify FFmpeg scale+crop still produces 1080×1920 cleanly; test 1–2 items before full rollout |

### Motion risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `zoompan` filter significantly increases render time | Medium | Gate with `SHORT_ZOOM_ENABLED` env flag; benchmark on 5 items |
| Zoom interacts badly with subtitle safe area | Low | Zoom is small (100→103%); subtitle area is fixed-position overlay |
| Zoom + VideoToolbox codec incompatibility | Low | zoompan outputs to CPU-side; VideoToolbox encoder gets the final frames |

### Prompt risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Changing `portrait_4_3` to `portrait_16_9` — Fal may return a different native resolution | Medium | Test 3–5 images; confirm FFmpeg scale output is still clean 1080×1920 |
| Adding `guidance_scale` parameter — Fal Schnell ignores it (no guidance) | Low | Schnell uses flow matching with no cfg scale — adding it may cause API error; only set for Dev/Pro |

---

## 10. Recommended Experiment Plan (Implementation Order)

### Phase 1 — Model upgrade (Week 1)

**Goal:** Higher image quality at minimal cost delta.

Steps:
1. Add `inferenceSteps`, `guidanceScale`, `rawPrompt` tracking to `promptVersions.image.details` in `images.ts`.
2. Change `IMAGE_SIZE` from `portrait_4_3` to `portrait_16_9` (verify Fal API accepts this string; fallback to `9_16` if needed).
3. Switch `fal_image_model` in `app_config` to `fal-ai/flux/dev` via `setFalImageModel()`.
4. Assign a new `experimentId = "IMAGE_QUALITY/DEV_V1"` to new content items.
5. Generate 15–20 Shorts on Dev; compare image files visually vs. Schnell baseline.
6. Publish and collect retention for 30+ videos before drawing conclusions.

**Commit scope:** 2 files (`images.ts`, optionally `image-config-constants.ts`). No renderer changes.

---

### Phase 2 — Prompt improvements (Week 2–3)

**Goal:** Make prompts more visual-specific and CTR-optimized.

Steps:
1. For Buddhist profile: route style anchor by visual category (not random). Each category maps to its most fitting style anchor.
2. For Psychology profile: add 3–4 keyword→style routing rules (relationship, work-stress, loneliness, self-worth).
3. Add `guidance_scale: 3.5` to Dev calls (not Schnell — Schnell ignores it and may error).
4. Optional: add direct Buddhist prompt path (skip LLM, use `buildBuddhistImagePrompt()` output directly as the generation prompt — bypassing gpt-4o-mini relay and saving ~$0.0001/image).

**Commit scope:** `images.ts` prompt logic only. No renderer or model changes.

---

### Phase 3 — Ken Burns motion (Week 3–4)

**Goal:** Reduce static feel; test whether motion improves retention.

Steps:
1. Add `SHORT_ZOOM_ENABLED=false` env flag (default off).
2. Add zoompan filter to `scaleFilters` in `short-video.ts`, gated by flag: `zoompan=z='1+(0.0005*n)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=<total_frames>:fps=30`.
3. Benchmark render time on 5 items.
4. Assign `experimentId = "MOTION/ZOOM_V1"` and publish 20–30 videos with zoom enabled.
5. Compare avg retention vs. non-zoom baseline.

**Commit scope:** `short-video.ts` (filter chain), one env flag.

---

### Phase 4 — Selective Pro testing (Week 5+)

**Goal:** Evaluate whether Pro quality justifies 60% cost premium over Dev.

Steps:
1. Only after Dev baseline has 30+ published videos with retention data.
2. Assign `experimentId = "IMAGE_QUALITY/PRO_V1"` to 10–15 items.
3. Switch model for those items only (per-experiment override in images.ts).
4. Compare views/retention vs. Dev variant with enough sample size.

**Commit scope:** Small override in images.ts; `app_config` key change.

---

### What not to do yet

- Do not add smoke/particle overlays before Ken Burns is validated (higher effort, higher risk).
- Do not switch to Pro Ultra for Shorts (no ROI at current volume vs. Dev quality).
- Do not change the LLM model for prompt generation (gpt-4o-mini is adequate for this structured task).
- Do not add automatic feedback loop into prompts until 300+ published videos + 200 with retention (per data sufficiency rules in `PROJECT_MASTER_PLAN.md`).
- Do not change the thumbnail model for Shorts (`short-video.ts` thumbnail is extracted from the video frame, not AI-generated separately).

---

## Summary

| Area | Current state | Biggest gap | Recommended action |
|------|--------------|-------------|-------------------|
| Image model | Flux Schnell ($0.003) | Below-optimal quality | Switch to Flux Dev immediately |
| Image size | `portrait_4_3` (not native 9:16) | Crop distortion | Change to `portrait_16_9` |
| Prompt quality | BUDDHIST_VISUAL_V1 solid; psychology weaker | Style is random, not routed | Route style by category/keyword |
| Motion | Fully static | No visual movement | Add Ken Burns zoom |
| Tracking | `falModel` stored; steps/seed/rawPrompt not stored | Can't debug prompt→quality link | Add 3 fields to promptVersions |
| Cost | ~$1.40/month Schnell | None at current volume | Dev: ~$11.50/month — acceptable |
| Experiment infra | experimentId/variant exist | Integration incomplete | Wire new experiment IDs to image config changes |
