export const DEFAULT_CONTENT_PROFILE_KEY = "buddhism" as const;

export const CONTENT_PROFILE_KEYS = [
  DEFAULT_CONTENT_PROFILE_KEY,
  "psychology",
  "philosophy",
] as const;

export type ContentProfileKey = (typeof CONTENT_PROFILE_KEYS)[number];
export type CanonicalContentProfileKey = "buddhism" | "psychology";

export type ContentProfileStatus = "active" | "draft";

export type KeywordRule = {
  label: string;
  keywords: string[];
};

export type ContentProfileConfig = {
  key: CanonicalContentProfileKey;
  label: string;
  description: string;
  status: ContentProfileStatus;
  defaultNicheName: string;
  defaultNicheDescription: string;
  defaultTone: string;
  shortCta: string | null;
  requireShortCta: boolean;
  allowedPronouns: string[];
  bannedOpenings: string[];
  genericAiPhrases: string[];
  forbiddenScriptTerms: string[];
  preachyPhrases: string[];
  forbiddenImageTerms: string[];
  hookPatterns: string[];
  hookExamples: string[];
  hookFallbackMarkers: {
    curiosity: string[];
    emotion: string[];
    relatability: string[];
    retention: string[];
  };
  shortImageStylePresets: Record<string, string>;
  shortImageDefaultStyle: string;
  longImageStylePresets: Record<string, string>;
  longImageDefaultStyle: string;
  thumbnailStylePresets: Record<string, string>;
  thumbnailDefaultStyle: string;
  youtubeBaseTags: string[];
  facebookHashtags: string[];
  shortDescriptionCta: string | null;
  defaultQuoteFallback: string;
  analyticsEmotionalAngleRules: KeywordRule[];
  analyticsTopicClusterRules: KeywordRule[];
};

// BUDDHIST_VISUAL_V1 — bright, sacred, uplifting, clearly Buddhist
const BUDDHIST_SHORT_IMAGE_STYLES = {
  serene_buddha_light: "majestic golden Shakyamuni Buddha statue as main subject, large golden halo, lotus throne, warm sunrise sky, floating lotus petals, ivory and gold tones, subject 60% frame, vertical 9:16, bright uplifting, highly detailed",
  lotus_temple_sunrise: "peaceful Buddha statue in bright temple courtyard at sunrise, warm golden morning light, lotus pond with pink blossoms, soft pastel sky, calm reflective water, subject clearly visible, vertical 9:16, bright and healing, highly detailed",
  warm_monastery_peace: "large golden Buddha statue as main subject in monastery courtyard at dawn, warm amber sunlight, green bamboo grove, bright tranquil atmosphere, compassionate mood, subject 60% frame, vertical 9:16, highly detailed",
} as const;

const PSYCHOLOGY_SHORT_IMAGE_STYLES = {
  cinematic: "soft cinematic lighting, modern urban realism, emotional facial expression, shallow depth of field, 35mm photograph, natural skin tones, subtle color contrast, highly detailed",
  editorial: "modern editorial photography, Vietnamese or Asian young adult, quiet tension, realistic body language, clean composition, contemporary lifestyle magazine look",
  moody: "night city atmosphere, soft neon reflections, low-key lighting, intimate urban realism, muted blue and amber palette, emotionally sharp, photorealistic",
} as const;

// BUDDHIST_VISUAL_V1 long — bright, spacious, clearly Buddhist, cinematic
const BUDDHIST_LONG_IMAGE_STYLES = {
  serene_buddha_light: "majestic golden Buddha statue as prominent main subject, radiant warm halo, wide peaceful temple garden, warm golden light rays, lotus blossoms, ivory and gold tones, cinematic widescreen, bright and uplifting, highly detailed",
  lotus_temple_sunrise: "sweeping Buddhist temple landscape at sunrise, large golden Buddha statue visible, warm golden morning light, lotus pond with pink blossoms, soft pastel sky, calm reflective water, cinematic wide angle, bright and healing, highly detailed",
  warm_monastery_peace: "panoramic Vietnamese Buddhist temple courtyard at dawn, large golden Buddha statue as focal point, warm amber sunlight, green bamboo groves, bright tranquil atmosphere, cinematic depth, highly detailed",
} as const;

const PSYCHOLOGY_LONG_IMAGE_STYLES = {
  cinematic: "cinematic widescreen realism, urban Vietnamese atmosphere, soft practical lighting, emotional tension, modern city palette, natural skin tones",
  editorial: "premium editorial lifestyle photography, contemporary architecture, realistic young adults, restrained color palette, subtle melancholy, highly detailed",
  nocturne: "night street realism, rain reflections, moody city depth, soft neon and tungsten light, intimate emotional framing, cinematic contrast",
} as const;

// BUDDHIST_VISUAL_V1 thumbnails — bright sacred uplifting, strong subject
const BUDDHIST_THUMBNAIL_STYLES = {
  dramatic: "majestic golden Buddha statue as main subject (70% frame), warm bright cinematic lighting, vivid warm saturated gold and lotus pink, sacred glowing halo, uplifting heroic scale, photorealistic, ultra-detailed, 8K HDR, bright not dark",
  mystical: "radiant golden Buddha with divine golden glow, celestial light rays, bright heavenly luminescence, lotus flowers, crystal clear atmosphere, sacred and uplifting, dreamlike but bright, hyper-detailed",
  painterly: "large golden Buddha statue as focal point, classical warm oil painting style, rich amber gold and lotus pink tones, museum masterpiece quality, lush bright sacred colors, uplifting composition",
  vivid: "golden Buddha statue as main subject, hyperreal vivid warm colors, ultra-sharp clarity, golden yellow and lotus pink and sky blue palette, striking bold bright palette, sacred and modern, 8K HDR",
} as const;

const PSYCHOLOGY_THUMBNAIL_STYLES = {
  dramatic: "sharp cinematic portrait lighting, high emotional contrast, realistic skin texture, contemporary urban mood, photorealistic, ultra-detailed",
  editorial: "clean editorial cover style, modern typography-safe composition, intimate facial expression, soft but crisp lighting, magazine-quality realism",
  nocturne: "moody night-city realism, blue and amber highlights, reflective surfaces, subtle neon accents, emotionally tense, photorealistic",
  minimal: "minimal modern composition, one dominant subject, restrained colors, quiet confidence, crisp contrast, high clarity at small size",
} as const;

const PSYCHOLOGY_PROFILE: ContentProfileConfig = {
  key: "psychology",
  label: "Psychology",
  description: "psychology, relationships, maturity, human behavior",
  status: "draft",
  defaultNicheName: "Tầng Sâu",
  defaultNicheDescription: "Nội dung tâm lý học, quan hệ, trưởng thành và hành vi con người",
  defaultTone: "Hiện đại, ngắn gọn, sắc nhưng không dạy đời",
  shortCta: null,
  requireShortCta: false,
  allowedPronouns: ["bạn", "nhiều người", "người ta"],
  bannedOpenings: [
    "trong cuộc sống",
    "chúng ta thường",
    "hôm nay",
    "trong video này",
    "đây là",
    "tha thứ là",
    "nỗi sợ hãi là",
    "quý vị",
  ],
  genericAiPhrases: [
    "trong cuộc sống này",
    "một bài học sâu sắc",
    "chúng ta hãy cùng",
    "ở video này",
    "có lẽ bạn sẽ nhận ra",
    "hành trình khám phá",
    "bí quyết",
    "nghệ thuật",
    "khám phá sâu hơn",
    "quý vị thân mến",
    "năng lượng vũ trụ",
    "sứ mệnh của bạn",
  ],
  forbiddenScriptTerms: [
    "phật",
    "đức phật",
    "phật pháp",
    "nghiệp",
    "nhân quả",
    "luân hồi",
    "giác ngộ",
    "quý vị",
    "a di đà phật",
    "sư thầy",
    "chùa",
    "kinh",
    "tụng",
  ],
  preachyPhrases: [
    "bạn phải",
    "nhất định phải",
    "đây là bài học",
    "hãy nhớ lấy",
    "muốn hạnh phúc thì",
    "đó là chân lý",
  ],
  forbiddenImageTerms: [
    "monk",
    "monks",
    "temple",
    "temples",
    "lotus",
    "buddha",
    "buddhist",
    "prayer beads",
    "monastery",
    "altar",
    "incense",
    "karma",
    "rebirth",
    "heaven",
    "hell",
    "pagoda",
  ],
  hookPatterns: [
    "Có một kiểu người...",
    "Bạn có để ý không...",
    "Người càng trưởng thành càng...",
    "Đây là lý do...",
    "Nếu bạn từng cảm thấy...",
    "Không phải ai im lặng cũng yếu đuối...",
    "Một dấu hiệu rất nhỏ cho thấy...",
  ],
  hookExamples: [
    "Có một kiểu người càng tử tế càng dễ bị lợi dụng.",
    "Bạn có để ý không, người ổn nhất thường là người nói ít nhất.",
    "Người càng trưởng thành càng ít muốn giải thích.",
    "Không phải ai im lặng cũng yếu đuối, nhiều khi họ đã nhìn ra vấn đề.",
  ],
  hookFallbackMarkers: {
    curiosity: ["?", "vì sao", "đây là lý do", "có để ý", "dấu hiệu", "thật ra", "không phải"],
    emotion: ["cô đơn", "tổn thương", "im lặng", "mệt", "lợi dụng", "thao túng", "khó chịu", "bị bỏ rơi"],
    relatability: ["bạn", "nhiều người", "người ta", "từng", "có để ý", "đã từng", "thường"],
    retention: ["nhưng", "lại", "thật ra", "không phải", "đó là vì", "đôi khi", "càng"],
  },
  shortImageStylePresets: PSYCHOLOGY_SHORT_IMAGE_STYLES,
  shortImageDefaultStyle: PSYCHOLOGY_SHORT_IMAGE_STYLES.cinematic,
  longImageStylePresets: PSYCHOLOGY_LONG_IMAGE_STYLES,
  longImageDefaultStyle: PSYCHOLOGY_LONG_IMAGE_STYLES.cinematic,
  thumbnailStylePresets: PSYCHOLOGY_THUMBNAIL_STYLES,
  thumbnailDefaultStyle: PSYCHOLOGY_THUMBNAIL_STYLES.editorial,
  youtubeBaseTags: [
    "shorts",
    "tamly",
    "moiquanhe",
    "truongthanh",
    "ranhgioi",
    "trituetinhcam",
    "hanhviconnguoi",
    "tinhcam",
    "tinhthan",
    "selfawareness",
  ],
  facebookHashtags: ["#tamly", "#moiquanhe", "#truongthanh", "#ranhgioi", "#hanhviconnguoi"],
  shortDescriptionCta: null,
  defaultQuoteFallback: "Đôi khi điều khiến bạn mệt nhất không phải người khác, mà là cách bạn cố gắng giữ mọi thứ ổn định.",
  analyticsEmotionalAngleRules: [
    { label: "cô đơn và mất kết nối", keywords: ["cô đơn", "lạc lõng", "xa cách", "không được hiểu"] },
    { label: "ranh giới và tự trọng", keywords: ["ranh giới", "tự trọng", "giải thích", "làm hài lòng"] },
    { label: "thao túng và kiểm soát", keywords: ["thao túng", "kiểm soát", "gaslight", "lợi dụng"] },
    { label: "trưởng thành cảm xúc", keywords: ["trưởng thành", "cảm xúc", "điềm tĩnh", "im lặng"] },
    { label: "quan hệ và khoảng cách", keywords: ["mối quan hệ", "xa cách", "chia tay", "im lặng", "lạnh nhạt"] },
  ],
  analyticsTopicClusterRules: [
    { label: "Loneliness and Distance", keywords: ["cô đơn", "xa cách", "lạc lõng", "không được hiểu"] },
    { label: "Boundaries and Self-Respect", keywords: ["ranh giới", "tự trọng", "giải thích", "chiều lòng", "lợi dụng"] },
    { label: "Manipulation and Control", keywords: ["thao túng", "kiểm soát", "gaslight", "tội lỗi", "đổ lỗi"] },
    { label: "Maturity and Quiet Confidence", keywords: ["trưởng thành", "im lặng", "điềm tĩnh", "bản lĩnh", "bình tĩnh"] },
    { label: "Relationships and Pressure", keywords: ["mối quan hệ", "tình yêu", "áp lực", "phán xét", "so sánh"] },
    { label: "Emotional Intelligence", keywords: ["cảm xúc", "tự nhận thức", "thấu hiểu", "phản ứng", "tổn thương"] },
  ],
};

export const CONTENT_PROFILES: Record<ContentProfileKey, ContentProfileConfig> = {
  buddhism: {
    key: "buddhism",
    label: "Buddhism",
    description: "Phat phap, chua lanh, chiem nghiem doi song",
    status: "active",
    defaultNicheName: "Phật Pháp",
    defaultNicheDescription: "Nội dung Phật pháp và chữa lành",
    defaultTone: "Trầm tĩnh, từng trải, gần gũi",
    shortCta: null,
    requireShortCta: false,
    allowedPronouns: ["quý vị", "chúng ta", "người ta"],
    bannedOpenings: [
      "trong cuộc sống",
      "chúng ta thường",
      "hôm nay",
      "trong video này",
      "bạn có biết",
      "tha thứ là",
      "nỗi sợ hãi là",
      "đây là",
    ],
    genericAiPhrases: [
      "trong cuộc sống này",
      "một bài học sâu sắc",
      "chúng ta hãy cùng",
      "ở video này",
      "có lẽ bạn sẽ nhận ra",
      "hành trình khám phá",
      "bí quyết",
      "nghệ thuật",
      "khám phá sâu hơn",
      "quý vị thân mến",
    ],
    forbiddenScriptTerms: [],
    preachyPhrases: [],
    forbiddenImageTerms: [],
    hookPatterns: [
      "Một sự thật khiến người nghe giật mình",
      "Một điều tiếc nuối mà nhiều người từng trải qua",
      "Một tình huống rất đời thường",
      "Một nghịch lý trong cuộc sống",
      "Một câu khiến người nghe thấy bản thân trong đó",
    ],
    hookExamples: [
      "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu.",
      "Có những thứ người ta mang theo cả đời mà không nhận ra.",
      "Điều khiến nhiều người khổ nhất lại không nằm ở hoàn cảnh.",
      "Càng lớn tuổi, quý vị càng hiểu giá trị của sự im lặng.",
    ],
    hookFallbackMarkers: {
      curiosity: ["?", "đừng", "quên", "muộn", "giữ", "vì sao", "điều gì", "càng"],
      emotion: ["đau", "khổ", "sợ", "hận", "buồn", "nhẹ", "mất", "cô đơn", "tổn thương", "day dứt"],
      relatability: ["người ta", "quý vị", "có những", "càng lớn", "nhiều người", "chúng ta"],
      retention: ["nhưng", "lại", "đôi khi", "có thể", "thường", "chỉ vì", "không phải"],
    },
    shortImageStylePresets: BUDDHIST_SHORT_IMAGE_STYLES,
    shortImageDefaultStyle: BUDDHIST_SHORT_IMAGE_STYLES.serene_buddha_light,
    longImageStylePresets: BUDDHIST_LONG_IMAGE_STYLES,
    longImageDefaultStyle: BUDDHIST_LONG_IMAGE_STYLES.serene_buddha_light,
    thumbnailStylePresets: BUDDHIST_THUMBNAIL_STYLES,
    thumbnailDefaultStyle: BUDDHIST_THUMBNAIL_STYLES.dramatic,
    youtubeBaseTags: [
      "shorts",
      "phatphap",
      "loiphatday",
      "chualanh",
      "buongxa",
      "nhanqua",
      "vothuong",
      "binhan",
      "chiemnghiem",
      "songdep",
    ],
    facebookHashtags: ["#phatphap", "#chualanh", "#binhan"],
    shortDescriptionCta: "Theo doi kenh de xem them video cung chu de.",
    defaultQuoteFallback: "Mỗi ngày là một cơ hội để quán chiếu sâu hơn về {{topic}}.",
    analyticsEmotionalAngleRules: [
      { label: "sợ hãi và bất an", keywords: ["sợ", "bất an", "lo", "lo âu", "vô vọng"] },
      { label: "buông bỏ và tha thứ", keywords: ["buông", "tha thứ", "oán hận", "chấp niệm"] },
      { label: "vô thường và mất mát", keywords: ["vô thường", "chia ly", "mất", "lãng quên"] },
      { label: "tự chữa lành", keywords: ["chữa lành", "bình an", "tự ti", "tổn thương"] },
      { label: "nhân quả và tỉnh thức", keywords: ["nhân quả", "nghiệp", "tỉnh thức", "giác ngộ"] },
    ],
    analyticsTopicClusterRules: [
      { label: "Sợ hãi và bất an", keywords: ["sợ", "bất an", "lo", "hoang mang", "vô vọng"] },
      { label: "Tổn thương và chữa lành", keywords: ["tổn thương", "chữa lành", "tự ti", "cô đơn", "bị hiểu lầm"] },
      { label: "Buông bỏ và tha thứ", keywords: ["buông", "tha thứ", "oán hận", "tiếc nuối", "mất mát"] },
      { label: "Nhân quả và nghiệp lực", keywords: ["nhân quả", "nghiệp", "nghiệp chướng", "sám hối"] },
      { label: "Thiền định và tĩnh lặng", keywords: ["thiền", "tĩnh lặng", "im lặng", "hơi thở", "tỉnh thức"] },
      { label: "Bản ngã và nhận thức", keywords: ["bản ngã", "định kiến", "nhận thức", "tâm thức", "trực giác"] },
      { label: "Quan hệ và xung đột", keywords: ["mối quan hệ", "xung đột", "bỏ rơi", "phán xét", "ganh đua"] },
      { label: "Vô thường và chia ly", keywords: ["vô thường", "chia ly", "lãng quên", "già", "thay đổi"] },
    ],
  },
  psychology: PSYCHOLOGY_PROFILE,
  philosophy: PSYCHOLOGY_PROFILE,
};

export function normalizeContentProfileKey(
  value: string | null | undefined,
): ContentProfileKey | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  return CONTENT_PROFILE_KEYS.find((key) => key === normalized) ?? null;
}

export function resolveContentProfileKey(
  value: string | null | undefined,
): ContentProfileKey {
  return normalizeContentProfileKey(value) ?? DEFAULT_CONTENT_PROFILE_KEY;
}

export function getContentProfile(
  value: string | null | undefined,
): ContentProfileConfig {
  return CONTENT_PROFILES[resolveContentProfileKey(value)];
}

export function findForbiddenProfileTerms(
  profileKeyValue: string | null | undefined,
  text: string,
  field: "script" | "image" = "script",
): string[] {
  const profile = getContentProfile(profileKeyValue);
  const source = text.toLowerCase();
  const terms = field === "image" ? profile.forbiddenImageTerms : profile.forbiddenScriptTerms;
  return terms.filter((term) => source.includes(term.toLowerCase()));
}

export function findPreachyProfilePhrases(
  profileKeyValue: string | null | undefined,
  text: string,
): string[] {
  const profile = getContentProfile(profileKeyValue);
  const source = text.toLowerCase();
  return profile.preachyPhrases.filter((term) => source.includes(term.toLowerCase()));
}
