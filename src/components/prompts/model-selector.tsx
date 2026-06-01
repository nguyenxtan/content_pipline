"use client";

import { ModelDropdown } from "@/components/ui/model-dropdown";

interface ModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
}

// Backward-compat wrapper — dùng trong prompt-editor
export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  return (
    <ModelDropdown
      label="Model"
      value={value}
      onChange={onChange}
    />
  );
}
