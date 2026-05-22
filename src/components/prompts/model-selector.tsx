"use client";

import { OPENROUTER_MODELS } from "@/lib/llm/pricing";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const selected = OPENROUTER_MODELS.find((m) => m.value === value);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
        Model
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
      >
        {OPENROUTER_MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {selected && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {selected.description} · ${selected.input}/1M in · $
          {selected.output}/1M out
        </p>
      )}
    </div>
  );
}
