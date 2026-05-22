"use client";

const STAGE_LABELS: Record<string, string> = {
  ideation: "Ý tưởng",
  script: "Kịch bản",
  short: "Short",
  long: "Long-form",
};

function label(stage: string) {
  return STAGE_LABELS[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
}

interface Props {
  niche: { id: number; name: string; icon: string | null; stages: string[] };
  selected: string | null;
  onSelect: (stage: string) => void;
}

export function StepStageSelect({ niche, selected, onSelect }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Chọn giai đoạn</h2>
      <p className="text-sm text-gray-500 mb-4">
        Ngách: {niche.icon} {niche.name}
      </p>
      <div className="flex flex-wrap gap-3">
        {niche.stages.map((stage) => (
          <button
            key={stage}
            onClick={() => onSelect(stage)}
            className={`px-5 py-3 rounded-lg border-2 font-medium transition-colors ${
              selected === stage
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 hover:border-gray-300 bg-white text-gray-700"
            }`}
          >
            {label(stage)}
          </button>
        ))}
      </div>
    </div>
  );
}
