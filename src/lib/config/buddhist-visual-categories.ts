/**
 * Buddhist Visual Categories V1
 *
 * Visual direction: bright — sacred — warm — clean — uplifting — peaceful — clearly Buddhist
 * emotionally comforting, instantly recognizable in the first frame.
 *
 * Viewer should feel: an lành, được che chở, nhẹ lòng, sáng tâm, muốn dừng lại 1 giây.
 */

export const BUDDHIST_VISUAL_PROMPT_VERSION = "BUDDHIST_VISUAL_V2" as const;
export const BUDDHIST_VISUAL_STYLE = "bright_sacred_buddhist" as const;

export type BuddhistVisualCategoryKey =
  | "BUDDHA_GOLDEN_ENLIGHTENMENT"
  | "GUANYIN_WHITE_JADE_COMPASSION"
  | "AMITABHA_PURE_LAND_LIGHT"
  | "BODHISATTVA_BRIGHT_VOW"
  | "LOTUS_PARADISE_PEACE"
  | "TEMPLE_SUNRISE_SERENITY"
  | "BAMBOO_MEDITATION_GREEN"
  | "SKY_CLOUD_HEAVENLY_BUDDHA"
  | "DHARMA_CITY_LIGHT"
  | "SCRIPTURE_CANDLE_GOLD"
  | "MANDALA_BRIGHT_KARMA"
  | "VIETNAMESE_BUDDHIST_TEMPLE"
  | "PRACTICAL_DAILY_LIFE";

export type BuddhistVisualCategory = {
  key: BuddhistVisualCategoryKey;
  label: string;
  useForKeywords: string[];
  mood: string;
  promptConcept: string;
  colorPalette: string;
  brightness: "bright";
  emotionalTone: "peaceful_uplifting";
  mainSubjectRequired: boolean;
  practicalDailyLife: boolean;
};

export const BUDDHIST_VISUAL_CATEGORIES: Record<BuddhistVisualCategoryKey, BuddhistVisualCategory> = {
  BUDDHA_GOLDEN_ENLIGHTENMENT: {
    key: "BUDDHA_GOLDEN_ENLIGHTENMENT",
    label: "Phật vàng giác ngộ",
    useForKeywords: ["trí tuệ", "tỉnh thức", "giác ngộ", "vô thường", "lời Phật dạy", "sống chậm", "nhìn thấu", "giáo lý", "ứng dụng"],
    mood: "sáng, thiêng, ấm, khai sáng",
    promptConcept:
      "A majestic golden Shakyamuni Buddha statue as the main subject, sitting peacefully on a large lotus throne, gentle compassionate smile, eyes softly closed, large glowing golden halo behind the head, bright sunrise sky with soft white clouds, floating lotus petals, subtle incense mist, warm divine light, sacred peaceful Buddhist atmosphere, realistic cinematic style",
    colorPalette: "golden yellow, pearl white, lotus pink, clear sky blue",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  GUANYIN_WHITE_JADE_COMPASSION: {
    key: "GUANYIN_WHITE_JADE_COMPASSION",
    label: "Quan Âm ngọc trắng từ bi",
    useForKeywords: ["chữa lành", "tha thứ", "bình an", "cầu an", "mệt mỏi", "vượt qua đau khổ", "buông bỏ", "tổn thương"],
    mood: "dịu, sáng, được che chở",
    promptConcept:
      "A beautiful white jade Guanyin Bodhisattva statue as the main subject, standing gracefully on a blooming lotus, holding a sacred vase and willow branch, compassionate gentle face, soft glowing aura, bright turquoise lotus pond, clear waterfall, pink lotus flowers, white clouds, fresh uplifting Buddhist atmosphere",
    colorPalette: "white jade, turquoise, soft gold, lotus pink",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  AMITABHA_PURE_LAND_LIGHT: {
    key: "AMITABHA_PURE_LAND_LIGHT",
    label: "A Di Đà cõi sáng",
    useForKeywords: ["a di đà phật", "niệm Phật", "an lạc", "tịnh độ", "tâm thanh tịnh", "buông nhẹ", "cực lạc"],
    mood: "vàng ấm, hy vọng, an lạc",
    promptConcept:
      "A radiant Amitabha Buddha statue as the main subject, standing on a glowing golden lotus, one hand in welcoming blessing gesture, peaceful compassionate face, endless field of pink and golden lotus flowers, heavenly Pure Land garden, bright warm clouds, soft golden rays, joyful peaceful Buddhist atmosphere",
    colorPalette: "warm sunrise orange, golden light, fresh green, white clouds",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  BODHISATTVA_BRIGHT_VOW: {
    key: "BODHISATTVA_BRIGHT_VOW",
    label: "Bồ Tát hạnh nguyện",
    useForKeywords: ["làm thiện", "phát tâm", "hạnh nguyện", "giúp đời", "chuyển hóa nghiệp", "phước đức", "thiện lành"],
    mood: "cao đẹp, có lực, từ bi",
    promptConcept:
      "A noble Bodhisattva statue as the main subject, standing gracefully on a lotus platform, calm compassionate face, elegant Buddhist robes, glowing golden and white aura, bright blue sky, soft clouds, lotus petals floating, distant peaceful temple and green mountains, uplifting sacred atmosphere",
    colorPalette: "sky blue, cloud white, gentle gold, soft peach",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  LOTUS_PARADISE_PEACE: {
    key: "LOTUS_PARADISE_PEACE",
    label: "Hồ sen an nhiên",
    useForKeywords: ["bình an", "tâm tĩnh", "buông bỏ", "thiền", "sống chậm", "im lặng", "hơi thở", "chánh niệm"],
    mood: "tươi, sạch, thanh tịnh",
    promptConcept:
      "A peaceful Buddha statue as the main subject sitting on a lotus platform in the middle of a bright lotus lake, many pink and white lotus flowers, crystal clear turquoise water, soft golden morning sunlight, distant Buddhist temple, fresh peaceful atmosphere",
    colorPalette: "jade green, warm sunlight, ivory white, lotus pink",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  TEMPLE_SUNRISE_SERENITY: {
    key: "TEMPLE_SUNRISE_SERENITY",
    label: "Chùa sáng bình minh",
    useForKeywords: ["tu tập", "giới định tuệ", "thiền viện", "lời dạy mỗi ngày", "kỷ luật", "thức tỉnh", "sáng sớm", "giới luật", "sám hối"],
    mood: "ấm, thiêng, đời thường",
    promptConcept:
      "A large golden Buddha statue as the main subject in a beautiful Buddhist temple courtyard, bright sunrise behind traditional Asian temple roofs, clean stone steps, green trees, soft incense smoke, warm golden light, peaceful morning atmosphere, sacred yet fresh and uplifting",
    colorPalette: "temple red, golden bronze, green trees, bright blue sky",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  BAMBOO_MEDITATION_GREEN: {
    key: "BAMBOO_MEDITATION_GREEN",
    label: "Rừng trúc thiền định",
    useForKeywords: ["thiền", "chánh niệm", "sống chậm", "giữ tâm", "định lực", "tĩnh lặng", "hơi thở", "tập trung"],
    mood: "xanh, mát, nhẹ",
    promptConcept:
      "A serene Buddha statue meditating as the main subject inside a bright bamboo forest, soft sun rays shining through green bamboo leaves, gentle golden aura, clean natural stone path, small lotus flowers, fresh peaceful meditation atmosphere",
    colorPalette: "jade green, warm sunlight, ivory white, lotus pink",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  SKY_CLOUD_HEAVENLY_BUDDHA: {
    key: "SKY_CLOUD_HEAVENLY_BUDDHA",
    label: "Phật giữa mây trời",
    useForKeywords: ["tâm nhẹ", "vượt khổ", "hy vọng", "khai sáng", "tỉnh thức", "lời nhắn tích cực", "bắt đầu lại", "vượt qua"],
    mood: "cao, sáng, thoát tục",
    promptConcept:
      "A peaceful golden Buddha statue as the main subject above a bright sea of white clouds, clear blue sky, soft golden sunlight behind the statue, gentle glowing halo, lotus petals floating, heavenly uplifting Buddhist atmosphere, clean elegant composition",
    colorPalette: "sky blue, cloud white, gentle gold, soft peach",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  DHARMA_CITY_LIGHT: {
    key: "DHARMA_CITY_LIGHT",
    label: "Phật pháp giữa đời",
    useForKeywords: ["tiền bạc", "áp lực cuộc sống", "gia đình", "công việc", "tham sân si", "xã hội hiện đại", "giàu", "nghèo", "tham", "xã hội"],
    mood: "hiện đại, sáng, cân bằng",
    promptConcept:
      "A peaceful Buddha statue as the main subject in the foreground, calm face and soft golden aura, modern city skyline far in the background under a bright warm sunset, clean sky, gentle clouds, contrast between spiritual peace and everyday life, uplifting Buddhist atmosphere",
    colorPalette: "warm sunset orange, golden light, clean blue sky, soft white",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  SCRIPTURE_CANDLE_GOLD: {
    key: "SCRIPTURE_CANDLE_GOLD",
    label: "Kinh sách ánh nến vàng",
    useForKeywords: ["lời Phật dạy", "kinh Phật", "sám hối", "giới luật", "tụng kinh", "bài học sâu", "học Phật", "tu học"],
    mood: "ấm, tri thức, trang nghiêm",
    promptConcept:
      "A beautiful golden Buddha statue as the main subject on a clean Buddhist altar, ancient sutra scrolls and open scripture book beside it, warm candlelight, soft incense smoke, fresh lotus flowers, bright sacred golden atmosphere, peaceful and elegant",
    colorPalette: "gold, lavender, turquoise, pearl white",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  MANDALA_BRIGHT_KARMA: {
    key: "MANDALA_BRIGHT_KARMA",
    label: "Mandala nhân quả sáng",
    useForKeywords: ["nhân quả", "nghiệp", "luân hồi", "duyên", "vô minh", "chuyển nghiệp", "trí tuệ sâu", "karma", "quả báo", "nghiệp chướng"],
    mood: "sâu, sáng, huyền diệu",
    promptConcept:
      "A serene Buddha statue meditating as the main subject, bright golden mandala glowing behind the head, lotus patterns, soft turquoise and lavender light, clean cosmic sky with gentle stars, sacred geometry inspired by Buddhist art, peaceful and uplifting atmosphere, not dark",
    colorPalette: "gold, lavender, turquoise, pearl white",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  VIETNAMESE_BUDDHIST_TEMPLE: {
    key: "VIETNAMESE_BUDDHIST_TEMPLE",
    label: "Chùa Việt thanh bình",
    useForKeywords: ["phật pháp việt nam", "lễ chùa", "tu tại gia", "hiếu đạo", "cầu bình an", "cha mẹ", "gia đình", "phước báo", "hiếu thảo"],
    mood: "gần gũi, sáng, thân thuộc",
    promptConcept:
      "A peaceful golden Buddha statue as the main subject in a beautiful Vietnamese Buddhist temple courtyard, traditional red tiled roof, green Bodhi tree, clean stone floor, lotus flowers, soft incense smoke, bright morning sunlight, warm sacred atmosphere",
    colorPalette: "temple red, golden bronze, green trees, bright blue sky",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: true,
    practicalDailyLife: false,
  },
  PRACTICAL_DAILY_LIFE: {
    key: "PRACTICAL_DAILY_LIFE",
    label: "Phật pháp đời thường",
    useForKeywords: [
      "ứng dụng giáo lý", "sống an lạc mỗi ngày", "chánh niệm trong việc nhỏ",
      "giữ tâm an giữa đời thường", "một phút dừng lại", "tách trà buổi sáng",
      "phật pháp ứng dụng", "cuộc sống hàng ngày", "thực hành hàng ngày",
    ],
    mood: "ấm, gần gũi, thực tế",
    promptConcept:
      "A warm peaceful morning scene, ceramic tea cup with gentle steam on a wooden table, soft warm window light, Buddhist prayer beads resting beside the cup, a small lotus flower in a simple vase, clean warm morning atmosphere, soft golden and cream tones, mindful daily life",
    colorPalette: "warm cream, soft gold, gentle morning light, ivory white",
    brightness: "bright",
    emotionalTone: "peaceful_uplifting",
    mainSubjectRequired: false,
    practicalDailyLife: true,
  },
};

// ── Fallback category pool for unmatched topics ───────────────────────────────

export const BUDDHIST_FALLBACK_CATEGORIES: BuddhistVisualCategoryKey[] = [
  "LOTUS_PARADISE_PEACE",
  "TEMPLE_SUNRISE_SERENITY",
  "BUDDHA_GOLDEN_ENLIGHTENMENT",
  "VIETNAMESE_BUDDHIST_TEMPLE",
];

// ── Topic keyword → visual category mapping ───────────────────────────────────

type CategoryMapping = {
  keywords: string[];
  category: BuddhistVisualCategoryKey;
};

const TOPIC_TO_CATEGORY_RULES: CategoryMapping[] = [
  {
    keywords: ["buông bỏ", "tha thứ", "tổn thương", "chữa lành", "mệt mỏi", "vượt qua đau", "cầu an", "cô đơn"],
    category: "GUANYIN_WHITE_JADE_COMPASSION",
  },
  {
    keywords: ["trí tuệ", "tỉnh thức", "giác ngộ", "vô thường", "nhìn thấu", "lời Phật dạy", "ứng dụng giáo lý", "bí quyết", "giáo lý",
      // wisdom / silence / patience topic family
      "im lặng", "nhẫn nhịn", "nhẫn nại", "khiêm nhường", "tĩnh tâm", "tĩnh lặng nội tâm",
      "wisdom", "silence", "patience", "humility", "calm mind",
      "người khôn", "không tranh", "không cần giải thích", "sức mạnh thầm lặng",
      "tri tue", "im lang", "nhan nhin"],
    category: "BUDDHA_GOLDEN_ENLIGHTENMENT",
  },
  {
    keywords: ["niệm Phật", "a di đà", "cực lạc", "tịnh độ", "an lạc", "buông nhẹ"],
    category: "AMITABHA_PURE_LAND_LIGHT",
  },
  {
    keywords: ["nhân quả", "nghiệp", "luân hồi", "duyên", "quả báo", "nghiệp chướng", "chuyển nghiệp", "karma"],
    category: "MANDALA_BRIGHT_KARMA",
  },
  {
    keywords: ["thiền", "chánh niệm", "định lực", "tâm tĩnh", "sống chậm", "hơi thở", "định", "tĩnh lặng"],
    category: "BAMBOO_MEDITATION_GREEN",
  },
  {
    keywords: ["giới", "tu tập", "kỷ luật", "sám hối", "tụng kinh", "kinh Phật", "lời Phật dạy", "học Phật"],
    category: "SCRIPTURE_CANDLE_GOLD",
  },
  {
    keywords: ["cha mẹ", "hiếu", "con cái", "gia đình", "phước đức", "phước báo", "hiếu thảo", "lễ chùa"],
    category: "VIETNAMESE_BUDDHIST_TEMPLE",
  },
  {
    keywords: ["tiền", "giàu", "nghèo", "tham", "công việc", "áp lực", "tham sân si", "xã hội hiện đại"],
    category: "DHARMA_CITY_LIGHT",
  },
  {
    keywords: ["hy vọng", "vượt qua", "bắt đầu lại", "khai sáng", "tâm nhẹ", "lời nhắn tích cực"],
    category: "SKY_CLOUD_HEAVENLY_BUDDHA",
  },
  {
    keywords: ["bình an", "buông bỏ", "tâm tĩnh", "sống chậm", "im lặng nội tâm"],
    category: "LOTUS_PARADISE_PEACE",
  },
  {
    keywords: ["làm thiện", "phát tâm", "hạnh nguyện", "giúp đời", "thiện lành", "phước đức"],
    category: "BODHISATTVA_BRIGHT_VOW",
  },
  {
    keywords: ["thiền viện", "giới định tuệ", "tu tập", "sáng sớm", "bình minh chùa"],
    category: "TEMPLE_SUNRISE_SERENITY",
  },
  // Practical daily life lane — highest priority for these specific keywords
  {
    keywords: [
      "ứng dụng giáo lý phật giáo", "sống an lạc mỗi ngày", "chánh niệm trong việc nhỏ",
      "giữ tâm an giữa đời thường", "một phút dừng lại", "tách trà buổi sáng",
      "phật pháp ứng dụng đời sống", "thực hành hàng ngày",
    ],
    category: "PRACTICAL_DAILY_LIFE",
  },
];

/**
 * Determine the Buddhist visual category for a given topic/script text.
 * Returns PRACTICAL_DAILY_LIFE for daily-life topics, otherwise matches keywords,
 * then falls back to deterministic selection from BUDDHIST_FALLBACK_CATEGORIES.
 */
export function getBuddhistVisualCategory(
  topic: string,
  scriptOrHint?: string | null,
): BuddhistVisualCategoryKey {
  const combined = `${topic} ${scriptOrHint ?? ""}`.toLowerCase();

  // Check practical daily life first — it overrides all others
  const practicalRule = TOPIC_TO_CATEGORY_RULES.find((rule) => rule.category === "PRACTICAL_DAILY_LIFE");
  if (practicalRule?.keywords.some((kw) => combined.includes(kw))) {
    return "PRACTICAL_DAILY_LIFE";
  }

  // Check all rules in order (practical already checked above)
  for (const rule of TOPIC_TO_CATEGORY_RULES) {
    if (rule.category === "PRACTICAL_DAILY_LIFE") continue;
    if (rule.keywords.some((kw) => combined.includes(kw))) {
      return rule.category;
    }
  }

  // Deterministic fallback based on topic hash
  const hashVal = Array.from(topic).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0);
  return BUDDHIST_FALLBACK_CATEGORIES[hashVal % BUDDHIST_FALLBACK_CATEGORIES.length]!;
}

// ── Negative prompt (shared across all Buddhist categories) ──────────────────

export const BUDDHIST_NEGATIVE_PROMPT =
  "text, watermark, logo, low quality, blurry, dark horror atmosphere, gloomy, depressing, " +
  "scary face, angry expression, crying expression, distorted face, deformed hands, extra arms, extra fingers, " +
  "western angel, christian cross, gothic church, fantasy warrior armor, weapon, blood, fire, demon, skull, " +
  "cyberpunk neon, cartoon, anime, overexposed, oversaturated, messy composition, tiny subject, cropped head, " +
  "dark gloomy colors, cold gray-green fog, horror temple, ruined temple, sad monk, generic AI poster";

// ── Cover-safe composition (V2) ───────────────────────────────────────────────
// Upper third kept clean for cover text overlay; subject anchored to center/lower two-thirds.

export const BUDDHIST_COMPOSITION_SUFFIX =
  "vertical 9:16 portrait composition, main subject centered in lower two-thirds of frame, " +
  "large clean negative space in upper third for title text overlay, " +
  "strong clear silhouette against clean uncluttered background, " +
  "single dominant focal point, subject occupying 40-70% of frame height, " +
  "visually recognizable on mobile screen, thumbnail-safe framing, " +
  "realistic cinematic Buddhist photography, highly detailed, premium quality, " +
  "no text, no watermark, no logo, no distorted face, no extra limbs";

// ── Visual brand anchor (appended to all Buddhist prompts for channel consistency) ──
// Warm gold / jade / amber palette ties every video to the same channel aesthetic.

export const VISUAL_BRAND_ANCHOR =
  "warm gold color grade, amber sunlight, jade green accents, white incense smoke drifting, " +
  "soft sacred temple lighting, cinematic color grading, spiritual premium aesthetic";

// ── Hero subject library ──────────────────────────────────────────────────────

export const HERO_SUBJECT_LIBRARY = {
  buddha_statue:     "a majestic golden Buddha statue",
  guanyin:           "a serene white jade Guanyin Bodhisattva statue",
  elder_monk:        "a peaceful elderly Vietnamese monk in saffron robes",
  young_novice:      "a young novice monk in golden saffron robes",
  lotus_flower:      "a large blooming pink lotus flower",
  bodhi_tree:        "an ancient Bodhi tree with golden sunlit leaves",
  temple_bell:       "a large ornate bronze temple bell",
  incense_altar:     "a glowing Buddhist altar with rising incense smoke",
  temple_corridor:   "a sunlit Buddhist temple corridor with stone pillars",
  mountain_temple:   "a misty mountain Buddhist temple at sunrise",
} as const;

export type HeroSubjectKey = keyof typeof HERO_SUBJECT_LIBRARY;

// Maps each visual category to its primary hero subject for tracking + prompt anchoring.

export const CATEGORY_HERO_MAP: Record<BuddhistVisualCategoryKey, HeroSubjectKey> = {
  BUDDHA_GOLDEN_ENLIGHTENMENT:   "buddha_statue",
  GUANYIN_WHITE_JADE_COMPASSION: "guanyin",
  AMITABHA_PURE_LAND_LIGHT:      "buddha_statue",
  BODHISATTVA_BRIGHT_VOW:        "buddha_statue",
  LOTUS_PARADISE_PEACE:          "lotus_flower",
  TEMPLE_SUNRISE_SERENITY:       "temple_corridor",
  BAMBOO_MEDITATION_GREEN:       "elder_monk",
  SKY_CLOUD_HEAVENLY_BUDDHA:     "buddha_statue",
  DHARMA_CITY_LIGHT:             "buddha_statue",
  SCRIPTURE_CANDLE_GOLD:         "incense_altar",
  MANDALA_BRIGHT_KARMA:          "buddha_statue",
  VIETNAMESE_BUDDHIST_TEMPLE:    "temple_bell",
  PRACTICAL_DAILY_LIFE:          "incense_altar",
};

export function getHeroSubjectForCategory(categoryKey: BuddhistVisualCategoryKey): HeroSubjectKey {
  return CATEGORY_HERO_MAP[categoryKey];
}

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Build a complete Buddhist image generation prompt for a given category.
 * Uses the category's `promptConcept` and appends composition rules.
 * Safe for fal.ai / Flux models.
 */
export function buildBuddhistImagePrompt(
  categoryKey: BuddhistVisualCategoryKey,
  topicHint?: string,
): string {
  const category = BUDDHIST_VISUAL_CATEGORIES[categoryKey];
  const concept = category.promptConcept;

  // For practical daily life, vary slightly based on topic hint
  let conceptFinal = concept;
  if (categoryKey === "PRACTICAL_DAILY_LIFE" && topicHint) {
    const lowerHint = topicHint.toLowerCase();
    if (/thiền|chánh niệm|hơi thở/.test(lowerHint)) {
      conceptFinal =
        "A peaceful morning meditation scene, person sitting quietly by a window with warm sunlight, " +
        "a simple wooden tray with a tea cup, clean room with soft light, Buddhist prayer beads nearby, " +
        "warm golden and ivory tones, calm and grounded daily life practice";
    } else if (/trà|tách trà|uống trà/.test(lowerHint)) {
      conceptFinal =
        "A warm ceramic tea cup with gentle steam on a clean wooden table, morning window light, " +
        "Buddhist prayer beads gently resting beside the cup, a small lotus flower in a simple vase, " +
        "soft warm cream and gold tones, peaceful daily Buddhist practice";
    }
  }

  return [
    conceptFinal,
    `color palette: ${category.colorPalette}`,
    VISUAL_BRAND_ANCHOR,
    BUDDHIST_COMPOSITION_SUFFIX,
  ].join(", ");
}

/**
 * Metadata to attach to sidecar / promptVersions for Content Intelligence.
 */
export type BuddhistVisualMetadata = {
  buddhistVisualCategory: BuddhistVisualCategoryKey;
  buddhistVisualCategoryLabel: string;
  visualBrightness: "bright";
  emotionalTone: "peaceful_uplifting";
  visualPromptVersion: typeof BUDDHIST_VISUAL_PROMPT_VERSION;
  visualStyle: typeof BUDDHIST_VISUAL_STYLE;
  practicalDailyLifeVisual: boolean;
  colorPalette: string;
};

export function buildBuddhistVisualMetadata(categoryKey: BuddhistVisualCategoryKey): BuddhistVisualMetadata {
  const category = BUDDHIST_VISUAL_CATEGORIES[categoryKey];
  return {
    buddhistVisualCategory: categoryKey,
    buddhistVisualCategoryLabel: category.label,
    visualBrightness: "bright",
    emotionalTone: "peaceful_uplifting",
    visualPromptVersion: BUDDHIST_VISUAL_PROMPT_VERSION,
    visualStyle: BUDDHIST_VISUAL_STYLE,
    practicalDailyLifeVisual: category.practicalDailyLife,
    colorPalette: category.colorPalette,
  };
}

/**
 * Guard: validate that a set of prompt fragments complies with Buddhist V1 guardrails.
 * Returns warnings (not hard failures) for Content Intelligence.
 */
export function validateBuddhistPromptGuardrails(prompt: string): string[] {
  const warnings: string[] = [];
  const lower = prompt.toLowerCase();
  if (!/9:16/.test(lower) && !/vertical/.test(lower)) {
    warnings.push("missing_vertical_9_16");
  }
  if (/no text|no watermark/.test(lower) === false) {
    warnings.push("missing_no_text_rule");
  }
  const darkSignals = ["dark horror", "gloomy", "depressing", "gothic", "skull", "demon", "blood", "ruined"];
  if (darkSignals.some((s) => lower.includes(s))) {
    warnings.push("dark_content_detected");
  }
  return warnings;
}
