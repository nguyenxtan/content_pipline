"use client";

import { useState } from "react";
import type { Niche } from "@/lib/db/schema";
import type { SchedulerJobRecord } from "@/lib/validations/content-generator";
import {
  createSchedulerJobAction,
  updateSchedulerJobAction,
  deleteSchedulerJobAction,
} from "@/actions/content-generator";

const FREQUENCY_LABELS: Record<string, string> = {
  hourly: "Mỗi 1 giờ",
  "4hourly": "Mỗi 4 giờ",
  daily: "Hằng ngày",
  custom: "Custom (cron)",
};

function relativeTime(date: Date | null): string {
  if (!date) return "—";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 0) return `trong ${Math.abs(Math.floor(diff / 60))}p nữa`;
  if (diff < 60) return `${diff}s trước`;
  if (diff < 3600) return `${Math.floor(diff / 60)}p trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
  return `${Math.floor(diff / 86400)}d trước`;
}

function futureRelativeTime(date: Date | null): string {
  if (!date) return "—";
  const diff = Math.floor((new Date(date).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "sắp chạy";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}p`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

interface CreateFormProps {
  niches: Niche[];
  onCreated: (job: SchedulerJobRecord) => void;
}

function CreateJobForm({ niches, onCreated }: CreateFormProps) {
  const active = niches.filter((n) => n.isActive);
  const [nicheId, setNicheId] = useState(active[0]?.id ?? 0);
  const [topic, setTopic] = useState("");
  const [frequency, setFrequency] = useState<string>("daily");
  const [cron, setCron] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setError("");
    setLoading(true);
    const res = await createSchedulerJobAction({
      nicheId,
      topic: topic.trim(),
      frequency: frequency as "hourly" | "4hourly" | "daily" | "custom",
      cronExpression: frequency === "custom" ? cron : undefined,
    });
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setTopic("");
    // Reload parent
    onCreated({
      id: res.jobId,
      topic: topic.trim(),
      nicheName: active.find((n) => n.id === nicheId)?.name ?? "",
      frequency,
      cronExpression: frequency === "custom" ? cron : null,
      isEnabled: true,
      lastRunAt: null,
      nextRunAt: res.nextRunAt,
      createdAt: new Date(),
    });
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-medium">Thêm job mới</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Ngách</label>
          <select
            value={nicheId}
            onChange={(e) => setNicheId(Number(e.target.value))}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
          >
            {active.map((n) => (
              <option key={n.id} value={n.id}>
                {n.icon ? `${n.icon} ` : ""}{n.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Tần suất</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
          >
            {Object.entries(FREQUENCY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Chủ đề</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Thiền tập buổi sáng..."
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
      </div>
      {frequency === "custom" && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">Cron expression</label>
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="e.g. 0 * * * *"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
          />
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={handleCreate}
        disabled={loading || !topic.trim() || nicheId === 0}
        className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Đang tạo..." : "⚙️ Tạo job"}
      </button>
    </div>
  );
}

interface Props {
  initialJobs: SchedulerJobRecord[];
  niches: Niche[];
}

export function SchedulerPanel({ initialJobs, niches }: Props) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<SchedulerJobRecord[]>(initialJobs);
  const [showCreate, setShowCreate] = useState(false);

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateSchedulerJobAction(id, { isEnabled: !enabled });
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, isEnabled: !enabled } : j))
    );
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa job này?")) return;
    await deleteSchedulerJobAction(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const handleCreated = (job: SchedulerJobRecord) => {
    setJobs((prev) => [job, ...prev]);
    setShowCreate(false);
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-medium"
      >
        <span>📅 Scheduled Jobs ({jobs.filter((j) => j.isEnabled).length} active)</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Jobs sẽ được thực thi bởi cron worker (Phase 2.5).
            </p>
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="text-xs text-blue-600 hover:underline"
            >
              + Thêm job
            </button>
          </div>

          {showCreate && (
            <CreateJobForm niches={niches} onCreated={handleCreated} />
          )}

          {jobs.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">Chưa có job nào</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {jobs.map((job) => (
                <div key={job.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{job.topic}</p>
                    <p className="text-xs text-gray-500">
                      {job.nicheName} · {FREQUENCY_LABELS[job.frequency] ?? job.frequency}
                      {job.cronExpression ? ` (${job.cronExpression})` : ""}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Last: {relativeTime(job.lastRunAt)} · Next: {futureRelativeTime(job.nextRunAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggle(job.id, job.isEnabled)}
                      className={`text-xs px-2 py-1 rounded border ${
                        job.isEnabled
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-gray-300 bg-gray-50 text-gray-500"
                      }`}
                    >
                      {job.isEnabled ? "ON" : "OFF"}
                    </button>
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
