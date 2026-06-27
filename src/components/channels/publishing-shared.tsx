import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, type LucideIcon } from "lucide-react";
import type { ContentFormatType } from "@/lib/content-format-type";
import type { UploadQueueRow } from "@/actions/social-channels";

export const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
export const VN_TIME_SUFFIX = "VN (GMT+7)";

export const STATUS_META: Record<string, {
  label: string;
  color: string;
  badge: string;
  icon: LucideIcon;
}> = {
  pending: {
    label: "Đang đợi xử lý",
    color: "text-violet-300",
    badge: "border-violet-700/50 bg-violet-950/20 text-violet-300",
    icon: Clock,
  },
  queued: {
    label: "Chờ đăng",
    color: "text-amber-300",
    badge: "border-amber-700/50 bg-amber-950/20 text-amber-300",
    icon: Clock,
  },
  uploading: {
    label: "Đang đăng",
    color: "text-blue-300",
    badge: "border-blue-700/50 bg-blue-950/20 text-blue-300",
    icon: Loader2,
  },
  done: {
    label: "Đã đăng",
    color: "text-emerald-300",
    badge: "border-emerald-700/50 bg-emerald-950/20 text-emerald-300",
    icon: CheckCircle2,
  },
  error: {
    label: "Lỗi",
    color: "text-red-300",
    badge: "border-red-700/50 bg-red-950/20 text-red-300",
    icon: AlertTriangle,
  },
  cancelled: {
    label: "Đã huỷ",
    color: "text-slate-400",
    badge: "border-slate-700 bg-slate-900 text-slate-400",
    icon: Ban,
  },
};

export const FORMAT_META: Record<ContentFormatType, {
  label: string;
  badge: string;
}> = {
  tts_short: {
    label: "TTS Short",
    badge: "border-rose-700/50 bg-rose-950/20 text-rose-300",
  },
  legacy_quote_short: {
    label: "Quote Short",
    badge: "border-amber-700/50 bg-amber-950/20 text-amber-300",
  },
  long_video: {
    label: "Long",
    badge: "border-cyan-700/50 bg-cyan-950/20 text-cyan-300",
  },
  facebook_quote_photo: {
    label: "Bài ảnh Facebook",
    badge: "border-fuchsia-700/50 bg-fuchsia-950/20 text-fuchsia-300",
  },
};

export function getStatusMeta(status: string) {
  return STATUS_META[status] ?? STATUS_META.queued;
}

export function getFormatMeta(formatType: ContentFormatType) {
  return FORMAT_META[formatType] ?? FORMAT_META.tts_short;
}

export function getPlatformLabel(platform: string): string {
  return platform === "facebook" ? "Facebook" : "YouTube";
}

export function getChannelLabel(item: Pick<UploadQueueRow, "platform" | "platformAccountName" | "channelName">): string {
  return `${getPlatformLabel(item.platform)} · ${item.platformAccountName ?? item.channelName}`;
}

export function getDisplayTitle(item: Pick<UploadQueueRow, "title" | "topic">): string {
  return item.topic?.trim() || item.title?.trim() || "Không có tiêu đề";
}

export function formatVietnamAbsolute(date: Date, withYear = true): string {
  return new Date(date).toLocaleString("vi-VN", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    ...(withYear ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatVietnamDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(date));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

export function formatVietnamDateLabel(date: Date): string {
  return new Date(date).toLocaleDateString("vi-VN", {
    timeZone: VN_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatVietnamTime(date: Date): string {
  return new Date(date).toLocaleTimeString("vi-VN", {
    timeZone: VN_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatRelativeTime(date: Date): string {
  const scheduled = new Date(date);
  const diffMin = Math.round((scheduled.getTime() - Date.now()) / 60000);
  if (diffMin < -1440) return `${Math.abs(Math.floor(diffMin / 1440))} ngày trước`;
  if (diffMin < -60) return `${Math.abs(Math.floor(diffMin / 60))} giờ trước`;
  if (diffMin < 0) return `${Math.abs(diffMin)} phút trước`;
  if (diffMin < 60) return `${diffMin} phút nữa`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} giờ nữa`;
  return `${Math.floor(diffMin / 1440)} ngày nữa`;
}

export function isUpcomingStatus(status: string): boolean {
  return status === "pending" || status === "queued" || status === "uploading";
}
