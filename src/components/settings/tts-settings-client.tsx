"use client";

import { useState, useEffect, useRef } from "react";
import {
  Mic2, CheckCircle2, XCircle, RefreshCw, Play, Pause,
  Loader2, Volume2, Power, PowerOff,
} from "lucide-react";

const VOICES = [
  { id: "Ly",    name: "Trúc Ly",    gender: "Nữ",  region: "Bắc", note: "⭐ Phật pháp" },
  { id: "Ngoc",  name: "Bích Ngọc",  gender: "Nữ",  region: "Bắc", note: "" },
  { id: "Binh",  name: "Thanh Bình", gender: "Nam", region: "Bắc", note: "" },
  { id: "Tuyen", name: "Phạm Tuyên", gender: "Nam", region: "Bắc", note: "" },
  { id: "Doan",  name: "Thục Đoan",  gender: "Nữ",  region: "Nam", note: "" },
  { id: "Vinh",  name: "Xuân Vĩnh",  gender: "Nam", region: "Nam", note: "" },
  { id: "Sơn",   name: "Thái Sơn",   gender: "Nam", region: "Nam", note: "" },
];

type ServerStatus = "checking" | "online" | "offline";

interface AudioPlayerProps {
  src: string;
  label: string;
  duration?: number;
}

function AudioPlayer({ src, label, duration }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration ?? 0);

  // Auto-play khi src thay đổi
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.load();
    audio.play().then(() => setIsPlaying(true)).catch(() => {});
  }, [src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play(); setIsPlaying(true); }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration ?? duration ?? 0)}
        onEnded={() => setIsPlaying(false)}
      />
      <button
        onClick={toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 transition-colors"
      >
        {isPlaying
          ? <Pause className="h-4 w-4 text-white" />
          : <Play className="h-4 w-4 text-white ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-xs font-medium text-slate-300 truncate">{label}</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 w-8 text-right shrink-0">{formatTime(currentTime)}</span>
          <input
            type="range" min={0} max={audioDuration || 1} step={0.1} value={currentTime}
            onChange={e => {
              const t = parseFloat(e.target.value);
              if (audioRef.current) audioRef.current.currentTime = t;
              setCurrentTime(t);
            }}
            className="flex-1 h-1 appearance-none bg-slate-700 rounded cursor-pointer accent-rose-500"
          />
          <span className="text-[10px] text-slate-500 w-8 shrink-0">{formatTime(audioDuration)}</span>
        </div>
      </div>
    </div>
  );
}

export function TtsSettingsClient() {
  const [status, setStatus] = useState<ServerStatus>("checking");
  const [queueInfo, setQueueInfo] = useState<{ pending: number; done: number; error: number } | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [testVoice, setTestVoice] = useState("Ly");
  const [testText, setTestText] = useState("Kính chào quý đạo hữu, hôm nay chúng ta cùng tìm hiểu về nhân quả trong đạo Phật.");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean; duration?: number; error?: string;
    audioFile?: string; voiceId?: string; voiceName?: string;
  } | null>(null);
  const [quickTestVoice, setQuickTestVoice] = useState<string | null>(null);
  const [quickResults, setQuickResults] = useState<Record<string, { file: string; duration: number }>>({});

  const checkStatus = async (options?: { showLoading?: boolean }) => {
    if (options?.showLoading) setStatus("checking");
    try {
      const res = await fetch("/api/tts/health", { signal: AbortSignal.timeout(5000) });
      const data = await res.json() as { online: boolean; queue?: { pending: number; done: number; error: number } | null };
      setStatus(data.online ? "online" : "offline");
      if (data.queue) setQueueInfo(data.queue);
    } catch {
      setStatus("offline");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/tts/health", { signal: AbortSignal.timeout(5000) });
        const data = await res.json() as { online: boolean; queue?: { pending: number; done: number; error: number } | null };
        if (cancelled) return;
        setStatus(data.online ? "online" : "offline");
        if (data.queue) setQueueInfo(data.queue);
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const res = await fetch("/api/tts/start", { method: "POST" });
      const data = await res.json() as { success: boolean };
      if (data.success) await checkStatus({ showLoading: true });
    } catch { /* ignore */ }
    setIsStarting(false);
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await fetch("/api/tts/stop", { method: "POST" });
      setStatus("offline");
      setQueueInfo(null);
    } catch { /* ignore */ }
    setIsStopping(false);
  };

  // Test giọng chính (text tùy chỉnh)
  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const contentId = `tts-test-${testVoice.toLowerCase()}`;
    const voice = VOICES.find(v => v.id === testVoice);
    try {
      const res = await fetch("/api/tts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText, voice: testVoice, contentId }),
        signal: AbortSignal.timeout(90000),
      });
      const data = await res.json() as { success: boolean; audioFile?: string; duration?: number; error?: string };
      setTestResult({ ...data, voiceId: testVoice, voiceName: voice?.name });
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    }
    setIsTesting(false);
  };

  // Test nhanh từ danh sách giọng
  const handleQuickTest = async (voiceId: string) => {
    if (quickTestVoice === voiceId) return;
    setQuickTestVoice(voiceId);
    const contentId = `tts-quick-${voiceId.toLowerCase()}`;
    try {
      const res = await fetch("/api/tts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Xin chào, đây là giọng đọc tiếng Việt của hệ thống.", voice: voiceId, contentId }),
        signal: AbortSignal.timeout(90000),
      });
      const data = await res.json() as { success: boolean; audioFile?: string; duration?: number };
      if (data.success && data.audioFile) {
        setQuickResults(prev => ({ ...prev, [voiceId]: { file: data.audioFile!, duration: data.duration ?? 0 } }));
      }
    } catch { /* ignore */ }
    setQuickTestVoice(null);
  };

  const triggerCron = async () => {
    await fetch("/api/cron/tts", { method: "POST" });
    await checkStatus({ showLoading: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Legacy VieNeu TTS</h1>
        <p className="text-sm text-slate-500 mt-0.5">Deprecated — VieNeu is no longer used for new generation. Use AiMax instead.</p>
      </div>

      {/* Server status */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Mic2 className="h-4 w-4 text-rose-400" /> TTS Server
          </h2>
          <button onClick={() => void checkStatus({ showLoading: true })} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status === "checking" && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
            {status === "online"   && <CheckCircle2 className="h-5 w-5 text-green-400" />}
            {status === "offline"  && <XCircle className="h-5 w-5 text-red-400" />}
            <div>
              <p className={`text-sm font-medium ${status === "online" ? "text-green-400" : status === "offline" ? "text-red-400" : "text-slate-400"}`}>
                {status === "checking" ? "Đang kiểm tra..." : status === "online" ? "Online" : "Offline"}
              </p>
              <p className="text-xs text-slate-500">localhost:8765 · Docker container</p>
            </div>
          </div>

          {/* Start / Stop buttons */}
          <div className="flex items-center gap-2">
            {status === "offline" && (
              <button
                onClick={handleStart}
                disabled={isStarting}
                className="flex items-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors"
              >
                {isStarting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Power className="h-3.5 w-3.5" />}
                {isStarting ? "Đang khởi động..." : "Khởi động TTS"}
              </button>
            )}
            {status === "online" && (
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="flex items-center gap-1.5 rounded-lg bg-slate-700 hover:bg-red-900/40 hover:text-red-400 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors"
              >
                {isStopping
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <PowerOff className="h-3.5 w-3.5" />}
                {isStopping ? "Đang dừng..." : "Dừng TTS"}
              </button>
            )}
          </div>
        </div>

        {queueInfo && (
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800">
            {[
              { label: "Chờ TTS", value: queueInfo.pending, cls: "text-amber-400" },
              { label: "Đã xong", value: queueInfo.done, cls: "text-green-400" },
              { label: "Lỗi", value: queueInfo.error, cls: "text-red-400" },
            ].map(({ label, value, cls }) => (
              <div key={label} className="text-center">
                <p className={`text-2xl font-bold ${cls}`}>{value}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="pt-1">
          <button onClick={triggerCron} disabled={status !== "online"}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40 transition-colors">
            <Play className="h-3 w-3" /> Chạy TTS ngay (1 item)
          </button>
        </div>
      </div>

      {/* Voice test — text tùy chỉnh */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-200">🎤 Test giọng đọc</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Chọn giọng</label>
            <select value={testVoice} onChange={e => setTestVoice(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
              {VOICES.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.gender} · {v.region}) {v.note}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Văn bản test</label>
            <textarea value={testText} onChange={e => setTestText(e.target.value)} rows={2}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500 resize-none" />
          </div>
        </div>

        <button onClick={handleTest} disabled={isTesting || status !== "online"}
          className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-40 transition-colors">
          {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {isTesting ? "Đang tạo..." : "Tạo audio"}
        </button>

        {/* Kết quả + player */}
        {testResult && (
          testResult.success && testResult.audioFile ? (
            <AudioPlayer
              src={`/api/tts/stream?file=${testResult.audioFile}`}
              label={`${testResult.voiceName ?? testResult.voiceId} · ${testResult.duration?.toFixed(1)}s`}
              duration={testResult.duration}
            />
          ) : (
            <p className="text-sm text-red-400">❌ {testResult.error}</p>
          )
        )}
      </div>

      {/* Danh sách giọng + quick test */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/50">
          <h2 className="text-sm font-semibold text-slate-200">Danh sách giọng đọc</h2>
        </div>
        <div className="divide-y divide-slate-800">
          {VOICES.map(v => {
            const isLoading = quickTestVoice === v.id;
            const result = quickResults[v.id];
            return (
              <div key={v.id} className="px-5 py-3 space-y-2">
                <div className="flex items-center gap-4">
                  <div className={`w-1.5 h-1.5 shrink-0 rounded-full ${v.gender === "Nữ" ? "bg-pink-400" : "bg-blue-400"}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-200">
                      {v.name}
                      {v.note && <span className="text-xs text-amber-400 ml-1">{v.note}</span>}
                    </p>
                    <p className="text-xs text-slate-500">{v.gender} · miền {v.region}</p>
                  </div>
                  <code className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{v.id}</code>
                  <button
                    onClick={() => handleQuickTest(v.id)}
                    disabled={isLoading || status !== "online" || !!quickTestVoice}
                    title="Nghe thử giọng này"
                    className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-slate-400 border border-slate-700 hover:border-rose-500 hover:text-rose-400 disabled:opacity-40 transition-colors"
                  >
                    {isLoading
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Volume2 className="h-3 w-3" />}
                    {isLoading ? "Đang tạo..." : "Nghe thử"}
                  </button>
                </div>

                {/* Audio player cho quick test */}
                {result && (
                  <AudioPlayer
                    src={`/api/tts/stream?file=${result.file}`}
                    label={`${v.name} · ${result.duration.toFixed(1)}s`}
                    duration={result.duration}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
