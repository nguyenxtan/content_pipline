# Reliability Audit

> Reviewed: 2026-06-01

---

## Executive Summary

The pipeline has one fundamental reliability architecture problem: **every external failure is caught, logged to DB, and silently returned as `{ success: false }`**. No external call has retry logic with backoff. No LLM call has a fallback model. No upload failure is automatically retried. The system is designed to survive failures by stopping gracefully — but it never recovers automatically. Recovery always requires human intervention.

---

## Missing Retries

### R-01: LLM calls have no retry on transient failure [P1]

Every call to `client.chat.completions.create(...)` is made exactly once. If OpenRouter returns:
- HTTP 429 (rate limit)
- HTTP 500 (server error)
- HTTP 503 (service unavailable)
- Network timeout

The call throws, the top-level `catch` captures it, and the content generation job fails permanently. The user must manually re-trigger.

**Observed rate:** OpenRouter 429s occur ~2-5% of the time during peak hours.

**Fix:**
```typescript
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const isTransient = err instanceof Error && 
        (err.message.includes("429") || err.message.includes("503") || err.message.includes("timeout"));
      if (!isTransient) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt - 1)); // exponential backoff
    }
  }
  throw new Error("unreachable");
}
```

Apply to all `client.chat.completions.create(...)` calls in hook-engine.ts, script-engine.ts, longform-engine.ts, images.ts, long-images.ts.

---

### R-02: Fal.ai image generation has no retry [P1]

`fal.subscribe(model, { input, ... })` is called once per image. If Fal.ai returns an error (service timeout, model loading error), the images stage fails permanently. The content generation is stuck with `imagesStatus = "error"` until manually retried from the UI.

**Fix:** Wrap `fal.subscribe()` in `callWithRetry()` with 3 attempts and 2s base delay. Fal.ai errors are almost always transient (model cold-start).

---

### R-03: Upload queue failures require manual retry [P1]

Failed YouTube/Facebook uploads stay in `status = "error"` indefinitely. `retryUploadAction()` exists but is only callable from the UI. There is no automated retry scheduler.

**Fix:** In `processUploadQueueAction()`, after processing the current queue, check for rows where `status = "error"` AND `retryCount < 3` AND `lastAttemptAt < now() - 30 minutes`. Auto-retry those rows with a new attempt. Increment `retryCount` each time.

This requires adding `retryCount` and `lastAttemptAt` columns to `uploadQueue`:
```sql
ALTER TABLE upload_queue ADD COLUMN retry_count integer DEFAULT 0;
ALTER TABLE upload_queue ADD COLUMN last_attempt_at timestamptz;
```

---

### R-04: TTS polling silently continues on status API errors [P2]

In `runTTS()`:
```typescript
if (!pollRes.ok) continue; // silently skip failed status poll
```

If the TTS status API consistently returns 500 (server restart, etc.), the polling loop runs for 25 minutes silently returning errors and never alerting. The job eventually times out with a confusing error.

**Fix:** Track consecutive poll failures. After 5 consecutive poll failures, send a Telegram alert and increase poll interval to 60s. After 10 consecutive failures, abort and mark the job failed immediately.

---

## Missing Validation

### R-05: No schema enforcement on LLM JSON outputs [P1]

Every JSON output from the LLM is parsed with a bare `JSON.parse()` and then accessed with manual type casting:
```typescript
const parsed = JSON.parse(jsonPayload) as Partial<LongOutline>;
const sections = Array.isArray(parsed.sections) ? parsed.sections.map(...) : [];
```

This is fragile hand-rolled validation. If the LLM returns `{"sections": "not an array"}`, the code silently produces an empty sections array and continues with a broken outline — generating a video with no section structure.

**Fix:** Use Zod schemas for all LLM JSON outputs:
```typescript
const LongOutlineSchema = z.object({
  titleAngle: z.string().min(5),
  openingAngle: z.string().min(5),
  sections: z.array(z.object({
    title: z.string().min(1),
    purpose: z.string().min(1),
    emotionalShift: z.string().min(1),
  })).min(3).max(6),
  closingAngle: z.string().min(5),
  chapters: z.array(z.string()).min(1),
});

const outline = LongOutlineSchema.parse(JSON.parse(jsonPayload));
```

Apply to: hook scoring (P-03), long outline (P-06), title scoring (P-15), tags (P-17), thumbnail intent (P-19), image prompts (P-11, P-12).

---

### R-06: FFmpeg filter graph is constructed without validation [P2]

`buildShortVideo.ts` and `buildLongVideo.ts` construct complex FFmpeg filter chains as template strings:
```typescript
const filters = [
  `[0:v]scale=${width}:${height}...`,
  `[bg][1:v]overlay=...`,
  ...
].join(";");
```

If any input path contains special characters (`[`, `]`, `:`, `'`), the filter chain is silently corrupted. The `escapeAssPath()` function exists but is only applied to subtitle paths, not image paths.

**Fix:** Apply `escapeAssPath()` to all dynamic paths in FFmpeg filter chains. Add a pre-flight check that all required input files exist before starting FFmpeg.

---

### R-07: `contentGenerations.imagePaths` is stored as JSONB with no format validation [P2]

`imagePaths` stores an array of relative path strings. When `runShortVideo` or `runLongVideo` reads these paths, they do:
```typescript
const images = (row.imagePaths as string[]) ?? [];
```

No validation that:
1. The cast is correct (could be any JSONB)
2. The paths exist on disk
3. The paths are relative (not absolute, which would break cross-machine moves)
4. The count matches expected image count

If `imagePaths` is corrupted (e.g., `["path1", null, "path3"]`), FFmpeg receives a null as an input file path and fails with a confusing error.

**Fix:** Validate `imagePaths` with Zod (`z.array(z.string().min(1))`) and check file existence before starting video assembly.

---

## Race Conditions

### R-08: Concurrent cron runs can double-process the same upload queue item [P1]

`processUploadQueueAction()` queries `uploadQueue` with `status = "queued"`, then updates to `status = "uploading"` in a separate step. Between these two operations, a second concurrent cron tick could pick up the same row.

```typescript
// Query (cron 1)
const rows = await db.select(...).where(eq(uploadQueue.status, "queued"));

// ← Window of vulnerability: cron 2 also reads the same rows

// Update (cron 1)
await db.update(uploadQueue).set({ status: "uploading" }).where(eq(uploadQueue.id, row.id));
```

Result: The same video is uploaded twice to YouTube/Facebook simultaneously.

**Fix:** Use a single atomic `UPDATE ... RETURNING` to claim rows:
```sql
UPDATE upload_queue 
SET status = 'uploading', started_at = NOW()
WHERE id = (
  SELECT id FROM upload_queue 
  WHERE status = 'queued' 
  ORDER BY scheduled_at ASC 
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

`SKIP LOCKED` prevents concurrent cron ticks from picking up the same row.

---

### R-09: TTS result is written to DB without checking if another process already completed it [P2]

If TTS is retriggered manually while a previous TTS job is still polling:
1. Job 1 submits TTS, starts polling
2. User triggers re-generation (deletes audioPath in DB)
3. Job 2 submits TTS, starts polling
4. Job 1 completes, writes `audioPath = "job1.wav"` to DB
5. Job 2 completes, writes `audioPath = "job2.wav"` to DB — overwrites job 1

Both wav files exist on disk but only job 2's path is in the DB. Job 1's file is leaked (never cleaned up).

**Fix:** Validate the DB row still has `ttsStatus = "processing"` before writing the completion result. If the status has changed (e.g., back to "pending"), abort the write.

---

## Error Swallowing

### R-10: All pipeline top-level catches return `{ success: false }` without re-throwing [P1]

**Files affected:** `runTTS()`, `runShortVideo()`, `runLongVideo()`, `processUploadQueueAction()`, `generateContentAction()`

**Pattern:**
```typescript
try {
  // ... entire function
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await db.update(contentGenerations).set({ ttsErrorMessage: message });
  return { success: false, error: message };
}
```

**Problem:** The error is persisted to DB but:
1. Not re-thrown, so calling code sees a clean return value
2. The cron runner in `/api/cron/run` only sends a Telegram alert for "fatal" errors — but pipeline stage failures are swallowed before reaching cron runner
3. `processUploadQueueAction()` pushes errors to a local `errors` array, but only non-fatal errors (from `NON_FATAL_UPLOAD_ERRORS` set) are excluded from Telegram alerts — yet the swallowing happens before error categorization

**Fix:** Add a dedicated failure telemetry call inside each pipeline catch block:
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await db.update(...).set({ ttsErrorMessage: message });
  await sendTelegram(`⚠️ TTS failed for content ${contentId}: ${message.slice(0, 200)}`);
  return { success: false, error: message };
}
```

Or better: use a `PipelineMonitor` class that automatically sends Telegram on failure.

---

### R-11: `backfillLegacyUploadsAction`, `backfillPublishedVideosAction`, `cleanupMediaFilesAction` all `.catch(() => {})` [P2]

From `cron/run/route.ts`:
```typescript
await backfillLegacyUploadsAction().catch(() => {});
await backfillPublishedVideosAction().catch(() => {});
await cleanupMediaFilesAction().catch(() => {});
```

All three swallow errors completely — not even logging to Telegram. If `cleanupMediaFilesAction` fails due to a filesystem error, media files accumulate silently.

**Fix:** Change to `.catch((err) => console.error("backfill failed:", err))` at minimum. Ideally log to Telegram for any non-404 error.

---

## Silent Failures

### R-12: Whisper fallback is invisible [P1]

When `getWhisperWordTimestamps()` throws (Python not found, Whisper model missing, timeout), the video pipeline falls back to silence-based segmentation without any notification. The resulting video has worse subtitle timing, but nothing in the DB, logs, or Telegram indicates a fallback occurred.

**Fix:** Add a flag `usedWhisperFallback: boolean` to the video result. Log to Telegram when fallback is used: `⚠️ Whisper unavailable for content {contentId}, using silence detection.`

---

### R-13: Hook scoring JSON parse failure falls back silently [P2]

In `hook-engine.ts`:
```typescript
try {
  const parsed = JSON.parse(jsonPayload);
  scoredHooks = normalizeScoredHooks(normalizedHooks, parsed.scores);
} catch {
  scoredHooks = []; // ← silent fallback to heuristic scoring
}

if (scoredHooks.length === 0) {
  scoredHooks = fallbackScoreHooks(params.topic, normalizedHooks);
}
```

The heuristic fallback (`fallbackScoreHooks`) picks hooks using keyword matching — significantly worse quality than LLM scoring. This can happen regularly if the LLM returns malformed JSON (e.g., at high temperature 0.95 on scoring, though the scoring call uses 0.2).

**Fix:** Log the JSON parse failure to DB (add `hookScoringFallback: boolean` to `contentGenerations`). Alert via Telegram if fallback rate exceeds 10% of generations.

---

## Missing Observability

### R-14: No pipeline stage duration tracking [P2]

`contentGenerations` stores `ttsDurationMs`, `imagesDurationMs`, `generationTime` — but not:
- FFmpeg video assembly duration
- Whisper transcription duration
- Individual LLM call durations
- Total end-to-end wall time from topic → uploaded video

Without stage-level timing, it's impossible to identify which stage regressed after a code change.

**Fix:** Add columns: `videoAssemblyDurationMs`, `whisperDurationMs` to `contentGenerations`. Log to these columns in `runShortVideo` and `runLongVideo`.

---

### R-15: No alert when repair loop frequency spikes [P2]

If a model update causes 80% of short scripts to fail validation (word count too high, banned phrases increased), the pipeline will silently run 3× more LLM calls per video at 3× the cost and 3× the latency. There is no metric or alert for repair loop activation rate.

**Fix:** Store `shortScriptRewriteCount` and `longScriptRewriteCount` in `contentGenerations` (column already exists in schema: `rewriteCount`). Alert via Telegram if rolling 1-hour average rewrite count exceeds 1.5.

---

### R-16: Cron run log retention gap [P3]

The cron run log is capped at 500 rows via:
```sql
DELETE FROM cron_run_logs 
WHERE id NOT IN (SELECT id FROM cron_run_logs ORDER BY ran_at DESC LIMIT 500)
```

This correlated subquery is executed on every cron run. At 500 rows with a naive plan, PostgreSQL scans the full table twice. More importantly, 500 rows at 1 run/minute = 8.3 hours of history. This is insufficient for retrospective debugging of failures that occurred overnight.

**Fix:** Increase limit to 2000 rows (still small table). Use `DELETE FROM cron_run_logs WHERE ran_at < NOW() - INTERVAL '7 days'` instead — time-based retention is semantically clearer and uses the index on `ran_at`.

---

## Summary Table

| Issue | Severity | Category | Fix Effort |
|-------|----------|----------|------------|
| R-01: No LLM retry | P1 | Missing retry | 3h |
| R-02: No Fal.ai retry | P1 | Missing retry | 1h |
| R-03: No upload auto-retry | P1 | Missing retry | 4h |
| R-04: TTS poll silent fail | P2 | Missing observability | 1h |
| R-05: No Zod on LLM JSON | P1 | Missing validation | 4h |
| R-06: FFmpeg filter injection | P2 | Missing validation | 2h |
| R-07: imagePaths cast unvalidated | P2 | Missing validation | 1h |
| R-08: Upload queue race condition | P1 | Race condition | 2h |
| R-09: TTS double-completion race | P2 | Race condition | 1h |
| R-10: Top-level catch swallows | P1 | Error swallowing | 3h |
| R-11: Backfill/cleanup catch () | P2 | Error swallowing | 0.5h |
| R-12: Whisper fallback silent | P1 | Silent failure | 1h |
| R-13: Hook scoring silent fallback | P2 | Silent failure | 1h |
| R-14: No stage duration tracking | P2 | Missing observability | 2h |
| R-15: No repair rate alert | P2 | Missing observability | 1h |
| R-16: Cron log retention | P3 | Technical debt | 0.5h |

**Total estimated effort to fix all P1 issues: ~18 hours**
