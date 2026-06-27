// Central Strategic Buddhist Topic Family Registry
// Do not add new families here without updating the allocation planner config.
// New families default to priority "explore" until configured.

export const NEEDS_REVIEW_FAMILY = "needs_topic_family_review" as const;

export type StrategicTopicFamilyId =
  | "nhan_qua_nguoi_xau_bao_ung"
  | "buong_bo_chua_lanh"
  | "tri_tue_song_im_lang_nhan_nhin"
  | "gia_dinh_hieu_dao"
  | "tinh_yeu_ton_thuong"
  | "binh_yen_an_lac"
  | "phuoc_bao_nghiep_duyen"
  | typeof NEEDS_REVIEW_FAMILY;

export type StrategicFamilyPriority = "focus" | "secondary" | "explore" | "low" | "needs_review";

export type StrategicTopicFamily = {
  id: StrategicTopicFamilyId;
  name: string;
  priority: StrategicFamilyPriority;
  description: string;
  angles: string[];
  channels: string[];
};

export const STRATEGIC_TOPIC_FAMILIES: StrategicTopicFamily[] = [
  {
    id: "nhan_qua_nguoi_xau_bao_ung",
    name: "Nhân quả / người xấu / tiểu nhân / báo ứng",
    priority: "focus",
    description: "Karma, toxic people, betrayal, delayed consequences, not needing revenge. Current traffic recovery focus family.",
    channels: ["buddhist_healing_v1"],
    angles: [
      "người hại bạn",
      "tiểu nhân",
      "bị phản bội",
      "báo ứng đến muộn",
      "người sống ác",
      "không cần trả thù",
      "im lặng trước người xấu",
    ],
  },
  {
    id: "buong_bo_chua_lanh",
    name: "Buông bỏ / chữa lành",
    priority: "secondary",
    description: "Letting go, releasing pain, reducing attachment, recovering from hurt.",
    channels: ["buddhist_healing_v1"],
    angles: [
      "buông bỏ người không thương mình",
      "ngừng tự làm đau mình",
      "đừng níu người muốn rời đi",
      "chữa lành sau tổn thương",
      "bình an sau biến cố",
    ],
  },
  {
    id: "tri_tue_song_im_lang_nhan_nhin",
    name: "Trí tuệ sống / im lặng / nhẫn nhịn",
    priority: "secondary",
    description: "Silence, patience, not arguing, not explaining to people who do not understand, knowing when to step back.",
    channels: ["buddhist_healing_v1"],
    angles: [
      "im lặng là trí tuệ",
      "không giải thích với người không hiểu mình",
      "nhẫn không phải yếu",
      "biết lùi là biết thắng",
      "người khôn không tranh hơn thua",
    ],
  },
  {
    id: "gia_dinh_hieu_dao",
    name: "Gia đình / hiếu đạo",
    priority: "explore",
    description: "Family, filial piety, gratitude to parents, family karma, blessings from filial behavior.",
    channels: ["buddhist_healing_v1"],
    angles: [
      "cha mẹ còn là phúc",
      "đừng làm cha mẹ buồn",
      "hiếu đạo tạo phước",
      "gia đình là nghiệp duyên",
      "phúc báo của người biết hiếu thảo",
    ],
  },
  {
    id: "tinh_yeu_ton_thuong",
    name: "Tình yêu / chia tay / tổn thương",
    priority: "explore",
    description: "Love, breakup, and emotional pain framed through Buddhist karma, attachment, and letting go.",
    channels: ["buddhist_healing_v1"],
    angles: [
      "người rời đi",
      "yêu sai người",
      "chia tay trong bình an",
      "ngừng oán trách người cũ",
      "duyên hết thì buông",
    ],
  },
  {
    id: "binh_yen_an_lac",
    name: "Bình yên / an lạc",
    priority: "low",
    description: "Calm, peace, present moment. Lower priority this month — hooks tend to be too soft for traffic recovery.",
    channels: ["buddhist_healing_v1"],
    angles: [
      "bình yên nội tâm",
      "sống trong hiện tại",
      "tĩnh tâm khi mệt mỏi",
      "an lạc từ điều nhỏ",
      "thở chậm lại",
    ],
  },
  {
    id: "phuoc_bao_nghiep_duyen",
    name: "Phước báo / nghiệp duyên",
    priority: "low",
    description: "Light explanations of blessings, karma, affinity, cause and effect, and daily merit.",
    channels: ["buddhist_healing_v1"],
    angles: [
      "người có phước",
      "nghiệp duyên gặp nhau",
      "gieo gì gặt nấy",
      "phước đến từ việc nhỏ",
      "đừng tiêu hao phước báo",
    ],
  },
  {
    id: NEEDS_REVIEW_FAMILY,
    name: "Cần phân loại lại",
    priority: "needs_review",
    description: "Content that could not be classified into a strategic family. Needs manual review.",
    channels: ["buddhist_healing_v1"],
    angles: [],
  },
];

export const STRATEGIC_FAMILY_DISPLAY: Record<StrategicTopicFamilyId, string> = {
  nhan_qua_nguoi_xau_bao_ung: "Nhân quả / Người xấu / Báo ứng",
  buong_bo_chua_lanh: "Buông bỏ / Chữa lành",
  tri_tue_song_im_lang_nhan_nhin: "Trí tuệ sống / Im lặng / Nhẫn nhịn",
  gia_dinh_hieu_dao: "Gia đình / Hiếu đạo",
  tinh_yeu_ton_thuong: "Tình yêu / Chia tay / Tổn thương",
  binh_yen_an_lac: "Bình yên / An lạc",
  phuoc_bao_nghiep_duyen: "Phước báo / Nghiệp duyên",
  needs_topic_family_review: "Cần phân loại lại",
};

// ── Mapping tables from old family systems ────────────────────────────────────

// Content Intelligence Vietnamese family IDs (bung_bo, hanh_phuc, …)
const CI_FAMILY_TO_STRATEGIC: Record<string, StrategicTopicFamilyId> = {
  bung_bo: "buong_bo_chua_lanh",
  hanh_phuc: "binh_yen_an_lac",
  kho_dau: "buong_bo_chua_lanh",
  co_don: "buong_bo_chua_lanh",
  bat_luc: "buong_bo_chua_lanh",
  // vo_thuong → general doctrine by default; topics about revenge/toxic people are caught by keyword inference first
  vo_thuong: "phuoc_bao_nghiep_duyen",
  niem_tin: "binh_yen_an_lac",
  binh_yen: "binh_yen_an_lac",
  tu_do: "buong_bo_chua_lanh",
  general: NEEDS_REVIEW_FAMILY,
};

// Old quote pipeline English family IDs (fear_anxiety, letting_go_forgiveness, …)
const QUOTE_FAMILY_TO_STRATEGIC: Record<string, StrategicTopicFamilyId> = {
  fear_anxiety: "buong_bo_chua_lanh",
  letting_go_forgiveness: "buong_bo_chua_lanh",
  peace_mindfulness: "binh_yen_an_lac",
  karma: "phuoc_bao_nghiep_duyen",
  hurt_loneliness: "buong_bo_chua_lanh",
  buddhist_life_wisdom: "phuoc_bao_nghiep_duyen",
};

// ── Keyword inference rules ───────────────────────────────────────────────────
// nhan_qua_nguoi_xau_bao_ung is listed FIRST — it is the focus family and takes
// precedence over broader karma/vo_thuong matches.

const STRATEGIC_KEYWORD_RULES: Array<{ family: StrategicTopicFamilyId; keywords: string[] }> = [
  {
    family: "nhan_qua_nguoi_xau_bao_ung",
    keywords: [
      "người hại",
      "tiểu nhân",
      "phản bội",
      "báo ứng",
      "trả thù",
      "người xấu",
      "kẻ xấu",
      "im lặng là phúc",
      "người bạc",
      "không cần trả thù",
      "người sống ác",
      "tự trả giá",
      "kẻ hại người",
      "đâm sau lưng",
      "bị hại",
      "người từng hại",
    ],
  },
  {
    family: "tri_tue_song_im_lang_nhan_nhin",
    keywords: [
      "im lặng là trí tuệ",
      "im lặng đúng lúc",
      "im lặng là",
      "sức mạnh của im lặng",
      "lặng thinh",
      "không giải thích với",
      "không cần giải thích",
      "nhẫn nhịn",
      "nhẫn nhục",
      "không tranh hơn thua",
      "tranh hơn thua",
      "hơn thua",
      "biết lùi",
      "người khôn không tranh",
      "can đảm",
      "dũng cảm",
      "vẫn bước tiếp",
    ],
  },
  {
    family: "gia_dinh_hieu_dao",
    keywords: [
      "cha mẹ",
      "hiếu đạo",
      "hiếu thảo",
      "gia đình là",
      "phụng dưỡng",
      "báo hiếu",
    ],
  },
  {
    family: "tinh_yeu_ton_thuong",
    keywords: [
      "tình yêu",
      "chia tay",
      "người yêu",
      "yêu sai người",
      "duyên hết",
      "người rời đi",
      "ngừng oán trách người cũ",
      "khát khao yêu thương",
      "sợ bị lãng quên",
      "chờ đợi hụt hẫng",
    ],
  },
  {
    family: "buong_bo_chua_lanh",
    keywords: [
      "buông bỏ",
      "buông xả",
      "tha thứ",
      "chữa lành",
      "tổn thương",
      "vết thương",
      "đau lòng",
      "mất mát",
      "khổ đau",
      "nỗi đau",
      "nỗi buồn",
      "buồn tủi",
      "lo lắng",
      "mệt mỏi",
      "mất phương hướng",
      "sợ hãi",
      "sợ thất bại",
      "sợ tương lai",
      "nỗi sợ",
      "bất an",
      "kiệt sức",
      "chán nản",
      "cô đơn",
      "trống rỗng",
      "mong mỏi sự kết nối",
      "mong mỏi",
      "mất kết nối",
      "bất lực",
      "thất vọng",
      "tuyệt vọng",
      "thôi giữ",
      "chấp nhận thực tại",
      "tìm kiếm sự thấu hiểu",
      "tìm kiếm sự tự do",
      "khao khát tự do",
      "bế tắc",
      "vô vọng",
      "oán giận",
      "tự ti",
      "tiếc nuối",
      "hoang mang",
      "mất lòng tin",
      "mắc kẹt",
      "sợ bị",
      "sợ thay đổi",
      "sợ phải đối diện",
      "cố chấp",
      "giận dữ",
      "chần chừ",
    ],
  },
  {
    family: "binh_yen_an_lac",
    keywords: [
      "bình yên",
      "an lạc",
      "tĩnh tâm",
      "bình an",
      "tĩnh lặng",
      "hiện tại",
      "hạnh phúc",
      "niềm vui",
      "chánh niệm",
      "an nhiên",
      "niềm tin",
      "hy vọng",
      "sống chậm",
      "cảm nhận sâu hơn",
      "từng hơi thở",
      "thở chậm",
      "an yên",
      "tìm kiếm ý nghĩa",
      "ý nghĩa cuộc sống",
      "ý nghĩa cuộc đời",
    ],
  },
  {
    family: "phuoc_bao_nghiep_duyen",
    keywords: [
      "nhân quả",
      "nghiệp",
      "phước",
      "phúc",
      "vô thường",
      "luân hồi",
      "vô ngã",
      "gieo điều lành",
      "phước báo",
      "nghiệp duyên",
    ],
  },
];

// All strategic family IDs for O(1) membership checks
const STRATEGIC_ID_SET = new Set<string>(STRATEGIC_TOPIC_FAMILIES.map((f) => f.id));

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Infer a strategic topic family from a Vietnamese topic string.
 * Returns `needs_topic_family_review` when no keyword match is found.
 * Never returns `general`.
 */
export function inferStrategicTopicFamily(topic: string): StrategicTopicFamilyId {
  const lower = topic.toLowerCase();
  for (const { family, keywords } of STRATEGIC_KEYWORD_RULES) {
    if (keywords.some((kw) => lower.includes(kw))) return family;
  }
  return NEEDS_REVIEW_FAMILY;
}

/**
 * Map any old-system family ID to a strategic family ID.
 * Accepts:
 *   - Strategic IDs already (passed through unchanged)
 *   - Old Content Intelligence IDs (bung_bo, hanh_phuc, vo_thuong, …)
 *   - Old quote pipeline English IDs (fear_anxiety, letting_go_forgiveness, …)
 * Returns `needs_topic_family_review` for any unrecognized input.
 * Never returns `general`.
 */
export function normalizeTopicFamily(rawFamilyId: string): StrategicTopicFamilyId {
  if (!rawFamilyId) return NEEDS_REVIEW_FAMILY;
  if (STRATEGIC_ID_SET.has(rawFamilyId)) return rawFamilyId as StrategicTopicFamilyId;
  const fromCI = CI_FAMILY_TO_STRATEGIC[rawFamilyId];
  if (fromCI) return fromCI;
  const fromQuote = QUOTE_FAMILY_TO_STRATEGIC[rawFamilyId];
  if (fromQuote) return fromQuote;
  return NEEDS_REVIEW_FAMILY;
}

/**
 * Resolve the best strategic topic family for a content item.
 * Prefers the stored family ID (normalizing it if it is an old-system ID),
 * then falls back to keyword inference on the topic string.
 *
 * Returns both the resolved strategic ID and the original source family for audit.
 */
export function resolveTopicFamily(opts: {
  storedFamily?: string | null;
  topic: string;
}): { strategicFamily: StrategicTopicFamilyId; sourceFamily: string | null } {
  if (opts.storedFamily) {
    const normalized = normalizeTopicFamily(opts.storedFamily);
    if (normalized !== NEEDS_REVIEW_FAMILY) {
      return { strategicFamily: normalized, sourceFamily: opts.storedFamily };
    }
  }
  const inferred = inferStrategicTopicFamily(opts.topic);
  return { strategicFamily: inferred, sourceFamily: opts.storedFamily ?? null };
}

/**
 * Return only the strategic families that apply to a given channel profile.
 * Excludes `needs_topic_family_review` from results (it is a system sentinel, not a schedulable family).
 */
export function getStrategicFamiliesForChannel(channelProfileId: string): StrategicTopicFamily[] {
  return STRATEGIC_TOPIC_FAMILIES.filter(
    (f) => f.id !== NEEDS_REVIEW_FAMILY && f.channels.includes(channelProfileId),
  );
}
