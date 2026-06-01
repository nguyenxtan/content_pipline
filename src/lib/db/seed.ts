import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const PHAT_PHAP_IDEATION_PROMPT = `Bạn là chuyên gia sáng tác nội dung Phật pháp cho YouTube tiếng Việt, chuyên về truyện nhân quả và thiền sư khai thị.

Ngách: {{niche_name}}
Đối tượng: {{target_audience}}
Tông giọng: {{tone}}

Nhiệm vụ: Tạo ý tưởng cho 1 video về chủ đề {{topic}}.

Yêu cầu output:
- title_internal: Tên nội bộ ngắn gọn (không phải tên YouTube)
- premise: Tiền đề câu chuyện/bài học (2-3 câu)
- core_message: Thông điệp cốt lõi muốn truyền tải
- outline: Dàn ý 5-7 điểm chính của video

Lưu ý:
- Nội dung phải phù hợp thuần phong mỹ tục Việt Nam
- Không bịa đặt sự kiện lịch sử hoặc trích dẫn Kinh điển sai
- Tránh các nội dung có thể vi phạm chính sách YouTube
- Câu chuyện nhân quả phải có tính giáo dục, không mê tín dị đoan

Output JSON only, no markdown, no explanation:
{
  "title_internal": "...",
  "premise": "...",
  "core_message": "...",
  "outline": ["điểm 1", "điểm 2", "..."]
}`;

const PHAT_PHAP_SCRIPT_PROMPT = `Bạn là người kể chuyện Phật pháp chuyên nghiệp, viết script cho YouTube tiếng Việt.

Ngách: {{niche_name}}
Đối tượng: {{target_audience}}
Tông giọng: {{tone}}

Dàn ý video:
{{previous_output}}

Chủ đề: {{topic}}

Viết full script video dài 3000-4500 chữ theo cấu trúc:

1. HOOK (5-10 giây đầu): Câu hỏi hoặc tình huống gây tò mò
2. GIỚI THIỆU (30-60 giây): Ngữ cảnh và lý do câu chuyện quan trọng
3. THÂN BÀI: Phát triển câu chuyện/bài học theo dàn ý, chia thành các phần rõ ràng
4. KẾT LUẬN: Tóm tắt bài học, lời khuyên thực tiễn
5. CTA: Kêu gọi subscribe, comment chia sẻ cảm nghĩ

Yêu cầu văn phong:
- Viết như đang kể chuyện, tự nhiên và ấm áp
- Câu ngắn, dễ đọc thành tiếng
- Dùng ngôn ngữ phổ thông, không dùng thuật ngữ Phật giáo quá chuyên sâu trừ khi giải thích rõ
- Mỗi đoạn không quá 3-4 câu để người đọc teleprompter dễ dừng lại lấy hơi
- Tránh từ ngữ nhạy cảm về chính trị, tôn giáo

Chỉ viết script thuần túy, không bao gồm hướng dẫn đạo diễn hay stage direction.`;

const PHAT_PHAP_SHORT_PROMPT = `Bạn là chuyên gia tạo nội dung short-form cho YouTube Shorts/TikTok tiếng Việt.

Chủ đề gốc: {{topic}}
Bài học cốt lõi: {{core_message}}
Tông giọng: {{tone}}

Viết script video ngắn 150-200 chữ cho video 60 giây theo cấu trúc:

1. HOOK (0-5 giây): Câu mở đầu cực kỳ mạnh, gây tò mò hoặc shock
2. NỘI DUNG (5-50 giây): Kể ngắn gọn câu chuyện/bài học
3. BÀI HỌC (50-55 giây): Thông điệp cốt lõi
4. CTA (55-60 giây): Kêu gọi xem video đầy đủ hoặc follow

Yêu cầu:
- Hook PHẢI trong 1 câu, không quá 15 chữ
- Ngôn ngữ sống động, gần gũi
- Không giải thích dài dòng
- Kết thúc phải có cliffhanger hoặc CTA rõ ràng

Output chỉ script text, không label hay ghi chú.`;

const PHAT_PHAP_LONG_PROMPT = `Bạn là chuyên gia SEO YouTube và viết metadata cho kênh Phật pháp tiếng Việt.

Thông tin video:
- Chủ đề: {{topic}}
- Thông điệp cốt lõi: {{core_message}}
- Script (đoạn đầu): {{script_excerpt}}
- Ngách: {{niche_name}}

Tạo metadata YouTube đầy đủ:

YT_TITLE yêu cầu:
- Dài 60-70 ký tự
- Có keyword chính ở đầu
- Gây tò mò, click-worthy
- Không clickbait gây hiểu lầm

YT_DESCRIPTION yêu cầu:
- Đoạn đầu 150-160 ký tự phải có keyword và tóm tắt nội dung (hiện trên search)
- Nội dung đầy đủ 800-1000 chữ
- Bao gồm: tóm tắt video, timestamps ví dụ, links liên quan placeholder, lời kêu gọi subscribe
- Kết thúc bằng hashtags

HASHTAGS: 10-15 hashtag liên quan, mix giữa rộng và hẹp

THUMBNAIL_TEXT: Text ngắn 3-5 chữ để in trên thumbnail, gây tò mò

Output JSON only, no markdown, no explanation:
{
  "yt_title": "...",
  "yt_description": "...",
  "hashtags": ["#tag1", "#tag2"],
  "thumbnail_text": "..."
}`;

async function upsertNiche(data: typeof schema.niches.$inferInsert) {
  const existing = await db.query.niches.findFirst({
    where: (n, { eq }) => eq(n.slug, data.slug!),
  });
  if (existing) {
    await db
      .update(schema.niches)
      .set({ icon: data.icon ?? null, stages: data.stages })
      .where(eq(schema.niches.id, existing.id));
    console.log(`✓ Updated niche: ${data.name}`);
    return existing;
  }
  const [created] = await db.insert(schema.niches).values(data).returning();
  console.log(`✓ Created niche: ${created.name} (id: ${created.id})`);
  return created;
}

async function seed() {
  console.log("🌱 Seeding database...");

  // Niche 1 — existing (idempotent)
  const niche = await upsertNiche({
    name: "Phật pháp - Truyện nhân quả",
    slug: "phat-phap-truyen-nhan-qua",
    description:
      "Kênh chia sẻ truyện nhân quả Phật giáo, thiền sư khai thị, và bài học từ kinh điển Phật pháp",
    icon: "🙏",
    targetAudience:
      "Người Việt trung niên 30-60 tuổi quan tâm Phật pháp, tâm linh và đạo đức sống",
    tone: "Kể chuyện ấm áp, truyền cảm hứng, trang trọng nhưng dễ hiểu",
    stages: ["ideation", "script", "short", "long"],
    isActive: true,
  });

  // Create 4 prompt templates
  const prompts = [
    {
      nicheId: niche.id,
      stage: "ideation",
      name: "Ideation - Phật pháp nhân quả v1",
      content: PHAT_PHAP_IDEATION_PROMPT,
      variables: ["niche_name", "target_audience", "tone", "topic"],
      model: "openai/gpt-4o-mini",
      temperature: "0.8",
      maxTokens: 2000,
      version: 1,
      isActive: true,
    },
    {
      nicheId: niche.id,
      stage: "script",
      name: "Script - Phật pháp nhân quả v1",
      content: PHAT_PHAP_SCRIPT_PROMPT,
      variables: [
        "niche_name",
        "target_audience",
        "tone",
        "topic",
        "previous_output",
      ],
      model: "openai/gpt-4o-mini",
      temperature: "0.7",
      maxTokens: 8000,
      version: 1,
      isActive: true,
    },
    {
      nicheId: niche.id,
      stage: "short",
      name: "Short 60s - Phật pháp v1",
      content: PHAT_PHAP_SHORT_PROMPT,
      variables: ["topic", "core_message", "tone"],
      model: "openai/gpt-4o-mini",
      temperature: "0.7",
      maxTokens: 1000,
      version: 1,
      isActive: true,
    },
    {
      nicheId: niche.id,
      stage: "long",
      name: "Long Metadata - Phật pháp v1",
      content: PHAT_PHAP_LONG_PROMPT,
      variables: [
        "topic",
        "core_message",
        "script_excerpt",
        "niche_name",
      ],
      model: "openai/gpt-4o-mini",
      temperature: "0.5",
      maxTokens: 3000,
      version: 1,
      isActive: true,
    },
  ];

  for (const p of prompts) {
    const existingPrompt = await db.query.promptTemplates.findFirst({
      where: (pt, { and, eq: eqFn }) =>
        and(eqFn(pt.nicheId, p.nicheId), eqFn(pt.stage, p.stage), eqFn(pt.version, p.version)),
    });
    if (!existingPrompt) {
      await db.insert(schema.promptTemplates).values(p);
      console.log(`✓ Created prompt: ${p.name}`);
    } else {
      console.log(`✓ Prompt already exists: ${p.name}`);
    }
  }

  // Niche 2 — Thiền Tập
  await upsertNiche({
    name: "Thiền Tập",
    slug: "thien-tap",
    description: "Hướng dẫn thiền tập, mindfulness và tâm lý học Phật giáo ứng dụng",
    icon: "🧘",
    targetAudience: "Người 25-50 tuổi muốn giảm stress, tìm sự bình an nội tâm",
    tone: "Nhẹ nhàng, khoa học, thực hành",
    stages: ["ideation", "script", "short", "long"],
    isActive: true,
  });

  // Niche 3 — Nhân Quả & Đạo Đức
  await upsertNiche({
    name: "Nhân Quả & Đạo Đức",
    slug: "nhan-qua-dao-duc",
    description: "Luật nhân quả, đạo đức trong Phật giáo và bài học cuộc sống",
    icon: "⚖️",
    targetAudience: "Người quan tâm triết học Phật giáo, sống có đạo đức",
    tone: "Phân tích sâu, câu chuyện thực tế, giáo dục",
    stages: ["ideation", "script", "short", "long"],
    isActive: true,
  });

  console.log("✅ Seed complete!");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
