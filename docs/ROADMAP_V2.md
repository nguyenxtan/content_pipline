# Roadmap V2

> Generated: 2026-06-01  
> Based on: Architecture, Performance, Content Quality, Cost, and Reliability Audits

---

## How to Read This Document

Each phase is ordered by **ROI: improvement delivered / implementation effort**.  
Phase 1 items have the highest ratio — ship these first before anything else.

**Impact tiers:**
- 🔴 Critical — affects production reliability or costs money every day
- 🟠 High — meaningful quality or performance improvement
- 🟡 Medium — noticeable quality or efficiency gain
- 🟢 Low — polish, maintainability, future-proofing

---

## Phase 1 — Highest ROI (2–4 weeks)

*Fix what breaks money, production, and quality today.*

---

### 1.1 — LLM + Fal.ai Retry with Exponential Backoff 🔴

**Why it matters:** ~2-5% of LLM calls fail with transient 429/503 errors. Currently, one transient error permanently fails the entire content generation job. At 10 videos/day, this is 1-2 permanently failed jobs per day requiring manual re-trigger.

**What to build:**
```typescript
// src/lib/llm/retry.ts
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1000, retryOn = ["429", "503", "timeout"] }
): Promise<T>
```
Apply to: all `client.chat.completions.create()` calls and all `fal.subscribe()` calls.

**Estimated effort:** 3 hours  
**Expected impact:** Eliminate ~90% of transient failure-induced job failures

---

### 1.2 — Upload Queue Race Condition Fix 🔴

**Why it matters:** Two concurrent cron ticks can both pick up the same queued upload, causing the same video to be uploaded twice to YouTube and Facebook. YouTube marks duplicate uploads as violations.

**What to build:** Replace the two-step `SELECT → UPDATE` with `UPDATE ... WHERE status='queued' ... RETURNING * FOR UPDATE SKIP LOCKED`.

**Estimated effort:** 2 hours  
**Expected impact:** Eliminate double-upload violations  
**Dependencies:** Postgres 9.5+  ✅ already available

---

### 1.3 — Switch Thumbnail from `flux-pro/v1.1-ultra` to `flux/dev` 🔴

**Why it matters:** Thumbnail model costs $0.060 vs $0.025 for `flux/dev`. At 10 long videos/day, this is $127/year wasted on imperceptible quality difference for a single static thumbnail viewed at 1280×720.

**What to build:** Change `LONG_THUMBNAIL_FAL_MODEL_DEFAULT` in `image-config-constants.ts` from `"fal-ai/flux-pro/v1.1-ultra"` to `"fal-ai/flux/dev"`. Users can still override to ultra via app config UI.

**Estimated effort:** 10 minutes  
**Expected impact:** $127/year saved, 2-3s faster thumbnail generation  
**Dependencies:** None

---

### 1.4 — TTS Poll Interval: 15s → 5s 🟠

**Why it matters:** Average unnecessary wait of ~7.5s per video. At 15 videos/day, this is 112 seconds/day of pure waiting. Costs zero — VieNeu status endpoint is a trivial GET.

**What to build:** Change `POLL_INTERVAL_MS = 15_000` to `POLL_INTERVAL_MS = 5_000` in `tts.ts`.

**Estimated effort:** 5 minutes  
**Expected impact:** ~7-12s faster per video, no cost impact

---

### 1.5 — Parallelize Long Script Section Generation 🟠

**Why it matters:** 4 sections are generated sequentially in a `for...of` loop — total ~8s pure LLM waiting. Parallelizing sections 1+2 and 3+4 cuts this to ~4s.

**What to build:**
```typescript
// Round 1: Generate sections 0 and 1 in parallel (no previousSummary dependency)
const [sec0, sec1] = await Promise.all([
  generateText(client, model, buildLongSectionPrompt({...params, section: sections[0], sectionIndex: 0, previousSummary: ""}), 0.72, 950),
  generateText(client, model, buildLongSectionPrompt({...params, section: sections[1], sectionIndex: 1, previousSummary: ""}), 0.72, 950),
]);

// Round 2: Generate sections 2 and 3 using sec0/sec1 as context
const prev01 = sec0.text.split(/\s+/).slice(-35).join(" ");
const [sec2, sec3] = await Promise.all([
  generateText(client, model, buildLongSectionPrompt({...params, section: sections[2], sectionIndex: 2, previousSummary: prev01}), 0.72, 950),
  generateText(client, model, buildLongSectionPrompt({...params, section: sections[3], sectionIndex: 3, previousSummary: prev01}), 0.72, 950),
]);
```

**Estimated effort:** 2 hours  
**Expected impact:** ~4s faster long content generation (2× section throughput)  
**Quality tradeoff:** Sections 1 and 3 have slightly weaker narrative connection to their immediate predecessor

---

### 1.6 — Pipeline Stage Error Alerts via Telegram 🟠

**Why it matters:** Currently, TTS failure, image failure, and video assembly failure all write to DB but send zero Telegram alerts. You discover failures only by checking the UI.

**What to build:** Add a `notifyPipelineFailure(stage, contentId, error)` call inside each pipeline catch block:
```typescript
// In runTTS catch block:
await sendTelegram(`⚠️ <b>TTS thất bại</b>\n` +
  `Content: ${contentId}\nLỗi: <code>${message.slice(0, 200)}</code>`);
```

Apply to: `runTTS`, `runShortVideo`, `runLongVideo`, `runImages`, `runLongImages`.

**Estimated effort:** 2 hours  
**Expected impact:** Eliminate silent production failures — know within 1 minute when a video fails

---

### 1.7 — Short Video: Increase to 3 Background Images 🟠

**Why it matters:** `IMAGE_COUNT_DEFAULT = 1` means every short video shows one static image for 60 seconds. This is a strong negative signal for viewer retention — Shorts algorithm penalizes static video.

**What to build:** Change `IMAGE_COUNT_DEFAULT = 1` to `IMAGE_COUNT_DEFAULT = 3` in `image-config-constants.ts`. At `flux/schnell` ($0.003/image), 3 images = $0.009 vs $0.003 — $0.006 extra per short video.

**Estimated effort:** 10 minutes + test  
**Expected impact:** Estimated 15-30% improvement in Shorts watch time retention  
**Dependencies:** None — the short-video.ts pipeline already handles multiple images

---

### 1.8 — Collapse Cron Gaps: Trigger Next Stage Immediately 🟠

**Why it matters:** After TTS completes, the pipeline waits up to 60 seconds for the next cron tick before starting image generation. For 3 inter-stage gaps, this adds 0-3 minutes of dead time per video.

**What to build:** After successful TTS, call `runImages` immediately (inline, same cron tick). Chain stages inline:
```typescript
// In processUploadQueueAction:
const ttsResult = await runTTS(item.contentId, videoType);
if (ttsResult.success) {
  const imagesResult = await runImages(item.contentId);
  if (imagesResult.success) {
    await runShortVideo(item.contentId);
  }
}
```

**Estimated effort:** 4 hours (refactor processUploadQueueAction flow)  
**Expected impact:** 1-3 minutes faster per video end-to-end  
**Risk:** Cron tick duration increases — ensure cron timeout is 10+ minutes

---

## Phase 2 — Quality Improvements (4–8 weeks)

*Improve the content itself. These changes affect viewer retention and channel growth.*

---

### 2.1 — CTA Rotation (3 variants) 🟠

**Why it matters:** The same 24-word CTA appears verbatim on every video. Regular viewers skip it mentally after 10 videos. A rotating CTA feels fresher and performs better on returning viewers.

**What to build:**
```typescript
const CTA_VARIANTS = [
  "Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống.",
  "Nếu nội dung này chạm đến quý vị, hãy chia sẻ với người cần nghe hôm nay.",
  "Đăng ký kênh để không bỏ lỡ những chiêm nghiệm tiếp theo — mỗi ngày một điều đáng suy ngẫm.",
];
export function pickCta(seed: string): string {
  return CTA_VARIANTS[hashToIndex(seed, CTA_VARIANTS.length)];
}
```

**Estimated effort:** 2 hours  
**Expected impact:** ~5-10% improvement in CTA click-through rate (channel growth)

---

### 2.2 — Narrative Integration Pass for Long Scripts 🟠

**Why it matters:** Long script sections are written in isolation. Metaphor repetition, inconsistent emotional arc, and abrupt section transitions are the top complaints from viewers who watch to the end.

**What to build:** After generating all sections, run a single "integration pass" LLM call:
```
System: "You are a Vietnamese narrative editor. You will receive a complete script draft 
and your job is to: (1) identify and resolve repeated metaphors, (2) smooth section 
transitions, (3) create an echo between the opening image and closing image."

User: [full assembled script]

Output: The revised script only.
```
Temperature 0.4, max_tokens 4000.

**Estimated effort:** 3 hours  
**Expected impact:** Estimated 20-30% improvement in full-video watch time (from ~40% to ~55%)  
**Cost:** ~$0.002/video additional (4000-token call at gpt-4o-mini)  
**Dependencies:** Phase 1 parallel sections must be done first

---

### 2.3 — Hook Scoring: Replace 4 Criteria with 2 🟡

**Why it matters:** The 4-criterion scoring (curiosity, emotion, relatability, retention) has ~0.8 correlation between curiosity and retention. It produces redundant signal. `emotion` and `relatability` are better predictors of this content type's performance.

**What to build:** Simplify scoring to 2 criteria: `emotional_resonance` (0-10) and `authenticity` (0-10), weighted 60/40. Update `buildHookScoringPrompt()`.

**Estimated effort:** 1 hour  
**Expected impact:** ~5-10% better hook selection; 50% fewer scoring tokens

---

### 2.4 — Visual Style Lock Per Niche 🟡

**Why it matters:** `randomBuddhistStyle()` picks a random visual style per video. After 50 videos, the channel has no visual identity.

**What to build:** Add `visualStyle TEXT DEFAULT 'cinematic'` column to `niches` table. Use `niche.visualStyle` in all image prompt generation calls. Remove `randomBuddhistStyle()`.

**Estimated effort:** 3 hours (migration + UI)  
**Expected impact:** Brand consistency → higher subscriber recognition and trust

---

### 2.5 — Add Thumbnail Text Overlay (Post-Processing) 🟡

**Why it matters:** The best-performing Vietnamese Buddhist thumbnails have 3-5 word text overlay. Currently, thumbnail images are generated text-free and no overlay is added. The `thumbnail_intent.text` field is generated but never rendered.

**What to build:**
1. After Fal.ai renders the thumbnail image, use FFmpeg `drawtext` filter to overlay `thumbnail_intent.text` (5 words max, white text, drop shadow, bottom-center position)
2. The text is already generated by P-19 (or merged into P-13 after audit fix)

**Estimated effort:** 4 hours  
**Expected impact:** Estimated 20-40% improvement in thumbnail CTR for long videos

---

### 2.6 — Zod Validation on All LLM JSON Outputs 🟡

**Why it matters:** Unvalidated LLM JSON creates silent corruption bugs. An empty sections array or a missing `closingAngle` produces a broken video with no error visible to the user.

**What to build:** Define Zod schemas for: hook scoring output, long outline, title scoring, tags, thumbnail intent, image prompts. Throw a structured error on parse failure instead of silently defaulting.

**Estimated effort:** 4 hours  
**Expected impact:** Eliminate a class of subtle silent corruption bugs

---

### 2.7 — Replace Python Whisper with whisper.cpp 🟡

**Why it matters:** Python Whisper takes 30-300s. whisper.cpp with Core ML on M4 takes 5-40s. Eliminates Python environment dependency.

**What to build:**
1. Build whisper.cpp with Core ML support
2. Replace `execFileAsync("python3", ["scripts/whisper_timestamps.py", ...])` with `execFileAsync("whisper-cpp/main", ["-m", "models/ggml-small.bin", "--output-json", "--language", "vi", audioPath])`
3. Parse the slightly different JSON output format

**Estimated effort:** 4 hours  
**Expected impact:** 4-6× faster Whisper transcription; eliminates Python dependency  
**Dependencies:** whisper.cpp must be built and committed, or installed via Homebrew

---

### 2.8 — Topic Diversity Enforcement 🟡

**Why it matters:** Without category tracking, a week of topics can all cluster around "loss" or "forgiveness" themes, fatiguing the channel's audience.

**What to build:** Add 5 emotional categories to topic suggestion: `loss, fear, forgiveness, impermanence, gratitude`. Track which category each generated topic falls into. Require the next suggested topic to be from an underrepresented category.

**Estimated effort:** 3 hours  
**Expected impact:** More varied content → lower audience fatigue → better subscriber retention

---

## Phase 3 — Scale & Automation (8–16 weeks)

*Enable higher throughput and reduce human intervention.*

---

### 3.1 — Automated Upload Retry with Backoff 🟠

**Why it matters:** Failed uploads currently require manual UI intervention. At scale (20+ videos/day), this is unsustainable.

**What to build:**
1. Add `retry_count` and `last_attempt_at` to `uploadQueue`
2. In `processUploadQueueAction`: check for rows with `status = 'error' AND retry_count < 3 AND last_attempt_at < NOW() - INTERVAL '30 minutes'`
3. Auto-retry those rows, increment retry count, send Telegram on each retry attempt
4. After 3 failures, send Telegram requesting human intervention

**Estimated effort:** 4 hours  
**Expected impact:** Eliminate manual upload re-trigger for transient failures

---

### 3.2 — Pipeline Stage Runner Abstraction 🟡

**Why it matters:** The boilerplate `DB lookup → validate → set status=processing → do work → set status=done/error` pattern is duplicated in 5 pipeline files. A bug in this pattern (e.g., missing status update on early return) exists independently in each file.

**What to build:**
```typescript
// src/lib/pipeline/stage-runner.ts
export async function runStage<T>(
  contentId: string,
  stage: "tts" | "images" | "video",
  fn: (row: ContentGeneration) => Promise<T>
): Promise<{ success: true; result: T } | { success: false; error: string }>
```
This wrapper handles: idempotency check, DB status lifecycle, error capture, Telegram alert.

**Estimated effort:** 6 hours  
**Expected impact:** Reduce pipeline boilerplate by ~40%, eliminate duplicated bug surface

---

### 3.3 — Content Quality Review Checkpoint (Human-in-the-Loop) 🟡

**Why it matters:** For a spiritual content channel, a single off-tone or inaccurate script can damage the channel's reputation. Fully automated generation has no quality gate before TTS.

**What to build:**
1. Add `requiresReview: boolean` flag to each niche (default false)
2. If `requiresReview = true`, after content generation, set status `awaiting_review` instead of immediately queuing for TTS
3. Add a review UI where an admin can approve/edit/reject
4. Telegram notification when a video needs review

**Estimated effort:** 8 hours  
**Expected impact:** Zero-defect publishing for niches where tone matters most

---

### 3.4 — Semantic Topic Deduplication 🟡

**Why it matters:** String-based dedup ("Buông bỏ" ≠ "Buông xuống" ≠ "Buông tay") allows semantically identical topics. Over 6 months of daily generation, viewers notice topic repetition.

**What to build:**
1. When a topic is generated, compute its embedding using `text-embedding-3-small` ($0.00002/1K tokens — negligible)
2. Store embedding in `niches.topicEmbeddings` (JSONB array of {topic, embedding, createdAt})
3. Before accepting a suggested topic, compute cosine similarity to all embeddings in the last 30 days
4. Reject if similarity > 0.85

**Estimated effort:** 6 hours  
**Expected impact:** Eliminate semantic topic repetition at scale

---

### 3.5 — Media Storage Reliability (Structured Cleanup + Paths) 🟡

**Why it matters:** Media accumulates at 850MB-2GB/day for long videos. `cleanupMediaFilesAction` failures are swallowed silently. Disk fills up in 50-120 days without cleanup.

**What to build:**
1. Fix `.catch(() => {})` to log cleanup failures to Telegram
2. Add disk usage check to cron health: alert if free space < 10GB
3. Store absolute media paths in DB rather than relative paths (avoid path-resolution issues)
4. Add a `media_size_bytes` column to `contentGenerations` to track per-video storage

**Estimated effort:** 4 hours  
**Expected impact:** Prevent disk-full production outages

---

## Phase 4 — Analytics & Optimization (4–8 weeks, ongoing)

*Use real performance data to improve content.*

---

### 4.1 — Analytics → Prompt Feedback Loop 🟠

**Why it matters:** The pipeline generates videos and tracks view counts — but never uses view count data to improve prompt strategy. This is the biggest missed opportunity in the entire system.

**What to build:**
1. Tag each `contentGeneration` with the hook used (`shortSelectedHook`), topic category, script model, image style
2. Weekly: compute which hook patterns correlate with videos that reached >5K views
3. Surface top-performing hook patterns in the topic suggestion prompt as "proven hooks that worked":
   ```
   Hook patterns từng đạt >5K view:
   - "Người làm quý vị tổn thương..." pattern (avg 8.2K views)
   - "Có những điều người ta mang theo..." pattern (avg 6.1K views)
   ```
4. Use these as additional examples in the hook generation prompt

**Estimated effort:** 8 hours (data pipeline) + 2 hours (prompt integration)  
**Expected impact:** Progressive improvement in hook quality as the channel grows; estimated 10-20% view lift within 3 months

---

### 4.2 — A/B Testing for Hook Variants 🟡

**Why it matters:** Currently `top3[0]` is always selected as the winning hook. But hook scoring is approximate. Running 2 videos per topic with different hooks (top1 vs top2) and measuring performance would generate ground truth data.

**What to build:**
1. 20% of generations: use `top3[1]` instead of `top3[0]` as selected hook
2. Tag these as "experiment" in DB
3. After 7 days, compare view counts for same topic across hook variants
4. Feed winning hook pattern back into Phase 4.1

**Estimated effort:** 4 hours  
**Expected impact:** Data-driven hook optimization; likely 15-25% view lift over 6 months

---

### 4.3 — Auto-Promote Short → Long Based on Performance 🟡

**Why it matters:** A short video that reaches 5K+ views is a proven topic. Running a long video on the same topic will likely capture the existing interested audience.

**What to build:**
1. After analytics sync, flag shorts with >5K views where no long video exists for the same topic
2. Auto-queue a long video generation for that topic
3. Telegram notification: "🎯 Short '{topic}' đạt {views} view — tự động tạo long video"

**Estimated effort:** 4 hours  
**Dependencies:** Phase 4.1 analytics tagging  
**Expected impact:** Higher long-video production efficiency by letting short videos qualify topics

---

### 4.4 — Cost Dashboard with Anomaly Detection 🟡

**Why it matters:** Currently there is no aggregated view of daily/weekly LLM + image generation cost. A model API pricing change or increased retry loops could 3× costs silently.

**What to build:**
1. Daily rollup of `aiUsageLogs.costUsd` by model, purpose, and niche
2. Compare to 7-day rolling average
3. If daily cost > 1.5× average, send Telegram alert
4. Add cost dashboard card to the main app UI

**Estimated effort:** 4 hours  
**Expected impact:** Cost anomaly detection; prevent silent cost overruns

---

## Implementation Priority Matrix

```
Phase 1 (Ship now):
  1.3 — Thumbnail model switch (10 min, -$127/yr)    ← Do first
  1.4 — TTS poll 5s (5 min)                          ← Do first
  1.7 — 3 background images for short (10 min)       ← Do first
  1.2 — Upload race condition fix (2h)
  1.1 — LLM + Fal retry (3h)
  1.6 — Pipeline error alerts (2h)
  1.5 — Parallel sections (2h)
  1.8 — Collapse cron gaps (4h)

Phase 2 (4–8 weeks):
  2.1 — CTA rotation (2h)
  2.5 — Thumbnail text overlay (4h)
  2.7 — whisper.cpp (4h)
  2.2 — Narrative integration pass (3h)
  2.6 — Zod validation (4h)
  2.4 — Visual style lock (3h)
  2.3 — Simplified hook scoring (1h)
  2.8 — Topic diversity (3h)

Phase 3 (8–16 weeks):
  3.5 — Media cleanup reliability (4h)
  3.1 — Upload auto-retry (4h)
  3.2 — Stage runner abstraction (6h)
  3.3 — Human review checkpoint (8h)
  3.4 — Semantic dedup (6h)

Phase 4 (ongoing):
  4.1 — Analytics → Prompt feedback loop
  4.4 — Cost dashboard
  4.3 — Auto short→long promotion
  4.2 — Hook A/B testing
```

---

## Expected Outcomes by Phase

| Metric | Current | After Phase 1 | After Phase 2 | After Phase 3-4 |
|--------|---------|--------------|--------------|-----------------|
| Video generation failures/day | 1-2 | <0.2 | <0.1 | <0.05 |
| Long video wall time | 8-15 min | 5-9 min | 4-7 min | 3-5 min |
| Cost per long video | $0.193 | $0.155 | $0.157 | $0.160 |
| Short video watch time retention | ~30-40% | ~45-55% | ~55-65% | ~60-70% |
| Long video view rate (>10% watch) | ~20-30% | ~25-35% | ~35-50% | ~45-60% |
| Manual interventions per week | 10-20 | 2-5 | 1-2 | 0-1 |
