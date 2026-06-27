export type ShortCoverEngineInput = {
  topic: string;
  selectedHook?: string | null;
  script?: string | null;
  formatType?: string | null;
  topicFamily?: string | null;
};

export type ShortCoverCandidateSource = "hook" | "title" | "topic_template" | "legacy_rule";

export type ShortCoverEngineResult = {
  coverText: string;
  coverReason: string;
  confidence: number;
  candidateSource: ShortCoverCandidateSource;
  fallbackUsed: string | null;
  rejectionReason: string | null;
  qualityFlags: string[];
};

export type ShortCoverOpenerPattern = "Đừng" | "Sợ" | "Ai" | "Vì sao" | "Other";
type ShortCoverStructure = "question" | "contradiction" | "direct_warning" | "emotional_statement" | "curiosity_gap";
type QualityFlag =
  | "awkward_vietnamese"
  | "misleading_vs_source"
  | "too_generic"
  | "too_long"
  | "incomplete_ending"
  | "incomplete_phrase";
type RejectionReason =
  | "incomplete_ending"
  | "unnatural_fragment"
  | "too_long"
  | "too_short"
  | "too_generic"
  | "missing_anchor"
  | "semantic_shift"
  | "weak_title_fit";

type Candidate = {
  text: string;
  rawText: string;
  source: ShortCoverCandidateSource;
  score: number;
  reasons: string[];
  openerPattern: ShortCoverOpenerPattern;
  structure: ShortCoverStructure;
};

type CandidateEvaluation = {
  accepted: boolean;
  rejectionReasons: RejectionReason[];
  qualityFlags: QualityFlag[];
};

type BuildContext = {
  topic: string;
  hook: string | null;
  script: string | null;
  topicFamily: string | null;
  titleStrongPhrases: string[];
  titleStrongTokens: string[];
  sourceStrongPhrases: string[];
  sourceStrongTokens: string[];
  combinedSourceText: string;
};

const FEAR_WORDS = [
  "sợ",
  "đau",
  "khổ",
  "mất",
  "tổn thương",
  "cô đơn",
  "bế tắc",
  "vô vọng",
  "hối tiếc",
  "lo lắng",
  "bỏ rơi",
  "lãng quên",
  "phán xét",
  "thất bại",
  "nghiệp",
  "báo ứng",
];

const CURIOSITY_WORDS = [
  "vì sao",
  "điều gì",
  "bí mật",
  "ít ai",
  "không ngờ",
  "thật ra",
  "chưa hiểu",
  "nhận ra",
  "sự thật",
  "ở đâu",
  "vì điều gì",
  "ai thật sự",
];

const CONTRADICTION_WORDS = [
  "nhưng",
  "lại",
  "không phải",
  "càng",
  "ngược lại",
  "tưởng",
  "hóa ra",
  "đừng",
];

const URGENCY_WORDS = [
  "muộn",
  "bây giờ",
  "hôm nay",
  "đừng đợi",
  "trước khi",
  "cả đời",
  "một ngày",
];

const STOP_WORDS = new Set([
  "là",
  "và",
  "của",
  "cho",
  "với",
  "một",
  "những",
  "có",
  "đã",
  "đang",
  "được",
  "quý",
  "vị",
  "người",
  "ta",
  "trong",
  "cuộc",
  "sống",
  "này",
  "ấy",
  "khi",
  "mà",
  "vì",
  "để",
  "từ",
  "bởi",
  "nơi",
  "ra",
]);

const TITLE_PREFIX_WORDS = new Set(["sự", "nỗi", "niềm", "cảm", "việc", "chuyện", "khi"]);
const BAD_EDGE_WORDS = new Set([
  "nhân",
  "quả",
  "nhưng",
  "rằng",
  "chưa",
  "khi",
  "mà",
  "thì",
  "từ",
  "của",
  "với",
  "cho",
  "trong",
  "lại",
  "ra",
  "phải",
  "chỉ",
  "giúp",
]);
const INCOMPLETE_ENDINGS = new Set([
  "vô",
  "giá",
  "trong",
  "với",
  "rằng",
  "vì",
  "để",
  "khi",
  "nên",
  "mà",
  "của",
  "cho",
  "từ",
  "bởi",
  "nơi",
  "phải",
  "ra",
  "lại",
]);
const GENERIC_TEXTS = new Set([
  "cha mẹ",
  "im lặng",
  "điều gì",
  "sự thật",
  "cuộc sống",
  "nỗi đau",
  "bài học",
  "đừng tự làm khổ",
]);
const UNNATURAL_FRAGMENTS = new Set([
  "nhận ra khoảng cách vô",
  "nỗi đau nhưng trong tĩnh",
  "giúp ta nhận ra giá",
]);
const STRONG_PHRASES = [
  "im lặng",
  "cô lập",
  "chấp nhận",
  "cha mẹ",
  "tha thứ",
  "kết nối",
  "quá khứ",
  "mất mát",
  "hy vọng",
  "tham lam",
  "nghiệp",
  "báo ứng",
  "buông bỏ",
  "tổn thương",
  "bình yên",
  "oán hận",
  "phản bội",
  "cô đơn",
  "bỏ rơi",
  "gia đình",
  "yêu thương",
  "trí tuệ",
];
const STRONG_TOKENS = new Set([
  "im",
  "lặng",
  "cô",
  "lập",
  "chấp",
  "nhận",
  "cha",
  "mẹ",
  "tha",
  "thứ",
  "kết",
  "nối",
  "quá",
  "khứ",
  "mất",
  "mát",
  "hy",
  "vọng",
  "tham",
  "lam",
  "nghiệp",
  "báo",
  "ứng",
  "buông",
  "bỏ",
  "tổn",
  "thương",
  "bình",
  "yên",
  "oán",
  "hận",
  "phản",
  "bội",
  "đau",
  "cha",
  "mẹ",
  "trí",
  "tuệ",
]);

function normalizeText(value: string): string {
  return value
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/[“”"']/g, "")
    .replace(/[!?.,;:…()[\]{}<>|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toWords(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function lower(value: string): string {
  return normalizeText(value).toLocaleLowerCase("vi-VN");
}

function titleCaseVietnamese(value: string): string {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("vi-VN") + word.slice(1).toLocaleLowerCase("vi-VN"))
    .join(" ");
}

function unique<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function includesAny(text: string, markers: string[]): string[] {
  const normalized = lower(text);
  return markers.filter((marker) => normalized.includes(marker));
}

export function getShortCoverOpenerPattern(text: string): ShortCoverOpenerPattern {
  const normalized = lower(text);
  if (normalized.startsWith("đừng ")) return "Đừng";
  if (normalized.startsWith("sợ ")) return "Sợ";
  if (normalized.startsWith("ai ")) return "Ai";
  if (normalized.startsWith("vì sao ")) return "Vì sao";
  return "Other";
}

function detectStructure(text: string): ShortCoverStructure {
  const normalized = lower(text);
  if (normalized.includes("ở đâu") || normalized.includes("điều gì") || normalized.startsWith("ai ")) {
    return "question";
  }
  if (normalized.startsWith("đừng ") || normalized.includes("trước khi")) {
    return "direct_warning";
  }
  if (includesAny(normalized, CONTRADICTION_WORDS).length > 0) {
    return "contradiction";
  }
  if (includesAny(normalized, CURIOSITY_WORDS).length > 0) {
    return "curiosity_gap";
  }
  return "emotional_statement";
}

function scorePhrase(phrase: string, source: ShortCoverCandidateSource, extraScore = 0, extraReason?: string): Candidate {
  const normalized = normalizeText(phrase);
  const words = normalized.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const fear = includesAny(normalized, FEAR_WORDS);
  const curiosity = includesAny(normalized, CURIOSITY_WORDS);
  const contradiction = includesAny(normalized, CONTRADICTION_WORDS);
  const urgency = includesAny(normalized, URGENCY_WORDS);
  const openerPattern = getShortCoverOpenerPattern(normalized);
  const structure = detectStructure(normalized);

  let score =
    source === "title" ? 7 :
      source === "hook" ? 6 :
        source === "topic_template" ? 5 :
          3;
  const reasons: string[] = [];

  if (wordCount >= 2 && wordCount <= 5) {
    score += wordCount <= 4 ? 3 : 2;
    reasons.push(wordCount <= 4 ? "compact" : "balanced");
  } else {
    score -= Math.abs(4 - wordCount);
  }

  if (fear.length) {
    score += 2;
    reasons.push("fear");
  }
  if (curiosity.length) {
    score += 2;
    reasons.push("curiosity");
  }
  if (contradiction.length) {
    score += 1;
    reasons.push("contrast");
  }
  if (urgency.length) {
    score += 1;
    reasons.push("urgency");
  }
  if (structure === "question" || structure === "curiosity_gap") score += 1;
  if (extraScore) score += extraScore;
  if (extraReason) reasons.push(extraReason);
  reasons.push(structure);

  return {
    text: titleCaseVietnamese(normalized),
    rawText: normalized,
    source,
    score,
    reasons,
    openerPattern,
    structure,
  };
}

function phraseWindows(text: string, source: ShortCoverCandidateSource): Candidate[] {
  const words = toWords(text);
  const candidates: Candidate[] = [];
  for (let size = 2; size <= 5; size += 1) {
    for (let start = 0; start <= words.length - size; start += 1) {
      const slice = words.slice(start, start + size);
      if (slice.filter((word) => !STOP_WORDS.has(word.toLocaleLowerCase("vi-VN"))).length < 2) continue;
      candidates.push(scorePhrase(slice.join(" "), source));
    }
  }
  return candidates;
}

function compactTitleCandidates(topic: string): Candidate[] {
  const normalized = normalizeText(topic);
  const words = toWords(normalized);
  const candidates: Candidate[] = [];
  if (!words.length) return candidates;

  candidates.push(scorePhrase(normalized, "title", 2, "title_exact"));

  const withoutPrefix = words[0] && TITLE_PREFIX_WORDS.has(words[0].toLocaleLowerCase("vi-VN")) ? words.slice(1) : words;
  if (withoutPrefix.length >= 2) {
    candidates.push(scorePhrase(withoutPrefix.join(" "), "title", 3, "title_trimmed"));
  }

  if (lower(normalized).includes("cha mẹ")) {
    candidates.push(scorePhrase("Tình Cha Mẹ", "title", 4, "title_variant"));
    candidates.push(scorePhrase("Mong Cha Mẹ Hiểu", "title", 3, "title_variant"));
  }
  if (lower(normalized).includes("im lặng") && lower(normalized).includes("đáng sợ")) {
    candidates.push(scorePhrase("Im Lặng Đáng Sợ", "title", 5, "title_variant"));
  }
  if (lower(normalized).includes("im lặng") && lower(normalized).includes("trí tuệ")) {
    candidates.push(scorePhrase("Trí Tuệ Của Im Lặng", "title", 5, "title_variant"));
    candidates.push(scorePhrase("Sức Mạnh Im Lặng", "title", 3, "title_variant"));
  }
  if (lower(normalized).includes("chấp nhận")) {
    candidates.push(scorePhrase("Cần Được Chấp Nhận", "title", 4, "title_variant"));
    candidates.push(scorePhrase("Chấp Nhận Chính Mình", "title", 4, "title_variant"));
  }
  if (lower(normalized).includes("bị cô lập")) {
    candidates.push(scorePhrase("Bị Cô Lập", "title", 5, "title_variant"));
  }
  if (lower(normalized).includes("đổ vỡ")) {
    candidates.push(scorePhrase("Đổ Vỡ", "title", 4, "title_variant"));
  }
  if (lower(normalized).includes("ăn năn")) {
    candidates.push(scorePhrase("Người Xấu Ăn Năn", "title", 4, "title_variant"));
  }
  if (lower(normalized).includes("tội ác")) {
    candidates.push(scorePhrase("Tội Ác Không Thoát", "title", 4, "title_variant"));
  }
  if (lower(normalized).includes("gặt") && lower(normalized).includes("gieo")) {
    candidates.push(scorePhrase("Gieo Gì Gặt Nấy", "title", 5, "title_variant"));
  }
  if (lower(normalized).includes("nhân quả") && lower(normalized).includes("không quên")) {
    candidates.push(scorePhrase("Nhân Quả Không Quên", "title", 5, "title_variant"));
  }

  return unique(candidates, (candidate) => lower(candidate.text));
}

function templateCandidates(context: BuildContext): Candidate[] {
  const topic = lower(context.topic);
  const combined = lower([context.topic, context.hook, context.script].filter(Boolean).join(" "));
  const candidates: Array<{ text: string; boost: number }> = [];
  const add = (text: string, boost = 5) => candidates.push({ text, boost });

  if (topic.includes("mất kết nối")) add("Mất Kết Nối", 7);
  if (topic.includes("vô vọng")) add("Hy Vọng Ở Đâu", 7);
  if (topic.includes("quá khứ")) add("Đừng Kẹt Quá Khứ", 6);
  if (topic.includes("mất mát")) add("Trước Khi Mất Đi", 7);
  if (topic.includes("cha mẹ")) add("Tình Cha Mẹ", 6);
  if (topic.includes("im lặng")) add("Im Lặng Đáng Sợ", 5);
  if (topic.includes("tha thứ")) add("Không Phải Cho Người Kia", 5);
  if (topic.includes("cô đơn")) add("Cô Đơn Không Đáng Sợ", 5);
  if (topic.includes("oán hận")) add("Đừng Giữ Oán Hận", 6);
  if (combined.includes("bình yên")) add("Tìm Lại Bình Yên", 4);
  if (combined.includes("nghiệp") || combined.includes("báo ứng")) add("Nghiệp Tự Quay Về", 4);

  return unique(
    candidates.map(({ text, boost }) => scorePhrase(text, "topic_template", boost, "template")),
    (candidate) => lower(candidate.text),
  );
}

function legacyFallback(context: BuildContext): Candidate[] {
  const combined = lower([context.topic, context.hook, context.script].filter(Boolean).join(" "));
  if (combined.includes("tha thứ")) return [scorePhrase("Đừng Giữ Oán Hận", "legacy_rule", 3, "legacy_fallback")];
  if (combined.includes("im lặng")) return [scorePhrase("Sức Mạnh Im Lặng", "legacy_rule", 2, "legacy_fallback")];
  if (combined.includes("mất")) return [scorePhrase("Trước Khi Mất Đi", "legacy_rule", 2, "legacy_fallback")];
  return [scorePhrase(titleCaseVietnamese(context.topic), "legacy_rule", 1, "legacy_fallback")];
}

function extractStrongPhrases(text: string): string[] {
  const normalized = lower(text);
  return STRONG_PHRASES.filter((phrase) => normalized.includes(phrase));
}

function extractStrongTokens(text: string): string[] {
  const normalized = lower(text);
  return toWords(normalized).filter((word) => STRONG_TOKENS.has(word.toLocaleLowerCase("vi-VN")));
}

function buildContext(input: ShortCoverEngineInput): BuildContext {
  const topic = normalizeText(input.topic);
  const hook = input.selectedHook ? normalizeText(input.selectedHook) : null;
  const script = input.script ? normalizeText(input.script).split(/(?<=[.!?…])\s+/)[0] ?? normalizeText(input.script) : null;
  const sourceText = [topic, hook, script].filter(Boolean).join(" ");
  return {
    topic,
    hook,
    script,
    topicFamily: input.topicFamily ?? null,
    titleStrongPhrases: extractStrongPhrases(topic),
    titleStrongTokens: extractStrongTokens(topic),
    sourceStrongPhrases: extractStrongPhrases(sourceText),
    sourceStrongTokens: extractStrongTokens(sourceText),
    combinedSourceText: lower(sourceText),
  };
}

function titleTokenHits(candidate: Candidate, context: BuildContext): number {
  const phraseHits = context.titleStrongPhrases.filter((phrase) => lower(candidate.text).includes(phrase)).length;
  const tokenHits = extractStrongTokens(candidate.text).filter((token) => context.titleStrongTokens.includes(token)).length;
  return phraseHits * 2 + tokenHits;
}

function sourceAnchorHits(candidate: Candidate, context: BuildContext): number {
  const candidateLower = lower(candidate.text);
  const phraseHits = context.sourceStrongPhrases.filter((phrase) => candidateLower.includes(phrase)).length;
  const tokenHits = extractStrongTokens(candidate.text).filter((token) => context.sourceStrongTokens.includes(token)).length;
  return phraseHits * 2 + tokenHits;
}

function generalOverlap(candidateText: string, referenceText: string): number {
  const candidateWords = toWords(candidateText).filter((word) => word.length >= 3 && !STOP_WORDS.has(word.toLocaleLowerCase("vi-VN")));
  const referenceLower = lower(referenceText);
  return candidateWords.filter((word) => referenceLower.includes(word.toLocaleLowerCase("vi-VN"))).length;
}

function hasSemanticShift(candidate: Candidate, context: BuildContext): boolean {
  const candidateLower = lower(candidate.text);
  const candidatePhrases = extractStrongPhrases(candidate.text);
  const candidateTokens = extractStrongTokens(candidate.text);
  const introducedPhrase = candidatePhrases.some((phrase) => !context.combinedSourceText.includes(phrase));
  const introducedToken = candidateTokens.some((token) => !context.combinedSourceText.includes(token));
  const anchorHits = sourceAnchorHits(candidate, context) + titleTokenHits(candidate, context);
  const overlap = generalOverlap(candidate.text, [context.topic, context.hook, context.script].filter(Boolean).join(" "));
  return (anchorHits === 0 && overlap === 0) ||
    (introducedPhrase && anchorHits < 2 && overlap === 0) ||
    (introducedToken && anchorHits === 0 && overlap === 0) ||
    (candidateLower.includes("nỗi đau") && !context.combinedSourceText.includes("đau"));
}

function evaluateCandidate(candidate: Candidate, context: BuildContext): CandidateEvaluation {
  const normalized = lower(candidate.text);
  const words = toWords(candidate.text);
  const firstWord = words[0]?.toLocaleLowerCase("vi-VN") ?? "";
  const lastWord = words[words.length - 1]?.toLocaleLowerCase("vi-VN") ?? "";
  const rejectionReasons: RejectionReason[] = [];
  const qualityFlags: QualityFlag[] = [];
  const titleHits = titleTokenHits(candidate, context);
  const anchorHits = sourceAnchorHits(candidate, context);

  if (words.length < 2) {
    rejectionReasons.push("too_short");
    qualityFlags.push("incomplete_phrase");
  }
  if (words.length > 7) {
    rejectionReasons.push("too_long");
    qualityFlags.push("too_long");
  }
  if (BAD_EDGE_WORDS.has(firstWord) || BAD_EDGE_WORDS.has(lastWord) || STOP_WORDS.has(firstWord) || STOP_WORDS.has(lastWord)) {
    rejectionReasons.push("unnatural_fragment");
    qualityFlags.push("awkward_vietnamese");
  }
  if (INCOMPLETE_ENDINGS.has(lastWord)) {
    rejectionReasons.push("incomplete_ending");
    qualityFlags.push("incomplete_ending");
  }
  if (UNNATURAL_FRAGMENTS.has(normalized)) {
    rejectionReasons.push("unnatural_fragment");
    qualityFlags.push("awkward_vietnamese");
  }
  if (GENERIC_TEXTS.has(normalized)) {
    rejectionReasons.push("too_generic");
    qualityFlags.push("too_generic");
  }
  if (candidate.source === "topic_template" && titleHits === 0) {
    rejectionReasons.push("weak_title_fit");
    qualityFlags.push("misleading_vs_source");
  }
  if (candidate.source === "hook" && anchorHits === 0 && titleHits === 0) {
    rejectionReasons.push("missing_anchor");
    qualityFlags.push("misleading_vs_source");
  }
  if (candidate.source === "hook" && context.titleStrongTokens.length > 0 && titleHits === 0) {
    rejectionReasons.push("weak_title_fit");
    qualityFlags.push("misleading_vs_source");
  }
  if (candidate.source === "hook" && words.length <= 2 && titleHits < 2) {
    rejectionReasons.push("too_generic");
    qualityFlags.push("too_generic");
  }
  if (hasSemanticShift(candidate, context)) {
    rejectionReasons.push("semantic_shift");
    qualityFlags.push("misleading_vs_source");
  }
  if (/(nhận ra|giúp ta|người ta|đôi khi|có những)/i.test(candidate.text) && words.length >= 4) {
    qualityFlags.push("awkward_vietnamese");
  }

  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons: unique(rejectionReasons, (item) => item),
    qualityFlags: unique(qualityFlags, (item) => item),
  };
}

function sortCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) =>
    b.score - a.score ||
    a.text.split(/\s+/).length - b.text.split(/\s+/).length ||
    a.text.length - b.text.length
  );
}

function confidenceFromScore(candidate: Candidate): number {
  return Math.max(0.5, Math.min(0.96, Math.round((56 + candidate.score * 4) * 100) / 10000));
}

function buildCandidateGroups(context: BuildContext): Record<ShortCoverCandidateSource, Candidate[]> {
  const hookText = context.hook ?? context.script;
  return {
    hook: hookText ? phraseWindows(hookText, "hook") : [],
    title: compactTitleCandidates(context.topic),
    topic_template: templateCandidates(context),
    legacy_rule: legacyFallback(context),
  };
}

function chooseCandidate(context: BuildContext): { candidate: Candidate; evaluation: CandidateEvaluation; fallbackUsed: string | null; rejectionReason: string | null } {
  const groups = buildCandidateGroups(context);
  const order: ShortCoverCandidateSource[] = ["hook", "title", "topic_template", "legacy_rule"];
  const rejected: Array<{ source: ShortCoverCandidateSource; reasons: RejectionReason[] }> = [];
  const acceptedBySource = new Map<ShortCoverCandidateSource, { candidate: Candidate; evaluation: CandidateEvaluation }>();

  for (const source of order) {
    const candidates = sortCandidates(groups[source]);
    for (const candidate of candidates) {
      const evaluation = evaluateCandidate(candidate, context);
      if (evaluation.accepted) {
        acceptedBySource.set(source, { candidate, evaluation });
        break;
      }
      rejected.push({ source, reasons: evaluation.rejectionReasons });
    }
  }

  const hookAccepted = acceptedBySource.get("hook");
  const titleAccepted = acceptedBySource.get("title");
  if (hookAccepted && titleAccepted) {
    const hookWinsClearly = hookAccepted.candidate.score >= titleAccepted.candidate.score + 2;
    const picked = hookWinsClearly ? hookAccepted : titleAccepted;
    const firstRejected = rejected[0];
    return {
      candidate: picked.candidate,
      evaluation: picked.evaluation,
      fallbackUsed: picked === hookAccepted ? (firstRejected ? `${firstRejected.source}_rejected` : null) : "title_preferred_over_hook",
      rejectionReason: picked === hookAccepted ? firstRejected?.reasons.join(", ") ?? null : "hook_not_strong_enough",
    };
  }

  for (const source of order) {
    const accepted = acceptedBySource.get(source);
    if (accepted) {
      const firstRejected = rejected[0];
      return {
        candidate: accepted.candidate,
        evaluation: accepted.evaluation,
        fallbackUsed: source === "hook" ? (firstRejected ? `${firstRejected.source}_rejected` : null) : `${source}_selected`,
        rejectionReason: source === "hook" ? firstRejected?.reasons.join(", ") ?? null : rejected[0]?.reasons.join(", ") ?? null,
      };
    }
  }

  const fallback = scorePhrase(context.topic, "legacy_rule", 1, "hard_fallback");
  const evaluation = evaluateCandidate(fallback, context);
  return {
    candidate: fallback,
    evaluation,
    fallbackUsed: "hard_fallback",
    rejectionReason: rejected[0]?.reasons.join(", ") ?? "no_candidate_passed",
  };
}

function resultFromCandidate(
  candidate: Candidate,
  evaluation: CandidateEvaluation,
  fallbackUsed: string | null,
  rejectionReason: string | null,
): ShortCoverEngineResult {
  return {
    coverText: candidate.text,
    coverReason: `Selected from ${candidate.source}; structure: ${candidate.structure}; opener: ${candidate.openerPattern}; signals: ${candidate.reasons.join(", ")}.`,
    confidence: confidenceFromScore(candidate),
    candidateSource: candidate.source,
    fallbackUsed,
    rejectionReason,
    qualityFlags: evaluation.qualityFlags,
  };
}

type QuoteKeywordRule = { keywords: string[]; text: string };

const QUOTE_KEYWORD_RULES: QuoteKeywordRule[] = [
  { keywords: ["hạnh phúc"], text: "Hạnh Phúc Từ Tâm" },
  { keywords: ["nhân quả", "quả báo", "nghiệp", "ác", "hại"], text: "Nhân Quả Không Quên" },
  { keywords: ["lặng thinh", "im lặng", "trí tuệ", "nói nhiều"], text: "Trí Tuệ Im Lặng" },
  { keywords: ["từ bi", "chữa lành", "thương"], text: "Từ Bi Chữa Lành" },
  { keywords: ["tha thứ"], text: "Tha Thứ Để Tự Do" },
  { keywords: ["sống chậm", "cảm nhận"], text: "Sống Chậm Lại" },
  { keywords: ["buông bỏ", "quá khứ"], text: "Buông Bỏ Để An" },
  { keywords: ["hiện tại", "khoảnh khắc"], text: "Sống Trong Hiện Tại" },
  { keywords: ["lựa chọn", "tự do", "mỏi"], text: "Tự Do Trong Tâm" },
  { keywords: ["giải thích"], text: "Trí Tuệ Không Lời" },
  { keywords: ["tranh hơn thua", "hơn thua"], text: "Không Tranh Hơn Thua" },
  { keywords: ["gieo điều lành", "gieo nhân"], text: "Gieo Lành Gặt Phước" },
  { keywords: ["can đảm"], text: "Can Đảm Bước Tiếp" },
  { keywords: ["phước lành", "tấm lòng"], text: "Phước Lành Từ Tâm" },
  { keywords: ["suy nghĩ", "nỗi sợ"], text: "Sợ Chỉ Là Suy Nghĩ" },
  { keywords: ["cơ hội"], text: "Đau Là Cơ Hội" },
  { keywords: ["bình yên", "an lạc", "tâm"], text: "Tâm An Là Đủ" },
];

const QUOTE_TOPIC_FAMILY_FALLBACK: Record<string, string> = {
  buong_bo_chua_lanh: "Buông Bỏ Để An",
  tri_tue_song_im_lang_nhan_nhin: "Trí Tuệ Im Lặng",
  nhan_qua_nguoi_xau_bao_ung: "Nhân Quả Không Quên",
  binh_yen_an_lac: "Bình Yên Từ Tâm",
  phuoc_bao_nghiep_duyen: "Phước Báo Từ Tâm",
};

const QUOTE_DEFAULT_FALLBACK = "Bình Yên Từ Tâm";

function matchQuoteKeywordRule(text: string): string | null {
  for (const rule of QUOTE_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.text;
    }
  }
  return null;
}

function pickQuoteKeywordCandidate(topicLower: string): string | null {
  return matchQuoteKeywordRule(topicLower);
}

function isAwkwardOrIncompleteEdge(text: string): boolean {
  const words = toWords(text);
  const first = words[0]?.toLocaleLowerCase("vi-VN") ?? "";
  const last = words[words.length - 1]?.toLocaleLowerCase("vi-VN") ?? "";
  if (BAD_EDGE_WORDS.has(first) || BAD_EDGE_WORDS.has(last) || STOP_WORDS.has(first) || STOP_WORDS.has(last)) return true;
  if (INCOMPLETE_ENDINGS.has(last)) return true;
  if (UNNATURAL_FRAGMENTS.has(lower(text))) return true;
  return false;
}

function isFullTitleCopy(candidateText: string, title: string): boolean {
  const candidateWords = toWords(candidateText);
  const titleWords = toWords(title);
  if (titleWords.length <= 6) return false;
  return candidateWords.length >= titleWords.length - 1;
}

function hasQuoteAnchorOverlap(candidateText: string, context: BuildContext): boolean {
  const candidateLower = lower(candidateText);
  const phraseHits =
    context.sourceStrongPhrases.filter((phrase) => candidateLower.includes(phrase)).length +
    context.titleStrongPhrases.filter((phrase) => candidateLower.includes(phrase)).length;
  const tokenHits = extractStrongTokens(candidateText).filter(
    (token) => context.sourceStrongTokens.includes(token) || context.titleStrongTokens.includes(token),
  ).length;
  const overlap = generalOverlap(candidateText, [context.topic, context.hook, context.script].filter(Boolean).join(" "));
  return phraseHits > 0 || tokenHits > 0 || overlap > 0;
}

function passesCompactQuoteGates(text: string, context: BuildContext): boolean {
  const words = toWords(text);
  if (words.length < 2 || words.length > 6) return false;
  if (isAwkwardOrIncompleteEdge(text)) return false;
  if (isFullTitleCopy(text, context.topic)) return false;
  if (GENERIC_TEXTS.has(lower(text))) return false;
  if (!hasQuoteAnchorOverlap(text, context)) return false;
  return true;
}

function splitClauses(text: string): string[] {
  return text
    .split(/[.,;:!?…]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractCompactQuotePhrase(context: BuildContext): string | null {
  const sourceTexts = [context.hook, context.script, context.topic].filter(
    (value): value is string => Boolean(value),
  );
  const clauseCandidates: Candidate[] = [];
  for (const text of sourceTexts) {
    for (const clause of splitClauses(text)) {
      const words = toWords(clause);
      if (words.length < 2 || words.length > 6) continue;
      clauseCandidates.push(scorePhrase(clause, "title"));
    }
  }
  for (const candidate of sortCandidates(clauseCandidates)) {
    if (passesCompactQuoteGates(candidate.text, context)) {
      return candidate.text;
    }
  }

  const topicWords = toWords(context.topic);
  const topicWindows: Candidate[] = [];
  for (let size = 6; size >= 3; size -= 1) {
    for (let start = 0; start <= topicWords.length - size; start += 1) {
      const slice = topicWords.slice(start, start + size);
      if (slice.filter((word) => !STOP_WORDS.has(word.toLocaleLowerCase("vi-VN"))).length < 2) continue;
      topicWindows.push(scorePhrase(slice.join(" "), "title"));
    }
  }
  for (const candidate of sortCandidates(topicWindows)) {
    if (passesCompactQuoteGates(candidate.text, context)) {
      return candidate.text;
    }
  }

  return null;
}

function generateCompactQuoteCover(input: ShortCoverEngineInput): ShortCoverEngineResult {
  const context = buildContext(input);

  const keywordText = pickQuoteKeywordCandidate(lower(context.topic));
  if (keywordText) {
    return {
      coverText: keywordText,
      coverReason: "Selected from quote keyword template; calm reflection tone.",
      confidence: 0.85,
      candidateSource: "topic_template",
      fallbackUsed: "quote_keyword_template",
      rejectionReason: null,
      qualityFlags: [],
    };
  }

  const extracted = extractCompactQuotePhrase(context);
  if (extracted) {
    return {
      coverText: extracted,
      coverReason: "Compact phrase extracted from quote source; calm reflection tone.",
      confidence: 0.7,
      candidateSource: "hook",
      fallbackUsed: "quote_phrase_extracted",
      rejectionReason: null,
      qualityFlags: [],
    };
  }

  const familyFallback = context.topicFamily ? QUOTE_TOPIC_FAMILY_FALLBACK[context.topicFamily] : null;
  return {
    coverText: familyFallback ?? QUOTE_DEFAULT_FALLBACK,
    coverReason: familyFallback
      ? "Fell back to topic-family calm reflection template."
      : "Fell back to default calm reflection template.",
    confidence: 0.6,
    candidateSource: "legacy_rule",
    fallbackUsed: familyFallback ? "quote_topic_family_fallback" : "quote_default_fallback",
    rejectionReason: "no_compact_candidate_passed",
    qualityFlags: [],
  };
}

export function generateShortCover(input: ShortCoverEngineInput): ShortCoverEngineResult {
  if (input.formatType === "legacy_quote_short") {
    return generateCompactQuoteCover(input);
  }
  const context = buildContext(input);
  const picked = chooseCandidate(context);
  return resultFromCandidate(picked.candidate, picked.evaluation, picked.fallbackUsed, picked.rejectionReason);
}

function openerLimit(total: number): number {
  return Math.max(2, Math.ceil(total * 0.22));
}

function selectDiverseCandidate(inputsLength: number, candidates: ShortCoverEngineResult[], openerCounts: Map<ShortCoverOpenerPattern, number>): ShortCoverEngineResult {
  const maxRepeated = openerLimit(inputsLength);
  const rescored = candidates.map((candidate) => {
    const currentCount = openerCounts.get(getShortCoverOpenerPattern(candidate.coverText)) ?? 0;
    const opener = getShortCoverOpenerPattern(candidate.coverText);
    const repeatedTrackedOpener = opener !== "Other";
    const overLimitPenalty = repeatedTrackedOpener && currentCount >= maxRepeated ? 8 : 0;
    const softPenalty = repeatedTrackedOpener ? currentCount * 1.5 : 0;
    return {
      candidate,
      diversityScore: candidate.confidence * 100 - softPenalty - overLimitPenalty,
    };
  });

  return rescored.sort((a, b) => b.diversityScore - a.diversityScore)[0]?.candidate ?? candidates[0];
}

export function generateShortCoversWithDiversity(inputs: ShortCoverEngineInput[]): ShortCoverEngineResult[] {
  const openerCounts = new Map<ShortCoverOpenerPattern, number>();

  return inputs.map((input) => {
    const context = buildContext(input);
    const groups = buildCandidateGroups(context);
    const options = (Object.keys(groups) as ShortCoverCandidateSource[])
      .flatMap((source) => sortCandidates(groups[source]).slice(0, 3))
      .map((candidate) => {
        const evaluation = evaluateCandidate(candidate, context);
        return resultFromCandidate(candidate, evaluation, null, evaluation.accepted ? null : evaluation.rejectionReasons.join(", "));
      })
      .filter((candidate) => candidate.qualityFlags.length === 0);

    const picked = options.length
      ? selectDiverseCandidate(inputs.length, options, openerCounts)
      : generateShortCover(input);

    const opener = getShortCoverOpenerPattern(picked.coverText);
    openerCounts.set(opener, (openerCounts.get(opener) ?? 0) + 1);
    return picked;
  });
}
