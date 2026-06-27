import { FORMAT_TYPE_LABELS, type ContentFormatType } from "@/lib/content-format-type";
import { STRATEGIC_TOPIC_FAMILIES } from "@/lib/config/topic-family-registry";

export type PromptFieldClass = "fixed" | "editable";

export type PromptFieldDefinition = {
  id: string;
  label: string;
  class: PromptFieldClass;
  description: string;
};

export type PlatformProfile = {
  id: string;
  name: string;
  label: string;
  note: string;
  safetyRules: string[];
};

export type ChannelProfile = {
  id: string;
  channelName: string;
  label: string;
  niche: string;
  tone: string[];
  vocabulary: string[];
  avoid: string[];
  preferredTopicFamilyIds: string[];
  defaultAudienceProfile: string;
  notes: string;
};

export type ContentFormatProfile = {
  id: ContentFormatType;
  label: string;
  description: string;
  fixedRules: string[];
  editableLevers: string[];
};

export type TopicFamilyProfile = {
  id: string;
  label: string;
  description: string;
  channels: string[];
  exampleTopics: string[];
};

export type PromptVariant = {
  id: string;
  label: string;
  description: string;
  templateId: string;
  experimentVariant?: string;
  channelProfileIds: string[];
};

export type PromptTemplate = {
  id: string;
  label: string;
  stage: string;
  description: string;
  formatIds: ContentFormatType[];
  platformIds: string[];
  fixedFieldIds: string[];
  editableFieldIds: string[];
  variantIds: string[];
};

export type PromptOption = {
  id: string;
  label: string;
  description: string;
  channelProfileIds?: string[];
};

export type AudienceProfileConfig = {
  id: string;
  label: string;
  channelProfileId: string;
  audienceDescription: string;
  ageRange?: string;
  audiencePainPoints: string[];
  audienceDesires: string[];
  tonePreference: string[];
  visualPreference: string[];
  avoidedTone: string[];
  avoidedVisuals: string[];
  bestKnownAngles: string[];
  experimentalAngles: string[];
};

export type PromptOptionGroup = {
  id: string;
  label: string;
  description: string;
  options: PromptOption[];
};

export const PROMPT_HIERARCHY = [
  "Global",
  "Platform",
  "Channel",
  "Format",
  "Topic Family",
  "Template",
  "Variant",
] as const;

export const PROMPT_FIELDS: PromptFieldDefinition[] = [
  {
    id: "json_schema",
    label: "JSON schema",
    class: "fixed",
    description: "Shape output để parse an toàn, không cho creative prompt tự đổi cấu trúc.",
  },
  {
    id: "output_length",
    label: "Output length",
    class: "fixed",
    description: "Giới hạn độ dài, duration window, line count và token budget kỹ thuật.",
  },
  {
    id: "no_markdown_separators",
    label: "No markdown separators",
    class: "fixed",
    description: "Không cho phép `---`, `***`, `___` để tránh lỗi TTS/subtitle.",
  },
  {
    id: "quote_no_hashtags",
    label: "No hashtags inside quote",
    class: "fixed",
    description: "Quote text không chèn hashtag để tránh làm bẩn visual và caption flow.",
  },
  {
    id: "validation_constraints",
    label: "Validation constraints",
    class: "fixed",
    description: "Các rule như subtitle health, caption safety, retry guard, no orphan tail.",
  },
  {
    id: "platform_safety_rules",
    label: "Platform safety rules",
    class: "fixed",
    description: "Rule riêng cho YouTube/Facebook như upload safety, queue, caption bounds.",
  },
  {
    id: "tone",
    label: "Tone",
    class: "editable",
    description: "Giọng điệu như calm, contemplative, modern, compassionate.",
  },
  {
    id: "hook_style",
    label: "Hook style",
    class: "editable",
    description: "Kiểu mở đầu: curiosity, contradiction, warning, emotional statement.",
  },
  {
    id: "quote_style",
    label: "Quote style",
    class: "editable",
    description: "Cách viết quote: meditative, sharp, modern reflective, healing.",
  },
  {
    id: "topic_angle",
    label: "Topic angle",
    class: "editable",
    description: "Góc khai thác chủ đề theo channel hoặc topic family.",
  },
  {
    id: "audience",
    label: "Audience",
    class: "editable",
    description: "Nhóm người xem chính và ngôn ngữ phù hợp với họ.",
  },
  {
    id: "visual_mood",
    label: "Visual mood",
    class: "editable",
    description: "Mood nền ảnh/video như warm temple, blue solitude, editorial stillness.",
  },
  {
    id: "music_mood",
    label: "Music mood",
    class: "editable",
    description: "Màu nhạc nền: meditative, reflective, ambient, gentle piano.",
  },
  {
    id: "cta_style",
    label: "CTA style",
    class: "editable",
    description: "Độ mạnh/yếu của CTA và cách dẫn ra hành động tiếp theo.",
  },
  {
    id: "experiment_variant",
    label: "Experiment variant",
    class: "editable",
    description: "Biến thể phục vụ A/B testing hoặc channel-specific prompt tuning.",
  },
];

export const PLATFORM_PROFILES: PlatformProfile[] = [
  {
    id: "youtube_shorts",
    name: "YouTube Shorts",
    label: "YouTube Shorts",
    note: "Stop-scroll nhanh, hook rõ, retention đầu video quan trọng.",
    safetyRules: ["queue_only", "scheduled_at_future", "no_manual_upload_from_ui"],
  },
  {
    id: "facebook_reels",
    name: "Facebook Reels",
    label: "Facebook Reels",
    note: "Nên tối ưu caption và batch timing, token health riêng.",
    safetyRules: ["queue_only", "facebook_token_health", "no_manual_upload_from_ui"],
  },
  {
    id: "facebook_quote_photo",
    name: "Facebook Quote/Photo",
    label: "Facebook Quote/Photo",
    note: "Ảnh quote premium, caption gọn, không cắt cụt giữa câu.",
    safetyRules: ["safe_caption_builder", "enhanced_image_required", "queue_only"],
  },
  {
    id: "youtube_long",
    name: "YouTube Long",
    label: "YouTube Long",
    note: "Cần narrative structure và chapter logic tốt hơn short.",
    safetyRules: ["outline_first", "section_validation", "upload_queue_only"],
  },
];

export const CHANNEL_PROFILES: ChannelProfile[] = [
  {
    id: "buddhist_healing_v1",
    channelName: "Giới Định Tuệ / Trí Tuệ An Nhiên",
    label: "Buddhist Healing v1",
    niche: "Buddhist healing, mindfulness, karma, letting go",
    tone: ["calm", "compassionate", "reflective"],
    vocabulary: ["nhân quả", "buông bỏ", "bình an", "chánh niệm", "từ bi"],
    avoid: ["sensational claims", "aggressive CTA"],
    preferredTopicFamilyIds: [
      "peace_mindfulness",
      "letting_go_forgiveness",
      "fear_anxiety",
      "karma",
      "hurt_loneliness",
      "buddhist_life_wisdom",
    ],
    defaultAudienceProfile: "healing_seekers",
    notes: "Giữ chất chữa lành, mềm, không giật gân quá đà.",
  },
  {
    id: "tang_sau_v1",
    channelName: "Tầng sâu",
    label: "Tầng sâu v1",
    niche: "Philosophy, books, psychology, inner life, modern loneliness",
    tone: ["deep", "concise", "contemplative", "modern"],
    vocabulary: ["im lặng", "chiều sâu", "tự do nội tâm", "cô đơn", "ý nghĩa", "lựa chọn", "bản ngã"],
    avoid: ["overusing quý vị", "explicit Buddhist framing", "preachy religious wording"],
    preferredTopicFamilyIds: [
      "modern_loneliness",
      "identity_choice",
      "inner_freedom",
      "books_philosophy",
      "meaning_silence",
    ],
    defaultAudienceProfile: "modern_reflective",
    notes: "Ưu tiên ngôn ngữ đời sống, triết nhẹ, hiện đại, ít màu tôn giáo trực diện.",
  },
];

export const CONTENT_FORMAT_PROFILES: ContentFormatProfile[] = [
  {
    id: "tts_short",
    label: FORMAT_TYPE_LABELS.tts_short,
    description: "Short có TTS, subtitle, image/video render từ pipeline chính.",
    fixedRules: ["output_length", "no_markdown_separators", "validation_constraints"],
    editableLevers: ["tone", "hook_style", "topic_angle", "cta_style", "visual_mood"],
  },
  {
    id: "legacy_quote_short",
    label: FORMAT_TYPE_LABELS.legacy_quote_short,
    description: "Short quote không TTS, có nhạc nền, visual motion, typography sạch.",
    fixedRules: ["quote_no_hashtags", "validation_constraints", "platform_safety_rules"],
    editableLevers: ["quote_style", "visual_mood", "music_mood", "audience", "experiment_variant"],
  },
  {
    id: "long_video",
    label: FORMAT_TYPE_LABELS.long_video,
    description: "Long-form video với outline, sections, metadata, thumbnail intent.",
    fixedRules: ["json_schema", "validation_constraints", "platform_safety_rules"],
    editableLevers: ["tone", "topic_angle", "audience", "cta_style", "hook_style"],
  },
  {
    id: "facebook_quote_photo",
    label: FORMAT_TYPE_LABELS.facebook_quote_photo,
    description: "Bài ảnh/quote Facebook với caption an toàn và image enhancer.",
    fixedRules: ["quote_no_hashtags", "platform_safety_rules", "validation_constraints"],
    editableLevers: ["quote_style", "visual_mood", "audience", "cta_style"],
  },
];

// Buddhist healing families come from the central strategic registry.
// Tang Sau families are defined inline — they are not Buddhist strategic families.
export const TOPIC_FAMILIES: TopicFamilyProfile[] = [
  // ── Buddhist healing: derived from strategic registry (excludes needs_review) ──
  ...STRATEGIC_TOPIC_FAMILIES
    .filter((f) => f.id !== "needs_topic_family_review" && f.channels.includes("buddhist_healing_v1"))
    .map((f) => ({
      id: f.id,
      label: f.name,
      description: f.description,
      channels: f.channels,
      exampleTopics: f.angles.slice(0, 2),
    })),
  {
    id: "modern_loneliness",
    label: "Cô đơn hiện đại",
    description: "Cô đơn giữa đám đông, cảm giác lạc lõng, sống nhanh mà rỗng.",
    channels: ["tang_sau_v1"],
    exampleTopics: ["Có những người nói rất nhiều nhưng không ai thực sự hiểu họ"],
  },
  {
    id: "identity_choice",
    label: "Bản ngã · Lựa chọn",
    description: "Bản ngã, lựa chọn sống, cách ta tự định nghĩa mình.",
    channels: ["tang_sau_v1"],
    exampleTopics: ["Điều khó nhất không phải chọn đúng mà là dám chịu trách nhiệm"],
  },
  {
    id: "inner_freedom",
    label: "Tự do nội tâm",
    description: "Thoát khỏi ám ảnh phải vừa lòng người khác, tìm tự do bên trong.",
    channels: ["tang_sau_v1"],
    exampleTopics: ["Tự do nhất là khi không còn phải đóng vai ai nữa"],
  },
  {
    id: "books_philosophy",
    label: "Sách · Triết lý",
    description: "Góc nhìn từ sách, triết học, đời sống tinh thần và những câu hỏi lớn.",
    channels: ["tang_sau_v1"],
    exampleTopics: ["Có những cuốn sách không trả lời mà chỉ buộc ta tự nhìn lại mình"],
  },
  {
    id: "meaning_silence",
    label: "Im lặng · Ý nghĩa",
    description: "Khoảng lặng, ý nghĩa sống, chiều sâu của việc dừng lại đúng lúc.",
    channels: ["tang_sau_v1"],
    exampleTopics: ["Không phải im lặng nào cũng là trống rỗng"],
  },
];

export const PROMPT_VARIANTS: PromptVariant[] = [
  {
    id: "quote_meditative_buddhist",
    label: "Quote meditative",
    description: "Ấm, chậm, chữa lành, nhiều không khí bình an.",
    templateId: "quote_short_generation",
    experimentVariant: "LEGACY_QUOTE_NO_VOICE_V2",
    channelProfileIds: ["buddhist_healing_v1"],
  },
  {
    id: "quote_reflective_modern",
    label: "Quote reflective modern",
    description: "Ngắn, lạnh hơn một chút, hiện đại, ít màu tôn giáo trực diện.",
    templateId: "quote_short_generation",
    channelProfileIds: ["tang_sau_v1"],
  },
  {
    id: "hook_soft_curiosity",
    label: "Soft curiosity",
    description: "Hook kiểu khơi mở, không giật mạnh nhưng vẫn khiến người xem dừng lại.",
    templateId: "tts_short_hook_engine",
    channelProfileIds: ["buddhist_healing_v1", "tang_sau_v1"],
  },
  {
    id: "script_reflective_story",
    label: "Reflective story",
    description: "Script ưu tiên chiêm nghiệm đời thường và dẫn vào ý sâu.",
    templateId: "tts_short_script_engine",
    channelProfileIds: ["buddhist_healing_v1", "tang_sau_v1"],
  },
];

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "quote_short_generation",
    label: "Quote Short Generation",
    stage: "quote_short",
    description: "Sinh quote text + visual direction + music mood cho Quote Shorts.",
    formatIds: ["legacy_quote_short"],
    platformIds: ["youtube_shorts", "facebook_reels"],
    fixedFieldIds: ["output_length", "quote_no_hashtags", "validation_constraints"],
    editableFieldIds: ["quote_style", "visual_mood", "music_mood", "audience", "experiment_variant"],
    variantIds: ["quote_meditative_buddhist", "quote_reflective_modern"],
  },
  {
    id: "tts_short_hook_engine",
    label: "TTS Hook Engine",
    stage: "hook_engine",
    description: "Sinh và chấm hook cho short TTS theo topic/channel.",
    formatIds: ["tts_short"],
    platformIds: ["youtube_shorts", "facebook_reels"],
    fixedFieldIds: ["json_schema", "output_length", "validation_constraints"],
    editableFieldIds: ["hook_style", "topic_angle", "audience", "experiment_variant"],
    variantIds: ["hook_soft_curiosity"],
  },
  {
    id: "tts_short_script_engine",
    label: "TTS Script Engine",
    stage: "script_engine",
    description: "Viết script short từ hook thắng, giữ đúng duration và guard technical.",
    formatIds: ["tts_short"],
    platformIds: ["youtube_shorts", "facebook_reels"],
    fixedFieldIds: ["output_length", "no_markdown_separators", "validation_constraints"],
    editableFieldIds: ["tone", "topic_angle", "audience", "cta_style"],
    variantIds: ["script_reflective_story"],
  },
  {
    id: "long_video_generation",
    label: "Long Video Generation",
    stage: "long_video",
    description: "Outline + sections + metadata cho long video.",
    formatIds: ["long_video"],
    platformIds: ["youtube_long"],
    fixedFieldIds: ["json_schema", "validation_constraints", "platform_safety_rules"],
    editableFieldIds: ["tone", "hook_style", "topic_angle", "audience", "cta_style"],
    variantIds: [],
  },
];

export const PROMPT_OPTION_GROUPS: PromptOptionGroup[] = [
  {
    id: "topicFamily",
    label: "Topic family",
    description: "Nhóm chủ đề chính cho Quote Shorts và TTS Shorts.",
    options: TOPIC_FAMILIES.map((family) => ({
      id: family.id,
      label: family.label,
      description: family.description,
      channelProfileIds: family.channels,
    })),
  },
  {
    id: "quoteStyle",
    label: "Quote style",
    description: "Chất câu quote cho short không TTS.",
    options: [
      { id: "meditative", label: "Meditative", description: "Ấm, mềm, ít sắc cạnh.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "healing", label: "Healing", description: "Dịu, xoa dịu tổn thương.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "reflective_modern", label: "Reflective modern", description: "Ngắn, hiện đại, có chiều sâu.", channelProfileIds: ["tang_sau_v1"] },
      { id: "philosophical", label: "Philosophical", description: "Nghiêng về suy tư, bản ngã, lựa chọn.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "visualMood",
    label: "Visual mood",
    description: "Màu hình cho ảnh nền và cover prompt.",
    options: [
      { id: "serene_buddha_light", label: "Serene Buddha light", description: "Tượng Phật vàng, ánh hào quang, bình an.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "lotus_temple_sunrise", label: "Lotus temple sunrise", description: "Chùa bình minh, sen hồng, nước phản chiếu.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "warm_monastery_peace", label: "Warm monastery peace", description: "Tu viện bình sáng, tre xanh, Phật bóng chiều.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "warm_temple", label: "Warm temple", description: "Vàng ấm, ánh chùa, an tĩnh.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "golden_compassion", label: "Golden compassion", description: "Ánh vàng từ bi, hoa sen rực rỡ, hy vọng.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "healing_light", label: "Healing light", description: "Ánh sáng chữa lành, trắng ngà, xanh dịu.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "dawn_pagoda", label: "Dawn pagoda", description: "Chùa bình minh, bầu trời sáng, thiên nhiên tươi.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "gentle_nature", label: "Gentle nature", description: "Thiên nhiên dịu, ít drama.", channelProfileIds: ["buddhist_healing_v1", "tang_sau_v1"] },
      { id: "blue_solitude", label: "Blue solitude", description: "Xanh lạnh, cô tịch, hiện đại.", channelProfileIds: ["tang_sau_v1"] },
      { id: "editorial_stillness", label: "Editorial stillness", description: "Sạch, premium, ít biểu tượng tôn giáo.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "musicMood",
    label: "Music mood",
    description: "Mood nhạc nền cho Quote Shorts.",
    options: [
      { id: "soft_meditation", label: "Soft meditation", description: "Mềm, ngân, thở chậm.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "warm_piano", label: "Warm piano", description: "Ấm, dễ nghe, cảm xúc dịu.", channelProfileIds: ["buddhist_healing_v1", "tang_sau_v1"] },
      { id: "ambient_reflection", label: "Ambient reflection", description: "Nhẹ, hiện đại, khoảng trống tốt.", channelProfileIds: ["tang_sau_v1"] },
      { id: "low_cinematic", label: "Low cinematic", description: "Trầm, có chiều sâu nhưng không căng.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "audienceProfile",
    label: "Audience profile",
    description: "Nhóm khán giả được nhắm tới.",
    options: [
      { id: "healing_seekers", label: "Healing seekers", description: "Người đang cần chữa lành, bình an.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "mindfulness_beginners", label: "Mindfulness beginners", description: "Người mới tiếp cận chánh niệm, buông bỏ.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "modern_reflective", label: "Modern reflective", description: "Người trẻ suy tư, quan tâm nội tâm và đời sống hiện đại.", channelProfileIds: ["tang_sau_v1"] },
      { id: "book_philosophy_readers", label: "Book/philosophy readers", description: "Người thích sách, triết, tâm lý.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "contentType",
    label: "Content type",
    description: "Loại nội dung tổng quát của video ngắn.",
    options: [
      { id: "buddhist_teaching", label: "Buddhist teaching", description: "Lời dạy Phật giáo trực tiếp.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "life_reflection", label: "Life reflection", description: "Chiêm nghiệm đời sống qua lăng kính Phật pháp.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "healing_quote", label: "Healing quote", description: "Câu chữa lành, tươi sáng, ấm áp.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "philosophy_reflection", label: "Philosophy reflection", description: "Suy tư triết học đời sống hiện đại.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "teachingType",
    label: "Teaching type",
    description: "Dạng lời dạy Phật giáo (chỉ dành cho Buddhist channel).",
    options: [
      { id: "single_teaching", label: "Lời dạy đơn", description: "Một lời dạy súc tích duy nhất.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "numbered_teaching", label: "Lời dạy thứ N", description: "Lời dạy có đánh số, dễ nhớ.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "life_application", label: "Phật pháp đời thường", description: "Áp dụng Phật pháp vào cuộc sống hàng ngày.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "inspired_wisdom", label: "Lời truyền cảm hứng", description: "Câu khơi dậy hy vọng và bình an.", channelProfileIds: ["buddhist_healing_v1"] },
    ],
  },
  {
    id: "contentMood",
    label: "Content mood",
    description: "Cảm xúc chủ đạo của nội dung.",
    options: [
      { id: "healing_warm", label: "Chữa lành · Ấm áp", description: "Dịu, xoa dịu, tươi sáng.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "peaceful_hopeful", label: "Bình an · Hy vọng", description: "Nhẹ nhàng, nhìn về phía trước.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "compassionate_wise", label: "Từ bi · Trí tuệ", description: "Sâu sắc nhưng không nặng nề.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "quiet_reflective", label: "Im lặng · Chiêm nghiệm", description: "Trầm tư, đi vào chiều sâu nội tâm.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "audienceIntent",
    label: "Audience intent",
    description: "Mục đích/nhu cầu chính của người xem.",
    options: [
      { id: "seeking_peace", label: "Tìm bình an", description: "Người đang căng thẳng, muốn dịu lại.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "seeking_healing", label: "Tìm chữa lành", description: "Người đang tổn thương, cần được an ủi.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "seeking_wisdom", label: "Tìm trí tuệ", description: "Người muốn học và áp dụng Phật pháp.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "seeking_meaning", label: "Tìm ý nghĩa", description: "Người đang tìm chiều sâu và ý nghĩa cuộc sống.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "retentionDevice",
    label: "Retention device",
    description: "Kỹ thuật giữ người xem.",
    options: [
      { id: "wisdom_reveal", label: "Wisdom reveal", description: "Mở đầu bằng câu gây tò mò, hé lộ dần.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "relatable_pain", label: "Relatable pain", description: "Chạm vào nỗi đau quen thuộc rồi dẫn đến giải pháp.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "numbered_steps", label: "Numbered steps", description: "Lời dạy đánh số tạo cảm giác hoàn chỉnh.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "contrast_insight", label: "Contrast insight", description: "Tương phản bất ngờ để giữ chú ý.", channelProfileIds: ["buddhist_healing_v1", "tang_sau_v1"] },
    ],
  },
  {
    id: "openingSceneType",
    label: "Opening scene type",
    description: "Loại cảnh/hình ảnh mở đầu video.",
    options: [
      { id: "buddha_statue", label: "Buddha statue", description: "Tượng Phật vàng, ánh hào quang.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "lotus_water", label: "Lotus water", description: "Hoa sen trên mặt nước yên tĩnh.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "temple_sunrise", label: "Temple sunrise", description: "Chùa bình minh, ánh sáng ấm áp.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "nature_peaceful", label: "Nature peaceful", description: "Thiên nhiên bình yên, không gian thoáng.", channelProfileIds: ["buddhist_healing_v1", "tang_sau_v1"] },
    ],
  },
  {
    id: "visualMotif",
    label: "Visual motif",
    description: "Biểu tượng hình ảnh chủ đạo.",
    options: [
      { id: "buddha_golden_halo", label: "Buddha & golden halo", description: "Phật và hào quang vàng.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "lotus_bloom", label: "Lotus bloom", description: "Hoa sen nở, biểu tượng tinh khiết.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "warm_light_rays", label: "Warm light rays", description: "Tia sáng vàng ấm, chữa lành.", channelProfileIds: ["buddhist_healing_v1"] },
      { id: "minimal_urban", label: "Minimal urban", description: "Không gian đô thị tối giản, hiện đại.", channelProfileIds: ["tang_sau_v1"] },
    ],
  },
  {
    id: "channelProfile",
    label: "Channel profile",
    description: "Profile channel đang điều khiển creative prompt.",
    options: CHANNEL_PROFILES.map((profile) => ({
      id: profile.id,
      label: profile.channelName,
      description: profile.niche,
      channelProfileIds: [profile.id],
    })),
  },
];

// ── Audience Profiles ──────────────────────────────────────────────────────

export const AUDIENCE_PROFILES: AudienceProfileConfig[] = [
  {
    id: "healing_seekers",
    label: "Healing Seekers — Phật pháp",
    channelProfileId: "buddhist_healing_v1",
    audienceDescription:
      "Người Việt tìm bình an, chữa lành, trí tuệ Phật giáo — thường đang trải qua lo âu, tiếc nuối, mất mát, hoặc muốn làm chủ cảm xúc qua chánh niệm và nhân quả.",
    ageRange: "25–55",
    audiencePainPoints: [
      "nỗi sợ hãi và bất an nội tâm",
      "hối hận về quá khứ hoặc lo lắng về tương lai",
      "chấp thủ và khó buông bỏ",
      "khổ đau từ mối quan hệ hoặc mất mát",
      "cô đơn tâm linh giữa cuộc sống bận rộn",
      "cảm giác cuộc sống thiếu ý nghĩa hoặc phương hướng",
    ],
    audienceDesires: [
      "bình an thực sự — không phải che giấu cảm xúc",
      "tha thứ cho bản thân và người khác",
      "hy vọng và ánh sáng phía trước",
      "từ bi — tự yêu mình và yêu người khác",
      "trí tuệ Phật giáo áp dụng vào đời thường",
      "cảm giác được nâng đỡ và không cô đơn",
    ],
    tonePreference: [
      "ấm áp và từ bi — như người anh/chị đồng hành",
      "đơn giản và gần gũi — không giảng đạo khô khan",
      "sáng, hy vọng — không trầm buồn hay nặng nề",
      "chữa lành — mỗi câu như một lời vỗ về nhẹ nhàng",
    ],
    visualPreference: [
      "tượng Phật vàng với hào quang ấm",
      "hoa sen nở trên mặt nước yên tĩnh",
      "bình minh chùa với ánh sáng hồng dịu",
      "tu viện thanh tịnh trong ánh sáng sớm mai",
      "thiên nhiên bình yên — tre xanh, mây nhẹ, nước trong",
    ],
    avoidedTone: [
      "tối tăm, u ám, mang tính trừng phạt",
      "giảng đạo theo kiểu áp đặt hoặc phán xét",
      "quá học thuật hoặc xa rời đời thường",
      "bi quan, tuyệt vọng, không có lối thoát",
    ],
    avoidedVisuals: [
      "hình ảnh u tối, cô đơn, trống rỗng",
      "phong cách đô thị buồn hoặc hiện đại lạnh lùng",
      "hình ảnh gợi nỗi đau mà không có ánh sáng",
      "tượng thần hoặc biểu tượng tôn giáo ngoài Phật giáo",
    ],
    bestKnownAngles: [
      "nỗi đau quen thuộc dẫn đến lời Phật dạy",
      "lời dạy Phật ứng dụng vào tình huống đời thường",
      "buông bỏ như cách duy nhất để nhẹ lòng",
      "nhân quả như lý do để làm điều tốt hôm nay",
      "bình an không tìm bên ngoài mà từ bên trong",
    ],
    experimentalAngles: [
      "lời dạy Phật đánh số — series tạo thói quen xem",
      "Phật pháp giữa đời thường — liên kết giáo lý với tình huống cụ thể",
      "câu hỏi dẫn dắt người xem tự khám phá",
    ],
  },
  {
    id: "modern_reflective",
    label: "Modern Reflective — Tầng Sâu",
    channelProfileId: "tang_sau_v1",
    audienceDescription:
      "Người trẻ Việt (20–35) sống nhanh, suy nghĩ nhiều, đang tìm kiếm chiều sâu nội tâm. Đọc sách, quan tâm tâm lý, mệt mỏi với áp lực xã hội và cảm giác phải chứng minh bản thân.",
    ageRange: "20–35",
    audiencePainPoints: [
      "cô đơn giữa đám đông — nhiều người quen nhưng ít ai thực sự hiểu",
      "mệt mỏi với việc phải liên tục chứng minh bản thân",
      "kiệt sức cảm xúc — cho đi nhiều hơn nhận lại",
      "lựa chọn khó khăn mà không ai có thể thay quyết định",
      "sống nhanh nhưng cảm thấy thiếu chiều sâu và ý nghĩa",
      "nỗi sợ bị hiểu lầm hoặc không được công nhận",
    ],
    audienceDesires: [
      "được hiểu — cảm giác ai đó nói đúng điều mình đang nghĩ",
      "tự do nội tâm — không còn sống để làm hài lòng người khác",
      "sức mạnh yên lặng — không cần giải thích hay phòng thủ",
      "cuộc sống có chiều sâu và ý nghĩa thật sự",
      "dũng cảm lựa chọn và chịu trách nhiệm cho bản thân",
      "kết nối thật — không phải mạng xã hội hay vẻ ngoài",
    ],
    tonePreference: [
      "súc tích và chính xác — mỗi chữ có lý do",
      "hiện đại — như người bạn cùng thế hệ nói thật",
      "hơi đau nhẹ — chạm vào điều người ta né tránh",
      "không giảng đạo — quan sát thay vì phán xét",
      "im lặng có chiều sâu — không phải trống rỗng",
    ],
    visualPreference: [
      "phong cách Kinfolk — ánh sáng tự nhiên, màu trung tính",
      "không gian đô thị tối giản — bàn làm việc, cửa sổ, cà phê",
      "hình ảnh cô tịch mà không cô đơn tuyệt vọng",
      "đêm thành phố nhẹ — ánh đèn ấm từ xa",
      "đồ vật đơn giản — sách, ly cà phê, ánh sáng buổi sáng",
    ],
    avoidedTone: [
      "Phật giáo trực diện hoặc tâm linh rõ ràng",
      "truyền cảm hứng kiểu motivational speaker",
      "ép buộc tích cực hoặc kêu gọi hành động lớn lao",
      "dùng 'quý vị' — quá trang trọng và xa cách",
      "preachy hoặc có vẻ dạy đời",
    ],
    avoidedVisuals: [
      "tượng Phật, chùa, nhang, đài sen Phật giáo",
      "màu sắc quá bão hòa hoặc phong cách fantasy",
      "người đông đúc hoặc cảnh sống náo nhiệt",
      "ảnh stock lạc hậu hoặc quá chỉnh sửa",
    ],
    bestKnownAngles: [
      "khoảnh khắc im lặng khiến người xem nhận ra điều gì đó về mình",
      "sự thật nhỏ về cô đơn, lựa chọn, hay mệt mỏi mà ít ai dám nói",
      "nghịch lý đời sống — điều ta tưởng đúng nhưng thực ra ngược lại",
      "câu hỏi không có câu trả lời đơn giản — buộc người xem tự nghĩ",
      "bản ngã và tự do — chủ đề hay dành cho người trẻ đang tìm mình",
    ],
    experimentalAngles: [
      "bilingual minimal — tiếng Anh + tiếng Việt, cảm giác global nhưng gần gũi",
      "kinetic text — chữ chuyển động tạo nhịp điệu và cảm xúc",
      "note/letter format — cảm giác viết riêng cho từng người xem",
    ],
  },
];

// ── Performance comparison dimensions (analytics foundation) ──────────────

export type PerformanceDimension =
  | "audienceProfile"
  | "topicFamily"
  | "quoteStyle"
  | "visualMood"
  | "formatVariant"
  | "contentMood"
  | "teachingType"
  | "retentionDevice";

export const PERFORMANCE_DIMENSIONS: Array<{
  id: PerformanceDimension;
  label: string;
  description: string;
  source: "sidecar" | "contentGenerations" | "uploadQueue" | "publishedVideos";
}> = [
  { id: "audienceProfile", label: "Audience Profile", description: "Which audience group this content targets.", source: "sidecar" },
  { id: "topicFamily", label: "Topic Family", description: "Semantic topic cluster (e.g. peace_mindfulness, modern_loneliness).", source: "sidecar" },
  { id: "quoteStyle", label: "Quote Style", description: "Visual/text format (short_quote, reflection_card, kinetic_quote, etc.).", source: "sidecar" },
  { id: "visualMood", label: "Visual Mood", description: "Image/background mood direction.", source: "sidecar" },
  { id: "formatVariant", label: "Format Variant", description: "Experiment variant tag (e.g. BUDDHIST_TEACHING_SINGLE_V1).", source: "sidecar" },
  { id: "contentMood", label: "Content Mood", description: "Emotional register of the content (healing_warm, peaceful_hopeful, etc.).", source: "sidecar" },
  { id: "teachingType", label: "Teaching Type", description: "Buddhist format sub-type (numbered, single, life_reflection, etc.).", source: "sidecar" },
  { id: "retentionDevice", label: "Retention Device", description: "Opening hook pattern (wisdom_reveal, relatable_pain, numbered_steps, etc.).", source: "sidecar" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

export function getPromptFieldGroups() {
  return {
    fixed: PROMPT_FIELDS.filter((field) => field.class === "fixed"),
    editable: PROMPT_FIELDS.filter((field) => field.class === "editable"),
  };
}

export function getChannelProfile(channelProfileId?: string | null) {
  return CHANNEL_PROFILES.find((profile) => profile.id === channelProfileId) ?? null;
}

export function getAudienceProfile(channelProfileId?: string | null): AudienceProfileConfig | null {
  if (!channelProfileId) return null;
  return AUDIENCE_PROFILES.find((p) => p.channelProfileId === channelProfileId) ?? null;
}

export function getTopicFamiliesForChannel(channelProfileId?: string | null) {
  if (!channelProfileId) return TOPIC_FAMILIES;
  return TOPIC_FAMILIES.filter((family) => family.channels.includes(channelProfileId));
}

export function getQuoteOptionGroups(channelProfileId?: string | null) {
  return PROMPT_OPTION_GROUPS.map((group) => ({
    ...group,
    options: channelProfileId
      ? group.options.filter((option) => {
          if (!option.channelProfileIds || option.channelProfileIds.length === 0) return true;
          return option.channelProfileIds.includes(channelProfileId);
        })
      : group.options,
  }));
}

export function buildQuoteProfilePromptHints(channelProfileId?: string | null) {
  const profile = getChannelProfile(channelProfileId);
  if (!profile) return null;
  const audience = getAudienceProfile(channelProfileId);
  return {
    channelProfileId: profile.id,
    channelName: profile.channelName,
    tone: profile.tone,
    vocabulary: profile.vocabulary,
    avoid: profile.avoid,
    audiencePainPoints: audience?.audiencePainPoints ?? [],
    audienceDesires: audience?.audienceDesires ?? [],
    tonePreference: audience?.tonePreference ?? [],
    avoidedTone: audience?.avoidedTone ?? [],
  };
}

export function getPromptStudioSnapshot() {
  return {
    hierarchy: [...PROMPT_HIERARCHY],
    platforms: PLATFORM_PROFILES,
    channels: CHANNEL_PROFILES,
    formats: CONTENT_FORMAT_PROFILES,
    topicFamilies: TOPIC_FAMILIES,
    templates: PROMPT_TEMPLATES,
    variants: PROMPT_VARIANTS,
    optionGroups: PROMPT_OPTION_GROUPS,
    fields: getPromptFieldGroups(),
    audienceProfiles: AUDIENCE_PROFILES,
    performanceDimensions: PERFORMANCE_DIMENSIONS,
  };
}
