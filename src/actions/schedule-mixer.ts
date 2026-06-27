"use server";

import {
  computeMixerPreview,
  executeMixerSchedule,
  type MixerOptions,
  type MixerPreviewResult,
} from "@/lib/schedule-mixer";
import { getThresholds } from "@/lib/production-capacity";

export type { MixerOptions, MixerPreviewResult, MixerSlot, MixMode, ContentFormat } from "@/lib/schedule-mixer";

export type PreviewMixedScheduleResult = MixerPreviewResult & { ok: boolean };
export type ExecuteMixedScheduleResult = MixerPreviewResult & { ok: boolean; createdIds: string[] };

function publicFields(r: MixerPreviewResult): MixerPreviewResult {
  return {
    ok: r.ok,
    mode: r.mode,
    slots: r.slots,
    insertableCount: r.insertableCount,
    skippedCount: r.skippedCount,
    ttsCount: r.ttsCount,
    quoteCount: r.quoteCount,
    pendingBefore: r.pendingBefore,
    pendingAfter: r.pendingAfter,
    pendingThreshold: r.pendingThreshold,
    thresholdExceeded: r.thresholdExceeded,
    hardBlockReasons: r.hardBlockReasons,
    warningCounts: r.warningCounts,
    balanceWarnings: r.balanceWarnings,
    pendingBreakdown: r.pendingBreakdown,
    workspaceDestinationWarning: r.workspaceDestinationWarning,
    message: r.message,
  };
}

const ERROR_BASE = {
  ok: false as const,
  slots: [] as MixerPreviewResult["slots"],
  insertableCount: 0,
  skippedCount: 0,
  ttsCount: 0,
  quoteCount: 0,
  pendingBefore: 0,
  pendingAfter: 0,
  pendingThreshold: getThresholds().maxPendingUploadQueue,
  thresholdExceeded: false,
  hardBlockReasons: [] as string[],
  warningCounts: {} as Record<string, number>,
  balanceWarnings: [] as string[],
};

export async function previewMixedScheduleAction(
  opts: MixerOptions,
): Promise<PreviewMixedScheduleResult> {
  try {
    const result = await computeMixerPreview(opts);
    return publicFields(result);
  } catch (err) {
    return {
      ...ERROR_BASE,
      mode: "dry_run",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeMixedScheduleAction(
  opts: MixerOptions,
): Promise<ExecuteMixedScheduleResult> {
  try {
    const result = await executeMixerSchedule(opts);
    return { ...publicFields(result), createdIds: result.createdIds };
  } catch (err) {
    return {
      ...ERROR_BASE,
      mode: "execute",
      createdIds: [],
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
