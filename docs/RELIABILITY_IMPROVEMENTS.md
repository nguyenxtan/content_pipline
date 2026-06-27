# Reliability Improvements

> Implemented: 2026-06-01

---

## Summary

Three reliability gaps identified in RELIABILITY_AUDIT.md (GAP-1, GAP-2, GAP-3) have been addressed:

| Gap | Issue | Fix |
|-----|-------|-----|
| GAP-1 | Per-item pipeline failures were invisible to Telegram | Cron runner now inspects per-item results from batch pipeline jobs |
| GAP-2 | LLM calls had no retry on transient failure | Shared `callWithRetry` wraps all `client.chat.completions.create()` calls |
| GAP-3 | Fal.ai calls had no retry on cold-start | Same `callWithRetry` wraps all `fal.run()` calls with 2s base delay |

---

## GAP-1: Per-Item Pipeline Failure Visibility

### Problem

The cron runner dispatches `runSchedulerJobAction(jobId)` for each due scheduler job. For `short_pipeline` and `long_pipeline` job types, the action returns:

```typescript
{ processed: N, results: [{ ok: false, step: "tts", error: "...", id: "..." }] }
```

The cron runner only checked for `"error" in res`, which only catches top-level job failures. Per-item step failures (TTS timeout, Fal.ai cold-start, FFmpeg OOM) were written to the DB but never reached the `errors[]` array that drives the Telegram alert. A pipeline processing 3 videos could fail all 3 and fire zero alerts.

### Fix

**File:** [`src/app/api/cron/run/route.ts`](../src/app/api/cron/run/route.ts)

After the existing `"error" in res` check, an `else if` branch iterates `res.results` when present:

```typescript
} else if ("results" in res && Array.isArray(res.results)) {
  for (const r of res.results) {
    const item = r as { ok?: boolean; error?: string; step?: string; id?: string };
    if (!item.ok && item.error) {
      errors.push(
        `[${job.nicheName}/${item.step ?? "pipeline"}] ${item.id ? `(${item.id.slice(0, 8)}) ` : ""}${item.error}`,
      );
    }
  }
}
```

Telegram alerts now include entries like:
```
• [Healing Meditation/tts] (a3f2b1c9) TTS submit thất bại (503): Service unavailable
• [Buddhist Philosophy/images] (d4e7f8a2) Ảnh 2 không có URL
```

The short content ID prefix (`id.slice(0, 8)`) lets the operator find the exact row in the dashboard immediately.

---

## GAP-2 & GAP-3: Retry on Transient LLM and Fal.ai Failures

### Problem

Every `client.chat.completions.create()` and `fal.run()` call was made exactly once. OpenRouter returns HTTP 429 at 2–5% during peak hours. Fal.ai cold-starts (model loading on first call after idle) are common at the start of each pipeline run. Any transient failure was permanent — the content generation job died and required manual restart.

For a 12-call long video pipeline (hook × 2, script × 7, metadata × 5), the probability of at least one transient failure during peak hours was 20–40% per video.

### Fix: Shared Retry Utility

**New file:** [`src/lib/llm/retry.ts`](../src/lib/llm/retry.ts)

```typescript
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number; label?: string }
): Promise<T>
```

**Backoff schedule** (defaults):
| Attempt | LLM delay | Fal.ai delay |
|---------|-----------|--------------|
| 1 | 1 000 ms | 2 000 ms |
| 2 | 2 000 ms | 4 000 ms |
| 3 | permanent failure | permanent failure |

**Transient error detection** (`isTransient()`):
- HTTP 429 / 500 / 502 / 503 / 504 in message string or `.status` property
- Network: `timeout`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `socket hang up`
- Fal.ai specific: `cold start`, `model loading`, `server error`, `bad gateway`, `gateway timeout`

Non-transient errors (auth failures, 400 bad request, invalid model) throw immediately without consuming retry budget.

**Structured console output:**
```
[retry] hook_generation attempt 1/3 transient failure — retrying in 1000ms: 429 Too Many Requests
[retry] landscape_fal_2 attempt 1/3 transient failure — retrying in 2000ms: Cold start timeout
[retry] long_outline failed permanently (attempt 3/3, max attempts reached): 503 ...
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/llm/retry.ts` | **New.** Shared `callWithRetry<T>` utility with exponential backoff |
| `src/lib/hook-engine.ts` | Wraps 2 LLM calls: `hook_generation`, `hook_scoring` |
| `src/lib/script-engine.ts` | Wraps `generateText()` helper, covering 7+ LLM calls per long video: `short_script_draft`, `short_script_repair_N`, `long_outline`, `long_opening`, `long_section_N`, `long_closing`, `long_script_repair_N` |
| `src/lib/longform-engine.ts` | Wraps `callLLM()` helper, covering 6 metadata calls: `title_generation`, `title_scoring`, `description`, `tags`, `pinned_comment`, `thumbnail_intent` |
| `src/lib/pipeline/images.ts` | Wraps LLM call (`short_image_prompts`) and N `fal.run()` calls (`short_image_fal_N`) |
| `src/lib/pipeline/long-images.ts` | Wraps 2 LLM calls (`landscape_prompts`, `thumbnail_prompt_llm`) and N+1 Fal.ai calls (`landscape_fal_N`, `thumbnail_fal`) |
| `src/app/api/cron/run/route.ts` | GAP-1 fix: inspects `res.results` for per-item `ok: false` entries |

---

## Coverage: All LLM Call Points

| Engine | Function | Labels |
|--------|----------|--------|
| `hook-engine.ts` | `runHookEngine()` | `hook_generation`, `hook_scoring` |
| `script-engine.ts` | `generateText()` | `short_script_draft`, `short_script_repair_N`, `long_outline`, `long_opening`, `long_section_N`, `long_closing`, `long_script_repair_N` |
| `longform-engine.ts` | `callLLM()` | `title_generation`, `title_scoring`, `description`, `tags`, `pinned_comment`, `thumbnail_intent` |
| `images.ts` | `generateImagePrompts()` | `short_image_prompts` |
| `long-images.ts` | `generateLandscapePrompts()` | `landscape_prompts` |
| `long-images.ts` | `generateThumbnailPrompt()` | `thumbnail_prompt_llm` |

**Not covered** (out of scope / no retry needed):
- `src/lib/llm/client.ts` — Anthropic SDK used only for meta-prompt generation (dev tool, not in production pipeline)
- `src/actions/content-generator.ts` `suggestTopicsAction()` — already has a 3-attempt loop at the job level

---

## Coverage: All Fal.ai Call Points

| File | Function | Labels |
|------|----------|--------|
| `images.ts` | `runImages()` | `short_image_fal_0`, `short_image_fal_1`, ... |
| `long-images.ts` | `runLongImages()` | `landscape_fal_0` ... `landscape_fal_N`, `thumbnail_fal` |

---

## Expected Impact

**Before:**
- 2–5% transient OpenRouter rate during peak hours
- Long video pipeline: ~10–20 LLM calls → ~20–40% chance of at least one transient failure per video
- Every failure is permanent until manual retry
- Pipeline failures fire no Telegram alert unless they're top-level job crashes

**After:**
- Each transient error gets 2 automatic retry attempts
- P(failure after 3 attempts) at 5% per-call rate ≈ 0.0125% per call
- Long video pipeline failure rate drops from ~20–40% → ~0.3% per video
- All per-item failures (TTS, images, video) now appear in Telegram alerts with content ID and stage

---

## Test Strategy

### Manual smoke test (recommended before first production run)

1. Temporarily set `OPENROUTER_API_KEY` to an invalid key and trigger a pipeline run:
   - Verify `[retry]` warn logs appear 2× with increasing delays
   - Verify final `[retry]` error log appears on attempt 3
   - Verify the error propagates and content row shows `ttsStatus = "error"` or `imagesStatus = "error"`

2. To test GAP-1 (Telegram surfacing):
   - Trigger a scheduler job where a pipeline item fails (e.g., with a content ID that has no script yet)
   - Verify Telegram receives a message containing `[niche_name/step]` with a truncated content ID

3. Fal.ai retry: test by temporarily setting `FAL_KEY` to invalid, observe same 3-attempt pattern in logs for `short_image_fal_0`, `landscape_fal_0`, `thumbnail_fal`

### Integration test scope

These changes are pure wrappers — they do not change data flow, DB writes, or response types. The retry utility itself can be unit-tested:

```typescript
// Verify retry stops on non-transient errors
const fn = jest.fn().mockRejectedValue(new Error("401 Unauthorized"));
await expect(callWithRetry(fn, { maxAttempts: 3 })).rejects.toThrow("401");
expect(fn).toHaveBeenCalledTimes(1); // no retries

// Verify retry fires on 429
const fn2 = jest.fn()
  .mockRejectedValueOnce(new Error("429 Too Many Requests"))
  .mockResolvedValueOnce("ok");
await expect(callWithRetry(fn2, { maxAttempts: 3, baseDelayMs: 0 })).resolves.toBe("ok");
expect(fn2).toHaveBeenCalledTimes(2);
```

### What to watch in production logs

After deploying, watch for `[retry]` prefixed lines in server logs:
- `[retry] X attempt Y/3 transient failure` — normal, expected during peak hours
- `[retry] X failed permanently` — investigate after 3rd occurrence for the same label in one hour
