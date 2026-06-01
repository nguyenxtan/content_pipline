"use client";

import { useState, useCallback } from "react";
import { CalendarClock, ChevronUp, ChevronDown, Plus, X, Play, Loader2, Video, Film, FileText, ClipboardList, RefreshCw, CheckCircle2, XCircle, Pencil } from "lucide-react";
import type { Niche, CronRunLog } from "@/lib/db/schema";
import type { SchedulerJobRecord } from "@/lib/validations/content-generator";
import {
  createSchedulerJobAction,
  updateSchedulerJobAction,
  deleteSchedulerJobAction,
  runSchedulerJobAction,
  getCronLogsAction,
} from "@/actions/content-generator";
import { ModelDropdown } from "@/components/ui/model-dropdown";

const FREQUENCY_OPTIONS: { value: string; label: string; cron: string }[] = [
  { value: "15min",   label: "Mỗi 15 phút",  cron: "*/15 * * * *"  },
  { value: "30min",   label: "Mỗi 30 phút",  cron: "*/30 * * * *"  },
  { value: "45min",   label: "Mỗi 45 phút",  cron: "*/45 * * * *"  },
  { value: "hourly",  label: "Mỗi 1 giờ",    cron: "0 * * * *"     },
  { value: "90min",   label: "Mỗi 90 phút",  cron: "~1.5h"         },
  { value: "2hourly", label: "Mỗi 2 giờ",    cron: "0 */2 * * *"   },
  { value: "3hourly", label: "Mỗi 3 giờ",    cron: "0 */3 * * *"   },
  { value: "4hourly", label: "Mỗi 4 giờ",    cron: "0 */4 * * *"   },
  { value: "6hourly", label: "Mỗi 6 giờ",    cron: "0 */6 * * *"   },
  { value: "12hourly",label: "Mỗi 12 giờ",   cron: "0 */12 * * *"  },
  { value: "daily",   label: "Hằng ngày",    cron: "0 0 * * *"     },
  { value: "custom",  label: "Custom (cron)", cron: ""              },
];

const FREQUENCY_LABELS: Record<string, string> = Object.fromEntries(
  FREQUENCY_OPTIONS.map(o => [o.value, o.label])
);

const JOB_TYPE_CONFIG = {
  content_gen:    { label: "Tạo content",    icon: FileText, color: "text-violet-400", badge: "bg-violet-900/40 border-violet-700/40 text-violet-400" },
  short_pipeline: { label: "Short pipeline", icon: Video,    color: "text-rose-400",   badge: "bg-rose-900/40   border-rose-700/40   text-rose-400"   },
  long_pipeline:  { label: "Long pipeline",  icon: Film,     color: "text-cyan-400",   badge: "bg-cyan-900/40   border-cyan-700/40   text-cyan-400"   },
} as const;

const VOICES = [
  { id: "Ly",    name: "Trúc Ly",    gender: "Nữ",  region: "Bắc" },
  { id: "Ngoc",  name: "Bích Ngọc",  gender: "Nữ",  region: "Bắc" },
  { id: "Binh",  name: "Thanh Bình", gender: "Nam", region: "Bắc" },
  { id: "Tuyen", name: "Phạm Tuyên", gender: "Nam", region: "Bắc" },
  { id: "Doan",  name: "Thục Đoan",  gender: "Nữ",  region: "Nam" },
  { id: "Vinh",  name: "Xuân Vĩnh",  gender: "Nam", region: "Nam" },
  { id: "Son",   name: "Thái Sơn",   gender: "Nam", region: "Nam" },
];

const IMAGE_STYLE_PRESETS = [
  { id: "",           label: "🎲 Random (tự xoay 3 style)" },
  { id: "cinematic",  label: "🎬 Cinematic — sương mờ, ánh sáng điện ảnh, depth of field" },
  { id: "watercolor", label: "🎨 Watercolor — thủy mặc Đông Á, tối giản, thanh thoát" },
  { id: "vintage",    label: "🎞️ Vintage — ảnh phim Kodachrome, hạt mịn, wabi-sabi" },
];

const THUMBNAIL_STYLE_PRESETS = [
  { id: "",           label: "🎲 Random (tự xoay 4 style)" },
  { id: "dramatic",   label: "🔥 Dramatic — đối nghịch mạnh, màu sắc sống động, hoành tráng" },
  { id: "mystical",   label: "✨ Mystical — hào quang thần thánh, ánh sáng thiên đình, mơ huyền" },
  { id: "painterly",  label: "🖼️ Painterly — sơn dầu cổ điển, bút pháp phong phú, Renaissance" },
  { id: "vivid",      label: "💎 Vivid — siêu sắc nét, màu rực rỡ tối đa, 8K HDR" },
];

const LONG_FAL_MODELS = [
  { id: "",                          label: "— Dùng global config —",            cost: null  },
  { id: "fal-ai/flux/schnell",       label: "⚡ flux/schnell  ($0.003/ảnh)",      cost: 0.003 },
  { id: "fal-ai/flux/dev",           label: "🎨 flux/dev  ($0.025/ảnh)",          cost: 0.025 },
  { id: "fal-ai/flux-pro/v1.1",      label: "✨ flux-pro/v1.1  ($0.040/ảnh)",    cost: 0.040 },
  { id: "fal-ai/flux-pro/v1.1-ultra",label: "🌟 flux-pro/ultra  ($0.060/ảnh)",   cost: 0.060 },
];

const CONTENT_MODE_LABELS: Record<string, string> = {
  short: "Short only",
  long:  "Long only",
  both:  "Short + Long",
};

function relativeTime(date: Date | null): string {
  if (!date) return "—";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 0)     return `trong ${Math.abs(Math.floor(diff / 60))}p nữa`;
  if (diff < 60)    return `${diff}s trước`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}p trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
  return `${Math.floor(diff / 86400)}d trước`;
}

function futureRelativeTime(date: Date | null): string {
  if (!date) return "—";
  const diff = Math.floor((new Date(date).getTime() - Date.now()) / 1000);
  if (diff <= 0)    return "sắp chạy";
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}p`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function absoluteTime(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* ─── Create form ─────────────────────────────────────────── */
function CreateJobForm({ niches, onCreated }: { niches: Niche[]; onCreated: (job: SchedulerJobRecord) => void }) {
  const active = niches.filter(n => n.isActive);
  const [nicheId,     setNicheId]     = useState(active[0]?.id ?? 0);
  const [jobType,     setJobType]     = useState<"content_gen" | "short_pipeline" | "long_pipeline">("content_gen");
  const [contentMode, setContentMode] = useState<"short" | "long" | "both">("both");
  const [batchSize,   setBatchSize]   = useState(3);
  const [topic,       setTopic]       = useState("");
  const [frequency,   setFrequency]   = useState<string>("hourly");
  const [cron,        setCron]        = useState("");
  const [topicModel,    setTopicModel]    = useState("openai/gpt-4o-mini");
  const [scriptModel,   setScriptModel]   = useState("openai/gpt-4o-mini");
  const [ttsVoice,       setTtsVoice]       = useState("");
  const [imageCount,     setImageCount]     = useState(3);
  const [imageStyleId,   setImageStyleId]   = useState("");
  const [bgMusicVal,     setBgMusicVal]     = useState<"" | "true" | "false">("");
  const [longImageCount,        setLongImageCount]        = useState(5);
  const [longImageStyle,        setLongImageStyle]        = useState("");
  const [longFalModel,          setLongFalModel]          = useState("");
  const [longThumbnailFalModel,      setLongThumbnailFalModel]      = useState("fal-ai/flux-pro/v1.1-ultra");
  const [longThumbnailLlmModel,      setLongThumbnailLlmModel]      = useState("openai/gpt-4o-mini");
  const [longThumbnailImageStyle,    setLongThumbnailImageStyle]    = useState("");
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState("");

  const handleCreate = async () => {
    setError("");
    setLoading(true);
    const isPipeline = jobType !== "content_gen";
    const res = await createSchedulerJobAction({
      nicheId,
      jobType,
      contentMode,
      batchSize,
      topic: jobType === "content_gen" ? topic.trim() : "",
      frequency: frequency as "15min" | "30min" | "45min" | "hourly" | "90min" | "2hourly" | "3hourly" | "4hourly" | "6hourly" | "12hourly" | "daily" | "custom",
      cronExpression: frequency === "custom" ? cron : undefined,
      topicModel:  jobType === "content_gen" ? topicModel : undefined,
      scriptModel: jobType === "content_gen" ? scriptModel : undefined,
      ttsVoice:       isPipeline && ttsVoice ? ttsVoice : undefined,
      imageCount:     jobType === "short_pipeline" ? imageCount : undefined,
      imageStyle:     jobType === "short_pipeline" ? (imageStyleId || undefined) : undefined,
      bgMusic:        jobType === "short_pipeline" ? (bgMusicVal === "true" ? true : bgMusicVal === "false" ? false : undefined) : undefined,
      longImageCount:        jobType === "long_pipeline" ? longImageCount                         : undefined,
      longImageStyle:        jobType === "long_pipeline" ? (longImageStyle        || undefined)  : undefined,
      longFalModel:          jobType === "long_pipeline" ? (longFalModel          || undefined)  : undefined,
      longThumbnailFalModel:      jobType === "long_pipeline" ? (longThumbnailFalModel      || undefined) : undefined,
      longThumbnailLlmModel:      jobType === "long_pipeline" ? (longThumbnailLlmModel      || undefined) : undefined,
      longThumbnailImageStyle:    jobType === "long_pipeline" ? (longThumbnailImageStyle    || undefined) : undefined,
    });
    setLoading(false);
    if ("error" in res) { setError(res.error); return; }
    setTopic("");
    onCreated({
      id: res.jobId,
      jobType,
      contentMode,
      batchSize,
      topic: jobType === "content_gen" ? topic.trim() : "",
      nicheName: active.find(n => n.id === nicheId)?.name ?? "",
      nicheId,
      frequency,
      cronExpression: frequency === "custom" ? cron : null,
      isEnabled: true,
      lastRunAt: null,
      nextRunAt: res.nextRunAt,
      createdAt: new Date(),
      topicModel:  jobType === "content_gen" ? topicModel : null,
      scriptModel: jobType === "content_gen" ? scriptModel : null,
      ttsVoice:       isPipeline && ttsVoice ? ttsVoice : null,
      imageCount:     jobType === "short_pipeline" ? imageCount : null,
      imageStyle:     jobType === "short_pipeline" ? (imageStyleId || null) : null,
      bgMusic:        jobType === "short_pipeline" ? (bgMusicVal === "true" ? true : bgMusicVal === "false" ? false : null) : null,
      longImageCount:        jobType === "long_pipeline" ? longImageCount                        : null,
      longImageStyle:        jobType === "long_pipeline" ? (longImageStyle        || null)       : null,
      longFalModel:          jobType === "long_pipeline" ? (longFalModel          || null)       : null,
      longThumbnailFalModel:      jobType === "long_pipeline" ? (longThumbnailFalModel      || null) : null,
      longThumbnailLlmModel:      jobType === "long_pipeline" ? (longThumbnailLlmModel      || null) : null,
      longThumbnailImageStyle:    jobType === "long_pipeline" ? (longThumbnailImageStyle    || null) : null,
    });
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-4">
      <h4 className="text-sm font-semibold text-slate-200">Thêm job mới</h4>

      {/* Row 1: Loại job + Lĩnh vực */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Loại job</label>
          <select value={jobType} onChange={e => setJobType(e.target.value as typeof jobType)}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
            <option value="content_gen">📝 Tạo content (AI)</option>
            <option value="short_pipeline">🎬 Short pipeline</option>
            <option value="long_pipeline">🎥 Long pipeline</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Lĩnh vực</label>
          <select value={nicheId} onChange={e => setNicheId(Number(e.target.value))}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
            {active.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </div>
      </div>

      {/* Row 2: Tần suất + Content mode */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Tần suất</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value)}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
            {FREQUENCY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}{o.cron ? `  ·  ${o.cron}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            {jobType === "content_gen" ? "Content tạo ra" : "Lọc content"}
          </label>
          <select value={contentMode} onChange={e => setContentMode(e.target.value as typeof contentMode)}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
            {jobType !== "long_pipeline"  && <option value="short">Short only</option>}
            {jobType !== "short_pipeline" && <option value="long">Long only</option>}
            <option value="both">Short + Long</option>
          </select>
        </div>
      </div>

      {/* Cron expression */}
      {frequency === "custom" && (
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Cron expression</label>
          <input value={cron} onChange={e => setCron(e.target.value)} placeholder="e.g. 0 8 * * *"
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500" />
        </div>
      )}

      {/* Pipeline batch size */}
      {jobType !== "content_gen" && (
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Số item mỗi lần chạy</label>
          <input type="number" min={1} max={10} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}
            className="w-24 border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
          <p className="text-[11px] text-slate-600 mt-1">
            {jobType === "long_pipeline" ? "Long TTS mất 5-10 phút/item, nên để 1-2." : "Short TTS + ảnh + video mất ~3-5 phút/item."}
          </p>
        </div>
      )}

      {/* Pipeline voice + image settings */}
      {jobType !== "content_gen" && (
        <div className="space-y-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Cài đặt pipeline</p>

          {/* Voice */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Giọng đọc TTS</label>
            <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
              className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
              <option value="">— Dùng giọng của phân mục —</option>
              {VOICES.map(v => (
                <option key={v.id} value={v.id}>{v.name} · {v.gender} · {v.region}</option>
              ))}
            </select>
          </div>

          {/* Image count + style — chỉ cho short pipeline */}
          {jobType === "short_pipeline" && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Số hình ảnh mỗi video</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={20} value={imageCount} onChange={e => setImageCount(Number(e.target.value))}
                    className="w-20 border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
                  <span className="text-xs text-slate-500">hình · ước tính ${(imageCount * 0.003).toFixed(3)}/video</span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Phong cách hình ảnh</label>
                <select value={imageStyleId} onChange={e => setImageStyleId(e.target.value)}
                  className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                  {IMAGE_STYLE_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Nhạc nền</label>
                <select value={bgMusicVal} onChange={e => setBgMusicVal(e.target.value as "" | "true" | "false")}
                  className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                  <option value="">🎵 Tự động (theo lĩnh vực)</option>
                  <option value="true">✅ Có nhạc nền</option>
                  <option value="false">🔇 Không nhạc nền</option>
                </select>
                <p className="text-[11px] text-slate-600 mt-1">Nhạc nền lấy từ thư mục nhạc đã cấu hình trong lĩnh vực.</p>
              </div>
            </>
          )}

          {/* Long pipeline image config */}
          {jobType === "long_pipeline" && (
            <>
              {/* ── Video images ── */}
              <p className="text-[10px] font-semibold text-cyan-500 uppercase tracking-wider pt-1">Ảnh video (landscape 16:9)</p>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Số hình</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={20} value={longImageCount} onChange={e => setLongImageCount(Number(e.target.value))}
                    className="w-20 border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
                  <span className="text-xs text-slate-500">ảnh landscape</span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Phong cách</label>
                <select value={longImageStyle} onChange={e => setLongImageStyle(e.target.value)}
                  className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                  {IMAGE_STYLE_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Model tạo ảnh (fal.ai)</label>
                <select value={longFalModel} onChange={e => setLongFalModel(e.target.value)}
                  className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                  {LONG_FAL_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* ── Thumbnail ── */}
              <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider pt-1">Thumbnail (1280×720)</p>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Model tạo ảnh thumbnail</label>
                <select value={longThumbnailFalModel} onChange={e => setLongThumbnailFalModel(e.target.value)}
                  className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                  {LONG_FAL_MODELS.filter(m => m.id !== "").map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-600 mt-1">Dùng model chất lượng cao nhất để thumbnail bắt mắt.</p>
              </div>

              <ModelDropdown
                label="LLM viết prompt thumbnail"
                value={longThumbnailLlmModel}
                onChange={setLongThumbnailLlmModel}
                size="sm"
              />
              <p className="text-[11px] text-slate-600 -mt-2">LLM VIP → prompt thumbnail sắc nét, đúng tâm lý click.</p>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Phong cách thumbnail</label>
                <select value={longThumbnailImageStyle} onChange={e => setLongThumbnailImageStyle(e.target.value)}
                  className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500">
                  {THUMBNAIL_STYLE_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Cost estimate */}
              {(() => {
                const imgCost   = (LONG_FAL_MODELS.find(m => m.id === longFalModel)?.cost ?? 0.025) * longImageCount;
                const thumbCost = LONG_FAL_MODELS.find(m => m.id === longThumbnailFalModel)?.cost ?? 0.060;
                return (
                  <p className="text-[11px] text-slate-500">
                    Ước tính fal.ai: ~${(imgCost + thumbCost).toFixed(3)}/video
                    ({longImageCount} ảnh + 1 thumbnail)
                  </p>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Content gen specific fields */}
      {jobType === "content_gen" && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Chủ đề <span className="text-slate-600">(để trống = tự gợi ý mỗi lần chạy)</span>
            </label>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Để trống để AI tự chọn chủ đề mỗi lần..."
              className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500" />
          </div>
          {!topic.trim() && (
            <ModelDropdown label="Model gợi ý chủ đề" value={topicModel} onChange={setTopicModel} size="sm" />
          )}
          <ModelDropdown label="Model tạo script" value={scriptModel} onChange={setScriptModel} size="sm" />
          <p className="text-[11px] text-slate-600">Short/Long video dùng model đã lưu trong prompt của lĩnh vực.</p>
        </>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button onClick={handleCreate} disabled={loading || nicheId === 0}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-500 disabled:opacity-50 transition-colors">
        <Plus className="h-3.5 w-3.5" />
        {loading ? "Đang tạo..." : "Tạo job"}
      </button>
    </div>
  );
}

function EditJobForm({
  job,
  niches,
  onCancel,
  onSaved,
}: {
  job: SchedulerJobRecord;
  niches: Niche[];
  onCancel: () => void;
  onSaved: (job: SchedulerJobRecord) => void;
}) {
  const active = niches.filter(n => n.isActive);
  const [nicheId,     setNicheId]     = useState(job.nicheId);
  const [jobType,     setJobType]     = useState<"content_gen" | "short_pipeline" | "long_pipeline">(job.jobType);
  const [contentMode, setContentMode] = useState<"short" | "long" | "both">(job.contentMode);
  const [batchSize,   setBatchSize]   = useState(job.batchSize ?? 1);
  const [topic,       setTopic]       = useState(job.topic ?? "");
  const [frequency,   setFrequency]   = useState(job.frequency);
  const [cron,        setCron]        = useState(job.cronExpression ?? "");
  const [topicModel,  setTopicModel]  = useState(job.topicModel ?? "openai/gpt-4o-mini");
  const [scriptModel, setScriptModel] = useState(job.scriptModel ?? "openai/gpt-4o-mini");
  const [ttsVoice,    setTtsVoice]    = useState(job.ttsVoice ?? "");
  const [imageCount,  setImageCount]  = useState(job.imageCount ?? 3);
  const [imageStyle,  setImageStyle]  = useState(job.imageStyle ?? "");
  const [bgMusicVal,  setBgMusicVal]  = useState<"" | "true" | "false">(
    job.bgMusic === true ? "true" : job.bgMusic === false ? "false" : ""
  );
  const [longImageCount, setLongImageCount] = useState(job.longImageCount ?? 5);
  const [longImageStyle, setLongImageStyle] = useState(job.longImageStyle ?? "");
  const [longFalModel,   setLongFalModel]   = useState(job.longFalModel ?? "");
  const [longThumbnailFalModel,   setLongThumbnailFalModel]   = useState(job.longThumbnailFalModel ?? "fal-ai/flux-pro/v1.1-ultra");
  const [longThumbnailLlmModel,   setLongThumbnailLlmModel]   = useState(job.longThumbnailLlmModel ?? "openai/gpt-4o-mini");
  const [longThumbnailImageStyle, setLongThumbnailImageStyle] = useState(job.longThumbnailImageStyle ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function handleSave() {
    setError("");
    setSaving(true);
    const isPipeline = jobType !== "content_gen";
    const savedContentMode =
      jobType === "short_pipeline" && contentMode === "long" ? "both" :
      jobType === "long_pipeline" && contentMode === "short" ? "both" :
      contentMode;
    const res = await updateSchedulerJobAction(job.id, {
      nicheId,
      jobType,
      contentMode: savedContentMode,
      batchSize,
      topic: jobType === "content_gen" ? topic.trim() : "",
      frequency,
      cronExpression: frequency === "custom" ? cron : null,
      topicModel: jobType === "content_gen" ? topicModel : null,
      scriptModel: jobType === "content_gen" ? scriptModel : null,
      ttsVoice: isPipeline && ttsVoice ? ttsVoice : null,
      imageCount: jobType === "short_pipeline" ? imageCount : null,
      imageStyle: jobType === "short_pipeline" ? imageStyle || null : null,
      bgMusic: jobType === "short_pipeline" ? (bgMusicVal === "true" ? true : bgMusicVal === "false" ? false : null) : null,
      longImageCount: jobType === "long_pipeline" ? longImageCount : null,
      longImageStyle: jobType === "long_pipeline" ? longImageStyle || null : null,
      longFalModel: jobType === "long_pipeline" ? longFalModel || null : null,
      longThumbnailFalModel: jobType === "long_pipeline" ? longThumbnailFalModel || null : null,
      longThumbnailLlmModel: jobType === "long_pipeline" ? longThumbnailLlmModel || null : null,
      longThumbnailImageStyle: jobType === "long_pipeline" ? longThumbnailImageStyle || null : null,
    });
    setSaving(false);
    if (!res.success) {
      setError("Không lưu được cấu hình job. Kiểm tra cron expression hoặc lĩnh vực.");
      return;
    }

    onSaved({
      ...job,
      nicheId,
      nicheName: active.find(n => n.id === nicheId)?.name ?? job.nicheName,
      jobType,
      contentMode: savedContentMode,
      batchSize,
      topic: jobType === "content_gen" ? topic.trim() : "",
      frequency,
      cronExpression: frequency === "custom" ? cron : null,
      nextRunAt: res.nextRunAt ?? job.nextRunAt,
      topicModel: jobType === "content_gen" ? topicModel : null,
      scriptModel: jobType === "content_gen" ? scriptModel : null,
      ttsVoice: isPipeline && ttsVoice ? ttsVoice : null,
      imageCount: jobType === "short_pipeline" ? imageCount : null,
      imageStyle: jobType === "short_pipeline" ? imageStyle || null : null,
      bgMusic: jobType === "short_pipeline" ? (bgMusicVal === "true" ? true : bgMusicVal === "false" ? false : null) : null,
      longImageCount: jobType === "long_pipeline" ? longImageCount : null,
      longImageStyle: jobType === "long_pipeline" ? longImageStyle || null : null,
      longFalModel: jobType === "long_pipeline" ? longFalModel || null : null,
      longThumbnailFalModel: jobType === "long_pipeline" ? longThumbnailFalModel || null : null,
      longThumbnailLlmModel: jobType === "long_pipeline" ? longThumbnailLlmModel || null : null,
      longThumbnailImageStyle: jobType === "long_pipeline" ? longThumbnailImageStyle || null : null,
    });
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Loại job</label>
          <select value={jobType} onChange={e => setJobType(e.target.value as typeof jobType)}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
            <option value="content_gen">Tạo content</option>
            <option value="short_pipeline">Short pipeline</option>
            <option value="long_pipeline">Long pipeline</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Lĩnh vực</label>
          <select value={nicheId} onChange={e => setNicheId(Number(e.target.value))}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
            {active.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Tần suất</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value)}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
            {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">{jobType === "content_gen" ? "Content tạo ra" : "Lọc content"}</label>
          <select value={contentMode} onChange={e => setContentMode(e.target.value as typeof contentMode)}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
            {jobType !== "long_pipeline" && <option value="short">Short only</option>}
            {jobType !== "short_pipeline" && <option value="long">Long only</option>}
            <option value="both">Short + Long</option>
          </select>
        </div>
      </div>

      {frequency === "custom" && (
        <input value={cron} onChange={e => setCron(e.target.value)} placeholder="Cron expression"
          className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200 font-mono" />
      )}

      {jobType !== "content_gen" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Số item/lần chạy</label>
            <input type="number" min={1} max={20} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}
              className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Giọng đọc</label>
            <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
              className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
              <option value="">Dùng giọng lĩnh vực</option>
              {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {jobType === "content_gen" && (
        <>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Để trống để AI tự gợi ý chủ đề"
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200" />
          {!topic.trim() && <ModelDropdown label="Model gợi ý chủ đề" value={topicModel} onChange={setTopicModel} size="sm" />}
          <ModelDropdown label="Model tạo script" value={scriptModel} onChange={setScriptModel} size="sm" />
        </>
      )}

      {jobType === "short_pipeline" && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Số hình</label>
            <input type="number" min={1} max={20} value={imageCount} onChange={e => setImageCount(Number(e.target.value))}
              className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Style</label>
            <select value={imageStyle} onChange={e => setImageStyle(e.target.value)}
              className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
              {IMAGE_STYLE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Nhạc nền</label>
            <select value={bgMusicVal} onChange={e => setBgMusicVal(e.target.value as "" | "true" | "false")}
              className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
              <option value="">Tự động</option>
              <option value="true">Có nhạc</option>
              <option value="false">Không nhạc</option>
            </select>
          </div>
        </div>
      )}

      {jobType === "long_pipeline" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input type="number" min={1} max={20} value={longImageCount} onChange={e => setLongImageCount(Number(e.target.value))}
              className="border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200" />
            <select value={longImageStyle} onChange={e => setLongImageStyle(e.target.value)}
              className="border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
              {IMAGE_STYLE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select value={longFalModel} onChange={e => setLongFalModel(e.target.value)}
              className="border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
              {LONG_FAL_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select value={longThumbnailFalModel} onChange={e => setLongThumbnailFalModel(e.target.value)}
              className="border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
              {LONG_FAL_MODELS.filter(m => m.id !== "").map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <ModelDropdown label="LLM prompt thumbnail" value={longThumbnailLlmModel} onChange={setLongThumbnailLlmModel} size="sm" />
          <select value={longThumbnailImageStyle} onChange={e => setLongThumbnailImageStyle(e.target.value)}
            className="w-full border border-slate-600 rounded-lg px-2.5 py-2 text-sm bg-slate-900 text-slate-200">
            {THUMBNAIL_STYLE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1.5 text-xs font-medium rounded bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50">
          {saving ? "Đang lưu..." : "Lưu thay đổi"}
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-3 py-1.5 text-xs rounded border border-slate-600 text-slate-400 hover:text-slate-200">
          Hủy
        </button>
      </div>
    </div>
  );
}

/* ─── Job row ─────────────────────────────────────────────── */
function JobRow({ job, niches, onToggle, onDelete, onRan, onUpdated }: {
  job: SchedulerJobRecord;
  niches: Niche[];
  onToggle: () => void;
  onDelete: () => void;
  onRan: (j: Partial<SchedulerJobRecord>) => void;
  onUpdated: (j: SchedulerJobRecord) => void;
}) {
  const [running,   setRunning]   = useState(false);
  const [runResult, setRunResult] = useState<string>("");
  const [editing,   setEditing]   = useState(false);

  async function handleRunNow() {
    setRunning(true);
    setRunResult("");
    const res = await runSchedulerJobAction(job.id);
    setRunning(false);
    if ("error" in res) {
      setRunResult(`❌ ${res.error}`);
    } else if (res.processed !== undefined) {
      setRunResult(`✓ Đã xử lý ${res.processed} item`);
      onRan({ lastRunAt: new Date() });
    } else {
      setRunResult(`✓ Đã tạo: "${res.topic}"`);
      onRan({ lastRunAt: new Date() });
    }
  }

  const cfg = JOB_TYPE_CONFIG[job.jobType];
  const Icon = cfg.icon;

  return (
    <div className="py-3 space-y-2">
      {editing ? (
        <EditJobForm
          job={job}
          niches={niches}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            onUpdated(updated);
            setEditing(false);
          }}
        />
      ) : (
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Job type badge */}
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${cfg.badge}`}>
              <Icon className="h-2.5 w-2.5" />
              {cfg.label}
            </span>
            {/* Content mode badge */}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
              {CONTENT_MODE_LABELS[job.contentMode]}
            </span>
            {/* Topic / auto for content_gen */}
            {job.jobType === "content_gen" && (
              <p className="text-sm font-medium text-slate-200 truncate">
                {!job.topic.trim()
                  ? <span className="italic text-slate-500">Tự gợi ý chủ đề</span>
                  : job.topic}
              </p>
            )}
            {/* Batch size for pipeline jobs */}
            {job.jobType !== "content_gen" && (
              <span className="text-[10px] text-slate-500">batch: {job.batchSize}</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {job.nicheName} · {FREQUENCY_LABELS[job.frequency] ?? job.frequency}
            {job.cronExpression ? ` (${job.cronExpression})` : ""}
            {job.jobType !== "content_gen" && job.ttsVoice && (
              <span className="ml-1 text-slate-600">· 🎙 {VOICES.find(v => v.id === job.ttsVoice)?.name ?? job.ttsVoice}</span>
            )}
            {job.jobType === "short_pipeline" && job.imageCount && (
              <span className="ml-1 text-slate-600">· 🖼 {job.imageCount} hình</span>
            )}
            {job.jobType === "long_pipeline" && job.longImageCount && (
              <span className="ml-1 text-slate-600">· 🖼 {job.longImageCount} hình</span>
            )}
          </p>
          {job.jobType === "short_pipeline" && (
            <p className="text-[11px] text-slate-600 mt-0.5 truncate">
              Style: {IMAGE_STYLE_PRESETS.find(p => p.id === job.imageStyle)?.label ?? "🎲 Random"}
              {job.bgMusic === true  && <span className="ml-1">· 🎵 Có nhạc nền</span>}
              {job.bgMusic === false && <span className="ml-1">· 🔇 Không nhạc nền</span>}
            </p>
          )}
          {job.jobType === "long_pipeline" && (job.longFalModel || job.longThumbnailFalModel) && (
            <p className="text-[11px] text-slate-600 mt-0.5 truncate">
              {job.longImageStyle && <span className="mr-1">{IMAGE_STYLE_PRESETS.find(p => p.id === job.longImageStyle)?.label ?? job.longImageStyle}</span>}
              {job.longFalModel && <span className="mr-1">· vid: {LONG_FAL_MODELS.find(m => m.id === job.longFalModel)?.label?.split(" ")[1] ?? job.longFalModel}</span>}
              {job.longThumbnailFalModel && <span>· thumb: {LONG_FAL_MODELS.find(m => m.id === job.longThumbnailFalModel)?.label?.split(" ")[1] ?? job.longThumbnailFalModel}</span>}
            </p>
          )}
          <p className="text-xs text-slate-700 mt-0.5">
            Last: {relativeTime(job.lastRunAt)} · Next: {futureRelativeTime(job.nextRunAt)}
            <span className="ml-1 text-slate-500">({absoluteTime(job.nextRunAt)})</span>
          </p>
          {runResult && (
            <p className={`text-xs mt-1 ${runResult.startsWith("❌") ? "text-red-400" : "text-green-400"}`}>
              {runResult}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditing(true)} title="Sửa job"
            className="text-slate-500 hover:text-slate-200 transition-colors">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={handleRunNow} disabled={running || !job.isEnabled} title="Chạy ngay"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-600 text-slate-400 hover:border-rose-500/60 hover:text-rose-400 disabled:opacity-40 transition-colors">
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {running ? "" : "Run"}
          </button>
          <button onClick={onToggle}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              job.isEnabled
                ? "border-green-700 bg-green-900/30 text-green-400 hover:bg-green-900/50"
                : "border-slate-600 bg-slate-800 text-slate-500 hover:border-slate-500"
            }`}>
            {job.isEnabled ? "ON" : "OFF"}
          </button>
          <button onClick={onDelete} className="text-slate-500 hover:text-red-400 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

/* ─── Cron Logs ───────────────────────────────────────────── */
function CronLogsPanel() {
  const [logs,    setLogs]    = useState<CronRunLog[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await getCronLogsAction(50);
    setLogs(rows);
    setLoading(false);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Lịch sử chạy</p>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {logs === null ? "Tải logs" : "Refresh"}
        </button>
      </div>

      {logs === null ? (
        <p className="text-xs text-slate-600 py-2">Nhấn &quot;Tải logs&quot; để xem lịch sử.</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-slate-600 py-2">Chưa có log nào.</p>
      ) : (
        <div className="rounded-lg border border-slate-700/60 overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-800/90 backdrop-blur">
                <tr className="text-slate-500">
                  <th className="text-left px-2 py-1.5 font-medium">Thời gian</th>
                  <th className="text-center px-2 py-1.5 font-medium">Jobs</th>
                  <th className="text-center px-2 py-1.5 font-medium">Uploads</th>
                  <th className="text-center px-2 py-1.5 font-medium">Status</th>
                  <th className="text-left px-2 py-1.5 font-medium">Lỗi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {logs.map(log => (
                  <tr key={log.id} className={`${log.hasErrors ? "bg-red-950/20" : ""}`}>
                    <td className="px-2 py-1 text-slate-400 whitespace-nowrap">
                      {new Date(log.ranAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "medium" })}
                      {log.durationMs && <span className="ml-1 text-slate-600">{log.durationMs}ms</span>}
                    </td>
                    <td className="px-2 py-1 text-center text-slate-300">{log.jobsRan}</td>
                    <td className="px-2 py-1 text-center text-slate-300">{log.uploadsProcessed}</td>
                    <td className="px-2 py-1 text-center">
                      {log.hasErrors
                        ? <XCircle className="h-3.5 w-3.5 text-red-400 mx-auto" />
                        : <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mx-auto" />}
                    </td>
                    <td className="px-2 py-1 text-red-400 truncate max-w-[180px]" title={log.errorSummary ?? ""}>
                      {log.errorSummary ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main panel ──────────────────────────────────────────── */
interface Props {
  initialJobs: SchedulerJobRecord[];
  niches: Niche[];
}

export function SchedulerPanel({ initialJobs, niches }: Props) {
  const [open,       setOpen]       = useState(false);
  const [activeTab,  setActiveTab]  = useState<"jobs" | "logs">("jobs");
  const [jobs,       setJobs]       = useState<SchedulerJobRecord[]>(initialJobs);
  const [showCreate, setShowCreate] = useState(false);

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateSchedulerJobAction(id, { isEnabled: !enabled });
    setJobs(prev => prev.map(j => j.id === id ? { ...j, isEnabled: !enabled } : j));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa job này?")) return;
    await deleteSchedulerJobAction(id);
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const handleRan = (id: string, updates: Partial<SchedulerJobRecord>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));
  };

  const handleUpdated = (job: SchedulerJobRecord) => {
    setJobs(prev => prev.map(j => j.id === job.id ? job : j));
  };

  const activeCount = jobs.filter(j => j.isEnabled).length;
  const sortedJobs = [...jobs].sort((a, b) => {
    const aTime = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 hover:bg-slate-800/80 text-sm font-medium text-slate-200 transition-colors">
        <span className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-rose-400" />
          Lịch tự động
          <span className={`text-xs px-2 py-0.5 rounded-full font-normal ${activeCount > 0 ? "bg-green-900/40 text-green-400" : "bg-slate-700 text-slate-500"}`}>
            {activeCount} active
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="bg-slate-900">
          {/* Tabs */}
          <div className="flex border-b border-slate-800">
            <button onClick={() => setActiveTab("jobs")}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === "jobs" ? "border-rose-500 text-rose-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              <CalendarClock className="h-3.5 w-3.5" />
              Jobs
            </button>
            <button onClick={() => setActiveTab("logs")}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === "logs" ? "border-rose-500 text-rose-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              <ClipboardList className="h-3.5 w-3.5" />
              Logs
            </button>
          </div>

          <div className="p-4 space-y-3">
            {activeTab === "jobs" && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">Jobs chạy mỗi khi cron gọi endpoint bên dưới.</p>
                    <button onClick={() => setShowCreate(v => !v)}
                      className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 transition-colors">
                      <Plus className="h-3.5 w-3.5" />
                      Thêm job
                    </button>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700/50 p-2.5 space-y-1">
                    <p className="text-[11px] text-slate-400 font-medium">Setup crontab (chạy 1 lần trên máy chủ):</p>
                    <code className="block text-[10px] text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                      {"(crontab -l 2>/dev/null; echo \"* * * * * curl -s -X POST http://localhost:3000/api/cron/run >> /tmp/cron.log 2>&1\") | crontab -"}
                    </code>
                    <p className="text-[10px] text-slate-600">Lệnh trên setup crontab chạy mỗi phút. Job sẽ tự tính toán tần suất theo cài đặt.</p>
                  </div>
                </div>

                {showCreate && (
                  <CreateJobForm niches={niches} onCreated={job => { setJobs(p => [job, ...p]); setShowCreate(false); }} />
                )}

                {sortedJobs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">Chưa có job nào</p>
                ) : (
                  <div className="rounded-xl border border-slate-800/80 divide-y divide-slate-800/60">
                    {sortedJobs.map(job => (
                      <div key={job.id} className="px-3">
                        <JobRow
                          job={job}
                          niches={niches}
                          onToggle={() => handleToggle(job.id, job.isEnabled)}
                          onDelete={() => handleDelete(job.id)}
                          onRan={u => handleRan(job.id, u)}
                          onUpdated={handleUpdated}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === "logs" && <CronLogsPanel />}
          </div>
        </div>
      )}
    </div>
  );
}
