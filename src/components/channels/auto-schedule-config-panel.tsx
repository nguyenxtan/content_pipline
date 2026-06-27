"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Film, Image as ImageIcon, Loader2, Video, X, Zap } from "lucide-react";
import type { SocialChannel } from "@/lib/db/schema";
import {
  getAutoScheduleSettingsAction,
  saveAutoScheduleSettingsAction,
  type AutoScheduleSettings,
  type AutoScheduleVideoSetting,
} from "@/actions/social-channels";

function fmtInterval(intervalMin: number): string {
  const hours = Math.floor(intervalMin / 60);
  const minutes = intervalMin % 60;
  if (hours > 0 && minutes > 0) return `${hours} giờ ${minutes} phút`;
  if (hours > 0) return `${hours} giờ`;
  return `${minutes} phút`;
}

function DestinationRow({
  label,
  color,
  settings,
  channels,
  minInterval,
  onChange,
  onRemove,
}: {
  label: string;
  color: string;
  settings: AutoScheduleVideoSetting;
  channels: SocialChannel[];
  minInterval: number;
  onChange: (next: AutoScheduleVideoSetting) => void;
  onRemove?: () => void;
}) {
  const safeInterval = Math.max(minInterval, settings.intervalMin || minInterval);
  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
            settings.enabled
              ? "border-green-700 bg-green-900/30 text-green-400"
              : "border-slate-700 bg-slate-900 text-slate-500"
          }`}
        >
          {settings.enabled ? "ON" : "OFF"}
        </button>
        <span className={`text-xs font-medium ${color}`}>{label}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-slate-500 transition-colors hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="mb-1 block text-[10px] text-slate-500">Kênh</label>
          <select
            value={settings.channelId}
            onChange={(event) => onChange({ ...settings, channelId: Number(event.target.value) })}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <option value={0}>— Chọn kênh —</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.platform === "facebook" ? "Facebook" : "YouTube"} · {channel.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-1">
          <div className="flex-1">
            <label className="mb-1 block text-[10px] text-slate-500">Từ</label>
            <input
              type="time"
              value={settings.windowStart}
              onChange={(event) => onChange({ ...settings, windowStart: event.target.value })}
              className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>
          <span className="pb-2 text-slate-600">–</span>
          <div className="flex-1">
            <label className="mb-1 block text-[10px] text-slate-500">Đến</label>
            <input
              type="time"
              value={settings.windowEnd}
              onChange={(event) => onChange({ ...settings, windowEnd: event.target.value })}
              className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] text-slate-500">Cách (phút)</label>
          <input
            type="number"
            min={minInterval}
            step={60}
            max={1440}
            value={safeInterval}
            onChange={(event) => onChange({ ...settings, intervalMin: Number(event.target.value) })}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] text-slate-500">Quyền</label>
          <select
            value={settings.privacyStatus}
            onChange={(event) =>
              onChange({
                ...settings,
                privacyStatus: event.target.value as "public" | "unlisted" | "private",
              })
            }
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <option value="public">Công khai</option>
            <option value="unlisted">Không liệt kê</option>
            <option value="private">Riêng tư</option>
          </select>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        Khoảng cách hiện tại: <span className="text-slate-300">{fmtInterval(safeInterval)}</span>
      </p>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  color,
  channels,
  settings,
  minInterval,
  onChange,
}: {
  title: string;
  icon: typeof Video;
  color: string;
  channels: SocialChannel[];
  settings: AutoScheduleVideoSetting[];
  minInterval: number;
  onChange: (next: AutoScheduleVideoSetting[]) => void;
}) {
  const nextAvailableChannel = channels.find(
    (channel) => !settings.some((setting) => setting.channelId === channel.id),
  );

  const addDestination = () => {
    if (!nextAvailableChannel) return;
    onChange([
      ...settings,
      {
        enabled: nextAvailableChannel.platform === "facebook",
        channelId: nextAvailableChannel.id,
        windowStart: "06:00",
        windowEnd: "22:00",
        intervalMin: minInterval,
        privacyStatus: "public",
      },
    ]);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className={`text-sm font-medium ${color}`}>{title}</span>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">
          {settings.length} đích
        </span>
        {nextAvailableChannel && (
          <button
            type="button"
            onClick={addDestination}
            className="ml-auto rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-slate-800"
          >
            + Thêm kênh
          </button>
        )}
      </div>
      {settings.length === 0 ? (
        <p className="text-xs text-slate-500">Chưa có kênh nào trong nhóm này.</p>
      ) : (
        <div className="space-y-3">
          {settings.map((setting, index) => {
            const channel = channels.find((row) => row.id === setting.channelId);
            const label = channel
              ? `${channel.platform === "facebook" ? "Facebook" : "YouTube"} · ${channel.name}`
              : "Kênh";
            return (
              <DestinationRow
                key={`${setting.channelId}-${index}`}
                label={label}
                color={color}
                settings={setting}
                channels={channels}
                minInterval={minInterval}
                onChange={(next) => {
                  const updated = [...settings];
                  updated[index] = next;
                  onChange(updated);
                }}
                onRemove={settings.length > 1 ? () => onChange(settings.filter((_, i) => i !== index)) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Props {
  channels: SocialChannel[];
}

export function AutoScheduleConfigPanel({ channels }: Props) {
  const [settings, setSettings] = useState<AutoScheduleSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    getAutoScheduleSettingsAction().then(setSettings);
  }, []);

  const shortChannels = useMemo(
    () => channels.filter((channel) => channel.platform === "youtube" || channel.platform === "facebook"),
    [channels],
  );
  const quoteChannels = useMemo(
    () => channels.filter((channel) => channel.platform === "facebook"),
    [channels],
  );
  const longChannels = useMemo(
    () => channels.filter((channel) => channel.platform === "youtube"),
    [channels],
  );

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    await saveAutoScheduleSettingsAction(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-slate-800/60"
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-slate-200">Tự động lên lịch</span>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-800 px-4 pb-4 pt-4">
          <p className="text-xs leading-relaxed text-slate-500">
            Màn này chỉ cấu hình auto-schedule cho các kênh đang bật. Nó không hiển thị hàng chờ và không tạo video mới.
          </p>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Runtime hiện đọc `channel_publish_configs_v1`; khi lưu, app sẽ tự đồng bộ từ màn này sang runtime config để `phat_phap` và `tang_sau` dùng cùng một nguồn cấu hình.
          </p>
          {settings ? (
            <div className="space-y-4">
              <Section
                title="Video Short"
                icon={Video}
                color="text-rose-300"
                channels={shortChannels}
                settings={settings.shortDestinations}
                minInterval={60}
                onChange={(next) => setSettings((prev) => (prev ? { ...prev, shortDestinations: next } : prev))}
              />
              <Section
                title="Facebook bài ảnh"
                icon={ImageIcon}
                color="text-fuchsia-300"
                channels={quoteChannels}
                settings={settings.quoteDestinations}
                minInterval={60}
                onChange={(next) => setSettings((prev) => (prev ? { ...prev, quoteDestinations: next } : prev))}
              />
              <Section
                title="Video Long"
                icon={Film}
                color="text-cyan-300"
                channels={longChannels}
                settings={settings.longDestinations}
                minInterval={120}
                onChange={(next) => setSettings((prev) => (prev ? { ...prev, longDestinations: next } : prev))}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Đang tải cài đặt...</p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!settings || saving}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {saved ? "Đã lưu!" : "Lưu cài đặt"}
          </button>
        </div>
      )}
    </div>
  );
}
