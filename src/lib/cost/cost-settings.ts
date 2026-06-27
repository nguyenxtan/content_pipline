// Server-only: reads cost settings from app_config (DB). Client code should
// import constants from "@/lib/cost/cost-constants" instead.
import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import {
  DEFAULT_AIMAX_VND_PER_POINT,
  DEFAULT_AIMAX_PKG_VND,
  DEFAULT_AIMAX_PKG_AMOUNT,
  DEFAULT_USD_TO_VND,
} from "@/lib/cost/cost-constants";
export {
  DEFAULT_AIMAX_VND_PER_POINT,
  DEFAULT_AIMAX_PKG_VND,
  DEFAULT_AIMAX_PKG_AMOUNT,
  DEFAULT_USD_TO_VND,
  calculateAiMaxCostVnd,
  fmtVnd,
} from "@/lib/cost/cost-constants";

// ─── Config key constants ─────────────────────────────────────────────────────

export const COST_KEY_AIMAX_VND_PER_POINT    = "cost.aimax.vnd_per_point";
export const COST_KEY_AIMAX_PKG_VND          = "cost.aimax.points_package_vnd";
export const COST_KEY_AIMAX_PKG_AMOUNT       = "cost.aimax.points_package_amount";
export const COST_KEY_USD_TO_VND             = "cost.usd_to_vnd";
export const COST_KEY_FAL_DEFAULT_IMAGE_VND  = "cost.fal.default_image_vnd";
export const COST_KEY_FAL_FAST_IMAGE_VND     = "cost.fal.fast_image_vnd";
export const COST_KEY_FAL_QUALITY_IMAGE_VND  = "cost.fal.quality_image_vnd";
export const COST_KEY_ENABLE_ESTIMATES       = "cost.enable_estimates";

// ─── Defaults (re-exported from cost-constants) ───────────────────────────────
// Use the re-exports above. This section intentionally left empty.

// ─── Types ────────────────────────────────────────────────────────────────────

export type CostSettings = {
  aimaxVndPerPoint: number;
  aimaxPkgVnd: number;
  aimaxPkgAmount: number;
  usdToVnd: number;
  falDefaultImageVnd: number | null;
  falFastImageVnd: number | null;
  falQualityImageVnd: number | null;
  enableEstimates: boolean;
};

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function getCostSettings(): Promise<CostSettings> {
  const keys = [
    COST_KEY_AIMAX_VND_PER_POINT,
    COST_KEY_AIMAX_PKG_VND,
    COST_KEY_AIMAX_PKG_AMOUNT,
    COST_KEY_USD_TO_VND,
    COST_KEY_FAL_DEFAULT_IMAGE_VND,
    COST_KEY_FAL_FAST_IMAGE_VND,
    COST_KEY_FAL_QUALITY_IMAGE_VND,
    COST_KEY_ENABLE_ESTIMATES,
  ];

  let rows: Array<{ key: string; value: string }> = [];
  try {
    rows = await db.select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig)
      .where(inArray(appConfig.key, keys));
  } catch {
    // DB unavailable — use defaults
  }

  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const v = Number(map[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const numOrNull = (key: string): number | null => {
    const v = Number(map[key]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  return {
    aimaxVndPerPoint:  num(COST_KEY_AIMAX_VND_PER_POINT, DEFAULT_AIMAX_VND_PER_POINT),
    aimaxPkgVnd:       num(COST_KEY_AIMAX_PKG_VND,        DEFAULT_AIMAX_PKG_VND),
    aimaxPkgAmount:    num(COST_KEY_AIMAX_PKG_AMOUNT,     DEFAULT_AIMAX_PKG_AMOUNT),
    usdToVnd:          num(COST_KEY_USD_TO_VND,            DEFAULT_USD_TO_VND),
    falDefaultImageVnd: numOrNull(COST_KEY_FAL_DEFAULT_IMAGE_VND),
    falFastImageVnd:    numOrNull(COST_KEY_FAL_FAST_IMAGE_VND),
    falQualityImageVnd: numOrNull(COST_KEY_FAL_QUALITY_IMAGE_VND),
    enableEstimates:   (map[COST_KEY_ENABLE_ESTIMATES] ?? "true") !== "false",
  };
}

// ─── Synchronous helpers (for server-side code without async) ─────────────────

export function makeAiMaxCostCalc(vndPerPoint: number) {
  return (points: number | null | undefined): number | null => {
    if (points == null || !Number.isFinite(points)) return null;
    return Math.round(points * vndPerPoint * 10000) / 10000;
  };
}

export function makeUsdToVnd(rate: number) {
  return (usd: number | null | undefined): number | null => {
    if (usd == null || !Number.isFinite(usd)) return null;
    return Math.round(usd * rate * 100) / 100;
  };
}

// Shorthand for quick one-off calculations using defaults
export function getAiMaxVndPerPoint(): number {
  return DEFAULT_AIMAX_VND_PER_POINT;
}
