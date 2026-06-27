import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appConfig, contentSchedulerJobs, cronRunLogs, type ContentSchedulerJob } from "@/lib/db/schema";
import { lte, eq, and, desc, sql } from "drizzle-orm";
import { runSchedulerJobAction } from "@/actions/content-generator";
import { processUploadQueueAction, cleanupMediaFilesAction, backfillLegacyUploadsAction } from "@/actions/social-channels";
import {
  backfillPublishedVideosAction,
  maybeSendScheduledAnalyticsReportAction,
  syncFacebookAnalyticsAction,
  syncYouTubeAnalyticsAction,
} from "@/actions/publishing-analytics";
import { maybeSendFactoryHealthSummaryAction } from "@/actions/factory-health";
import { runAutoRefillWatcher } from "@/lib/auto-refill-watcher";
import { sendTelegram } from "@/lib/social/telegram";

const CRON_HEALTH_CONFIG_KEY = "cron_health_state";
const CRON_ADVISORY_LOCK_KEY = 72400131;

type CronHealthState = {
  lastRecoveryAlertForLogAt?: string | null;
};

const NON_FATAL_UPLOAD_ERRORS = new Set([
  "upload_interval_deferred",
  "quota_rotated",
  "quota_exceeded_all",
  "auth_retry",
  "transient_retry",
  "facebook_auth_paused",
  "facebook_retry_deferred",
  "facebook_reconnect_required",
]);

async function getCronHealthState(): Promise<CronHealthState> {
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, CRON_HEALTH_CONFIG_KEY),
  });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as CronHealthState;
  } catch {
    return {};
  }
}

async function setCronHealthState(state: CronHealthState): Promise<void> {
  await db
    .insert(appConfig)
    .values({
      key: CRON_HEALTH_CONFIG_KEY,
      value: JSON.stringify(state),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: JSON.stringify(state),
        updatedAt: new Date(),
      },
    });
}

async function tryAcquireCronLock(): Promise<boolean> {
  const result = await db.execute(sql`select pg_try_advisory_lock(${CRON_ADVISORY_LOCK_KEY}) as locked`);
  const row = Array.isArray(result) ? result[0] : (result as { rows?: Array<{ locked?: boolean }> }).rows?.[0];
  return !!row?.locked;
}

async function releaseCronLock(): Promise<void> {
  await db.execute(sql`select pg_advisory_unlock(${CRON_ADVISORY_LOCK_KEY})`);
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const start = Date.now();
  const cronRunId = crypto.randomUUID();
  const body = await req.json().catch(() => ({})) as { jobId?: string };

  // ── Manual trigger for a single job ─────────────────────────
  if (body.jobId) {
    const result = await runSchedulerJobAction(body.jobId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result });
  }

  const lockAcquired = await tryAcquireCronLock();
  if (!lockAcquired) {
    return NextResponse.json({
      ok: true,
      skipped: "cron_locked",
      ran: 0,
      results: [],
      uploads: { processed: 0, results: [] },
      errors: [],
      durationMs: 0,
    });
  }

  // ── Detect cron gap (cron was dead) ─────────────────────────
  // Lấy 5 log gần nhất để tự tính interval thực tế của cron.
  // Không dùng ngưỡng cứng vì interval khác nhau tuỳ cài đặt.
  const recentLogs = await db
    .select({ ranAt: cronRunLogs.ranAt })
    .from(cronRunLogs)
    .orderBy(desc(cronRunLogs.ranAt))
    .limit(5);

  if (recentLogs.length > 0) {
    const cronHealthState = await getCronHealthState();
    const latestLoggedAtIso = new Date(recentLogs[0].ranAt).toISOString();
    const gapMs = Date.now() - new Date(recentLogs[0].ranAt).getTime();

    // Tính interval trung bình từ các lần chạy gần nhất (cần ít nhất 2 log).
    // Nếu chưa đủ log → dùng ngưỡng tối thiểu 30 phút.
    let typicalIntervalMs = 30 * 60 * 1000;
    if (recentLogs.length >= 2) {
      const gaps: number[] = [];
      for (let i = 0; i < recentLogs.length - 1; i++) {
        const g = new Date(recentLogs[i].ranAt).getTime() - new Date(recentLogs[i + 1].ranAt).getTime();
        if (g > 0) gaps.push(g);
      }
      if (gaps.length > 0) {
        gaps.sort((a, b) => a - b);
        // Dùng median để tránh bị kéo bởi outlier
        typicalIntervalMs = gaps[Math.floor(gaps.length / 2)];
      }
    }

    // Chỉ alert khi gap > 2.5× interval thông thường (và ít nhất 5 phút)
    const alertThresholdMs = Math.max(5 * 60 * 1000, typicalIntervalMs * 2.5);
    if (gapMs > alertThresholdMs && cronHealthState.lastRecoveryAlertForLogAt !== latestLoggedAtIso) {
      const gapMin = Math.round(gapMs / 60000);
      await sendTelegram(
        `⚠️ <b>Cron đã khôi phục</b>\n\nCron bị gián đoạn <b>${gapMin} phút</b> và vừa chạy lại.\n` +
        `Kiểm tra <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/content">Content Pipeline</a> để đảm bảo không có job nào bị bỏ lỡ.`
      );
      await setCronHealthState({
        lastRecoveryAlertForLogAt: latestLoggedAtIso,
      });
    }
  }

  // ── Run all due jobs ─────────────────────────────────────────
  const now = new Date();
  const results: object[] = [];
  const errors: string[] = [];
  let dueJobs: ContentSchedulerJob[] = [];
  let uploadResult: Awaited<ReturnType<typeof processUploadQueueAction>> = { processed: 0, results: [] };
  let autoRefillResult:
    | Awaited<ReturnType<typeof runAutoRefillWatcher>>
    | null = null;

  try {
    try {
      uploadResult = await processUploadQueueAction({
        source: "cron",
        allowUpload: true,
        runId: cronRunId,
        job: "api/cron/run",
      });
      const uploadErrors = uploadResult.results
        .filter((r) => !r.ok && !NON_FATAL_UPLOAD_ERRORS.has(r.error ?? ""))
        .map((r) => `[upload] ${r.error ?? "unknown error"}`);
      errors.push(...uploadErrors);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`[upload] ${message}`);
    }

    dueJobs = await db
      .select()
      .from(contentSchedulerJobs)
      .where(and(eq(contentSchedulerJobs.isEnabled, true), lte(contentSchedulerJobs.nextRunAt, now)));

    for (const job of dueJobs) {
      try {
        const res = await runSchedulerJobAction(job.id);
        const entry = { jobId: job.id, jobType: job.jobType, nicheName: job.nicheName, ...res };
        results.push(entry);

        if ("error" in res) {
          // Top-level job failure (e.g. job not found, disabled)
          errors.push(`[${job.jobType}/${job.nicheName}] ${res.error}`);
        } else if ("results" in res && Array.isArray(res.results)) {
          // Per-item pipeline failures inside short_pipeline / long_pipeline jobs.
          // runSchedulerJobAction returns { processed, results: [{ok, step, error, id}] }
          // which does NOT reach the outer "error" branch — so we inspect results here.
          for (const r of res.results) {
            const item = r as { ok?: boolean; error?: string; step?: string; id?: string };
            if (!item.ok && item.error) {
              errors.push(
                `[${job.nicheName}/${item.step ?? "pipeline"}] ${item.id ? `(${item.id.slice(0, 8)}) ` : ""}${item.error}`,
              );
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ jobId: job.id, jobType: job.jobType, nicheName: job.nicheName, error: message });
        errors.push(`[${job.jobType}/${job.nicheName}] ${message}`);
      }
    }

    // ── Backfill legacy uploads (idempotent, no-op after first run) ───
    await backfillLegacyUploadsAction().catch(() => {});
    await backfillPublishedVideosAction().catch(() => {});

    // ── Clean up media files scheduled for deletion ───────────────
    await cleanupMediaFilesAction().catch(() => {});

    // ── Sync analytics / reports ─────────────────────────────────
    await syncYouTubeAnalyticsAction({ limitVideos: 20 }).catch(() => {});
    await syncFacebookAnalyticsAction({ limitVideos: 20 }).catch(() => {});
    await maybeSendScheduledAnalyticsReportAction().catch(() => {});
    await maybeSendFactoryHealthSummaryAction().catch(() => {});

    try {
      autoRefillResult = await runAutoRefillWatcher({ dryRun: false, source: "cron" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`[auto-refill] ${message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`[cron] ${message}`);
  } finally {
    await releaseCronLock().catch(() => {});
  }

  // ── Telegram alert on failures ───────────────────────────────
  if (errors.length > 0) {
    const lines = errors.slice(0, 5).map((e) => `• ${e}`).join("\n");
    await sendTelegram(
      `❌ <b>Cron job thất bại</b>\n\n${lines}${errors.length > 5 ? `\n... và ${errors.length - 5} lỗi khác` : ""}\n\n` +
      `👉 <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/content">Kiểm tra</a>`
    );
  }

  // ── Log this run ─────────────────────────────────────────────
  const durationMs = Date.now() - start;
  await db.insert(cronRunLogs).values({
    id: cronRunId,
    jobsRan: dueJobs.length,
    jobsResults: autoRefillResult
      ? [...results, { autoRefill: autoRefillResult }]
      : results,
    uploadsProcessed: uploadResult.processed,
    hasErrors: errors.length > 0,
    errorSummary: errors.length > 0 ? errors.slice(0, 3).join(" | ") : null,
    durationMs,
  });

  await setCronHealthState({ lastRecoveryAlertForLogAt: null });

  // Keep only last 500 logs
  await db.delete(cronRunLogs).where(
    sql`${cronRunLogs.id} NOT IN (SELECT id FROM cron_run_logs ORDER BY ran_at DESC LIMIT 500)`
  );

  return NextResponse.json({
    ok: errors.length === 0,
    ran: dueJobs.length,
    results,
    uploads: { processed: uploadResult.processed, results: uploadResult.results },
    autoRefill: autoRefillResult,
    errors,
    durationMs,
  });
}
