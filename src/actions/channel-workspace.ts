"use server";

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import {
  getChannelWorkspaces,
  getWorkspaceById,
  getWorkspaceTopicFamiliesResolved,
  type ChannelWorkspace,
  type ResolvedTopicFamily,
} from "@/lib/channel-workspace-registry";
import { getUploadQueueAction, type UploadQueueRow } from "@/actions/social-channels";

// ── Read actions ──────────────────────────────────────────────────────────

export async function getChannelWorkspacesAction(): Promise<ChannelWorkspace[]> {
  return getChannelWorkspaces();
}

export async function getWorkspaceByIdAction(
  workspaceId: string,
): Promise<ChannelWorkspace | null> {
  return getWorkspaceById(workspaceId);
}

export async function getWorkspaceTopicFamiliesAction(
  workspaceId: string,
): Promise<ResolvedTopicFamily[]> {
  return getWorkspaceTopicFamiliesResolved(workspaceId);
}

// ── AI topic suggestion (preview-only, no writes) ─────────────────────────

export type WorkspaceTopicSuggestion = {
  topic: string;
  familyId: string;
  familyLabel: string;
  rationale: string;
};

export type SuggestWorkspaceTopicsResult = {
  ok: boolean;
  workspaceId: string;
  suggestions: WorkspaceTopicSuggestion[];
  error?: string;
};

export type WorkspaceOperationalItem = {
  queueId: string;
  workspaceId: string;
  workspaceName: string;
  scheduledAt: Date;
  platform: string;
  channelName: string;
  status: string;
  videoType: string;
  formatType: string;
  title: string;
  topic: string;
};

export type WorkspaceOperationalSummary = {
  workspaceId: string;
  workspaceName: string;
  promptProfileId: string;
  readyContentCount: number;
  queuedCount: number;
  doneTodayCount: number;
  errorCount: number;
  nextScheduledPost: WorkspaceOperationalItem | null;
  scheduleItems: WorkspaceOperationalItem[];
};

export type WorkspaceDashboardResult = {
  summaries: WorkspaceOperationalSummary[];
  scheduleItems: WorkspaceOperationalItem[];
  tangSauQueuedReview: TangSauQueuedReviewItem[];
};

export type TangSauQueuedReviewItem = {
  queueId: string;
  contentId: string;
  scheduledAt: Date;
  scheduledAtVn: string;
  topic: string;
  quoteText: string;
  mainQuote: string;
  reflectionText: string | null;
  status: string;
  youtubeChannel: string;
  profileVerified: boolean;
  duplicateMotifWarnings: string[];
  buddhistWordingWarnings: string[];
  sidecarWorkspaceId: string | null;
  sidecarChannelProfileId: string | null;
  sidecarTopicFamily: string | null;
  channelKey: string | null;
  contentProfileKey: string | null;
  formatType: string | null;
};

function getVietnamDateKey(date: Date | null | undefined): string | null {
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function toOperationalItem(row: UploadQueueRow): WorkspaceOperationalItem | null {
  if (!row.workspaceId || !row.workspaceName) return null;
  return {
    queueId: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    scheduledAt: row.scheduledAt,
    platform: row.platform,
    channelName: row.platformAccountName ?? row.channelName,
    status: row.status,
    videoType: row.videoType,
    formatType: row.formatType,
    title: row.title,
    topic: row.topic,
  };
}

function normalizeSimilarityText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateText(a: string, b: string): boolean {
  const left = normalizeSimilarityText(a);
  const right = normalizeSimilarityText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 12 && right.length >= 12 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size) >= 0.7;
}

function formatVietnamShort(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

type SidecarSummary = {
  workspaceId: string | null;
  channelProfileId: string | null;
  topicFamily: string | null;
  quoteText: string | null;
  mainQuote: string | null;
  reflectionText: string | null;
};

function readQuoteSidecar(contentId: string): SidecarSummary | null {
  const sidecarPath = path.join(process.cwd(), "output", "legacy-quote-short-v1", `${contentId}-legacy-quote-short.json`);
  if (!fs.existsSync(sidecarPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as {
      workspaceId?: string;
      channelProfileId?: string;
      topicFamily?: string;
      quoteText?: string;
      mainQuote?: string;
      reflectionText?: string;
    };
    return {
      workspaceId: parsed.workspaceId ?? null,
      channelProfileId: parsed.channelProfileId ?? null,
      topicFamily: parsed.topicFamily ?? null,
      quoteText: parsed.quoteText ?? null,
      mainQuote: parsed.mainQuote ?? null,
      reflectionText: parsed.reflectionText ?? null,
    };
  } catch {
    return null;
  }
}

const BUDDHIST_WORDING_RE = /(phật|phat|phật pháp|nhân quả|nghiệp|chánh niệm|từ bi|phước|quý vị)/i;

async function getTangSauQueuedReview(queueRows: UploadQueueRow[]): Promise<TangSauQueuedReviewItem[]> {
  const tangRows = queueRows
    .filter(
      (row) =>
        row.workspaceId === "tang_sau_workspace" &&
        row.platform === "youtube" &&
        row.videoType === "short" &&
        row.status === "queued",
    )
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const baseItems = tangRows.map((row) => {
    const sidecar = readQuoteSidecar(row.contentId);
    const mainQuote = sidecar?.mainQuote ?? sidecar?.quoteText ?? row.topic ?? row.title;
    const reflectionText = sidecar?.reflectionText ?? null;
    const quoteText = reflectionText ? `${mainQuote} ${reflectionText}` : mainQuote;
    const profileVerified =
      sidecar?.workspaceId === "tang_sau_workspace" &&
      sidecar?.channelProfileId === "tang_sau_v1" &&
      row.contentChannelKey === "tang_sau" &&
      row.contentProfileKey === "philosophy" &&
      row.formatType === "legacy_quote_short";
    const wordingWarnings = BUDDHIST_WORDING_RE.test(`${row.title} ${row.topic} ${quoteText}`)
      ? ["buddhist_wording"]
      : [];

    return {
      queueId: row.id,
      contentId: row.contentId,
      scheduledAt: row.scheduledAt,
      scheduledAtVn: formatVietnamShort(row.scheduledAt),
      topic: row.topic,
      quoteText,
      mainQuote,
      reflectionText,
      status: row.status,
      youtubeChannel: row.platformAccountName ?? row.channelName,
      profileVerified,
      duplicateMotifWarnings: [] as string[],
      buddhistWordingWarnings: wordingWarnings,
      sidecarWorkspaceId: sidecar?.workspaceId ?? null,
      sidecarChannelProfileId: sidecar?.channelProfileId ?? null,
      sidecarTopicFamily: sidecar?.topicFamily ?? null,
      channelKey: row.contentChannelKey,
      contentProfileKey: row.contentProfileKey,
      formatType: row.formatType,
    };
  });

  for (let i = 0; i < baseItems.length; i++) {
    const current = baseItems[i];
    const dupes: string[] = [];
    for (let j = 0; j < baseItems.length; j++) {
      if (i === j) continue;
      const other = baseItems[j];
      if (
        isNearDuplicateText(current.topic, other.topic) ||
        isNearDuplicateText(current.quoteText, other.quoteText)
      ) {
        dupes.push("possible_duplicate_motif");
        break;
      }
    }
    current.duplicateMotifWarnings = dupes;
  }

  return baseItems;
}

export async function getWorkspaceDashboardAction(): Promise<WorkspaceDashboardResult> {
  const [workspaces, queueRows, contentRows] = await Promise.all([
    getChannelWorkspacesAction(),
    getUploadQueueAction({ limit: 500 }),
    db.query.contentGenerations.findMany({
      columns: {
        channelKey: true,
        formatType: true,
        videoStatus: true,
        longVideoStatus: true,
      },
    }),
  ]);

  const todayKey = getVietnamDateKey(new Date());
  const allScheduleItems = queueRows
    .map(toOperationalItem)
    .filter((item): item is WorkspaceOperationalItem => !!item)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const summaries = workspaces.map((workspace) => {
    const workspaceQueue = queueRows.filter((row) => row.workspaceId === workspace.workspaceId);
    const queueItems = workspaceQueue
      .map(toOperationalItem)
      .filter((item): item is WorkspaceOperationalItem => !!item)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

    const nextScheduledPost =
      queueItems.find((item) => item.status === "queued" || item.status === "uploading") ?? null;

    const readyContentCount = contentRows.filter((row) => {
      if (row.channelKey !== workspace.channelKey) return false;
      if (row.formatType === "long_video") return row.longVideoStatus === "done";
      return row.videoStatus === "done";
    }).length;

    const doneTodayCount = workspaceQueue.filter(
      (row) => row.status === "done" && getVietnamDateKey(row.uploadedAt) === todayKey,
    ).length;

    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.displayName,
      promptProfileId: workspace.promptProfileId,
      readyContentCount,
      queuedCount: workspaceQueue.filter(
        (row) => row.status === "queued" || row.status === "uploading",
      ).length,
      doneTodayCount,
      errorCount: workspaceQueue.filter((row) => row.status === "error").length,
      nextScheduledPost,
      scheduleItems: queueItems,
    };
  });

  return {
    summaries,
    scheduleItems: allScheduleItems,
    tangSauQueuedReview: await getTangSauQueuedReview(queueRows),
  };
}

export async function suggestWorkspaceTopicsAction(
  workspaceId: string,
  count = 6,
): Promise<SuggestWorkspaceTopicsResult> {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) {
    return { ok: false, workspaceId, suggestions: [], error: "Workspace không tồn tại." };
  }

  const families = getWorkspaceTopicFamiliesResolved(workspaceId);
  if (families.length === 0) {
    return { ok: false, workspaceId, suggestions: [], error: "Workspace chưa có topic family nào." };
  }

  const familyDescriptions = families
    .map((f) => `- ${f.label}: ${f.description} (ví dụ: ${(f.exampleTopics ?? []).slice(0, 2).join(", ")})`)
    .join("\n");

  const avoidTerms = families
    .flatMap((f) => f.avoidTerms ?? [])
    .filter(Boolean);
  const avoidNote = avoidTerms.length > 0
    ? `Tránh các từ khoá: ${avoidTerms.join(", ")}.`
    : "";

  try {
    const client = getOpenRouterClient();
    const resp = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.9,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `Bạn gợi ý chủ đề video cho kênh: ${workspace.displayName}.\n` +
            `Phong cách: ${workspace.description}\n\n` +
            `Topic families:\n${familyDescriptions}\n\n` +
            `${avoidNote}\n` +
            `Trả về JSON: { "suggestions": [{ "topic": "...", "familyId": "...", "rationale": "..." }] }\n` +
            `familyId phải là một trong: ${families.map((f) => f.familyId).join(", ")}.`,
        },
        {
          role: "user",
          content: `Gợi ý ${count} chủ đề video ngắn độc đáo, phù hợp phong cách kênh. Mỗi chủ đề 4–10 từ tiếng Việt.`,
        },
      ],
    });

    const raw = resp.choices[0]?.message.content ?? "{}";
    const parsed = JSON.parse(raw) as { suggestions?: Array<{ topic: string; familyId: string; rationale: string }> };
    const familyMap = new Map(families.map((f) => [f.familyId, f.label]));

    const suggestions: WorkspaceTopicSuggestion[] = (parsed.suggestions ?? [])
      .slice(0, count)
      .map((s) => ({
        topic: s.topic ?? "",
        familyId: s.familyId ?? families[0]?.familyId ?? "",
        familyLabel: familyMap.get(s.familyId) ?? s.familyId,
        rationale: s.rationale ?? "",
      }))
      .filter((s) => s.topic.length > 0);

    return { ok: true, workspaceId, suggestions };
  } catch (err) {
    return {
      ok: false,
      workspaceId,
      suggestions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
