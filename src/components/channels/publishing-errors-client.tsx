"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { cancelUploadAction, getUploadQueueAction, retryUploadAction, type UploadQueueRow } from "@/actions/social-channels";
import {
  formatVietnamAbsolute,
  getChannelLabel,
  getDisplayTitle,
  getFormatMeta,
  getStatusMeta,
} from "@/components/channels/publishing-shared";

interface Props {
  initialItems: UploadQueueRow[];
}

export function PublishingErrorsClient({ initialItems }: Props) {
  const [items, setItems] = useState(initialItems);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await getUploadQueueAction({ limit: 300 });
    setItems(rows.filter((item) => item.status === "error"));
    setLoading(false);
  }, []);

  const runAction = async (id: string, action: "retry" | "cancel") => {
    setBusyId(id);
    if (action === "retry") {
      await retryUploadAction(id);
    } else {
      await cancelUploadAction(id);
    }
    await reload();
    setBusyId(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">Lỗi / Retry</h1>
          <p className="text-sm text-slate-400">
            Chỉ hiển thị các queue row đang lỗi để bạn đọc nguyên nhân và retry khi cần. Không trộn với các item khoẻ mạnh.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Làm mới dữ liệu
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-16 text-center text-sm text-slate-500">
          Không có queue row lỗi nào.
        </div>
      ) : (
        <div className="space-y-3">
          {items
            .slice()
            .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
            .map((item) => {
              const format = getFormatMeta(item.formatType);
              const status = getStatusMeta(item.status);
              const busy = busyId === item.id;
              return (
                <div key={item.id} className="rounded-2xl border border-red-800/30 bg-red-950/10 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.badge}`}>{status.label}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${format.badge}`}>{format.label}</span>
                      </div>
                      <p className="text-base font-semibold text-slate-100">{getDisplayTitle(item)}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                        <span>{formatVietnamAbsolute(item.scheduledAt)}</span>
                        <span>{getChannelLabel(item)}</span>
                      </div>
                      <div className="rounded-xl border border-red-800/30 bg-red-950/20 px-3 py-2 text-sm text-red-200">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{item.errorMessage || "Không có error message chi tiết."}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => runAction(item.id, "retry")}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(item.id, "cancel")}
                        disabled={busy}
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
                      >
                        Huỷ row
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
