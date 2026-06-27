const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const msg = err.message.toLowerCase();

  // HTTP 429 / 5xx in the message text (OpenRouter format: "429 Too Many Requests")
  if (/\b(429|500|502|503|504)\b/.test(err.message)) return true;

  // OpenAI SDK attaches `.status` on HTTP errors
  const typed = err as unknown as Record<string, unknown>;
  if (typeof typed.status === "number" && [429, 500, 502, 503, 504].includes(typed.status)) return true;

  // Network-level failures (including truncated HTTP response body)
  if (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("connection refused") ||
    msg.includes("unexpected end of json") ||
    msg.includes("unexpected token") ||
    msg.includes("invalid json")
  ) return true;

  // Fal.ai transient signals
  if (
    msg.includes("cold start") ||
    msg.includes("model loading") ||
    msg.includes("server error") ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable") ||
    msg.includes("gateway timeout")
  ) return true;

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries `fn` on transient errors with exponential backoff.
 *
 * Attempt delays (default):  attempt 1 → 1 s, attempt 2 → 2 s, attempt 3 → fails
 * Fal.ai cold-starts:        use baseDelayMs: 2000  →  2 s, 4 s, fails
 *
 * Non-transient errors (auth, bad request, etc.) are thrown immediately
 * without consuming retry budget.
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    label?: string;
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const label = options?.label ?? "call";

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const transient = isTransient(err);

      if (attempt === maxAttempts || !transient) {
        const reason = transient ? "max attempts reached" : "non-transient error";
        console.error(
          `[retry] ${label} failed permanently (attempt ${attempt}/${maxAttempts}, ${reason}):`,
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${maxAttempts} transient failure — retrying in ${delayMs}ms:`,
        err instanceof Error ? err.message : String(err),
      );
      await sleep(delayMs);
    }
  }

  throw lastErr;
}
