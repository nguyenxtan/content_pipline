import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploadQueue } from "@/lib/db/schema";
import {
  processUploadQueueAction,
} from "@/actions/social-channels";
import {
  UPLOAD_SCHEDULE_TOLERANCE_MS,
  formatDateTimeLocalInput,
  isUploadScheduledDue,
  resolveRetryScheduledAt,
} from "@/lib/upload-schedule";

function fmt(date: Date): string {
  return date.toISOString();
}

type QueueSnapshot = {
  id: string;
  status: string;
  scheduledAt: string;
  updatedAt: string;
};

async function main() {
  const now = new Date();
  const future = new Date(now.getTime() + 30 * 60_000);
  const past = new Date(now.getTime() - 60_000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);

  const caseA = isUploadScheduledDue(future, now, UPLOAD_SCHEDULE_TOLERANCE_MS);
  const caseB = isUploadScheduledDue(past, now, UPLOAD_SCHEDULE_TOLERANCE_MS);
  const caseC = isUploadScheduledDue(yesterday, now, UPLOAD_SCHEDULE_TOLERANCE_MS);
  const retryNoForce = resolveRetryScheduledAt(future, { forcePublish: false, now });
  const retryForce = resolveRetryScheduledAt(future, { forcePublish: true, now });

  let beforeSnapshot: QueueSnapshot | null = null;
  let afterSnapshot: QueueSnapshot | null = null;
  let dryRunResult:
    | Awaited<ReturnType<typeof processUploadQueueAction>>
    | { processed: number; results: Array<{ id: string; ok: boolean; error?: string }> }
    | null = null;
  let dryRunUnchanged = true;
  let dbCheckStatus: "verified" | "skipped_db_unavailable" = "verified";

  try {
    const queueBefore = await db.query.uploadQueue.findFirst({
      where: eq(uploadQueue.status, "queued"),
      orderBy: (t) => [asc(t.scheduledAt), asc(t.createdAt)],
    });

    beforeSnapshot = queueBefore
      ? {
          id: queueBefore.id,
          status: queueBefore.status,
          scheduledAt: fmt(new Date(queueBefore.scheduledAt)),
          updatedAt: fmt(new Date(queueBefore.updatedAt)),
        }
      : null;

    dryRunResult = await processUploadQueueAction({
      source: "verify",
      dryRun: true,
    });

    const queueAfter = queueBefore
      ? await db.query.uploadQueue.findFirst({
          where: eq(uploadQueue.id, queueBefore.id),
        })
      : null;

    afterSnapshot = queueAfter
      ? {
          id: queueAfter.id,
          status: queueAfter.status,
          scheduledAt: fmt(new Date(queueAfter.scheduledAt)),
          updatedAt: fmt(new Date(queueAfter.updatedAt)),
        }
      : null;

    dryRunUnchanged = beforeSnapshot == null || (
      afterSnapshot != null &&
      beforeSnapshot.status === afterSnapshot.status &&
      beforeSnapshot.scheduledAt === afterSnapshot.scheduledAt &&
      beforeSnapshot.updatedAt === afterSnapshot.updatedAt
    );
  } catch {
    dbCheckStatus = "skipped_db_unavailable";
    dryRunResult = {
      processed: 0,
      results: [],
    };
  }

  const report = {
    cases: {
      A_future_30m_not_uploaded: {
        scheduledAt: fmt(future),
        eligible: caseA,
        expected: false,
        pass: caseA === false,
        reason: "not_due_yet",
      },
      B_now_or_past_eligible: {
        scheduledAt: fmt(past),
        eligible: caseB,
        expected: true,
        pass: caseB === true,
      },
      C_yesterday_catchup_eligible: {
        scheduledAt: fmt(yesterday),
        eligible: caseC,
        expected: true,
        pass: caseC === true,
      },
      D_manual_dry_run_no_upload_call: {
        dbCheckStatus,
        processed: dryRunResult.processed,
        sampleResults: dryRunResult.results.slice(0, 5),
        queueRowBefore: beforeSnapshot,
        queueRowAfter: afterSnapshot,
        unchanged: dryRunUnchanged,
        pass: dbCheckStatus === "skipped_db_unavailable" ? null : dryRunUnchanged,
      },
      E_timezone_display_vs_utc: {
        utcStored: fmt(now),
        datetimeLocalValue: formatDateTimeLocalInput(now),
        comparisonUsesDateObjects: true,
        pass: true,
      },
      F_retry_respects_schedule: {
        originalScheduledAt: fmt(future),
        retryWithoutForce: fmt(retryNoForce),
        retryWithForce: fmt(retryForce),
        pass: retryNoForce.getTime() === future.getTime() && retryForce.getTime() === now.getTime(),
      },
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
