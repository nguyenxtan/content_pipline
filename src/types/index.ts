export type ContentStatus =
  | "idea_pending"
  | "idea_generated"
  | "idea_approved"
  | "script_generated"
  | "short_done"
  | "long_done"
  | "published"
  | "archived"
  | "rejected";

export type Stage = "ideation" | "script" | "short" | "long";

export const CONTENT_STATUSES: ContentStatus[] = [
  "idea_pending",
  "idea_generated",
  "idea_approved",
  "script_generated",
  "short_done",
  "long_done",
  "published",
  "archived",
];

export const STAGE_LABELS: Record<Stage, string> = {
  ideation: "Ideation",
  script: "Script",
  short: "Short (60s)",
  long: "Long Metadata",
};

export const STATUS_LABELS: Record<ContentStatus, string> = {
  idea_pending: "Chờ ý tưởng",
  idea_generated: "Đã có ý tưởng",
  idea_approved: "Đã duyệt ý tưởng",
  script_generated: "Script xong",
  short_done: "Short xong",
  long_done: "Long metadata xong",
  published: "Đã đăng",
  archived: "Lưu trữ",
  rejected: "Từ chối",
};

export const STATUS_COLORS: Record<ContentStatus, string> = {
  idea_pending: "bg-gray-500",
  idea_generated: "bg-blue-500",
  idea_approved: "bg-indigo-500",
  script_generated: "bg-violet-500",
  short_done: "bg-orange-500",
  long_done: "bg-amber-500",
  published: "bg-green-500",
  archived: "bg-slate-500",
  rejected: "bg-red-500",
};

export type AgentInput = {
  niche_name: string;
  niche_description: string;
  audience: string;
  tone: string;
  format: string;
  avoid: string;
};

export type AgentSuggestedPrompts = {
  ideation: string;
  script: string;
  short: string;
  long: string;
};
