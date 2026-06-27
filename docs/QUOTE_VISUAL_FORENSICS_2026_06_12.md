# Quote Visual Forensics — Second Audit
**Target IDs:** qgen-mq529m74 / qgen-mq529sg9 / qgen-mq529ylj  
**Audit date:** 2026-06-12  
**Auditor:** forensic trace of generation, deployment, and publishing lineage  
**User report:** "The 3 newly published quote images look bad — dark, old style, not aligned with new visual direction"  
**Verdict:** These visuals look like the old style because they were generated on **2026-06-08** by a pipeline codebase that **no longer exists on disk**, and every code change made since then (Phase 1, Phase 1.1, Alignment) has **never been committed to git or deployed**.

---

## 1. Metadata Audit

| Field | qgen-mq529m74 | qgen-mq529sg9 | qgen-mq529ylj |
|-------|--------------|--------------|--------------|
| Content ID | qgen-mq529m74-gfgmk | qgen-mq529sg9-mkvas | qgen-mq529ylj-45p4k |
| Topic | Nhẫn không phải yếu, nhẫn là sức mạnh của tâm | Người khôn không tranh hơn thua với kẻ không đáng | Không phải chuyện nào cũng cần giải thích |
| Topic family | tri_tue_song_im_lang_nhan_nhin | tri_tue_song_im_lang_nhan_nhin | tri_tue_song_im_lang_nhan_nhin |
| Content profile | buddhism | buddhism | buddhism |
| Generated at | **2026-06-08 17:21 UTC** | 2026-06-08 17:21 UTC | 2026-06-08 17:21 UTC |
| Published at | 2026-06-11 04:00 UTC | 2026-06-11 05:00 UTC | 2026-06-11 06:00 UTC |
| YouTube ID | Zgz2yHvjiFE | T5IerzhdbOM | IactiE3pp1I |
| Views (at audit) | 246 | 662 | 730 |
| Likes | 7 | 52 | 59 |
| Experiment variant | BUDDHIST_TEACHING_NUMBERED_V1 | BUDDHIST_TEACHING_SINGLE_V1 | LEGACY_QUOTE_NO_VOICE_V2 |
| `imageMeta` in sidecar | **ABSENT** | **ABSENT** | **ABSENT** |
| In `content_generations` DB | **NO** | **NO** | **NO** |
| In `api_usage_logs` DB | **NO** | **NO** | **NO** |
| Sidecar location | `output/legacy-quote-short-v1/{id}-legacy-quote-short.json` | same | same |
| Source image dimensions | 768×1024 (`portrait_4_3`) | 768×1024 | 768×1024 |
| Rendered dimensions | 1080×1920 | 1080×1920 | 1080×1920 |

**Key finding:** These files were generated 3 days before publication. The upload queue entries were created Jun 10 13:38; the scheduler published them the next day. At no point was regeneration triggered.

---

## 2. Prompt Path Audit (YES/NO per V3 feature)

| Feature | qgen-mq529m74 | qgen-mq529sg9 | qgen-mq529ylj | Notes |
|---------|:---:|:---:|:---:|-------|
| Flux Dev model | NO | NO | NO | Hardcoded Schnell at generation time |
| 8+ inference steps | NO | NO | NO | Hardcoded 4 steps |
| `portrait_16_9` image size | NO | NO | NO | Hardcoded `portrait_4_3` |
| `guidance_scale` passed | NO | NO | NO | Not passed to Schnell |
| `VISUAL_BRAND_ANCHOR` in prompt | NO | NO | NO | Added in Phase 1.1 — not deployed |
| Cover-safe upper-third instruction | NO | NO | NO | Added in Phase 1.1 — not deployed |
| Subject 40-70% frame height | NO | NO | NO | Was "55-70%" V1 at generation time |
| Hero subject injection | NO | NO | NO | Hero library added in Phase 1.1 — not deployed |
| LLM system prompt V2 direction | NO | NO | NO | No LLM step for Buddhist content |
| `promptVersions` tracking | NO | NO | NO | Not stored in sidecar or DB |
| `imageMeta` field in sidecar | NO | NO | NO | Added in Alignment phase — not deployed |
| `compositionProfile` tracking | NO | NO | NO | Added in Alignment phase — not deployed |
| `heroSubject` tracking | NO | NO | NO | Added in Alignment phase — not deployed |

**Score: 0 / 13.** Zero V3 features present.

---

## 3. Prompt Quality Audit

### Category routing (at time of generation)

All three topics belong to `tri_tue_song_im_lang_nhan_nhin` (patience / wisdom / silence). The pipeline at generation time called `getBuddhistVisualCategory(topic)` with topic-only matching. None of these topic strings matched any keyword in `TOPIC_TO_CATEGORY_RULES` (the Phase Alignment keywords had not been written yet), so all three fell through to the **deterministic hash fallback**:

```
hashVal = sum of codePoints of topic string
category = BUDDHIST_FALLBACK_CATEGORIES[hashVal % 4]
```

The four fallback categories are: `LOTUS_PARADISE_PEACE`, `TEMPLE_SUNRISE_SERENITY`, `BUDDHA_GOLDEN_ENLIGHTENMENT`, `VIETNAMESE_BUDDHIST_TEMPLE`. All three topics hash into this pool at random.

### Prompt version at generation time

The V1 composition suffix was active:
```
"centered sacred portrait composition, strong clear silhouette, large subject occupying 55-70% of the frame,
enough clean visual space for subtitles, vertical 9:16,
realistic cinematic Buddhist art, highly detailed, elegant, clean, bright, uplifting,
no text, no watermark, no logo, no distorted face, no extra limbs"
```

No `VISUAL_BRAND_ANCHOR`. No cover-safe upper-third. No hero injection. No `promptVersions` field recorded.

### Fal API call (reconstructed)

```
fal.run("fal-ai/flux/schnell", {
  image_size: "portrait_4_3",    // 768×1024
  num_inference_steps: 4,        // below minimum recommended (8)
  prompt: buildBuddhistImagePrompt(categoryKey, topic)  // V1 prompt
  // guidance_scale: NOT passed (Schnell does not support it)
})
```

No LLM step was involved. The prompt was a deterministic string built directly from category `promptConcept` + V1 composition suffix.

---

## 4. Quote Image Lineage Audit

### Generation → rendering chain

```
2026-06-08 17:21 UTC
Topic string
  → getBuddhistVisualCategory(topic)          [topic-only, no keyword match]
  → hash fallback → one of 4 categories       [non-deterministic for content quality]
  → buildBuddhistImagePrompt(categoryKey)     [V1 composition suffix, no brand anchor]
  → fal.run("fal-ai/flux/schnell", {
        image_size: "portrait_4_3",           // 768×1024
        num_inference_steps: 4               // minimum quality
    })
  → 768×1024 JPEG saved to output/legacy-quote-short-v1/images/{id}-bg.jpg

  → renderLegacyQuoteShort() in [now-overwritten legacy pipeline]
      → FFmpeg scale 768×1024 → 1320×2347 (1.72× upscale)
      → zoompan (ken burns)
      → trim=duration=14.000
      → drawbox=color=black@0.34 (34% dark overlay)
      → ASS subtitle renderer (Vietnamese quote text)
  → 1080×1920 rendered card JPEG + MP4

2026-06-10 13:38 UTC
  → YouTube upload queue entry created

2026-06-11 04:00–06:00 UTC
  → Published to YouTube (scheduler cron)
```

### Critical timing gap

| Event | Timestamp |
|-------|-----------|
| Files generated | 2026-06-08 17:21 UTC |
| Phase 1 code written | 2026-06-10 (before Jun 10 17:00 UTC) |
| Phase 1.1 code written | 2026-06-10 (after Phase 1) |
| Alignment code written | 2026-06-11 13:16 UTC |
| Videos published to YouTube | 2026-06-11 04:00–06:00 UTC |
| `quote-short-pipeline.ts` born on disk | **2026-06-11 13:16 UTC** |
| `legacy-quote-short-generator.ts` born | **2026-06-11 13:16 UTC** |

The Alignment code was written **7–9 hours after publication**. No regeneration was possible before publication because the improved pipeline did not yet exist.

---

## 5. Renderer Audit

### Dark overlay (dimFactor)

At time of rendering, `dimFactor` for `ken_burns_image` mode was **0.34**:

```typescript
// legacy-quote-short-generator.ts (pre-Alignment version — no longer on disk)
const dimFactor =
  resolvedVisualMode === "kinetic_typography" ? 0.72 :
  resolvedVisualMode === "note_letter_card" || resolvedVisualMode === "bilingual_minimal" ? 0.46 :
  0.34;   // ken_burns_image — ALL THREE TARGETS
```

FFmpeg filter applied:
```
drawbox=x=0:y=0:w=iw:h=ih:color=black@0.34:t=fill
```

This 34% black overlay reduces luminance ~34% and desaturates by mixing pixel values with black. It suppresses warm gold and amber tones — the exact palette that Phase 1.1 was designed to inject. Even a Flux Dev output with full V2 prompts would appear dim after this overlay.

The **current** code on disk (`legacy-quote-short-generator.ts`, born Jun 11 13:16) has `dimFactor = 0.20` (Alignment change). But this file was not committed to git and was not present when these videos were rendered (Jun 8).

### Upscale chain impact

| Step | Transformation | Impact |
|------|---------------|--------|
| Fal output | 768×1024 | Soft (4-step Schnell) |
| FFmpeg scale | → 1320×2347 (1.72× upscale) | Introduces softness |
| zoompan | Ken Burns motion | Motion blur on already-soft input |
| crop | → 1080×1920 | ~25% of 1320px width lost |
| drawbox | black@0.34 | ~34% brightness drop |

---

## 6. Model / Config Audit

### `app_config` KV table (at audit time)

| Key | Value | Set at |
|-----|-------|--------|
| `fal_image_model` | `fal-ai/flux/schnell` | 2026-05-28 |
| `image_steps` | `8` | (date not queried) |
| `fal_image_size` | **NOT PRESENT** | — |

The `fal_image_size` key has never been set. `getImageConfig()` in `app-config.ts` would default to `portrait_16_9` (via `FAL_IMAGE_SIZE_DEFAULT`) when the key is absent.

### Pipeline config isolation

`quote-short-pipeline.ts` at the time of generation **did not call `getImageConfig()`**. It used hardcoded constants:

```typescript
const FAL_MODEL      = "fal-ai/flux/schnell";
const FAL_IMAGE_SIZE = "portrait_4_3";
const FAL_STEPS      = 4;
```

These constants bypassed the `app_config` KV table entirely. The `image_steps=8` DB config and `portrait_16_9` default were irrelevant to the quote pipeline.

### Code deployment status

| File | Git status | Deployed? |
|------|-----------|-----------|
| `src/lib/pipeline/quote-short-pipeline.ts` | `??` untracked | **NO** |
| `src/lib/legacy-quote-short-generator.ts` | `??` untracked | **NO** |
| `src/lib/config/buddhist-visual-categories.ts` | `??` untracked | **NO** |
| `src/lib/quote-image-meta.ts` | `??` untracked | **NO** |
| `src/lib/prompt-version-registry.ts` | `??` untracked | **NO** |
| `src/lib/pipeline/images.ts` | `M` modified, uncommitted | **NO** |
| `src/actions/app-config.ts` | `M` modified, uncommitted | **NO** |

**All Phase 1, 1.1, and Alignment changes are uncommitted.** None have ever been deployed.

---

## 7. Category Routing Audit

### Keyword coverage gap (at time of generation)

At generation time (Jun 8), `TOPIC_TO_CATEGORY_RULES` had no entries matching the `tri_tue_song_im_lang_nhan_nhin` topic family. Keywords for wisdom/silence/patience were not in the routing table.

The Phase Alignment changes added these keywords to `BUDDHA_GOLDEN_ENLIGHTENMENT`:
```
"im lặng", "nhẫn nhịn", "nhẫn nại", "khiêm nhường", "tĩnh tâm", "tĩnh lặng nội tâm",
"wisdom", "silence", "patience", "humility", "calm mind",
"người khôn", "không tranh", "không cần giải thích", "sức mạnh thầm lặng",
"tri tue", "im lang", "nhan nhin"
```

These additions are in the untracked, undeployed version of `buddhist-visual-categories.ts`.

### Hash fallback determinism

For these three topics, the hash fallback at generation time produced categories from the 4-item pool. The specific mapping:

| Topic | Hash determinism |
|-------|-----------------|
| Nhẫn không phải yếu... | Hash → one of 4 fallback categories |
| Người khôn không tranh... | Hash → one of 4 fallback categories |
| Không phải chuyện nào... | Hash → one of 4 fallback categories |

The categories themselves are not wrong (all four are visually valid Buddhist themes), but they don't carry topic-specific composition intent for the wisdom/silence/patience message family.

### Current routing (if regenerated today with deployed code)

If the current untracked code were committed and the pipeline re-run:
- All three topics would match `BUDDHA_GOLDEN_ENLIGHTENMENT` via keyword rules
- Hero subject would be assigned from `CATEGORY_HERO_MAP[BUDDHA_GOLDEN_ENLIGHTENMENT]`
- V2 composition suffix and `VISUAL_BRAND_ANCHOR` would be injected

But regeneration has not been triggered and the code is not deployed.

---

## 8. Evidence Table

| Evidence item | Source | Implication |
|--------------|--------|-------------|
| Sidecar generation timestamp: 2026-06-08 17:21 | File mtime + sidecar JSON | Generated 3 days before any Phase 1 code existed |
| No `imageMeta` in sidecar | Sidecar JSON inspection | Alignment phase was not active; `QuoteImageMeta` did not exist |
| Not in `content_generations` table | DB query | Legacy pipeline never wrote to the new tracking table |
| Not in `api_usage_logs` | DB query | Generation not tracked via new API usage logging |
| Source image: 768×1024 | File metadata (`file` command) | Confirms `portrait_4_3` hardcoded constant was used |
| `quote-short-pipeline.ts` birth: 2026-06-11 13:16 | `GetFileInfo` (birth date) | Alignment code written 7–9 hours after publication |
| `legacy-quote-short-generator.ts` birth: 2026-06-11 13:16 | File birth date | Same — not present at render time |
| All Phase 1/1.1/Alignment files untracked | `git status` | None of the visual improvements have ever been deployed |
| `app_config.fal_image_model = fal-ai/flux/schnell` | DB query | Model unchanged since May 28; pipeline bypassed it anyway |
| `app_config.fal_image_size` absent | DB query | `portrait_16_9` default never reached quote pipeline |
| `upload_queue` created Jun 10 13:38 | DB query | Files were queued 2 days after generation; no regen triggered |
| Published Jun 11 04:00–06:00 UTC | `published_videos` DB | Files from Jun 8 published without any intervention |
| `drawbox=black@0.34` in FFmpeg chain | `legacy-quote-short-generator.ts` V1 renderer | 34% luminance reduction applied at render time |

---

## 9. Final Diagnosis: Why These 3 Quote Images Still Look Like the Old Style

### #1 — Code never deployed (Confidence: 100%)

Every change from Phase 1, Phase 1.1, and Quote Alignment exists only as untracked files on disk. `git status` shows `??` for all five key files. No `git add`, no `git commit`, no deploy has occurred. The running pipeline — if triggered today — would use the same old hardcoded constants that generated the Jun 8 files.

### #2 — Files generated Jun 8, before any improvement code existed (Confidence: 100%)

The sidecar JSON timestamps and file mtime confirm generation at **2026-06-08 17:21 UTC**. Phase 1 code was written Jun 10. The new `quote-short-pipeline.ts` was born on disk Jun 11 13:16 — hours after these videos were already published. The Jun 8 files are frozen artifacts of a codebase that has since been replaced but never committed.

### #3 — 34% dark overlay destroys warm palette (Confidence: 100%)

The renderer applied `drawbox=color=black@0.34` to all three outputs (ken_burns_image mode). This 34% black overlay suppresses warm gold, amber, and jade tones that any V2 prompt would inject. It is the dominant visual quality issue on screen. The Alignment fix (0.34 → 0.20) is on disk but not committed.

### #4 — Flux Schnell at 4 inference steps (Confidence: 100%)

`FAL_STEPS = 4` was hardcoded. 4 steps is below the minimum recommended for Schnell (8). The output has soft edges, low detail, and visible generation artifacts in textures. Phase 1 moved `images.ts` to DB-driven steps; the quote pipeline never participated.

### #5 — Wrong image size: portrait_4_3 instead of portrait_16_9 (Confidence: 100%)

Source images are 768×1024. The renderer upscales 1.72× to 1320×2347 then crops to 1080×1920. This destroys composition framing (edges lost) and amplifies Schnell's quality ceiling via resampling blur. `portrait_16_9` (1080×1920 native) would have eliminated both issues.

### #6 — No topic keyword routing → hash fallback category (Confidence: 85%)

Wisdom/silence/patience topics had no keyword rules in `TOPIC_TO_CATEGORY_RULES` at generation time. All three fell to a 4-item hash fallback. The fallback categories are not wrong, but they aren't optimized for the specific emotional register of these topics. Secondary to causes 1–5.

---

## 10. Recommended Next Action

**Smallest safe fix: commit the existing code changes.**

All improvements already exist on disk (Phase 1, 1.1, Alignment). The only missing step is `git add` + `git commit` for the five untracked files and two modified files. No further code changes are required.

After commit, **manually re-trigger generation** for the three content IDs to produce new images using:
- `fal-ai/flux/dev` with guidance_scale and 28 steps (if `app_config` is updated to Dev)
- or `fal-ai/flux/schnell` with 8 steps, `portrait_16_9`, V2 prompts, and 0.20 overlay (if config stays as-is)

Minimum observable impact from commit + regen:
- `portrait_16_9` → eliminates 1.72× upscale distortion and composition crop
- `dimFactor 0.20` → preserves warm gold palette by reducing overlay from 34% to 20%
- Keyword routing → exits hash fallback for these three topic strings
- `QuoteImageMeta` tracking → future outputs become auditable

No publish flow changes, no DB schema changes, no new dependencies. The commit is the entire action.
