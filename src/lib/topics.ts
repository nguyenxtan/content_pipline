export const TOPIC_PRESETS = [
  { id: "phat-phap",  label: "Phật pháp / Nhân quả", icon: "Sun",       description: "Truyện nhân quả, đạo đức Phật giáo" },
  { id: "ngon-tinh",  label: "Ngôn tình",             icon: "Heart",     description: "Truyện tình cảm, lãng mạn" },
  { id: "tam-ly",     label: "Tâm lý học",             icon: "Brain",     description: "Self-help, phát triển bản thân" },
  { id: "lich-su",    label: "Lịch sử Việt Nam",       icon: "BookOpen",  description: "Sử ký, nhân vật lịch sử" },
  { id: "kinh-doanh", label: "Kinh doanh",             icon: "TrendingUp",description: "Startup, kinh doanh, tài chính" },
  { id: "thien-dinh", label: "Thiền định",             icon: "Wind",      description: "Mindfulness, bình an nội tâm" },
  { id: "suc-khoe",   label: "Sức khỏe",               icon: "Leaf",      description: "Wellness, dinh dưỡng, thể chất" },
  { id: "gia-dinh",   label: "Gia đình",               icon: "Home",      description: "Nuôi dạy con, hôn nhân" },
] as const;

export type TopicPreset = (typeof TOPIC_PRESETS)[number];
export type TopicIconName = TopicPreset["icon"];
