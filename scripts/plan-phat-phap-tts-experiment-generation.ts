import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { STRATEGIC_TOPIC_FAMILIES, type StrategicTopicFamilyId } from "@/lib/config/topic-family-registry";
import { inferHookPattern } from "@/lib/hook-engine";
import { generateShortCover } from "@/lib/short-cover-engine";

const { Pool } = pg;

const SUPPORTED_TOPIC_FAMILIES = new Set(STRATEGIC_TOPIC_FAMILIES.map((f) => f.id));

// Registry angles sometimes carry trigger wording for a hook_pattern category other than
// the one we're targeting (e.g. "báo ứng đến muộn" contains "muộn", a tiếc_nuối trigger,
// even when the target pattern is nhận_diện). inferHookPattern() checks tiếc_nuối before
// nhận_diện, so any survivng "muộn"/"tiếc"/etc. wins regardless of template wording.
// This sanitizer neutralizes off-target trigger words with neutral synonyms before the
// angle is embedded, without touching inferHookPattern() itself.
const HOOK_TRIGGER_OWNERS: Array<{ pattern: RegExp; replacement: string; owner: string }> = [
  { pattern: /\bkhông phải\b/gi, replacement: "không hề", owner: "sự_thật" },
  { pattern: /\bthật ra\b/gi, replacement: "vốn dĩ", owner: "sự_thật" },
  { pattern: /\bthực ra\b/gi, replacement: "vốn dĩ", owner: "sự_thật" },
  { pattern: /\bsự thật\b/gi, replacement: "điều thật", owner: "sự_thật" },
  { pattern: /\bít ai\b/gi, replacement: "hiếm khi", owner: "sự_thật" },
  { pattern: /\btiếc\b/gi, replacement: "buồn", owner: "tiếc_nuối" },
  { pattern: /\bmuộn\b/gi, replacement: "trễ", owner: "tiếc_nuối" },
  { pattern: /\blỡ\b/gi, replacement: "quên", owner: "tiếc_nuối" },
  { pattern: /\bbỏ lỡ\b/gi, replacement: "để trôi qua", owner: "tiếc_nuối" },
  { pattern: /\bkhông kịp\b/gi, replacement: "không còn dịp", owner: "tiếc_nuối" },
  { pattern: /\bđã qua\b/gi, replacement: "đã trôi", owner: "tiếc_nuối" },
  { pattern: /\bquý vị\b/gi, replacement: "mỗi người", owner: "nhận_diện" },
  { pattern: /\bbạn\b/gi, replacement: "người khác", owner: "nhận_diện" },
  { pattern: /\bnhiều người\b/gi, replacement: "không ít người", owner: "nhận_diện" },
  { pattern: /\bai cũng\b/gi, replacement: "hầu như ai", owner: "nhận_diện" },
  { pattern: /\bngười ta\b/gi, replacement: "thiên hạ", owner: "nhận_diện" },
  { pattern: /\bnhững ai\b/gi, replacement: "số người", owner: "nhận_diện" },
  { pattern: /\bmọi người\b/gi, replacement: "tất cả", owner: "nhận_diện" },
  { pattern: /\bchúng ta\b/gi, replacement: "loài người", owner: "nhận_diện" },
  { pattern: /\bcó người\b/gi, replacement: "một số", owner: "nhận_diện" },
];

function sanitizeAngleForPattern(angle: string, targetPattern: string): string {
  let result = angle;
  for (const rule of HOOK_TRIGGER_OWNERS) {
    if (rule.owner === targetPattern) continue;
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

// Deterministic placeholder hook templates, chosen so inferHookPattern() (the real
// classifier) actually resolves to the target pattern. No external AI involved.
// đời_thường avoids bạn/nhận ra/tiếc/muộn-style wording entirely (it is the lowest-
// priority fallback, so it must not contain ANY higher-priority trigger).
// nhận_diện explicitly includes "nhiều người" so it lands on nhận_diện rather than
// falling through to đời_thường.
const HOOK_TEMPLATES_BY_PATTERN: Record<string, ((angle: string) => string) | undefined> = {
  "tiếc_nuối": (angle) => `Nhiều người tiếc nuối vì đã quá muộn để hiểu ${angle}.`,
  "đời_thường": (angle) => `Một ngày bình thường, câu chuyện về ${angle} lặng lẽ hiện lên trong tâm trí.`,
  "nhận_diện": (angle) => `Dấu hiệu của ${angle} thường xuất hiện rất lặng lẽ mà nhiều người không để ý.`,
};

type Args = {
  planJsonPath: string | null;
  start: string | null;
  slots: number;
  json: boolean;
};

type PlannedSourceItem = {
  slot: number;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  formatType: string;
  topicFamily: string;
  hookPattern: string;
  requiredPlatforms: string[];
};

type ChecklistItem = {
  slot: number;
  channelKey: "phat_phap";
  formatType: string;
  topicFamily: string;
  hookPattern: string;
  titleSeed: string;
  proposedSelectedHook: string;
  proposedShortCoverText: string;
  coverAssetRequiredBeforePublish: true;
  platformPairRequired: true;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  generationStatus: "ready" | "blocked";
  blockers: string[];
};

function parseArgs(argv: string[]): Args {
  let planJsonPath: string | null = null;
  let start: string | null = null;
  let slots = 30;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan-json") {
      planJsonPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
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
    if (arg === "--dry-run") {
      continue; // default and only mode; accepted for explicitness
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { planJsonPath, start, slots, json };
}

function loadPlannedItems(args: Args): PlannedSourceItem[] {
  if (args.planJsonPath) {
    const raw = fs.readFileSync(path.resolve(args.planJsonPath), "utf8");
    const parsed = JSON.parse(raw) as { planned: PlannedSourceItem[] };
    return parsed.planned;
  }

  const scriptPath = path.join(process.cwd(), "scripts", "plan-phat-phap-30-short-experiment.ts");
  const tsxBin = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const cliArgs = [
    "--env-file=.env.local",
    tsxBin,
    "--tsconfig",
    "tsconfig.json",
    scriptPath,
    "--slots",
    String(args.slots),
    "--tts-only",
    "--json",
  ];
  if (args.start) {
    cliArgs.push("--start", args.start);
  }
  const stdout = execFileSync(process.execPath, cliArgs, { cwd: process.cwd(), encoding: "utf8" });
  const parsed = JSON.parse(stdout) as { planned: PlannedSourceItem[] };
  return parsed.planned;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const plannedItems = loadPlannedItems(args).slice(0, args.slots);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Live collision re-check: state may have changed since the source plan was produced.
    const scheduledTimes = plannedItems.map((item) => item.scheduledAtUtc);
    const occupiedResult = scheduledTimes.length
      ? await pool.query<{ scheduled_at: string }>(
          `
            select distinct uq.scheduled_at::text
            from upload_queue uq
            join social_channels sc on sc.id = uq.channel_id
            where sc.channel_key = 'phat_phap'
              and uq.status in ('queued', 'uploading', 'done')
              and uq.scheduled_at = any($1::timestamptz[])
          `,
          [scheduledTimes],
        )
      : { rows: [] as Array<{ scheduled_at: string }> };
    const occupiedSet = new Set(occupiedResult.rows.map((r) => new Date(r.scheduled_at).toISOString()));

    // ADR-034 platform-pair feasibility: confirm active YouTube + Facebook destinations exist.
    const destinationResult = await pool.query<{ platform: string; count: string }>(
      `
        select platform, count(*) as count
        from social_channels
        where channel_key = 'phat_phap' and is_active = true
        group by platform
      `,
    );
    const destinationCounts = new Map(destinationResult.rows.map((r) => [r.platform, Number(r.count)]));
    const hasYoutubeDestination = (destinationCounts.get("youtube") ?? 0) > 0;
    const hasFacebookDestination = (destinationCounts.get("facebook") ?? 0) > 0;

    const checklist: ChecklistItem[] = [];
    let readyCount = 0;
    let blockedCount = 0;

    for (const item of plannedItems) {
      const blockers: string[] = [];

      const slotOccupied = occupiedSet.has(new Date(item.scheduledAtUtc).toISOString());
      if (slotOccupied) blockers.push("slot_collision_with_existing_queue_row");

      if (item.formatType !== "tts_short") blockers.push("format_type_not_tts_short");

      const topicFamilySupported = SUPPORTED_TOPIC_FAMILIES.has(item.topicFamily as StrategicTopicFamilyId);
      if (!topicFamilySupported) blockers.push("unsupported_topic_family");

      const family = STRATEGIC_TOPIC_FAMILIES.find((f) => f.id === item.topicFamily);
      const angle = family ? family.angles[(item.slot - 1) % family.angles.length] : "(unsupported family)";
      const titleSeed = family ? `${family.name}: ${angle}` : `(unsupported topic_family: ${item.topicFamily})`;

      const hookTemplate = HOOK_TEMPLATES_BY_PATTERN[item.hookPattern];
      let proposedSelectedHook = "(no deterministic template for this hook_pattern)";
      let hookPatternSupported = false;
      if (hookTemplate) {
        const safeAngle = sanitizeAngleForPattern(angle, item.hookPattern);
        proposedSelectedHook = hookTemplate(safeAngle);
        const classified = inferHookPattern(proposedSelectedHook);
        hookPatternSupported = classified === item.hookPattern;
        if (!hookPatternSupported) {
          blockers.push(`hook_pattern_classifier_mismatch (template classified as "${classified}")`);
        }
      } else {
        blockers.push("no_deterministic_hook_template_for_pattern");
      }

      let proposedShortCoverText = "(coverText not generated — upstream blocker)";
      if (family && hookTemplate) {
        try {
          const cover = generateShortCover({
            // Use the short angle as the topic (matches real production topic strings,
            // e.g. "Bị phản bội"), not the verbose family-prefixed titleSeed display label.
            topic: angle,
            selectedHook: proposedSelectedHook,
            script: proposedSelectedHook,
            formatType: item.formatType,
            topicFamily: item.topicFamily,
          });
          proposedShortCoverText = cover.coverText;
          if (cover.qualityFlags.length > 0) {
            blockers.push(`coverText_quality_flags: ${cover.qualityFlags.join(", ")}`);
          }
        } catch (err) {
          blockers.push(`coverText_generation_error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (!hasYoutubeDestination) blockers.push("no_active_youtube_destination_for_phat_phap");
      if (!hasFacebookDestination) blockers.push("no_active_facebook_destination_for_phat_phap");

      const status: "ready" | "blocked" = blockers.length === 0 ? "ready" : "blocked";
      if (status === "ready") readyCount += 1;
      else blockedCount += 1;

      checklist.push({
        slot: item.slot,
        channelKey: "phat_phap",
        formatType: item.formatType,
        topicFamily: item.topicFamily,
        hookPattern: item.hookPattern,
        titleSeed,
        proposedSelectedHook,
        proposedShortCoverText,
        coverAssetRequiredBeforePublish: true,
        platformPairRequired: true,
        scheduledAtUtc: item.scheduledAtUtc,
        scheduledAtVn: item.scheduledAtVn,
        generationStatus: status,
        blockers,
      });
    }

    const payload = {
      meta: { planSource: args.planJsonPath ?? "internal_reuse_of_plan-phat-phap-30-short-experiment", start: args.start, slots: args.slots },
      summary: {
        itemsPlanned: checklist.length,
        ready: readyCount,
        blocked: blockedCount,
        startSlotUtc: checklist[0]?.scheduledAtUtc ?? null,
        endSlotUtc: checklist[checklist.length - 1]?.scheduledAtUtc ?? null,
        hasYoutubeDestination,
        hasFacebookDestination,
      },
      checklist,
      safety: {
        dbRowsInserted: 0,
        queueMutated: false,
        imagesGenerated: false,
        ttsGenerated: false,
        videosRendered: false,
        publishTouched: false,
        externalApiCalled: false,
      },
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## TTS Experiment Generation Dry-run (read-only, no DB writes)");
    console.log(`- Plan source: ${payload.meta.planSource}`);
    console.log(`- Items planned: ${payload.summary.itemsPlanned}`);
    console.log(`- Ready: ${payload.summary.ready}`);
    console.log(`- Blocked: ${payload.summary.blocked}`);
    console.log(`- Start slot: ${payload.summary.startSlotUtc}`);
    console.log(`- End slot: ${payload.summary.endSlotUtc}`);
    console.log(`- Active YouTube destination present: ${payload.summary.hasYoutubeDestination}`);
    console.log(`- Active Facebook destination present: ${payload.summary.hasFacebookDestination}`);
    console.log("\n| slot | topic_family | hook_pattern | title_seed | selected_hook | short_cover_text | status | blocker |");
    console.log("|---:|---|---|---|---|---|---|---|");
    for (const item of checklist) {
      console.log(
        `| ${item.slot} | ${item.topicFamily} | ${item.hookPattern} | ${item.titleSeed} | ${item.proposedSelectedHook} | ${item.proposedShortCoverText} | ${item.generationStatus} | ${item.blockers.join("; ") || "-"} |`,
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
