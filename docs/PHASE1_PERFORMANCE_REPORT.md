# Phase 1 Performance Report

## Scope

Phase 1 only optimized the existing pipeline. No new product feature, no UX change, no intended output change.

Implemented:

1. Enabled `h264_videotoolbox` on Apple Silicon with fallback to `libx264`
2. Ran short-pipeline `TTS + image generation` in parallel
3. Kept multi-image generation on `Promise.all` and made short-image download/save fully `Promise.all`
4. Added TTS cache keyed by `SHA256(script)` and voice namespace
5. Added `loudnorm` normalization to TTS output
6. Raised safe runtime throughput for this machine (`Apple M4`, `16 GB RAM`):
   - short pipeline effective batch floor: `4`
   - short pipeline concurrency: `2`
   - long pipeline effective batch floor: `2`
   - long pipeline concurrency: `2`

## Benchmark Environment

- Machine: `Apple M4 / 16 GB / macOS arm64`
- FFmpeg build: `h264_videotoolbox` available
- Benchmark target: short pipeline for content `1db764aa-bedc-4662-a127-72ad3a2d4613`
- Image count: `1`
- Benchmark method:
  - **Before**: sequential `runTTS -> runImages -> runShortVideo`
  - **After**: parallel `runTTS || runImages`, then `runShortVideo`

## Render Time Before

| Step | Time (ms) | Time (s) |
|---|---:|---:|
| TTS | 45,134 | 45.13 |
| Images | 6,673 | 6.67 |
| Video render | 25,263 | 25.26 |
| **Total** | **77,070** | **77.07** |

## Render Time After

| Step | Time (ms) | Time (s) |
|---|---:|---:|
| TTS + Images (parallel prep) | 45,874 | 45.87 |
| Video render | 24,739 | 24.74 |
| **Total** | **70,613** | **70.61** |

## Improvement

### End-to-end

- Before: `77,070 ms`
- After: `70,613 ms`
- Improvement: `6,457 ms`
- **Percent improvement: 8.38%**

### Prep stage only

Sequential prep before:

- `TTS + Images = 45,134 + 6,673 = 51,807 ms`

Parallel prep after:

- `45,874 ms`

Improvement:

- `5,933 ms`
- **Percent improvement: 11.45%**

### Video stage only

- Before: `25,263 ms`
- After: `24,739 ms`
- Improvement: `524 ms`
- **Percent improvement: 2.07%**

## TTS Cache Result

Warm-cache rerun of the same script:

| Scenario | Time (ms) |
|---|---:|
| Original cold TTS | 45,134 |
| Warm cache hit | 34 |

Improvement:

- `45,100 ms`
- **Percent improvement: 99.92%**

This does not change the cold-run benchmark above. It only shows the impact of the new cache when the same script is rendered again.

## Bottlenecks Remaining

1. **Cold TTS still dominates**
   - Even after parallelization, cold TTS is still the longest single stage.
   - `loudnorm` adds a small extra cost, but the dominant cost is still TTS service latency + polling.

2. **FFmpeg subtitle render is still CPU-heavy**
   - `VideoToolbox` helps the encode stage, but the pipeline still spends time in filter graph work:
     - scale/crop
     - ASS subtitle burn-in
     - title overlay
     - audio mix
   - Because of that, hardware encode does not produce a massive win on this specific short test.

3. **fal image generation latency is external**
   - Image generation is already mostly parallel.
   - Remaining time is mostly service/network latency, not local CPU.

4. **Whisper timestamp extraction remains synchronous**
   - Subtitle timing still depends on local Whisper timestamp extraction when used.
   - That remains part of the render critical path.

## Files Changed

- `/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts`
- `/Users/bichtuyen/code/content_pipline/src/lib/pipeline/images.ts`
- `/Users/bichtuyen/code/content_pipline/src/lib/pipeline/short-video.ts`
- `/Users/bichtuyen/code/content_pipline/src/lib/pipeline/long-video.ts`
- `/Users/bichtuyen/code/content_pipline/src/lib/pipeline/perf.ts`
- `/Users/bichtuyen/code/content_pipline/src/actions/content-generator.ts`

## Conclusion

Phase 1 achieved a measurable speedup on the target machine without changing product behavior:

- **8.38% faster end-to-end cold short render**
- **11.45% faster prep stage**
- **99.92% faster repeated TTS for the same script**

The largest remaining bottleneck is still cold TTS latency, followed by CPU-side FFmpeg filter work.
