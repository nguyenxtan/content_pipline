"use server";

import { db } from "@/lib/db";
import { niches, promptTemplates } from "@/lib/db/schema";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { revalidatePath } from "next/cache";
import { TOPIC_PRESETS } from "@/lib/topics";
import { logApiUsage } from "@/actions/ai-usage";

type NicheMeta = {
  name: string;
  slug: string;
  description: string;
  targetAudience: string;
  tone: string;
};

/** Hardcoded prompt templates — AI không cần generate, tiết kiệm token */
function buildPrompts(topicLabel: string) {
  return [
    {
      stage: "ideation",
      name: `Ideation - ${topicLabel} v1`,
      content: `Tạo 10 ý tưởng video cho kênh {{niche_name}} về lĩnh vực "${topicLabel}", hướng đến {{target_audience}}.\nMỗi ý tưởng: tiêu đề hấp dẫn + 1 câu mô tả ngắn.\nĐịnh dạng: danh sách đánh số. Tiếng Việt tự nhiên.`,
      model: "openai/gpt-4o-mini",
      temperature: 0.9,
      maxTokens: 1200,
    },
    {
      stage: "script",
      name: `Script - ${topicLabel} v1`,
      content: `Chủ đề: {{topic}}\nKênh: {{niche_name}} | Đối tượng: {{target_audience}}\nGiọng: {{tone}}\n\nViết outline kịch bản 400-600 từ Tiếng Việt:\n- Hook 10 giây (câu mở gây tò mò)\n- Giới thiệu vấn đề\n- 2-3 điểm nội dung chính + ví dụ\n- CTA xem video dài\nChỉ xuất kịch bản.`,
      model: "openai/gpt-4o-mini",
      temperature: 0.7,
      maxTokens: 1200,
    },
    {
      stage: "short",
      name: `Short 60s - ${topicLabel} v1`,
      content: `Chủ đề: {{topic}}\nKênh: {{niche_name}} | Giọng: {{tone}}\nKịch bản gốc:\n{{script}}\n\nViết script YouTube Short ≤60 giây (~150 từ) Tiếng Việt:\n- Hook 3 giây cực mạnh\n- Vấn đề cốt lõi 40 giây\n- Twist/insight bất ngờ\n- CTA xem video đầy đủ\nChỉ xuất script.`,
      model: "openai/gpt-4o-mini",
      temperature: 0.8,
      maxTokens: 400,
    },
    {
      stage: "long",
      name: `Long Script - ${topicLabel} v1`,
      content: `Chủ đề: {{topic}}\nKênh: {{niche_name}} | Đối tượng: {{target_audience}} | Giọng: {{tone}}\nOutline:\n{{script}}\n\nViết script video dài 20 phút Tiếng Việt, tối thiểu 2500 từ.\n\n## HOOK (200 từ)\n## GIỚI THIỆU (300 từ)\n## PHẦN 1 (500 từ) — điểm nội dung 1 + ví dụ\n## PHẦN 2 (500 từ) — điểm nội dung 2 + phân tích\n## PHẦN 3 (500 từ) — điểm nội dung 3 + ứng dụng\n## KẾT LUẬN (200 từ) — tóm tắt + CTA\nChỉ xuất script.`,
      model: "openai/gpt-4o-mini",
      temperature: 0.7,
      maxTokens: 5000,
    },
  ];
}

export async function createChannelFromTopicAction(
  topicId: string,
  customLabel?: string
): Promise<{ nicheId: number } | { error: string }> {
  const preset = TOPIC_PRESETS.find((t) => t.id === topicId);
  const topicLabel = customLabel || preset?.label || topicId;
  const topicDesc = preset?.description || topicLabel;

  const client = getOpenRouterClient();

  // Chỉ hỏi AI về metadata của phân mục — không generate prompt content
  const userPrompt = `Tạo thông tin phân mục YouTube cho chủ đề: "${topicLabel}" (${topicDesc}).

Trả về JSON, không có text thêm:
{"name":"<tên phân mục ngắn gọn, max 60 ký tự>","slug":"<slug-khong-dau>","description":"<mô tả 1 câu>","targetAudience":"<đối tượng ngắn gọn>","tone":"<giọng điệu ngắn>"}`;

  try {
    const res = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Trả về JSON hợp lệ, không có text thêm.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const raw = res.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(raw) as NicheMeta;

    if (!data.name || !data.slug) {
      return { error: "AI trả về dữ liệu không hợp lệ" };
    }

    await logApiUsage({
      model: "openai/gpt-4o-mini",
      purpose: "niche_create",
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    });

    const [nicheRow] = await db
      .insert(niches)
      .values({
        name: data.name,
        slug: data.slug,
        description: data.description,
        category: topicLabel,
        targetAudience: data.targetAudience,
        tone: data.tone,
      })
      .returning({ id: niches.id });

    const prompts = buildPrompts(topicLabel);
    for (const p of prompts) {
      const vars = [
        ...new Set(
          [...p.content.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(
            (m) => m[1]
          )
        ),
      ];
      await db.insert(promptTemplates).values({
        nicheId: nicheRow.id,
        stage: p.stage,
        name: p.name,
        content: p.content,
        variables: vars,
        model: p.model,
        temperature: p.temperature.toString(),
        maxTokens: p.maxTokens,
        version: 1,
        isActive: true,
      });
    }

    revalidatePath("/niches");
    revalidatePath("/agent");
    return { nicheId: nicheRow.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi tạo phân mục";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { error: "Phân mục với tên này đã tồn tại. Hãy thử lại." };
    }
    return { error: msg };
  }
}
