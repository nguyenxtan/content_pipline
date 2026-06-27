const TANG_SAU_CANONICAL_NICHE_ID = 14;

const TANG_SAU_ALLOWED_FORMAT_TYPES = new Set([
  "legacy_quote_short",
  "tts_short",
  "short",
  "quote_short",
  "standalone",
]);

const PHAT_PHAP_TOPIC_FAMILIES = new Set([
  "nhan_qua_nguoi_xau_bao_ung",
  "buong_bo_chua_lanh",
  "tri_tue_song_im_lang_nhan_nhin",
  "gia_dinh_hieu_dao",
  "tinh_yeu_ton_thuong",
  "binh_yen_an_lac",
  "phuoc_bao_nghiep_duyen",
  "peace_mindfulness",
  "letting_go_forgiveness",
  "fear_anxiety",
  "karma",
  "hurt_loneliness",
  "buddhist_life_wisdom",
]);

const PHAT_PHAP_PROMPT_MARKERS = [
  "phat_phap",
  "buddhist",
  "buddhist_healing_v1",
  "phat_phap_short",
  "quote lane destination",
];

const STRONG_BUDDHIST_TEXT_MARKERS = [
  "đức phật",
  "phật pháp",
  "a di đà phật",
  "nhân quả",
  "chánh niệm",
  "thiền sư",
  "luân hồi",
  "nghiệp",
  "vô thường",
  "từ bi",
  "tu tập",
  "chùa",
  "sư thầy",
  "quý vị",
  "gieo nhân",
  "phước",
  "giác ngộ",
  "kinh phật",
  "thiền định",
  "buông bỏ",
  "bình an trong tâm",
];

export type IsolationViolationCode =
  | "source_profile_mismatch"
  | "prompt_profile_mismatch"
  | "semantic_profile_mismatch";

export type TangSauIsolationInput = {
  channelKey?: string | null;
  nicheId?: number | null;
  contentProfileKey?: string | null;
  formatType?: string | null;
  title?: string | null;
  topic?: string | null;
  shortContent?: string | null;
  script?: string | null;
  topicFamily?: string | null;
  promptVersions?: unknown;
};

export type TangSauIsolationViolation = {
  code: IsolationViolationCode;
  reason: string;
  hits: string[];
};

export type SemanticClassification =
  | "A_true_tang_sau"
  | "B_phat_phap_mislabeled_as_tang_sau"
  | "C_generic_self_help"
  | "D_mixed_or_contaminated"
  | "E_unknown";

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("vi-VN");
}

function stringifyPromptVersions(promptVersions: unknown): string {
  if (!promptVersions) return "";
  try {
    return JSON.stringify(promptVersions).toLocaleLowerCase("vi-VN");
  } catch {
    return "";
  }
}

function collectBuddhistTextHits(input: TangSauIsolationInput): string[] {
  const combined = [
    input.title,
    input.topic,
    input.shortContent,
    input.script,
  ].filter(Boolean).join("\n").toLocaleLowerCase("vi-VN");
  return STRONG_BUDDHIST_TEXT_MARKERS.filter((marker) => combined.includes(marker));
}

function collectPromptHits(input: TangSauIsolationInput): string[] {
  const promptBlob = stringifyPromptVersions(input.promptVersions);
  const hits = PHAT_PHAP_PROMPT_MARKERS.filter((marker) => promptBlob.includes(marker));
  const ttsDetails = input.promptVersions && typeof input.promptVersions === "object"
    ? (input.promptVersions as {
        tts?: { details?: { ttsRecommendedUseCase?: unknown; ttsRoute?: unknown } };
      }).tts?.details
    : null;
  if (ttsDetails?.ttsRecommendedUseCase === "phat_phap_short") {
    hits.push("ttsRecommendedUseCase:phat_phap_short");
  }
  if (ttsDetails?.ttsRoute === "phat_phap_short") {
    hits.push("ttsRoute:phat_phap_short");
  }
  if (input.topicFamily && PHAT_PHAP_TOPIC_FAMILIES.has(input.topicFamily)) {
    hits.push(`topic_family:${input.topicFamily}`);
  }
  return [...new Set(hits)];
}

export function classifyTangSauSemanticProfile(
  input: TangSauIsolationInput,
): { classification: SemanticClassification; redFlags: string[] } {
  const promptHits = collectPromptHits(input);
  const textHits = collectBuddhistTextHits(input);
  const allRedFlags = [...promptHits, ...textHits];

  if (promptHits.length > 0 && textHits.length > 0) {
    return { classification: "D_mixed_or_contaminated", redFlags: allRedFlags };
  }
  if (promptHits.length > 0) {
    return { classification: "B_phat_phap_mislabeled_as_tang_sau", redFlags: allRedFlags };
  }
  if (textHits.length > 0) {
    return { classification: "B_phat_phap_mislabeled_as_tang_sau", redFlags: allRedFlags };
  }

  const combined = [
    input.title,
    input.topic,
    input.shortContent,
    input.script,
  ].filter(Boolean).join(" ").toLocaleLowerCase("vi-VN");

  if (/(cô đơn|im lặng|kiểm soát|bỏ quên|trưởng thành|ranh giới|thao túng|tự trọng|ngại giải thích)/.test(combined)) {
    return { classification: "A_true_tang_sau", redFlags: [] };
  }
  if (/(chữa lành|yêu bản thân|năng lượng|vũ trụ|hành trình)/.test(combined)) {
    return { classification: "C_generic_self_help", redFlags: [] };
  }
  return { classification: "E_unknown", redFlags: [] };
}

export function getTangSauIsolationViolation(
  input: TangSauIsolationInput,
): TangSauIsolationViolation | null {
  if (normalize(input.channelKey) !== "tang_sau") return null;

  if (normalize(input.contentProfileKey) !== "philosophy") {
    return {
      code: "source_profile_mismatch",
      reason: `Expected content_profile_key=philosophy for tang_sau, got ${input.contentProfileKey ?? "null"}`,
      hits: [input.contentProfileKey ?? "null"],
    };
  }

  if (input.nicheId != null && input.nicheId !== TANG_SAU_CANONICAL_NICHE_ID) {
    return {
      code: "source_profile_mismatch",
      reason: `Expected niche_id=${TANG_SAU_CANONICAL_NICHE_ID} for tang_sau, got ${input.nicheId}`,
      hits: [String(input.nicheId)],
    };
  }

  if (input.formatType && !TANG_SAU_ALLOWED_FORMAT_TYPES.has(input.formatType)) {
    return {
      code: "source_profile_mismatch",
      reason: `Format ${input.formatType} is not allowed for tang_sau short scheduling`,
      hits: [input.formatType],
    };
  }

  const promptHits = collectPromptHits(input);
  if (promptHits.length > 0) {
    return {
      code: "prompt_profile_mismatch",
      reason: "Tang_sau content references phat_phap/buddhist prompt lineage",
      hits: promptHits,
    };
  }

  const semanticHits = collectBuddhistTextHits(input);
  if (semanticHits.length > 0) {
    return {
      code: "semantic_profile_mismatch",
      reason: "Tang_sau content contains strong Buddhist-only markers",
      hits: semanticHits,
    };
  }

  return null;
}
