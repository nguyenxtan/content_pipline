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
    if (state?.success) toast.success("Đã lưu ngách");
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
        <label className="text-sm font-medium text-[hsl(var(--foreground))]">
          Tên ngách <span className="text-red-400">*</span>
        </label>
        <input
          ref={nameRef}
          name="name"
          defaultValue={niche?.name ?? ""}
          onChange={handleNameChange}
          placeholder="Ví dụ: Phật pháp - Truyện nhân quả"
          className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
        {fieldError("name") && (
          <p className="text-xs text-red-400">{fieldError("name")}</p>
        )}
      </div>

      {/* Slug */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[hsl(var(--foreground))]">
          Slug <span className="text-red-400">*</span>
        </label>
        <input
          ref={slugRef}
          name="slug"
          defaultValue={niche?.slug ?? ""}
          onChange={handleSlugChange}
          placeholder="phat-phap-truyen-nhan-qua"
          className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm font-mono text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
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
          <label className="text-sm font-medium text-[hsl(var(--foreground))]">
            Icon
          </label>
          <input
            name="icon"
            defaultValue={niche?.icon ?? ""}
            placeholder="🙏"
            maxLength={10}
            className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-lg text-center text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Emoji</p>
        </div>

        {/* Description */}
        <div className="space-y-1.5 flex-1">
          <label className="text-sm font-medium text-[hsl(var(--foreground))]">
            Mô tả
          </label>
          <textarea
            name="description"
            defaultValue={niche?.description ?? ""}
            rows={3}
            placeholder="Ngách về nội dung Phật pháp, truyện nhân quả..."
            className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] resize-none"
          />
          {fieldError("description") && (
            <p className="text-xs text-red-400">{fieldError("description")}</p>
          )}
        </div>
      </div>

      {/* Stages manager */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[hsl(var(--foreground))]">
          Stages <span className="text-red-400">*</span>
        </label>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Các giai đoạn pipeline của ngách này. Mỗi stage có prompt riêng.
        </p>

        {/* Current stages */}
        <div className="flex flex-wrap gap-2">
          {stages.map((s) => (
            <div
              key={s}
              className="flex items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1"
            >
              <span className="text-xs font-mono text-[hsl(var(--foreground))]">
                {s}
              </span>
              {stages.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStage(s)}
                  className="text-[hsl(var(--muted-foreground))] hover:text-red-400 transition-colors"
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
            className="flex-1 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1.5 text-sm font-mono text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
          <button
            type="button"
            onClick={addStage}
            className="flex items-center gap-1 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors"
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
        <label className="text-sm font-medium text-[hsl(var(--foreground))]">
          Đối tượng mục tiêu
        </label>
        <input
          name="targetAudience"
          defaultValue={niche?.targetAudience ?? ""}
          placeholder="Người trung niên 30-60, quan tâm tâm linh..."
          className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
      </div>

      {/* Tone */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[hsl(var(--foreground))]">
          Tone / Giọng điệu
        </label>
        <input
          name="tone"
          defaultValue={niche?.tone ?? ""}
          placeholder="Kể chuyện ấm áp, trang trọng..."
          className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
      </div>

      {/* Is active */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-[hsl(var(--foreground))]">
          Trạng thái
        </label>
        <select
          name="isActive"
          defaultValue={niche?.isActive !== false ? "true" : "false"}
          className="w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
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
          className="flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-5 py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-[hsl(var(--border))] px-5 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors"
        >
          Hủy
        </button>
      </div>
    </form>
  );
}
