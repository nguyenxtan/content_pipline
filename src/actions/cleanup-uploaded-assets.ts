"use server";

import fs from "fs";
import path from "path";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";

const SAFE_ASSET_ROOTS = ["media", "cache", "output"] as const;
const DONE_STATUSES = new Set(["done", "success", "uploaded", "published"]);
const PENDING_UPLOAD_STATUSES = new Set(["queued", "uploading"]);
const DEFAULT_SAFE_DELAY_HOURS = 24;
const DEFAULT_LIMIT = 25;

type CleanupGroup = "short" | "long";

export type CleanupUploadedAssetsInput = {
  dryRun?: boolean;
  limit?: number;
};

export type CleanupUploadedAssetsItem = {
  contentId: string;
  topic: string;
  dryRun: boolean;
  filesDeleted: string[];
  bytesFreed: number;
  skippedReason: string | null;
  protectedImageAssetsReason: "pending_facebook_quote_or_photo" | null;
  protectedImageFiles: string[];
  protectedImageBytes: number;
  filesEligibleBeforeProtection: number;
  bytesEligibleBeforeProtection: number;
};

export type CleanupUploadedAssetsResult = {
  dryRun: boolean;
  limit: number;
  safeDelayHours: number;
  scanned: number;
  cleaned: number;
  skipped: number;
  filesDeleted: number;
  bytesFreed: number;
  results: CleanupUploadedAssetsItem[];
};

type ContentRow = typeof contentGenerations.$inferSelect;
type UploadRow = typeof uploadQueue.$inferSelect;

function isDoneStatus(status: string | null | undefined): boolean {
  return !!status && DONE_STATUSES.has(status.toLowerCase());
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value?.trim()))];
}

function safeDelayElapsed(uploadedAt: Date | null, cutoff: Date): boolean {
  return !!uploadedAt && uploadedAt.getTime() <= cutoff.getTime();
}

function latestUploadedAt(
  rows: UploadRow[],
  platform: "youtube" | "facebook",
  videoTypes: string[],
): Date | null {
  const timestamps = rows
    .filter((row) =>
      row.platform === platform &&
      videoTypes.includes(row.videoType) &&
      isDoneStatus(row.status) &&
      row.uploadedAt
    )
    .map((row) => new Date(row.uploadedAt as Date).getTime())
    .filter((time) => Number.isFinite(time));

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

function evaluateShortEligibility(content: ContentRow, uploadRows: UploadRow[], cutoff: Date): string | null {
  if (!content.youtubeVideoUrl) return "short_youtube_url_missing";
  if (!isDoneStatus(content.youtubeUploadStatus)) return "short_youtube_status_not_done";

  const youtubeUploadedAt = latestUploadedAt(uploadRows, "youtube", ["short"]);
  if (!youtubeUploadedAt) return "short_youtube_uploaded_at_missing";
  if (!safeDelayElapsed(youtubeUploadedAt, cutoff)) return "short_youtube_safe_delay_not_elapsed";

  const fbShortRows = uploadRows.filter((r) => r.platform === "facebook" && r.videoType === "short");
  const requiresFacebookReel =
    content.channelKey === "phat_phap" &&
    (content.formatType === "tts_short" || content.formatType === "legacy_quote_short");
  const fbCancelledOrAbsent = fbShortRows.length === 0 || fbShortRows.every((r) => r.status === "cancelled");
  const shouldRequireFacebookReel = requiresFacebookReel || !fbCancelledOrAbsent;

  if (shouldRequireFacebookReel) {
    if (!content.facebookVideoUrl) return "facebook_video_url_missing";
    if (!isDoneStatus(content.facebookUploadStatus)) return "facebook_status_not_done";
    const facebookUploadedAt = latestUploadedAt(uploadRows, "facebook", ["short"]);
    if (!facebookUploadedAt) return "facebook_uploaded_at_missing";
    if (!safeDelayElapsed(facebookUploadedAt, cutoff)) return "facebook_safe_delay_not_elapsed";
  }

  return null;
}

function evaluateLongEligibility(content: ContentRow, uploadRows: UploadRow[], cutoff: Date): string | null {
  if (!content.longYoutubeVideoUrl) return "long_youtube_url_missing";
  if (!isDoneStatus(content.longYoutubeUploadStatus)) return "long_youtube_status_not_done";

  const youtubeUploadedAt = latestUploadedAt(uploadRows, "youtube", ["long"]);
  if (!youtubeUploadedAt) return "long_youtube_uploaded_at_missing";
  if (!safeDelayElapsed(youtubeUploadedAt, cutoff)) return "long_youtube_safe_delay_not_elapsed";

  const fbShortRows = uploadRows.filter((r) => r.platform === "facebook" && r.videoType === "short");
  const fbCancelledOrAbsent = fbShortRows.length === 0 || fbShortRows.every((r) => r.status === "cancelled");
  if (!fbCancelledOrAbsent) {
    if (!content.facebookVideoUrl) return "facebook_video_url_missing";
    if (!isDoneStatus(content.facebookUploadStatus)) return "facebook_status_not_done";
    const facebookUploadedAt = latestUploadedAt(uploadRows, "facebook", ["short"]);
    if (!facebookUploadedAt) return "facebook_uploaded_at_missing";
    if (!safeDelayElapsed(facebookUploadedAt, cutoff)) return "facebook_safe_delay_not_elapsed";
  }

  return null;
}

function candidatePathsForGroup(content: ContentRow, group: CleanupGroup): string[] {
  if (group === "short") {
    return uniqueStrings([
      content.audioPath,
      content.videoPath,
      ...((content.imagePaths as string[] | null) ?? []),
      `media/audio/${content.id}.tmp.wav`,
      `media/images/${content.id}`,
      `media/videos/${content.id}-short.mp4`,
      `media/videos/${content.id}-short-thumb.jpg`,
      `media/videos/${content.id}.ass`,
      `media/videos/${content.id}-cover.ass`,
      content.shortCoverAssetPath ?? `media/covers/${content.id}-short-cover.jpg`,
      `media/covers/${content.id}-short-cover.json`,
    ]);
  }

  return uniqueStrings([
    content.longAudioPath,
    content.longVideoPath,
    content.longThumbnailPath,
    ...((content.longImagePaths as string[] | null) ?? []),
    `media/audio/${content.id}-long.tmp.wav`,
    `media/images/${content.id}-long`,
    `media/videos/${content.id}-long.mp4`,
    `media/videos/${content.id}-long-thumb.jpg`,
    `media/videos/${content.id}-long.ass`,
  ]);
}

function resolveSafeAssetPath(candidate: string): string | null {
  const cwd = process.cwd();
  const absPath = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(cwd, candidate.replace(/^\/+/, ""));
  const safeRoots = SAFE_ASSET_ROOTS.map((root) => path.resolve(cwd, root));
  const isSafe = safeRoots.some((root) => absPath === root || absPath.startsWith(`${root}${path.sep}`));
  return isSafe ? absPath : null;
}

function listExistingFiles(absPath: string): string[] {
  if (!fs.existsSync(absPath)) return [];
  const stat = fs.statSync(absPath);
  if (stat.isFile()) return [absPath];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(absPath)) {
    files.push(...listExistingFiles(path.join(absPath, entry)));
  }
  return files;
}

function relativePath(absPath: string): string {
  return path.relative(process.cwd(), absPath);
}

function pruneEmptyDirectory(absPath: string): void {
  if (!fs.existsSync(absPath)) return;
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(absPath)) {
    pruneEmptyDirectory(path.join(absPath, entry));
  }
  if (fs.readdirSync(absPath).length === 0) {
    fs.rmdirSync(absPath);
  }
}

function collectFiles(candidatePaths: string[]): Array<{ absPath: string; relPath: string; bytes: number }> {
  const absFiles = new Map<string, { absPath: string; relPath: string; bytes: number }>();

  for (const candidate of candidatePaths) {
    const safePath = resolveSafeAssetPath(candidate);
    if (!safePath) continue;

    for (const absFile of listExistingFiles(safePath)) {
      const resolvedFile = resolveSafeAssetPath(absFile);
      if (!resolvedFile) continue;
      const stat = fs.statSync(resolvedFile);
      absFiles.set(resolvedFile, {
        absPath: resolvedFile,
        relPath: relativePath(resolvedFile),
        bytes: stat.size,
      });
    }
  }

  return [...absFiles.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function isImageAsset(file: { relPath: string }): boolean {
  const normalized = file.relPath.replace(/\\/g, "/");
  return normalized.startsWith("media/images/") || /\.(jpe?g|png|webp)$/i.test(normalized);
}

function hasPendingFacebookQuoteOrPhoto(uploadRows: UploadRow[]): boolean {
  return uploadRows.some((row) =>
    row.platform === "facebook" &&
    row.videoType === "quote" &&
    PENDING_UPLOAD_STATUSES.has(row.status)
  );
}

function deleteFiles(files: Array<{ absPath: string }>): void {
  for (const file of files) {
    try {
      if (fs.existsSync(file.absPath) && fs.statSync(file.absPath).isFile()) {
        fs.unlinkSync(file.absPath);
      }
    } catch {
      // Missing or already-removed files should never fail the cleanup job.
    }
  }
}

function pruneKnownContentDirs(contentId: string, groups: CleanupGroup[]): void {
  const dirs = groups.flatMap((group) =>
    group === "short"
      ? [`media/images/${contentId}`]
      : [`media/images/${contentId}-long`]
  );

  for (const dir of dirs) {
    const safePath = resolveSafeAssetPath(dir);
    if (!safePath) continue;
    try {
      pruneEmptyDirectory(safePath);
    } catch {
      // Empty-dir pruning is best-effort only.
    }
  }
}

function hasLocalLongAssets(content: ContentRow): boolean {
  return Boolean(
    content.longAudioPath ||
    content.longVideoPath ||
    content.longThumbnailPath ||
    ((content.longImagePaths as string[] | null) ?? []).length > 0
  );
}

export async function cleanupUploadedAssetsAction(
  input: CleanupUploadedAssetsInput = {},
): Promise<CleanupUploadedAssetsResult> {
  const dryRun = input.dryRun !== false;
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 500));
  const cutoff = new Date(Date.now() - DEFAULT_SAFE_DELAY_HOURS * 60 * 60 * 1000);

  const candidates = await db
    .select()
    .from(contentGenerations)
    .where(isNull(contentGenerations.mediaCleanedAt))
    .orderBy(contentGenerations.createdAt)
    .limit(limit);

  const results: CleanupUploadedAssetsItem[] = [];

  for (const content of candidates) {
    const uploadRows = await db
      .select()
      .from(uploadQueue)
      .where(eq(uploadQueue.contentId, content.id));
    const doneUploadRows = uploadRows.filter((row) => isDoneStatus(row.status));

    const shortSkipReason = evaluateShortEligibility(content, doneUploadRows, cutoff);
    const longSkipReason = evaluateLongEligibility(content, doneUploadRows, cutoff);
    const eligibleGroups: CleanupGroup[] = [];
    if (!shortSkipReason) eligibleGroups.push("short");
    if (!longSkipReason) eligibleGroups.push("long");
    const shouldProtectImageAssets = hasPendingFacebookQuoteOrPhoto(uploadRows);

    if (eligibleGroups.length === 0) {
      results.push({
        contentId: content.id,
        topic: content.topic,
        dryRun,
        filesDeleted: [],
        bytesFreed: 0,
        skippedReason: shortSkipReason ?? longSkipReason ?? "not_eligible",
        protectedImageAssetsReason: shouldProtectImageAssets ? "pending_facebook_quote_or_photo" : null,
        protectedImageFiles: [],
        protectedImageBytes: 0,
        filesEligibleBeforeProtection: 0,
        bytesEligibleBeforeProtection: 0,
      });
      continue;
    }

    const filesBeforeProtection = collectFiles(eligibleGroups.flatMap((group) => candidatePathsForGroup(content, group)));
    const protectedImageFiles = shouldProtectImageAssets
      ? filesBeforeProtection.filter(isImageAsset)
      : [];
    const protectedImagePaths = new Set(protectedImageFiles.map((file) => file.absPath));
    const files = filesBeforeProtection.filter((file) => !protectedImagePaths.has(file.absPath));
    const bytesFreed = files.reduce((total, file) => total + file.bytes, 0);
    const bytesEligibleBeforeProtection = filesBeforeProtection.reduce((total, file) => total + file.bytes, 0);
    const protectedImageBytes = protectedImageFiles.reduce((total, file) => total + file.bytes, 0);

    if (!dryRun) {
      deleteFiles(files);
      if (!shouldProtectImageAssets) {
        pruneKnownContentDirs(content.id, eligibleGroups);
      }

      const longAssetsRemainIneligible = hasLocalLongAssets(content) && !eligibleGroups.includes("long");
      const imageAssetsRemainProtected = protectedImageFiles.length > 0;
      if (!longAssetsRemainIneligible && !imageAssetsRemainProtected) {
        await db
          .update(contentGenerations)
          .set({
            mediaCleanedAt: new Date(),
            mediaScheduledCleanAt: content.mediaScheduledCleanAt ?? new Date(),
          })
          .where(eq(contentGenerations.id, content.id));
      }
    }

    results.push({
      contentId: content.id,
      topic: content.topic,
      dryRun,
      filesDeleted: files.map((file) => file.relPath),
      bytesFreed,
      skippedReason: dryRun
        ? null
        : files.length === 0
          ? "eligible_but_files_already_missing"
          : null,
      protectedImageAssetsReason: shouldProtectImageAssets && protectedImageFiles.length > 0
        ? "pending_facebook_quote_or_photo"
        : null,
      protectedImageFiles: protectedImageFiles.map((file) => file.relPath),
      protectedImageBytes,
      filesEligibleBeforeProtection: filesBeforeProtection.length,
      bytesEligibleBeforeProtection,
    });
  }

  return {
    dryRun,
    limit,
    safeDelayHours: DEFAULT_SAFE_DELAY_HOURS,
    scanned: candidates.length,
    cleaned: results.filter((result) => !result.skippedReason && result.filesDeleted.length > 0).length,
    skipped: results.filter((result) => !!result.skippedReason).length,
    filesDeleted: results.reduce((total, result) => total + result.filesDeleted.length, 0),
    bytesFreed: results.reduce((total, result) => total + result.bytesFreed, 0),
    results,
  };
}
