"use client";

import { useSearchParams } from "next/navigation";
import { TvMinimalPlay as Youtube, CheckCircle2, XCircle, ExternalLink } from "lucide-react";

interface Props {
  connected: boolean;
}

export function YoutubeSettingsClient({ connected }: Props) {
  const params    = useSearchParams();
  const justDone  = params.get("connected") === "1";
  const authError = params.get("error");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Youtube className="h-5 w-5 text-red-500" />
          YouTube
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Kết nối kênh YouTube để đăng video Short trực tiếp từ app.
        </p>
      </div>

      {/* Status banner */}
      {justDone && (
        <div className="flex items-center gap-2 rounded-lg border border-green-700/40 bg-green-900/20 px-4 py-3 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Kênh YouTube đã kết nối thành công!
        </div>
      )}
      {authError && !justDone && (
        <div className="flex items-center gap-2 rounded-lg border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          <XCircle className="h-4 w-4 shrink-0" />
          Lỗi kết nối: {decodeURIComponent(authError)}
        </div>
      )}

      {/* Connection card */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-400" : "bg-slate-500"}`} />
          <div>
            <p className="text-sm font-medium text-slate-200">
              {connected ? "Đã kết nối" : "Chưa kết nối"}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {connected
                ? "Bạn có thể đăng video từ Content Gallery"
                : "Cần kết nối để đăng video lên YouTube"}
            </p>
          </div>
        </div>

        <a
          href="/api/auth/youtube"
          className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {connected ? "Kết nối lại" : "Kết nối kênh"}
        </a>
      </div>

      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4 space-y-2">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Hướng dẫn</p>
        <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
          <li>Nhấn <strong className="text-slate-300">Kết nối kênh</strong> và đăng nhập Google</li>
          <li>Cho phép app quyền upload video</li>
          <li>Quay lại Gallery, nhấn nút <strong className="text-slate-300">YouTube</strong> trên mỗi video</li>
        </ol>
      </div>
    </div>
  );
}
