"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { niches, contentPieces } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { slugify } from "@/lib/utils";
import { nicheSchema, type NicheFormState } from "@/lib/validations/niches";

function parseStages(raw: string | null): string[] {
  if (!raw) return ["ideation", "script", "short", "long"];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : ["ideation", "script", "short", "long"];
  } catch {
    return ["ideation", "script", "short", "long"];
  }
}

export async function createNicheAction(
  _prev: NicheFormState,
  formData: FormData
): Promise<NicheFormState> {
  const raw = {
    name: formData.get("name") as string,
    slug:
      (formData.get("slug") as string) ||
      slugify(formData.get("name") as string),
    description: (formData.get("description") as string) || undefined,
    icon: (formData.get("icon") as string) || undefined,
    category: (formData.get("category") as string) || undefined,
    targetAudience: (formData.get("targetAudience") as string) || undefined,
    tone: (formData.get("tone") as string) || undefined,
    stages: parseStages(formData.get("stages") as string),
    isActive: formData.get("isActive") === "true",
    musicFolder: (formData.get("musicFolder") as string) || undefined,
    videoType: (formData.get("videoType") as string) || "both",
    ttsVoice: (formData.get("ttsVoice") as string) || "Ly",
  };

  const parsed = nicheSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.query.niches.findFirst({
    where: (n, { or, eq }) =>
      or(eq(n.name, parsed.data.name), eq(n.slug, parsed.data.slug)),
  });
  if (existing) {
    if (existing.name === parsed.data.name)
      return { error: "Tên lĩnh vực đã tồn tại" };
    return { error: "Slug đã tồn tại" };
  }

  const [created] = await db
    .insert(niches)
    .values({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      category: (parsed.data as { category?: string }).category ?? null,
      targetAudience: parsed.data.targetAudience ?? null,
      tone: parsed.data.tone ?? null,
      stages: parsed.data.stages,
      isActive: parsed.data.isActive,
      musicFolder: parsed.data.musicFolder ?? null,
      videoType: parsed.data.videoType ?? "both",
      ttsVoice: parsed.data.ttsVoice ?? "Ly",
    })
    .returning({ id: niches.id });

  revalidatePath("/niches");
  redirect(`/niches/${created.id}`);
}

export async function updateNicheAction(
  id: number,
  _prev: NicheFormState,
  formData: FormData
): Promise<NicheFormState> {
  const raw = {
    name: formData.get("name") as string,
    slug: formData.get("slug") as string,
    description: (formData.get("description") as string) || undefined,
    icon: (formData.get("icon") as string) || undefined,
    category: (formData.get("category") as string) || undefined,
    targetAudience: (formData.get("targetAudience") as string) || undefined,
    tone: (formData.get("tone") as string) || undefined,
    stages: parseStages(formData.get("stages") as string),
    isActive: formData.get("isActive") === "true",
    musicFolder: (formData.get("musicFolder") as string) || undefined,
    videoType: (formData.get("videoType") as string) || "both",
    ttsVoice: (formData.get("ttsVoice") as string) || "Ly",
  };

  const parsed = nicheSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.query.niches.findFirst({
    where: (n, { and, or, ne }) =>
      and(
        ne(n.id, id),
        or(eq(n.name, parsed.data.name), eq(n.slug, parsed.data.slug))
      ),
  });
  if (existing) {
    if (existing.name === parsed.data.name)
      return { error: "Tên lĩnh vực đã tồn tại" };
    return { error: "Slug đã tồn tại" };
  }

  await db
    .update(niches)
    .set({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      category: (parsed.data as { category?: string }).category ?? null,
      targetAudience: parsed.data.targetAudience ?? null,
      tone: parsed.data.tone ?? null,
      stages: parsed.data.stages,
      isActive: parsed.data.isActive,
      musicFolder: parsed.data.musicFolder ?? null,
      videoType: parsed.data.videoType ?? "both",
      ttsVoice: parsed.data.ttsVoice ?? "Ly",
      updatedAt: new Date(),
    })
    .where(eq(niches.id, id));

  revalidatePath("/niches");
  revalidatePath(`/niches/${id}`);
  return { success: true };
}

export async function toggleNicheActiveAction(
  id: number,
  currentValue: boolean
): Promise<void> {
  await db
    .update(niches)
    .set({ isActive: !currentValue, updatedAt: new Date() })
    .where(eq(niches.id, id));
  revalidatePath("/niches");
  revalidatePath(`/niches/${id}`);
}

export async function deleteNicheAction(id: number): Promise<void> {
  await db.delete(niches).where(eq(niches.id, id));
  revalidatePath("/niches");
  redirect("/niches");
}

export async function getNiches(search?: string, activeFilter?: string) {
  const rows = await db.query.niches.findMany({
    orderBy: (n, { desc }) => [desc(n.updatedAt)],
  });
  return rows.filter((n) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !n.name.toLowerCase().includes(q) &&
        !n.slug.toLowerCase().includes(q)
      )
        return false;
    }
    if (activeFilter === "active" && !n.isActive) return false;
    if (activeFilter === "inactive" && n.isActive) return false;
    return true;
  });
}

export async function getNicheById(id: number) {
  return db.query.niches.findFirst({
    where: (n, { eq }) => eq(n.id, id),
  });
}

export async function getNicheContentCount(nicheId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contentPieces)
    .where(eq(contentPieces.nicheId, nicheId));
  return Number(result[0]?.count ?? 0);
}
