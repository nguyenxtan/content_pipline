import "dotenv/config";

import pg from "pg";

const { Pool } = pg;

const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const SHORT_FORMATS = new Set(["tts_short", "legacy_quote_short"]);
const ANALYTICS_READY_AGE_HOURS = 48;

type Platform = "youtube" | "facebook";

type Args = {
  from: string | null;
  to: string | null;
  limit: number | null;
  json: boolean;
  includeYoutube: boolean;
  includeFacebook: boolean;
};

type ContentRow = {
  id: string;
  topic: string;
  short_content: string | null;
  script: string | null;
  prompt_versions: unknown;
  format_type: string | null;
  status: string;
  video_status: string | null;
  topic_family: string | null;
  short_selected_hook: string | null;
  hook_pattern: string | null;
  hook_type: string | null;
  hook_variant: string | null;
  short_cover_text: string | null;
  short_cover_asset_path: string | null;
  short_cover_generated_at: string | null;
  youtube_video_url: string | null;
  facebook_video_url: string | null;
  created_at: string;
};

type QueueRow = {
  id: string;
  content_id: string;
  platform: Platform;
  video_type: string;
  status: string;
  scheduled_at: string;
  uploaded_at: string | null;
  error_message: string | null;
};

type PublishedRow = {
  id: string;
  content_id: string | null;
  platform: Platform;
  video_type: string;
  platform_video_id: string;
  platform_video_url: string | null;
  published_at: string | null;
  latest_view_count: string | number | null;
  latest_like_count: string | number | null;
  latest_comment_count: string | number | null;
  latest_fetched_at: string | null;
  raw_latest_json: unknown;
};

type SnapshotRow = {
  published_video_id: string;
  fetched_at: string;
  view_count: string | number | null;
  like_count: string | number | null;
  comment_count: string | number | null;
  share_count: string | number | null;
  avg_view_duration_sec: number | null;
  retention_pct: number | null;
};

type ShortContentAudit = {
  contentId: string;
  title: string;
  formatType: "tts_short" | "legacy_quote_short";
  topicFamily: string | null;
  createdAtUtc: string;
  createdAtVn: string | null;
  youtubePublished: PublishedRow | null;
  facebookPublished: PublishedRow | null;
  facebookPhotoPublished: PublishedRow | null;
  youtubeSnapshot: SnapshotRow | null;
  facebookSnapshot: SnapshotRow | null;
  youtubeViews: number | null;
  facebookViews: number | null;
  youtubeRetention: number | null;
  completePublishedPair: boolean;
  excludedIncompleteReason: string | null;
  hookText: string | null;
  hookSource: string;
  hookPattern: string | null;
  hookType: string | null;
  coverText: string | null;
  hasCoverAsset: boolean;
  analyticsReady: boolean;
  retentionReady: boolean;
};

type WinnerRow = {
  contentId: string;
  title: string;
  formatType: string;
  platform: string;
  views: number;
  retention: number | null;
  hookCover: string;
};

function parseArgs(argv: string[]): Args {
  let from: string | null = null;
  let to: string | null = null;
  let limit: number | null = null;
  let json = false;
  let includeYoutube = false;
  let includeFacebook = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") {
      from = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--to") {
      to = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      limit = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--include-youtube") {
      includeYoutube = true;
      continue;
    }
    if (arg === "--include-facebook") {
      includeFacebook = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!includeYoutube && !includeFacebook) {
    includeYoutube = true;
    includeFacebook = true;
  }

  return {
    from,
    to,
    limit,
    json,
    includeYoutube,
    includeFacebook,
  };
}

function formatVn(value: string | Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle] ?? null
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentileNote(count: number, retentionCount: number): string {
  const notes: string[] = [];
  if (count < 5) notes.push("low_sample");
  if (retentionCount === 0) notes.push("no_retention");
  else if (retentionCount < count) notes.push("partial_retention");
  return notes.join(", ") || "ok";
}

function firstSentence(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const parts = normalized.split(/(?<=[.!?])\s+/);
  return parts[0]?.trim() ?? null;
}

function shorten(value: string | null | undefined, max = 88): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findPromptHook(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const trimmed = shorten(value, 140);
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPromptHook(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const objectValue = getObject(value);
  if (!objectValue) return null;

  const directKeys = [
    "selectedHook",
    "shortSelectedHook",
    "hookText",
    "hook",
    "openingHook",
  ];
  for (const key of directKeys) {
    if (key in objectValue) {
      const found = findPromptHook(objectValue[key], depth + 1);
      if (found) return found;
    }
  }

  const nestedKeys = ["hook", "hooks", "short", "script"];
  for (const key of nestedKeys) {
    if (key in objectValue) {
      const found = findPromptHook(objectValue[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function getHookSignal(content: ContentRow): { hookText: string | null; hookSource: string } {
  if (content.short_selected_hook?.trim()) {
    return {
      hookText: shorten(content.short_selected_hook, 140),
      hookSource: "short_selected_hook",
    };
  }

  const promptHook = findPromptHook(content.prompt_versions);
  if (promptHook) {
    return { hookText: promptHook, hookSource: "prompt_versions" };
  }

  if (content.short_cover_text?.trim()) {
    return {
      hookText: shorten(content.short_cover_text, 140),
      hookSource: "cover_text",
    };
  }

  const topicHook = shorten(content.topic, 140);
  if (topicHook) {
    return { hookText: topicHook, hookSource: "topic_title" };
  }

  const scriptSentence = firstSentence(content.script);
  if (scriptSentence) {
    return { hookText: shorten(scriptSentence, 140), hookSource: "script_first_sentence" };
  }

  return { hookText: null, hookSource: "unavailable" };
}

function getViews(published: PublishedRow | null, snapshot: SnapshotRow | null): number | null {
  return toNumber(snapshot?.view_count) ?? toNumber(published?.latest_view_count) ?? null;
}

function getRetention(snapshot: SnapshotRow | null): number | null {
  return snapshot?.retention_pct ?? null;
}

function isAnalyticsReady(published: PublishedRow | null): boolean {
  return Boolean(published?.latest_fetched_at);
}

function isEnoughData(published: PublishedRow | null, snapshot: SnapshotRow | null, now: Date): boolean {
  if (!published) return false;
  const views = getViews(published, snapshot);
  if (views == null || views <= 0) return false;
  if (snapshot?.retention_pct != null) return true;
  if (!published.published_at) return false;
  const ageMs = now.getTime() - new Date(published.published_at).getTime();
  return ageMs >= ANALYTICS_READY_AGE_HOURS * 60 * 60_000;
}

function latestByPublishedId(rows: SnapshotRow[]): Map<string, SnapshotRow> {
  return new Map(rows.map((row) => [row.published_video_id, row]));
}

function pushGroup<K>(map: Map<K, ShortContentAudit[]>, key: K, row: ShortContentAudit): void {
  const list = map.get(key) ?? [];
  list.push(row);
  map.set(key, list);
}

function formatMetric(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return digits === 0 ? `${Math.round(value)}` : value.toFixed(digits);
}

function table(rows: string[][]): string {
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const now = new Date();

  try {
    const whereParts = ["channel_key = 'phat_phap'"];
    const params: Array<string | number> = [];
    let paramIndex = 1;

    if (args.from) {
      whereParts.push(`created_at >= $${paramIndex}::timestamptz`);
      params.push(args.from);
      paramIndex += 1;
    }
    if (args.to) {
      whereParts.push(`created_at < $${paramIndex}::timestamptz`);
      params.push(args.to);
      paramIndex += 1;
    }

    let limitSql = "";
    if (args.limit != null) {
      limitSql = ` limit $${paramIndex}`;
      params.push(args.limit);
    }

    const contentQuery = `
      select
        id,
        topic,
        short_content,
        script,
        prompt_versions,
        format_type,
        status,
        video_status,
        topic_family,
        short_selected_hook,
        hook_pattern,
        hook_type,
        hook_variant,
        short_cover_text,
        short_cover_asset_path,
        short_cover_generated_at::text,
        youtube_video_url,
        facebook_video_url,
        created_at::text
      from content_generations
      where ${whereParts.join(" and ")}
      order by created_at desc
      ${limitSql}
    `;

    const contentsResult = await pool.query<ContentRow>(contentQuery, params);
    const contentRows = contentsResult.rows;
    const contentIds = contentRows.map((row) => row.id);

    if (contentIds.length === 0) {
      const emptyPayload = {
        window: {
          from: args.from,
          to: args.to,
          limit: args.limit,
        },
        summary: {
          totalContentRows: 0,
        },
      };
      console.log(args.json ? JSON.stringify(emptyPayload, null, 2) : "No phat_phap content rows found in range.");
      return;
    }

    const [queueResult, publishedResult] = await Promise.all([
      pool.query<QueueRow>(
        `
          select
            id,
            content_id,
            platform,
            video_type,
            status,
            scheduled_at::text,
            uploaded_at::text,
            error_message
          from upload_queue
          where content_id = any($1::text[])
          order by scheduled_at asc, created_at asc
        `,
        [contentIds],
      ),
      pool.query<PublishedRow>(
        `
          select
            id,
            content_id,
            platform,
            video_type,
            platform_video_id,
            platform_video_url,
            published_at::text,
            latest_view_count,
            latest_like_count,
            latest_comment_count,
            latest_fetched_at::text,
            raw_latest_json
          from published_videos
          where content_id = any($1::text[])
          order by published_at desc nulls last, created_at desc
        `,
        [contentIds],
      ),
    ]);

    const publishedIds = publishedResult.rows.map((row) => row.id);
    const snapshotsResult = publishedIds.length === 0
      ? { rows: [] as SnapshotRow[] }
      : await pool.query<SnapshotRow>(
          `
            select distinct on (published_video_id)
              published_video_id,
              fetched_at::text,
              view_count,
              like_count,
              comment_count,
              share_count,
              avg_view_duration_sec,
              retention_pct::float as retention_pct
            from video_metric_snapshots
            where published_video_id = any($1::text[])
            order by published_video_id, fetched_at desc
          `,
          [publishedIds],
        );

    const queueByContent = new Map<string, QueueRow[]>();
    for (const row of queueResult.rows) {
      const list = queueByContent.get(row.content_id) ?? [];
      list.push(row);
      queueByContent.set(row.content_id, list);
    }

    const publishedByContent = new Map<string, PublishedRow[]>();
    for (const row of publishedResult.rows) {
      if (!row.content_id) continue;
      const list = publishedByContent.get(row.content_id) ?? [];
      list.push(row);
      publishedByContent.set(row.content_id, list);
    }

    const snapshotsByPublishedId = latestByPublishedId(snapshotsResult.rows);

    const shortContents = contentRows.filter((row): row is ContentRow & { format_type: "tts_short" | "legacy_quote_short" } =>
      SHORT_FORMATS.has(row.format_type ?? ""),
    );

    const audits: ShortContentAudit[] = shortContents.map((content) => {
      const publishedRows = publishedByContent.get(content.id) ?? [];
      const youtubePublished = publishedRows.find((row) => row.platform === "youtube" && row.video_type === "short") ?? null;
      const facebookPublished = publishedRows.find((row) => row.platform === "facebook" && row.video_type === "short") ?? null;
      const facebookPhotoPublished = publishedRows.find((row) => row.platform === "facebook" && row.video_type === "quote") ?? null;
      const youtubeSnapshot = youtubePublished ? snapshotsByPublishedId.get(youtubePublished.id) ?? null : null;
      const facebookSnapshot = facebookPublished ? snapshotsByPublishedId.get(facebookPublished.id) ?? null : null;
      const hookSignal = getHookSignal(content);
      const queueRows = queueByContent.get(content.id) ?? [];
      const hasYoutubeQueue = queueRows.some((row) => row.platform === "youtube" && row.video_type === "short");
      const hasFacebookQueue = queueRows.some((row) => row.platform === "facebook" && row.video_type === "short");

      let excludedIncompleteReason: string | null = null;
      if (!youtubePublished && !facebookPublished) {
        excludedIncompleteReason = hasYoutubeQueue || hasFacebookQueue ? "not_published_pair_yet" : "missing_both_platform_rows";
      } else if (!youtubePublished) {
        excludedIncompleteReason = "missing_youtube_published_row";
      } else if (!facebookPublished) {
        excludedIncompleteReason = "missing_facebook_published_row";
      }

      return {
        contentId: content.id,
        title: content.topic,
        formatType: content.format_type,
        topicFamily: content.topic_family,
        createdAtUtc: new Date(content.created_at).toISOString(),
        createdAtVn: formatVn(content.created_at),
        youtubePublished,
        facebookPublished,
        facebookPhotoPublished,
        youtubeSnapshot,
        facebookSnapshot,
        youtubeViews: getViews(youtubePublished, youtubeSnapshot),
        facebookViews: getViews(facebookPublished, facebookSnapshot),
        youtubeRetention: getRetention(youtubeSnapshot),
        completePublishedPair: Boolean(youtubePublished && facebookPublished),
        excludedIncompleteReason,
        hookText: hookSignal.hookText,
        hookSource: hookSignal.hookSource,
        hookPattern: content.hook_pattern,
        hookType: content.hook_type,
        coverText: shorten(content.short_cover_text, 140),
        hasCoverAsset: Boolean(content.short_cover_asset_path),
        analyticsReady: isAnalyticsReady(youtubePublished) || isAnalyticsReady(facebookPublished),
        retentionReady: youtubeSnapshot?.retention_pct != null,
      };
    });

    const publishedYoutubeRows = audits.filter((row) => row.youtubePublished);
    const publishedFacebookRows = audits.filter((row) => row.facebookPublished);
    const completePairs = audits.filter((row) => row.completePublishedPair);
    const incompletePairs = audits.filter((row) => !row.completePublishedPair);
    const facebookPhotoLaneRows = audits.filter((row) => row.facebookPhotoPublished);

    const selectedPublishedRows = publishedResult.rows.filter((row) =>
      (args.includeYoutube && row.platform === "youtube") ||
      (args.includeFacebook && row.platform === "facebook"),
    );
    const analyticsCoverageCount = selectedPublishedRows.filter((row) => row.latest_fetched_at != null).length;
    const retentionCoverageCount = publishedYoutubeRows.filter((row) => row.youtubeSnapshot?.retention_pct != null).length;

    const formatRows: Array<{
      formatType: string;
      count: number;
      avgViews: number | null;
      medianViews: number | null;
      avgRetention: number | null;
      notes: string;
    }> = [];

    for (const formatType of ["tts_short", "legacy_quote_short"] as const) {
      const rows = publishedYoutubeRows.filter((row) => row.formatType === formatType);
      const views = rows.map((row) => row.youtubeViews).filter((value): value is number => value != null);
      const retentions = rows.map((row) => row.youtubeRetention).filter((value): value is number => value != null);
      const fbCount = audits.filter((row) => row.formatType === formatType && row.facebookPublished).length;
      const pairCount = audits.filter((row) => row.formatType === formatType && row.completePublishedPair).length;
      formatRows.push({
        formatType,
        count: rows.length,
        avgViews: avg(views),
        medianViews: median(views),
        avgRetention: avg(retentions),
        notes: `youtube_rows=${rows.length}, facebook_rows=${fbCount}, complete_pairs=${pairCount}, ${percentileNote(rows.length, retentions.length)}`,
      });
    }

    if (args.includeFacebook) {
      const photoViews = facebookPhotoLaneRows
        .map((row) => row.facebookPhotoPublished ? getViews(row.facebookPhotoPublished, null) : null)
        .filter((value): value is number => value != null);
      formatRows.push({
        formatType: "facebook_quote_photo",
        count: facebookPhotoLaneRows.length,
        avgViews: avg(photoViews),
        medianViews: median(photoViews),
        avgRetention: null,
        notes: "separate facebook photo/image-caption lane; not mixed with legacy_quote_short",
      });
    }

    const familyMap = new Map<string, ShortContentAudit[]>();
    for (const row of publishedYoutubeRows) {
      pushGroup(familyMap, row.topicFamily ?? "(unclassified)", row);
    }
    const familyRows = Array.from(familyMap.entries())
      .map(([topicFamily, rows]) => {
        const views = rows.map((row) => row.youtubeViews).filter((value): value is number => value != null);
        const retentions = rows.map((row) => row.youtubeRetention).filter((value): value is number => value != null);
        const best = [...rows]
          .filter((row) => row.youtubeViews != null)
          .sort((left, right) => (right.youtubeViews ?? 0) - (left.youtubeViews ?? 0))[0] ?? null;
        const notes = [
          `published_youtube=${rows.length}`,
          percentileNote(rows.length, retentions.length),
        ].join(", ");
        return {
          topicFamily,
          count: rows.length,
          avgViews: avg(views),
          avgRetention: avg(retentions),
          bestExample: best ? `${best.title} (${best.contentId.slice(0, 8)})` : "-",
          notes,
        };
      })
      .sort((left, right) => (right.avgViews ?? -1) - (left.avgViews ?? -1));

    const hookSourceCounts = new Map<string, number>();
    const hookTypeMap = new Map<string, ShortContentAudit[]>();
    for (const row of audits) {
      hookSourceCounts.set(row.hookSource, (hookSourceCounts.get(row.hookSource) ?? 0) + 1);
      pushGroup(hookTypeMap, row.hookType ?? row.hookPattern ?? "untracked", row);
    }
    const hookPerformance = Array.from(hookTypeMap.entries())
      .map(([hookKey, rows]) => {
        const youtubeRows = rows.filter((row) => row.youtubeViews != null);
        const views = youtubeRows.map((row) => row.youtubeViews ?? 0);
        return {
          hookKey,
          count: youtubeRows.length,
          avgViews: avg(views),
        };
      })
      .filter((row) => row.count >= 2 && row.avgViews != null)
      .sort((left, right) => (right.avgViews ?? 0) - (left.avgViews ?? 0));

    const coverTextCount = audits.filter((row) => row.coverText != null).length;
    const hookTrackedCount = audits.filter((row) => row.hookType != null || row.hookPattern != null || row.hookText != null).length;
    const coverAssetGapCount = audits.filter((row) => row.coverText != null && !row.hasCoverAsset).length;
    const missingCoverMetadataCount = audits.filter((row) => row.coverText == null && !row.hasCoverAsset).length;

    const enoughDataRows = publishedYoutubeRows.filter((row) => isEnoughData(row.youtubePublished, row.youtubeSnapshot, now));
    const winners = [...enoughDataRows]
      .sort((left, right) => (right.youtubeViews ?? 0) - (left.youtubeViews ?? 0))
      .slice(0, 10)
      .map<WinnerRow>((row) => ({
        contentId: row.contentId,
        title: row.title,
        formatType: row.formatType,
        platform: "youtube",
        views: row.youtubeViews ?? 0,
        retention: row.youtubeRetention,
        hookCover: `${row.hookType ?? row.hookPattern ?? row.hookSource} / cover=${row.coverText ? "yes" : "no"}`,
      }));
    const losers = [...enoughDataRows]
      .sort((left, right) => (left.youtubeViews ?? 0) - (right.youtubeViews ?? 0))
      .slice(0, 10)
      .map<WinnerRow>((row) => ({
        contentId: row.contentId,
        title: row.title,
        formatType: row.formatType,
        platform: "youtube",
        views: row.youtubeViews ?? 0,
        retention: row.youtubeRetention,
        hookCover: `${row.hookType ?? row.hookPattern ?? row.hookSource} / cover=${row.coverText ? "yes" : "no"}`,
      }));

    const incompleteReasons = new Map<string, number>();
    for (const row of incompletePairs) {
      const key = row.excludedIncompleteReason ?? "unknown";
      incompleteReasons.set(key, (incompleteReasons.get(key) ?? 0) + 1);
    }

    const mainFamilies = familyRows.filter((row) => row.count >= 3);
    const sufficiency = {
      published100: publishedYoutubeRows.length >= 100,
      retention70: retentionCoverageCount >= 70,
      fivePerMainFamily: mainFamilies.length > 0 && mainFamilies.every((row) => row.count >= 5),
      coverHook30: audits.filter((row) => row.coverText != null && (row.hookType != null || row.hookPattern != null || row.hookText != null)).length >= 30,
    };
    const automatedFeedbackAllowed =
      sufficiency.published100 &&
      sufficiency.retention70 &&
      sufficiency.fivePerMainFamily &&
      sufficiency.coverHook30 &&
      publishedYoutubeRows.length >= 300 &&
      retentionCoverageCount >= 200;

    const recommendedExperiments = [
      "Short Cover Asset Generator: prioritize rows missing cover text/asset before trying cover experiments at scale.",
      "Hook Tracking: keep measuring by hook_type/hook_pattern first; sample is still too small for automated loop decisions.",
      "Topic Family Analytics: focus on families with at least 5 published YouTube shorts before acting on relative winners/losers.",
      "Publish more content and collect retention data: do not enable automated AI feedback until sample thresholds are met.",
    ];

    const payload = {
      window: {
        from: args.from,
        to: args.to,
        limit: args.limit,
        includeYoutube: args.includeYoutube,
        includeFacebook: args.includeFacebook,
      },
      inventory: {
        totalContentRows: contentRows.length,
        totalShortScopeRows: shortContents.length,
        ttsShortRows: shortContents.filter((row) => row.format_type === "tts_short").length,
        legacyQuoteShortRows: shortContents.filter((row) => row.format_type === "legacy_quote_short").length,
        publishedYoutubeShorts: publishedYoutubeRows.length,
        publishedFacebookReels: publishedFacebookRows.length,
        missingPlatformRows: incompletePairs.length,
        publishedButNoAnalytics: selectedPublishedRows.length - analyticsCoverageCount,
        analyticsAvailable: analyticsCoverageCount,
        retentionAvailable: retentionCoverageCount,
        completePlatformPairs: completePairs.length,
        incompletePlatformPairsExcluded: incompletePairs.length,
        incompleteReasons: Object.fromEntries(incompleteReasons.entries()),
      },
      performanceByFormat: formatRows,
      topicFamilyFindings: familyRows,
      hookCoverFindings: {
        rowsWithCoverText: coverTextCount,
        rowsWithHookTracking: hookTrackedCount,
        hookSourceCounts: Object.fromEntries(hookSourceCounts.entries()),
        bestHookPatterns: hookPerformance.slice(0, 5),
        weakHookPatterns: [...hookPerformance].reverse().slice(0, 5),
        coverAssetGaps: {
          coverTextWithoutAsset: coverAssetGapCount,
          missingCoverMetadata: missingCoverMetadataCount,
        },
      },
      winners,
      losers,
      sufficiency: {
        published100: sufficiency.published100,
        retention70: sufficiency.retention70,
        fivePerMainFamily: sufficiency.fivePerMainFamily,
        coverHook30: sufficiency.coverHook30,
        automatedFeedbackAllowed,
      },
      recommendations: recommendedExperiments,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## phat_phap Short Analytics Audit");
    console.log(`- Date range: ${args.from ?? "(all)"} -> ${args.to ?? "(all)"}`);
    console.log(`- Total content rows: ${payload.inventory.totalContentRows}`);
    console.log(`- Published YouTube Shorts: ${payload.inventory.publishedYoutubeShorts}`);
    console.log(`- Published Facebook Reels: ${payload.inventory.publishedFacebookReels}`);
    console.log(`- Analytics coverage: ${payload.inventory.analyticsAvailable}/${selectedPublishedRows.length}`);
    console.log(`- Retention coverage: ${payload.inventory.retentionAvailable}/${payload.inventory.publishedYoutubeShorts}`);
    console.log(`- Complete platform pairs: ${payload.inventory.completePlatformPairs}`);
    console.log(`- Incomplete platform pairs excluded: ${payload.inventory.incompletePlatformPairsExcluded}`);

    console.log("\n## Performance by Format");
    console.log(table([
      ["format_type", "count", "avg_views", "median_views", "avg_retention", "notes"],
      ["---", "---:", "---:", "---:", "---:", "---"],
      ...formatRows.map((row) => [
        row.formatType,
        String(row.count),
        formatMetric(row.avgViews, 0),
        formatMetric(row.medianViews, 0),
        formatMetric(row.avgRetention, 1),
        row.notes,
      ]),
    ]));

    console.log("\n## Topic Family Findings");
    console.log(table([
      ["topic_family", "count", "avg_views", "avg_retention", "best_example", "notes"],
      ["---", "---:", "---:", "---:", "---", "---"],
      ...familyRows.slice(0, 12).map((row) => [
        row.topicFamily,
        String(row.count),
        formatMetric(row.avgViews, 0),
        formatMetric(row.avgRetention, 1),
        row.bestExample,
        row.notes,
      ]),
    ]));

    console.log("\n## Hook/Cover Findings");
    console.log(`- Rows with coverText: ${coverTextCount}`);
    console.log(`- Rows with hook tracking: ${hookTrackedCount}`);
    console.log(`- Best hook patterns: ${hookPerformance.slice(0, 5).map((row) => `${row.hookKey} (${row.count} rows, avg ${formatMetric(row.avgViews, 0)} views)`).join("; ") || "-"}`);
    console.log(`- Weak hook patterns: ${[...hookPerformance].reverse().slice(0, 5).map((row) => `${row.hookKey} (${row.count} rows, avg ${formatMetric(row.avgViews, 0)} views)`).join("; ") || "-"}`);
    console.log(`- Cover asset gaps: coverText_without_asset=${coverAssetGapCount}, missing_cover_metadata=${missingCoverMetadataCount}`);

    console.log("\n## Top Winners");
    console.log(table([
      ["content_id", "title", "format_type", "platform", "views", "retention", "hook/cover"],
      ["---", "---", "---", "---", "---:", "---:", "---"],
      ...winners.map((row) => [
        row.contentId,
        shorten(row.title, 64) ?? row.contentId,
        row.formatType,
        row.platform,
        String(row.views),
        formatMetric(row.retention, 1),
        shorten(row.hookCover, 80) ?? "-",
      ]),
    ]));

    console.log("\n## Bottom 10 Shorts With Enough Data");
    console.log(table([
      ["content_id", "title", "format_type", "platform", "views", "retention", "hook/cover"],
      ["---", "---", "---", "---", "---:", "---:", "---"],
      ...losers.map((row) => [
        row.contentId,
        shorten(row.title, 64) ?? row.contentId,
        row.formatType,
        row.platform,
        String(row.views),
        formatMetric(row.retention, 1),
        shorten(row.hookCover, 80) ?? "-",
      ]),
    ]));

    console.log("\n## Data Sufficiency");
    console.log(`- 100 published videos: ${sufficiency.published100 ? "yes" : "no"}`);
    console.log(`- 70 with retention: ${sufficiency.retention70 ? "yes" : "no"}`);
    console.log(`- 5 per main topic family: ${sufficiency.fivePerMainFamily ? "yes" : "no"} (main family = >=3 published YouTube shorts in this window)`);
    console.log(`- 30 with coverText + hook tracking: ${sufficiency.coverHook30 ? "yes" : "no"}`);
    console.log(`- Automated feedback allowed: ${automatedFeedbackAllowed ? "yes" : "no"}`);

    console.log("\n## Recommended Next Experiments");
    console.log("Prioritize:");
    for (const [index, recommendation] of recommendedExperiments.entries()) {
      console.log(`${index + 1}. ${recommendation}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
