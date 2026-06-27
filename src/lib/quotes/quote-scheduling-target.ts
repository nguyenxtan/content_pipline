export type QuoteSchedulingTarget = "short" | "quote";

export type GeneratedQuoteSchedulingInput = {
  channelKey: string | null;
  contentProfileKey: string | null;
  formatType: string | null;
};

export function resolveQuoteSchedulingTarget(
  input: GeneratedQuoteSchedulingInput,
): QuoteSchedulingTarget | null {
  // phat_phap quote content is a short/reel VIDEO and must stay on the
  // normal short lane so it gets YouTube Short + Facebook Reel.
  if (
    input.channelKey === "phat_phap" &&
    input.formatType === "legacy_quote_short"
  ) {
    return "short";
  }

  if (
    input.channelKey === "tang_sau" &&
    input.contentProfileKey === "philosophy" &&
    input.formatType === "legacy_quote_short"
  ) {
    return "short";
  }

  if (input.channelKey === "phat_phap") {
    return "quote";
  }

  return null;
}
