export const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";
export const UPLOAD_SCHEDULE_TOLERANCE_MS = 15_000;

export function formatDateTimeLocalInput(date: Date): string {
  const local = new Date(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  const hour = String(local.getHours()).padStart(2, "0");
  const minute = String(local.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function isUploadScheduledDue(
  scheduledAt: Date,
  now: Date = new Date(),
  toleranceMs: number = UPLOAD_SCHEDULE_TOLERANCE_MS,
): boolean {
  return scheduledAt.getTime() <= now.getTime() + toleranceMs;
}

export function resolveRetryScheduledAt(
  scheduledAt: Date,
  options?: { forcePublish?: boolean; now?: Date },
): Date {
  return options?.forcePublish ? (options.now ?? new Date()) : scheduledAt;
}

export function getOverdueMinutes(scheduledAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - scheduledAt.getTime()) / 60_000));
}
