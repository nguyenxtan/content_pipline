/**
 * Traffic recovery sprint config for phat_phap channel.
 * Single source of truth for 70/20/10 family allocation.
 * Rule-based and deterministic — no AI feedback loop.
 *
 * To change the sprint: update PHAT_PHAP_SPRINT and bump sprintId.
 * All generation paths (TTS short, quote short, scheduler) call
 * pickBuddhistSprintTopicFamily() to get the family BEFORE selecting a topic.
 */

import type { StrategicTopicFamilyId } from "@/lib/config/topic-family-registry";

// ── Sprint definition ─────────────────────────────────────────────────────

export type SprintAllocation = {
  sprintId: string;
  description: string;
  focusFamily: StrategicTopicFamilyId;
  secondaryFamilies: StrategicTopicFamilyId[];
  exploreFamilies: StrategicTopicFamilyId[];
  lowPriorityFamilies: StrategicTopicFamilyId[];
  // Weights must sum to 100. Low priority defaults to 0 during sprint.
  weights: { focus: number; secondary: number; explore: number };
};

export const PHAT_PHAP_SPRINT: SprintAllocation = {
  sprintId: "sprint-2026-06-traffic-recovery",
  description: "Traffic recovery: karma/toxic people/betrayal content as primary focus",
  focusFamily: "nhan_qua_nguoi_xau_bao_ung",
  secondaryFamilies: ["buong_bo_chua_lanh", "tri_tue_song_im_lang_nhan_nhin"],
  exploreFamilies: ["gia_dinh_hieu_dao", "tinh_yeu_ton_thuong"],
  lowPriorityFamilies: ["binh_yen_an_lac", "phuoc_bao_nghiep_duyen"],
  weights: { focus: 70, secondary: 20, explore: 10 },
};

// ── Selection ─────────────────────────────────────────────────────────────

/**
 * Pick a strategic topic family for the current sprint using weighted random.
 * Returns null for non-Buddhist channels (caller should skip family selection).
 *
 * Distribution: 70% focus, 20% secondary (uniform), 10% explore (uniform).
 * Low-priority families are excluded during active sprint.
 */
export function pickBuddhistSprintTopicFamily(
  channelKey: string,
  sprint: SprintAllocation = PHAT_PHAP_SPRINT,
): StrategicTopicFamilyId | null {
  if (channelKey !== "phat_phap") return null;

  const roll = Math.random() * 100;

  if (roll < sprint.weights.focus) {
    return sprint.focusFamily;
  }

  if (roll < sprint.weights.focus + sprint.weights.secondary) {
    const idx = Math.floor(Math.random() * sprint.secondaryFamilies.length);
    return sprint.secondaryFamilies[idx];
  }

  const idx = Math.floor(Math.random() * sprint.exploreFamilies.length);
  return sprint.exploreFamilies[idx];
}

/**
 * Return human-readable allocation summary for logging.
 */
export function sprintAllocationSummary(sprint: SprintAllocation = PHAT_PHAP_SPRINT): string {
  return (
    `[sprint:${sprint.sprintId}] ` +
    `focus(${sprint.focusFamily})=${sprint.weights.focus}% | ` +
    `secondary(${sprint.secondaryFamilies.join(",")})=${sprint.weights.secondary}% | ` +
    `explore(${sprint.exploreFamilies.join(",")})=${sprint.weights.explore}%`
  );
}
