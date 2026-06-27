# Performance Audit

> Reviewed: 2026-06-01 | Platform: Apple Silicon M4 16GB

---

## Executive Summary

The biggest bottleneck is not hardware — it is **sequential LLM calls** in the long script engine. A single long video generation makes 7–10 blocking LLM API round-trips in series. At 1–3 seconds each, this adds 10–25 seconds of pure waiting before a single byte of audio is generated. The second bottleneck is the **cron-tick pipeline**: each stage waits for the next 1-minute cron cycle, meaning a completed TTS has to wait up to 60 seconds before images start.

---

## Bottleneck Map

```
Long video end-to-end time breakdown (current):

LLM content generation:   10-25s   (7-10 sequential calls, each 1-3s)
TTS synthesis:            2-8 min  (async polling, 15s intervals)
Image generation:         15-40s   (5 images + 1 thumbnail, Fal.ai)
Longform metadata:        5-12s    (6 sequential LLM calls)
Video assembly:           60-180s  (FFmpeg with VideoToolbox)
Whisper transcription:    30-120s  (Python subprocess)
Cron-gap delays:          0-5 min  (waiting for next cron tick between stages)

Total wall time:          ~5-15 minutes per long video
```

---

## Opportunities Ranked by ROI

---

### OPT-1 — Parallelize Long Script Sections [ROI: CRITICAL]

**Current behavior:**
```
outline → opening → section1 → section2 → section3 → section4 → closing
(7 sequential LLM calls, each 1-3s RTT)
```

**Problem:** Sections 2, 3, 4 are written in a loop with `for...of` — fully sequential. Only the previous section's last 35 words are needed as context. This is a weak dependency that does not require strict ordering.

**Fix:**
```typescript
// Instead of sequential for...of:
const sectionResults = await Promise.all(
  outline.sections.map((section, index) =>
    generateText(client, model, buildLongSectionPrompt({
      ...params, section, sectionIndex: index,
      previousSummary: "" // accept minor quality tradeoff for parallelism
    }), 0.72, 950)
  )
);
```

For the `previousSummary` dependency: generate sections 1-2 first (parallel), then use section 1 summary for section 3-4 (parallel). Two rounds instead of 4 sequential calls.

- **Current:** 4 × ~2s = ~8s for sections
- **After parallel:** ~2s + ~2s = ~4s (2 rounds)
- **Speedup:** ~4× for section generation, ~2× overall long content generation
- **Effort:** 2 hours
- **Risk:** Low — slight reduction in cross-section narrative continuity (section N doesn't reference section N-1 directly)

---

### OPT-2 — Reduce Cron-Tick Gaps: Trigger Next Stage Immediately [ROI: HIGH]

**Current behavior:**
```
cron tick 1: TTS starts
cron tick 2: (up to 60s later) images start
cron tick 3: (up to 60s later) video assembly starts
```

**Problem:** After TTS completes, `processUploadQueueAction` moves to images only on the next cron tick. Each inter-stage gap is 0–60 seconds.

**Fix:** After each stage completes, immediately call the next stage inline rather than deferring to cron:
```typescript
// In runTTS: on success, immediately call runImages
// In runImages: on success, immediately call runVideo
```

This collapses 3+ cron cycles into 1 cron cycle for the full pipeline.

- **Speedup:** Saves 1–3 minutes per video (2–4 cron gaps × 0–60s each)
- **Effort:** 4 hours
- **Risk:** Medium — increases cron run duration, must be careful about total timeout

---

### OPT-3 — TTS Polling: Reduce Interval from 15s to 5s [ROI: HIGH]

**Current behavior:** Poll TTS status every 15 seconds for up to 25 minutes.

**Problem:** If TTS completes in 90 seconds, the pipeline waits up to 15 additional seconds before detecting completion. Average unnecessary wait: ~7.5s per video.

**Fix:**
```typescript
const POLL_INTERVAL_MS = 5_000; // down from 15_000
```

At 5s intervals, the TTS service receives 3× more status requests. This is negligible load (GET /tts/status/{id} is a lightweight endpoint) but saves 10s average per video.

- **Speedup:** ~7–12s saved per video
- **Effort:** 5 minutes
- **Risk:** Zero — VieNeu-TTS status endpoint is trivially cheap

---

### OPT-4 — Replace Python Whisper with whisper.cpp [ROI: HIGH]

**Current behavior:**
```
execFileAsync("python3", ["scripts/whisper_timestamps.py", audioPath])
  timeout: 120s (short), 300s (long)
```

**Problem:**
1. Python startup overhead: ~2s for interpreter + model load every call
2. No Apple Silicon Metal/ANE acceleration in Python Whisper
3. Must manage Python environment separately
4. Silent failure if Python is not available

**Fix:** Use `whisper.cpp` with Core ML on Apple Silicon:
```bash
# whisper.cpp with Core ML acceleration
./main -m models/ggml-small.bin --output-json --language vi audio.wav
```

whisper.cpp on M4 with small model runs ~5-10× faster than Python whisper with CPU. Core ML provides additional 2-3× speedup.

- **Current:** 30-120s (short), 60-300s (long)
- **After whisper.cpp + CoreML:** 5-20s (short), 10-40s (long)
- **Speedup:** ~4-6× on transcription
- **Effort:** 4 hours (build whisper.cpp, update subprocess call, handle JSON output format)
- **Risk:** Low — output format is compatible; same JSON word timestamps

---

### OPT-5 — Run Longform Engine Concurrent with Video Assembly [ROI: MEDIUM]

**Current behavior:** For long video, the pipeline runs:
1. LLM content → 2. TTS → 3. Images → 4. Video assembly → 5. Longform metadata

**Problem:** Longform metadata (titles, description, tags) doesn't need the video file — it only needs the script text. It could run concurrently with TTS.

**Fix:** Start `runLongformEngine()` as a background task at the same time as TTS:
```typescript
const [ttsResult, longformResult] = await Promise.all([
  runTTS(contentId, "long"),
  runLongformEngine({ client, model, topic, script, ... })
]);
```

- **Speedup:** Saves 5–12s (longform metadata duration) from the critical path
- **Effort:** 3 hours (restructure stage ordering in processUploadQueueAction)
- **Risk:** Low — longform metadata doesn't affect TTS or video

---

### OPT-6 — Cache Image Prompts to Avoid Re-generation [ROI: MEDIUM]

**Current behavior:** Every time images need to be regenerated (e.g., after `regenerateShortHooksAction`), the image prompts are re-generated via LLM.

**Problem:** Image prompts derived from the same script text produce essentially the same prompts (temperature 0.6). Re-generation wastes $0.0001–0.0003 per generation and 1–2 seconds.

**Fix:** Hash the script text + niche + n → cache image prompts in DB or in-memory for 24h. If cached prompts exist, skip the LLM call and go directly to Fal.ai with fresh image generation.

- **Speedup:** 1-2s + $0.0002 saved on re-generations
- **Effort:** 2 hours
- **Risk:** Zero

---

### OPT-7 — FFmpeg VideoToolbox Bitrate Tuning [ROI: MEDIUM]

**Current VideoToolbox settings:**
- Short: 8M bitrate, 10M maxrate, 16M bufsize
- Long: 10M bitrate, 12M maxrate, 20M bufsize

**Problem:** For a 60-second short video at 1080×1920, 8Mbps results in a ~60MB file. YouTube Shorts is served at ~2-4Mbps. Excess bitrate wastes storage and upload time.

**Fix:**
```typescript
// Short (upload to YouTube/Facebook)
"-b:v", "4M", "-maxrate", "5M", "-bufsize", "8M"  // half of current

// Long (15-18 min, 1920×1080)
"-b:v", "6M", "-maxrate", "8M", "-bufsize", "12M"
```

- **Speedup:** ~15-20% faster FFmpeg encode (lower bitrate = faster VBV buffer)
- **File size:** 50% smaller → 50% faster upload
- **Effort:** 30 minutes
- **Risk:** Low — visual quality at 4M on 1080p is indistinguishable from 8M for this content type

---

### OPT-8 — Parallel Hook Generation and Short Script [ROI: LOW-MEDIUM]

**Current behavior for "both" mode:**
1. `generateShortHooksAndScript()` — sequential (hook gen → score → script)
2. If long: use same hook for long script

**Observation:** When mode is "both", the long script can use the same hook as short. But currently the hook engine runs only once and the result is passed to both scripts — this is already correct. No parallelism improvement possible here without generating two independent hooks.

**Verdict:** Already optimized. Skip.

---

### OPT-9 — Fal.ai Image Generation: Batch Mode [ROI: LOW]

**Current behavior:** 5 landscape images + 1 thumbnail = 6 separate Fal.ai API calls (all called with `Promise.all`).

Fal.ai has a `num_images` parameter on some models (flux/dev, flux/schnell) but it's applied per-call. For `flux-pro/v1.1-ultra` (thumbnail), each call generates exactly 1 image.

**Observation:** The current code already calls these in parallel. No batch mode available on Fal.ai for mixed-model requests.

**Verdict:** Already optimized. Skip.

---

### OPT-10 — Apple Silicon ANE for Audio Normalization [ROI: LOW]

**Current behavior:** FFmpeg loudnorm runs via CPU (`execFileAsync(FFMPEG_PATH, ["-af", "loudnorm..."])`).

**Opportunity:** Apple's CoreAudio can do loudness normalization natively. However, implementing this requires native macOS audio tooling (AVFoundation) which has no Node.js binding.

**Alternative:** Use FFmpeg with hardware-accelerated audio filter: `afir`, `superequalizer` — but these don't have VideoToolbox equivalents for audio.

**Verdict:** FFmpeg loudnorm on M4 completes in <2s for a 60s audio file. Not a bottleneck. Skip.

---

## Performance Summary Table

| Opportunity | Current Time | After Fix | Speedup | Effort | Priority |
|-------------|-------------|-----------|---------|--------|----------|
| OPT-1: Parallel sections | 8s (sections) | 4s | 2× | 2h | **Critical** |
| OPT-2: No cron gaps | 2-5min wait | 0-30s | ~5× | 4h | **High** |
| OPT-3: TTS poll 5s | +7s avg wait | +2s avg | 3.5× wait | 5min | **High** |
| OPT-4: whisper.cpp | 30-300s | 5-40s | 4-6× | 4h | **High** |
| OPT-5: Longform parallel | +10s serial | 0s added | eliminates | 3h | **Medium** |
| OPT-6: Image prompt cache | 1-2s + cost | 0s + $0 | full save | 2h | **Medium** |
| OPT-7: FFmpeg bitrate | +20% encode | baseline | 15-20% | 30min | **Medium** |
| OPT-9: Fal.ai batch | already parallel | — | 0 | 0 | Done |

**Combined impact of OPT-1 through OPT-5:** Long video wall time reduces from **8–15 min** to **3–6 min** (2–3× overall).
