# Architectural Decision Records

> Reviewed: 2026-06-01 | Inferred from source code, configuration, environment variables, and documentation.

---

# AI Agent Instructions

Before proposing a replacement for any system documented here:

1. Read this file.
2. Understand why the current decision was made.
3. Explain specifically why the original decision is no longer valid.
4. Estimate migration cost (hours of engineering + risk of data loss or downtime).
5. Estimate expected benefit (quantified: latency reduction, cost reduction, quality improvement).

**Do not recommend replacing systems without a clear ROI argument.** "X is more modern" or "X has better DX" are not ROI arguments.

---

## Index

| ID | Title | Status |
|----|-------|--------|
| ADR-001 | OpenRouter as LLM Proxy | Accepted |
| ADR-002 | gpt-4o-mini as Default Script Model | Accepted |
| ADR-003 | gemini-2.0-flash for Longform Metadata | Accepted |
| ADR-004 | Per-Niche Model Override via DB | Accepted |
| ADR-005 | VieNeu-TTS via Local HTTP API | Accepted |
| ADR-006 | Fal.ai for Image Generation | Accepted |
| ADR-007 | Tiered Image Quality Strategy | Accepted |
| ADR-008 | FFmpeg with VideoToolbox Hardware Encoding | Accepted |
| ADR-009 | Python Subprocess for Whisper Transcription | Accepted |
| ADR-010 | Cron-Based Pipeline Orchestration | Accepted |
| ADR-011 | Multi-Stage Long Script Generation | Accepted |
| ADR-012 | Hook Engine: Generate-Then-Score Pattern | Accepted |
| ADR-013 | TTS Result Caching via Script Hash | Accepted |
| ADR-014 | Error Swallowing with DB Persistence | Accepted |
| ADR-015 | contentGenerations as God Object Table | Accepted |
| ADR-016 | uploadQueue + publishedVideos Separation | Accepted |
| ADR-017 | Analytics via Polling (Not Webhooks) | Accepted |
| ADR-018 | Per-Niche Prompt Templates in DB | Accepted |
| ADR-019 | Relative File Paths in DB | Accepted |
| ADR-020 | Apple Silicon Detection and Auto-Scaling | Accepted |
| ADR-021 | Model and Image Quality Routing Strategy | Accepted |
| ADR-022 | Upload Queue Dedupe Includes 'cancelled' Status | Accepted |
| ADR-023 | TTS Punctuation Pause Injection Gated Behind Feature Flag | Accepted |
| ADR-024 | Loudnorm-Only Audio Normalization for phat_phap TTS | Accepted |
| ADR-027 | Upload Slot Occupancy Includes Done Rows | Accepted |
| ADR-028 | Backlog Drain Requires Operator-Safe Handling | Accepted |
| ADR-029 | YouTube Quota Rotation vs OAuth Health | Accepted |
| ADR-030 | Telegram Notifications Must Not Block Publishing | Accepted |
| ADR-031 | Static Deep Quote Guard for phat_phap and tang_sau | Accepted |
| ADR-032 | Quote Pipeline V1 Stays Sidecar-First | Accepted |
| ADR-033 | Tầng Sâu Quote Automation Is YouTube-First | Accepted |
| ADR-034 | phat_phap Hourly Slots Are Content Items, Not Platform Rows | Accepted |
| ADR-035 | YouTube OAuth Account Is Not the Publishing Destination | Accepted |

---

## ADR-001: OpenRouter as LLM Proxy

**Status:** Accepted

**Context:**

The pipeline calls LLM APIs from multiple providers: OpenAI (gpt-4o-mini), Google (gemini-2.0-flash), and Anthropic (claude-sonnet-4-6 as default in promptTemplates schema). Managing three separate API keys, three separate SDKs, and three separate rate limit budgets adds operational complexity.

**Decision:**

Use OpenRouter (`https://openrouter.ai/api/v1`) as the single LLM endpoint, accessed via the OpenAI SDK with `OPENROUTER_API_KEY`. All LLM calls — regardless of underlying provider — go through a single `createClient()` call in `src/lib/llm-client.ts`.

**Evidence from code:**

```typescript
// src/lib/llm-client.ts
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

**Alternatives Considered:**

- Direct provider APIs (OpenAI SDK for OpenAI, Google AI SDK for Gemini) — rejected because it requires managing multiple API keys and client instances
- LangChain/LiteLLM locally — rejected because it adds infrastructure complexity with no benefit over OpenRouter's managed proxy
- Single provider (OpenAI only) — rejected because Gemini Flash is cheaper for structured metadata tasks

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Single API key + single SDK | OpenRouter is a third-party dependency (additional failure point) |
| Switch model by changing a string | OpenRouter pricing markup (~10-20%) over direct API |
| Price competition across providers | Slightly higher latency than direct API calls |
| Model versioning handled by OpenRouter | OpenRouter's rate limits may differ from provider limits |

**Future Revisit Criteria:**

- If OpenRouter has a multi-hour outage that blocks pipeline runs
- If OpenRouter's markup exceeds the operational savings of not managing multiple providers
- If a required model is not available on OpenRouter

---

## ADR-002: gpt-4o-mini as Default Script Model

**Status:** Accepted

**Context:**

Short and long video scripts are generated in tight retry loops (up to 3× short, 2× long). The model must be fast enough that repair loops don't add prohibitive latency, and cheap enough that daily automated generation is economically viable.

**Decision:**

Default to `openai/gpt-4o-mini` for all script generation (hook engine, script engine, image prompts). This is the hardcoded fallback in the model resolution chain:

```
promptTemplates.model (DB, per-niche)
  → CONTENT_GEN_MODEL (env)
  → NEXT_PUBLIC_LLM_TEST_MODEL (env)
  → "openai/gpt-4o-mini" (hardcoded)
```

**Evidence from code:**

```typescript
// src/lib/script-engine.ts (and others)
const model = params.model ?? process.env.CONTENT_GEN_MODEL ?? process.env.NEXT_PUBLIC_LLM_TEST_MODEL ?? "openai/gpt-4o-mini";
```

**Alternatives Considered:**

- `claude-haiku-4-5` — similar speed/cost profile; rejected because promptTemplates schema defaults to `claude-sonnet-4-6` which suggests original intent was Anthropic models, but the runtime fallback landed on gpt-4o-mini as more cost-predictable
- `gemini-2.0-flash` — slightly cheaper; rejected because it requires separate handling via the Gemini SDK (now unified via OpenRouter but was a concern at architecture time)
- `gpt-4o` — higher quality; rejected because 15× more expensive than gpt-4o-mini with marginal quality gains for formulaic script generation

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| ~$0.001/script (economically viable for daily generation) | Not the highest quality model available |
| Fast enough that 3× repair loop stays under 10 seconds | Repair loops are more frequent than with stronger models |
| Available via OpenRouter without special access | May require more aggressive prompt engineering to maintain quality |

**Future Revisit Criteria:**

- If long script repair loop frequency consistently exceeds 30% (current: ~15%)
- If a cheaper model with equivalent quality becomes available (e.g., future Gemini Flash iteration)
- If claude-haiku becomes cost-competitive with per-output-token pricing for 2000-word scripts

---

## ADR-003: gemini-2.0-flash for Longform Metadata

**Status:** Accepted

**Context:**

Longform metadata tasks (title generation, description, tags, pinned comment, thumbnail intent) require structured JSON output and creativity but are not on the repair loop critical path. They run once per long video after the script is finalized.

**Decision:**

Use `google/gemini-2.0-flash` for all longform metadata tasks via the `LONGFORM_MODEL` environment variable:

```
LONGFORM_MODEL (env)
  → "google/gemini-2.0-flash" (hardcoded fallback)
```

**Evidence from code:**

```typescript
// src/lib/pipeline/long-video.ts
const longformModel = process.env.LONGFORM_MODEL ?? "google/gemini-2.0-flash";
```

**Alternatives Considered:**

- `gpt-4o-mini` for all tasks including metadata — rejected because Gemini Flash is cheaper and produces equivalent structured JSON for metadata tasks
- `claude-sonnet-4-6` for metadata — rejected on cost grounds (metadata doesn't justify premium model pricing)

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| ~40% cheaper than gpt-4o-mini for token-equivalent tasks | Different "voice" from the script model (gpt-4o-mini generates script, Gemini generates title/description) |
| Excellent at structured JSON output | Requires two distinct models to be available via OpenRouter |
| 1M token context handles long scripts for description generation | |

**Future Revisit Criteria:**

- If Gemini Flash is deprecated or replaced
- If output quality for title generation is measurably worse than script model

---

## ADR-031: Static Deep Quote Guard for phat_phap and tang_sau

**Status:** Accepted

**Context:**

`phat_phap` and `tang_sau` quote content had drifted toward kinetic typography and generic quote wording. For these two niches, motion-heavy quote treatment reduced readability in the first second and the generated wording was too often cliché, list-like, or motivational in a way that diluted channel identity.

**Decision:**

- `phat_phap` and `tang_sau` quote content now resolves to `static_deep_quote`.
- Kinetic quote style is intentionally disabled for these protected contexts only; other channels may keep existing behavior.
- Quote validation rejects cliché phrases, list/multi-option outputs, noisy formatting, and out-of-range length before render.
- Quote style/content work must stay isolated from cron, scheduler, cooldown, upload-slot, and queue-repair code.

**Operational guard:**

Do not re-enable kinetic for `phat_phap` or `tang_sau` without updating this ADR and `scripts/verify-quote-style-quality.ts`.

---

## ADR-032: Quote Pipeline V1 Stays Sidecar-First

**Status:** Accepted

**Context:**

The quote audit found that `phat_phap` Facebook quote/photo posting already depended on the short pipeline's HH:05 sidecar rhythm, while `tang_sau` had no real Facebook quote channel/config. The gap was not slotting logic; it was lack of explicit quote artifact visibility. The system could render and publish quote/photo posts, but it could not clearly show whether a quote came from independent generation, extraction, or fallback.

**Decision:**

- Keep `phat_phap` Facebook quote/photo on the existing HH:05 sidecar path.
- Add Quote Pipeline V1 by making the sidecar quote artifact explicit in `content_generations.prompt_versions.quote`.
- Attempt independent LLM quote generation first for new `phat_phap` Facebook quote/photo rows.
- If independent generation fails validation or errors, fall back to extracted `shortContent`, then to safe fallback quote text.
- Keep publish-time queue/cooldown/slot logic unchanged.
- Do not add `tang_sau` Facebook quote/photo until a real Facebook channel/config exists.
- Make visibility operator-facing through read-only quote audit/preview/verify scripts.

**Operational guard:**

Do not convert `phat_phap` quote/photo into an independent scheduler lane, and do not add `tang_sau` Facebook quote/photo, without a separate publishing-risk review.

---

## ADR-033: Tầng Sâu Quote Automation Is YouTube-First

**Status:** Accepted

**Context:**

The quote audit found that `tang_sau` already had historical `legacy_quote_short` inventory, but upcoming YouTube queue rows could still fall to zero because the fallback auto-refill path was global-headroom-driven and not an explicit scheduler lane. At the same time, `tang_sau` still has no real Facebook quote/photo target for this phase.

**Decision:**

- Add an explicit `quote_pipeline` scheduler lane for `tang_sau` only.
- The lane is YouTube-first and YouTube-only.
- Generated `legacy_quote_short` rows must persist `prompt_versions.quote` metadata, including source type, style, kinetic flag, validation state, and generator version.
- Scheduling must reuse the existing YouTube short auto-schedule path so slot collision and queue reliability logic remain centralized.
- Keep the lane conservative: target a small future queue and cap inserts to one row per run.

**Operational guard:**

Do not add `tang_sau` Facebook quote/photo, do not bypass slot helpers, and do not modify cooldown/queue reliability code as part of quote-lane work.

---

## ADR-034: phat_phap Hourly Slots Are Content Items, Not Platform Rows

**Status:** Accepted

**Context:**

`phat_phap` publishing semantics were repeatedly misread as if each `upload_queue` row represented its own hourly content slot. That interpretation is wrong for Giới Định Tuệ video publishing and causes confusion in scheduling, audits, and cleanup.

For `phat_phap`, the real publishing unit is the generated video content item. A single content item is then published to every required platform for that video type. The hourly rhythm belongs to content items, not to individual platform rows.

The ambiguity is especially dangerous for `legacy_quote_short`, because it can be confused with Facebook quote/photo posting even though `legacy_quote_short` is a quote video.

**Decision:**

- For `phat_phap` / Giới Định Tuệ, the scheduling unit is one content video item.
- `tts_short` is a video content type that must publish to:
  - YouTube Short
  - Facebook Reel
- `legacy_quote_short` is also a video content type that must publish to:
  - YouTube Short
  - Facebook Reel
- `legacy_quote_short` is not a Facebook photo post.
- Facebook photo/image-caption posts remain a separate lane and must not be used as the meaning of `legacy_quote_short`.
- Publishing window is `06:00` to `22:00` VN time.
- Each hourly slot contains one content video item.
- The content-item rhythm alternates:
  - TTS video
  - Quote video
  - TTS video
  - Quote video
- For the same scheduled content item, required platform upload rows must share:
  - the same `content_generation_id`
  - the same `scheduled_at`

Correct semantic example:

```txt
06:00 TTS video A   -> YouTube Short   -> Facebook Reel
07:00 Quote video B -> YouTube Short   -> Facebook Reel
08:00 TTS video C   -> YouTube Short   -> Facebook Reel
09:00 Quote video D -> YouTube Short   -> Facebook Reel
```

Incorrect semantic examples:

```txt
Wrong: platform rows are treated as separate hourly content slots

06:00 YouTube TTS video A
07:00 Facebook TTS video A
08:00 YouTube Quote video B
09:00 Facebook Quote video B
```

```txt
Wrong: different content items are posted to different platforms at the same slot

06:00 TTS video A   -> YouTube
06:00 Quote video B -> Facebook
```

**Cleanup rule:**

- Cleanup is content-level completion, not single-platform completion.
- `tts_short` cleanup is allowed only after both YouTube Short and Facebook Reel are done.
- `legacy_quote_short` cleanup is allowed only after both YouTube Short and Facebook Reel are done.
- If any required platform upload row is missing, queued, uploading, pending, failed-but-retryable, or otherwise not done, required media assets must remain protected.

**Operational guard:**

Do not reinterpret `phat_phap` hourly slots as per-platform cadence, and do not collapse `legacy_quote_short` into the Facebook quote/photo lane, without an explicit publishing decision update to this ADR.

When queue synchronization is needed for future `phat_phap` video rows, the operator flow must remain preview-first and fail-closed:

- Scope only YouTube Short and Facebook Reel rows for `tts_short` and `legacy_quote_short`.
- Allow only safe create or safe align actions on future mutable rows (`queued` / `pending`).
- Never delete rows or mutate done, published, or uploading rows.
- Treat slot collisions, wrong-lane evidence, or channel ambiguity as manual review, not automatic repair.
- Keep `facebook/quote` photo-post sidecars out of scope for short/reel queue sync.

**Post-incident note (2026-06-19):**

- One historical mismatch is known from 2026-06-05 and predates this lane: `published_videos.id = d4c2c02b-9a60-4664-8549-212bcc030a25` / `upload_queue.id = fbace5a9-a4ad-4928-bc1e-232d12b8d35e`, where `phat_phap` `legacy_quote_short` content landed on the `tang_sau` YouTube destination.
- The system now adds fail-closed runtime guards in scheduling so content/destination channel ownership must match, and the `tang_sau` quote lane only accepts `channel_key = tang_sau`, `content_profile_key = philosophy`, and `format_type = legacy_quote_short` before queue insertion.
- Manual operator action is still required on YouTube for that already-published video: leave it as-is, unlist it, make it private, or delete it.

---

## ADR-035: YouTube OAuth Account Is Not the Publishing Destination

**Status:** Accepted

**Context:**

Multiple YouTube channels can be operated under the same Google / OAuth login. In this repo, that can include:

- `tang_sau` / Tầng Sâu
- `phat_phap` / Giới Định Tuệ
- Tee Audio

That means Gmail identity alone is not enough to prove where a video should be published. The real destination is the specific YouTube channel / brand channel chosen for the queue row.

The risk is operationally serious: if the system relies only on shared OAuth identity, content can be uploaded to the wrong YouTube channel even when authentication succeeds.

**Decision:**

- Treat Google / OAuth identity as authentication only.
- Treat the explicit YouTube destination mapping as the publishing target.
- The upload worker must publish using the selected `social_channels` destination row, not by assuming the Gmail login identifies the correct channel.
- Queue, audits, and operator UI must make destination identity visible.
- If the intended YouTube destination cannot be verified at publish time, upload must fail closed.

**Required checks:**

- `upload_queue.platform = youtube`
- `upload_queue.channel_id` exists
- `social_channels.platform = youtube`
- `social_channels.platform_channel_id` exists for the destination row
- destination/content ownership rules still pass at publish time
- a usable YouTube credential exists on the selected destination row

**Operator visibility rule:**

Upload logs and audits must print both:

- safe OAuth credential identity
- intended YouTube destination identity

Safe identity means non-secret metadata only, such as:

- `social_channels.id`
- `oauth_client_config_id`
- destination display name
- destination YouTube channel id

**Operational guard:**

Do not treat a shared Gmail / OAuth account as the publishing destination, and do not remove fail-closed destination validation, without an explicit update to this ADR.

---

## ADR-004: Per-Niche Model Override via DB

**Status:** Accepted

**Context:**

Different content niches (Buddhist philosophy, healing meditation, spiritual stories) may benefit from different LLM models. Changing the model for one niche should not require a code deployment or environment variable change that affects all niches.

**Decision:**

Store `model` in the `promptTemplates` table. When present, it overrides the environment variable default. This enables per-niche or per-template model selection without code changes.

**Evidence from code:**

```typescript
// src/lib/db/schema.ts
export const promptTemplates = pgTable("prompt_templates", {
  model: text("model").default("claude-sonnet-4-6"),  // per-row override
  ...
});
```

**Risk noted:** The schema default is `"claude-sonnet-4-6"` but the runtime fallback is `"openai/gpt-4o-mini"`. Any template created without explicitly setting `model` will use `"claude-sonnet-4-6"` — which is 20× more expensive than gpt-4o-mini. This is a latent cost risk.

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| A/B test model quality per niche via UI | Schema default (`claude-sonnet-4-6`) creates accidental cost if not overridden |
| No redeployment needed for model changes | Model names must be valid OpenRouter identifiers; no validation in DB |
| Enables different quality tiers per content type | |

**Future Revisit Criteria:**

- Fix schema default to match runtime default (`"openai/gpt-4o-mini"`) to eliminate accidental cost
- Revisit if OpenRouter changes model IDs and all DB rows need updating

---

## ADR-005: VieNeu-TTS via Local HTTP API

**Status:** Accepted

**Context:**

The content is in Vietnamese — specifically Buddhist/spiritual content requiring natural Vietnamese prosody, tonal accuracy, and appropriate reading pace. Standard TTS providers (ElevenLabs, Google TTS, Azure TTS) produce robotic or tonally incorrect Vietnamese, particularly for formal/religious register.

**Decision:**

Use VieNeu-TTS, a Vietnamese-specialized TTS system, accessed via a local HTTP API at `http://localhost:8765`. TTS jobs are submitted asynchronously and polled every 15 seconds (up to 25 minutes).

**Evidence from code:**

```typescript
// src/lib/pipeline/tts.ts
const TTS_BASE_URL = process.env.TTS_BASE_URL ?? "http://localhost:8765";
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_TIME_MS = 25 * 60 * 1000;
```

**Alternatives Considered:**

- Google TTS (Vietnamese) — rejected; unnatural prosody for spiritual/religious register
- ElevenLabs (Vietnamese) — rejected; limited Vietnamese voice options; expensive at scale
- Azure TTS (Vietnamese) — rejected; similar quality issues for the specific register needed
- XTTS/Coqui local — rejected; not specialized for Vietnamese tonal language

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Authentic Vietnamese pronunciation and prosody | Only available on local machine (`localhost:8765`) — blocks cloud deployment |
| Self-hosted = no per-character API cost | Must be running as a separate process; no auto-restart on crash |
| Appropriate pacing for meditation/spiritual content | Async polling model adds 0-15s latency after completion |
| | TTS cost is untracked (no per-job accounting) |
| | Long-form audio (15-18 min script) may exceed service limits |

**Future Revisit Criteria:**

- If VieNeu-TTS requires horizontal scaling (multiple workers)
- If the pipeline moves to cloud deployment (VieNeu-TTS localhost dependency is a blocker)
- If a Vietnamese TTS API becomes available with equivalent quality

---

## ADR-006: Fal.ai for Image Generation

**Status:** Accepted

**Context:**

The pipeline requires AI image generation (Stable Diffusion / FLUX models) for video backgrounds and thumbnails. Running Stable Diffusion locally on an M4 MacBook (16GB unified memory) is feasible but slow and competes with other pipeline processes for memory.

**Decision:**

Use Fal.ai's managed inference API (`@fal-ai/client`) for all image generation. Images are generated via `fal.subscribe()` with a JavaScript client, eliminating the need to manage a local GPU inference server.

**Evidence from code:**

```typescript
// src/lib/pipeline/images.ts
import * as fal from "@fal-ai/client";
const result = await fal.subscribe("fal-ai/flux/schnell", { input: { prompt, ... } });
```

**Alternatives Considered:**

- Local ComfyUI on M4 — rejected; M4 16GB unified memory creates resource contention with FFmpeg video assembly; ComfyUI requires separate process management
- Replicate.com — rejected; similar pricing to Fal.ai but worse latency for FLUX models
- Stability AI API — rejected; no FLUX models; Stable Diffusion XL is lower quality for landscape/portrait scenes

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| No local GPU management | Per-image API cost ($0.003–$0.060 depending on model) |
| Parallel image generation (Promise.all) without local resource contention | Network dependency for each image |
| Access to latest FLUX model variants | Fal.ai cold-start can add 15-30s on first call after idle |
| Scales without hardware changes | No batch endpoint for mixed-model requests |

**Future Revisit Criteria:**

- If local Stable Diffusion inference on Apple Silicon reaches acceptable speed (currently ~60s/image on M4)
- If Fal.ai pricing exceeds $0.05/image for schnell-tier quality
- If image quality requirements change to require fine-tuned models not available on Fal.ai

---

## ADR-007: Tiered Image Quality Strategy

**Status:** Accepted

**Context:**

Not all images in a video have equal visual impact or viewer attention. Short video backgrounds appear briefly (1-3 seconds), long video landscape backgrounds appear for 2-5 seconds each, and the thumbnail is the primary click driver. Using the highest-quality (and most expensive) model for all images is wasteful.

**Decision:**

Three image quality tiers based on use case:

| Use Case | Model | Cost | Steps | Rationale |
|----------|-------|------|-------|-----------|
| Short video background | `fal-ai/flux/schnell` | $0.003 | 8 | Fast, cheap; viewers barely notice background |
| Long video landscape | `fal-ai/flux/dev` | $0.025 | 28 | Viewed longer; detail matters |
| Thumbnail | `fal-ai/flux-pro/v1.1-ultra` | $0.060 | 28 | Determines CTR; highest quality justified |

**Evidence from code:**

```typescript
// src/lib/pipeline/images.ts
const SHORT_IMAGE_MODEL = "fal-ai/flux/schnell";  // short backgrounds

// src/lib/pipeline/long-images.ts
const LANDSCAPE_MODEL = "fal-ai/flux/dev";        // long backgrounds
const THUMBNAIL_MODEL = "fal-ai/flux-pro/v1.1-ultra"; // thumbnail
```

**Alternatives Considered:**

- All images at `flux/schnell` — cheapest ($0.012/long video) but thumbnail quality may hurt CTR
- All images at `flux-pro/v1.1-ultra` — highest quality but $0.42/long video (background images don't justify ultra quality)
- All images at `flux/dev` — balanced but overpays for short backgrounds

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| 97% cost reduction for backgrounds vs thumbnail model | Three different model APIs to maintain |
| Thumbnail quality optimized for CTR impact | $0.060 for thumbnail is expensive at scale (10/day = $219/yr) |
| Short video cost stays near $0.003 total | |

**Future Revisit Criteria:**

- Switch thumbnail to `flux/dev` ($0.025) if quality difference is imperceptible at 1280×720 rendering — saves $127/year at 10 long videos/day (see COST_AUDIT.md WASTE-1)
- If `flux/schnell` quality improves to match current `flux/dev` quality

---

## ADR-008: FFmpeg with VideoToolbox Hardware Encoding

**Status:** Accepted

**Context:**

Video assembly (compositing backgrounds, subtitles, audio) requires re-encoding. On Apple Silicon M4, FFmpeg can use the VideoToolbox hardware encoder (`h264_videotoolbox`) which is 3-5× faster than software `libx264`. Cloud VMs won't have VideoToolbox.

**Decision:**

Attempt VideoToolbox encoding first; fall back to `libx264` on error. The fallback is triggered by catching FFmpeg's error and re-running without the hardware encoder flag.

**Evidence from code:**

```typescript
// src/lib/pipeline/short-video.ts
try {
  await runFFmpeg([..., "-vcodec", "h264_videotoolbox", ...]);
} catch {
  await runFFmpeg([..., "-vcodec", "libx264", ...]);
}
```

Bitrate settings:
- Short: 8M bitrate, 10M maxrate, 16M bufsize (over-encoded; see OPT-7 in PERFORMANCE_AUDIT.md)
- Long: 10M bitrate, 12M maxrate, 20M bufsize

**Alternatives Considered:**

- Always libx264 — rejected; 3-5× slower on M4
- HEVC (h265) — rejected; some platforms have limited HEVC support; H.264 is universally accepted by YouTube and Facebook
- AV1 — rejected; encoding speed even with hardware acceleration is not competitive for real-time pipeline use

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| 3-5× faster encode on Apple Silicon | VideoToolbox encoder has less VBR control than libx264 |
| Transparent fallback to libx264 | Higher output bitrate than necessary (8Mbps vs 2-4Mbps for YouTube Shorts) |
| Works on any machine without code changes | Bitrate over-encoding wastes storage and upload time |

**Future Revisit Criteria:**

- Reduce bitrate (see OPT-7: 8M→4M for short, 10M→6M for long) — straightforward improvement
- If pipeline moves to Linux cloud servers (VideoToolbox unavailable; NVENC would be the alternative)

---

## ADR-009: Python Subprocess for Whisper Transcription

**Status:** Accepted

**Context:**

Subtitle generation requires word-level timestamps to synchronize text with audio. Whisper provides word-level timestamps via its `word_timestamps=True` option. At decision time, no pure Node.js Whisper implementation existed with word-level timestamp support.

**Decision:**

Run Whisper via `python3 scripts/whisper_timestamps.py <audioPath>` as a subprocess. The script outputs JSON with word timestamps. If the subprocess fails (Python not found, model not downloaded, timeout), the pipeline falls back to silence-based segmentation.

**Evidence from code:**

```typescript
// src/lib/pipeline/short-video.ts
const result = await execFileAsync("python3", ["scripts/whisper_timestamps.py", audioPath], {
  timeout: 120_000  // short
});
```

```typescript
// src/lib/pipeline/long-video.ts  
timeout: 300_000  // long (5 min)
```

**Alternatives Considered:**

- `whisper.cpp` native binary — not implemented; would eliminate Python dependency and run 4-6× faster with Core ML on Apple Silicon (see OPT-4 in PERFORMANCE_AUDIT.md)
- OpenAI Whisper API — rejected; adds per-minute API cost; also introduces network latency for audio upload
- Silence-based fallback only — rejected; produces visually poor subtitles with mistimed display

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Word-level timestamps for accurate subtitle sync | Python startup overhead (~2s per call) |
| Uses local Whisper model (no API cost) | Silent failure: fallback produces worse output with no alert |
| Handles Vietnamese with correct model | Timeout risk: long audio (15-18 min) can exceed 5-minute limit |
| | Must manage Python environment separately from Node.js |

**Future Revisit Criteria:**

- Implement `whisper.cpp` with Core ML when pipeline performance becomes a priority (see OPT-4: 4-6× speedup, 4h effort)
- If long-form audio consistently approaches or exceeds 5-minute timeout

---

## ADR-010: Cron-Based Pipeline Orchestration

**Status:** Accepted

**Context:**

The pipeline runs as a Next.js application. Content generation, TTS, image generation, and video assembly are long-running operations that cannot run within a single HTTP request. A job queue is needed.

**Decision:**

Use a cron-based polling approach: an external HTTP trigger hits `/api/cron/run` every minute. Each cron tick picks up pending work based on status fields in the `contentGenerations` table. No external message broker or job queue is used.

**Evidence from code:**

```typescript
// src/app/api/cron/run/route.ts
export async function GET(request: Request) {
  // Check auth, then:
  await processUploadQueueAction();
  await runPendingTtsAction();
  await runPendingImagesAction();
  // etc.
}
```

**Alternatives Considered:**

- BullMQ + Redis — rejected; requires separate Redis infrastructure; doesn't fit Vercel/Next.js deployment model
- Vercel Cron (built-in) — considered; currently using external cron trigger instead, likely for more control over scheduling frequency
- AWS SQS / Google Pub/Sub — rejected; over-engineered for a single-machine pipeline
- `node-cron` in-process — rejected; Next.js server doesn't guarantee persistent in-process state

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| No additional infrastructure required | Up to 60-second gap between pipeline stages (cron-tick latency) |
| Simple status-based state machine in DB | Concurrent cron ticks can cause race conditions (see R-08 in RELIABILITY_AUDIT.md) |
| Easy to debug (check DB state at any time) | Each cron tick processes all pending work, which can exceed tick interval on busy queues |
| Works in any hosting environment | No guaranteed ordering beyond scheduled_at ordering |

**Future Revisit Criteria:**

- If cron gap latency (up to 5 min per video pipeline) becomes unacceptable — the immediate fix is to chain stages inline after completion (see OPT-2 in PERFORMANCE_AUDIT.md)
- If pipeline needs to run on multiple machines simultaneously (cron + single DB row is a SPOF)

---

## ADR-011: Multi-Stage Long Script Generation

**Status:** Accepted

**Context:**

A complete long-form video script is approximately 2000 words (~4000 tokens). Generating 2000 coherent words in a single LLM prompt produces inconsistent narrative structure: sections meander, the closing doesn't callback the opening, word counts are unreliable.

**Decision:**

Break long script generation into 6 sequential stages:

1. **Hook** (P-01): 20 candidate hooks generated
2. **Hook Scoring** (P-03): LLM scores and ranks hooks
3. **Outline** (P-06): 4-section outline with emotional arc defined
4. **Opening** (P-07): ~250-word opening written from outline
5. **Sections 1-4** (P-08): Each section written sequentially with 35-word context from previous
6. **Closing** (P-09): Written from outline + section summaries

**Evidence from code:**

```typescript
// src/lib/pipeline/long-video.ts
const outline = await generateLongOutline(client, model, { topic, hook, ... });
const opening = await generateLongOpening(client, model, { outline, ... });
for (const section of outline.sections) {
  const sectionText = await generateLongSection(client, model, { outline, section, previousSummary, ... });
  // ...
}
const closing = await generateLongClosing(client, model, { outline, sections, ... });
```

**Alternatives Considered:**

- Single 2500-token prompt for full script — rejected; produces poor narrative structure; truncation at max_tokens cuts off closing
- Two-stage (outline + full script in one call) — rejected; full script in one call still produces inconsistent section lengths
- Six parallel section calls — not implemented; considered in PERFORMANCE_AUDIT.md as OPT-1 (sections have weak sequential dependency)

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Each section can be independently validated and repaired | 7-10 sequential LLM round trips add 10-25s to generation time |
| Outline ensures structural coherence | Section N has no awareness of metaphors used in section N-2 |
| Section-level repair avoids regenerating entire script | |
| Word count validation per section is accurate | |

**Future Revisit Criteria:**

- Parallelize sections 1-2 and 3-4 (two rounds instead of four sequential) — see OPT-1 in PERFORMANCE_AUDIT.md (2h effort, 2× speedup for sections)

---

## ADR-012: Hook Engine: Generate-Then-Score Pattern

**Status:** Accepted

**Context:**

The opening hook of a video is the primary driver of viewer retention. Generating a single hook at high temperature produces inconsistent quality; generating at low temperature produces similar results every run. Manually reviewing hooks is time-consuming.

**Decision:**

Generate 20 hook candidates at temperature 0.95 (high diversity), then use a separate LLM call at temperature 0.2 (stable scoring) to score all 20 on curiosity and retention, then return the top 3 for user selection.

**Evidence from code:**

```typescript
// src/lib/hook-engine.ts
const hooks = await generateHooks(client, model, { topic, niche, count: 20, temp: 0.95 });
const scored = await scoreHooks(client, model, { hooks, topic, temp: 0.2 });
return scored.sort((a, b) => b.totalScore - a.totalScore).slice(0, 3);
```

**Alternatives Considered:**

- Single high-quality hook at low temperature — rejected; produces the same hook archetype every run, leading to viewer fatigue
- Human review of all 20 hooks — rejected; too slow for automated pipeline
- Simple heuristic scoring (keyword matching) — exists as fallback; significantly worse quality than LLM scoring

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Diversity sampling separates "generation" from "selection" | Two LLM calls instead of one (adds ~1-3 seconds) |
| Top-3 gives user meaningful choice without overwhelming | 20 hooks at temp 0.95 produces 4-6 near-duplicates (see CONTENT_QUALITY_AUDIT.md P-02) |
| LLM scoring is better calibrated than heuristics | All 20 example hooks in prompt follow "người ta" pattern — biases generation |
| Fallback heuristic exists for scoring failures | |

**Future Revisit Criteria:**

- Reduce from 20 to 12 hooks (removes duplicates, cuts generation cost)
- Remove example hooks from prompt (or diversify patterns) to reduce selection bias

---

## ADR-013: TTS Result Caching via Script Hash

**Status:** Accepted

**Context:**

TTS is the slowest pipeline stage (2-8 minutes). If a user regenerates hooks or re-processes content with the same script text, the TTS should not be re-synthesized.

**Decision:**

Cache TTS results by hashing the script text (SHA-256). Before submitting a TTS job, check if an audio file for the same script hash already exists. If found, skip TTS and reuse the existing audio.

**Evidence from code:**

```typescript
// src/lib/pipeline/tts.ts
const scriptHash = createHash("sha256").update(script).digest("hex");
const cached = await db.select().from(contentGenerations)
  .where(eq(contentGenerations.scriptHash, scriptHash))
  .where(isNotNull(contentGenerations.audioPath));

if (cached.length > 0) {
  // reuse existing audio file
  return { audioPath: cached[0].audioPath, cached: true };
}
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Eliminates 2-8 minute TTS wait on re-generation | Hash-based cache doesn't account for voice parameter changes |
| Prevents duplicate audio files on disk | Cache is query-based (full DB scan on scriptHash); no index defined |
| Transparent to the rest of the pipeline | |

**Future Revisit Criteria:**

- Add index on `scriptHash` column if TTS cache lookup becomes slow
- Invalidate cache if TTS voice/speaker parameters change

---

## ADR-014: Error Swallowing with DB Persistence

**Status:** Accepted

**Context:**

Pipeline stages run within Next.js server actions invoked by a cron endpoint. If a server action throws an unhandled exception, the cron runner itself fails and subsequent pipeline items in the same cron tick are not processed.

**Decision:**

Wrap every pipeline stage in a top-level `try/catch`. On error: write the error message to a dedicated DB column (`ttsErrorMessage`, `imagesErrorMessage`, etc.), set the status column to `"error"`, and return `{ success: false, error: message }` rather than throwing.

**Evidence from code:**

```typescript
// src/lib/pipeline/tts.ts
try {
  // ... entire TTS stage
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await db.update(contentGenerations).set({
    ttsStatus: "error",
    ttsErrorMessage: message,
  }).where(eq(contentGenerations.id, contentId));
  return { success: false, error: message };
}
```

**Alternatives Considered:**

- Let errors propagate to cron runner — rejected; one failed video stops all other videos in the same cron tick
- Structured error types with retry classification — not implemented; currently all errors are treated as terminal (no automatic retry)

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| One failed video doesn't block others | Errors are not alerted — no Telegram notification for stage failures |
| Error state is preserved in DB for manual inspection | Calling code sees `{ success: false }` as clean return value, not an exception |
| UI can display specific error per stage | Silences errors that should cause alerts (see R-10 in RELIABILITY_AUDIT.md) |

**Future Revisit Criteria:**

- Add `await sendTelegram(...)` inside each catch block to alert on failures (see R-10: P1 fix, 3h effort)
- Classify errors as transient (retry) vs permanent (alert) for automatic recovery

---

## ADR-015: contentGenerations as God Object Table

**Status:** Accepted

**Context:**

A single video passes through 6+ pipeline stages (content generation → TTS → images → video assembly → metadata → upload). Each stage has its own status, timing, error message, and output paths. The relationship between stages is always 1:1 (one content generation → one TTS job → one video).

**Decision:**

Store all pipeline stage state in a single `contentGenerations` row with 70+ columns. Status columns (`ttsStatus`, `imagesStatus`, `videoStatus`) track stage completion. Error columns (`ttsErrorMessage`, etc.) store failures. Output path columns (`audioPath`, `imagePaths`, `videoPath`) chain outputs between stages.

**Evidence from code:**

```typescript
// src/lib/db/schema.ts
export const contentGenerations = pgTable("content_generations", {
  // Identity
  id: uuid(), topic: text(), nicheId: uuid(),
  // Script stage
  shortScript: text(), longScript: text(), hooks: jsonb(),
  // TTS stage
  ttsStatus: text(), audioPath: text(), ttsDurationMs: integer(), ttsErrorMessage: text(),
  // Images stage
  imagesStatus: text(), imagePaths: jsonb(), imagesDurationMs: integer(),
  // Video stage
  videoStatus: text(), shortVideoPath: text(), longVideoPath: text(), generationTime: integer(),
  // Longform metadata
  title: text(), description: text(), tags: jsonb(), thumbnailPath: text(),
  // ... 50+ more columns
});
```

**Alternatives Considered:**

- Normalized schema (separate tables per stage) — would require 5-6 JOINs to get a complete pipeline view; adds FK complexity without concrete benefit at current scale
- Event sourcing (append-only events table) — over-engineered for a 1:1 pipeline; adds query complexity

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Complete pipeline state visible in one DB query | 70+ column table is hard to evolve (ALTER TABLE on wide table) |
| Simple status checks: `WHERE videoStatus = 'pending'` | Concurrent cron ticks can write conflicting updates to the same row |
| No JOIN complexity | Hard to shard or archive individual stages |
| | Adding a new stage requires schema migration |

**Future Revisit Criteria:**

- Extract `longformMetadata` (title, description, tags, thumbnail) into a separate `videoMetadata` table if longform-specific queries become complex
- If stage count grows beyond 10 or concurrent-write conflicts become frequent

---

## ADR-016: uploadQueue + publishedVideos Separation

**Status:** Accepted

**Context:**

A video has two distinct lifecycle phases after generation: pre-upload (scheduled, queued, uploading) and post-upload (published, with platform-specific IDs and analytics).

**Decision:**

Use two separate tables:

- `uploadQueue`: tracks `status` (queued/uploading/completed/error), `scheduledAt`, `channelId`, `contentGenerationId`, `platform` (youtube/facebook)
- `publishedVideos`: tracks `youtubeVideoId` (or `facebookVideoId`), `publishedAt`, view counts, watch time, revenue metrics

**Evidence from code:**

```typescript
// src/lib/db/schema.ts
export const uploadQueue = pgTable("upload_queue", {
  status: text("status").notNull().default("queued"),
  scheduledAt: timestamp("scheduled_at"),
  platform: text("platform").notNull(), // "youtube" | "facebook"
  contentGenerationId: uuid("content_generation_id"),
});

export const publishedVideos = pgTable("published_videos", {
  youtubeVideoId: text("youtube_video_id"),
  viewCount: integer("view_count").default(0),
  watchTimeMinutes: integer("watch_time_minutes").default(0),
});
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Clear separation of upload state vs analytics state | Two tables to update during upload completion |
| `uploadQueue` stays small (rows deleted after completion) | FK join required to get full picture of a content generation's published status |
| Analytics data grows independently of upload state | |

**Future Revisit Criteria:**

- If analytics joins become frequent enough to warrant denormalizing view counts into `uploadQueue`

---

## ADR-017: Analytics via Polling (Not Webhooks)

**Status:** Accepted

**Context:**

View counts, watch time, and revenue data need to be kept current in the local DB. YouTube and Facebook provide Data APIs for fetching analytics but neither offers push notifications (webhooks) for analytics updates.

**Decision:**

Poll YouTube and Facebook analytics APIs on each cron tick for all `publishedVideos` where `updatedAt < NOW() - 24h`. Update local DB with fetched metrics.

**Evidence from code:**

```typescript
// src/actions/publishing-analytics.ts
export async function syncAnalyticsAction() {
  const videos = await db.select().from(publishedVideos)
    .where(lt(publishedVideos.analyticsUpdatedAt, subHours(new Date(), 24)));
  
  for (const video of videos) {
    const metrics = await fetchYouTubeAnalytics(video.youtubeVideoId);
    await db.update(publishedVideos).set({ viewCount: metrics.viewCount, ... });
  }
}
```

**Alternatives Considered:**

- YouTube webhooks (PubSubHubbub) — available for new video notifications but not for analytics updates; rejected for analytics use case
- Real-time analytics (impossible) — YouTube analytics has a 24-48h reporting delay regardless of fetch frequency

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Works with actual YouTube/Facebook API capabilities | Analytics are always 24-48h stale regardless of polling frequency |
| Simple implementation | Polling all published videos on every cron tick is O(n) API calls |
| No webhook registration or renewal complexity | Rate limits on analytics API require careful batching |

**Future Revisit Criteria:**

- Add pagination/batching if published video count exceeds 50 (risk of API rate limit per cron tick)
- Cache `analyticsUpdatedAt` index to avoid scanning all published videos on every tick

---

## ADR-018: Per-Niche Prompt Templates in DB

**Status:** Accepted

**Context:**

Different content niches need different tones, lengths, and CTAs. A "Buddhist philosophy" channel uses formal Vietnamese; a "healing meditation" channel uses softer, more personal language. Changing prompts should not require a code deployment.

**Decision:**

Store prompt template content in the `promptTemplates` table (keyed by `nicheId` + `templateType`). The pipeline reads templates from DB at generation time, filling in `{{topic}}`, `{{hook}}`, `{{outline}}` placeholders at runtime.

**Evidence from code:**

```typescript
// src/actions/content-generator.ts
const template = await db.select().from(promptTemplates)
  .where(eq(promptTemplates.nicheId, nicheId))
  .where(eq(promptTemplates.templateType, "long_section"));

const prompt = template.content
  .replace("{{topic}}", params.topic)
  .replace("{{hook}}", params.hook);
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Prompt changes without code deployment | Prompt templates are harder to version-control (in DB, not git) |
| Different niches can have radically different prompts | Template placeholders have no type safety |
| A/B testing prompts via UI | Prompt bugs require DB update, not code review |

**Future Revisit Criteria:**

- Add prompt versioning (track when templates were changed and what results they produced)
- Add placeholder validation to catch missing `{{variable}}` substitutions at template save time

---

## ADR-019: Relative File Paths in DB

**Status:** Accepted

**Context:**

Pipeline stages write output files (audio, images, video) to local disk and store paths in the DB for subsequent stages to read. The path stored in DB must remain valid across restarts and not break when the working directory changes.

**Decision:**

Store file paths relative to the project root (e.g., `media/audio/uuid.wav`, `output/videos/uuid.mp4`) rather than absolute paths. Pipeline code resolves to absolute paths using `path.join(process.cwd(), relativePath)` at runtime.

**Evidence from code:**

```typescript
// src/lib/pipeline/tts.ts
const relativeAudioPath = `media/audio/${contentId}.wav`;
const absoluteAudioPath = path.join(process.cwd(), relativeAudioPath);
await fs.writeFile(absoluteAudioPath, audioBuffer);
await db.update(contentGenerations).set({ audioPath: relativeAudioPath });
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Paths remain valid when project is moved on same machine | Breaks if pipeline runs from a different working directory |
| Development/production parity (same relative paths) | No validation that files actually exist at the stored path |
| Git-friendly: paths don't expose machine-specific directories | |

**Future Revisit Criteria:**

- Add file-existence check before each stage starts (validate that input paths from previous stage exist on disk)
- If pipeline moves to cloud storage (S3/GCS), paths would change to URLs — requires migration

---

## ADR-020: Apple Silicon Detection and Auto-Scaling

**Status:** Accepted

**Context:**

The pipeline runs on an Apple Silicon M4 MacBook (16GB unified memory). The optimal concurrency settings for `Promise.all` image generation, FFmpeg encoding, and mapWithConcurrency differ significantly from cloud VM defaults.

**Decision:**

Auto-detect Apple Silicon via `os.cpus()` and conditionally set:
- Higher default concurrency for image generation (Fal.ai is network-bound, not CPU-bound)
- VideoToolbox encoder selection (hardware available on Apple Silicon, not on Linux VMs)
- Optimized FFmpeg thread count

**Evidence from code:**

```typescript
// src/lib/pipeline/perf.ts
import os from "os";
export const IS_APPLE_SILICON = os.cpus()[0]?.model.includes("Apple") ?? false;
export const DEFAULT_CONCURRENCY = IS_APPLE_SILICON ? 4 : 2;
```

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Optimal settings without manual configuration | Platform detection is fragile if CPU model string changes |
| VideoToolbox automatically selected on capable hardware | Cross-platform behavior differs — harder to reproduce bugs on Linux |
| Transparent fallback for non-Apple environments | Assumes macOS = Apple Silicon; will misdetect Intel Mac |

**Future Revisit Criteria:**

- Replace CPU model string detection with explicit `process.platform === "darwin"` + architecture check (`process.arch === "arm64"`)
- If pipeline is containerized (Docker on Linux), perf.ts settings need explicit override via env var

---

## ADR-021: Model and Image Quality Routing Strategy

**Status:** Accepted

**Context:**

The project has moved past the first reliability bottleneck. The current business bottleneck is traffic recovery, CTR, retention, topic drift, weak visual variation, and thin data per topic family.

It is tempting to respond by globally upgrading LLMs or switching image providers. That is risky because:

- JSON/scoring/metadata tasks rarely justify premium model cost.
- Script quality matters more than metadata model quality.
- Image generation already dominates long-video cost.
- Shorts/Reels cover quality is mostly layout, text readability, safe margins, and first-frame design, not necessarily a more expensive image model.
- Provider migration would add operational risk before proving content-quality ROI.

**Decision:**

Keep Fal.ai as the default image provider for now.

Use post-processing and enhancer layers before switching image provider:

- code-rendered Vietnamese text
- gradient/vignette
- safe margins
- contrast/readability scoring
- social image enhancer
- short cover first-frame rendering

Use cheap LLMs for:

- topic suggestions
- hook scoring
- title scoring
- metadata
- tags
- pinned comments
- image prompt writing
- coverText if an LLM path is added later

Use a stronger model only for controlled script quality tests:

- short script
- long script
- script repair if repair loops become frequent

Do not switch providers globally. Do not upgrade every stage at once. Model changes must be isolated behind experiment tracking and compared against retention/views when enough samples exist.

**Recommended routing tiers:**

| Tier | Use | Policy |
|---|---|---|
| `cheap` | topic, scoring, metadata, tags, image prompt writing | Daily default |
| `balanced` | short script, long script | A/B test first |
| `quality` | one-off premium script experiments | Explicit experiment only |

**Image quality tiers:**

| Tier | Use | Current Fal.ai policy |
|---|---|---|
| `cheap` | short/reel background images | `fal-ai/flux/schnell` |
| `balanced` | long-video background images | `fal-ai/flux/dev` |
| `quality` | long thumbnail experiments only | `fal-ai/flux-pro/v1.1-ultra` or configured premium model |

**Alternatives Considered:**

- Switch all LLM calls to a premium model — rejected because it hides which stage improves quality and can multiply cost.
- Switch all image generation to a premium model — rejected because most image assets are not CTR-critical.
- Migrate from Fal.ai immediately — rejected because current issues should first be addressed with post-processing, cover layout, and visual variation.
- Keep all scripts on the cheapest model forever — rejected as too rigid; script quality should be A/B tested when retention suggests content weakness.

**Tradeoffs:**

| Pro | Con |
|---|---|
| Controls cost while allowing targeted quality tests | Requires experiment discipline |
| Keeps provider risk low | Does not instantly solve image quality complaints |
| Separates script quality from metadata/scoring cost | Needs enough samples before conclusions |
| Uses existing Fal.ai/appConfig infrastructure | Does not add a new provider fallback |

**Future Revisit Criteria:**

- If script A/B tests show a stronger model improves retention enough to justify cost.
- If post-processing/enhancer work cannot reach acceptable image quality.
- If Fal.ai pricing, reliability, or output quality degrades materially.
- If a new image provider offers materially better quality at similar cost and migration risk is low.
- If cover/hook/prompt tracking has enough samples to prove which stage is the bottleneck.

---

---

## ADR-22: Tầng Sâu Visual Direction — Bright/Clean/Modern Scene Pool

**Date:** 2026-06-06

**Context:**

Early Tầng Sâu outputs appeared visually muted (olive/sepia palette), spiritually coded (lotus, shrine-adjacent scenes), and inconsistent with the channel's editorial/philosophical positioning. Initial pool (32 scenes) lacked explicit brightness cues and color direction.

**Decision:**

Expand `TANG_SAU_SCENE_POOL` from 32 to 36 entries with:
- Explicit brightness/color keywords in every scene description (pale blue-gray, warm beige, soft gold, clean off-white — avoiding muddy olive, dirty sepia, dark green-gray)
- `buildQuoteShortImagePrompt` adds a `colorDir` line based on `entry.isDark` flag
- Negative prompt extended: `"no Buddhist altar, no temple, no incense, no lotus flower, no prayer beads, no monk robe, no religious statue, no shrine, no spiritual iconography, no pagoda"`
- `inspectTangSauBackground` vision guard extended: checks for visual Buddhist/spiritual cues (altar, Buddha statue, shrine, robes) in addition to text contamination
- Scene mix: ≥97% bright, ≤14% person, 0% forbidden terms in scene descriptions
- Replaced muted/problematic entries (misty olive hill, wet autumn leaves, overpass at night, rainy umbrella person) with brighter alternatives

**Rationale:**

- Channel brand is secular philosophy — not Buddhist devotion. Visual coding must match.
- fal.ai flux/schnell is sensitive to color keywords; explicit palette direction reduces muddy/sepia output.
- Vision guard extended to catch model-generated Buddhist imagery even when not prompted for it.

**Tradeoffs:**

| Pro | Con |
|---|---|
| Stronger brand clarity, less spiritual miscoding | Existing queued items (~25) use old pool — safe but won't benefit |
| Color direction in prompt reduces sepia/olive drift | fal.ai still occasionally generates Buddhist imagery (guard + reroll handles it) |
| Guard catches both text and visual contamination | Adds ~1 LLM call per reroll cycle |

**Future Revisit Criteria:**

- If fal.ai generation quality improves such that Buddhist visual contamination rate drops below 5%, guard can be loosened.
- If channel direction changes to include spiritual content, scene pool must be rebuilt.

---

---

## ADR-23: Tầng Sâu Image Prompt — Remove Buddhist Negatives, Use Magazine Style Anchors

**Date:** 2026-06-06

**Context:**

After the ADR-22 scene pool update, verification showed 8/8 fal.ai-generated images were Buddhist-contaminated regardless of explicit negative prompts ("no Buddha statue", "no monk", etc.), across both `flux/schnell` and `flux/dev` models.

**Root Cause:**

CLIP-based text-to-image models (Flux family) process the entire prompt as a single embedding. Naming unwanted concepts — even with "no X" — activates those concepts in CLIP embedding space, increasing (not decreasing) their probability. The Buddhist negative list was worsening the contamination.

**Decision:**

1. **Remove ALL Buddhist/spiritual negative terms** from `buildQuoteShortImagePrompt`. These are counterproductive.
2. **Anchor positively to specific secular magazine aesthetics** that are far from Buddhist imagery in CLIP space:
   - Bright scenes: "shot for Kinfolk magazine, commercial lifestyle photography, contemporary interior or street photography"
   - Dark scenes: "shot for Monocle magazine, contemporary urban documentary photography, modern city life after hours"
3. **Remove "editorial stillness" and "airy editorial"** from scene descriptions — these map to meditative/contemplative aesthetics in CLIP, close to Buddhist imagery.
4. **Keep `flux/schnell`** — `flux/dev` produced identical contamination at 8× cost, confirming this is a prompt structure issue, not a model capability issue.
5. **`inspectTangSauBackground`** remains the rejection layer for any remaining contamination.

**Result:**

Buddhist contamination: 100% → 0% (8/8 images). Remaining 2/8 flags are text contamination (bus stop signage, wall art text) — handled by existing text negatives + 3-attempt reroll.

**Tradeoffs:**

| Pro | Con |
|---|---|
| 100% → 0% Buddhist contamination | Guard still needed for text contamination |
| Uses cheaper flux/schnell ($0.003/image) | Cannot guarantee 0% contamination with stochastic generation |
| Simple rule: no religious terms in generation prompt | "Kinfolk/Monocle" framing may feel slightly Western for a Vietnamese channel |

**Future Revisit Criteria:**

- If Buddhist contamination resurfaces (>2/8 in re-verification), revisit scene descriptions.
- If a fal.ai model with proper negative_prompt API field becomes available, try separating positive/negative prompts.

---

---

## ADR-024: 1 Phút Tài Chính — Finance News Branch Architecture

**Date:** 2026-06-06

**Status:** Accepted (design only; implementation not started)

**Context:**

A new experimental content series called "1 Phút Tài Chính / #1PhutTaiChinh" is planned: 30-60s Vietnamese short videos summarizing finance news. This is a separate branch from the existing Buddhist/psychology pipeline and must not interfere with current Traffic Recovery work.

**Decision:**

Implement as a new `contentProfileKey = "finance_news"` + a dedicated niche row, reusing all existing pipeline infrastructure:

- Niche row in `niches` table: `contentProfileKey = "finance_news"`, `channelKey = "one_minute_finance"`, `musicFolder = "finance_pulse"`, `ttsVoice = <faster voice if available>`
- New profile entry in `src/lib/config/content-profiles.ts` with finance-appropriate image styles, forbidden terms, hook patterns, YouTube tags
- New prompt template rows in `promptTemplates` for script stage (`finance_news_short_script`)
- Two new tables for news ingest: `finance_news_sources` (RSS feed registry) and `finance_raw_items` (deduplicated news items)
- Article og:image cached locally at `media/news-images/{hash}.jpg` and passed to video pipeline instead of Fal.ai generation
- Music served from `media/music/finance_pulse/` — no code change needed

**What is NOT changed:**

- `src/lib/pipeline/short-video.ts` — unchanged; music folder is already config-driven
- `src/lib/pipeline/tts.ts` — unchanged; voice is niche-level
- `src/lib/pipeline/images.ts` — one new `contentProfileKey === "finance_news"` branch to pass a pre-downloaded image path instead of calling Fal.ai (skip generation, use cached article image)
- Existing Buddhist/psychology niches, prompts, publishing — untouched
- Upload queue, publishing, analytics — reused as-is

**Alternatives Considered:**

- Separate pipeline codebase — rejected; duplicates all TTS/video/publish infrastructure with no benefit
- Hardcoding finance logic into existing content profiles — rejected; contaminates Buddhist/psychology routing
- Full news DB with event clustering at MVP — rejected; over-engineered for Phase A/B; simple dedup by URL hash is sufficient

**Tradeoffs:**

| Pro | Con |
|---|---|
| Zero changes to existing content pipeline | New `finance_news` branch in `content-profiles.ts` adds a 3rd profile to maintain |
| Fully reuses upload queue, analytics, TTS, video rendering | Article image download adds a new I/O dependency (network fetch per news item) |
| Music profile isolated via `niche.musicFolder` — no code change | `images.ts` needs one new branch for `finance_news` to skip Fal.ai |
| Experiment tracking (`experimentId`) reused from day 1 | RSS collector is new code with no prior test coverage |

**Future Revisit Criteria:**

- If article images are frequently missing or low quality, fallback to Fal.ai for finance_news using a `news_finance` image style preset
- If finance branch reaches meaningful publish volume, consider promoting to a standalone niche config file rather than an inline profile

---

## ADR-025: Audience Profile Layer

**Date:** 2026-06-07

**Status:** Accepted

**Context:**

Content and visual prompts were guided by topic + channel profile (tone/vocabulary/avoid) but not by a structured understanding of the target audience. As Buddhist Healing and Tầng Sâu diverge in format, style, and visual direction, the LLM prompt quality depends on knowing *who* is watching — their pain points, desires, tone preference, and visual preferences.

**Decision:**

Add a static `AUDIENCE_PROFILES` registry in `src/lib/prompt-studio-registry.ts` with two profiles: `healing_seekers` (Buddhist Healing) and `modern_reflective` (Tầng Sâu). Each profile records:

- `audienceDescription` — plain-language summary
- `ageRange` (optional)
- `audiencePainPoints` — what they struggle with (6 items)
- `audienceDesires` — what they seek (6 items)
- `tonePreference` — how they want to be spoken to (4 items)
- `visualPreference` — what images they engage with (5 items)
- `avoidedTone` — tone that will cause drop-off (4 items)
- `avoidedVisuals` — visuals that will cause drop-off (4 items)
- `bestKnownAngles` — proven content approaches (5 items)
- `experimentalAngles` — new format ideas to test (3 items)

Integration:

- `getAudienceProfile(channelProfileId)` helper added — returns the matching profile or null
- `buildQuoteProfilePromptHints()` now also returns `audiencePainPoints`, `audienceDesires`, `tonePreference`, `avoidedTone`
- `generateQuoteTextLLM()` and `generateReflectionQuoteLLM()` inject audience context into the system prompt
- All four Buddhist format generators use a shared `buildBuddhistAudienceContext()` helper that injects audience context
- `buildImagePromptPair()` in `images.ts` now adds `TARGET AUDIENCE`, `AUDIENCE VISUAL PREFERENCE`, and `AVOID THESE VISUALS` sections to both Buddhist and psychology (Tầng Sâu) image prompt system messages — keeping the two profiles visually separate
- `audienceProfileId` ("healing_seekers" or "modern_reflective") is written to sidecar `tags.audienceIntent` for future performance segmentation
- `PERFORMANCE_DIMENSIONS` array defined as analytics reporting foundation (no automatic feedback loop)
- Prompt Studio (`/content/prompts`) renders Audience Profiles section and Performance Dimensions table
- Workspace list (`/content/workspaces`) shows compact audience summary (pain points + visual preference) per workspace card

**What is NOT changed:**

- DB schema, upload_queue, cron, TTS routing, publishing — untouched
- Tầng Sâu visual direction (Kinfolk/Monocle anchor) — untouched
- Automatic AI feedback loop — not enabled

**Tradeoffs:**

| Pro | Con |
|---|---|
| LLM prompts are now audience-aware without any DB changes | Audience data is static TypeScript — requires code deploy to update |
| Both visual channels remain completely separated | Performance segmentation by audienceProfileId depends on sidecars being written (not DB-level) |
| Provides analytics foundation (PERFORMANCE_DIMENSIONS) without premature auto-apply | Visual preference context adds ~30 tokens per image prompt API call |

**Future Revisit Criteria:**

- If performance data shows audience-profile segments have meaningfully different retention, promote audienceProfileId to a DB column on `contentGenerations` for proper analytics joins
- If audience profiles need per-workspace customization, move to a workspace-level config in `channel-workspace-registry.ts`

---

## ADR-022: Upload Queue Dedupe Includes 'cancelled' Status

**Date:** 2026-06-08
**Status:** Accepted

### Context

When the admin disables Facebook posting, all pending `upload_queue` rows are set to `status = 'cancelled'`. When Facebook is re-enabled, automated scheduling paths (auto-refill-watcher, schedule-mixer, bulkScheduleAction via autoScheduleVideoAction) treat those content items as never-scheduled because their dedupe checks only covered `status IN ('queued', 'uploading', 'done')`. This caused duplicate row pairs: one cancelled row from the original scheduling run and one new row from the post-re-enable run.

A pre-publish quality audit on 2026-06-08 found 14 such duplicate groups (28 rows) for Trí Tuệ An Nhiên Facebook. The trigger was admin disabling FB on 2026-05-30.

### Decision

All automated scheduling dedupe checks now include `'cancelled'` in the status IN filter:
- `src/lib/auto-refill-watcher.ts` — `getDestinationCandidates` usedContentIds query
- `src/lib/auto-refill-watcher.ts` — `insertQueueRows` per-row duplicate check
- `src/lib/schedule-mixer.ts` — `getExistingQueueKeyStates`
- `src/actions/social-channels.ts` — `bulkScheduleAction` existingContentIds query

`scheduleUploadAction` (manual per-item scheduling from gallery modal) intentionally retains no dedupe, allowing operators to explicitly reschedule cancelled content.

### Consequences

- Auto-refill and schedule-mixer will never automatically reschedule content that was previously cancelled for a given channel. This prevents the duplicate-row pattern permanently.
- If an operator wants to reschedule specifically cancelled content, they must use the manual `scheduleUploadAction` path (gallery → schedule modal) or insert directly via SQL.
- Existing cancelled+cancelled duplicate rows remain in the DB but are inert (both rows inactive, no double-publishing risk). Cleanup: delete the lower-scheduled row from each pair when convenient.

---

## ADR-028: Cooldown Deferral Must Use Canonical Slot Occupancy

**Date:** 2026-06-18
**Status:** Accepted

### Context

`processUploadQueueAction` previously deferred cooldown-blocked rows by calling `findNextBulkSlot(..., [], nextAllowedAt)`. Because the taken-slot set was empty, each overdue queued row independently picked the same next legal slot. Under minute-by-minute cron retries, this produced real pileups such as many `phat_phap` rows collapsing onto `2026-06-19 06:00 VN`.

### Decision

Canonical slot occupancy now lives in `src/lib/publishing/slot-occupancy.ts`.

- Blocking statuses for slot selection are only `queued`, `uploading`, and `done`.
- `cancelled` rows must not block future slot allocation.
- Cooldown deferral must query taken slots for the same destination before selecting a replacement slot.
- Replacement slot selection must preserve the current row's minute offset when deferring existing queued rows, so established rhythms such as `phat_phap` Facebook quote at `HH:05` are not flattened to `HH:00`.

### Consequences

- Cooldown deferral can no longer drain overdue backlogs into a single slot.
- Queue repair and verification scripts can share the exact same slot-selection semantics as production.
- Future changes to queue slot allocation are protected logic and must re-run cooldown deferral verification and upload slot audit before rollout.

---

## ADR-026: Buddhist Visual Direction V1 — Bright Sacred Uplifting

**Date:** 2026-06-09  
**Status:** Accepted

**Context:**

Buddhist (phat_phap) image generation was producing inconsistent outputs — sometimes dark, gloomy, too generic, or lacking strong Buddhist recognition. A reference high-performing video ("Bí quyết ứng dụng giáo lý Phật giáo để sống an lạc mỗi ngày", rank 1/10, 90.2% avg viewed) used warm, practical, daily-life visuals rather than dark statues or gloomy temple imagery.

**Decision:**

Implement a `BUDDHIST_VISUAL_V1` system with:

1. **12 visual categories + 1 practical daily-life lane** — each category has locked color palette, subject rule, prompt concept, and metadata fields.
2. **Deterministic topic→category mapping** — `getBuddhistVisualCategory(topic)` uses keyword matching with a hash-seeded fallback. No random selection.
3. **Practical daily-life exception** — topics matching daily-life patterns route to warm lifestyle visuals (tea cup, morning window, prayer beads), not large statue imagery.
4. **Composition guardrails** — main Buddhist subject must occupy 55–70% of frame; vertical 9:16; no text/logo/watermark; no dark horror atmosphere.
5. **Visual metadata in sidecar/promptVersions** — `buddhistVisualCategory`, `visualPromptVersion = BUDDHIST_VISUAL_V1`, `visualBrightness = bright`, `emotionalTone = peaceful_uplifting` stored for Content Intelligence.
6. **Tầng Sâu isolation** — `isTangSauContext()` and `isTangSauInput()` guards preserved; V1 only activates for `contentProfileKey = buddhism` or `channelKey = phat_phap`.

**Rationale:**

Buddhist visual consistency directly affects CTR and first-frame recognition. The reference video's performance confirms warm, practical, close visuals outperform dark statue imagery for everyday Buddhist content. Category-based deterministic routing ensures variety (12 categories) without regression to 3 random rotating anchors.

**Files:**

- `src/lib/config/buddhist-visual-categories.ts` — new: category registry, mapping, prompt builder, metadata
- `src/lib/pipeline/images.ts` — Buddhist branch updated to use V1 category prompts
- `src/lib/pipeline/quote-short-pipeline.ts` — `buildQuoteShortImagePrompt` Buddhist branch updated; metadata in preview items
- `src/lib/legacy-quote-short-generator.ts` — `LegacyQuoteShortInput` + `LegacyQuoteShortMetadata` extended with `buddhistVisualMeta`
- `src/lib/config/content-profiles.ts` — Buddhist style presets updated to V1 direction

**Tradeoffs:**

| Pro | Con |
|---|---|
| 12 distinct categories vs 3-4 random anchors | Keyword matching may miss nuanced topics (fallback is safe) |
| Deterministic → consistent per topic | Practical daily-life lane bypasses Buddha statue imagery for some topics |
| Metadata enables Content Intelligence visual analysis | Existing queued items use old prompts (safe, inert) |
| Practical lane improves daily-life content resonance | |

**Future Revisit:**

- After 50+ published V1 videos: compare visual category performance (CTR proxy: views/retention) via Content Intelligence.
- If practical lane outperforms statue categories significantly, expand it.
- If a category consistently underperforms, retire it from fallback pool.

---

---

## ADR-023: TTS Punctuation Pause Injection Gated Behind Feature Flag

**Date:** 2026-06-12
**Status:** Accepted
**Context:**

Pass 2 TTS remediation (`scripts/remediate-tts-pause-2.ts`, `scripts/remediate-tts-pause-2-repair.ts`) added deterministic punctuation-pause injection to 26 phat_phap tts_short items using `BUDDHIST_CALM_PROFILE` (comma=220ms, sentence=560ms). This caused a "khựng" (hard-stop stutter) effect because:

1. Pass 1 silenceremove fix changed `stop_duration=0.35→0.80:stop_silence=0.16→0.28`, preserving natural TTS prosodic pauses of ~150ms (comma) and ~400ms (sentence).
2. Injected pauses stacked ON TOP of these preserved natural pauses: effective comma ~370ms, effective sentence ~960ms — 2–3× the Buddhist pacing guideline maximums (comma max 180ms, sentence max 450ms).

Pacing audit (`scripts/audit-tts-pacing.ts`, 2026-06-12) confirmed:
- 13/13 analyzed files had both profile guideline violations
- 8/13 had suspicious dense clusters (≥3 pauses in 3 seconds)
- 6/13 exceeded the 14% total-silence-ratio guideline

**Decision:**

Gate deterministic pause injection behind `TTS_ENABLE_PUNCTUATION_PAUSES` env flag in `src/lib/pipeline/tts.ts`. Default is `false` (injection off). The Whisper timestamp code remains in place for future use.

The flag is evaluated at call time (not module init) via `process.env.TTS_ENABLE_PUNCTUATION_PAUSES === "true"`. Production default is `false` until Option E (net-addition logic) is implemented.

**Consequences:**

- Audio quality reverts to Pass 1 state: natural TTS prosody + silenceremove preservation fix only. No "khựng" artifacts.
- Future Option E will implement net-addition injection: measure existing silence at each punctuation boundary, inject only `max(0, targetMs - existingMs)`. This eliminates stacking while still providing consistent pacing.
- To re-enable: set `TTS_ENABLE_PUNCTUATION_PAUSES=true` in `.env.local` (never in production until Option E is shipped).
- Emergency re-render script: `scripts/emergency-rerender-tts-option-d.ts`.

---

## ADR-024: Loudnorm-Only Audio Normalization for phat_phap TTS

**Date:** 2026-06-12
**Status:** Accepted
**Context:**

After ADR-023 gated deterministic pause injection, the remaining audio pipeline for phat_phap TTS still applied a two-stage FFmpeg normalization:

1. `silenceremove=start_periods=1:...:stop_duration=0.80:stop_silence=0.28:detection=rms` — strips leading silence and interior dead-air
2. `loudnorm=I=-16:TP=-1.5:LRA=11` — broadcast-safe loudness

Native prosody test (`scripts/test-vieneu-native-prosody.ts`, 2026-06-12) comparing 4 audio variants across 3 content items revealed:

| Variant | avg seg>150ms | avg seg>300ms | avg maxMs | Notes |
|---------|--------------|--------------|-----------|-------|
| A raw_vieneu | 4.0 | 2.0 | 341ms | VieNeu native output |
| B loudnorm_only | 3.7 | 1.0 | 320ms | loudnorm preserves prosody |
| C silenceremove+loudnorm | 0.7 | 0.3 | 185ms | strips 3+ pauses, 1 item→0 pauses |
| D rewritten_short | 8.0 | 2.0 | 526ms | shorter sentences help |

Key findings:
- VieNeu-TTS natively produces 150–350ms prosodic pauses at natural breath/comma points.
- Loudnorm is safe: minimal impact on pause counts (Δ ≤0.5 avg at all thresholds).
- Silenceremove (stop_duration=0.80) still strips 70–100% of pauses. Item 8d12d8ba: zero detectable pauses after silenceremove — completely breathless.
- Combined with the pass-injection "khựng" problem, the pipeline was double-degrading audio quality.

**Decision:**

In `src/lib/pipeline/tts.ts`, route audio normalization by `channelKey`:
- `channelKey = "phat_phap"` → loudnorm-only (`afFilter = "loudnorm=I=-16:TP=-1.5:LRA=11"`)
- Other channels → silenceremove + loudnorm (prior behavior, pending per-channel audit)

The routing is implemented in `normalizeAudioWithLoudnorm(inputPath, outputPath, { useSilenceremove })` with `useSilenceremove = channelKey !== "phat_phap"`. The silenceremove code is preserved and still active for non-phat_phap channels.

All 26 queued/unpublished phat_phap tts_short items were re-rendered with the new policy via `scripts/rerender-tts-loudnorm-only.ts` (2026-06-12). Post-render avg: 6–8 pauses >150ms, 1–3 pauses >300ms per item — VieNeu prosody preserved.

**Consequences:**

- phat_phap short TTS audio: natural VieNeu prosody preserved; subtle pauses at commas and sentence boundaries audible.
- silenceremove code remains for other channels (not deleted).
- QA log now reports `channel_key`, `silenceremove=true/false`, `pauses_150ms`, `pauses_300ms`, `duration` per TTS run.
- Future: Option E (net-addition pause injection) will measure existing silence before injecting, bringing pacing up to Buddhist guideline (comma 120–180ms, sentence 300–450ms) without stacking. Only re-enable `TTS_ENABLE_PUNCTUATION_PAUSES=true` after Option E ships.
- Re-render script: `scripts/rerender-tts-loudnorm-only.ts`.

---

## ADR-027: Upload Slot Occupancy Includes Done Rows

**Date:** 2026-06-15
**Status:** Accepted

**Context:**

A June 2026 incident caused overposting on Facebook Trí Tuệ An Nhiên. Root cause: slot-occupancy dedupe checks in scheduling paths (`bulkScheduleAction`, `insertPhatPhapCampaignFbRow`, schedule-mixer) only queried `status IN ('queued', 'uploading')`. A slot where a video had already been published (`status = 'done'`) was treated as free. On a backlog drain, the scheduler re-used previously-published slots, creating duplicate uploads.

**Decision:**

All slot-occupancy checks treat `queued`, `uploading`, and `done` as slot-blocking statuses. `cancelled` rows do not block slots — a cancelled slot is intentionally reusable by operators. `error` rows do not block slots either; they are retried or requeued explicitly.

Facebook quote/photo row insertion (`insertPhatPhapCampaignFbRow`) now checks for an existing row at the same `(contentId, channelId, videoType, scheduledAt)` before inserting, aborting silently if one already exists.

**Consequences:**

- Scheduler can never re-use a slot where a video was successfully published.
- `cancelled` slots can be re-scheduled by operator action (gallery → schedule modal or explicit SQL).
- Audit command `npm run audit:upload-slots` (`scripts/audit-upload-slots.ts`) should be run after any Docker downtime, cron outage, or queue cleanup to verify zero active collisions.

---

## ADR-028: Backlog Drain Requires Operator-Safe Handling

**Date:** 2026-06-16
**Status:** Accepted

**Context:**

After Docker/Postgres went offline on 2026-06-16, the queue accumulated 41 overdue rows. When Postgres recovered, cron resumed and drained all 41 rows within ~24 minutes — publishing to live channels without operator review. This is structurally correct (cron does its job) but can cause perceived overposting when the backlog represents stale scheduled dates from hours or days earlier.

**Decision:**

After any Docker/Postgres downtime or extended cron outage, the operator should:
1. Run `npm run audit:upload-slots` to count overdue rows and check for collisions.
2. If overdue count is large (more than a few hours' worth of rhythm slots), acquire the advisory lock and defer/cancel overdue rows before releasing cron.
3. Use the standard Postgres advisory lock key (`72400131`) to pause cron during manual cleanup. Hold on a single `pg.Client` (not pool) to keep the session lock active.
4. Verify `overdue_queued = 0` and `collisions_48h = 0` before releasing lock.

A future code-level guard should enforce a max overdue-rows-per-cron-run limit to prevent silent mass drain. Until then, the operator check is mandatory after outages.

**Consequences:**

- Cron resume after outage is not "safe by default" for large backlogs.
- Small backlogs (1–3 overdue rows) are safe to drain unattended.
- Script `scripts/_emergency_stop_backlog.mjs` exists as a reference pattern for advisory-lock-based emergency cleanup.

---

## ADR-029: YouTube Quota Rotation vs OAuth Health

**Date:** 2026-06-16
**Status:** Accepted

**Context:**

`processUploadQueueAction` rotates to an alternate `social_channels` credential row when a YouTube upload fails with quota or auth errors. Multiple rows exist for the same YouTube channel (`platformChannelId`), each linked to a different GCP Project OAuth client (`oauthClientConfigId`). The rotation function `findAvailableYouTubeChannel` selects the next row where: `isActive = true`, `needsReconnect = false`, `quotaExceededUntil` is null or in the past, `accessToken IS NOT NULL`, and `done_today < SAFE_UPLOAD_LIMIT`.

Investigation on 2026-06-16 revealed that `findAvailableYouTubeChannel` does NOT filter by `last_error`. A row with `last_error = 'invalid_grant'` and `needsReconnect = false` is treated as a healthy rotation candidate. This means rotation cycles through all credential rows before exhausting them, with one wasted cron tick per bad credential.

Additionally, `connectYouTubeChannel` does not clear `last_error` on successful reconnect. After re-authorization, `last_error` remains stale indefinitely.

**Decision:**

The current rotation behavior is accepted as-is for now. Rotation correctly handles quota exhaustion (the primary intended use case). For `invalid_grant`, the `isTokenRevokedError` path in `uploadToYouTube` sets `needsReconnect = true` only when the error comes from the token refresh step (`getFreshOAuth2Client`). When `invalid_grant` comes from the YouTube upload API response body (not the error `.message`), `isTokenRevokedError(err)` misses it and `needsReconnect` is not set.

Recommended future fixes (not yet implemented):
1. `findAvailableYouTubeChannel` should skip rows where `lastError` contains `'invalid_grant'`.
2. `connectYouTubeChannel` should set `lastError = null` after successful token exchange and channel verification.
3. `isTokenRevokedError` should check `err?.response?.data?.error?.errors?.[0]?.reason` in addition to `err.message`.

**Consequences:**

- Quota rotation (the primary use case) works correctly.
- `invalid_grant` after Docker restart may be transient (Google OAuth backend issue during reconnect window); verified credentials are often healthy after a short delay.
- After any `invalid_grant` incident, run a live token verification (force `refreshAccessToken()` + `channels.list?mine=true`) before concluding tokens need re-authorization.

---

## ADR-030: Telegram Notifications Must Not Block Publishing

**Date:** 2026-06-16
**Status:** Accepted

**Context:**

`sendTelegramMessage()` wraps all sends in `try/catch` with errors swallowed (logged only). This is the correct pattern. However, during backlog drain events, the publish processor sends individual Telegram notifications per success item AND a batch summary per cron run. When 39 items drain in 24 minutes, this produces a noisy burst of success messages.

**Decision:**

Telegram failures must always be swallowed and never block upload processing. This is already the implementation; this ADR documents it as a durable project decision.

During backlog drain, success Telegram messages are acceptable noise for now. A future improvement should batch/debounce success notifications during drain windows — send one summary message per drain run rather than one per video. This is a UX improvement, not a correctness issue.

Telegram is observability, not part of the publishing critical path. Any change that makes Telegram errors affect publish outcomes is explicitly rejected.

*End of DECISIONS.md — 31 ADRs documented.*
