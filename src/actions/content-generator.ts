"use server";

import { db } from "@/lib/db";
import { contentGenerations, contentSchedulerJobs, niches } from "@/lib/db/schema";
import { eq, desc, asc, ilike, and, count } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { calculateCost } from "@/lib/llm/pricing";
import {
  generateContentSchema,
  schedulerJobSchema,
  updateContentStatusSchema,
  type GeneratedContentResult,
  type SchedulerJobRecord,
  type ContentGenerationRow,
  type UpdateContentStatusInput,
} from "@/lib/validations/content-generator";

const MODEL =
  process.env.CONTENT_GEN_MODEL ??
  process.env.NEXT_PUBLIC_LLM_TEST_MODEL ??
  "openai/gpt-4o-mini";

function buildScriptPrompt(niche: string, topic: string): string {
  return `Chủ đề: ${topic}
Ngách: ${niche}

Tạo kịch bản/outline chi tiết cho video về "${topic}" trong ngách "${niche}".

Cấu trúc:
- Hook (10 giây đầu) — câu mở đầu kéo attention
- Giới thiệu (context, tại sao topic này quan trọng)
- Nội dung chính (2-3 điểm then chốt + ví dụ thực tế)
- Chuyển tiếp sang video dài
- Call-to-action

Độ dài: 400-600 từ
Định dạng: Text thuần, phân section rõ ràng
Ngôn ngữ: Tiếng Việt tự nhiên, gần gũi

Chỉ xuất kịch bản, không giải thích thêm.`;
}

function buildShortPrompt(niche: string, topic: string, script: string): string {
  return `Chủ đề: ${topic}
Ngách: ${niche}
Kịch bản gốc:
${script}

Dựa vào kịch bản trên, tạo script YouTube Short (tối đa 60 giây / ~150-200 từ).

Mục tiêu:
- Hook người xem trong 3 giây đầu
- Giới thiệu nhanh chủ đề
- Gây tò mò / kêu gọi xem video đầy đủ

Giọng điệu: Năng động, cuốn hút, gần gũi
Ngôn ngữ: Tiếng Việt đơn giản, rõ ràng

Chỉ xuất script short, không giải thích thêm.`;
}

function buildLongPrompt(niche: string, topic: string, script: string): string {
  return `Chủ đề: ${topic}
Ngách: ${niche}
Kịch bản gốc:
${script}

Dựa vào kịch bản trên, tạo script chi tiết cho video dài (~20 phút / 2500-3500 từ).

Cấu trúc:
1. **Hook** (30 giây) — câu mở đầu bắt attention mạnh
2. **Giới thiệu** (1-2 phút) — thiết lập chủ đề, tại sao quan trọng
3. **Nội dung chính** (15-17 phút) — 3-4 section, mỗi section gồm:
   - Giải thích rõ ràng
   - Ví dụ thực tế / câu chuyện
   - Tip hành động cụ thể
4. **Kết luận** (1-2 phút) — tóm tắt + CTA đăng ký / video tiếp theo

Phong cách: Giáo dục, cuốn hút, Tiếng Việt
Bao gồm: Câu chuyện, ví dụ, lời khuyên thực tiễn

Chỉ xuất script dài, không giải thích thêm.`;
}

export async function generateContentAction(
  nicheId: number,
  topic: string
): Promise<GeneratedContentResult | { error: string }> {
  const parsed = generateContentSchema.safeParse({ nicheId, topic });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input không hợp lệ" };
  }

  const niche = await db.query.niches.findFirst({
    where: (n, { eq: eqFn }) => eqFn(n.id, parsed.data.nicheId),
  });
  if (!niche) return { error: "Không tìm thấy ngách" };

  const client = getOpenRouterClient();
  const isO1 = MODEL.includes("o1") || MODEL.includes("o3") || MODEL.includes("o4");
  const start = Date.now();

  let script = "";
  let shortContent = "";
  let longContent = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // Step 1: generate script first (short + long depend on it)
    const scriptRes = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: buildScriptPrompt(niche.name, parsed.data.topic) }],
      ...(isO1 ? { max_completion_tokens: 2000 } : { temperature: 0.7, max_tokens: 2000 }),
    });
    script = scriptRes.choices[0]?.message?.content ?? "";
    totalInputTokens += scriptRes.usage?.prompt_tokens ?? 0;
    totalOutputTokens += scriptRes.usage?.completion_tokens ?? 0;

    // Step 2+3: short and long in parallel
    const [shortRes, longRes] = await Promise.all([
      client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: buildShortPrompt(niche.name, parsed.data.topic, script) }],
        ...(isO1 ? { max_completion_tokens: 500 } : { temperature: 0.7, max_tokens: 500 }),
      }),
      client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: buildLongPrompt(niche.name, parsed.data.topic, script) }],
        ...(isO1 ? { max_completion_tokens: 5000 } : { temperature: 0.7, max_tokens: 5000 }),
      }),
    ]);

    shortContent = shortRes.choices[0]?.message?.content ?? "";
    longContent = longRes.choices[0]?.message?.content ?? "";
    totalInputTokens += (shortRes.usage?.prompt_tokens ?? 0) + (longRes.usage?.prompt_tokens ?? 0);
    totalOutputTokens += (shortRes.usage?.completion_tokens ?? 0) + (longRes.usage?.completion_tokens ?? 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM error";
    return { error: msg };
  }

  const generationTime = Date.now() - start;
  const totalCost = calculateCost(MODEL, totalInputTokens, totalOutputTokens);
  const totalTokens = totalInputTokens + totalOutputTokens;

  const [row] = await db
    .insert(contentGenerations)
    .values({
      topic: parsed.data.topic,
      nicheId: niche.id,
      nicheName: niche.name,
      script,
      shortContent,
      longContent,
      totalTokens,
      totalCost: totalCost.toString(),
      generationTime,
      status: "completed",
    })
    .returning({ id: contentGenerations.id });

  return {
    generationId: row.id,
    topic: parsed.data.topic,
    nicheName: niche.name,
    script,
    shortContent,
    longContent,
    totalTokens,
    totalCost,
    generationTime,
  };
}

export async function getContentGenerationAction(
  id: string
): Promise<GeneratedContentResult | null> {
  const row = await db.query.contentGenerations.findFirst({
    where: (c, { eq: eqFn }) => eqFn(c.id, id),
  });
  if (!row) return null;
  return {
    generationId: row.id,
    topic: row.topic,
    nicheName: row.nicheName,
    script: row.script,
    shortContent: row.shortContent,
    longContent: row.longContent,
    totalTokens: row.totalTokens ?? 0,
    totalCost: Number(row.totalCost),
    generationTime: row.generationTime ?? 0,
  };
}

export async function getRecentContentGenerationsAction(
  limit = 5
): Promise<Array<{ id: string; topic: string; nicheName: string; createdAt: Date }>> {
  const rows = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      nicheName: contentGenerations.nicheName,
      createdAt: contentGenerations.createdAt,
    })
    .from(contentGenerations)
    .orderBy(desc(contentGenerations.createdAt))
    .limit(limit);
  return rows;
}

function calculateNextRunAt(frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case "hourly":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "4hourly":
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

export async function createSchedulerJobAction(input: {
  nicheId: number;
  topic: string;
  frequency: string;
  cronExpression?: string;
}): Promise<{ jobId: string; nextRunAt: Date } | { error: string }> {
  const parsed = schedulerJobSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input không hợp lệ" };
  }

  const niche = await db.query.niches.findFirst({
    where: (n, { eq: eqFn }) => eqFn(n.id, parsed.data.nicheId),
  });
  if (!niche) return { error: "Không tìm thấy ngách" };

  const nextRunAt = calculateNextRunAt(parsed.data.frequency);

  const [row] = await db
    .insert(contentSchedulerJobs)
    .values({
      nicheId: niche.id,
      nicheName: niche.name,
      topic: parsed.data.topic,
      frequency: parsed.data.frequency,
      cronExpression: parsed.data.cronExpression ?? null,
      isEnabled: true,
      nextRunAt,
    })
    .returning({ id: contentSchedulerJobs.id });

  return { jobId: row.id, nextRunAt };
}

export async function updateSchedulerJobAction(
  jobId: string,
  updates: { isEnabled?: boolean; frequency?: string; cronExpression?: string }
): Promise<{ success: boolean; nextRunAt?: Date }> {
  const nextRunAt =
    updates.frequency ? calculateNextRunAt(updates.frequency) : undefined;

  await db
    .update(contentSchedulerJobs)
    .set({
      ...(updates.isEnabled !== undefined ? { isEnabled: updates.isEnabled } : {}),
      ...(updates.frequency ? { frequency: updates.frequency } : {}),
      ...(updates.cronExpression !== undefined ? { cronExpression: updates.cronExpression } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contentSchedulerJobs.id, jobId));

  return { success: true, ...(nextRunAt ? { nextRunAt } : {}) };
}

export async function getSchedulerJobsAction(): Promise<SchedulerJobRecord[]> {
  const rows = await db
    .select()
    .from(contentSchedulerJobs)
    .orderBy(desc(contentSchedulerJobs.createdAt));
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    nicheName: r.nicheName,
    frequency: r.frequency,
    cronExpression: r.cronExpression,
    isEnabled: r.isEnabled,
    lastRunAt: r.lastRunAt,
    nextRunAt: r.nextRunAt,
    createdAt: r.createdAt,
  }));
}

export async function deleteSchedulerJobAction(
  jobId: string
): Promise<{ success: boolean }> {
  await db
    .delete(contentSchedulerJobs)
    .where(eq(contentSchedulerJobs.id, jobId));
  return { success: true };
}

export type GalleryFiltersInput = {
  topic?: string;
  nicheId?: number;
  ttsStatus?: string;
  youtubeUploadStatus?: string;
  isLocked?: boolean;
  sortBy?: "newest" | "oldest" | "alphabetical" | "locked";
  page?: number;
  perPage?: number;
};

export type PaginatedGenerations = {
  items: ContentGenerationRow[];
  total: number;
  page: number;
  perPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

function mapRow(r: typeof contentGenerations.$inferSelect): ContentGenerationRow {
  return {
    id: r.id,
    topic: r.topic,
    nicheName: r.nicheName,
    nicheId: r.nicheId,
    script: r.script,
    shortContent: r.shortContent,
    longContent: r.longContent,
    totalTokens: r.totalTokens ?? 0,
    totalCost: Number(r.totalCost),
    generationTime: r.generationTime ?? 0,
    status: r.status,
    createdAt: r.createdAt,
    ttsStatus: r.ttsStatus ?? "pending",
    ttsErrorMessage: r.ttsErrorMessage,
    ttsOutputUrl: r.ttsOutputUrl,
    youtubeUploadStatus: r.youtubeUploadStatus ?? "pending",
    youtubeUploadError: r.youtubeUploadError,
    youtubeVideoUrl: r.youtubeVideoUrl,
    youtubeScheduledAt: r.youtubeScheduledAt,
    isLocked: r.isLocked,
    lockedAt: r.lockedAt,
    lockedBy: r.lockedBy,
  };
}

export async function getContentGenerationsAction(
  filters?: GalleryFiltersInput
): Promise<PaginatedGenerations> {
  const page = Math.max(1, filters?.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters?.perPage ?? 20));

  const conditions = [];
  if (filters?.topic) conditions.push(ilike(contentGenerations.topic, `%${filters.topic}%`));
  if (filters?.nicheId) conditions.push(eq(contentGenerations.nicheId, filters.nicheId));
  if (filters?.ttsStatus) conditions.push(eq(contentGenerations.ttsStatus, filters.ttsStatus));
  if (filters?.youtubeUploadStatus) conditions.push(eq(contentGenerations.youtubeUploadStatus, filters.youtubeUploadStatus));
  if (filters?.isLocked !== undefined) conditions.push(eq(contentGenerations.isLocked, filters.isLocked));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol = {
    oldest: asc(contentGenerations.createdAt),
    alphabetical: asc(contentGenerations.topic),
    locked: desc(contentGenerations.isLocked),
    newest: desc(contentGenerations.createdAt),
  }[filters?.sortBy ?? "newest"] ?? desc(contentGenerations.createdAt);

  const [{ total }] = await db
    .select({ total: count() })
    .from(contentGenerations)
    .where(where);

  const rows = await db
    .select()
    .from(contentGenerations)
    .where(where)
    .orderBy(orderCol)
    .limit(perPage)
    .offset((page - 1) * perPage);

  return {
    items: rows.map(mapRow),
    total: Number(total),
    page,
    perPage,
    hasNextPage: page * perPage < Number(total),
    hasPrevPage: page > 1,
  };
}

export async function lockContentGenerationAction(
  id: string
): Promise<{ success: boolean }> {
  await db
    .update(contentGenerations)
    .set({ isLocked: true, lockedAt: new Date(), lockedBy: "user" })
    .where(eq(contentGenerations.id, id));
  return { success: true };
}

export async function unlockContentGenerationAction(
  id: string
): Promise<{ success: boolean }> {
  await db
    .update(contentGenerations)
    .set({ isLocked: false, lockedAt: null, lockedBy: null })
    .where(eq(contentGenerations.id, id));
  return { success: true };
}

export async function updateContentStatusAction(
  id: string,
  updates: UpdateContentStatusInput
): Promise<{ success: boolean }> {
  const parsed = updateContentStatusSchema.safeParse(updates);
  if (!parsed.success) return { success: false };

  await db
    .update(contentGenerations)
    .set({
      ...(parsed.data.ttsStatus !== undefined ? { ttsStatus: parsed.data.ttsStatus } : {}),
      ...(parsed.data.ttsOutputUrl !== undefined ? { ttsOutputUrl: parsed.data.ttsOutputUrl } : {}),
      ...(parsed.data.ttsErrorMessage !== undefined ? { ttsErrorMessage: parsed.data.ttsErrorMessage } : {}),
      ...(parsed.data.youtubeUploadStatus !== undefined ? { youtubeUploadStatus: parsed.data.youtubeUploadStatus } : {}),
      ...(parsed.data.youtubeScheduledAt !== undefined ? { youtubeScheduledAt: parsed.data.youtubeScheduledAt } : {}),
      ...(parsed.data.youtubeVideoUrl !== undefined ? { youtubeVideoUrl: parsed.data.youtubeVideoUrl } : {}),
      ...(parsed.data.youtubeUploadError !== undefined ? { youtubeUploadError: parsed.data.youtubeUploadError } : {}),
    })
    .where(eq(contentGenerations.id, id));

  return { success: true };
}
