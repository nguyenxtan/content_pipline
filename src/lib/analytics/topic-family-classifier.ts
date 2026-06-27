/**
 * Topic Family Classifier V1
 *
 * Keyword-based auto-classification of Vietnamese content topics
 * into topic families. Deterministic, zero API cost.
 *
 * Priority order when multiple families match: highest weighted score wins.
 */

export interface FamilyDefinition {
  label: string;
  englishLabel: string;
  keywords: string[];
  antiKeywords?: string[];  // if present, reduces score when matched
  longformSuitability: number;  // 0–1
  scalability: "scale" | "maintain" | "reduce" | "stop";
  audienceAge: string;
  monetizationPotential: "high" | "medium" | "low";
}

export const FAMILY_TAXONOMY: Record<string, FamilyDefinition> = {
  lo_lang_va_so_hai: {
    label: "Lo lắng & Sợ hãi",
    englishLabel: "Anxiety / Fear",
    keywords: [
      "lo lắng", "lo âu", "sợ hãi", "bất an", "nỗi lo", "lo sợ",
      "sợ thất bại", "sợ cô đơn", "sợ bị", "lo ngại", "bất ổn",
      "hoang mang", "trằn trọc", "mất ngủ", "lo lắng không",
    ],
    longformSuitability: 1.0,
    scalability: "scale",
    audienceAge: "25–45",
    monetizationPotential: "high",
  },

  co_don_ban_sac: {
    label: "Cô đơn & Bản sắc",
    englishLabel: "Loneliness / Identity / Urban Existential",
    keywords: [
      "cô đơn", "một mình", "không ai hiểu", "không được hiểu",
      "phiên bản người khác", "đóng vai", "không còn là mình",
      "thôi cần được công nhận", "mệt mỏi sống", "không còn cảm thấy",
      "trống rỗng", "trống không", "thành phố quá đông",
      "đô thị", "tự do nhất", "bản thân", "không ai",
      "nói nhiều nhưng không ai", "sống hời hợt", "khoảng lặng",
      "không buồn chỉ thấy", "sợi dây không ai buộc",
      "bị hiểu lầm",
    ],
    antiKeywords: ["tình yêu", "người yêu", "gia đình"],
    longformSuitability: 0.95,
    scalability: "scale",
    audienceAge: "28–42",
    monetizationPotential: "high",
  },

  buong_bo_chua_lanh: {
    label: "Buông bỏ & Chữa lành",
    englishLabel: "Letting Go / Healing",
    keywords: [
      "buông bỏ", "chữa lành", "tha thứ", "buông xả", "tổn thương",
      "vết thương", "chấp nhận thực tại", "hòa giải", "oán hận",
      "đau thương", "buông", "vết đau", "chữa lành tâm",
      "giải phóng tâm hồn", "xiềng xích", "nỗi buồn",
      "mất kết nối", "mất niềm tin", "bất lực",
    ],
    antiKeywords: ["nhân quả", "báo ứng", "tiểu nhân"],
    longformSuitability: 0.85,
    scalability: "maintain",
    audienceAge: "28–45",
    monetizationPotential: "high",
  },

  nhan_qua_nguoi_xau_bao_ung: {
    label: "Nhân quả & Báo ứng",
    englishLabel: "Karma / Retribution / Justice",
    keywords: [
      "nhân quả", "báo ứng", "trả giá", "phản bội", "tiểu nhân",
      "đắc chí", "kẻ xấu", "báo đáp", "trả thù", "tham lam",
      "tội lỗi", "kẻ phản bội", "người xấu", "bao giờ quên",
      "trời không tha", "nhân quả không quên", "ác", "báo ứng tàn",
    ],
    longformSuitability: 0.70,
    scalability: "maintain",
    audienceAge: "30–50",
    monetizationPotential: "medium",
  },

  tri_tue_song_im_lang_nhan_nhin: {
    label: "Trí tuệ & Im lặng",
    englishLabel: "Wisdom / Silence / Restraint",
    keywords: [
      "im lặng", "trí tuệ", "nhẫn nhịn", "khôn ngoan", "lặng thinh",
      "không nói", "từng trải", "bình thản", "sáng suốt",
      "không tranh hơn thua", "nhẫn", "hiểu đời", "ít nói",
      "người khôn", "không phải chuyện nào cũng",
    ],
    longformSuitability: 0.90,
    scalability: "scale",
    audienceAge: "32–50",
    monetizationPotential: "high",
  },

  binh_yen_an_lac: {
    label: "Bình yên & An lạc",
    englishLabel: "Peace / Serenity / Inner Calm",
    keywords: [
      "bình yên", "an lạc", "hạnh phúc", "tĩnh lặng", "an bình",
      "thanh thản", "tĩnh tâm", "nội tâm", "bình an", "niềm vui",
      "sống chậm", "thiền", "tỉnh thức",
    ],
    antiKeywords: ["nhân quả", "báo ứng", "oán hận"],
    longformSuitability: 0.80,
    scalability: "maintain",
    audienceAge: "30–50",
    monetizationPotential: "medium",
  },

  vo_thuong: {
    label: "Vô thường & Mất mát",
    englishLabel: "Impermanence / Loss / Death",
    keywords: [
      "vô thường", "mất mát", "chia xa", "qua đời", "cái chết",
      "cuộc đời ngắn", "chết", "ra đi", "biệt ly", "mất đi",
      "không còn", "tạm biệt", "ngắn ngủi", "phù du",
    ],
    antiKeywords: ["nhân quả", "tiểu nhân", "phản bội"],
    longformSuitability: 0.85,
    scalability: "maintain",
    audienceAge: "35–55",
    monetizationPotential: "medium",
  },

  tuoi_trung_nien: {
    label: "Tuổi trung niên & Sợ già",
    englishLabel: "Middle Age / Aging",
    keywords: [
      "sợ già", "già", "tuổi 40", "tuổi 50", "trung niên",
      "về già", "lão hóa", "tóc bạc", "tuổi trung", "sắp già",
      "không còn trẻ",
    ],
    longformSuitability: 0.90,
    scalability: "scale",
    audienceAge: "38–55",
    monetizationPotential: "high",
  },

  phuoc_bao_nghiep_duyen: {
    label: "Phước báo & Nghiệp duyên",
    englishLabel: "Merit / Dharma / Karma (Buddhist doctrine)",
    keywords: [
      "phước", "nghiệp", "nhân duyên", "tái sinh", "phước lành",
      "thiện lành", "tích đức", "duyên", "nghiệp chướng",
      "sám hối", "phước báo", "gieo điều lành",
    ],
    longformSuitability: 0.60,
    scalability: "reduce",
    audienceAge: "40–65",
    monetizationPotential: "medium",
  },

  tinh_yeu_ton_thuong: {
    label: "Tình yêu & Tổn thương",
    englishLabel: "Romantic Love / Hurt",
    keywords: [
      "tình yêu", "yêu thương", "người yêu", "chia tay",
      "khao khát yêu", "lãng quên", "hụt hẫng", "tình cảm",
      "chờ đợi hụt", "tổn thương lòng tự trọng",
    ],
    antiKeywords: ["nhân quả", "phật", "thiền"],
    longformSuitability: 0.40,
    scalability: "stop",
    audienceAge: "18–32",
    monetizationPotential: "low",
  },

  gia_dinh_hieu_dao: {
    label: "Gia đình & Hiếu đạo",
    englishLabel: "Family / Filial Piety",
    keywords: [
      "gia đình", "hiếu thảo", "cha mẹ", "con cái",
      "hiếu đạo", "bổn phận", "khổ đau vì hiếu", "chờ đợi sự trở về",
    ],
    longformSuitability: 0.30,
    scalability: "stop",
    audienceAge: "25–45",
    monetizationPotential: "low",
  },

  nhan_sinh: {
    label: "Nhân sinh & Hành trình sống",
    englishLabel: "Life Wisdom / Human Stories / Existential Reflection",
    keywords: [
      "nhân sinh", "cuộc đời", "hành trình sống", "bài học cuộc sống",
      "kinh nghiệm sống", "sống sao cho đúng", "ý nghĩa đời người",
      "đời người ngắn", "nhìn lại cuộc đời", "triết lý sống",
      "tìm lại ý nghĩa", "sống thật với bản thân", "chọn cách sống",
      "đường đời", "bước đi trong đời",
    ],
    antiKeywords: ["nhân quả", "tiểu nhân", "phản bội", "cô đơn", "lo lắng"],
    longformSuitability: 0.88,
    scalability: "scale",
    audienceAge: "30–50",
    monetizationPotential: "high",
  },

  phat_phap_ung_dung: {
    label: "Phật pháp ứng dụng",
    englishLabel: "Applied Buddhism / Practical Dharma",
    keywords: [
      "phật dạy", "đức phật", "học phật", "tu tập",
      "giáo lý", "đạo phật", "sống theo đạo", "bát chánh đạo",
      "thiền định", "ứng dụng phật pháp", "phật pháp",
      "chánh niệm trong cuộc sống", "thực hành phật",
    ],
    antiKeywords: ["phước báo", "nghiệp duyên", "nhân quả báo ứng", "tiểu nhân"],
    longformSuitability: 0.80,
    scalability: "maintain",
    audienceAge: "35–60",
    monetizationPotential: "medium",
  },
};

export interface ClassificationResult {
  family: string;
  confidence: number;  // 0–1
  matchedKeywords: string[];
  candidates: Array<{ family: string; score: number; matchedKeywords: string[] }>;
}

/**
 * Classify a Vietnamese topic string into a topic family.
 * Returns null if no family scores above MIN_CONFIDENCE.
 */
export function classifyTopic(topic: string): ClassificationResult | null {
  const MIN_CONFIDENCE = 0.15;
  const text = topic.toLowerCase();

  const scores: Array<{ family: string; score: number; matchedKeywords: string[] }> = [];

  for (const [family, def] of Object.entries(FAMILY_TAXONOMY)) {
    let score = 0;
    const matched: string[] = [];

    for (const kw of def.keywords) {
      if (text.includes(kw.toLowerCase())) {
        // Longer keywords are more specific → higher weight
        const weight = Math.min(kw.length / 4, 3.0);
        score += weight;
        matched.push(kw);
      }
    }

    if (matched.length === 0) continue;

    // Apply anti-keyword penalty
    if (def.antiKeywords) {
      for (const anti of def.antiKeywords) {
        if (text.includes(anti.toLowerCase())) {
          score *= 0.3;
        }
      }
    }

    // Normalize by number of keywords so large families don't dominate by sheer count
    const normalizedScore = score / Math.sqrt(def.keywords.length);

    scores.push({ family, score: normalizedScore, matchedKeywords: matched });
  }

  if (scores.length === 0) return null;

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // Confidence: ratio of top score to sum of all scores
  const totalScore = scores.reduce((s, x) => s + x.score, 0);
  const confidence = totalScore > 0 ? best.score / totalScore : 0;

  if (confidence < MIN_CONFIDENCE || best.score < 0.1) return null;

  return {
    family: best.family,
    confidence,
    matchedKeywords: best.matchedKeywords,
    candidates: scores.slice(0, 3),
  };
}

export function getFamilyLabel(family: string): string {
  return FAMILY_TAXONOMY[family]?.label ?? family;
}

export function getFamilyEnglishLabel(family: string): string {
  return FAMILY_TAXONOMY[family]?.englishLabel ?? family;
}
