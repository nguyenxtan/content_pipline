"use client";

import { useState } from "react";
import type { ContentGenerationRow, UpdateContentStatusInput } from "@/lib/validations/content-generator";

interface Props {
  generation: ContentGenerationRow;
  onSave: (id: string, updates: UpdateContentStatusInput) => Promise<void>;
  onClose: () => void;
}

const TTS_STATUSES = ["pending", "processing", "done", "error"] as const;
const YT_STATUSES = ["pending", "scheduled", "uploading", "done", "error"] as const;

export function EditStatusModal({ generation, onSave, onClose }: Props) {
  const [ttsStatus, setTtsStatus] = useState(generation.ttsStatus ?? "pending");
  const [ttsErrorMsg, setTtsErrorMsg] = useState(generation.ttsErrorMessage ?? "");
  const [ytStatus, setYtStatus] = useState(generation.youtubeUploadStatus ?? "pending");
  const [ytScheduledAt, setYtScheduledAt] = useState(
    generation.youtubeScheduledAt
      ? new Date(generation.youtubeScheduledAt).toISOString().slice(0, 16)
      : ""
  );
  const [ytError, setYtError] = useState(generation.youtubeUploadError ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const updates: UpdateContentStatusInput = {
      ttsStatus: ttsStatus as UpdateContentStatusInput["ttsStatus"],
      ...(ttsErrorMsg ? { ttsErrorMessage: ttsErrorMsg } : {}),
      youtubeUploadStatus: ytStatus as UpdateContentStatusInput["youtubeUploadStatus"],
      ...(ytScheduledAt ? { youtubeScheduledAt: new Date(ytScheduledAt) } : {}),
      ...(ytError ? { youtubeUploadError: ytError } : {}),
    };
    await onSave(generation.id, updates);
    setSaving(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold">Cập nhật trạng thái</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 truncate">{generation.topic} · {generation.nicheName}</p>

          {/* TTS Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">TTS Status</label>
            <select
              value={ttsStatus}
              onChange={(e) => setTtsStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {TTS_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {ttsStatus === "error" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">TTS Error</label>
              <textarea
                rows={2}
                value={ttsErrorMsg}
                onChange={(e) => setTtsErrorMsg(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* YouTube Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">YouTube Upload Status</label>
            <select
              value={ytStatus}
              onChange={(e) => setYtStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {YT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {ytStatus === "scheduled" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Thời gian đăng</label>
              <input
                type="datetime-local"
                value={ytScheduledAt}
                onChange={(e) => setYtScheduledAt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}
          {ytStatus === "error" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">YouTube Error</label>
              <textarea
                rows={2}
                value={ytError}
                onChange={(e) => setYtError(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Hủy
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}
