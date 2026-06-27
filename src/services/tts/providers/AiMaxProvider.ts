import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  applyAiMaxVoiceMetadataToVoiceRow,
  getAiMaxRuntimeConfig,
  isMissingTtsVoicesSchemaError,
} from "@/lib/aimax-settings";
import { db } from "@/lib/db";
import { ttsJobs, ttsVoices } from "@/lib/db/schema";
import { and, eq, notInArray } from "drizzle-orm";
import { writeCostEvent } from "@/lib/cost/write-cost-event";
import { DEFAULT_AIMAX_VND_PER_POINT } from "@/lib/cost/cost-constants";
import type {
  TTSProvider,
  TTSProviderBalance,
  TTSProviderSynthesisRequest,
  TTSProviderSynthesisResult,
  TTSProviderVoice,
  TTSProviderVoiceFilter,
  TTSUsageContext,
} from "@/lib/pipeline/tts-providers/types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const AIMAX_API_PREFIX = "/api/v1";
const VOICE_CACHE_PATH = path.join(process.cwd(), "media", "cache", "tts", "aimax-voices.json");
const POLL_MAX_WAIT_MS = 20 * 60 * 1000;
const POLL_INITIAL_MS = 2_000;
const POLL_MAX_INTERVAL_MS = 20_000;

type AiMaxVoiceRecord = Record<string, unknown>;

type AiMaxVoicesPage = {
  items: AiMaxVoiceRecord[];
  nextPage?: number | null;
  hasMore: boolean;
  raw: unknown;
};

function summarizePersistenceError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const firstLine = error.message.split("\n")[0]?.trim();
  if (firstLine) return firstLine;
  return error.name;
}

function authHeaders(apiKey: string): HeadersInit {
  if (!apiKey) {
    throw new Error("AIMAX_API_KEY missing");
  }
  return {
    "X-API-Key": apiKey,
  };
}

function assertBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error("AIMAX_BASE_URL missing");
  }
  return baseUrl.replace(/\/+$/, "");
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hashJson(data: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function getVoiceField(record: AiMaxVoiceRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = safeString(record[key]);
    if (value) return value;
  }
  return null;
}

function normalizeVoice(record: AiMaxVoiceRecord): TTSProviderVoice {
  const language = getVoiceField(record, ["language", "locale", "lang"]);
  const gender = getVoiceField(record, ["gender", "sex"]);
  return {
    id: getVoiceField(record, ["voice_id", "voiceId", "id"]) ?? hashJson(record).slice(0, 16),
    name: getVoiceField(record, ["name", "voice_name", "display_name"]) ?? "Unknown voice",
    locale: language ?? undefined,
    gender: gender ?? undefined,
    accent: getVoiceField(record, ["accent", "region"]) ?? undefined,
    age: getVoiceField(record, ["age", "age_group"]) ?? undefined,
    category: getVoiceField(record, ["category", "style", "type"]) ?? undefined,
    useCase: getVoiceField(record, ["use_case", "useCase", "scene"]) ?? undefined,
    rawJson: record,
  } as TTSProviderVoice;
}

function extractVoiceItems(payload: unknown): AiMaxVoicesPage {
  if (Array.isArray(payload)) {
    return { items: payload.filter((entry): entry is AiMaxVoiceRecord => !!entry && typeof entry === "object"), hasMore: false, raw: payload };
  }

  if (!payload || typeof payload !== "object") {
    return { items: [], hasMore: false, raw: payload };
  }

  const record = payload as Record<string, unknown>;
  const items =
    (Array.isArray(record.items) && record.items) ||
    (Array.isArray(record.voices) && record.voices) ||
    (Array.isArray(record.data) && record.data) ||
    [];

  const pagination = (record.pagination && typeof record.pagination === "object" ? record.pagination : {}) as Record<string, unknown>;
  const currentPage = safeNumber(pagination.page ?? record.page);
  const nextPage = safeNumber(pagination.next_page ?? record.next_page) ?? (currentPage != null ? currentPage + 1 : null);
  const hasMore =
    Boolean(pagination.has_more ?? record.has_more) ||
    Boolean(pagination.next_cursor ?? record.next_cursor) ||
    Boolean(nextPage && safeNumber(pagination.total_pages ?? record.total_pages) && nextPage <= Number(pagination.total_pages ?? record.total_pages));

  return {
    items: items.filter((entry): entry is AiMaxVoiceRecord => !!entry && typeof entry === "object"),
    nextPage,
    hasMore,
    raw: payload,
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const config = await getAiMaxRuntimeConfig();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(config.apiKey),
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AiMax request failed (${res.status}): ${body}`);
  }

  return res.json();
}

async function downloadBinary(url: string, outputPath: string): Promise<{ contentType: string | null; bytes: number }> {
  const config = await getAiMaxRuntimeConfig();
  const res = await fetch(url, {
    headers: authHeaders(config.apiKey),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AiMax download failed (${res.status}): ${body}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return {
    contentType: res.headers.get("content-type"),
    bytes: buffer.length,
  };
}

async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-i", inputPath,
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    tempPath,
  ], { timeout: 180_000 });
  fs.renameSync(tempPath, outputPath);
}

function outputPathToSrtPath(outputPath: string): string {
  return outputPath.replace(/\.wav$/i, ".srt");
}

function parseStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const record = payload as Record<string, unknown>;
  return safeString(record.status ?? record.state ?? record.job_status ?? record.jobState) ?? "unknown";
}

function parseCompletionPayload(payload: unknown): {
  audioUrl: string | null;
  srtUrl: string | null;
  durationSec: number | null;
  creditUsed: number | null;
  status: string;
} {
  if (!payload || typeof payload !== "object") {
    return { audioUrl: null, srtUrl: null, durationSec: null, creditUsed: null, status: "unknown" };
  }

  const record = payload as Record<string, unknown>;
  const result = (record.result && typeof record.result === "object" ? record.result : {}) as Record<string, unknown>;
  const data = (record.data && typeof record.data === "object" ? record.data : {}) as Record<string, unknown>;

  return {
    status: parseStatus(payload),
    audioUrl:
      getVoiceField(record, ["audio_url"]) ??
      getVoiceField(result, ["audio_url", "audioUrl", "url"]) ??
      getVoiceField(data, ["audio_url", "audioUrl", "url"]),
    srtUrl:
      getVoiceField(record, ["srt_url"]) ??
      getVoiceField(result, ["srt_url", "srtUrl", "subtitle_url"]) ??
      getVoiceField(data, ["srt_url", "srtUrl", "subtitle_url"]),
    durationSec:
      safeNumber(record.duration ?? record.duration_sec) ??
      safeNumber(result.duration ?? result.duration_sec) ??
      safeNumber(data.duration ?? data.duration_sec),
    creditUsed:
      safeNumber(record.chars_deducted) ??
      safeNumber(record.credit_used ?? record.credits_used) ??
      safeNumber(result.credit_used ?? result.credits_used) ??
      safeNumber(data.credit_used ?? data.credits_used),
  };
}

export async function fetchAiMaxJobStatus(externalJobId: string): Promise<{
  raw: unknown;
  parsed: ReturnType<typeof parseCompletionPayload>;
}> {
  const config = await getAiMaxRuntimeConfig();
  const baseUrl = assertBaseUrl(config.apiBaseUrl);
  const raw = await fetchJson(`${baseUrl}${AIMAX_API_PREFIX}/tts/jobs/${externalJobId}`);
  return {
    raw,
    parsed: parseCompletionPayload(raw),
  };
}

export async function materializeCompletedAiMaxJob(params: {
  audioUrl: string;
  outputPath: string;
  srtUrl?: string | null;
  srtPath?: string | null;
}): Promise<{ srtPath: string | null }> {
  const downloadSourcePath = `${params.outputPath}.source`;
  await downloadBinary(params.audioUrl, downloadSourcePath);
  await convertToWav(downloadSourcePath, params.outputPath);
  try { fs.rmSync(downloadSourcePath, { force: true }); } catch { /* ignore */ }

  let srtPath: string | null = null;
  if (params.srtUrl && params.srtPath) {
    srtPath = params.srtPath;
    await downloadBinary(params.srtUrl, srtPath);
  }

  return { srtPath };
}

async function pollAiMaxJob(externalJobId: string): Promise<unknown> {
  const config = await getAiMaxRuntimeConfig();
  const baseUrl = assertBaseUrl(config.apiBaseUrl);
  const deadline = Date.now() + POLL_MAX_WAIT_MS;
  let attempt = 0;
  let waitMs = POLL_INITIAL_MS;

  while (Date.now() < deadline) {
    const payload = await fetchJson(`${baseUrl}${AIMAX_API_PREFIX}/tts/jobs/${externalJobId}`);
    const status = parseStatus(payload).toLowerCase();

    if (["completed", "failed", "cancelled"].includes(status)) {
      return payload;
    }

    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    waitMs = Math.min(POLL_MAX_INTERVAL_MS, POLL_INITIAL_MS * 2 ** attempt);
  }

  throw new Error(`AiMax job timed out after ${POLL_MAX_WAIT_MS / 60_000} minutes`);
}

type JobUpsertParams = {
  externalJobId: string;
  voiceId: string;
  chapterId: string | null;
  status: string;
  creditUsed?: number | null;
  audioUrl?: string | null;
  srtUrl?: string | null;
  rawJson?: unknown;
  // usage tracking fields
  usageContext?: TTSUsageContext | null;
  contentId?: string | null;
  speed?: number | null;
  pitch?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  usageSource?: string | null;
  estimatedCredits?: number | null;
};

function toNumStr(v: number | null | undefined): string | null {
  return v != null ? String(v) : null;
}

async function upsertJob(params: JobUpsertParams): Promise<void> {
  const ctx = params.usageContext ?? {};
  try {
    await db.insert(ttsJobs).values({
      provider: "aimax",
      externalJobId: params.externalJobId,
      voiceId: params.voiceId,
      chapterId: params.chapterId,
      status: params.status,
      creditUsed: toNumStr(params.creditUsed),
      audioUrl: params.audioUrl ?? null,
      srtUrl: params.srtUrl ?? null,
      rawJson: params.rawJson ?? null,
      pipelineRoute: ctx.pipelineRoute ?? null,
      contentId: params.contentId ?? null,
      contentProfileKey: ctx.contentProfileKey ?? null,
      nicheName: ctx.nicheName ?? null,
      formatType: ctx.formatType ?? null,
      voiceLabel: ctx.voiceLabel ?? null,
      voiceFamily: ctx.voiceFamily ?? null,
      speed: toNumStr(params.speed ?? null),
      pitch: toNumStr(params.pitch ?? null),
      textHash: ctx.textHash ?? null,
      textCharCount: ctx.textCharCount ?? null,
      cacheIdentity: ctx.cacheIdentity ?? null,
      cacheHit: false,
      startedAt: params.startedAt ?? null,
      completedAt: params.completedAt ?? null,
      durationMs: params.durationMs ?? null,
      errorMessage: params.errorMessage ?? null,
      usageSource: params.usageSource ?? "unknown",
      estimatedCredits: toNumStr(params.estimatedCredits),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [ttsJobs.provider, ttsJobs.externalJobId],
      set: {
        voiceId: params.voiceId,
        chapterId: params.chapterId,
        status: params.status,
        creditUsed: toNumStr(params.creditUsed),
        audioUrl: params.audioUrl ?? null,
        srtUrl: params.srtUrl ?? null,
        rawJson: params.rawJson ?? null,
        pipelineRoute: ctx.pipelineRoute ?? null,
        contentId: params.contentId ?? null,
        contentProfileKey: ctx.contentProfileKey ?? null,
        nicheName: ctx.nicheName ?? null,
        formatType: ctx.formatType ?? null,
        voiceLabel: ctx.voiceLabel ?? null,
        voiceFamily: ctx.voiceFamily ?? null,
        textHash: ctx.textHash ?? null,
        textCharCount: ctx.textCharCount ?? null,
        cacheIdentity: ctx.cacheIdentity ?? null,
        completedAt: params.completedAt ?? null,
        durationMs: params.durationMs ?? null,
        errorMessage: params.errorMessage ?? null,
        usageSource: params.usageSource ?? null,
        estimatedCredits: toNumStr(params.estimatedCredits),
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.warn(
      `[AiMaxProvider] Skipped tts_jobs persistence for ${params.externalJobId}: ${summarizePersistenceError(error)}`,
    );
  }
}

export async function recordCacheHitUsage(params: {
  contentId: string | null;
  voiceId: string;
  usageContext: TTSUsageContext;
  speed?: number | null;
  pitch?: number | null;
  durationMs?: number | null;
}): Promise<void> {
  const now = new Date();
  const externalJobId = `cache:${crypto.randomUUID()}`;
  try {
    await db.insert(ttsJobs).values({
      provider: "aimax",
      externalJobId,
      voiceId: params.voiceId,
      chapterId: null,
      status: "cached",
      creditUsed: "0",
      audioUrl: null,
      srtUrl: null,
      rawJson: null,
      pipelineRoute: params.usageContext.pipelineRoute ?? null,
      contentId: params.contentId ?? null,
      contentProfileKey: params.usageContext.contentProfileKey ?? null,
      nicheName: params.usageContext.nicheName ?? null,
      formatType: params.usageContext.formatType ?? null,
      voiceLabel: params.usageContext.voiceLabel ?? null,
      voiceFamily: params.usageContext.voiceFamily ?? null,
      speed: params.speed != null ? String(params.speed) : null,
      pitch: params.pitch != null ? String(params.pitch) : null,
      textHash: params.usageContext.textHash ?? null,
      textCharCount: params.usageContext.textCharCount ?? null,
      cacheIdentity: params.usageContext.cacheIdentity ?? null,
      cacheHit: true,
      startedAt: now,
      completedAt: now,
      durationMs: params.durationMs ?? null,
      usageSource: "cache",
      updatedAt: now,
    });
    writeTtsCostEvent({
      ttsJobId: externalJobId,
      contentId: params.contentId ?? null,
      ctx: params.usageContext,
      status: "cached",
      creditUsed: 0,
      speed: params.speed,
      pitch: params.pitch,
    });
  } catch (error) {
    console.warn(`[AiMaxProvider] Skipped cache-hit tts_jobs record: ${summarizePersistenceError(error)}`);
  }
}

function writeTtsCostEvent(params: {
  ttsJobId: string;
  contentId: string | null;
  ctx: TTSUsageContext | null | undefined;
  status: "done" | "failed" | "cached";
  creditUsed: number | null;
  speed?: number | null;
  pitch?: number | null;
}): void {
  const vndPerPoint = DEFAULT_AIMAX_VND_PER_POINT;
  const usageAmount = params.creditUsed;
  const costVnd = usageAmount != null ? Math.round(usageAmount * vndPerPoint * 10000) / 10000 : null;

  void writeCostEvent({
    contentId: params.contentId,
    provider: "aimax",
    costType: "tts",
    pipelineRoute: params.ctx?.pipelineRoute ?? null,
    contentProfileKey: params.ctx?.contentProfileKey ?? null,
    nicheName: params.ctx?.nicheName ?? null,
    formatType: params.ctx?.formatType ?? null,
    sourceTable: "tts_jobs",
    sourceId: params.ttsJobId,
    status: params.status,
    usageUnit: "point",
    usageAmount,
    unitCostVnd: vndPerPoint,
    costVnd,
    costSource: params.status === "cached" ? "cache" : (usageAmount != null ? "configured_rate" : "unknown"),
    metadata: {
      voiceLabel: params.ctx?.voiceLabel ?? null,
      voiceFamily: params.ctx?.voiceFamily ?? null,
      speed: params.speed ?? null,
      pitch: params.pitch ?? null,
      textCharCount: params.ctx?.textCharCount ?? null,
    },
  });
}

function parseSavedVoiceIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => safeString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const nested = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : null;
  const candidates = [
    record.saved_voice_ids,
    record.saved_ids,
    record.voice_ids,
    nested?.saved_voice_ids,
    nested?.saved_ids,
    nested?.voice_ids,
    record.data,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const ids = candidate
      .map((entry) => safeString(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (ids.length > 0) return ids;
  }

  return [];
}

async function fetchSavedVoiceIds(): Promise<string[]> {
  const config = await getAiMaxRuntimeConfig();
  const baseUrl = assertBaseUrl(config.apiBaseUrl);
  const payload = await fetchJson(`${baseUrl}${AIMAX_API_PREFIX}/voices/my/saved-ids`);
  return [...new Set(parseSavedVoiceIds(payload))];
}

async function fetchSavedVoicesFromApi(): Promise<TTSProviderVoice[]> {
  const savedIds = await fetchSavedVoiceIds();
  if (savedIds.length === 0) {
    fs.mkdirSync(path.dirname(VOICE_CACHE_PATH), { recursive: true });
    fs.writeFileSync(VOICE_CACHE_PATH, JSON.stringify({
      providerId: "aimax",
      fetchedAt: new Date().toISOString(),
      source: "saved-ids",
      savedVoiceIds: [],
      voices: [],
    }, null, 2));
    return [];
  }

  const cached = readCachedVoices() ?? [];
  const cachedById = new Map(cached.map((voice) => [voice.id, voice]));
  const voices: TTSProviderVoice[] = savedIds.map((savedId) => {
    const cachedVoice = cachedById.get(savedId);
    if (cachedVoice) {
      const enriched = applyAiMaxVoiceMetadataToVoiceRow({
        ...cachedVoice,
        id: savedId,
        voiceId: savedId,
        rawJson: {
          ...(cachedVoice.rawJson && typeof cachedVoice.rawJson === "object" ? cachedVoice.rawJson as Record<string, unknown> : {}),
          voice_id: savedId,
          saved_only: true,
        },
      });
      return {
        id: enriched.voiceId,
        name: enriched.displayLabel,
        locale: "vi",
        gender: enriched.gender ?? undefined,
        accent: enriched.accent ?? undefined,
        category: enriched.voiceFamily,
        useCase: enriched.recommendedUseCase ?? undefined,
        rawJson: enriched.rawJson,
      } satisfies TTSProviderVoice;
    }

    const enriched = applyAiMaxVoiceMetadataToVoiceRow({
      id: savedId,
      voiceId: savedId,
      name: savedId,
      locale: "vi",
      rawJson: { voice_id: savedId, saved_only: true },
    });

    return {
      id: enriched.voiceId,
      name: enriched.displayLabel,
      locale: "vi",
      gender: enriched.gender ?? undefined,
      accent: enriched.accent ?? undefined,
      category: enriched.voiceFamily,
      useCase: enriched.recommendedUseCase ?? undefined,
      rawJson: enriched.rawJson,
    } satisfies TTSProviderVoice;
  });

  fs.mkdirSync(path.dirname(VOICE_CACHE_PATH), { recursive: true });
  fs.writeFileSync(VOICE_CACHE_PATH, JSON.stringify({
    providerId: "aimax",
    fetchedAt: new Date().toISOString(),
    source: "saved-ids",
    savedVoiceIds: savedIds,
    voices,
  }, null, 2));

  return voices;
}

function readCachedVoices(): TTSProviderVoice[] | null {
  if (!fs.existsSync(VOICE_CACHE_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(VOICE_CACHE_PATH, "utf8")) as { voices?: TTSProviderVoice[] };
    return Array.isArray(parsed.voices) ? parsed.voices : null;
  } catch {
    return null;
  }
}

export async function syncAiMaxVoicesToDatabase(filters: TTSProviderVoiceFilter = {}): Promise<TTSProviderVoice[]> {
  void filters;
  const voices = await fetchSavedVoicesFromApi();

  for (const voice of voices) {
    try {
      await db.insert(ttsVoices).values({
        provider: "aimax",
        voiceId: voice.id,
        name: voice.name,
        gender: voice.gender ?? null,
        age: voice.age ?? null,
        language: voice.locale ?? null,
        category: voice.category ?? null,
        useCase: voice.useCase ?? null,
        rawJson: voice.rawJson ?? null,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [ttsVoices.provider, ttsVoices.voiceId],
        set: {
          name: voice.name,
          gender: voice.gender ?? null,
          age: voice.age ?? null,
          language: voice.locale ?? null,
          category: voice.category ?? null,
          useCase: voice.useCase ?? null,
          rawJson: voice.rawJson ?? null,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      if (isMissingTtsVoicesSchemaError(error)) {
        console.warn("[AiMaxProvider] tts_voices schema not ready yet; skipping AiMax voice persistence.");
        return voices;
      }
      throw error;
    }
  }

  try {
    if (voices.length === 0) {
      await db.delete(ttsVoices).where(eq(ttsVoices.provider, "aimax"));
    } else {
      await db.delete(ttsVoices).where(
        and(
          eq(ttsVoices.provider, "aimax"),
          notInArray(ttsVoices.voiceId, voices.map((voice) => voice.id)),
        ),
      );
    }
  } catch (error) {
    if (isMissingTtsVoicesSchemaError(error)) {
      console.warn("[AiMaxProvider] tts_voices schema not ready yet; skipping AiMax voice cleanup.");
      return voices;
    }
    throw error;
  }

  return voices;
}

export async function discoverAiMaxVoices(filters: TTSProviderVoiceFilter = {}): Promise<TTSProviderVoice[]> {
  void filters;
  return fetchSavedVoicesFromApi();
}

export async function getAiMaxBalance(): Promise<TTSProviderBalance> {
  const config = await getAiMaxRuntimeConfig();
  const baseUrl = assertBaseUrl(config.apiBaseUrl);
  const payload = await fetchJson(`${baseUrl}${AIMAX_API_PREFIX}/me/balance`);
  if (!payload || typeof payload !== "object") {
    return { balance: null, raw: payload };
  }
  const record = payload as Record<string, unknown>;
  return {
    balance:
      safeNumber(record.balance) ??
      safeNumber(record.char_balance) ??
      safeNumber(record.credits) ??
      safeNumber((record.data as Record<string, unknown> | undefined)?.balance) ??
      null,
    raw: payload,
  };
}

export const aiMaxTestUtils = {
  extractVoiceItems,
  normalizeVoice,
  parseCompletionPayload,
  parseStatus,
  parseSavedVoiceIds,
};

async function synthesizeWithAiMax(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult> {
  const config = await getAiMaxRuntimeConfig();
  const baseUrl = assertBaseUrl(config.apiBaseUrl);
  const startedAt = new Date();
  const form = new FormData();
  form.set("provider", request.providerName ?? config.provider);
  form.set("model", request.model ?? config.model);
  form.set("voice_id", request.voiceId);
  form.set("text", request.text);
  form.set("speed", String(request.speed ?? config.speed));
  form.set("pitch", String(request.pitch ?? config.pitch));
  form.set("vol", String(request.volume ?? config.volume));
  form.set("language", request.language ?? config.language);
  form.set("normalize", String(request.normalize ?? config.normalize));
  form.set("enable_srt", String(request.enableSrt ?? config.enableSrt));

  const submitPayload = await fetchJson(`${baseUrl}${AIMAX_API_PREFIX}/tts/generate`, {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  if (!submitPayload || typeof submitPayload !== "object") {
    throw new Error("AiMax returned an invalid generate response");
  }

  const externalJobId =
    safeString((submitPayload as Record<string, unknown>).job_id) ??
    safeString((submitPayload as Record<string, unknown>).id);
  if (!externalJobId) {
    throw new Error(`AiMax generate missing job_id: ${JSON.stringify(submitPayload)}`);
  }

  const ctx = request.usageContext;
  await upsertJob({
    externalJobId,
    voiceId: request.voiceId,
    chapterId: request.chapterId ?? request.contentId ?? null,
    status: "queued",
    rawJson: submitPayload,
    usageContext: ctx,
    contentId: request.contentId ?? null,
    speed: request.speed ?? null,
    pitch: request.pitch ?? null,
    startedAt,
    usageSource: "unknown",
  });

  const completionPayload = await pollAiMaxJob(externalJobId);
  const completed = parseCompletionPayload(completionPayload);

  if (completed.status === "failed" || completed.status === "cancelled") {
    const failedAt = new Date();
    await upsertJob({
      externalJobId,
      voiceId: request.voiceId,
      chapterId: request.chapterId ?? request.contentId ?? null,
      status: completed.status,
      creditUsed: completed.creditUsed,
      audioUrl: completed.audioUrl,
      srtUrl: completed.srtUrl,
      rawJson: completionPayload,
      usageContext: ctx,
      contentId: request.contentId ?? null,
      startedAt,
      completedAt: failedAt,
      durationMs: failedAt.getTime() - startedAt.getTime(),
      errorMessage: `AiMax job ${completed.status}`.slice(0, 500),
      usageSource: completed.creditUsed != null ? "api" : "unknown",
    });
    writeTtsCostEvent({
      ttsJobId: externalJobId,
      contentId: request.contentId ?? null,
      ctx,
      status: "failed",
      creditUsed: completed.creditUsed,
      speed: request.speed,
      pitch: request.pitch,
    });
    throw new Error(`AiMax job ${completed.status}: ${JSON.stringify(completionPayload).slice(0, 500)}`);
  }

  if (!completed.audioUrl) {
    throw new Error(`AiMax completed without audio_url: ${JSON.stringify(completionPayload).slice(0, 500)}`);
  }

  const downloadSourcePath = `${request.outputPath}.source`;
  await downloadBinary(completed.audioUrl, downloadSourcePath);
  await convertToWav(downloadSourcePath, request.outputPath);
  try { fs.rmSync(downloadSourcePath, { force: true }); } catch { /* ignore */ }

  let srtPath: string | null = null;
  if (completed.srtUrl) {
    srtPath = outputPathToSrtPath(request.outputPath);
    await downloadBinary(completed.srtUrl, srtPath);
  }

  const completedAt = new Date();
  await upsertJob({
    externalJobId,
    voiceId: request.voiceId,
    chapterId: request.chapterId ?? request.contentId ?? null,
    status: "completed",
    creditUsed: completed.creditUsed,
    audioUrl: completed.audioUrl,
    srtUrl: completed.srtUrl,
    rawJson: completionPayload,
    usageContext: ctx,
    contentId: request.contentId ?? null,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    usageSource: completed.creditUsed != null ? "api" : "unknown",
  });

  writeTtsCostEvent({
    ttsJobId: externalJobId,
    contentId: request.contentId ?? null,
    ctx,
    status: "done",
    creditUsed: completed.creditUsed,
    speed: request.speed,
    pitch: request.pitch,
  });

  return {
    audioPath: request.outputPath,
    providerId: "aimax",
    voiceId: request.voiceId,
    engine: "AiMax Studio TTS",
    model: config.model,
    externalJobId,
    audioUrl: completed.audioUrl,
    srtUrl: completed.srtUrl,
    srtPath,
    durationSec: completed.durationSec,
    creditUsed: completed.creditUsed,
    rawResponse: completionPayload,
  };
}

export const aiMaxProvider: TTSProvider = {
  providerId: "aimax",
  displayName: "AiMax Studio",
  engine: "AiMax Studio TTS",
  model: "speech-2.8-hd",
  // Default voice when no route/niche/item voice is configured.
  // Thiện Tâm is the safe generic default for Vietnamese content.
  defaultVoiceId: "s_sg_male_thientam_ytstable_vc",
  supportsLongform: true,
  supportsSpeedControl: true,
  supportsProsodyControl: true,
  supportsSrt: true,
  async checkAvailability() {
    const config = await getAiMaxRuntimeConfig();
    if (!config.apiKey) {
      return {
        available: false,
        reason: "AiMax TTS is required but not configured. Please configure AiMax in Settings → TTS → AiMax or set AIMAX_API_KEY/AIMAX_BASE_URL.",
      };
    }
    if (!config.apiBaseUrl) {
      return {
        available: false,
        reason: "AiMax TTS is required but not configured. Please configure AiMax in Settings → TTS → AiMax or set AIMAX_API_KEY/AIMAX_BASE_URL.",
      };
    }
    return { available: true };
  },
  async checkBalance(): Promise<TTSProviderBalance> {
    return getAiMaxBalance();
  },
  async listVoices(filters?: TTSProviderVoiceFilter): Promise<TTSProviderVoice[]> {
    const shouldRefresh = filters?.forceRefresh ?? false;
    if (!shouldRefresh) {
      const cached = readCachedVoices();
      if (cached) {
        return cached;
      }
    }
    void filters;
    return fetchSavedVoicesFromApi();
  },
  async synthesize(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult> {
    return synthesizeWithAiMax(request);
  },
};
