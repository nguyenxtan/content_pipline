import {
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const niches = pgTable("niches", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  icon: varchar("icon", { length: 10 }),
  targetAudience: text("target_audience"),
  tone: text("tone"),
  stages: jsonb("stages")
    .$type<string[]>()
    .notNull()
    .default(["ideation", "script", "short", "long"]),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: serial("id").primaryKey(),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    content: text("content").notNull(),
    variables: jsonb("variables").$type<string[]>().default([]).notNull(),
    model: varchar("model", { length: 50 })
      .default("claude-sonnet-4-6")
      .notNull(),
    temperature: numeric("temperature", { precision: 3, scale: 2 })
      .default("0.7")
      .notNull(),
    maxTokens: integer("max_tokens").default(4000).notNull(),
    version: integer("version").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    parentId: integer("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_templates_niche_stage").on(table.nicheId, table.stage),
    uniqueIndex("uniq_niche_stage_version").on(
      table.nicheId,
      table.stage,
      table.version
    ),
  ]
);

export const contentPieces = pgTable(
  "content_pieces",
  {
    id: serial("id").primaryKey(),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id),
    title: text("title"),
    status: varchar("status", { length: 50 })
      .default("idea_pending")
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_pieces_status").on(table.status),
    index("idx_pieces_niche").on(table.nicheId),
  ]
);

export const contentOutputs = pgTable(
  "content_outputs",
  {
    id: serial("id").primaryKey(),
    pieceId: integer("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    promptTemplateId: integer("prompt_template_id").references(
      () => promptTemplates.id
    ),
    promptRendered: text("prompt_rendered"),
    outputRaw: text("output_raw"),
    outputJson: jsonb("output_json"),
    model: varchar("model", { length: 50 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    durationMs: integer("duration_ms"),
    status: varchar("status", { length: 20 }).default("success").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_outputs_piece_stage").on(table.pieceId, table.stage)]
);

export const agentSuggestions = pgTable("agent_suggestions", {
  id: serial("id").primaryKey(),
  nicheId: integer("niche_id").references(() => niches.id),
  userInput: jsonb("user_input").notNull(),
  suggestedPrompts: jsonb("suggested_prompts").notNull(),
  accepted: boolean("accepted").default(false).notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const generatedContents = pgTable(
  "generated_contents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    promptTemplateId: integer("prompt_template_id")
      .notNull()
      .references(() => promptTemplates.id),
    promptVersion: integer("prompt_version").notNull(),
    inputVariables: jsonb("input_variables")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    output: text("output"),
    generationTime: integer("generation_time"),
    outputTokens: integer("output_tokens"),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    n8nWorkflowId: varchar("n8n_workflow_id", { length: 200 }),
    n8nExecutionId: varchar("n8n_execution_id", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_contents_niche_stage").on(table.nicheId, table.stage),
    index("idx_contents_status").on(table.status),
    index("idx_contents_created_at").on(table.createdAt),
  ]
);

export const promptTestRuns = pgTable(
  "prompt_test_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    promptTemplateId: integer("prompt_template_id").references(
      () => promptTemplates.id,
      { onDelete: "set null" }
    ),
    model: varchar("model", { length: 100 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    output: text("output"),
    inputVariables: jsonb("input_variables")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: varchar("status", { length: 20 }).notNull().default("success"),
    errorMessage: text("error_message"),
    openrouterId: varchar("openrouter_id", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_test_runs_niche_stage").on(table.nicheId, table.stage),
    index("idx_test_runs_template").on(table.promptTemplateId),
  ]
);

export const contentGenerations = pgTable(
  "content_generations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    topic: text("topic").notNull(),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    nicheName: varchar("niche_name", { length: 100 }).notNull(),
    script: text("script").notNull(),
    shortContent: text("short_content").notNull(),
    longContent: text("long_content").notNull(),
    totalTokens: integer("total_tokens"),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    generationTime: integer("generation_time"),
    status: varchar("status", { length: 20 }).notNull().default("completed"),
    errorMessage: text("error_message"),
    ttsStatus: varchar("tts_status", { length: 20 }).default("pending"),
    ttsErrorMessage: text("tts_error_message"),
    ttsOutputUrl: text("tts_output_url"),
    youtubeUploadStatus: varchar("youtube_upload_status", { length: 20 }).default("pending"),
    youtubeUploadError: text("youtube_upload_error"),
    youtubeVideoUrl: text("youtube_video_url"),
    youtubeScheduledAt: timestamp("youtube_scheduled_at", { withTimezone: true }),
    isLocked: boolean("is_locked").default(false).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_content_gen_niche").on(table.nicheId),
    index("idx_content_gen_created").on(table.createdAt),
    index("idx_content_gen_topic").on(table.topic),
    index("idx_content_gen_locked").on(table.isLocked),
  ]
);

export const contentSchedulerJobs = pgTable(
  "content_scheduler_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    nicheName: varchar("niche_name", { length: 100 }).notNull(),
    topic: text("topic").notNull(),
    frequency: varchar("frequency", { length: 20 }).notNull(),
    cronExpression: text("cron_expression"),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_scheduler_niche").on(table.nicheId),
    index("idx_scheduler_enabled").on(table.isEnabled),
    index("idx_scheduler_next_run").on(table.nextRunAt),
  ]
);

// Relations
export const nichesRelations = relations(niches, ({ many }) => ({
  promptTemplates: many(promptTemplates),
  contentPieces: many(contentPieces),
  agentSuggestions: many(agentSuggestions),
  testRuns: many(promptTestRuns),
  generatedContents: many(generatedContents),
  contentGenerations: many(contentGenerations),
  schedulerJobs: many(contentSchedulerJobs),
}));

export const promptTemplatesRelations = relations(
  promptTemplates,
  ({ one, many }) => ({
    niche: one(niches, {
      fields: [promptTemplates.nicheId],
      references: [niches.id],
    }),
    contentOutputs: many(contentOutputs),
    testRuns: many(promptTestRuns),
  })
);

export const generatedContentsRelations = relations(
  generatedContents,
  ({ one }) => ({
    niche: one(niches, {
      fields: [generatedContents.nicheId],
      references: [niches.id],
    }),
    promptTemplate: one(promptTemplates, {
      fields: [generatedContents.promptTemplateId],
      references: [promptTemplates.id],
    }),
  })
);

export const promptTestRunsRelations = relations(promptTestRuns, ({ one }) => ({
  niche: one(niches, {
    fields: [promptTestRuns.nicheId],
    references: [niches.id],
  }),
  promptTemplate: one(promptTemplates, {
    fields: [promptTestRuns.promptTemplateId],
    references: [promptTemplates.id],
  }),
}));

export const contentPiecesRelations = relations(
  contentPieces,
  ({ one, many }) => ({
    niche: one(niches, {
      fields: [contentPieces.nicheId],
      references: [niches.id],
    }),
    outputs: many(contentOutputs),
  })
);

export const contentOutputsRelations = relations(contentOutputs, ({ one }) => ({
  piece: one(contentPieces, {
    fields: [contentOutputs.pieceId],
    references: [contentPieces.id],
  }),
  promptTemplate: one(promptTemplates, {
    fields: [contentOutputs.promptTemplateId],
    references: [promptTemplates.id],
  }),
}));

export const agentSuggestionsRelations = relations(
  agentSuggestions,
  ({ one }) => ({
    niche: one(niches, {
      fields: [agentSuggestions.nicheId],
      references: [niches.id],
    }),
  })
);

export const contentGenerationsRelations = relations(
  contentGenerations,
  ({ one }) => ({
    niche: one(niches, {
      fields: [contentGenerations.nicheId],
      references: [niches.id],
    }),
  })
);

export const contentSchedulerJobsRelations = relations(
  contentSchedulerJobs,
  ({ one }) => ({
    niche: one(niches, {
      fields: [contentSchedulerJobs.nicheId],
      references: [niches.id],
    }),
  })
);

// Type exports
export type GeneratedContent = typeof generatedContents.$inferSelect;
export type NewGeneratedContent = typeof generatedContents.$inferInsert;
export type PromptTestRun = typeof promptTestRuns.$inferSelect;
export type NewPromptTestRun = typeof promptTestRuns.$inferInsert;
export type Niche = typeof niches.$inferSelect;
export type NewNiche = typeof niches.$inferInsert;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;
export type ContentPiece = typeof contentPieces.$inferSelect;
export type NewContentPiece = typeof contentPieces.$inferInsert;
export type ContentOutput = typeof contentOutputs.$inferSelect;
export type NewContentOutput = typeof contentOutputs.$inferInsert;
export type AgentSuggestion = typeof agentSuggestions.$inferSelect;
export type ContentGeneration = typeof contentGenerations.$inferSelect;
export type NewContentGeneration = typeof contentGenerations.$inferInsert;
export type ContentSchedulerJob = typeof contentSchedulerJobs.$inferSelect;
export type NewContentSchedulerJob = typeof contentSchedulerJobs.$inferInsert;
export type NewAgentSuggestion = typeof agentSuggestions.$inferInsert;
