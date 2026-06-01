"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  Music, Plus, Trash2, Download, Loader2,
  CheckCircle2, XCircle, Clock, AlertCircle,
  Play, Pause, Volume2, X, SkipBack, SkipForward,
} from "lucide-react";
import { addMusicTrackAction, deleteMusicTrackAction } from "@/actions/music";
import type { MusicTrack } from "@/lib/db/schema";
import type { MusicCategory } from "@/lib/music-categories";

interface CategoryStat {
  id: string; label: string;
  total: number; done: number; pending: number; downloading: number; error: number;
  totalDuration: number;
}

interface Props {
  initialTracks: MusicTrack[];
  byCategory: CategoryStat[];
  categories: MusicCategory[];
}

interface NowPlaying {
  track: MusicTrack;
  playlist: MusicTrack[]; // toàn bộ bài trong category hiện tại
  index: number;
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}p`;
  return `${m}p`;
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; cls: string }> = {
  done:        { icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: "text-green-400" },
  downloading: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, cls: "text-blue-400" },
  error:       { icon: <XCircle className="h-3.5 w-3.5" />, cls: "text-red-400" },
  pending:     { icon: <Clock className="h-3.5 w-3.5" />, cls: "text-amber-400" },
};

// ── Mini Player ────────────────────────────────────────────────────────────────
function MiniPlayer({
  nowPlaying, onClose, onPrev, onNext,
}: {
  nowPlaying: NowPlaying;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);

  const src = `/api/music/stream/${nowPlaying.track.id}`;

  // Reset khi đổi bài
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.load();
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [nowPlaying.track.id]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play(); setIsPlaying(true); }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const hasPrev = nowPlaying.index > 0;
  const hasNext = nowPlaying.index < nowPlaying.playlist.length - 1;

  return (
    <div className="fixed bottom-0 left-[var(--sidebar-width)] right-0 z-50 border-t border-slate-700 bg-slate-900/95 backdrop-blur px-6 py-3">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { if (hasNext) onNext(); else setIsPlaying(false); }}
      />

      <div className="flex items-center gap-4 max-w-4xl mx-auto">
        {/* Track info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-600/20">
            <Music className="h-4 w-4 text-rose-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{nowPlaying.track.title}</p>
            <p className="text-xs text-slate-500">{nowPlaying.index + 1} / {nowPlaying.playlist.length}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center gap-1.5 flex-1">
          <div className="flex items-center gap-3">
            <button onClick={onPrev} disabled={!hasPrev}
              className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors">
              <SkipBack className="h-4 w-4" />
            </button>
            <button onClick={toggle}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 transition-colors">
              {isPlaying ? <Pause className="h-4 w-4 text-white" /> : <Play className="h-4 w-4 text-white" />}
            </button>
            <button onClick={onNext} disabled={!hasNext}
              className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors">
              <SkipForward className="h-4 w-4" />
            </button>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-2 w-full max-w-xs">
            <span className="text-[10px] text-slate-500 w-8 text-right">{formatTime(currentTime)}</span>
            <input
              type="range" min={0} max={duration || 1} step={0.5} value={currentTime}
              onChange={seek}
              className="flex-1 h-1 appearance-none bg-slate-700 rounded cursor-pointer accent-rose-500"
            />
            <span className="text-[10px] text-slate-500 w-8">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Volume + close */}
        <div className="flex items-center gap-3 flex-1 justify-end">
          <div className="flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              onChange={e => setVolume(parseFloat(e.target.value))}
              className="w-20 h-1 appearance-none bg-slate-700 rounded cursor-pointer accent-rose-500"
            />
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function MusicSettingsClient({ initialTracks, byCategory, categories }: Props) {
  const [tracks, setTracks] = useState<MusicTrack[]>(initialTracks);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);

  const [form, setForm] = useState({ title: "", youtubeUrl: "", category: categories[0]?.id ?? "", notes: "" });

  const filtered = activeCategory === "all" ? tracks : tracks.filter(t => t.category === activeCategory);

  const playableTracks = (catId: string) =>
    filtered.filter(t => t.category === catId && t.status === "done" && t.filePath);

  const handlePlay = (track: MusicTrack, catId: string) => {
    const playlist = playableTracks(catId);
    const index = playlist.findIndex(t => t.id === track.id);
    setNowPlaying({ track, playlist, index: Math.max(0, index) });
  };

  const handlePrev = () => {
    if (!nowPlaying || nowPlaying.index <= 0) return;
    const i = nowPlaying.index - 1;
    setNowPlaying({ ...nowPlaying, track: nowPlaying.playlist[i], index: i });
  };

  const handleNext = () => {
    if (!nowPlaying || nowPlaying.index >= nowPlaying.playlist.length - 1) return;
    const i = nowPlaying.index + 1;
    setNowPlaying({ ...nowPlaying, track: nowPlaying.playlist[i], index: i });
  };

  const handleAdd = () => {
    if (!form.title.trim()) return;
    startTransition(async () => {
      const id = await addMusicTrackAction({
        title: form.title,
        youtubeUrl: form.youtubeUrl || undefined,
        category: form.category,
        notes: form.notes || undefined,
      });
      const newTrack: MusicTrack = {
        id, title: form.title, youtubeUrl: form.youtubeUrl || null,
        category: form.category, notes: form.notes || null,
        filePath: null, duration: null, fileSizeBytes: null,
        status: form.youtubeUrl ? "pending" : "done",
        errorMessage: null, createdAt: new Date(),
      };
      setTracks(prev => [newTrack, ...prev]);
      setForm({ title: "", youtubeUrl: "", category: categories[0]?.id ?? "", notes: "" });
      setShowAdd(false);
    });
  };

  const handleDownload = async (trackId: string) => {
    setDownloadingIds(prev => new Set(prev).add(trackId));
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, status: "downloading" } : t));
    try {
      const res = await fetch("/api/music/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      const data = await res.json() as { success?: boolean; filePath?: string; duration?: number; error?: string };
      setTracks(prev => prev.map(t => t.id === trackId
        ? { ...t, status: data.success ? "done" : "error", filePath: data.filePath ?? null, duration: data.duration ?? null, errorMessage: data.error ?? null }
        : t
      ));
    } catch (e) {
      setTracks(prev => prev.map(t => t.id === trackId ? { ...t, status: "error", errorMessage: String(e) } : t));
    }
    setDownloadingIds(prev => { const s = new Set(prev); s.delete(trackId); return s; });
  };

  const handleDelete = (id: string) => {
    if (nowPlaying?.track.id === id) setNowPlaying(null);
    startTransition(async () => {
      await deleteMusicTrackAction(id);
      setTracks(prev => prev.filter(t => t.id !== id));
    });
  };

  const handleDownloadAll = async () => {
    for (const t of filtered.filter(t => t.status === "pending" && t.youtubeUrl)) {
      await handleDownload(t.id);
    }
  };

  return (
    // padding bottom khi player đang mở
    <div className={`space-y-6 ${nowPlaying ? "pb-24" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Nhạc nền</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý nhạc nền theo chủ đề, tải từ YouTube</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 transition-colors">
          <Plus className="h-4 w-4" /> Thêm bài
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-200">Thêm bài nhạc mới</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Tên bài *</label>
              <input value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))}
                placeholder="Nhạc thiền định..."
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Link YouTube</label>
              <input value={form.youtubeUrl} onChange={e => setForm(p => ({...p, youtubeUrl: e.target.value}))}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Chủ đề *</label>
              <select value={form.category} onChange={e => setForm(p => ({...p, category: e.target.value}))}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Ghi chú</label>
              <input value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))}
                placeholder="Nhạc nhẹ, 1 tiếng lặp..."
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">Hủy</button>
            <button onClick={handleAdd} disabled={isPending || !form.title.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50 transition-colors">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Thêm
            </button>
          </div>
        </div>
      )}

      {/* Category stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button onClick={() => setActiveCategory("all")}
          className={`rounded-xl border p-3 text-left transition-colors ${activeCategory === "all" ? "border-rose-500 bg-rose-950/20" : "border-slate-700 bg-slate-900 hover:border-slate-600"}`}>
          <p className="text-lg font-bold text-slate-100">{tracks.length}</p>
          <p className="text-xs text-slate-400">Tất cả</p>
          <p className="text-xs text-slate-600">{tracks.filter(t => t.status === "done").length} đã tải</p>
        </button>
        {byCategory.filter(c => c.total > 0 || activeCategory === c.id).map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
            className={`rounded-xl border p-3 text-left transition-colors ${activeCategory === cat.id ? "border-rose-500 bg-rose-950/20" : "border-slate-700 bg-slate-900 hover:border-slate-600"}`}>
            <p className="text-lg font-bold text-slate-100">{cat.total}</p>
            <p className="text-xs text-slate-400">{cat.label}</p>
            <p className="text-xs text-slate-600">{cat.done} tải · {cat.totalDuration > 0 ? formatDuration(cat.totalDuration) : "—"}</p>
          </button>
        ))}
      </div>

      {/* Action bar */}
      {filtered.some(t => t.status === "pending" && t.youtubeUrl) && (
        <div className="flex items-center gap-3">
          <button onClick={handleDownloadAll}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
            <Download className="h-3.5 w-3.5" />
            Tải tất cả ({filtered.filter(t => t.status === "pending" && t.youtubeUrl).length} bài)
          </button>
        </div>
      )}

      {/* Track list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900 py-16 text-center">
          <Music className="h-8 w-8 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Chưa có bài nào. Thêm link YouTube để bắt đầu!</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
          {(activeCategory === "all"
            ? [...new Set(filtered.map(t => t.category))]
            : [activeCategory]
          ).map(catId => {
            const catTracks = filtered.filter(t => t.category === catId);
            const catLabel = categories.find(c => c.id === catId)?.label ?? catId;
            if (catTracks.length === 0) return null;
            return (
              <div key={catId}>
                <div className="px-4 py-2 bg-slate-800/60 border-b border-slate-700 flex items-center gap-2">
                  <Music className="h-3.5 w-3.5 text-rose-400" />
                  <span className="text-xs font-semibold text-slate-300">{catLabel}</span>
                  <span className="text-xs text-slate-500">({catTracks.length} bài)</span>
                </div>
                {catTracks.map(track => {
                  const st = STATUS_CONFIG[track.status] ?? STATUS_CONFIG.pending;
                  const isDown = downloadingIds.has(track.id);
                  const isCurrentlyPlaying = nowPlaying?.track.id === track.id;
                  const canPlay = track.status === "done" && !!track.filePath;

                  return (
                    <div key={track.id}
                      className={`group flex items-center gap-3 px-4 py-3 border-b border-slate-800 last:border-0 transition-colors ${
                        isCurrentlyPlaying ? "bg-rose-950/20" : "hover:bg-slate-800/30"
                      }`}>

                      {/* Play / Status icon */}
                      <div className="shrink-0 w-7 flex items-center justify-center">
                        {canPlay ? (
                          <button onClick={() => handlePlay(track, catId)}
                            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                              isCurrentlyPlaying
                                ? "bg-rose-600 text-white"
                                : "text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                            }`}>
                            {isCurrentlyPlaying
                              ? <Pause className="h-3.5 w-3.5" />
                              : <Play className="h-3.5 w-3.5 ml-0.5" />
                            }
                          </button>
                        ) : (
                          <div className={st.cls}>{st.icon}</div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isCurrentlyPlaying ? "text-rose-400" : "text-slate-200"}`}>
                          {track.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {track.duration && <span className="text-xs text-slate-500">{formatDuration(track.duration)}</span>}
                          {track.fileSizeBytes && <span className="text-xs text-slate-600">{formatSize(track.fileSizeBytes)}</span>}
                          {track.youtubeUrl && (
                            <a href={track.youtubeUrl} target="_blank" rel="noreferrer"
                              className="text-xs text-rose-400/70 hover:text-rose-400 truncate max-w-[200px]">
                              ↗ YouTube
                            </a>
                          )}
                          {track.notes && <span className="text-xs text-slate-600 italic">{track.notes}</span>}
                          {track.status === "error" && track.errorMessage && (
                            <span title={track.errorMessage} className="text-xs text-red-400 flex items-center gap-0.5">
                              <AlertCircle className="h-3 w-3" /> {track.errorMessage.slice(0, 60)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {track.youtubeUrl && (
                          <button onClick={() => handleDownload(track.id)} disabled={isDown}
                            title={track.status === "done" ? "Tải lại" : "Tải về"}
                            className={`p-1.5 rounded-md transition-colors disabled:opacity-40 ${
                              track.status === "done"
                                ? "text-slate-600 hover:text-blue-400 hover:bg-blue-950/30 opacity-0 group-hover:opacity-100"
                                : "text-blue-400 hover:text-blue-300 hover:bg-blue-950/30"
                            }`}>
                            {isDown ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button onClick={() => handleDelete(track.id)} disabled={isPending}
                          title="Xóa" className="p-1.5 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Mini Player */}
      {nowPlaying && (
        <MiniPlayer
          nowPlaying={nowPlaying}
          onClose={() => setNowPlaying(null)}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      )}
    </div>
  );
}
