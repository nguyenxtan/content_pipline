import { MusicSettingsClient } from "@/components/settings/music-settings-client";
import { getMusicStatsAction } from "@/actions/music";
import { MUSIC_CATEGORIES } from "@/lib/music-categories";
export const dynamic = "force-dynamic";

export default async function MusicSettingsPage() {
  const { tracks, byCategory } = await getMusicStatsAction();
  return (
    <MusicSettingsClient
      initialTracks={tracks}
      byCategory={byCategory}
      categories={MUSIC_CATEGORIES}
    />
  );
}
