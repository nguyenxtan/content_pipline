# Architecture Audit

> Reviewed: 2026-06-01 | Auditor: Staff Engineer / AI Pipeline Architect

---

## 1. End-to-End Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  TRIGGER                                                        │
│  Cron HTTP POST /api/cron/run  ←→  Manual UI trigger           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │  runSchedulerJobAction  │  (per-niche job)
              └────────────┬────────────┘
                           │
         ┌─────────────────▼─────────────────┐
         │       generateContentAction        │
         │  1. suggestTopics (LLM)            │
         │  2. runHookEngine (2 LLM calls)    │
         │  3. runScriptEngine short (1-4 LLM)│
         │  4. runScriptEngine long (7-9 LLM) │
         │  5. DB insert contentGenerations   │
         └─────────────────┬─────────────────┘
                           │
              ┌────────────▼────────────┐
              │  processUploadQueueAction│  (next cron tick)
              └──┬──────────────────────┘
                 │
       ┌─────────┼──────────┐
       ▼         ▼          ▼
  [short]    [long]     [quote]
     │           │          │
     ▼           ▼          │
  runTTS     runTTS         │
     │           │          │
     ▼           ▼          │
runImages  runLongImages     │
     │    +thumbnail        │
     ▼           ▼          ▼
runShortVideo runLongVideo renderFBQuote
     │           │          │
     └─────┬─────┘──────────┘
           │
     ┌─────▼──────┐
     │  Upload    │
     │  YouTube / │
     │  Facebook  │
     └─────┬──────┘
           │
     ┌─────▼──────────────────┐
     │  syncAnalyticsAction   │  (next cron tick)
     │  YouTube + Facebook    │
     └────────────────────────┘
```

**Critical observation:** Every stage is decoupled by the upload queue and polled on the next cron tick. A single video can take **3–5 cron cycles (3–5 minutes minimum delay between stages)** even if each stage completes in seconds.

---

## 2. Major Services and Responsibilities

| Service | Technology | Responsibility | Where |
|---------|-----------|---------------|-------|
| Content DB | PostgreSQL (Drizzle ORM) | Source of truth for all state | `src/lib/db/` |
| LLM Router | OpenRouter → gpt-4o-mini / gemini-2.0-flash | Scripts, hooks, metadata, image prompts | `src/lib/hook-engine.ts`, `script-engine.ts`, `longform-engine.ts` |
| TTS | VieNeu-TTS HTTP API (localhost:8765) | Vietnamese audio synthesis | `src/lib/pipeline/tts.ts` |
| Image Generation | Fal.ai (flux models) | Buddhist scene images + thumbnail | `src/lib/pipeline/images.ts`, `long-images.ts` |
| Video Assembly | FFmpeg (Apple VideoToolbox / libx264) | Compose final video with subtitles, music | `src/lib/pipeline/short-video.ts`, `long-video.ts` |
| Subtitle Alignment | Whisper (Python subprocess) | Word-level timestamp alignment | Inside `short-video.ts`, `long-video.ts` |
| Publishing | YouTube Data API v3, Facebook Graph API | Upload and schedule videos | `src/lib/social/` |
| Scheduling | HTTP cron (external trigger) | Orchestrate all pipeline stages | `src/app/api/cron/run/route.ts` |
| Monitoring | Telegram Bot API | Alert on failures and recovery | `src/lib/social/telegram.ts` |
| Analytics | YouTube + Facebook analytics APIs | Track view metrics post-publish | `src/actions/publishing-analytics.ts` |

---

## 3. Data Flow Between Stages

```
contentGenerations (DB row)
   ├── topic, nicheName, nichId
   ├── shortContent, shortHookCandidates, shortSelectedHook
   ├── longContent
   ├── ttsStatus → audioPath, ttsDurationMs
   ├── imagesStatus → imagePaths[], imagesCostUsd
   ├── videoStatus → videoPath
   ├── [youtubeUploadStatus, facebookUploadStatus] (legacy columns, now in uploadQueue)
   └── completedAt

uploadQueue (DB row, per platform per videoType)
   ├── contentId → contentGenerations
   ├── channelId → socialChannels
   ├── videoType: "short" | "long" | "quote"
   ├── status: queued → uploading → done | error
   ├── scheduledAt, uploadedAt
   └── platformVideoId (after upload)

publishedVideos (DB row)
   └── videoMetricSnapshots[] (analytics over time)
```

**Problem:** `contentGenerations` is a **God Object** with 70+ columns. It tracks TTS status, image status, video status, upload status, scheduled times, error messages, and cost — all in one flat table. This creates schema coupling that makes independent stage retries fragile.

---

## 4. Dependency Graph

```
cron/run
  └─ runSchedulerJobAction
       └─ generateContentAction
            ├─ suggestTopicsAction     [OpenRouter]
            ├─ runHookEngine           [OpenRouter ×2]
            └─ runScriptEngine         [OpenRouter ×1-9]

processUploadQueueAction
  ├─ [short] runTTS → runImages → runShortVideo → uploadYouTube / uploadFacebook
  ├─ [long]  runTTS → runLongImages → runLongVideo → runLongformEngine → uploadYouTube
  └─ [quote] renderFBQuoteImage → uploadFacebook

runTTS
  └─ VieNeu HTTP API (async poll, 15s interval)
       └─ FFmpeg (loudnorm normalization)

runShortVideo / runLongVideo
  ├─ FFmpeg (duration probe)
  ├─ Whisper (Python subprocess)    ← hard dependency, silent fallback
  └─ FFmpeg (video assembly)        ← VideoToolbox → libx264 fallback

runLongImages
  ├─ OpenRouter (landscape prompts + SEO description)
  ├─ OpenRouter (thumbnail prompt)
  └─ Fal.ai ×(N+1) (landscape images + thumbnail)

runLongformEngine
  ├─ OpenRouter (title gen + scoring ×2)
  ├─ OpenRouter (description)
  ├─ OpenRouter (tags)
  ├─ OpenRouter (pinned comment)
  └─ OpenRouter (thumbnail intent)
```

---

## 5. Failure Points

### P0 — Catastrophic

**FP-1: TTS service is a single point of failure with no fallback**
- `TTS_API_URL` defaults to `http://localhost:8765`
- If VieNeu-TTS crashes, ALL video generation halts completely
- No fallback TTS provider, no circuit breaker
- 25-minute polling timeout before job is marked failed
- Impact: 100% pipeline halt

**FP-2: Whisper Python subprocess silently degrades without notification**
- If Python binary is missing or Whisper model download fails, `getWhisperWordTimestamps()` throws and the pipeline falls back to silence-based segmentation
- Silence-based fallback produces visibly worse subtitle timing
- No alerting, no logging of fallback activation
- Impact: Silent quality degradation on every video

**FP-3: God Object `contentGenerations` row has no row-level locking**
- Multiple concurrent cron ticks could update the same row simultaneously (e.g., TTS completes while images are retried)
- No `SELECT FOR UPDATE` or optimistic locking anywhere
- Impact: Race conditions under concurrency

### P1 — High

**FP-4: Long script generation is 7-10 sequential LLM calls with no checkpoint**
- If any of sections 1-4 fail, the entire script must restart from outline
- No partial result saved to DB between sections
- A timeout or network error at section 3 wastes tokens 1-2's work
- Impact: Cost waste + full restart on transient failure

**FP-5: All pipeline `catch` blocks swallow exceptions into `{ success: false }`**
- `runTTS`, `runShortVideo`, `runLongVideo`, `processUploadQueueAction` all catch all errors at the top level
- Errors are written to DB but never re-thrown
- Caller receives `false` but cron continues and marks run as successful
- Impact: Silent failures invisible in Telegram alerts unless explicitly checked

**FP-6: Upload queue has no automatic retry with backoff**
- Failed uploads (YouTube quota, network errors) remain in `error` status
- Manual `retryUploadAction()` required from UI
- No exponential backoff or scheduled retry
- Impact: Manual intervention required for every failed upload

**FP-7: Facebook Page token expiry causes silent upload failures**
- User tokens expire in 60 days, Page tokens derived from them do not expire but the flow is fragile
- No scheduled token validity check before upload attempts
- `needsReconnect` flag is set reactively (after failure), not proactively
- Impact: Upload failures until user notices and manually rotates token

### P2 — Medium

**FP-8: Cron run log size unbounded (capped at 500 rows)**
- The 500-log cap `DELETE NOT IN (SELECT ... LIMIT 500)` uses a correlated subquery — expensive on large tables
- No index on `cronRunLogs.ranAt` confirmed
- Impact: Cron run slows as log table grows

**FP-9: `backfillLegacyUploadsAction().catch(() => {})` and `cleanupMediaFilesAction().catch(() => {})`**
- Both called with `.catch(() => {})` — errors completely invisible
- Impact: Media files may accumulate uncleared; silent backfill failures

**FP-10: Image paths stored as relative strings in `imagePaths` JSONB**
- If the server working directory changes or media is moved, all stored paths break
- No validation of path existence before video assembly
- Impact: Video assembly failures on path change or media cleanup

### P3 — Low

**FP-11: `contentGenerations` legacy status columns still exist**
- `youtubeUploadStatus`, `facebookUploadStatus`, `youtubeVideoUrl`, `youtubeScheduledAt`, `facebookUploadStatus`, `facebookScheduledAt` are legacy columns
- `uploadQueue` is the real source of truth for upload state
- These stale columns are still updated in `regenerateShortHooksAction` (line 706)
- Impact: Confusing dual source of truth for upload status

---

## 6. Recovery Mechanisms

| Mechanism | Coverage | Quality |
|-----------|----------|---------|
| VideoToolbox → libx264 fallback | FFmpeg encoding failure | ✅ Good — covers most Mac failures |
| TTS cache (SHA256 text hash) | Repeated TTS for same script | ✅ Good — prevents duplicate TTS calls |
| Whisper → silence detection fallback | Whisper subprocess failure | ⚠️ Silent — no alerting |
| Hook scoring fallback (keyword heuristic) | LLM JSON parse failure | ⚠️ Lower quality result, no alerting |
| Cron gap detection (dynamic median threshold) | Cron downtime recovery | ✅ Good — recently fixed |
| `retryUploadAction` | Upload failures | ❌ Manual — requires UI intervention |
| DB error messages on failures | Pipeline stage failures | ⚠️ Visible in DB but no active alert |

**Missing recovery:** No automated retry with backoff for any external API call (LLM, Fal.ai, TTS, YouTube, Facebook).

---

## 7. Missing Abstractions

**MA-1: Pipeline Stage Runner (P1)**
Each pipeline stage (`runTTS`, `runImages`, `runShortVideo`) has identical boilerplate:
```
DB lookup → validate inputs → DB status update → do work → DB status update → return result
```
This pattern should be a `runStage(contentId, stage, fn)` wrapper that handles:
- Idempotency check (skip if already done)
- DB status lifecycle
- Timeout enforcement
- Structured error capture

**MA-2: LLM Client Abstraction (P2)**
Currently every LLM call goes through `getOpenRouterClient()` directly. There is no:
- Request interceptor for retry with exponential backoff
- Cost budget enforcement per generation
- Model fallback on rate limit or error
- Request deduplication

**MA-3: Job Queue (P2)**
The "queue" is a DB table polled by cron every minute. This means:
- Max throughput = 1 cron tick per minute
- All stages for a video can't run immediately after predecessor completes
- No priority queue (urgent re-generate vs. background batch)

Consider replacing with an in-process async queue that triggers next stage immediately on completion.

**MA-4: Prompt Registry (P2)**
Prompts are scattered across 6+ files with no central version control or rollback. There is a `promptTemplates` DB table but it's only for user-editable scripts, not the engine prompts (hook, scoring, image, longform). If a prompt change breaks quality, there is no rollback path.

**MA-5: Content Deduplication at Topic Level (P3)**
The dedup block (last 30 topics from 14 days) is injected as raw text into the LLM prompt. There is no semantic similarity check — "Buông bỏ" and "Buông xuống" could both be generated. A vector embedding check would prevent near-duplicate topics.

---

## 8. Technical Debt

**TD-1: Dual schema generations (legacy + current) [P1]**
The DB schema contains two parallel content tracking systems:
- Old: `contentPieces` → `contentOutputs` → `generatedContents` (never deleted)
- New: `contentGenerations` (the actual working system)

The old tables consume space and create confusion. No migration to clean them up exists.

**TD-2: `contentGenerations` God Object [P1]**
70+ columns in one table including: topic, niche, all script variants, all status flags, all timestamps, all paths, all costs, all error messages. Should be split into:
- `content_scripts` (text content)
- `content_pipeline_state` (per-stage status)
- `content_media` (file paths)
- `content_costs` (token/dollar tracking)

**TD-3: Whisper integration is a Python subprocess [P2]**
`getWhisperWordTimestamps()` spawns `python3 scripts/whisper_timestamps.py` — this means:
- Python environment must be managed separately from Node.js
- No type safety on the interface
- Silent failure if Python or Whisper model is missing
- 120-300s timeout is a hard upper bound with no progress reporting

Should be replaced with `whisper.cpp` (C++, no Python dependency, faster on Apple Silicon) or `@xenova/transformers` (pure JS Whisper).

**TD-4: Hardcoded pixel coordinates in subtitle/cover generation [P2]**
`SHORT_COVER_OVERLAY_SEC = 10`, `SHORT_SUBTITLE_MARGIN_V = 340`, cover accent `x=72, y=132, w=8, h=190` are hardcoded constants. If resolution or aspect ratio changes (e.g., adding TikTok 9:16 vs. YouTube Shorts 9:16 variants), these all break.

**TD-5: `facebook-quote.ts` writes temp files to `os.tmpdir()` but never cleans up [P3]**
`renderFacebookQuoteImage()` writes to `{contentId}-fb-quote-{Date.now()}.jpg` in `/tmp`. The `finally` block has no cleanup code. On a long-running server, `/tmp` accumulates stale quote images.

**TD-6: `promptTemplates.model` defaults to `"claude-sonnet-4-6"` [P3]**
The DB schema default is `claude-sonnet-4-6` but the runtime default is `gpt-4o-mini`. Any new template created without explicit model selection gets claude-sonnet-4-6 as default — 20× more expensive per token than gpt-4o-mini for script generation.
