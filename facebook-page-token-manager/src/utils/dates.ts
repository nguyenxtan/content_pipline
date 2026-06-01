export function fromUnixSeconds(value?: number | null): Date | null {
  if (!value || value <= 0) return null;
  return new Date(value * 1000);
}

export function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function daysUntil(date: Date): number {
  const diff = date.getTime() - Date.now();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}
