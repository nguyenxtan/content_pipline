"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { slugify } from "@/lib/utils";
import type { NicheFormState, NicheFormValues } from "@/lib/validations/niches";
import type { Niche } from "@/lib/db/schema";

interface NicheFormProps {
  niche?: Niche;
  action: (prev: NicheFormState, data: FormData) => Promise<NicheFormState>;
  submitLabel?: string;
}

export function NicheForm({
  niche,
  action,
  submitLabel = "Lưu",
}: NicheFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, null);
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const slugEditedRef = useRef(!!niche);

  const [stages, setStages] = useState<string[]>(
    niche?.stages ?? ["ideation", "script", "short", "long"]
  );
  const [newStageInput, setNewStageInput] = useState("");

  useEffect(() => {
    if (state?.success) toast.success("Đã lưu lĩnh vực");
    if (state?.error) toast.error(state.error);
  }, [state]);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!slugEditedRef.current && slugRef.current) {
      slugRef.current.value = slugify(e.target.value);
    }
  }

  function handleSlugChange() {
    slugEditedRef.current = true;
  }

  function addStage() {
    const s = newStageInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (s && !stages.includes(s)) {
      setStages([...stages, s]);
    }
    setNewStageInput("");
  }

  function removeStage(s: string) {
    if (stages.length <= 1) return;
    setStages(stages.filter((x) => x !== s));
  }

  const fieldError = (field: keyof NicheFormValues) =>
    state?.fieldErrors?.[field]?.[0];

  return (
    <form action={formAction} className="space-y-5 max-w-xl">
      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-100">
          Tên lĩnh vực <span className="text-red-400">*</span>
        </label>
        <input
          ref={nameRef}
          name="name"
          defaultValue={niche?.name ?? ""}
          onChange={handleNameChange}
          placeholder="Ví dụ: Phật pháp - Truyện nhân quả"
          className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
        {fieldError("name") && (
          <p className="text-xs text-red-400">{fieldError("name")}</p>
        )}
      </div>

      {/* Category / Lĩnh vực */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-100">
          Lĩnh vực
        </label>
        <input
          name="category"
          defaultValue={niche?.category ?? ""}
          placeholder="Ví dụ: Tâm linh, Sức khỏe, Kinh doanh..."
          className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
        <p className="text-xs text-slate-400">
          Nhóm lĩnh vực này theo danh mục để để dễ quản lý.
        </p>
      </div>

      {/* Slug */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-100">
          Slug <span className="text-red-400">*</span>
        </label>
        <input
          ref={slugRef}
          name="slug"
          defaultValue={niche?.slug ?? ""}
          onChange={handleSlugChange}
          placeholder="phat-phap-truyen-nhan-qua"
          className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm font-mono text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
        <p className="text-xs text-slate-400">
          Tự động từ tên. Chỉ dùng chữ thường, số, dấu gạch ngang.
        </p>
        {fieldError("slug") && (
          <p className="text-xs text-red-400">{fieldError("slug")}</p>
        )}
      </div>

      {/* Icon + Description side by side */}
      <div className="flex gap-3">
        {/* Icon */}
        <div className="space-y-1.5 w-24 shrink-0">
          <label className="text-sm font-medium text-slate-100">
            Icon
          </label>
          <input
            name="icon"
            defaultValue={niche?.icon ?? ""}
            placeholder="🙏"
            maxLength={10}
            className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-lg text-center text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <p className="text-xs text-slate-400">Emoji</p>
        </div>

        {/* Description */}
        <div className="space-y-1.5 flex-1">
          <label className="text-sm font-medium text-slate-100">
            Mô tả
          </label>
          <textarea
            name="description"
            defaultValue={niche?.description ?? ""}
            rows={3}
            placeholder="Lĩnh vực về nội dung Phật pháp, truyện nhân quả..."
            className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
          />
          {fieldError("description") && (
            <p className="text-xs text-red-400">{fieldError("description")}</p>
          )}
        </div>
      </div>

      {/* Stages manager */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-100">
          Stages <span className="text-red-400">*</span>
        </label>
        <p className="text-xs text-slate-400">
          Các giai đoạn pipeline của lĩnh vực này. Mỗi stage có prompt riêng.
        </p>

        {/* Current stages */}
        <div className="flex flex-wrap gap-2">
          {stages.map((s) => (
            <div
              key={s}
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1"
            >
              <span className="text-xs font-mono text-slate-100">
                {s}
              </span>
              {stages.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStage(s)}
                  className="text-slate-400 hover:text-red-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add stage */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newStageInput}
            onChange={(e) => setNewStageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addStage();
              }
            }}
            placeholder="thêm stage mới..."
            className="flex-1 rounded-md border border-slate-600 bg-transparent px-3 py-1.5 text-sm font-mono text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <button
            type="button"
            onClick={addStage}
            className="flex items-center gap-1 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm
          </button>
        </div>

        {/* Hidden serialized stages */}
        <input type="hidden" name="stages" value={JSON.stringify(stages)} />
        {fieldError("stages") && (
          <p className="text-xs text-red-400">{fieldError("stages")}</p>
        )}
      </div>

      {/* Target audience */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-100">
          Đối tượng mục tiêu
        </label>
        <input
          name="targetAudience"
          defaultValue={niche?.targetAudience ?? ""}
          placeholder="Người trung niên 30-60, quan tâm tâm linh..."
          className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
      </div>

      {/* Tone */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-100">
          Tone / Giọng điệu
        </label>
        <input
          name="tone"
          defaultValue={niche?.tone ?? ""}
          placeholder="Kể chuyện ấm áp, trang trọng..."
          className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
        />
      </div>

      {/* Media config */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 space-y-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">⚙️ Cấu hình media</p>

        <div className="grid grid-cols-2 gap-3">
          {/* Music folder */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-100">
              Thư mục nhạc nền
            </label>
            <input
              name="musicFolder"
              defaultValue={(niche as { musicFolder?: string | null })?.musicFolder ?? ""}
              placeholder="phat-phap"
              className="w-full rounded-md border border-slate-600 bg-transparent px-3 py-2 text-sm font-mono text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <p className="text-xs text-slate-500">Tên thư mục trong <code className="text-slate-400">media/music/</code></p>
          </div>

          {/* Video type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-100">
              Loại video
            </label>
            <select
              name="videoType"
              defaultValue={(niche as { videoType?: string | null })?.videoType ?? "both"}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <option value="both">Cả hai (ngắn + dài)</option>
              <option value="short">Chỉ video ngắn (9:16)</option>
              <option value="long">Chỉ video dài (16:9)</option>
            </select>
          </div>
        </div>

        {/* TTS Voice */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-100">
            🎙️ Giọng đọc TTS
          </label>
          <select
            name="ttsVoice"
            defaultValue={(niche as { ttsVoice?: string | null })?.ttsVoice ?? "Ly"}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            <optgroup label="Nữ miền Bắc">
              <option value="Ly">Trúc Ly (nữ miền Bắc) — khuyên dùng cho Phật pháp</option>
              <option value="Ngoc">Bích Ngọc (nữ miền Bắc)</option>
            </optgroup>
            <optgroup label="Nam miền Bắc">
              <option value="Binh">Thanh Bình (nam miền Bắc)</option>
              <option value="Tuyen">Phạm Tuyên (nam miền Bắc)</option>
            </optgroup>
            <optgroup label="Nữ miền Nam">
              <option value="Doan">Thục Đoan (nữ miền Nam)</option>
            </optgroup>
            <optgroup label="Nam miền Nam">
              <option value="Vinh">Xuân Vĩnh (nam miền Nam)</option>
              <option value="Sơn">Thái Sơn (nam miền Nam)</option>
            </optgroup>
          </select>
          <p className="text-xs text-slate-500">Giọng này sẽ được dùng tự động khi chạy TTS cho niche này</p>
        </div>
      </div>

      {/* Is active */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-100">
          Trạng thái
        </label>
        <select
          name="isActive"
          defaultValue={niche?.isActive !== false ? "true" : "false"}
          className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
        >
          <option value="true">Active — đang kích hoạt</option>
          <option value="false">Inactive — tạm dừng</option>
        </select>
      </div>

      {/* Global error */}
      {state?.error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {state.error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 rounded-md bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-slate-700 px-5 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
        >
          Hủy
        </button>
      </div>
    </form>
  );
}
