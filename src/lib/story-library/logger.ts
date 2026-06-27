const PREFIX = "[STORY_CRAWLER]";

export function storyCrawlerLog(event: string, payload?: Record<string, unknown>) {
  if (!payload) {
    console.log(`${PREFIX} ${event}`);
    return;
  }

  console.log(`${PREFIX} ${event} ${JSON.stringify(payload)}`);
}

export function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}

export type DbErrorDetails = {
  code: string;
  detail: string | null;
  constraint: string | null;
  table: string | null;
  column: string | null;
};

export function extractDbErrorDetails(error: unknown): DbErrorDetails | null {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : null;
  if (!cause || typeof cause !== "object" || !("code" in cause)) {
    return null;
  }

  const pgError = cause as Record<string, unknown>;
  if (typeof pgError.code !== "string") {
    return null;
  }

  return {
    code: pgError.code,
    detail: typeof pgError.detail === "string" ? pgError.detail : null,
    constraint: typeof pgError.constraint === "string" ? pgError.constraint : null,
    table: typeof pgError.table === "string" ? pgError.table : null,
    column: typeof pgError.column === "string" ? pgError.column : null,
  };
}
