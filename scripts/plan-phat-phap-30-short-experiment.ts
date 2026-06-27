import "dotenv/config";

import pg from "pg";

const { Pool } = pg;

// Mirrors src/lib/auto-refill-watcher.ts envInt("AUTO_REFILL_LOW_WATERMARK", 45) — read, not redefined.
const LOW_WATERMARK = Number(process.env.AUTO_REFILL_LOW_WATERMARK ?? "45");
const POSTING_WINDOW_START_HOUR_VN = 6;
const POSTING_WINDOW_END_HOUR_VN = 22;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MIN_QUOTE_CANDIDATES_FOR_PRIMARY_SPLIT = 6;

type Args = {
  start: string | null;
  slots: number;
  json: boolean;
  preferQuote: boolean;
  ttsOnly: boolean;
};

type TopicFamily =
  | "tri_tue_song_im_lang_nhan_nhin"
  | "nhan_qua_nguoi_xau_bao_ung"
  | "buong_bo_chua_lanh"
  | "binh_yen_an_lac";

type FormatType = "tts_short" | "legacy_quote_short";

type PlannedItem = {
  slot: number;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  formatType: FormatType;
  topicFamily: TopicFamily;
  hookPattern: string;
  selectedHookPlaceholder: string;
  coverTextRequired: true;
  coverAssetAtPublishExpected: "yes_if_source_image_exists" | "excluded_pending_generation";
  requiredPlatforms: string[];
  reason: string;
};

function parseArgs(argv: string[]): Args {
  let start: string | null = null;
  let slots = 30;
  let json = false;
  let preferQuote = false;
  let ttsOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--start") {
      start = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--slots") {
      const parsed = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--slots must be positive");
      slots = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--prefer-quote") {
      preferQuote = true;
      continue;
    }
    if (arg === "--tts-only") {
      ttsOnly = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { start, slots, json, preferQuote, ttsOnly };
}

function formatVn(date: Date): string {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = vn.getUTCFullYear();
  return `${hh}:00 ${dd}/${mm}/${yyyy}`;
}

function nextHourBoundary(date: Date): Date {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  result.setUTCHours(result.getUTCHours() + 1);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── 1. Queue health ────────────────────────────────────────────────────
    const pendingResult = await pool.query<{ count: string }>(
      `
        select count(*) as count
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where sc.channel_key = 'phat_phap'
          and uq.status in ('queued', 'uploading')
      `,
    );
    const pendingCount = Number(pendingResult.rows[0]?.count ?? "0");
    const queueBelowWatermark = pendingCount < LOW_WATERMARK;

    // ── 2. Quote readiness (approximate candidate pool; cross-validate with
    //      scripts/reconcile-phat-phap-quote-readiness.ts for the authoritative view) ──
    const quoteCandidatesResult = await pool.query<{ count: string }>(
      `
        select count(*) as count
        from content_generations cg
        where cg.channel_key = 'phat_phap'
          and cg.format_type = 'legacy_quote_short'
          and cg.video_status = 'done'
          and not exists (
            select 1 from upload_queue uq where uq.content_id = cg.id
          )
      `,
    );
    const readyQuoteCandidates = Number(quoteCandidatesResult.rows[0]?.count ?? "0");

    const ttsCandidatesResult = await pool.query<{ count: string }>(
      `
        select count(*) as count
        from content_generations cg
        where cg.channel_key = 'phat_phap'
          and cg.format_type = 'tts_short'
          and cg.video_status = 'done'
          and not exists (
            select 1 from upload_queue uq where uq.content_id = cg.id
          )
      `,
    );
    const readyTtsCandidates = Number(ttsCandidatesResult.rows[0]?.count ?? "0");

    // ── 3. Cover pipeline readiness ─────────────────────────────────────────
    const coverResult = await pool.query<{ total: string; with_cover_text: string; with_asset: string }>(
      `
        select
          count(*) as total,
          count(*) filter (where short_cover_text is not null and btrim(short_cover_text) <> '') as with_cover_text,
          count(*) filter (where short_cover_asset_path is not null) as with_asset
        from content_generations
        where channel_key = 'phat_phap'
          and format_type in ('tts_short', 'legacy_quote_short')
      `,
    );
    const coverRow = coverResult.rows[0];
    const coverPipelineReady = coverRow != null;

    // ── 4. Decide format split ──────────────────────────────────────────────
    let formatSplit: { tts: number; quote: number };
    let splitReason: string;
    if (args.ttsOnly) {
      formatSplit = { tts: args.slots, quote: 0 };
      splitReason = "forced via --tts-only";
    } else if (args.preferQuote) {
      const quoteTarget = Math.round(args.slots * 0.4);
      formatSplit = { tts: args.slots - quoteTarget, quote: quoteTarget };
      splitReason = `forced via --prefer-quote despite readyQuoteCandidates=${readyQuoteCandidates} (override, higher risk)`;
    } else if (readyQuoteCandidates >= MIN_QUOTE_CANDIDATES_FOR_PRIMARY_SPLIT && queueBelowWatermark) {
      const quoteTarget = Math.round(args.slots * 0.4);
      formatSplit = { tts: args.slots - quoteTarget, quote: quoteTarget };
      splitReason = `primary split — readyQuoteCandidates=${readyQuoteCandidates} >= ${MIN_QUOTE_CANDIDATES_FOR_PRIMARY_SPLIT} and queue below watermark (${pendingCount}<${LOW_WATERMARK})`;
    } else if (readyQuoteCandidates > 0) {
      const quoteTarget = Math.min(Math.round(args.slots * 0.2), readyQuoteCandidates);
      formatSplit = { tts: args.slots - quoteTarget, quote: quoteTarget };
      splitReason = `fallback split — readyQuoteCandidates=${readyQuoteCandidates} below safe primary threshold (${MIN_QUOTE_CANDIDATES_FOR_PRIMARY_SPLIT}) or queue at/above watermark (${pendingCount}>=${LOW_WATERMARK})`;
    } else {
      formatSplit = { tts: args.slots, quote: 0 };
      splitReason = `all-tts fallback — readyQuoteCandidates=0 (blocked pool per reconcile-phat-phap-quote-readiness.ts)`;
    }

    // ── 5. Find clean future slots (read-only scan, no inserts) ────────────
    const now = new Date();
    const startSearch = args.start ? new Date(args.start) : nextHourBoundary(now);
    if (Number.isNaN(startSearch.getTime())) throw new Error("--start is not a valid ISO datetime");
    const horizon = new Date(startSearch.getTime() + 21 * 24 * 60 * 60 * 1000);

    const occupiedResult = await pool.query<{ scheduled_at: string }>(
      `
        select distinct uq.scheduled_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where sc.channel_key = 'phat_phap'
          and uq.status in ('queued', 'uploading', 'done')
          and uq.scheduled_at >= $1::timestamptz
          and uq.scheduled_at < $2::timestamptz
      `,
      [startSearch.toISOString(), horizon.toISOString()],
    );
    const occupiedSlots = new Set(occupiedResult.rows.map((r) => new Date(r.scheduled_at).toISOString()));

    const freeSlots: Date[] = [];
    const cursor = new Date(startSearch);
    while (freeSlots.length < args.slots && cursor < horizon) {
      const vnHour = new Date(cursor.getTime() + VN_OFFSET_MS).getUTCHours();
      if (vnHour >= POSTING_WINDOW_START_HOUR_VN && vnHour <= POSTING_WINDOW_END_HOUR_VN) {
        if (!occupiedSlots.has(cursor.toISOString())) {
          freeSlots.push(new Date(cursor));
        }
      }
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }

    const slotsWithinRequestedWindow = freeSlots.length >= args.slots;

    // ── 6. Build deterministic assignment matrix ────────────────────────────
    const topicCycle: TopicFamily[] = [
      "tri_tue_song_im_lang_nhan_nhin",
      "tri_tue_song_im_lang_nhan_nhin",
      "nhan_qua_nguoi_xau_bao_ung",
      "buong_bo_chua_lanh",
      "tri_tue_song_im_lang_nhan_nhin",
      "nhan_qua_nguoi_xau_bao_ung",
      "tri_tue_song_im_lang_nhan_nhin",
      "nhan_qua_nguoi_xau_bao_ung",
      "buong_bo_chua_lanh",
      "binh_yen_an_lac",
    ];
    const ttsHookCycle = ["tiếc_nuối", "đời_thường", "nhận_diện"];

    // Build a format sequence of exactly formatSplit.tts tts_short + formatSplit.quote
    // legacy_quote_short, interleaved roughly evenly (not clustered at the end).
    const formatSequence: FormatType[] = [];
    {
      let ttsRemaining = formatSplit.tts;
      let quoteRemaining = formatSplit.quote;
      for (let i = 0; i < args.slots; i += 1) {
        const takeQuote =
          quoteRemaining > 0 &&
          (ttsRemaining === 0 || quoteRemaining / (quoteRemaining + ttsRemaining) > 0.4 - i * 0.001);
        if (takeQuote && quoteRemaining > 0) {
          formatSequence.push("legacy_quote_short");
          quoteRemaining -= 1;
        } else if (ttsRemaining > 0) {
          formatSequence.push("tts_short");
          ttsRemaining -= 1;
        } else {
          formatSequence.push("legacy_quote_short");
          quoteRemaining -= 1;
        }
      }
    }

    const planned: PlannedItem[] = [];
    let ttsHookCursor = 0;
    for (let i = 0; i < args.slots; i += 1) {
      const slotDate = freeSlots[i] ?? null;
      const formatType = formatSequence[i];
      const topicFamily = topicCycle[i % topicCycle.length];
      const hookPattern = formatType === "legacy_quote_short" ? "other" : ttsHookCycle[ttsHookCursor % ttsHookCycle.length];
      if (formatType === "tts_short") ttsHookCursor += 1;

      planned.push({
        slot: i + 1,
        scheduledAtUtc: slotDate ? slotDate.toISOString() : "TBD_beyond_scanned_horizon",
        scheduledAtVn: slotDate ? formatVn(slotDate) : "TBD_beyond_scanned_horizon",
        formatType,
        topicFamily,
        hookPattern,
        selectedHookPlaceholder: `<to be generated at content-creation time, hook_pattern=${hookPattern}>`,
        coverTextRequired: true,
        coverAssetAtPublishExpected: "excluded_pending_generation",
        requiredPlatforms: ["youtube_short", "facebook_reel"],
        reason:
          formatType === "legacy_quote_short"
            ? `quote slot (${splitReason})`
            : `tts slot, topic=${topicFamily}, hook=${hookPattern}`,
      });
    }

    const payload = {
      meta: { start: args.start, slots: args.slots, preferQuote: args.preferQuote, ttsOnly: args.ttsOnly },
      queueHealth: {
        pendingCount,
        lowWaterMark: LOW_WATERMARK,
        queueBelowWatermark,
      },
      quoteReadiness: {
        readyQuoteCandidates,
        readyTtsCandidates,
        note: "approximate; cross-validate with scripts/reconcile-phat-phap-quote-readiness.ts for authoritative candidate-pool reasoning",
      },
      coverPipeline: {
        ready: coverPipelineReady,
        totalRows: coverRow ? Number(coverRow.total) : 0,
        withCoverText: coverRow ? Number(coverRow.with_cover_text) : 0,
        withAsset: coverRow ? Number(coverRow.with_asset) : 0,
      },
      formatSplit: { ...formatSplit, reason: splitReason },
      slotScan: {
        freeSlotsFound: freeSlots.length,
        slotsRequested: args.slots,
        slotsWithinRequestedWindow,
        horizonScannedTo: horizon.toISOString(),
      },
      planned,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## 30-Short Experiment Plan (read-only, no DB writes)");
    console.log(`- Pending queue: ${pendingCount} (low watermark: ${LOW_WATERMARK}, below=${queueBelowWatermark})`);
    console.log(`- Ready quote candidates (approx): ${readyQuoteCandidates}`);
    console.log(`- Ready tts candidates (approx): ${readyTtsCandidates}`);
    console.log(`- Cover pipeline: ${coverRow ? `${coverRow.with_cover_text}/${coverRow.total} coverText, ${coverRow.with_asset}/${coverRow.total} asset` : "unavailable"}`);
    console.log(`- Format split: ${formatSplit.tts} tts_short / ${formatSplit.quote} legacy_quote_short — ${splitReason}`);
    console.log(`- Free slots found: ${freeSlots.length}/${args.slots} within scan horizon (${horizon.toISOString()})`);
    console.log("\n| slot | scheduled_at_vn | format_type | topic_family | hook_pattern | cover_required | platforms | reason |");
    console.log("|---:|---|---|---|---|---|---|---|");
    for (const item of planned) {
      console.log(
        `| ${item.slot} | ${item.scheduledAtVn} | ${item.formatType} | ${item.topicFamily} | ${item.hookPattern} | yes | ${item.requiredPlatforms.join("+")} | ${item.reason} |`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
