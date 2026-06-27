import { config as loadEnv } from "dotenv";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pg from "pg";
import {
  buildSubtitleChunks,
  buildSubtitleChunksFromWords,
  validateAndRepairSubtitleChunks,
  type SpeechSegment,
  type WordTimestamp,
} from "@/lib/video/subtitle";

loadEnv({ path: ".env.local" });
loadEnv();

const { Pool } = pg;
const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;

const LEGACY_BATCH_PATH = path.join(process.cwd(), "output", "legacy-quote-short-v1", "experiment-batch.json");
const PREVIEW_PATH = path.join(process.cwd(), "output", "manifests", "alternating-short-experiment-schedule.json");
const WHISPER_SCRIPT = path.join(process.cwd(), "tts-server", "whisper_timestamps.py");
const VENV_PYTHON = path.join(process.env.HOME ?? "", "venv-tts-new", "bin", "python3");
const EXECUTE = process.argv.includes("--execute");
const PAIRS_ARG = process.argv.find((arg) => arg.startsWith("--pairs="));
const REQUESTED_PAIR_COUNT = PAIRS_ARG ? Number.parseInt(PAIRS_ARG.split("=")[1] ?? "", 10) : null;
const DEFAULT_CHANNEL_KEY = "phat_phap";
const DEFAULT_INTERVAL_MIN = 60;
const VIETNAM_OFFSET_HOURS = 7;
const MAX_PAIR_COUNT = 50;

type LegacyBatchSample = {
  contentId: string;
  topic: string;
  topicFamily: string;
  quoteText: string;
  visualMode: string;
  motionStrength: string;
  musicPath: string;
  duration: number;
  outputVideoPath: string;
  meanVolumeDb: number;
  maxVolumeDb: number;
  motionScore: number;
};

type LegacyBatch = {
  formatType: string;
  experimentId: string;
  experimentVariant: string;
  samples: LegacyBatchSample[];
};

type SocialChannelRow = {
  id: number;
  platform: string;
  channel_key: string;
  name: string;
  platform_channel_id: string | null;
  is_active: boolean;
  needs_reconnect: boolean;
};

type DestinationConfig = {
  enabled: boolean;
  channelId: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  privacyStatus: "public" | "unlisted" | "private";
};

type ActiveDestination = DestinationConfig & {
  platform: "youtube" | "facebook";
  name: string;
  channelKey: string;
  platformChannelId: string | null;
};

type TtsCandidateRow = {
  id: string;
  topic: string;
  niche_name: string;
  niche_id: number;
  content_profile_key: string | null;
  channel_key: string | null;
  script: string;
  short_content: string;
  short_selected_hook: string | null;
  audio_path: string | null;
  video_path: string | null;
  image_paths: string[] | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  created_at: Date;
};

type SubtitleHealth = {
  subtitleHealthScore: number;
  subtitleStatus: "PASS" | "FAIL";
};

type SelectedLegacy = LegacyBatchSample & {
  contentId: string;
  experimentId: string;
  experimentVariant: string;
  formatType: string;
};

type SelectedTts = TtsCandidateRow & SubtitleHealth;

type ScheduleItem = {
  slotIndex: number;
  slotKind: "legacy_quote" | "tts_short";
  contentId: string;
  topic: string;
  formatType: string;
  experimentId: string;
  experimentVariant: string;
  videoPath: string;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  subtitleHealthScore: number | null;
  subtitleStatus: "PASS" | "FAIL" | null;
  legacyVisualMode?: string;
  legacyMotionStrength?: string;
  destinations: Array<{
    platform: "youtube" | "facebook";
    channelId: number;
    channelName: string;
    privacyStatus: string;
  }>;
};

function createPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

function readLegacyBatch(): LegacyBatch {
  if (!fs.existsSync(LEGACY_BATCH_PATH)) {
    throw new Error(`Legacy batch not found: ${LEGACY_BATCH_PATH}`);
  }
  return JSON.parse(fs.readFileSync(LEGACY_BATCH_PATH, "utf8")) as LegacyBatch;
}

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function toRepoRelative(absPath: string): string {
  return path.relative(process.cwd(), absPath) || ".";
}

function parseTimeString(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

function toVietnamParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number.parseInt(map.year, 10),
    month: Number.parseInt(map.month, 10),
    day: Number.parseInt(map.day, 10),
    hour: Number.parseInt(map.hour, 10),
    minute: Number.parseInt(map.minute, 10),
  };
}

function fromVietnamLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - VIETNAM_OFFSET_HOURS, minute, 0, 0));
}

function addVietnamDays(parts: { year: number; month: number; day: number }, dayOffset: number) {
  const base = fromVietnamLocal(parts.year, parts.month, parts.day, 12, 0);
  const next = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  const nextParts = toVietnamParts(next);
  return {
    year: nextParts.year,
    month: nextParts.month,
    day: nextParts.day,
  };
}

function formatVietnam(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

async function inspectMedia(absPath: string): Promise<{ durationSec: number }> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-f", "null", "-"], { timeout: 30_000 })
    .catch((error: { stderr: string }) => ({ stderr: error.stderr }));
  const stderr = (result as { stderr: string }).stderr;
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!durationMatch) {
    throw new Error(`Unable to inspect media: ${absPath}`);
  }
  const durationSec =
    Number.parseInt(durationMatch[1], 10) * 3600 +
    Number.parseInt(durationMatch[2], 10) * 60 +
    Number.parseFloat(durationMatch[3]);
  return { durationSec };
}

async function getWhisperWordTimestamps(absPath: string): Promise<WordTimestamp[]> {
  try {
    const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
    const result = await execFileAsync(pythonBin, [WHISPER_SCRIPT, absPath], { timeout: 120_000 });
    const data = JSON.parse(result.stdout) as { success: boolean; words?: WordTimestamp[] };
    if (!data.success || !data.words || data.words.length < 5) return [];
    return data.words;
  } catch {
    return [];
  }
}

async function getAudioSpeechSegments(absPath: string, totalDuration: number): Promise<SpeechSegment[]> {
  const result = await execFileAsync(FFMPEG_PATH, [
    "-i", absPath,
    "-af", "silencedetect=n=-40dB:d=0.2",
    "-f", "null", "-",
  ], { timeout: 30_000 }).catch((error: { stderr: string }) => ({ stderr: error.stderr }));

  const stderr = (result as { stderr: string }).stderr;
  const silenceStarts: number[] = [];
  const silenceEnds: number[] = [];

  for (const line of stderr.split("\n")) {
    const sStart = line.match(/silence_start:\s*([\d.]+)/);
    if (sStart) silenceStarts.push(Number.parseFloat(sStart[1]));
    const sEnd = line.match(/silence_end:\s*([\d.]+)/);
    if (sEnd) silenceEnds.push(Number.parseFloat(sEnd[1]));
  }

  const segments: SpeechSegment[] = [];
  let cursor = 0;

  if (silenceEnds.length > 0 && silenceStarts.length > 0 && silenceStarts[0] < 0.15) {
    cursor = silenceEnds[0];
    silenceStarts.shift();
    silenceEnds.shift();
  } else if (silenceEnds.length > 0 && silenceStarts.length === 0) {
    return [];
  }

  const pairs = Math.min(silenceStarts.length, silenceEnds.length);
  for (let index = 0; index < pairs; index += 1) {
    if (silenceStarts[index] > cursor + 0.05) {
      segments.push({ start: cursor, end: silenceStarts[index] });
    }
    cursor = silenceEnds[index];
  }

  if (cursor < totalDuration - 0.05) {
    segments.push({ start: cursor, end: totalDuration });
  }

  return segments.length > 0 ? segments : [];
}

async function computeSubtitleHealth(row: TtsCandidateRow): Promise<SubtitleHealth> {
  const audioPath = resolveRepoPath(row.audio_path ?? "");
  const audioInfo = await inspectMedia(audioPath);
  const speechSegments = await getAudioSpeechSegments(audioPath, audioInfo.durationSec);
  const words = await getWhisperWordTimestamps(audioPath);

  const chunks = words.length >= 5
    ? buildSubtitleChunksFromWords(words, row.short_content || row.script)
    : buildSubtitleChunks(row.short_content || row.script, audioInfo.durationSec, speechSegments);

  const validation = validateAndRepairSubtitleChunks(chunks, audioInfo.durationSec, speechSegments);

  return {
    subtitleHealthScore: validation.subtitleHealthScore,
    subtitleStatus: validation.status,
  };
}

async function loadActiveDestinations(client: pg.PoolClient): Promise<ActiveDestination[]> {
  const [{ getChannelPublishConfig }, metadataModule] = await Promise.all([
    import("@/lib/config/channel-configs"),
    import("@/lib/social/youtube-metadata"),
  ]);
  void metadataModule;

  const publishConfig = await getChannelPublishConfig(DEFAULT_CHANNEL_KEY);
  if (!publishConfig) {
    throw new Error(`Publish config not found for channel key ${DEFAULT_CHANNEL_KEY}`);
  }

  const enabledDestinations = publishConfig.shortDestinations.filter((destination) => destination.enabled);
  if (enabledDestinations.length === 0) {
    return [];
  }

  const channelIds = enabledDestinations.map((destination) => destination.channelId);
  const result = await client.query<SocialChannelRow>(
    `
      SELECT id, platform, channel_key, name, platform_channel_id, is_active, needs_reconnect
      FROM social_channels
      WHERE id = ANY($1::int[])
    `,
    [channelIds],
  );
  const channelMap = new Map(result.rows.map((row) => [row.id, row]));

  return enabledDestinations.flatMap((destination) => {
    const channel = channelMap.get(destination.channelId);
    if (!channel || !channel.is_active || channel.needs_reconnect) return [];
    if (channel.platform !== "youtube" && channel.platform !== "facebook") return [];
    return [{
      ...destination,
      platform: channel.platform as "youtube" | "facebook",
      name: channel.name,
      channelKey: channel.channel_key,
      platformChannelId: channel.platform_channel_id,
    }];
  });
}

async function loadCarryForwardTtsCandidates(client: pg.PoolClient): Promise<TtsCandidateRow[]> {
  const result = await client.query<TtsCandidateRow>(
    `
      WITH content_flags AS (
        SELECT
          cg.*,
          EXISTS (SELECT 1 FROM published_videos pv WHERE pv.content_id = cg.id) AS has_published_video,
          EXISTS (SELECT 1 FROM upload_queue uq WHERE uq.content_id = cg.id AND uq.status = 'done') AS has_done_queue,
          EXISTS (
            SELECT 1
            FROM upload_queue uq
            WHERE uq.content_id = cg.id
              AND uq.video_type = 'short'
              AND uq.status = ANY(ARRAY['queued', 'uploading'])
          ) AS has_active_short_queue
        FROM content_generations cg
      )
      SELECT
        id,
        topic,
        niche_name,
        niche_id,
        content_profile_key,
        channel_key,
        script,
        short_content,
        short_selected_hook,
        audio_path,
        video_path,
        image_paths,
        experiment_id,
        experiment_variant,
        created_at
      FROM content_flags
      WHERE NOT has_published_video
        AND NOT has_done_queue
        AND NOT has_active_short_queue
        AND youtube_video_url IS NULL
        AND facebook_video_url IS NULL
        AND long_youtube_video_url IS NULL
        AND COALESCE(content_mode, 'both') IN ('short', 'both')
        AND COALESCE(tts_status, 'pending') = 'done'
        AND COALESCE(video_status, 'pending') = 'done'
        AND audio_path IS NOT NULL
        AND video_path IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 50
    `,
  );

  return result.rows.filter((row) => {
    if (!row.audio_path || !row.video_path) return false;
    return fs.existsSync(resolveRepoPath(row.audio_path)) && fs.existsSync(resolveRepoPath(row.video_path));
  });
}

async function loadExistingDestinationTakenTimes(
  client: pg.PoolClient,
  destination: ActiveDestination,
  excludeContentIds: string[],
): Promise<number[]> {
  const usesPlatformChannelId = !!destination.platformChannelId;
  const result = await client.query<{ scheduled_at: Date }>(
    `
      SELECT uq.scheduled_at
      FROM upload_queue uq
      INNER JOIN social_channels sc ON sc.id = uq.channel_id
      WHERE uq.status = ANY($1::text[])
        AND uq.video_type = 'short'
        AND (
          ($2::text IS NOT NULL AND sc.platform = $3::text AND sc.platform_channel_id = $2::text)
          OR
          ($2::text IS NULL AND uq.channel_id = $4::int)
        )
        AND NOT (uq.content_id = ANY($5::text[]))
      ORDER BY uq.scheduled_at ASC
    `,
    [["queued", "uploading"], usesPlatformChannelId ? destination.platformChannelId : null, destination.platform, destination.channelId, excludeContentIds.length > 0 ? excludeContentIds : [""]],
  );
  return result.rows.map((row) => new Date(row.scheduled_at).getTime());
}

async function ensureLegacyRows(
  client: pg.PoolClient,
  selectedLegacy: SelectedLegacy[],
): Promise<{ inserted: number; existing: number }> {
  if (selectedLegacy.length === 0) return { inserted: 0, existing: 0 };

  const nicheResult = await client.query<{
    id: number;
    name: string;
    content_profile_key: string;
    channel_key: string;
  }>(
    `
      SELECT id, name, content_profile_key, channel_key
      FROM niches
      WHERE channel_key = $1
        AND is_active = true
      ORDER BY id ASC
      LIMIT 1
    `,
    [DEFAULT_CHANNEL_KEY],
  );
  const niche = nicheResult.rows[0];
  if (!niche) {
    throw new Error(`Active niche not found for channel key ${DEFAULT_CHANNEL_KEY}`);
  }

  const existingResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM content_generations
      WHERE id = ANY($1::text[])
    `,
    [selectedLegacy.map((sample) => sample.contentId)],
  );
  const existingIds = new Set(existingResult.rows.map((row) => row.id));

  let inserted = 0;
  for (const sample of selectedLegacy) {
    if (existingIds.has(sample.contentId)) continue;
    const relVideoPath = toRepoRelative(sample.outputVideoPath);
    await client.query(
      `
        INSERT INTO content_generations (
          id,
          topic,
          niche_id,
          niche_name,
          content_profile_key,
          channel_key,
          script,
          short_content,
          short_selected_hook,
          long_content,
          experiment_id,
          experiment_variant,
          status,
          tts_status,
          images_status,
          video_status,
          video_path,
          content_mode,
          media_cleaned_at,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $7, $7, $7, $8, $9, 'completed', 'done', 'done', 'done', $10, 'short', NULL, NOW()
        )
      `,
      [
        sample.contentId,
        sample.topic,
        niche.id,
        niche.name,
        niche.content_profile_key,
        niche.channel_key,
        sample.quoteText,
        sample.experimentId,
        sample.experimentVariant,
        relVideoPath,
      ],
    );
    inserted += 1;
  }

  return {
    inserted,
    existing: selectedLegacy.length - inserted,
  };
}

function getCommonScheduleWindow(destinations: ActiveDestination[]): { windowStart: string; windowEnd: string } {
  if (destinations.length === 0) {
    return { windowStart: "08:00", windowEnd: "21:00" };
  }
  const start = Math.max(...destinations.map((destination) => parseTimeString(destination.windowStart)));
  const end = Math.min(...destinations.map((destination) => parseTimeString(destination.windowEnd)));
  if (start > end) {
    throw new Error("No overlapping VN publish window across active destinations.");
  }

  const toText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return {
    windowStart: toText(start),
    windowEnd: toText(end),
  };
}

function findAlternatingSlots(
  count: number,
  windowStart: string,
  windowEnd: string,
  intervalMin: number,
  takenPerDestination: number[][],
): Date[] {
  const now = new Date();
  const windowStartMin = parseTimeString(windowStart);
  const windowEndMin = parseTimeString(windowEnd);
  const slots: Date[] = [];
  const nowVn = toVietnamParts(now);

  for (let dayOffset = 0; dayOffset < 14 && slots.length < count; dayOffset += 1) {
    const currentDay = addVietnamDays(nowVn, dayOffset);
    for (let minute = windowStartMin; minute <= windowEndMin && slots.length < count; minute += intervalMin) {
      const candidate = fromVietnamLocal(
        currentDay.year,
        currentDay.month,
        currentDay.day,
        Math.floor(minute / 60),
        minute % 60,
      );
      if (candidate.getTime() <= now.getTime()) continue;

      const half = (intervalMin / 2) * 60_000;
      const hasConflict = takenPerDestination.some((takenList) =>
        takenList.some((takenTime) => Math.abs(takenTime - candidate.getTime()) < half)
      );
      if (hasConflict) continue;

      slots.push(candidate);
      for (const takenList of takenPerDestination) {
        takenList.push(candidate.getTime());
      }
    }
  }

  if (slots.length < count) {
    throw new Error(`Unable to find ${count} safe future slots within the active publish window.`);
  }
  return slots;
}

async function buildPreview(): Promise<{
  destinations: ActiveDestination[];
  selectedLegacy: SelectedLegacy[];
  selectedTts: SelectedTts[];
  schedule: ScheduleItem[];
  carryForwardCount: number;
}> {
  const legacyBatch = readLegacyBatch();
  const pool = createPool();
  const client = await pool.connect();

  try {
    const destinations = await loadActiveDestinations(client);
    const carryForwardTts = await loadCarryForwardTtsCandidates(client);
    const selectedTts: SelectedTts[] = [];

    for (const row of carryForwardTts) {
      const subtitle = await computeSubtitleHealth(row);
      if (subtitle.subtitleStatus !== "PASS") continue;
      if (subtitle.subtitleHealthScore < 90) continue;
      selectedTts.push({ ...row, ...subtitle });
      if (selectedTts.length >= legacyBatch.samples.length) break;
    }

    const availablePairCount = Math.min(legacyBatch.samples.length, selectedTts.length);
    const pairCount = REQUESTED_PAIR_COUNT === null
      ? availablePairCount
      : Math.min(REQUESTED_PAIR_COUNT, availablePairCount);
    const selectedLegacy = legacyBatch.samples.slice(0, pairCount).map((sample) => ({
      ...sample,
      experimentId: legacyBatch.experimentId,
      experimentVariant: legacyBatch.experimentVariant,
      formatType: legacyBatch.formatType,
    }));
    const chosenTts = selectedTts.slice(0, pairCount);

    const commonWindow = getCommonScheduleWindow(destinations);
    const unpublishedIdsExcludedFromTaken = carryForwardTts.map((row) => row.id);
    const takenPerDestination = await Promise.all(destinations.map((destination) =>
      loadExistingDestinationTakenTimes(client, destination, unpublishedIdsExcludedFromTaken)
    ));
    const slots = findAlternatingSlots(pairCount * 2, commonWindow.windowStart, commonWindow.windowEnd, DEFAULT_INTERVAL_MIN, takenPerDestination);

    const schedule: ScheduleItem[] = [];
    for (let index = 0; index < pairCount; index += 1) {
      const legacySlot = slots[index * 2];
      const ttsSlot = slots[index * 2 + 1];
      const legacy = selectedLegacy[index];
      const tts = chosenTts[index];
      const legacyVideoPath = resolveRepoPath(legacy.outputVideoPath);
      const ttsVideoPath = resolveRepoPath(tts.video_path ?? "");

      schedule.push({
        slotIndex: schedule.length + 1,
        slotKind: "legacy_quote",
        contentId: legacy.contentId,
        topic: legacy.topic,
        formatType: legacy.formatType,
        experimentId: legacy.experimentId,
        experimentVariant: legacy.experimentVariant,
        videoPath: toRepoRelative(legacyVideoPath),
        scheduledAtUtc: legacySlot.toISOString(),
        scheduledAtVn: formatVietnam(legacySlot),
        subtitleHealthScore: null,
        subtitleStatus: null,
        legacyVisualMode: legacy.visualMode,
        legacyMotionStrength: legacy.motionStrength,
        destinations: destinations.map((destination) => ({
          platform: destination.platform,
          channelId: destination.channelId,
          channelName: destination.name,
          privacyStatus: destination.platform === "facebook" ? "public" : destination.privacyStatus,
        })),
      });

      schedule.push({
        slotIndex: schedule.length + 1,
        slotKind: "tts_short",
        contentId: tts.id,
        topic: tts.topic,
        formatType: "pipeline_tts_ai_image",
        experimentId: tts.experiment_id ?? "TTS_BASELINE",
        experimentVariant: tts.experiment_variant ?? "TTS_BASELINE",
        videoPath: toRepoRelative(ttsVideoPath),
        scheduledAtUtc: ttsSlot.toISOString(),
        scheduledAtVn: formatVietnam(ttsSlot),
        subtitleHealthScore: tts.subtitleHealthScore,
        subtitleStatus: tts.subtitleStatus,
        destinations: destinations.map((destination) => ({
          platform: destination.platform,
          channelId: destination.channelId,
          channelName: destination.name,
          privacyStatus: destination.platform === "facebook" ? "public" : destination.privacyStatus,
        })),
      });
    }

    return {
      destinations,
      selectedLegacy,
      selectedTts: chosenTts,
      schedule,
      carryForwardCount: carryForwardTts.length,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function insertQueueRows(preview: Awaited<ReturnType<typeof buildPreview>>): Promise<void> {
  const pool = createPool();
  const client = await pool.connect();

  try {
    const [{ buildDefaultVideoDescription, buildDefaultVideoTitle, buildYouTubeVideoMetadata }] = await Promise.all([
      import("@/lib/social/youtube-metadata"),
    ]);

    await client.query("BEGIN");

    await ensureLegacyRows(client, preview.selectedLegacy);

    for (const item of preview.schedule) {
      const contentQuery = await client.query<{
        id: string;
        topic: string;
        niche_name: string;
        short_content: string;
        long_content: string;
        long_youtube_description: string | null;
        content_profile_key: string | null;
      }>(
        `
          SELECT
            id,
            topic,
            niche_name,
            short_content,
            long_content,
            long_youtube_description,
            content_profile_key
          FROM content_generations
          WHERE id = $1
          LIMIT 1
        `,
        [item.contentId],
      );
      const content = contentQuery.rows[0];
      if (!content) {
        throw new Error(`Content row missing for ${item.contentId}`);
      }

      for (const destination of item.destinations) {
        const existing = await client.query<{ id: string }>(
          `
            SELECT uq.id
            FROM upload_queue uq
            INNER JOIN social_channels sc ON sc.id = uq.channel_id
            WHERE uq.content_id = $1
              AND uq.video_type = 'short'
              AND uq.status = ANY($2::text[])
              AND (
                (sc.platform_channel_id IS NOT NULL AND sc.platform = $3 AND sc.platform_channel_id = $4)
                OR
                (sc.platform_channel_id IS NULL AND uq.channel_id = $5)
              )
            LIMIT 1
          `,
          [
            item.contentId,
            ["queued", "uploading", "done"],
            destination.platform,
            preview.destinations.find((row) => row.channelId === destination.channelId)?.platformChannelId ?? null,
            destination.channelId,
          ],
        );
        if (existing.rows.length > 0) continue;

        const metadata = destination.platform === "youtube"
          ? buildYouTubeVideoMetadata({
              contentType: "short",
              topic: content.topic,
              nicheName: content.niche_name,
              shortContent: content.short_content,
              longContent: content.long_content,
              longYoutubeDescription: content.long_youtube_description,
              contentProfileKey: content.content_profile_key,
            })
          : {
              title: buildDefaultVideoTitle({
                platform: "facebook",
                contentType: "short",
                topic: content.topic,
                contentProfileKey: content.content_profile_key,
                shortContent: content.short_content,
              }),
              description: buildDefaultVideoDescription({
                platform: "facebook",
                contentType: "short",
                topic: content.topic,
                nicheName: content.niche_name,
                shortContent: content.short_content,
                longContent: content.long_content,
                longYoutubeDescription: content.long_youtube_description,
                contentProfileKey: content.content_profile_key,
              }),
              tags: [] as string[],
            };

        await client.query(
          `
            INSERT INTO upload_queue (
              id,
              content_id,
              channel_id,
              platform,
              video_type,
              title,
              description,
              tags,
              privacy_status,
              scheduled_at,
              status,
              created_at,
              updated_at
            ) VALUES (
              $1, $2, $3, $4, 'short', $5, $6, $7::jsonb, $8, $9, 'queued', NOW(), NOW()
            )
          `,
          [
            crypto.randomUUID(),
            item.contentId,
            destination.channelId,
            destination.platform,
            metadata.title,
            metadata.description,
            JSON.stringify(metadata.tags),
            destination.platform === "facebook" ? "public" : destination.privacyStatus,
            item.scheduledAtUtc,
          ],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (REQUESTED_PAIR_COUNT !== null) {
    if (!Number.isFinite(REQUESTED_PAIR_COUNT) || REQUESTED_PAIR_COUNT <= 0 || REQUESTED_PAIR_COUNT > MAX_PAIR_COUNT) {
      throw new Error(`--pairs must be an integer between 1 and ${MAX_PAIR_COUNT}.`);
    }
  }
  const preview = await buildPreview();
  const previewPayload = {
    generatedAt: new Date().toISOString(),
    execute: EXECUTE,
    requestedPairCount: REQUESTED_PAIR_COUNT,
    activeDestinations: preview.destinations.map((destination) => ({
      platform: destination.platform,
      channelId: destination.channelId,
      channelName: destination.name,
      windowStart: destination.windowStart,
      windowEnd: destination.windowEnd,
      intervalMin: destination.intervalMin,
      privacyStatus: destination.privacyStatus,
    })),
    carryForwardTtsCandidates: preview.carryForwardCount,
    selectedLegacyCount: preview.selectedLegacy.length,
    selectedTtsCount: preview.selectedTts.length,
    schedule: preview.schedule,
  };

  fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
  fs.writeFileSync(PREVIEW_PATH, JSON.stringify(previewPayload, null, 2), "utf8");

  console.log(`preview written: ${toRepoRelative(PREVIEW_PATH)}`);
  console.log(`active destinations: ${preview.destinations.map((destination) => `${destination.platform}:${destination.name}`).join(", ") || "none"}`);
  console.log(`carry-forward TTS candidates: ${preview.carryForwardCount}`);
  console.log(`selected legacy: ${preview.selectedLegacy.length}`);
  console.log(`selected TTS: ${preview.selectedTts.length}`);

  for (const item of preview.schedule.slice(0, 12)) {
    console.log(`${String(item.slotIndex).padStart(2, "0")}. ${item.scheduledAtVn} | ${item.slotKind} | ${item.contentId} | ${item.topic}`);
  }

  if (!EXECUTE) return;

  await insertQueueRows(preview);
  console.log("queue rows inserted in queued state only; no upload triggered.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
