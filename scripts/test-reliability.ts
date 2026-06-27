/**
 * Reliability regression tests for GAP-1, GAP-2, GAP-3.
 *
 * Run with:  npx tsx scripts/test-reliability.ts
 * Exit code 0 = all pass, 1 = any fail.
 */

import { callWithRetry } from "@/lib/llm/retry";

// ── Tiny assertion helpers ─────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  FAIL: ${description}`);
    failed++;
  }
}

// Capture console.warn/error emitted by callWithRetry so they don't clutter output,
// then flush them per-test only when relevant.
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);
const captured: string[] = [];
console.warn  = (...args: unknown[]) => captured.push(`WARN  ${args.join(" ")}`);
console.error = (...args: unknown[]) => captured.push(`ERROR ${args.join(" ")}`);

function flushCaptured() {
  captured.splice(0).forEach((l) => _warn("  [log]", l));
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — GAP-1: per-item { ok:false } surfaces to the cron errors[] list
// ─────────────────────────────────────────────────────────────────────────────

async function test1() {
  console.log("\n── TEST 1: GAP-1 — per-item { ok:false } surfaces to errors[]");

  // Simulate the return value of runSchedulerJobAction for a short_pipeline job
  // where item 2 of 3 failed at the TTS step.
  const job = { nicheName: "Healing Meditation", jobType: "short_pipeline" };
  const res = {
    processed: 3,
    results: [
      { ok: true,  step: "video", id: "aabbccdd-1111-2222-3333-444455556666" },
      { ok: false, step: "tts",   id: "deadbeef-1111-2222-3333-444455556666", error: "TTS failed: timeout" },
      { ok: true,  step: "video", id: "cafebabe-1111-2222-3333-444455556666" },
    ],
  };

  const errors: string[] = [];

  // ── Logic copied verbatim from cron/run/route.ts ──────────────────────────
  if ("error" in res) {
    errors.push(`[${job.jobType}/${job.nicheName}] ${(res as unknown as { error: string }).error}`);
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
  // ── End copied logic ──────────────────────────────────────────────────────

  ok(errors.length === 1,                        "exactly one error entry for one failing item");
  ok(errors[0]!.includes("TTS failed: timeout"), "error message propagated");
  ok(errors[0]!.includes("Healing Meditation"),  "niche name present");
  ok(errors[0]!.includes("tts"),                 "step name present");
  ok(errors[0]!.includes("deadbeef"),            "truncated content ID present (first 8 chars)");

  flushCaptured();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — GAP-2: 429 on attempt 1 → retried → success on attempt 2
// ─────────────────────────────────────────────────────────────────────────────

async function test2() {
  console.log("\n── TEST 2: GAP-2 — 429 transient error retried, final result succeeds");

  let calls = 0;
  captured.length = 0;

  const result = await callWithRetry(
    () => {
      calls++;
      if (calls === 1) throw new Error("429 Too Many Requests – rate limit exceeded");
      return Promise.resolve("ok");
    },
    { maxAttempts: 3, baseDelayMs: 0, label: "test_429_retry" },
  );

  ok(result === "ok",                                    "final result is the success value");
  ok(calls === 2,                                        "fn called exactly twice (1 fail + 1 success)");
  ok(captured.some((l) => l.includes("attempt 1/3 transient")), "warn log emitted for transient failure");
  ok(captured.some((l) => l.includes("test_429_retry")),        "label appears in warn log");

  flushCaptured();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — GAP-2: 401 Unauthorized must NOT be retried
// ─────────────────────────────────────────────────────────────────────────────

async function test3() {
  console.log("\n── TEST 3: GAP-2 — non-transient 401 throws immediately without retry");

  let calls = 0;
  captured.length = 0;

  let caught: Error | null = null;
  try {
    await callWithRetry(
      () => {
        calls++;
        throw new Error("401 Unauthorized – invalid API key");
      },
      { maxAttempts: 3, baseDelayMs: 0, label: "test_401_no_retry" },
    );
  } catch (err) {
    caught = err instanceof Error ? err : new Error(String(err));
  }

  ok(caught !== null,                              "error is thrown (not swallowed)");
  ok(caught!.message.includes("401"),              "original error message preserved");
  ok(calls === 1,                                  "fn called exactly once — no retry");
  ok(!captured.some((l) => l.startsWith("WARN") && l.includes("transient failure")), "no transient-retry warn log emitted");
  ok(captured.some((l) => l.includes("non-transient error")), "error log notes 'non-transient error'");

  flushCaptured();
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Reliability tests");

  await test1();
  await test2();
  await test3();

  console.warn  = _warn;
  console.error = _error;

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error = _error;
  console.error("Test runner error:", err);
  process.exit(1);
});
