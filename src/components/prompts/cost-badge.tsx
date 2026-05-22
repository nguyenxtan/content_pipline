"use client";

import { MODEL_PRICING } from "@/lib/llm/pricing";

interface CostBadgeProps {
  content: string;
  model: string;
}

export function CostBadge({ content, model }: CostBadgeProps) {
  const p = MODEL_PRICING[model];
  if (!p) return null;

  // rough estimate: 1 token ≈ 4 chars; output ≈ same as input
  const estimatedInputTokens = Math.ceil(content.length / 4);
  const estimatedOutputTokens = Math.ceil(content.length / 4);
  const estimatedCost =
    (estimatedInputTokens * p.input + estimatedOutputTokens * p.output) /
    1_000_000;

  const display =
    estimatedCost < 0.0001
      ? `< $0.0001`
      : `~$${estimatedCost.toFixed(4)}`;

  return (
    <span className="text-xs px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono">
      {display}
    </span>
  );
}
