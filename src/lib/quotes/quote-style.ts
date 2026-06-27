export type QuoteVisualStyleKey = "default" | "static_deep_quote";
export type QuoteMotionIntensity = "default" | "minimal" | "none";
export type QuoteFormatKey =
  | "short_quote"
  | "quote_reflection"
  | "note_letter_card"
  | "kinetic_text"
  | "bilingual_minimal"
  | "buddhist_teaching_single"
  | "buddhist_teaching_numbered"
  | "buddhist_life_reflection"
  | "buddhist_quote_bright";

export type QuoteStyleResolverInput = {
  channelKey?: string | null;
  nicheName?: string | null;
  channelProfileId?: string | null;
  workspaceId?: string | null;
  contentProfileKey?: string | null;
  formatType?: string | null;
  videoType?: string | null;
  platform?: string | null;
};

export type QuoteVisualStyleResolution = {
  style: QuoteVisualStyleKey;
  kinetic: boolean;
  motionIntensity: QuoteMotionIntensity;
  preferredStaticFormat: QuoteFormatKey | null;
  facebookLayoutPreset: "facebook_quote_premium";
  reason: string;
};

function normalize(value?: string | null): string {
  return (value ?? "").trim().toLocaleLowerCase("vi-VN");
}

function isProtectedBuddhistContext(input: QuoteStyleResolverInput): boolean {
  const channelKey = normalize(input.channelKey);
  const nicheName = normalize(input.nicheName);
  const channelProfileId = normalize(input.channelProfileId);
  const workspaceId = normalize(input.workspaceId);
  const contentProfileKey = normalize(input.contentProfileKey);
  return (
    channelKey === "phat_phap" ||
    channelProfileId === "buddhist_healing_v1" ||
    workspaceId === "buddhist_healing_workspace" ||
    contentProfileKey === "buddhism" ||
    /phật pháp|phat phap|buddh/.test(nicheName)
  );
}

function isProtectedTangSauContext(input: QuoteStyleResolverInput): boolean {
  const channelKey = normalize(input.channelKey);
  const nicheName = normalize(input.nicheName);
  const channelProfileId = normalize(input.channelProfileId);
  const workspaceId = normalize(input.workspaceId);
  const contentProfileKey = normalize(input.contentProfileKey);
  return (
    channelKey === "tang_sau" ||
    channelProfileId === "tang_sau_v1" ||
    workspaceId === "tang_sau_workspace" ||
    contentProfileKey === "psychology" ||
    contentProfileKey === "philosophy" ||
    /tầng sâu|tang sau|psychology|deep reflection|triết/.test(nicheName)
  );
}

export function resolveQuoteVisualStyle(
  input: QuoteStyleResolverInput,
): QuoteVisualStyleResolution {
  if (isProtectedBuddhistContext(input)) {
    return {
      style: "static_deep_quote",
      kinetic: false,
      motionIntensity: "minimal",
      preferredStaticFormat: "buddhist_life_reflection",
      facebookLayoutPreset: "facebook_quote_premium",
      reason: "phat_phap_static_guard",
    };
  }

  if (isProtectedTangSauContext(input)) {
    return {
      style: "static_deep_quote",
      kinetic: false,
      motionIntensity: "minimal",
      preferredStaticFormat: "quote_reflection",
      facebookLayoutPreset: "facebook_quote_premium",
      reason: "tang_sau_static_guard",
    };
  }

  return {
    style: "default",
    kinetic: true,
    motionIntensity: "default",
    preferredStaticFormat: null,
    facebookLayoutPreset: "facebook_quote_premium",
    reason: "default_behavior",
  };
}

export function resolveQuoteShortFormat(
  input: QuoteStyleResolverInput,
  requestedFormat: QuoteFormatKey,
): QuoteFormatKey {
  const style = resolveQuoteVisualStyle(input);
  if (!style.kinetic && requestedFormat === "kinetic_text") {
    return style.preferredStaticFormat ?? "quote_reflection";
  }
  return requestedFormat;
}

