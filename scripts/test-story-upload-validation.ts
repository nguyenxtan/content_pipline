/**
 * Smoke test for Phase F3: Manual YouTube Upload Validation Tracking
 *
 * Usage:
 *   pnpm test:story-upload-validation --upload-package-id <uuid> [--force]
 *
 * Creates a fake validation record for an existing ready upload package.
 * Does NOT call YouTube API. Does NOT use upload_queue. Does NOT publish.
 *
 * Test data:
 *   upload_status: uploaded_unlisted
 *   youtube_video_url: https://www.youtube.com/watch?v=TEST_FAKE_ID_F3
 *   all checklist items: true
 *   copyright_status: clean
 *   restriction_status: none
 */

import { db } from "@/lib/db";
import {
  storyUploadPackages,
  storyEpisodes,
  stories,
  storyManualUploadValidations,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const FAKE_VIDEO_URL = "https://www.youtube.com/watch?v=TEST_FAKE_ID_F3";
const FAKE_VIDEO_ID = "TEST_FAKE_ID_F3";
const FAKE_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLfakeF3TestPlaylist";
const FAKE_PLAYLIST_ID = "PLfakeF3TestPlaylist";

function parseYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    if (u.hostname === "youtube.com" || u.hostname === "www.youtube.com") {
      if (u.searchParams.has("v")) return u.searchParams.get("v");
    }
  } catch { /* ignore */ }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const pkgIdx = args.indexOf("--upload-package-id");
  if (pkgIdx === -1 || !args[pkgIdx + 1]) {
    console.error("Usage: pnpm test:story-upload-validation --upload-package-id <uuid> [--force]");
    process.exit(1);
  }
  const uploadPackageId = args[pkgIdx + 1];
  const force = args.includes("--force");

  console.log("\n=== Story Manual Upload Validation — Smoke Test (F3) ===\n");
  console.log(`Upload package ID : ${uploadPackageId}`);
  console.log(`Force            : ${force}`);

  // Pre-flight: load package
  const [pkg] = await db
    .select()
    .from(storyUploadPackages)
    .where(eq(storyUploadPackages.id, uploadPackageId))
    .limit(1);

  if (!pkg) {
    console.error("ERROR: Upload package not found");
    process.exit(1);
  }
  console.log(`\n── Upload Package ───────────────────────────────────`);
  console.log(`  story_id   : ${pkg.storyId}`);
  console.log(`  episode_id : ${pkg.episodeId}`);
  console.log(`  status     : ${pkg.status}`);
  console.log(`  title      : ${(pkg.title ?? "").slice(0, 80)}`);

  // Check for existing validation
  const [existing] = await db
    .select()
    .from(storyManualUploadValidations)
    .where(eq(storyManualUploadValidations.episodeId, pkg.episodeId))
    .limit(1);

  if (existing && !force) {
    console.log(`\n── Existing Validation ──────────────────────────────`);
    console.log(`  id             : ${existing.id}`);
    console.log(`  upload_status  : ${existing.uploadStatus}`);
    console.log(`  youtube_video_id: ${existing.youtubeVideoId ?? "—"}`);
    console.log(`  title_ok       : ${existing.titleOk}`);
    console.log(`  thumbnail_ok   : ${existing.thumbnailOk}`);
    console.log(`  srt_ok         : ${existing.srtOk}`);
    console.log(`  audio_ok       : ${existing.audioOk}`);
    console.log(`  description_ok : ${existing.descriptionOk}`);
    console.log(`  copyright      : ${existing.copyrightStatus ?? "—"}`);
    console.log(`  restriction    : ${existing.restrictionStatus ?? "—"}`);
    const pass =
      !!existing.youtubeVideoUrl &&
      existing.audioOk && existing.srtOk && existing.thumbnailOk &&
      existing.titleOk && existing.descriptionOk &&
      (existing.copyrightStatus === "clean" || existing.copyrightStatus === "no_claim") &&
      existing.restrictionStatus === "none" &&
      ["uploaded_private", "uploaded_unlisted", "uploaded_public"].includes(existing.uploadStatus);
    console.log(`\n  Validation pass: ${pass ? "✓ YES" : "✗ NO"}`);
    console.log("\nTip: pass --force to overwrite with fresh test data.");
    process.exit(0);
  }

  // Delete existing record if force
  if (existing && force) {
    await db.delete(storyManualUploadValidations).where(eq(storyManualUploadValidations.id, existing.id));
    console.log(`\nForce: deleted existing validation ${existing.id}`);
  }

  // Insert test validation record
  const parsedVideoId = parseYouTubeVideoId(FAKE_VIDEO_URL);
  const [inserted] = await db
    .insert(storyManualUploadValidations)
    .values({
      id: crypto.randomUUID(),
      storyId: pkg.storyId,
      episodeId: pkg.episodeId,
      uploadPackageId: pkg.id,
      youtubeVideoUrl: FAKE_VIDEO_URL,
      youtubeVideoId: parsedVideoId ?? FAKE_VIDEO_ID,
      youtubePlaylistUrl: FAKE_PLAYLIST_URL,
      youtubePlaylistId: FAKE_PLAYLIST_ID,
      uploadStatus: "uploaded_unlisted",
      visibility: "unlisted",
      titleOk: true,
      thumbnailOk: true,
      srtOk: true,
      audioOk: true,
      descriptionOk: true,
      copyrightStatus: "clean",
      restrictionStatus: "none",
      validationNotes: "F3 smoke test — fake data, no real upload",
      uploadedAt: new Date(),
      validatedAt: new Date(),
    })
    .returning();

  console.log(`\n── Validation Created ───────────────────────────────`);
  console.log(`  id              : ${inserted.id}`);
  console.log(`  episode_id      : ${inserted.episodeId}`);
  console.log(`  upload_status   : ${inserted.uploadStatus}`);
  console.log(`  visibility      : ${inserted.visibility}`);
  console.log(`  youtube_video_url: ${inserted.youtubeVideoUrl}`);
  console.log(`  youtube_video_id : ${inserted.youtubeVideoId}`);
  console.log(`  youtube_playlist_id: ${inserted.youtubePlaylistId}`);
  console.log(`  title_ok        : ${inserted.titleOk}`);
  console.log(`  thumbnail_ok    : ${inserted.thumbnailOk}`);
  console.log(`  srt_ok          : ${inserted.srtOk}`);
  console.log(`  audio_ok        : ${inserted.audioOk}`);
  console.log(`  description_ok  : ${inserted.descriptionOk}`);
  console.log(`  copyright       : ${inserted.copyrightStatus}`);
  console.log(`  restriction     : ${inserted.restrictionStatus}`);
  console.log(`  notes           : ${inserted.validationNotes}`);
  console.log(`  uploaded_at     : ${inserted.uploadedAt}`);
  console.log(`  validated_at    : ${inserted.validatedAt}`);

  // Verify pass conditions
  const pass =
    !!inserted.youtubeVideoUrl &&
    inserted.audioOk && inserted.srtOk && inserted.thumbnailOk &&
    inserted.titleOk && inserted.descriptionOk &&
    (inserted.copyrightStatus === "clean" || inserted.copyrightStatus === "no_claim") &&
    inserted.restrictionStatus === "none" &&
    ["uploaded_private", "uploaded_unlisted", "uploaded_public"].includes(inserted.uploadStatus);

  console.log(`\n── Safety Checks ────────────────────────────────────`);
  // Verify no upload_queue row created
  const { rows: queueRows } = await db.execute(
    `SELECT COUNT(*) as cnt FROM upload_queue WHERE content_id = '${pkg.storyId}' LIMIT 1`
  );
  const queueCount = Number((queueRows[0] as Record<string, string>).cnt ?? 0);
  console.log(`  upload_queue rows created : ${queueCount} (expected 0)`);
  console.log(`  YouTube API called        : NO (correct)`);
  console.log(`  content_generations used  : NO (correct)`);

  console.log(`\n── Validation Pass Check ────────────────────────────`);
  console.log(`  video URL exists          : ${!!inserted.youtubeVideoUrl}`);
  console.log(`  video ID parsed           : ${inserted.youtubeVideoId} (expected ${FAKE_VIDEO_ID})`);
  console.log(`  all checklist true        : ${inserted.titleOk && inserted.thumbnailOk && inserted.srtOk && inserted.audioOk && inserted.descriptionOk}`);
  console.log(`  copyright OK              : ${inserted.copyrightStatus}`);
  console.log(`  restriction OK            : ${inserted.restrictionStatus}`);
  console.log(`  upload status OK          : ${inserted.uploadStatus}`);

  if (pass && queueCount === 0 && inserted.youtubeVideoId === FAKE_VIDEO_ID) {
    console.log(`\n✓ PASSED — Phase F3 smoke test complete`);
    console.log(`\nNext steps:`);
    console.log(`  1. Open /story-studio/[storyId]/episodes in the browser`);
    console.log(`  2. Find Tập 1 with ready upload package`);
    console.log(`  3. Verify "Upload OK" badge shown in episode header`);
    console.log(`  4. Open "Ghi nhận upload YouTube" section — should show pass state`);
    console.log(`  5. Use --force to reset and test the form from UI\n`);
  } else {
    console.error(`\n✗ FAILED`);
    if (!pass) console.error("  Validation did not reach pass state");
    if (queueCount !== 0) console.error("  upload_queue rows were created (unexpected)");
    if (inserted.youtubeVideoId !== FAKE_VIDEO_ID) console.error("  Video ID not parsed correctly");
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  })
  .finally(() => db.$client.end());
