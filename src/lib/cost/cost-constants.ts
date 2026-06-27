// Browser-safe constants and pure helpers — no DB imports.

export const DEFAULT_AIMAX_VND_PER_POINT  = 0.12;
export const DEFAULT_AIMAX_PKG_VND        = 600_000;
export const DEFAULT_AIMAX_PKG_AMOUNT     = 5_000_000;
export const DEFAULT_USD_TO_VND           = 25_000;

export function calculateAiMaxCostVnd(pointsUsed: number | null | undefined): number | null {
  if (pointsUsed == null || !Number.isFinite(pointsUsed)) return null;
  return Math.round(pointsUsed * DEFAULT_AIMAX_VND_PER_POINT * 10000) / 10000;
}

export function fmtVnd(vnd: number | null | undefined): string {
  if (vnd == null) return "—";
  if (vnd === 0) return "0 ₫";
  if (vnd < 100) return `${vnd.toFixed(2)} ₫`;
  return `${Math.round(vnd).toLocaleString("vi-VN")} ₫`;
}
