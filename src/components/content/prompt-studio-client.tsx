"use client";

import { useMemo, useState, useTransition } from "react";
import { Brain, ChevronRight, Layers3, Sparkles } from "lucide-react";
import { suggestPromptOptionsAction } from "@/actions/prompt-studio";
import { getQuoteOptionGroups } from "@/lib/prompt-studio-registry";
import type {
  PromptStudioSnapshot,
  SuggestPromptOptionsResult,
} from "@/lib/prompt-studio-types";

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
      {description ? <p className="text-sm text-slate-400">{description}</p> : null}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
      {children}
    </span>
  );
}

export function PromptStudioClient({ data }: { data: PromptStudioSnapshot }) {
  const [isPending, startTransition] = useTransition();
  const [channelProfileId, setChannelProfileId] = useState("buddhist_healing_v1");
  const [topic, setTopic] = useState("");
  const [topicFamilyId, setTopicFamilyId] = useState("");
  const [result, setResult] = useState<SuggestPromptOptionsResult | null>(null);

  const filteredOptionGroups = useMemo(
    () => getQuoteOptionGroups(channelProfileId),
    [channelProfileId],
  );

  const filteredTopicFamilies = useMemo(
    () =>
      data.topicFamilies.filter((family) =>
        !channelProfileId ? true : family.channels.includes(channelProfileId),
      ),
    [channelProfileId, data.topicFamilies],
  );

  const handleSuggest = () => {
    setResult(null);
    startTransition(async () => {
      const next = await suggestPromptOptionsAction({
        channelProfileId,
        contentFormatId: "legacy_quote_short",
        topicFamilyId: topicFamilyId || undefined,
        topic: topic || undefined,
      });
      setResult(next);
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-100">Prompt Studio</h1>
            <p className="max-w-3xl text-sm text-slate-400">
              Quản lý nền tảng prompt theo tầng: Global -&gt; Platform -&gt; Channel -&gt; Format -&gt; Topic Family -&gt; Template -&gt; Variant.
              Phiên bản đầu này ưu tiên đọc, rà soát và preview suggestion. Chưa tự động đổi prompt production.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-400">
            <p className="font-medium text-slate-200">Prompt hierarchy</p>
            <p className="mt-1">{data.hierarchy.join(" -> ")}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          {data.audienceProfiles && data.audienceProfiles.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <SectionTitle
                title="Audience Profiles"
                description="Hồ sơ người xem theo workspace — nỗi đau, mong muốn, tone và visual preference. Được inject vào LLM prompt khi generate."
              />
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {data.audienceProfiles.map((ap) => (
                  <div key={ap.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-100">{ap.label}</p>
                        {ap.ageRange && (
                          <p className="mt-0.5 text-xs text-amber-400">Độ tuổi: {ap.ageRange}</p>
                        )}
                      </div>
                      <Chip>{ap.id}</Chip>
                    </div>
                    <p className="mt-3 text-sm text-slate-300">{ap.audienceDescription}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nỗi đau</p>
                        <ul className="mt-2 space-y-1">
                          {ap.audiencePainPoints.slice(0, 4).map((pt) => (
                            <li key={pt} className="text-xs text-slate-400">• {pt}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Mong muốn</p>
                        <ul className="mt-2 space-y-1">
                          {ap.audienceDesires.slice(0, 4).map((d) => (
                            <li key={d} className="text-xs text-slate-400">• {d}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Visual ưu tiên</p>
                        <ul className="mt-2 space-y-1">
                          {ap.visualPreference.slice(0, 3).map((v) => (
                            <li key={v} className="text-xs text-emerald-400">+ {v}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Visual tránh</p>
                        <ul className="mt-2 space-y-1">
                          {ap.avoidedVisuals.slice(0, 3).map((v) => (
                            <li key={v} className="text-xs text-rose-400">− {v}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Góc tiếp cận tốt nhất</p>
                      <ul className="mt-2 space-y-1">
                        {ap.bestKnownAngles.slice(0, 3).map((a) => (
                          <li key={a} className="text-xs text-slate-300">→ {a}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.performanceDimensions && data.performanceDimensions.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <SectionTitle
                title="Performance Comparison Dimensions"
                description="Các chiều phân tích hiệu suất trong tương lai. Được ghi vào sidecar — chưa có automatic feedback loop."
              />
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="pb-2 pr-4 font-medium">Dimension</th>
                      <th className="pb-2 pr-4 font-medium">Source</th>
                      <th className="pb-2 font-medium">Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.performanceDimensions.map((dim) => (
                      <tr key={dim.id} className="border-t border-slate-800">
                        <td className="py-2 pr-4 font-mono text-xs text-amber-300">{dim.id}</td>
                        <td className="py-2 pr-4 text-xs text-slate-400">{dim.source}</td>
                        <td className="py-2 text-xs text-slate-300">{dim.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <SectionTitle
              title="Channel Profiles"
              description="Profile channel quyết định giọng điệu, vocabulary và những điều cần tránh."
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {data.channels.map((profile) => (
                <div key={profile.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-100">{profile.channelName}</p>
                      <p className="mt-1 text-xs text-slate-500">{profile.label}</p>
                    </div>
                    <Chip>{profile.id}</Chip>
                  </div>
                  <p className="mt-3 text-sm text-slate-300">{profile.niche}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {profile.tone.map((tone) => (
                      <Chip key={tone}>{tone}</Chip>
                    ))}
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Vocabulary</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {profile.vocabulary.map((word) => (
                        <Chip key={word}>{word}</Chip>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Avoid</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {profile.avoid.map((word) => (
                        <Chip key={word}>{word}</Chip>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <SectionTitle title="Fixed / Technical" description="Các rule nên khoá để pipeline không bị lệch hoặc bẩn dữ liệu." />
              <div className="mt-4 space-y-3">
                {data.fields.fixed.map((field) => (
                  <div key={field.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-sm font-medium text-slate-100">{field.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{field.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <SectionTitle title="Editable / Creative" description="Phần nên chỉnh theo channel, format, topic family hoặc experiment." />
              <div className="mt-4 space-y-3">
                {data.fields.editable.map((field) => (
                  <div key={field.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-sm font-medium text-slate-100">{field.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{field.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <SectionTitle title="Topic Families" description="Nhóm chủ đề được dùng để điều hướng content angle theo từng channel." />
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {data.topicFamilies.map((family) => (
                <div key={family.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-100">{family.label}</p>
                    <Chip>{family.id}</Chip>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{family.description}</p>
                  <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">Ví dụ</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-300">
                    {family.exampleTopics.map((topicItem) => (
                      <li key={topicItem}>• {topicItem}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <SectionTitle title="Prompt Templates" description="Bản đồ template nội bộ theo format/stage. Đây là lớp logic creative, không phải DB prompt editor truyền thống." />
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Template</th>
                    <th className="pb-2 pr-4 font-medium">Stage</th>
                    <th className="pb-2 pr-4 font-medium">Formats</th>
                    <th className="pb-2 font-medium">Variants</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  {data.templates.map((template) => (
                    <tr key={template.id} className="border-t border-slate-800">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-slate-100">{template.label}</p>
                        <p className="mt-1 text-xs text-slate-400">{template.description}</p>
                      </td>
                      <td className="py-3 pr-4 text-slate-300">{template.stage}</td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1.5">
                          {template.formatIds.map((format) => (
                            <Chip key={format}>{format}</Chip>
                          ))}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {template.variantIds.length === 0 ? <Chip>Không có</Chip> : template.variantIds.map((variantId) => <Chip key={variantId}>{variantId}</Chip>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <SectionTitle title="DB Prompt Templates đang active" description="Lớp prompt editor cũ vẫn hoạt động; Prompt Studio hiện đọc được để giúp soát toàn cục." />
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Niche</th>
                    <th className="pb-2 pr-4 font-medium">Stage</th>
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Model</th>
                    <th className="pb-2 font-medium">Ver</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activeDbTemplates.map((template) => (
                    <tr key={template.id} className="border-t border-slate-800">
                      <td className="py-3 pr-4 text-slate-200">{template.nicheName}</td>
                      <td className="py-3 pr-4 text-slate-300">{template.stage}</td>
                      <td className="py-3 pr-4 text-slate-300">{template.name}</td>
                      <td className="py-3 pr-4 text-slate-400">{template.model}</td>
                      <td className="py-3 text-slate-400">{template.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-rose-400" />
              <SectionTitle
                title="AI Suggestion Helper"
                description="Preview-only. Gợi ý topic family, quote style, visual mood, hook angle. Không tự đổi prompt production."
              />
            </div>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Channel profile</label>
                <select
                  value={channelProfileId}
                  onChange={(event) => {
                    setChannelProfileId(event.target.value);
                    setTopicFamilyId("");
                  }}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
                >
                  {data.channels.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.channelName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Topic family</label>
                <select
                  value={topicFamilyId}
                  onChange={(event) => setTopicFamilyId(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
                >
                  <option value="">Tự gợi ý theo channel</option>
                  {filteredTopicFamilies.map((family) => (
                    <option key={family.id} value={family.id}>
                      {family.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Topic / ý chính</label>
                <input
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Ví dụ: cô đơn giữa thành phố đông người"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-rose-500"
                />
              </div>

              <button
                type="button"
                onClick={handleSuggest}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {isPending ? "Đang gợi ý..." : "Gợi ý prompt options"}
              </button>

              {result ? (
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">Preview suggestions</p>
                    <Chip>{result.source === "ai" ? "AI preview" : "Fallback preview"}</Chip>
                  </div>
                  <p className="text-xs text-slate-400">{result.note}</p>
                  {result.error ? <p className="text-xs text-amber-300">Fallback do lỗi AI: {result.error}</p> : null}
                  <div className="space-y-3">
                    {[
                      { label: "Topic families", items: result.suggestions.topicFamilies },
                      { label: "Quote styles", items: result.suggestions.quoteStyles },
                      { label: "Visual moods", items: result.suggestions.visualMoods },
                      { label: "Hook angles", items: result.suggestions.hookAngles },
                    ].map(({ label, items }) => (
                      <div key={label}>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(items as string[]).map((item) => (
                            <Chip key={item}>{item}</Chip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-amber-400" />
              <SectionTitle title="Quote option groups" description="Nguồn option tập trung cho Quote Shorts để tránh dropdown hardcode rải rác." />
            </div>
            <div className="mt-4 space-y-4">
              {filteredOptionGroups.map((group) => (
                <div key={group.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-100">{group.label}</p>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                    <p className="text-xs text-slate-500">{group.description}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {group.options.map((option) => (
                      <Chip key={option.id}>{option.label}</Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
