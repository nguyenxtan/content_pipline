"use server";

import { db } from "@/lib/db";
import { musicTracks } from "@/lib/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MUSIC_CATEGORIES } from "@/lib/music-categories";

export async function getMusicTracksAction(category?: string) {
  const tracks = await db.query.musicTracks.findMany({
    where: category ? eq(musicTracks.category, category) : undefined,
    orderBy: [asc(musicTracks.category), desc(musicTracks.createdAt)],
  });
  return tracks;
}

export async function addMusicTrackAction(data: {
  title: string;
  youtubeUrl?: string;
  category: string;
  notes?: string;
}) {
  const id = crypto.randomUUID();
  await db.insert(musicTracks).values({
    id,
    title: data.title,
    youtubeUrl: data.youtubeUrl ?? null,
    category: data.category,
    notes: data.notes ?? null,
    status: data.youtubeUrl ? "pending" : "done", // nếu ko có URL = thêm thủ công
  });
  revalidatePath("/settings/music");
  return id;
}

export async function deleteMusicTrackAction(id: string) {
  // Xoá file nếu có
  const track = await db.query.musicTracks.findFirst({ where: eq(musicTracks.id, id) });
  if (track?.filePath) {
    try {
      const fs = await import("fs/promises");
      await fs.unlink(track.filePath);
    } catch { /* file không tồn tại */ }
  }
  await db.delete(musicTracks).where(eq(musicTracks.id, id));
  revalidatePath("/settings/music");
}

export async function getMusicStatsAction() {
  const all = await db.query.musicTracks.findMany({
    orderBy: [asc(musicTracks.category)],
  });

  const byCategory = MUSIC_CATEGORIES.map((cat) => {
    const tracks = all.filter((t) => t.category === cat.id);
    return {
      ...cat,
      total: tracks.length,
      done: tracks.filter((t) => t.status === "done").length,
      pending: tracks.filter((t) => t.status === "pending").length,
      downloading: tracks.filter((t) => t.status === "downloading").length,
      error: tracks.filter((t) => t.status === "error").length,
      totalDuration: tracks.reduce((s, t) => s + (t.duration ?? 0), 0),
    };
  });

  return { tracks: all, byCategory };
}
