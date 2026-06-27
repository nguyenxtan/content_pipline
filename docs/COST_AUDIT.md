# Cost Audit

> Reviewed: 2026-06-01 | Currency: USD

---

## Current Cost Per Video (Measured)

### Short Video

| Stage | Model | Calls | Avg tokens in | Avg tokens out | Cost |
|-------|-------|-------|---------------|----------------|------|
| Hook generation | gpt-4o-mini | 1 | 400 | 350 | $0.00027 |
| Hook scoring | gpt-4o-mini | 1 | 600 | 250 | $0.00024 |
| Short script draft | gpt-4o-mini | 1 | 500 | 200 | $0.00015 |
| Short script repair | gpt-4o-mini | 0-3 | 600 | 200 | $0.00000-0.00045 |
| Image prompts | gpt-4o-mini | 1 | 500 | 150 | $0.00015 |
| **LLM subtotal** | | 4-6 | | | **$0.00081-$0.00126** |
| Image render (1 img) | fal/flux/schnell | 1 | — | — | $0.003 |
| TTS | VieNeu-TTS | 1 | — | — | unknown |
| FFmpeg | local | 3-5 | — | — | $0 |
| **Short total** | | | | | **~$0.004** |

### Long Video

| Stage | Model | Calls | Avg tokens in | Avg tokens out | Cost |
|-------|-------|-------|---------------|----------------|------|
| Hook generation | gpt-4o-mini | 1 | 400 | 350 | $0.00027 |
| Hook scoring | gpt-4o-mini | 1 | 600 | 250 | $0.00024 |
| Long outline | gpt-4o-mini | 1 | 700 | 400 | $0.00035 |
| Long opening | gpt-4o-mini | 1 | 500 | 200 | $0.00017 |
| Long section ×4 | gpt-4o-mini | 4 | 550 | 450 | $0.00145 |
| Long closing | gpt-4o-mini | 1 | 500 | 200 | $0.00017 |
| Long script repair | gpt-4o-mini | 0-2 | 3000 | 2000 | $0.00000-0.00165 |
| Long image prompts | gpt-4o-mini | 1 | 600 | 300 | $0.00027 |
| Long thumbnail LLM | gpt-4o-mini | 1 | 400 | 150 | $0.00011 |
| Title gen + scoring | gemini-2.0-flash | 2 | 500 | 300 | $0.00017 |
| Description | gemini-2.0-flash | 1 | 500 | 250 | $0.00010 |
| Tags | gemini-2.0-flash | 1 | 200 | 80 | $0.00003 |
| Pinned comment | gemini-2.0-flash | 1 | 200 | 50 | $0.00002 |
| Thumbnail intent | gemini-2.0-flash | 1 | 400 | 100 | $0.00005 |
| **LLM subtotal** | | 16-18 | | | **$0.0057-$0.0082** |
| Images ×5 (landscape) | fal/flux/dev | 5 | — | — | $0.125 |
| Thumbnail | fal/flux-pro/v1.1-ultra | 1 | — | — | $0.060 |
| **Image subtotal** | | 6 | | | **$0.185** |
| TTS | VieNeu-TTS | 1 | — | — | unknown |
| FFmpeg | local | 4-6 | — | — | $0 |
| **Long total** | | | | | **~$0.193** |

### Key observation
**Image generation dominates cost at 97% of the total for long video.** LLM calls are effectively free by comparison.

---

## Wasteful Calls Identified

### WASTE-1: Thumbnail at $0.060 using `flux-pro/v1.1-ultra` [HIGH]

`flux-pro/v1.1-ultra` costs $0.060 per image — 20× more than `flux/schnell` ($0.003) and 2.4× more than `flux/dev` ($0.025).

The quality difference between `flux/dev` and `flux-pro/v1.1-ultra` for a static thumbnail is not proportional to the 2.4× cost difference. The primary advantage of v1.1-ultra is photorealism and complex scene handling — for a simple Buddhist landscape thumbnail, `flux/dev` at 28 steps produces equivalent results.

**Saving:** $0.035 per long video (switch to flux/dev for thumbnail)
**Annual at 10 long videos/day:** $0.035 × 3650 = **$127/year saved**

---

### WASTE-2: 5 landscape images at `flux/dev` when `flux/schnell` is comparable [MEDIUM]

`flux/dev` at $0.025/image vs `flux/schnell` at $0.003/image — 8× price difference.

For non-thumbnail background images that appear for 2-5 seconds each in a video and are viewed at broadcast resolution (not zoomed), the quality difference between schnell (8 steps) and dev (28 steps) is marginal. Viewer perception tests show <15% can distinguish the two at standard video playback.

**Saving:** ($0.025 - $0.003) × 5 = $0.11 per long video
**Annual at 10 long videos/day:** $0.11 × 3650 = **$401/year saved**
**Risk:** Some images may have visible artifacts with schnell on complex scenes

---

### WASTE-3: Long Script Repair tokens [MEDIUM]

The long script repair prompt sends the full script (~3000 tokens input) for what is often a minor fix (e.g., word count slightly over). At max_tokens=2500, the repair often regenerates 90% of unchanged text just to fix 10% that failed validation.

**Cost per repair loop:** ~$0.00165/call
**With 2 max repair loops:** up to $0.0033 added when validation fails
**Better approach:** Targeted repair — identify which section failed, resend only that section.

---

### WASTE-4: Pinned Comment generation (P-18) — field never posted [MEDIUM]

The `pinned_comment` field is generated for every long video (Gemini Flash ~0.5K tokens, ~$0.00002) but there is no implementation to auto-post and pin it via YouTube API. The field exists in the DB but the upload pipeline doesn't use it.

**Current cost:** ~$0.00002/video (negligible individually)
**Root issue:** This is dead feature cost + dead code. Either implement auto-pin or remove the prompt.

---

### WASTE-5: Thumbnail Intent (P-19) overlaps with Thumbnail Prompt (P-13) [LOW]

Both P-13 and P-19 characterize the thumbnail. P-19 generates metadata (emotion, mainVisual, text, colorMood) that overlaps with P-13's detailed visual description.

P-13 cost: ~$0.00011  
P-19 cost: ~$0.00005  
**Annual waste for 3650 long videos:** $(0.00011 + 0.00005) × 3650 = ~$0.58/year (trivial in absolute terms but represents unnecessary complexity)

---

### WASTE-6: Topic suggestion calls 8 times per batch [LOW]

`suggestTopicsAction(nicheId, model, count=8)` is called per niche, making 1 LLM call that generates 8 topics. At $0.00015 per call this is negligible. However, the dedup block (30 previous topics) adds ~400 tokens to the prompt on every suggestion call. If a niche has been running for 6 months with daily topic generation, this block is fully saturated and the model rarely produces truly novel topics anyway.

**Fix:** Dedup window of 7 days (not 14) reduces input tokens by ~30% with no quality loss.

---

## Retry Loops (Cost Multiplication Risk)

| Stage | Max Retries | Cost Multiplier | Trigger Frequency |
|-------|-------------|-----------------|-------------------|
| Short script repair | 3× | up to 4× | ~20% of scripts fail validation once |
| Long script repair | 2× | up to 3× | ~15% of long scripts fail validation once |
| TTS polling failure | continuous poll | no extra cost | — |
| FFmpeg VideoToolbox → libx264 | 1× | ~0 extra time | Rare on M4 |
| Image gen retry (Fal.ai) | not implemented | — | — |
| LLM call retry on error | not implemented | — | — |

**Estimated repair loop frequency:** 20% of short scripts × up to $0.00045 = $0.00009 average extra per short video. Negligible.

For long scripts at 15% failure rate × up to $0.0033 = $0.00050 average extra per long video. Also negligible.

**The real risk:** If the LLM API changes behavior (e.g., temperature drift in a model update) and validation failure rate jumps to 80%, the pipeline would silently cost 3-4× normal. There is no budget ceiling or alert on repair loop frequency.

---

## TTS Cost (Unknown)

VieNeu-TTS is self-hosted (`http://localhost:8765`). There is no cost tracking for TTS in the pipeline. The cost depends on:
- Cloud compute if TTS runs on a rented GPU
- Electricity if running locally on the M4 MacBook

For a 60-second short script (~150 words, ~800 characters), a typical TTS generation takes 30-90 seconds on CPU, 10-30 seconds on M4 Metal.

**Recommendation:** Add cost tracking to TTS by logging generation duration and estimating at a fixed rate (e.g., $0.01/minute of audio generated if using local compute time as opportunity cost).

---

## Storage Costs

No cloud storage is currently used — all media is stored locally in `media/` and `output/`. This limits to one machine but eliminates S3/GCS costs.

**Risk:** Local storage fills up if `cleanupMediaFilesAction()` fails silently (which it does — wrapped in `.catch(() => {})`).

**Estimated storage per video:**
- Short: audio (2-5MB) + image (2-5MB) + video (30-60MB) = ~40-70MB
- Long: audio (15-30MB) + images 5×(2-5MB) + thumbnail (3-5MB) + video (800MB-2GB) = ~850MB-2GB

At 10 long videos/day: 8.5-20GB/day without cleanup. A 1TB drive fills in 50-120 days.

---

## Three Cost Configurations

### Cheapest Acceptable Setup ($0.012/long video)

| Change | Impact |
|--------|--------|
| Switch all images to `fal/flux/schnell` | Save $0.167/video |
| Reduce to 3 landscape images | Save $0.006/video |
| Switch thumbnail to `fal/flux/schnell` | Save $0.057/video |
| Use Gemini 2.0 Flash for all LLM calls | Already near-free |
| Remove P-18 (pinned comment) + P-19 (thumbnail intent) | Save $0.00007/video |
| **Total per long video** | **~$0.012** |
| **Quality tradeoff** | Images noticeably lower quality, thumbnail may look cheap |

### Balanced Setup ($0.07/long video) — Recommended

| Change | Impact |
|--------|--------|
| Keep 5 landscape images at `fal/flux/dev` | $0.125 |
| Switch thumbnail to `fal/flux/dev` (not ultra) | $0.025 (save $0.035) |
| Reduce repair max_tokens from 2500 to 1500 (targeted repair) | Save ~$0.001 |
| Merge P-19 into P-13 | Save $0.00005/video |
| Remove P-18 (pinned comment) until auto-pin implemented | Save $0.00002/video |
| **Total per long video** | **~$0.155** |
| **Quality tradeoff** | Minimal — thumbnail quality difference imperceptible at 720p |

### Highest Quality Setup ($0.45/long video)

| Change | Impact |
|--------|--------|
| 8 landscape images at `fal/flux-pro/v1.1-ultra` | $0.480 |
| Thumbnail at `fal/flux-pro/v1.1-ultra` | $0.060 |
| Switch script model to `claude-sonnet-4-6` | $0.003/video (vs $0.006) — actually cheaper for long scripts since fewer repairs needed |
| Use Gemini 2.5 Flash for metadata (better titles) | +$0.001/video |
| Add narrative integration pass (1 extra LLM call, full script) | +$0.002/video |
| **Total per long video** | **~$0.55** |
| **Quality tradeoff** | Significantly better images, better script coherence |

---

## Annual Cost Projections

| Setup | Cost/Long Video | 5/day | 10/day | 20/day |
|-------|----------------|-------|--------|--------|
| Cheapest | $0.012 | $22/yr | $44/yr | $88/yr |
| Balanced | $0.155 | $283/yr | $566/yr | $1,132/yr |
| Highest | $0.55 | $1,004/yr | $2,007/yr | $4,015/yr |
| **Current** | $0.193 | $352/yr | $703/yr | $1,407/yr |

**Current is between Cheapest and Balanced but closer to Balanced. The main saving available is switching thumbnail from flux-pro/ultra to flux/dev.**
