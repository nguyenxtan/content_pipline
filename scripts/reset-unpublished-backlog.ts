import { config as loadEnv } from "dotenv";

import fs from "fs";
import path from "path";
import pg from "pg";

loadEnv({ path: ".env.local" });
loadEnv();

const { Pool } = pg;

const REPORT_PATH = path.join(process.cwd(), "docs", "RESET_AND_RESCHEDULE_DRY_RUN.md");
const LEGACY_BATCH_PATH = path.join(process.cwd(), "output", "legacy-quote-short-v1", "experiment-batch.json");
const EXECUTE = process.argv.includes("--execute");
const ACTIVE_QUEUE_STATUSES = new Set(["queued", "uploading", "error"]);

type UploadQueueGroup = {
  platform: string;
  video_type: string;
  status: string;
  count: number;
  past_due: number;
  future_due: number;
};

type StatusCount = {
  status: string | null;
  count: number;
};

type ContentSummary = {
  total: number;
  published_count: number;
  unpublished_count: number;
  media_cleaned_count: number;
};

type UnpublishedContentRow = {
  id: string;
  topic: string;
  niche_name: string;
  channel_key: string | null;
  content_mode: string | null;
  status: string | null;
  tts_status: string | null;
  images_status: string | null;
  video_status: string | null;
  audio_path: string | null;
  video_path: string | null;
  image_paths: string[] | null;
  media_cleaned_at: Date | null;
  youtube_video_url: string | null;
  facebook_video_url: string | null;
  long_youtube_video_url: string | null;
  created_at: Date;
};

type UploadRow = {
  id: string;
  content_id: string;
  channel_id: number;
  platform: string;
  video_type: string;
  status: string;
  scheduled_at: Date;
  uploaded_at: Date | null;
  platform_video_id: string | null;
  platform_video_url: string | null;
};

type LegacyBatchSample = {
  contentId: string;
  topic: string;
  topicFamily: string;
  quoteText: string;
  outputVideoPath: string;
};

type LegacyBatch = {
  samples: LegacyBatchSample[];
};

type AssetFile = {
  absPath: string;
  relPath: string;
  bytes: number;
  category: "audio" | "video" | "image" | "cover";
  contentId: string;
};

type OutputArtifact = {
  relPath: string;
  bytes: number;
  keep: boolean;
  reason: string;
};

type CapacitySnapshot = {
  pendingUploadCount: number;
  failedUploadCount: number;
  unpublishedRenderedCount: number;
  mediaTotalBytes: number;
};

function createPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function toRepoRelative(absPath: string): string {
  return path.relative(process.cwd(), absPath) || ".";
}

function fileBytes(absPath: string): number {
  try {
    return fs.statSync(absPath).size;
  } catch {
    return 0;
  }
}

function dirBytes(absPath: string): number {
  if (!fs.existsSync(absPath)) return 0;
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(absPath)) {
    total += dirBytes(path.join(absPath, entry));
  }
  return total;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(date));
}

function readLegacyBatch(): LegacyBatch {
  if (!fs.existsSync(LEGACY_BATCH_PATH)) {
    return { samples: [] };
  }
  return JSON.parse(fs.readFileSync(LEGACY_BATCH_PATH, "utf8")) as LegacyBatch;
}

function listFilesRecursive(absPath: string): string[] {
  if (!fs.existsSync(absPath)) return [];
  const stat = fs.statSync(absPath);
  if (stat.isFile()) return [absPath];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(absPath)) {
    files.push(...listFilesRecursive(path.join(absPath, entry)));
  }
  return files;
}

function addAsset(
  target: Map<string, AssetFile>,
  contentId: string,
  category: AssetFile["category"],
  candidatePath: string | null | undefined,
): void {
  if (!candidatePath) return;
  const absPath = resolveRepoPath(candidatePath);
  if (!fs.existsSync(absPath)) return;

  const files = listFilesRecursive(absPath);
  for (const fileAbsPath of files) {
    const relPath = toRepoRelative(fileAbsPath);
    target.set(fileAbsPath, {
      absPath: fileAbsPath,
      relPath,
      bytes: fileBytes(fileAbsPath),
      category,
      contentId,
    });
  }
}

function collectResettableAssets(rows: UnpublishedContentRow[]): AssetFile[] {
  const assets = new Map<string, AssetFile>();
  for (const row of rows) {
    addAsset(assets, row.id, "audio", row.audio_path ?? `media/audio/${row.id}.wav`);
    addAsset(assets, row.id, "video", row.video_path ?? `media/videos/${row.id}-short.mp4`);
    addAsset(assets, row.id, "image", `media/images/${row.id}`);
    for (const imagePath of row.image_paths ?? []) {
      addAsset(assets, row.id, "image", imagePath);
    }
    addAsset(assets, row.id, "cover", `media/covers/${row.id}-short-cover.jpg`);
  }
  return [...assets.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function summarizeAssets(files: AssetFile[]): Record<AssetFile["category"], { count: number; bytes: number }> {
  return {
    audio: {
      count: files.filter((file) => file.category === "audio").length,
      bytes: files.filter((file) => file.category === "audio").reduce((sum, file) => sum + file.bytes, 0),
    },
    video: {
      count: files.filter((file) => file.category === "video").length,
      bytes: files.filter((file) => file.category === "video").reduce((sum, file) => sum + file.bytes, 0),
    },
    image: {
      count: files.filter((file) => file.category === "image").length,
      bytes: files.filter((file) => file.category === "image").reduce((sum, file) => sum + file.bytes, 0),
    },
    cover: {
      count: files.filter((file) => file.category === "cover").length,
      bytes: files.filter((file) => file.category === "cover").reduce((sum, file) => sum + file.bytes, 0),
    },
  };
}

function scanOutputArtifacts(): OutputArtifact[] {
  const outputDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) return [];

  const keepRoots = new Set([
    "legacy-quote-short-v1",
    "manifests",
  ]);

  return fs.readdirSync(outputDir)
    .map((entry) => {
      const absPath = path.join(outputDir, entry);
      const relPath = toRepoRelative(absPath);
      const keep = keepRoots.has(entry);
      const reason = keep
        ? (entry === "legacy-quote-short-v1"
          ? "needed for alternating Legacy Quote schedule input"
          : "contains repo manifests")
        : "debug/verification artifact safe to remove manually";
      return {
        relPath,
        bytes: dirBytes(absPath),
        keep,
        reason,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

function buildProjectedCapacity(
  current: CapacitySnapshot,
  queueRowsToCancel: UploadRow[],
  deletedAssets: AssetFile[],
  resettableRenderedCount: number,
): Record<string, string | number> {
  const pendingReduction = queueRowsToCancel.filter((row) => row.status === "queued" || row.status === "uploading").length;
  const failedReduction = queueRowsToCancel.filter((row) => row.status === "error").length;
  const bytesFreed = deletedAssets.reduce((sum, file) => sum + file.bytes, 0);

  return {
    pendingUploadCount: Math.max(0, current.pendingUploadCount - pendingReduction),
    failedUploadCount: Math.max(0, current.failedUploadCount - failedReduction),
    unpublishedRenderedCount: Math.max(0, current.unpublishedRenderedCount - resettableRenderedCount),
    mediaTotalBytes: `${fmtBytes(Math.max(0, current.mediaTotalBytes - bytesFreed))} (from ${fmtBytes(current.mediaTotalBytes)})`,
    estimatedBytesFreed: fmtBytes(bytesFreed),
  };
}

function buildMarkdown(input: {
  queueGroups: UploadQueueGroup[];
  contentSummary: ContentSummary;
  ttsStatuses: StatusCount[];
  imagesStatuses: StatusCount[];
  videoStatuses: StatusCount[];
  unpublishedRows: UnpublishedContentRow[];
  protectedTtsRows: UnpublishedContentRow[];
  resettableRows: UnpublishedContentRow[];
  queueRowsToCancel: UploadRow[];
  resettableAssets: AssetFile[];
  currentCapacity: CapacitySnapshot;
  projectedCapacity: Record<string, string | number>;
  outputArtifacts: OutputArtifact[];
  legacyBatch: LegacyBatch;
}): string {
  const assetSummary = summarizeAssets(input.resettableAssets);
  const outputSafe = input.outputArtifacts.filter((artifact) => !artifact.keep).slice(0, 8);
  const outputKeep = input.outputArtifacts.filter((artifact) => artifact.keep).slice(0, 8);
  const resettableRenderedCount = input.resettableRows.filter((row) => row.video_status === "done" && !row.media_cleaned_at).length;

  const lines: string[] = [];
  lines.push("# Reset And Reschedule Dry Run");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push("- Dry-run only. No queue rows were cancelled. No files were deleted.");
  lines.push("- Published records, analytics snapshots, music library, docs, and `.env.local` are protected.");
  lines.push("- Render-ready unpublished TTS shorts are intentionally protected as carry-forward candidates for the new alternating schedule.");
  lines.push("");
  lines.push("## 1. Upload Queue Counts");
  lines.push("");
  lines.push("| Platform | Video Type | Status | Count | Past Due | Future |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const row of input.queueGroups) {
    lines.push(`| ${row.platform} | ${row.video_type} | ${row.status} | ${row.count} | ${row.past_due} | ${row.future_due} |`);
  }
  lines.push("");
  lines.push("## 2. Content Generations Snapshot");
  lines.push("");
  lines.push(`- Total content rows: **${input.contentSummary.total}**`);
  lines.push(`- Published or partially published rows: **${input.contentSummary.published_count}**`);
  lines.push(`- Fully unpublished rows: **${input.contentSummary.unpublished_count}**`);
  lines.push(`- Rows with media already cleaned: **${input.contentSummary.media_cleaned_count}**`);
  lines.push("");
  lines.push("### TTS Status");
  lines.push("");
  for (const row of input.ttsStatuses) lines.push(`- \`${row.status ?? "null"}\`: ${row.count}`);
  lines.push("");
  lines.push("### Image Status");
  lines.push("");
  for (const row of input.imagesStatuses) lines.push(`- \`${row.status ?? "null"}\`: ${row.count}`);
  lines.push("");
  lines.push("### Video Status");
  lines.push("");
  for (const row of input.videoStatuses) lines.push(`- \`${row.status ?? "null"}\`: ${row.count}`);
  lines.push("");
  lines.push("## 3. Carry-Forward Protection");
  lines.push("");
  lines.push(`- Protected render-ready TTS candidates: **${input.protectedTtsRows.length}**`);
  lines.push(`- Resettable unpublished rows after protection: **${input.resettableRows.length}**`);
  lines.push(`- Queued/uploading/error rows safe to cancel: **${input.queueRowsToCancel.length}**`);
  lines.push(`- Resettable rendered rows contributing to backpressure: **${resettableRenderedCount}**`);
  lines.push("");
  if (input.protectedTtsRows.length > 0) {
    lines.push("| Protected TTS Content | Topic | Created | Video | Audio |");
    lines.push("|---|---|---|---|---|");
    for (const row of input.protectedTtsRows.slice(0, 12)) {
      lines.push(`| ${row.id} | ${row.topic} | ${fmtDate(row.created_at)} | ${row.video_path ? "yes" : "no"} | ${row.audio_path ? "yes" : "no"} |`);
    }
    lines.push("");
  }
  lines.push("## 4. Asset Audit For Resettable Unpublished Content");
  lines.push("");
  lines.push(`- Audio files: **${assetSummary.audio.count}** (${fmtBytes(assetSummary.audio.bytes)})`);
  lines.push(`- Video files: **${assetSummary.video.count}** (${fmtBytes(assetSummary.video.bytes)})`);
  lines.push(`- Image files: **${assetSummary.image.count}** (${fmtBytes(assetSummary.image.bytes)})`);
  lines.push(`- Cover files: **${assetSummary.cover.count}** (${fmtBytes(assetSummary.cover.bytes)})`);
  lines.push(`- Total resettable asset bytes: **${fmtBytes(input.resettableAssets.reduce((sum, file) => sum + file.bytes, 0))}**`);
  lines.push("");
  lines.push("| Content ID | Topic | TTS | Images | Video | Audio Path | Video Path |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const row of input.resettableRows.slice(0, 25)) {
    lines.push(`| ${row.id} | ${row.topic} | ${row.tts_status ?? "null"} | ${row.images_status ?? "null"} | ${row.video_status ?? "null"} | ${row.audio_path ? "yes" : "no"} | ${row.video_path ? "yes" : "no"} |`);
  }
  lines.push("");
  lines.push("## 5. Safe To Remove / Cancel");
  lines.push("");
  lines.push("- Queue rows safe to cancel: queued/uploading/error rows attached to fully unpublished content only.");
  lines.push("- Assets safe to delete on execute: `media/audio/<contentId>.wav`, `media/videos/<contentId>-short.mp4`, `media/images/<contentId>/`, `media/covers/<contentId>-short-cover.jpg` for resettable unpublished content.");
  lines.push("- Legacy Quote V1.5 batch is **not** included in delete scope because it is the source for the new alternating schedule.");
  lines.push("");
  if (outputSafe.length > 0) {
    lines.push("### Output Artifacts Safe To Remove Manually");
    lines.push("");
    lines.push("| Path | Size | Reason |");
    lines.push("|---|---:|---|");
    for (const artifact of outputSafe) {
      lines.push(`| ${artifact.relPath} | ${fmtBytes(artifact.bytes)} | ${artifact.reason} |`);
    }
    lines.push("");
  }
  lines.push("## 6. Must Keep");
  lines.push("");
  lines.push("- `published_videos`");
  lines.push("- `video_metric_snapshots`");
  lines.push("- Historical YouTube import data");
  lines.push("- `media/music`");
  lines.push("- Analytics snapshots and docs");
  lines.push("- `.env.local`");
  if (outputKeep.length > 0) {
    lines.push("");
    lines.push("### Output Paths Explicitly Kept");
    lines.push("");
    lines.push("| Path | Size | Reason |");
    lines.push("|---|---:|---|");
    for (const artifact of outputKeep) {
      lines.push(`| ${artifact.relPath} | ${fmtBytes(artifact.bytes)} | ${artifact.reason} |`);
    }
  }
  lines.push("");
  lines.push("## 7. Legacy Batch Readiness");
  lines.push("");
  lines.push(`- Legacy experiment samples found: **${input.legacyBatch.samples.length}**`);
  for (const sample of input.legacyBatch.samples.slice(0, 8)) {
    lines.push(`- ${sample.contentId}: ${sample.topic} -> ${toRepoRelative(sample.outputVideoPath)}`);
  }
  lines.push("");
  lines.push("## 8. Capacity Impact Preview");
  lines.push("");
  lines.push(`- Current pending upload count: **${input.currentCapacity.pendingUploadCount}**`);
  lines.push(`- Current failed upload count: **${input.currentCapacity.failedUploadCount}**`);
  lines.push(`- Current unpublished rendered count: **${input.currentCapacity.unpublishedRenderedCount}**`);
  lines.push(`- Current media total: **${fmtBytes(input.currentCapacity.mediaTotalBytes)}**`);
  lines.push("");
  lines.push("### Projected After Execute");
  lines.push("");
  for (const [key, value] of Object.entries(input.projectedCapacity)) {
    lines.push(`- ${key}: **${value}**`);
  }
  lines.push("");
  lines.push("## 9. Execute Safety");
  lines.push("");
  lines.push("- Execute mode is opt-in only: `pnpm reset:unpublished-backlog:execute`.");
  lines.push("- If any candidate shows published evidence during execute, the script aborts before deleting files.");
  lines.push("- Execute mode cancels queue rows first, then deletes files, then marks reset rows with `status = cancelled` and `mediaCleanedAt`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function loadQueueGroups(client: pg.PoolClient): Promise<UploadQueueGroup[]> {
  const result = await client.query<UploadQueueGroup>(
    `
      SELECT
        platform,
        video_type,
        status,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE scheduled_at <= NOW())::int AS past_due,
        COUNT(*) FILTER (WHERE scheduled_at > NOW())::int AS future_due
      FROM upload_queue
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `,
  );
  return result.rows.map((row) => ({
    ...row,
    count: toInt(row.count),
    past_due: toInt(row.past_due),
    future_due: toInt(row.future_due),
  }));
}

async function loadStatusCounts(client: pg.PoolClient, column: "tts_status" | "images_status" | "video_status"): Promise<StatusCount[]> {
  const result = await client.query<StatusCount>(
    `
      SELECT ${column}::text AS status, COUNT(*)::int AS count
      FROM content_generations
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC NULLS LAST
    `,
  );
  return result.rows.map((row) => ({
    status: row.status,
    count: toInt(row.count),
  }));
}

async function loadContentSummary(client: pg.PoolClient): Promise<ContentSummary> {
  const result = await client.query<ContentSummary>(
    `
      WITH content_flags AS (
        SELECT
          cg.id,
          cg.media_cleaned_at,
          (
            EXISTS (SELECT 1 FROM published_videos pv WHERE pv.content_id = cg.id)
            OR EXISTS (SELECT 1 FROM upload_queue uq WHERE uq.content_id = cg.id AND uq.status = 'done')
            OR cg.youtube_video_url IS NOT NULL
            OR cg.facebook_video_url IS NOT NULL
            OR cg.long_youtube_video_url IS NOT NULL
          ) AS has_publish_signal
        FROM content_generations cg
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE has_publish_signal)::int AS published_count,
        COUNT(*) FILTER (WHERE NOT has_publish_signal)::int AS unpublished_count,
        COUNT(*) FILTER (WHERE media_cleaned_at IS NOT NULL)::int AS media_cleaned_count
      FROM content_flags
    `,
  );
  const row = result.rows[0];
  return {
    total: toInt(row?.total),
    published_count: toInt(row?.published_count),
    unpublished_count: toInt(row?.unpublished_count),
    media_cleaned_count: toInt(row?.media_cleaned_count),
  };
}

async function loadFullyUnpublishedRows(client: pg.PoolClient): Promise<UnpublishedContentRow[]> {
  const result = await client.query<UnpublishedContentRow>(
    `
      WITH content_flags AS (
        SELECT
          cg.*,
          EXISTS (SELECT 1 FROM published_videos pv WHERE pv.content_id = cg.id) AS has_published_video,
          EXISTS (SELECT 1 FROM upload_queue uq WHERE uq.content_id = cg.id AND uq.status = 'done') AS has_done_queue
        FROM content_generations cg
      )
      SELECT
        id,
        topic,
        niche_name,
        channel_key,
        content_mode,
        status,
        tts_status,
        images_status,
        video_status,
        audio_path,
        video_path,
        image_paths,
        media_cleaned_at,
        youtube_video_url,
        facebook_video_url,
        long_youtube_video_url,
        created_at
      FROM content_flags
      WHERE NOT has_published_video
        AND NOT has_done_queue
        AND youtube_video_url IS NULL
        AND facebook_video_url IS NULL
        AND long_youtube_video_url IS NULL
      ORDER BY created_at ASC
    `,
  );
  return result.rows;
}

async function loadQueueRowsToCancel(client: pg.PoolClient, contentIds: string[]): Promise<UploadRow[]> {
  if (contentIds.length === 0) return [];
  const result = await client.query<UploadRow>(
    `
      SELECT
        id,
        content_id,
        channel_id,
        platform,
        video_type,
        status,
        scheduled_at,
        uploaded_at,
        platform_video_id,
        platform_video_url
      FROM upload_queue
      WHERE content_id = ANY($1::text[])
        AND status = ANY($2::text[])
        AND uploaded_at IS NULL
        AND platform_video_id IS NULL
      ORDER BY scheduled_at ASC, created_at ASC
    `,
    [contentIds, [...ACTIVE_QUEUE_STATUSES]],
  );
  return result.rows;
}

async function executeReset(client: pg.PoolClient, input: {
  queueRowsToCancel: UploadRow[];
  resettableRows: UnpublishedContentRow[];
  resettableAssets: AssetFile[];
}): Promise<{
  queueCancelled: number;
  rowsCancelled: number;
  filesDeleted: number;
  bytesFreed: number;
}> {
  const resettableIds = input.resettableRows.map((row) => row.id);
  const queueIds = input.queueRowsToCancel.map((row) => row.id);
  let queueCancelled = 0;
  let rowsCancelled = 0;

  await client.query("BEGIN");
  try {
    if (queueIds.length > 0) {
      const queueUpdate = await client.query(
        `
          UPDATE upload_queue
          SET status = 'cancelled',
              error_message = COALESCE(error_message, 'reset_unpublished_backlog'),
              updated_at = NOW()
          WHERE id = ANY($1::text[])
        `,
        [queueIds],
      );
      queueCancelled = queueUpdate.rowCount ?? 0;
    }

    if (resettableIds.length > 0) {
      const contentUpdate = await client.query(
        `
          UPDATE content_generations
          SET
            status = 'cancelled',
            media_cleaned_at = NOW(),
            audio_path = NULL,
            video_path = NULL,
            image_paths = '[]'::jsonb
          WHERE id = ANY($1::text[])
        `,
        [resettableIds],
      );
      rowsCancelled = contentUpdate.rowCount ?? 0;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  let bytesFreed = 0;
  let filesDeleted = 0;
  for (const asset of input.resettableAssets) {
    if (!fs.existsSync(asset.absPath)) continue;
    bytesFreed += asset.bytes;
    fs.unlinkSync(asset.absPath);
    filesDeleted += 1;
    console.log(`deleted ${asset.relPath} (${fmtBytes(asset.bytes)})`);
  }

  const prunedDirs = new Set<string>();
  for (const row of input.resettableRows) {
    const imageDir = resolveRepoPath(`media/images/${row.id}`);
    if (fs.existsSync(imageDir) && fs.statSync(imageDir).isDirectory()) {
      try {
        for (const dir of [imageDir]) {
          if (!prunedDirs.has(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
            prunedDirs.add(dir);
          }
        }
      } catch {
        // ignore directory cleanup errors
      }
    }
  }

  return {
    queueCancelled,
    rowsCancelled,
    filesDeleted,
    bytesFreed,
  };
}

async function main(): Promise<void> {
  const legacyBatch = readLegacyBatch();
  const pool = createPool();
  const client = await pool.connect();

  try {
    const { getProductionCapacityStatus } = await import("@/lib/production-capacity");
    const queueGroups = await loadQueueGroups(client);
    const contentSummary = await loadContentSummary(client);
    const ttsStatuses = await loadStatusCounts(client, "tts_status");
    const imagesStatuses = await loadStatusCounts(client, "images_status");
    const videoStatuses = await loadStatusCounts(client, "video_status");
    const currentCapacity = await getProductionCapacityStatus();

    const unpublishedRows = await loadFullyUnpublishedRows(client);
    const protectedTtsRows = unpublishedRows.filter((row) =>
      (row.content_mode === "short" || row.content_mode === "both" || !row.content_mode) &&
      row.tts_status === "done" &&
      row.video_status === "done" &&
      !!row.audio_path &&
      !!row.video_path &&
      fs.existsSync(resolveRepoPath(row.audio_path)) &&
      fs.existsSync(resolveRepoPath(row.video_path))
    );

    const protectedIds = new Set(protectedTtsRows.map((row) => row.id));
    const resettableRows = unpublishedRows.filter((row) => !protectedIds.has(row.id));
    const queueRowsToCancel = await loadQueueRowsToCancel(client, unpublishedRows.map((row) => row.id));
    const resettableAssets = collectResettableAssets(resettableRows);
    const outputArtifacts = scanOutputArtifacts();
    const resettableRenderedCount = resettableRows.filter((row) => row.video_status === "done" && !row.media_cleaned_at).length;
    const projectedCapacity = buildProjectedCapacity(currentCapacity, queueRowsToCancel, resettableAssets, resettableRenderedCount);

    const markdown = buildMarkdown({
      queueGroups,
      contentSummary,
      ttsStatuses,
      imagesStatuses,
      videoStatuses,
      unpublishedRows,
      protectedTtsRows,
      resettableRows,
      queueRowsToCancel,
      resettableAssets,
      currentCapacity,
      projectedCapacity,
      outputArtifacts,
      legacyBatch,
    });

    fs.writeFileSync(REPORT_PATH, markdown, "utf8");

    console.log(`dry-run report written: ${toRepoRelative(REPORT_PATH)}`);
    console.log(`fully unpublished rows: ${unpublishedRows.length}`);
    console.log(`protected render-ready TTS rows: ${protectedTtsRows.length}`);
    console.log(`resettable rows: ${resettableRows.length}`);
    console.log(`queue rows safe to cancel: ${queueRowsToCancel.length}`);
    console.log(`resettable asset bytes: ${fmtBytes(resettableAssets.reduce((sum, file) => sum + file.bytes, 0))}`);

    if (!EXECUTE) return;

    const unsafeRows = resettableRows.filter((row) =>
      row.youtube_video_url || row.facebook_video_url || row.long_youtube_video_url
    );
    if (unsafeRows.length > 0) {
      throw new Error(`Abort: found ${unsafeRows.length} reset candidates with publish URLs.`);
    }

    const executeSummary = await executeReset(client, {
      queueRowsToCancel,
      resettableRows,
      resettableAssets,
    });
    const capacityAfter = await getProductionCapacityStatus();

    console.log("");
    console.log("execute summary");
    console.log(`queueCancelled: ${executeSummary.queueCancelled}`);
    console.log(`rowsCancelled: ${executeSummary.rowsCancelled}`);
    console.log(`filesDeleted: ${executeSummary.filesDeleted}`);
    console.log(`bytesFreed: ${fmtBytes(executeSummary.bytesFreed)}`);
    console.log(`capacity.pendingUploadCount: ${capacityAfter.pendingUploadCount}`);
    console.log(`capacity.unpublishedRenderedCount: ${capacityAfter.unpublishedRenderedCount}`);
    console.log(`capacity.mediaTotalBytes: ${fmtBytes(capacityAfter.mediaTotalBytes)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
