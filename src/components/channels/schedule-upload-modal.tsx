"use client";

import { useCallback, useEffect, useState } from "react";
import { X, TvMinimalPlay as Youtube, Calendar, Lock, Globe, EyeOff, Loader2, CheckCircle } from "lucide-react";
import type { SocialChannel } from "@/lib/db/schema";
import type { ContentGenerationRow } from "@/lib/validations/content-generator";
import { getChannelsAction, scheduleUploadAction } from "@/actions/social-channels";
import { buildDefaultVideoDescription, buildDefaultVideoTitle } from "@/lib/social/youtube-metadata";

interface Props {
  content: ContentGenerationRow;
  videoType: "short" | "long" | "quote";
  onClose: () => void;
  onScheduled?: () => void;
}

const PRIVACY_OPTIONS = [
  { value: "public",   label: "Công khai",  icon: Globe,   desc: "Mọi người đều xem được" },
  { value: "unlisted", label: "Không liệt kê", icon: EyeOff, desc: "Chỉ ai có link mới xem được" },
  { value: "private",  label: "Riêng tư",   icon: Lock,    desc: "Chỉ bạn xem được" },
] as const;

export function ScheduleUploadModal({ content, videoType, onClose, onScheduled }: Props) {
  const [channels, setChannels] = useState<SocialChannel[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [done,    setDone]      = useState(false);
  const [error,   setError]     = useState("");

  const [channelId,     setChannelId]     = useState<number>(0);
  const [title,         setTitle]         = useState(content.topic.slice(0, 100));
  const [description,   setDescription]   = useState("");
  const [tags,          setTags]          = useState<string>("");
  const [privacyStatus, setPrivacyStatus] = useState<"public" | "private" | "unlisted">("public");
  const [scheduledDate, setScheduledDate] = useState<string>(() => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });

  const applyPlatformDefaults = useCallback((channel: SocialChannel) => {
    setTitle(buildDefaultVideoTitle({
      platform: channel.platform as "youtube" | "facebook",
      contentType: videoType,
      topic: content.topic,
    }));
    setDescription(buildDefaultVideoDescription({
      platform: channel.platform as "youtube" | "facebook",
      contentType: videoType,
      topic: content.topic,
      nicheName: content.nicheName,
      shortContent: content.shortContent,
      longContent: content.longContent,
      longYoutubeDescription: content.longYoutubeDescription,
    }));
    if (channel.platform === "facebook") {
      setPrivacyStatus("public");
      setTags("");
    }
  }, [content.longContent, content.longYoutubeDescription, content.nicheName, content.shortContent, content.topic, videoType]);

  useEffect(() => {
    getChannelsAction().then(chs => {
      const active = chs.filter((c) => {
        if (!c.isActive || !c.accessToken) return false;
        if (videoType === "long") return c.platform === "youtube";
        if (videoType === "quote") return c.platform === "facebook";
        return c.platform === "youtube" || c.platform === "facebook";
      });
      setChannels(active);
      if (active.length > 0) {
        setChannelId(active[0].id);
        applyPlatformDefaults(active[0]);
      }
      setLoading(false);
    });
  }, [applyPlatformDefaults, videoType]);

  const handleSubmit = async () => {
    setError("");
    if (!channelId) { setError("Chọn kênh đăng"); return; }
    if (!title.trim()) { setError("Nhập tiêu đề video"); return; }

    setSaving(true);
    const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
    const res = await scheduleUploadAction({
      contentId: content.id,
      channelId,
      videoType,
      title: title.trim(),
      description: description.trim(),
      tags: tagList,
      privacyStatus,
      scheduledAt: new Date(scheduledDate),
    });
    setSaving(false);
    if ("error" in res) { setError(res.error); return; }
    setDone(true);
    setTimeout(() => { onScheduled?.(); onClose(); }, 1500);
  };

  const videoLabel = videoType === "short" ? "Short video" : videoType === "quote" ? "Bài ảnh Facebook" : "Long video";
  const selectedChannel = channels.find((ch) => ch.id === channelId) ?? null;
  const isFacebook = selectedChannel?.platform === "facebook";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-400" />
            <h2 className="text-base font-semibold text-slate-100">{videoType === "quote" ? "Lên lịch bài ảnh" : "Lên lịch đăng video"}</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400">{videoLabel}</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-green-400">
            <CheckCircle className="h-12 w-12" />
            <p className="font-medium">Đã thêm vào hàng chờ!</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : channels.length === 0 ? (
          <div className="p-6 text-center space-y-3">
            <Youtube className="h-10 w-10 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-400">Chưa có kênh phù hợp nào được kết nối.</p>
            <a href="/settings/channels" className="inline-block text-sm text-rose-400 hover:text-rose-300 underline underline-offset-2">
              Kết nối kênh tại Settings → Kênh
            </a>
          </div>
        ) : (
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Channel */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Kênh đăng</label>
              <select
                value={channelId}
                onChange={e => {
                  const nextId = Number(e.target.value);
                  setChannelId(nextId);
                  const nextChannel = channels.find((ch) => ch.id === nextId);
                  if (nextChannel) applyPlatformDefaults(nextChannel);
                }}
                className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
              >
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.platform === "facebook" ? "Facebook" : "YouTube"} · {ch.name}{ch.platformHandle ? ` · ${ch.platformHandle}` : ""}</option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Tiêu đề <span className="text-slate-600">({title.length}/100)</span>
              </label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={100}
                className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Mô tả</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500 resize-y"
              />
              {isFacebook && (
                <p className="text-[11px] text-slate-600 mt-1">
                  {videoType === "quote"
                    ? "Bài ảnh Facebook sẽ dùng caption ngắn theo chủ đề và không dùng tag riêng."
                    : "Facebook Reel đang dùng mô tả ngắn + hashtag, không dùng tag riêng."}
                </p>
              )}
            </div>

            {/* Tags */}
            {!isFacebook && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Tags <span className="text-slate-600">(phân cách bằng dấu phẩy)</span></label>
              <input
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="phatphap, thienphat, youtube..."
                className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>
            )}

            {/* Privacy */}
            {!isFacebook && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Quyền riêng tư</label>
              <div className="grid grid-cols-3 gap-2">
                {PRIVACY_OPTIONS.map(opt => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setPrivacyStatus(opt.value)}
                      className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs transition-colors ${
                        privacyStatus === opt.value
                          ? "border-rose-500 bg-rose-900/20 text-rose-300"
                          : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            )}

            {/* Schedule time */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                <Calendar className="inline h-3 w-3 mr-1" />
                Thời gian đăng
              </label>
              <input
                type="datetime-local"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
              <p className="text-[11px] text-slate-600 mt-1">
                {videoType === "quote" ? "Cron job sẽ đăng bài ảnh khi đến thời điểm này." : "Cron job sẽ upload video khi đến thời điểm này."}
              </p>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}

        {/* Footer */}
        {!done && !loading && channels.length > 0 && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Huỷ
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Youtube className="h-4 w-4" />}
              {saving ? "Đang lưu..." : "Lên lịch"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
