/**
 * Pre-Publish Quality Audit
 *
 * Read-only scan of upcoming queued content for TTS, visual, workspace, and
 * publishing readiness risks. Writes:
 *   docs/PRE_PUBLISH_QUALITY_AUDIT.md
 *   output/manifests/pre-publish-quality-audit.json
 *
 * DOES NOT: upload, schedule, mutate queue/DB, delete media.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const NOW = new Date();
const FIX_TYPE_A_TS = new Date("2026-06-04T04:33:00Z"); // commit 3741701
const FIX_TYPE_B_TS = new Date("2026-06-08T00:00:00Z"); // today's nh-fix commit

// ── Normalizer (must stay in sync with src/lib/pipeline/tts.ts) ─────────────

function normalizeTextForTTS(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/(nh\p{L}*),\s*(nh)/gu, "$1. $2")
    .trim();
}

function buildTextHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ── Risk types ───────────────────────────────────────────────────────────────

type Severity = "high" | "medium" | "low";
interface Risk {
  riskCode: string;
  severity: Severity;
  description: string;
  snippet?: string;
  fixedByNormalizer?: boolean;
  renderedBeforeFix?: boolean;
  audioMtime?: string;
}

interface AuditItem {
  queueId: string;
  contentId: string;
  platform: string;
  channelName: string;
  channelKey: string;
  contentChannelKey: string;
  nicheProfileKey: string | null;
  scheduledAt: Date;
  scheduledAtVN: string;
  formatType: string;
  videoType: string;
  experimentVariant: string | null;
  topic: string;
  ttsVoice: string | null;
  audioPath: string | null;
  videoPath: string | null;
  audioExists: boolean;
  videoExists: boolean;
  audioDurationS: number | null;
  videoDurationS: number | null;
  mediaCleanedAt: string | null;
  needsReconnect: boolean;
  channelActive: boolean;
  quotaExceededUntil: string | null;
  prevErrorMessage: string | null;
  channelLastError: string | null;
  risks: Risk[];
  alreadyPublished: boolean;
  duplicateQueued: boolean;
  scheduledInPast: boolean;
  sidecarWorkspaceId?: string;
  sidecarChannelProfileId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toVietnamTime(d: Date): string {
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

async function getMediaDuration(absPath: string): Promise<number | null> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath], { timeout: 10_000 }).catch(e => ({ stderr: (e as { stderr?: string }).stderr ?? "" }));
    const output = (result as { stderr: string }).stderr ?? "";
    const m = output.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch {
    return null;
  }
}

function resolveMediaPath(rel: string): string {
  if (path.isAbsolute(rel)) return rel;
  return path.join(process.cwd(), rel.replace(/^\/+/, ""));
}

// ── TTS risk checks ──────────────────────────────────────────────────────────

const TYPE_A_PATTERN = /^\s*(?:[-*_]\s*){3,}/;

const CONSONANT_PAIR_PATTERNS: Array<{ code: string; re: RegExp; initial: string }> = [
  { code: "TTS_NG_PAIR",  re: /(ng\p{L}*),\s*(ng)/u,  initial: "ng" },
  { code: "TTS_CH_PAIR",  re: /(ch\p{L}*),\s*(ch)/u,  initial: "ch" },
  { code: "TTS_TR_PAIR",  re: /(tr\p{L}*),\s*(tr)/u,  initial: "tr" },
  { code: "TTS_TH_PAIR",  re: /(th\p{L}*),\s*(th)/u,  initial: "th" },
  { code: "TTS_GI_PAIR",  re: /(gi\p{L}*),\s*(gi)/u,  initial: "gi" },
];

function checkTTSRisks(rawText: string, audioMtime: Date | null, ttsVoice: string | null): Risk[] {
  const risks: Risk[] = [];
  const normalized = normalizeTextForTTS(rawText);
  const rawHash = buildTextHash(rawText);
  const newHash = buildTextHash(normalized);
  const hashChanges = rawHash !== newHash;
  const audioMtimeStr = audioMtime?.toISOString() ?? null;

  // Type A — markdown separator
  if (TYPE_A_PATTERN.test(rawText)) {
    const snippet = rawText.trimStart().slice(0, 40).replace(/\n/g, "↵");
    const renderedBeforeFix = audioMtime ? audioMtime < FIX_TYPE_A_TS : true;
    risks.push({
      riskCode: "TTS_TYPE_A_SEPARATOR",
      severity: renderedBeforeFix ? "high" : "medium",
      description: "short_content starts with Markdown separator (--- / *** / ___).",
      snippet,
      fixedByNormalizer: true,
      renderedBeforeFix,
      audioMtime: audioMtimeStr ?? undefined,
    });
  }

  // Type B — nh-comma-nh (now fixed in normalizer)
  const nhMatch = /(nh\p{L}*),\s*(nh\p{L}*)/u.exec(rawText);
  if (nhMatch) {
    const renderedBeforeFix = audioMtime ? audioMtime < FIX_TYPE_B_TS : false;
    risks.push({
      riskCode: "TTS_TYPE_B_NH_PAIR",
      severity: renderedBeforeFix ? "high" : "low",
      description: `nh-comma-nh pair confirmed. Normalizer fix applied. ${renderedBeforeFix ? "Audio rendered BEFORE fix — may still have artifact." : "Audio rendered after fix — safe."}`,
      snippet: nhMatch[0],
      fixedByNormalizer: true,
      renderedBeforeFix,
      audioMtime: audioMtimeStr ?? undefined,
    });
  }

  // Potential similar consonant pairs (report only, no evidence yet)
  for (const { code, re, initial } of CONSONANT_PAIR_PATTERNS) {
    const m = re.exec(rawText);
    if (m) {
      risks.push({
        riskCode: code,
        severity: "low",
        description: `${initial}-comma-${initial} pair found. Not yet confirmed as TTS artifact — report only.`,
        snippet: m[0],
        fixedByNormalizer: false,
      });
    }
  }

  // Suspicious punctuation
  if (/^[-:•◦●]/m.test(rawText.trimStart())) {
    risks.push({
      riskCode: "TTS_MARKDOWN_BULLETS",
      severity: "medium",
      description: "short_content starts with bullet/dash/colon which may affect TTS prosody.",
      snippet: rawText.trimStart().slice(0, 50),
    });
  }

  if (/\.{3,}/.test(rawText.slice(0, 100))) {
    risks.push({
      riskCode: "TTS_ELLIPSIS_OPENING",
      severity: "low",
      description: "First 100 chars contain ellipsis (…) which may cause TTS pause artifact.",
      snippet: rawText.slice(0, 80),
    });
  }

  if (/[^\w\s\p{L}\p{N}\p{P}]/u.test(rawText.slice(0, 200))) {
    risks.push({
      riskCode: "TTS_UNUSUAL_CHARS",
      severity: "low",
      description: "Opening 200 chars contain unusual characters.",
      snippet: rawText.slice(0, 80),
    });
  }

  // Normalizer changes hash — this means cached audio would miss and retrigger TTS
  if (hashChanges) {
    risks.push({
      riskCode: "TTS_NORMALIZER_CHANGES_HASH",
      severity: "low",
      description: "normalizeTextForTTS changes the text (hash differs). Cache miss expected on next render.",
      fixedByNormalizer: true,
    });
  }

  // Short first sentence (< 5 words) before first comma
  const firstClause = normalized.split(/[.,!?]/)[0] ?? "";
  const wordCount = firstClause.trim().split(/\s+/).length;
  if (wordCount < 5 && wordCount > 0) {
    risks.push({
      riskCode: "TTS_SHORT_OPENING_CLAUSE",
      severity: "low",
      description: `Opening clause has only ${wordCount} word(s) before first punctuation — may sound abrupt.`,
      snippet: firstClause.trim().slice(0, 60),
    });
  }

  // Voice mismatch signal — only ngoc confirmed for Type B, flag if voice is different
  if (ttsVoice && ttsVoice.toLowerCase() !== "ngoc" && nhMatch) {
    risks.push({
      riskCode: "TTS_VOICE_UNVERIFIED_NH_PAIR",
      severity: "low",
      description: `nh-comma-nh pair present but voice is "${ttsVoice}" (artifact confirmed only for "ngoc"). Normalizer fix still applied.`,
    });
  }

  return risks;
}

// ── Visual / workspace checks ────────────────────────────────────────────────

const TANG_SAU_VISUAL_BLACKLIST = [
  "Buddha", "temple", "monk", "prayer", "praying", "lotus", "Buddhist", "spiritual",
  "meditation pose", "old temple", "chắp tay", "nhà thờ", "đền", "chùa",
  "tượng phật", "phật", "bồ tát", "niệm phật",
];

const PHAT_PHAP_DARK_VISUAL_RISK = [
  "urban sadness", "lonely city", "isolation", "dark alley", "abandoned",
  "gloomy", "melancholic street", "depressing",
];

function checkVisualRisks(
  formatType: string,
  contentChannelKey: string,
  scChannelKey: string,
  nicheProfileKey: string | null,
  sidecarChannelProfileId: string | undefined,
  sidecarWorkspaceId: string | undefined,
  topic: string,
): Risk[] {
  const risks: Risk[] = [];

  // Channel key mismatch
  if (contentChannelKey !== scChannelKey) {
    risks.push({
      riskCode: "CHANNEL_KEY_MISMATCH",
      severity: "high",
      description: `content.channelKey="${contentChannelKey}" does not match destination channel.channelKey="${scChannelKey}". Wrong channel destination.`,
    });
  }

  // Tầng Sâu specific
  if (scChannelKey === "tang_sau") {
    if (nicheProfileKey && nicheProfileKey !== "psychology" && nicheProfileKey !== "philosophy") {
      risks.push({
        riskCode: "TANG_SAU_WRONG_PROFILE",
        severity: "high",
        description: `Tầng Sâu content has niche profile "${nicheProfileKey}" — expected "psychology" or "philosophy".`,
      });
    }
    if (sidecarChannelProfileId && sidecarChannelProfileId !== "tang_sau_v1") {
      risks.push({
        riskCode: "TANG_SAU_SIDECAR_PROFILE_MISMATCH",
        severity: "medium",
        description: `Sidecar channelProfileId="${sidecarChannelProfileId}" — expected "tang_sau_v1" for Tầng Sâu channel.`,
      });
    }
    if (sidecarWorkspaceId && sidecarWorkspaceId !== "tang_sau_workspace") {
      risks.push({
        riskCode: "TANG_SAU_SIDECAR_WORKSPACE_MISMATCH",
        severity: "medium",
        description: `Sidecar workspaceId="${sidecarWorkspaceId}" — expected "tang_sau_workspace".`,
      });
    }
    // Scan topic for visual blacklist hints
    for (const term of TANG_SAU_VISUAL_BLACKLIST) {
      if (topic.toLowerCase().includes(term.toLowerCase())) {
        risks.push({
          riskCode: "TANG_SAU_TOPIC_VISUAL_RISK",
          severity: "medium",
          description: `Topic contains "${term}" which is in Tầng Sâu visual blacklist. Review image before publishing.`,
          snippet: topic,
        });
        break;
      }
    }
  }

  // Buddhist channel specific
  if (scChannelKey === "phat_phap") {
    if (nicheProfileKey && nicheProfileKey !== "buddhism") {
      risks.push({
        riskCode: "PHAT_PHAP_WRONG_PROFILE",
        severity: "high",
        description: `Giới Định Tuệ content has niche profile "${nicheProfileKey}" — expected "buddhism".`,
      });
    }
    for (const term of PHAT_PHAP_DARK_VISUAL_RISK) {
      if (topic.toLowerCase().includes(term.toLowerCase())) {
        risks.push({
          riskCode: "PHAT_PHAP_DARK_TOPIC",
          severity: "low",
          description: `Topic "${topic}" suggests dark/urban visual style — may not match Buddhist channel aesthetic.`,
          snippet: topic,
        });
        break;
      }
    }
  }

  return risks;
}

// ── Publishing readiness checks ──────────────────────────────────────────────

function checkPublishingReadiness(item: {
  audioPath: string | null;
  videoPath: string | null;
  audioExists: boolean;
  videoExists: boolean;
  mediaCleanedAt: string | null;
  needsReconnect: boolean;
  channelActive: boolean;
  quotaExceededUntil: string | null;
  channelLastError: string | null;
  prevErrorMessage: string | null;
  scheduledAt: Date;
  alreadyPublished: boolean;
  duplicateQueued: boolean;
  formatType: string;
}): Risk[] {
  const risks: Risk[] = [];

  // Media checks
  if (item.mediaCleanedAt) {
    risks.push({
      riskCode: "MEDIA_CLEANED",
      severity: "high",
      description: `Media files were cleaned at ${item.mediaCleanedAt}. Video cannot be uploaded without re-rendering.`,
    });
  } else if (item.videoPath && !item.videoExists) {
    risks.push({
      riskCode: "VIDEO_FILE_MISSING",
      severity: "high",
      description: `video_path is set (${item.videoPath}) but file does not exist on disk.`,
    });
  } else if (!item.videoPath && item.formatType !== "facebook_quote_photo") {
    risks.push({
      riskCode: "VIDEO_PATH_NULL",
      severity: "high",
      description: "video_path is null — content may not have finished rendering.",
    });
  }

  if (item.audioPath && !item.audioExists && item.formatType === "tts_short") {
    risks.push({
      riskCode: "AUDIO_FILE_MISSING",
      severity: "medium",
      description: `audio_path is set (${item.audioPath}) but WAV file missing. Video may still be playable.`,
    });
  }

  // Stale scheduled_at
  if (item.scheduledAt < NOW) {
    const minutesLate = Math.round((NOW.getTime() - item.scheduledAt.getTime()) / 60_000);
    risks.push({
      riskCode: "SCHEDULED_IN_PAST",
      severity: minutesLate > 60 ? "high" : "medium",
      description: `scheduledAt is ${minutesLate} minute(s) in the past. Cron will upload immediately on next tick.`,
    });
  }

  // Channel health
  if (!item.channelActive) {
    risks.push({
      riskCode: "CHANNEL_INACTIVE",
      severity: "high",
      description: "Destination social_channel is marked inactive.",
    });
  }
  if (item.needsReconnect) {
    risks.push({
      riskCode: "CHANNEL_NEEDS_RECONNECT",
      severity: "high",
      description: "Destination channel has needsReconnect=true. OAuth token expired or revoked.",
    });
  }
  if (item.quotaExceededUntil) {
    const until = new Date(item.quotaExceededUntil);
    if (until > NOW) {
      risks.push({
        riskCode: "CHANNEL_QUOTA_EXCEEDED",
        severity: "high",
        description: `YouTube quota exceeded until ${toVietnamTime(until)}.`,
      });
    }
  }
  if (item.channelLastError) {
    risks.push({
      riskCode: "CHANNEL_LAST_ERROR",
      severity: "medium",
      description: `Channel last error: ${item.channelLastError.slice(0, 100)}`,
    });
  }

  // Already published / duplicate
  if (item.alreadyPublished) {
    risks.push({
      riskCode: "ALREADY_PUBLISHED",
      severity: "high",
      description: "This content was already published to this platform/channel combination.",
    });
  }
  if (item.duplicateQueued) {
    risks.push({
      riskCode: "DUPLICATE_QUEUE_ROW",
      severity: "medium",
      description: "Multiple queued rows exist for the same content/platform/channel.",
    });
  }

  // Previous error
  if (item.prevErrorMessage) {
    risks.push({
      riskCode: "PREV_ERROR_MESSAGE",
      severity: "medium",
      description: `Queue row has prior error: ${item.prevErrorMessage.slice(0, 120)}`,
    });
  }

  return risks;
}

// ── Sidecar loader ───────────────────────────────────────────────────────────

function loadSidecar(contentId: string): { workspaceId?: string; channelProfileId?: string } {
  const base = path.join(process.cwd(), "output");
  try {
    const dirs = fs.readdirSync(base);
    for (const dir of dirs) {
      if (dir.startsWith("_") || dir === "manifests" || dir === "contact-sheets" || dir === "images") continue;
      const fp = path.join(base, dir, `${contentId}-legacy-quote-short.json`);
      if (fs.existsSync(fp)) {
        const data = JSON.parse(fs.readFileSync(fp, "utf8")) as Record<string, unknown>;
        return {
          workspaceId: data.workspaceId as string | undefined,
          channelProfileId: data.channelProfileId as string | undefined,
        };
      }
    }
  } catch { /* ignore */ }
  return {};
}

// ── Main audit ───────────────────────────────────────────────────────────────

async function main() {
  console.log("═══ Pre-Publish Quality Audit ═══");
  console.log(`Timestamp: ${toVietnamTime(NOW)} VN\n`);

  // ── Phase 1: Inventory ─────────────────────────────────────────────────────

  const rows = await db.execute(sql`
    SELECT
      uq.id        AS uq_id,
      uq.status,
      uq.platform,
      uq.video_type,
      uq.scheduled_at,
      uq.error_message AS uq_error,
      cg.id           AS content_id,
      cg.format_type,
      cg.channel_key  AS cg_channel_key,
      cg.audio_path,
      cg.video_path,
      cg.media_cleaned_at,
      cg.topic,
      cg.experiment_variant,
      cg.tts_status,
      cg.video_status,
      cg.short_content,
      sc.channel_key  AS sc_channel_key,
      sc.name         AS sc_name,
      sc.needs_reconnect,
      sc.is_active,
      sc.quota_exceeded_until,
      sc.last_error   AS sc_last_error,
      n.tts_voice,
      n.content_profile_key AS niche_profile
    FROM upload_queue uq
    JOIN content_generations cg ON cg.id = uq.content_id
    JOIN social_channels sc ON sc.id = uq.channel_id
    LEFT JOIN niches n ON n.id = cg.niche_id
    WHERE uq.status IN ('queued', 'uploading')
    ORDER BY uq.scheduled_at ASC
    LIMIT 200
  `);

  console.log(`Phase 1: Loaded ${rows.rows.length} queued items\n`);

  // Published videos for duplicate/already-published check
  const pubRows = await db.execute(sql`
    SELECT upload_queue_id, content_id, platform FROM published_videos
    WHERE created_at > NOW() - INTERVAL '30 days'
  `);
  const publishedUQIds = new Set(pubRows.rows.map(r => r.upload_queue_id as string));
  const publishedContentPlatformKeys = new Set(
    pubRows.rows.map(r => `${r.content_id}:${r.platform}`)
  );

  // Duplicate queue detection — key must include video_type to avoid false-positives
  // when the same content has both a 'short' and a 'quote' row legitimately queued.
  const contentPlatformCount = new Map<string, number>();
  for (const r of rows.rows) {
    const k = `${r.content_id}:${r.platform}:${r.sc_channel_key}:${r.video_type}`;
    contentPlatformCount.set(k, (contentPlatformCount.get(k) ?? 0) + 1);
  }

  const items: AuditItem[] = [];

  for (const row of rows.rows) {
    const audioRel = row.audio_path as string | null;
    const videoRel = row.video_path as string | null;
    const audioAbs = audioRel ? resolveMediaPath(audioRel) : null;
    const videoAbs = videoRel ? resolveMediaPath(videoRel) : null;
    const audioExists = audioAbs ? fs.existsSync(audioAbs) : false;
    const videoExists = videoAbs ? fs.existsSync(videoAbs) : false;

    // Audio mtime for render-before-fix checks
    let audioMtime: Date | null = null;
    if (audioExists && audioAbs) {
      try { audioMtime = fs.statSync(audioAbs).mtime; } catch { /* ignore */ }
    }

    const scheduledAt = new Date(row.scheduled_at as string);
    const alreadyPublished = publishedUQIds.has(row.uq_id as string) ||
      publishedContentPlatformKeys.has(`${row.content_id}:${row.platform}`);
    const dupKey = `${row.content_id}:${row.platform}:${row.sc_channel_key}:${row.video_type}`;
    const duplicateQueued = (contentPlatformCount.get(dupKey) ?? 0) > 1;

    // Duration check (expensive — only if video exists)
    const audioDurationS: number | null = null;
    let videoDurationS: number | null = null;
    if (videoExists && videoAbs) {
      videoDurationS = await getMediaDuration(videoAbs);
    }

    // Sidecar for legacy quote items
    const sidecar = row.format_type === "legacy_quote_short"
      ? loadSidecar(row.content_id as string)
      : {};

    const contentChannelKey = row.cg_channel_key as string;
    const scChannelKey = row.sc_channel_key as string;
    const formatType = row.format_type as string;
    const shortContent = row.short_content as string | null;
    const ttsVoice = row.tts_voice as string | null;
    const nicheProfile = row.niche_profile as string | null;

    // ── Phase 2: TTS risks ─────────────────────────────────────────────────
    const ttsRisks: Risk[] = formatType === "tts_short" && shortContent
      ? checkTTSRisks(shortContent, audioMtime, ttsVoice)
      : [];

    // ── Phase 4: Visual/workspace risks ───────────────────────────────────
    const visualRisks = checkVisualRisks(
      formatType,
      contentChannelKey,
      scChannelKey,
      nicheProfile,
      sidecar.channelProfileId,
      sidecar.workspaceId,
      row.topic as string,
    );

    // ── Phase 5: Publishing readiness ─────────────────────────────────────
    const publishRisks = checkPublishingReadiness({
      audioPath: audioRel,
      videoPath: videoRel,
      audioExists,
      videoExists,
      mediaCleanedAt: row.media_cleaned_at as string | null,
      needsReconnect: row.needs_reconnect as boolean,
      channelActive: row.is_active as boolean,
      quotaExceededUntil: row.quota_exceeded_until as string | null,
      channelLastError: row.sc_last_error as string | null,
      prevErrorMessage: row.uq_error as string | null,
      scheduledAt,
      alreadyPublished,
      duplicateQueued,
      formatType,
    });

    items.push({
      queueId: row.uq_id as string,
      contentId: row.content_id as string,
      platform: row.platform as string,
      channelName: row.sc_name as string,
      channelKey: scChannelKey,
      contentChannelKey,
      nicheProfileKey: nicheProfile,
      scheduledAt,
      scheduledAtVN: toVietnamTime(scheduledAt),
      formatType,
      videoType: row.video_type as string,
      experimentVariant: row.experiment_variant as string | null,
      topic: row.topic as string,
      ttsVoice,
      audioPath: audioRel,
      videoPath: videoRel,
      audioExists,
      videoExists,
      audioDurationS,
      videoDurationS,
      mediaCleanedAt: row.media_cleaned_at as string | null,
      needsReconnect: row.needs_reconnect as boolean,
      channelActive: row.is_active as boolean,
      quotaExceededUntil: row.quota_exceeded_until as string | null,
      prevErrorMessage: row.uq_error as string | null,
      channelLastError: row.sc_last_error as string | null,
      risks: [...ttsRisks, ...visualRisks, ...publishRisks],
      alreadyPublished,
      duplicateQueued,
      scheduledInPast: scheduledAt < NOW,
      sidecarWorkspaceId: sidecar.workspaceId,
      sidecarChannelProfileId: sidecar.channelProfileId,
    });
  }

  // ── Phase 6: Build report ──────────────────────────────────────────────────

  const highRisks = items.filter(i => i.risks.some(r => r.severity === "high"));
  const mediumRisks = items.filter(i => i.risks.some(r => r.severity === "medium") && !highRisks.includes(i));
  const lowRisks = items.filter(i => i.risks.every(r => r.severity === "low") && i.risks.length > 0);
  const cleanItems = items.filter(i => i.risks.length === 0);

  const allRiskCodes = items.flatMap(i => i.risks.map(r => r.riskCode));
  const riskCodeCounts = allRiskCodes.reduce<Record<string, number>>((acc, code) => {
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});

  // Per-workspace breakdown
  const workspaceGroups: Record<string, AuditItem[]> = {};
  for (const item of items) {
    const key = item.channelName;
    (workspaceGroups[key] ??= []).push(item);
  }

  // Format counts by type
  const formatCounts: Record<string, number> = {};
  for (const item of items) {
    formatCounts[item.formatType] = (formatCounts[item.formatType] ?? 0) + 1;
  }

  // ── Build markdown ─────────────────────────────────────────────────────────

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w(`# Pre-Publish Quality Audit`);
  w(`**Generated:** ${toVietnamTime(NOW)} VN (${NOW.toISOString()})`);
  w(`**Scope:** Next 72 hours + all status=queued/uploading items`);
  w(`**Total queued items scanned:** ${items.length}`);
  w(``);

  // Summary table
  w(`## Summary`);
  w(``);
  w(`| Category | Count |`);
  w(`|---|---|`);
  w(`| Total queued items | ${items.length} |`);
  w(`| 🔴 HIGH severity (blockers) | ${highRisks.length} items |`);
  w(`| 🟡 MEDIUM severity (warnings) | ${mediumRisks.length} items |`);
  w(`| 🟢 LOW severity (observations) | ${lowRisks.length} items |`);
  w(`| ✅ Clean (no risks) | ${cleanItems.length} items |`);
  w(``);
  w(`**Format breakdown:**`);
  for (const [fmt, cnt] of Object.entries(formatCounts).sort()) {
    w(`- \`${fmt}\`: ${cnt}`);
  }
  w(``);
  w(`**Risk code frequency:**`);
  for (const [code, cnt] of Object.entries(riskCodeCounts).sort((a, b) => b[1] - a[1])) {
    w(`- \`${code}\`: ${cnt}`);
  }
  w(``);

  // High severity blockers
  if (highRisks.length > 0) {
    w(`## 🔴 High Severity Blockers`);
    w(``);
    for (const item of highRisks) {
      const hrs = item.risks.filter(r => r.severity === "high");
      w(`### ${item.topic.slice(0, 60)}`);
      w(`- **Queue ID:** \`${item.queueId}\``);
      w(`- **Content ID:** \`${item.contentId}\``);
      w(`- **Channel:** ${item.channelName} (${item.platform})`);
      w(`- **Scheduled:** ${item.scheduledAtVN}`);
      w(`- **Format:** ${item.formatType} / ${item.experimentVariant ?? "—"}`);
      for (const risk of hrs) {
        w(`- ❌ **${risk.riskCode}**: ${risk.description}${risk.snippet ? ` — \`${risk.snippet.slice(0, 80)}\`` : ""}`);
      }
      w(``);
    }
  } else {
    w(`## 🔴 High Severity Blockers`);
    w(``);
    w(`✅ None found.`);
    w(``);
  }

  // Medium severity
  if (mediumRisks.length > 0) {
    w(`## 🟡 Medium Severity Warnings`);
    w(``);
    for (const item of mediumRisks) {
      const mrs = item.risks.filter(r => r.severity === "medium");
      w(`### ${item.topic.slice(0, 60)}`);
      w(`- **Queue ID:** \`${item.queueId}\` | **Channel:** ${item.channelName} | **Scheduled:** ${item.scheduledAtVN}`);
      for (const risk of mrs) {
        w(`- ⚠️ **${risk.riskCode}**: ${risk.description}${risk.snippet ? ` — \`${risk.snippet.slice(0, 80)}\`` : ""}`);
      }
      w(``);
    }
  } else {
    w(`## 🟡 Medium Severity Warnings`);
    w(``);
    w(`✅ None found.`);
    w(``);
  }

  // Low severity
  if (lowRisks.length > 0) {
    w(`## 🟢 Low Severity Observations`);
    w(``);
    for (const item of lowRisks) {
      w(`- \`${item.queueId}\` **${item.topic.slice(0, 50)}** — ${item.risks.map(r => r.riskCode).join(", ")}`);
    }
    w(``);
  }

  // TTS section
  w(`## TTS Risks`);
  w(``);
  const ttsItems = items.filter(i => i.formatType === "tts_short");
  w(`Scanned **${ttsItems.length}** TTS Short items.`);
  w(``);
  const ttsRiskyItems = ttsItems.filter(i => i.risks.some(r => r.riskCode.startsWith("TTS_")));
  if (ttsRiskyItems.length === 0) {
    w(`✅ No TTS risks found.`);
  } else {
    w(`| Content ID | Topic | Risk Code | Severity | Fixed By Normalizer | Before Fix |`);
    w(`|---|---|---|---|---|---|`);
    for (const item of ttsRiskyItems) {
      for (const risk of item.risks.filter(r => r.riskCode.startsWith("TTS_"))) {
        w(`| \`${item.contentId.slice(0, 8)}\` | ${item.topic.slice(0, 40)} | \`${risk.riskCode}\` | ${risk.severity} | ${risk.fixedByNormalizer ? "✅" : "❌"} | ${risk.renderedBeforeFix ? "⚠️ YES" : "—"} |`);
      }
    }
  }
  w(``);

  // Visual/workspace section
  w(`## Visual / Workspace Risks`);
  w(``);
  const visualItems = items.filter(i => i.risks.some(r =>
    r.riskCode.startsWith("TANG_SAU_") || r.riskCode.startsWith("PHAT_PHAP_") || r.riskCode === "CHANNEL_KEY_MISMATCH"
  ));
  if (visualItems.length === 0) {
    w(`✅ No visual or workspace mismatch risks found.`);
  } else {
    for (const item of visualItems) {
      const vr = item.risks.filter(r => r.riskCode.startsWith("TANG_SAU_") || r.riskCode.startsWith("PHAT_PHAP_") || r.riskCode === "CHANNEL_KEY_MISMATCH");
      w(`- **${item.topic.slice(0, 60)}** (${item.channelName})`);
      for (const r of vr) {
        w(`  - ${r.severity === "high" ? "❌" : "⚠️"} \`${r.riskCode}\`: ${r.description}`);
      }
    }
  }
  w(``);

  // Publishing readiness section
  w(`## Publishing Readiness Risks`);
  w(``);
  const pubRiskyItems = items.filter(i => i.risks.some(r =>
    ["MEDIA_CLEANED","VIDEO_FILE_MISSING","VIDEO_PATH_NULL","AUDIO_FILE_MISSING",
     "SCHEDULED_IN_PAST","CHANNEL_INACTIVE","CHANNEL_NEEDS_RECONNECT","CHANNEL_QUOTA_EXCEEDED",
     "CHANNEL_LAST_ERROR","ALREADY_PUBLISHED","DUPLICATE_QUEUE_ROW","PREV_ERROR_MESSAGE"].includes(r.riskCode)
  ));
  if (pubRiskyItems.length === 0) {
    w(`✅ All queued items pass publishing readiness checks.`);
  } else {
    w(`| Queue ID | Topic | Risk | Severity |`);
    w(`|---|---|---|---|`);
    for (const item of pubRiskyItems) {
      for (const risk of item.risks.filter(r => !r.riskCode.startsWith("TTS_") && !r.riskCode.startsWith("TANG_SAU_") && !r.riskCode.startsWith("PHAT_PHAP_"))) {
        w(`| \`${item.queueId.slice(0,8)}\` | ${item.topic.slice(0,40)} | \`${risk.riskCode}\` | ${risk.severity} |`);
      }
    }
  }
  w(``);

  // Per-workspace status
  w(`## Per-Workspace Status`);
  w(``);
  for (const [name, wsItems] of Object.entries(workspaceGroups).sort()) {
    const wsHigh = wsItems.filter(i => i.risks.some(r => r.severity === "high")).length;
    const wsMed = wsItems.filter(i => i.risks.some(r => r.severity === "medium")).length;
    const wsLow = wsItems.filter(i => i.risks.every(r => r.severity === "low") && i.risks.length > 0).length;
    const wsClean = wsItems.filter(i => i.risks.length === 0).length;
    const statusIcon = wsHigh > 0 ? "🔴" : wsMed > 0 ? "🟡" : "✅";
    w(`### ${statusIcon} ${name} (${wsItems[0]?.platform})`);
    w(`- **Items:** ${wsItems.length} | High: ${wsHigh} | Medium: ${wsMed} | Low: ${wsLow} | Clean: ${wsClean}`);
    w(`- **Formats:** ${[...new Set(wsItems.map(i => i.formatType))].join(", ")}`);
    if (wsHigh > 0 || wsMed > 0) {
      for (const item of wsItems.filter(i => i.risks.some(r => r.severity === "high" || r.severity === "medium"))) {
        w(`  - \`${item.scheduledAtVN}\` ${item.topic.slice(0, 50)} — ${item.risks.filter(r => r.severity !== "low").map(r => r.riskCode).join(", ")}`);
      }
    }
    w(``);
  }

  // Recommended actions
  w(`## Recommended Actions`);
  w(``);
  if (highRisks.length > 0) {
    w(`### Repair Required (HIGH)`);
    w(``);
    for (const item of highRisks) {
      const codes = item.risks.filter(r => r.severity === "high").map(r => r.riskCode);
      if (codes.includes("VIDEO_FILE_MISSING") || codes.includes("MEDIA_CLEANED")) {
        w(`- **${item.topic.slice(0, 50)}** (\`${item.queueId.slice(0,8)}\`): Re-render content before publish date.`);
      }
      if (codes.includes("CHANNEL_NEEDS_RECONNECT")) {
        w(`- **${item.channelName}**: Reconnect OAuth token at /publishing/channels before next upload.`);
      }
      if (codes.includes("CHANNEL_INACTIVE")) {
        w(`- **${item.channelName}**: Re-activate channel or cancel these queue rows.`);
      }
      if (codes.includes("CHANNEL_QUOTA_EXCEEDED")) {
        w(`- **${item.channelName}**: YouTube quota exceeded. Reschedule items after quota resets.`);
      }
      if (codes.includes("ALREADY_PUBLISHED")) {
        w(`- **${item.topic.slice(0, 50)}** (\`${item.queueId.slice(0,8)}\`): Already published. Cancel this queue row to prevent duplicate upload.`);
      }
      if (codes.includes("CHANNEL_KEY_MISMATCH")) {
        w(`- **${item.topic.slice(0, 50)}** (\`${item.queueId.slice(0,8)}\`): Content destined for wrong channel. Cancel and re-schedule to correct channel.`);
      }
    }
    w(``);
  }
  if (mediumRisks.length > 0) {
    w(`### Review Recommended (MEDIUM)`);
    w(``);
    for (const item of mediumRisks) {
      const codes = item.risks.filter(r => r.severity === "medium").map(r => r.riskCode);
      if (codes.includes("SCHEDULED_IN_PAST")) {
        w(`- **${item.topic.slice(0, 50)}**: Scheduled in past — will upload on next cron tick. Verify this is intended.`);
      }
      if (codes.includes("PREV_ERROR_MESSAGE")) {
        w(`- **${item.topic.slice(0, 50)}** (\`${item.queueId.slice(0,8)}\`): Prior error on queue row. Monitor upload result.`);
      }
      if (codes.includes("DUPLICATE_QUEUE_ROW")) {
        w(`- **${item.topic.slice(0, 50)}**: Duplicate queue rows detected. Cancel the extra row.`);
      }
    }
    w(``);
  }
  if (highRisks.length === 0 && mediumRisks.length === 0) {
    w(`✅ No repair actions required. All queued items look safe to publish.`);
    w(``);
  }

  w(`---`);
  w(`*Generated by \`scripts/pre-publish-quality-audit.ts\`. Re-run at any time — read-only, no DB/queue mutations.*`);

  // Write markdown
  const mdPath = path.join(process.cwd(), "docs", "PRE_PUBLISH_QUALITY_AUDIT.md");
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
  console.log(`\n✅ Report written: ${mdPath}`);

  // Write JSON manifest
  const manifestDir = path.join(process.cwd(), "output", "manifests");
  fs.mkdirSync(manifestDir, { recursive: true });
  const jsonPath = path.join(manifestDir, "pre-publish-quality-audit.json");
  const manifest = {
    generatedAt: NOW.toISOString(),
    totalItems: items.length,
    highCount: highRisks.length,
    mediumCount: mediumRisks.length,
    lowCount: lowRisks.length,
    cleanCount: cleanItems.length,
    riskCodeCounts,
    items: items.map(i => ({
      queueId: i.queueId,
      contentId: i.contentId,
      platform: i.platform,
      channelName: i.channelName,
      channelKey: i.channelKey,
      scheduledAt: i.scheduledAt.toISOString(),
      formatType: i.formatType,
      topic: i.topic,
      risks: i.risks,
    })),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✅ JSON manifest: ${jsonPath}`);

  // Console summary
  console.log(`\n═══ Audit Summary ═══`);
  console.log(`  Total items:  ${items.length}`);
  console.log(`  🔴 HIGH:      ${highRisks.length}`);
  console.log(`  🟡 MEDIUM:    ${mediumRisks.length}`);
  console.log(`  🟢 LOW:       ${lowRisks.length}`);
  console.log(`  ✅ CLEAN:     ${cleanItems.length}`);

  if (highRisks.length > 0) {
    console.log(`\n  HIGH SEVERITY BLOCKERS:`);
    for (const item of highRisks) {
      const codes = item.risks.filter(r => r.severity === "high").map(r => r.riskCode).join(", ");
      console.log(`    [${item.queueId.slice(0, 8)}] ${item.topic.slice(0, 50)} → ${codes}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
