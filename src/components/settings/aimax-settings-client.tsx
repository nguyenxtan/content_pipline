"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Copy,
  ExternalLink,
  Loader2,
  Mic2,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Wallet,
  Waves,
} from "lucide-react";
import {
  checkAiMaxBalanceAction,
  getAiMaxVoiceCatalogAction,
  saveAiMaxSettingsAction,
  saveAiMaxVoiceRoleAction,
  syncAiMaxVietnameseVoicesAction,
  testAiMaxVoiceAction,
} from "@/actions/aimax-settings";

type VoiceRow = {
  id: string;
  voiceId: string;
  name: string;
  displayLabel: string;
  speakerName: string | null;
  gender: string | null;
  age: string | null;
  language: string | null;
  category: string | null;
  useCase: string | null;
  accent: string | null;
  localeLabel: string | null;
  quality: string | null;
  voiceFamily: string;
  recommendedUseCase: string | null;
  provider: "aimax";
  defaultSpeed: number | null;
  defaultPitch: number | null;
  previewUrl: string | null;
  sourceProvider: string | null;
  rawJson: unknown;
  updatedAt: string;
  source: "stored" | "cache";
};

type SettingsData = {
  apiBaseUrl: string;
  apiKey: string;
  provider: string;
  model: string;
  language: string;
  normalize: boolean;
  enableSrt: boolean;
  useChunking: boolean;
  maxCharsPerJob: number;
  speed: number;
  pitch: number;
  volume: number;
  phatPhapSpeed: number;
  phatPhapPitch: number;
  phatPhapVolume: number;
  phatPhapNormalize: boolean;
  defaultVoiceId: string | null;
  defaultStoryVoiceId: string | null;
  defaultPhatPhapVoiceId: string | null;
  defaultLongformVoiceId: string | null;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  balanceLastValue: number | null;
  balanceLastCheckedAt: string | null;
};

type InitialData = {
  settings: SettingsData;
  voices: VoiceRow[];
  voiceCatalogSource: "stored" | "cache";
};

type TestResult = {
  voiceId: string;
  audioStreamUrl: string | null;
  durationSec: number | null | undefined;
  srtPath: string | null;
};

const DEFAULT_TEST_TEXT = "Xin chào, đây là bản kiểm tra giọng đọc tiếng Việt cho hệ thống truyện audio.";

function formatDateTime(value: string | null): string {
  if (!value) return "Chưa kiểm tra";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatBalance(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatDuration(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(1)}s`;
}

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractProvider(rawJson: unknown, fallback?: string | null): string {
  const record = rawObject(rawJson);
  return cleanString(record?.provider) ?? fallback ?? "";
}

function isSafelyClonedVoice(rawJson: unknown): boolean {
  const record = rawObject(rawJson);
  if (!record) return false;
  return record.is_cloned === true ||
    record.isCloned === true ||
    record.cloned === true ||
    record.voice_type === "cloned" ||
    record.voiceType === "cloned" ||
    record.owned_by_user === true ||
    record.workspace_owned === true ||
    record.is_custom_voice === true ||
    record.isCustomVoice === true;
}

function getPreviewUrl(voice: VoiceRow): string | null {
  return cleanString(voice.previewUrl) ??
    cleanString(rawObject(voice.rawJson)?.preview_url) ??
    cleanString(rawObject(voice.rawJson)?.previewUrl) ??
    cleanString(rawObject(voice.rawJson)?.sample_url) ??
    cleanString(rawObject(voice.rawJson)?.sampleUrl);
}

function providerBadge(provider: string): string {
  const normalized = provider.toLowerCase();
  if (normalized.includes("minimax")) return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (normalized.includes("eleven")) return "border-violet-500/30 bg-violet-500/10 text-violet-200";
  return "border-slate-700 bg-slate-900 text-slate-300";
}

function sourceBadge(source: "stored" | "cache"): string {
  return source === "stored"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    : "border-slate-700 bg-slate-900 text-slate-300";
}

function stringifyAttributeValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => stringifyAttributeValue(entry)).join(", ");
  return JSON.stringify(value);
}

function collectVoiceAttributes(voice: VoiceRow): Array<{ key: string; value: string }> {
  const record = rawObject(voice.rawJson);
  if (!record) return [];
  return Object.entries(record)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => ({ key, value: stringifyAttributeValue(value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function AiMaxSettingsClient({ initialData }: { initialData: InitialData }) {
  const [settings, setSettings] = useState(initialData.settings);
  const [voices, setVoices] = useState(initialData.voices);
  const [voiceCatalogSource, setVoiceCatalogSource] = useState(initialData.voiceCatalogSource);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [testText, setTestText] = useState(DEFAULT_TEST_TEXT);
  const [activeTestVoiceId, setActiveTestVoiceId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredVoices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return voices;
    return voices.filter((voice) => {
      const provider = extractProvider(voice.rawJson, voice.sourceProvider).toLowerCase();
      const haystack = [
        voice.name,
        voice.voiceId,
        voice.gender,
        voice.age,
        voice.language,
        voice.category,
        voice.useCase,
        voice.accent,
        voice.displayLabel,
        voice.speakerName,
        voice.localeLabel,
        voice.quality,
        voice.voiceFamily,
        voice.recommendedUseCase,
        provider,
        JSON.stringify(voice.rawJson),
      ]
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [searchQuery, voices]);

  const groupedVoices = useMemo(() => {
    const cloned = filteredVoices.filter((voice) => isSafelyClonedVoice(voice.rawJson));
    const catalog = filteredVoices.filter((voice) => !isSafelyClonedVoice(voice.rawJson));
    return { cloned, catalog };
  }, [filteredVoices]);

  const clonedCount = useMemo(
    () => voices.filter((voice) => isSafelyClonedVoice(voice.rawJson)).length,
    [voices],
  );

  const setFlashMessage = (value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage(null), 2500);
  };

  const refreshVoices = () => {
    startTransition(async () => {
      const nextCatalog = await getAiMaxVoiceCatalogAction();
      setVoices(nextCatalog.voices);
      setVoiceCatalogSource(nextCatalog.source);
      setFlashMessage(`Đã làm mới catalog saved AiMax (${nextCatalog.voices.length} giọng).`);
    });
  };

  const handleSave = () => {
    startTransition(async () => {
      const result = await saveAiMaxSettingsAction({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: apiKeyInput,
        provider: settings.provider,
        model: settings.model,
        language: settings.language,
        normalize: settings.normalize,
        enableSrt: settings.enableSrt,
        useChunking: settings.useChunking,
        maxCharsPerJob: settings.maxCharsPerJob,
        speed: settings.speed,
        pitch: settings.pitch,
        volume: settings.volume,
        phatPhapSpeed: settings.phatPhapSpeed,
        phatPhapPitch: settings.phatPhapPitch,
        phatPhapVolume: settings.phatPhapVolume,
        phatPhapNormalize: settings.phatPhapNormalize,
      });
      setSettings((prev) => ({
        ...prev,
        hasApiKey: true,
        apiKey: "",
        maskedApiKey: result.maskedApiKey,
      }));
      setApiKeyInput("");
      setFlashMessage("Đã lưu cấu hình AiMax.");
    });
  };

  const handleBalanceCheck = () => {
    startTransition(async () => {
      const result = await checkAiMaxBalanceAction();
      setSettings((prev) => ({
        ...prev,
        balanceLastValue: result.balance,
        balanceLastCheckedAt: result.checkedAt,
      }));
      setFlashMessage("Đã kiểm tra số dư AiMax.");
    });
  };

  const handleSyncVoices = () => {
    startTransition(async () => {
      const result = await syncAiMaxVietnameseVoicesAction();
      const nextCatalog = await getAiMaxVoiceCatalogAction();
      setVoices(nextCatalog.voices);
      setVoiceCatalogSource(nextCatalog.source);
      setFlashMessage(`Đã đồng bộ ${result.count} giọng đã lưu.`);
    });
  };

  const handleVoiceRoleSave = (
    role: "default" | "story" | "phat_phap" | "longform",
    voiceId: string,
  ) => {
    startTransition(async () => {
      const currentVoiceId =
        role === "default" ? settings.defaultVoiceId :
        role === "story" ? settings.defaultStoryVoiceId :
        role === "phat_phap" ? settings.defaultPhatPhapVoiceId :
        settings.defaultLongformVoiceId;
      const nextVoiceId = currentVoiceId === voiceId ? null : voiceId;
      await saveAiMaxVoiceRoleAction({ role, voiceId: nextVoiceId });
      setSettings((prev) => ({
        ...prev,
        defaultVoiceId: role === "default" ? nextVoiceId : prev.defaultVoiceId,
        defaultStoryVoiceId: role === "story" ? nextVoiceId : prev.defaultStoryVoiceId,
        defaultPhatPhapVoiceId: role === "phat_phap" ? nextVoiceId : prev.defaultPhatPhapVoiceId,
        defaultLongformVoiceId: role === "longform" ? nextVoiceId : prev.defaultLongformVoiceId,
      }));
      setFlashMessage(
        nextVoiceId
          ? `Đã lưu voice mặc định cho ${role}.`
          : `Đã gỡ voice mặc định cho ${role}.`,
      );
    });
  };

  const handleVoiceTest = (voiceId: string) => {
    setActiveTestVoiceId(voiceId);
    startTransition(async () => {
      const result = await testAiMaxVoiceAction({ voiceId, text: testText });
      setTestResults((prev) => ({
        ...prev,
        [voiceId]: {
          voiceId,
          audioStreamUrl: result.audioStreamUrl,
          durationSec: result.durationSec,
          srtPath: result.srtPath,
        },
      }));
      setActiveTestVoiceId(null);
      setFlashMessage(`Đã tạo sample test cho ${voiceId}.`);
    });
  };

  const copyText = async (value: string | null | undefined) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setFlashMessage("Đã copy.");
  };

  const renderVoiceGroup = (rows: VoiceRow[], title: string, emptyText: string) => (
    <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{rows.length} voice(s)</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {rows.map((voice) => {
            const provider = extractProvider(voice.rawJson, voice.sourceProvider);
            const testResult = testResults[voice.voiceId];
            const isDefault = settings.defaultVoiceId === voice.voiceId;
            const isStory = settings.defaultStoryVoiceId === voice.voiceId;
            const isPhatPhap = settings.defaultPhatPhapVoiceId === voice.voiceId;
            const isLongform = settings.defaultLongformVoiceId === voice.voiceId;
            const previewUrl = getPreviewUrl(voice);
            const attributes = collectVoiceAttributes(voice);

            return (
              <article key={voice.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">{voice.displayLabel}</h3>
                    {voice.speakerName ? (
                      <p className="mt-1 text-xs text-slate-300">{voice.speakerName}</p>
                    ) : null}
                    <p className="mt-1 font-mono text-xs text-slate-400">{voice.voiceId}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[11px] ${providerBadge(provider)}`}>
                      {provider || "unknown"}
                    </span>
                    <span className={`rounded-full border px-2 py-1 text-[11px] ${sourceBadge(voice.source)}`}>
                      {voice.source === "stored" ? "Stored DB" : "Local cache"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {voice.gender ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.gender}</span> : null}
                  {voice.age ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.age}</span> : null}
                  {voice.language ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.language}</span> : null}
                  {voice.accent ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.accent}</span> : null}
                  {voice.localeLabel ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.localeLabel}</span> : null}
                  {voice.quality ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.quality}</span> : null}
                  {voice.voiceFamily ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.voiceFamily}</span> : null}
                  {voice.category ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.category}</span> : null}
                  {(voice.recommendedUseCase ?? voice.useCase) ? <span className="rounded-full border border-slate-700 px-2 py-1 text-slate-300">{voice.recommendedUseCase ?? voice.useCase}</span> : null}
                  {isDefault ? <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200">Default</span> : null}
                  {isStory ? <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-200">Story</span> : null}
                  {isPhatPhap ? <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">Phật pháp</span> : null}
                  {isLongform ? <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-violet-200">Longform</span> : null}
                  {isSafelyClonedVoice(voice.rawJson) ? <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-200">Cloned/custom</span> : null}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs font-medium text-slate-300">Voice profile</p>
                    <dl className="mt-2 space-y-1 text-xs text-slate-400">
                      <div className="flex items-center justify-between gap-3">
                        <dt>Label</dt>
                        <dd className="text-right text-slate-200">{voice.displayLabel}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt>Speaker</dt>
                        <dd className="text-right text-slate-200">{voice.speakerName ?? "N/A"}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt>Locale</dt>
                        <dd className="text-right text-slate-200">{voice.localeLabel ?? voice.accent ?? "N/A"}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt>Quality</dt>
                        <dd className="text-right text-slate-200">{voice.quality ?? "N/A"}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt>Recommended</dt>
                        <dd className="text-right text-slate-200">{voice.recommendedUseCase ?? "N/A"}</dd>
                      </div>
                      {(voice.defaultSpeed != null || voice.defaultPitch != null) ? (
                        <div className="flex items-center justify-between gap-3">
                          <dt>Default tuning</dt>
                          <dd className="text-right text-slate-200">
                            speed {voice.defaultSpeed ?? 1} / pitch {voice.defaultPitch ?? 0}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs font-medium text-slate-300">Preview sample</p>
                    {previewUrl ? (
                      <div className="mt-2 space-y-2">
                        <audio controls preload="none" className="w-full">
                          <source src={previewUrl} />
                        </audio>
                        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
                          <a
                            href={previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:text-slate-100"
                          >
                            <ExternalLink className="h-3 w-3" /> Open preview URL
                          </a>
                          <button
                            type="button"
                            onClick={() => copyText(previewUrl)}
                            className="inline-flex items-center gap-1 hover:text-slate-100"
                          >
                            <Copy className="h-3 w-3" /> Copy URL
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">API chưa trả `preview_url` cho voice này.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-xs font-medium text-slate-300">Generated sample</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleVoiceTest(voice.voiceId)}
                        disabled={isPending}
                        className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-60"
                      >
                        {activeTestVoiceId === voice.voiceId ? "Testing..." : "Generate sample"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleVoiceRoleSave("default", voice.voiceId)}
                        disabled={isPending}
                        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Set default
                      </button>
                    </div>

                    {testResult?.audioStreamUrl ? (
                      <div className="mt-3 space-y-2">
                        <audio controls preload="none" className="w-full">
                          <source src={testResult.audioStreamUrl} type="audio/wav" />
                        </audio>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                          <span>Duration: {formatDuration(testResult.durationSec)}</span>
                          {testResult.srtPath ? (
                            <button
                              type="button"
                              onClick={() => copyText(testResult.srtPath)}
                              className="inline-flex items-center gap-1 text-slate-300 hover:text-slate-100"
                            >
                              <Copy className="h-3 w-3" /> Copy SRT path
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">Chưa tạo sample nội bộ cho voice này.</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleVoiceRoleSave("story", voice.voiceId)}
                    disabled={isPending}
                    className="rounded border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
                  >
                    Story
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVoiceRoleSave("phat_phap", voice.voiceId)}
                    disabled={isPending}
                    className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                  >
                    Phật pháp
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVoiceRoleSave("longform", voice.voiceId)}
                    disabled={isPending}
                    className="rounded border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-60"
                  >
                    Longform
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(voice.voiceId)}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900"
                  >
                    Copy voice ID
                  </button>
                </div>

                <details className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-200">
                    Thuộc tính chi tiết
                  </summary>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {attributes.map((attribute) => (
                      <div key={`${voice.id}-${attribute.key}`} className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">{attribute.key}</p>
                        <p className="mt-1 break-all text-xs text-slate-300">{attribute.value}</p>
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
            <Sparkles className="h-5 w-5 text-violet-400" />
            AiMax TTS
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Quản lý API connection, balance, catalog giọng đã lưu, default voices và test generation.
          </p>
        </div>
        {message ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200">
            {message}
          </div>
        ) : null}
      </div>

      <section className="grid gap-6 lg:grid-cols-[1.25fr,0.75fr]">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
          <div className="flex items-center gap-2">
            <Mic2 className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-slate-100">API settings</h2>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">API Base URL</span>
              <input
                value={settings.apiBaseUrl}
                onChange={(event) => setSettings((prev) => ({ ...prev, apiBaseUrl: event.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">API Key</span>
              <input
                type="password"
                value={apiKeyInput}
                placeholder={settings.maskedApiKey ?? "ak_****"}
                onChange={(event) => setApiKeyInput(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-500">
                {settings.hasApiKey ? `Đã lưu: ${settings.maskedApiKey}` : "Chưa có API key đã lưu"}
              </p>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Provider</span>
              <input
                value={settings.provider}
                onChange={(event) => setSettings((prev) => ({ ...prev, provider: event.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Model</span>
              <input
                value={settings.model}
                onChange={(event) => setSettings((prev) => ({ ...prev, model: event.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Language</span>
              <input
                value={settings.language}
                onChange={(event) => setSettings((prev) => ({ ...prev, language: event.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Max chars per job</span>
              <input
                type="number"
                value={settings.maxCharsPerJob}
                onChange={(event) => setSettings((prev) => ({ ...prev, maxCharsPerJob: Number(event.target.value) }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Speed</span>
              <input
                type="number"
                step="0.05"
                value={settings.speed}
                onChange={(event) => setSettings((prev) => ({ ...prev, speed: Number(event.target.value) }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Pitch</span>
              <input
                type="number"
                step="0.1"
                value={settings.pitch}
                onChange={(event) => setSettings((prev) => ({ ...prev, pitch: Number(event.target.value) }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-400">Volume</span>
              <input
                type="number"
                step="0.1"
                value={settings.volume}
                onChange={(event) => setSettings((prev) => ({ ...prev, volume: Number(event.target.value) }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-sm font-semibold text-amber-100">Phật pháp override</p>
            <p className="mt-1 text-xs text-amber-200/70">
              Tuning riêng cho route `phat_phap_short` để giữ giọng Thiện Tâm gần với sample hơn, không ảnh hưởng global AiMax tuning của lane khác.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-slate-400">Phật pháp speed</span>
                <input
                  type="number"
                  step="0.05"
                  value={settings.phatPhapSpeed}
                  onChange={(event) => setSettings((prev) => ({ ...prev, phatPhapSpeed: Number(event.target.value) }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-slate-400">Phật pháp pitch</span>
                <input
                  type="number"
                  step="0.1"
                  value={settings.phatPhapPitch}
                  onChange={(event) => setSettings((prev) => ({ ...prev, phatPhapPitch: Number(event.target.value) }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-slate-400">Phật pháp volume</span>
                <input
                  type="number"
                  step="0.1"
                  value={settings.phatPhapVolume}
                  onChange={(event) => setSettings((prev) => ({ ...prev, phatPhapVolume: Number(event.target.value) }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </label>
              <label className="inline-flex items-center gap-2 self-end pb-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={settings.phatPhapNormalize}
                  onChange={(event) => setSettings((prev) => ({ ...prev, phatPhapNormalize: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-amber-500 focus:ring-amber-500"
                />
                Phật pháp normalize
              </label>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6">
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={settings.normalize}
                onChange={(event) => setSettings((prev) => ({ ...prev, normalize: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500 focus:ring-rose-500"
              />
              Normalize
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={settings.enableSrt}
                onChange={(event) => setSettings((prev) => ({ ...prev, enableSrt: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500 focus:ring-rose-500"
              />
              Enable SRT
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={settings.useChunking}
                onChange={(event) => setSettings((prev) => ({ ...prev, useChunking: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500 focus:ring-rose-500"
              />
              Use chunking
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save settings
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">Balance</h2>
            </div>
            <p className="mt-4 text-3xl font-bold text-emerald-300">
              {formatBalance(settings.balanceLastValue)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Last checked: {formatDateTime(settings.balanceLastCheckedAt)}
            </p>
            <button
              type="button"
              onClick={handleBalanceCheck}
              disabled={isPending}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Check balance
            </button>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
            <div className="flex items-center gap-2">
              <Waves className="h-4 w-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">Voice sync</h2>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              Trang này chỉ đọc local DB/cache khi load. Gọi AiMax API chỉ xảy ra khi bạn bấm sync, check balance hoặc test generate.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
              <span className={`rounded-full border px-2 py-1 ${sourceBadge(voiceCatalogSource)}`}>
                Source: {voiceCatalogSource === "stored" ? "Stored DB" : "Local cache"}
              </span>
              <span className="rounded-full border border-slate-700 px-2 py-1">
                Total saved voices: {voices.length}
              </span>
              <span className="rounded-full border border-slate-700 px-2 py-1">
                Detected cloned/custom: {clonedCount}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSyncVoices}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sync saved voices
              </button>
              <button
                type="button"
                onClick={refreshVoices}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-60"
              >
                Refresh local snapshot
              </button>
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-slate-100">Test generation</h2>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Dùng cùng câu test cho sample nội bộ trên từng card voice.
        </p>
        <textarea
          value={testText}
          onChange={(event) => setTestText(event.target.value)}
          rows={3}
          className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
        />
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Voice catalog</h2>
            <p className="mt-1 text-xs text-slate-500">
              Tìm theo tên, `voice_id`, provider hoặc thuộc tính thô của 3 giọng đã bookmark.
            </p>
          </div>
          <label className="relative block w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Tìm Ngọc Huyền, Thiện Tâm, voice_id..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 focus:border-rose-500 focus:outline-none"
            />
          </label>
        </div>
      </section>

      {renderVoiceGroup(
        groupedVoices.cloned,
        "Cloned / custom voices",
        "Chưa phát hiện voice clone/custom từ dữ liệu API hiện tại. Nếu website có nhóm clone riêng nhưng API chưa trả cờ nhận diện, card vẫn sẽ xuất hiện ở nhóm public bên dưới và bạn có thể tìm bằng tên.",
      )}

      {renderVoiceGroup(
        groupedVoices.catalog,
        "Saved/bookmarked voices",
        "Chưa có catalog saved voices. Hãy bấm Refresh local snapshot hoặc Sync saved voices.",
      )}
    </div>
  );
}
