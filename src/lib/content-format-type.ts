export type ContentFormatType =
  | "tts_short"
  | "legacy_quote_short"
  | "long_video"
  | "facebook_quote_photo";

export const FORMAT_TYPE_LABELS: Record<ContentFormatType, string> = {
  tts_short: "TTS Short",
  legacy_quote_short: "Quote Short",
  long_video: "Long Video",
  facebook_quote_photo: "Bài ảnh Facebook",
};

/**
 * Resolve the format type for a content row.
 * New rows have formatType set directly. Pre-migration rows fall back to
 * inference from experimentId and contentMode so no backfill is required.
 */
export function inferFormatType(row: {
  formatType?: string | null;
  experimentId?: string | null;
  contentMode?: string | null;
}): ContentFormatType {
  if (row.formatType) return row.formatType as ContentFormatType;
  if (row.experimentId === "LEGACY_QUOTE_SHORT") return "legacy_quote_short";
  if (row.contentMode === "long") return "long_video";
  return "tts_short";
}

export function isLegacyQuoteShort(row: {
  formatType?: string | null;
  experimentId?: string | null;
  contentMode?: string | null;
}): boolean {
  return inferFormatType(row) === "legacy_quote_short";
}

export function isTtsShortContent(row: {
  formatType?: string | null;
  experimentId?: string | null;
  contentMode?: string | null;
}): boolean {
  return inferFormatType(row) === "tts_short";
}

export function isLongVideoContent(row: {
  formatType?: string | null;
  experimentId?: string | null;
  contentMode?: string | null;
  longContent?: string | null;
  longVideoPath?: string | null;
  longAudioPath?: string | null;
  longTtsStatus?: string | null;
  longVideoStatus?: string | null;
}): boolean {
  if (row.formatType === "long_video") return true;
  if (row.experimentId === "LEGACY_QUOTE_SHORT") return false;
  if (row.contentMode === "long") return true;
  if (row.contentMode !== "both") return false;

  return Boolean(
    row.longContent?.trim() ||
      row.longVideoPath ||
      row.longAudioPath ||
      (row.longTtsStatus && row.longTtsStatus !== "pending") ||
      (row.longVideoStatus && row.longVideoStatus !== "pending"),
  );
}
