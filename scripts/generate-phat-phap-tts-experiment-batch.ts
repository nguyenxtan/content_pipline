import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { inferHookPattern } from "@/lib/hook-engine";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";
import { runTTS } from "@/lib/pipeline/tts";
import { runImages } from "@/lib/pipeline/images";
import { runShortVideo } from "@/lib/pipeline/short-video";
import { pickFullLaneSafeAnchor, type PhatPhapCampaignLaneOccupancy } from "@/lib/publishing/slot-occupancy";

const { Pool } = pg;

const PHAT_PHAP_NICHE_ID = 13; // niches row for channel_key='phat_phap', content_profile_key='buddhism'
const EXPERIMENT_ID = "phat_phap_30_short_experiment";

type Args = {
  spec: string;
  indices: number[];
  dryRun: boolean;
  apply: boolean;
  skipMedia: boolean;
  json: boolean;
};

type SpecItem = {
  index: number;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  topicFamily: string;
  hookPattern: string;
  titleCandidate: string;
  selectedHook: string;
  shortCoverText: string;
  scriptOutline: { openingTension: string; reflectionBuddhistInsight: string; softTakeaway: string };
  requiredPlatforms: string[];
  formatType: string;
  channelKey: string;
};

type ItemPlan = {
  index: number;
  title: string;
  topicFamily: string;
  hookPattern: string;
  selectedHook: string;
  shortCoverText: string;
  shortContent: string;
  originalScheduledAtUtc: string;
  originalScheduledAtVn: string;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  slotMoved: boolean;
  moveReason: string | null;
  validations: { check: string; pass: boolean; detail: string }[];
  safeToGenerate: boolean;
};

type ItemResult = {
  index: number;
  contentId: string | null;
  title: string;
  topicFamily: string;
  hookPattern: string;
  scheduledAtVn: string;
  videoPath: string | null;
  coverAssetPath: string | null;
  status: "generated_and_queued" | "media_failed_skipped" | "queue_collision_skipped" | "validation_failed_skipped";
  detail: string;
  youtubeQueueId: string | null;
  facebookQueueId: string | null;
};

function parseArgs(argv: string[]): Args {
  let spec = "";
  let indices: number[] = [];
  let dryRun = true;
  let apply = false;
  let skipMedia = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec") {
      spec = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--indices") {
      indices = (argv[i + 1] ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      i += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--apply") {
      apply = true;
      dryRun = false;
    } else if (arg === "--skip-media") {
      skipMedia = true;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!spec) throw new Error("--spec <path> is required");
  if (indices.length === 0) throw new Error("--indices <comma list> is required");
  return { spec, indices, dryRun, apply, skipMedia, json };
}

function isCanonicalShortSlot(iso: string): boolean {
  const d = new Date(iso);
  return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

function formatVn(iso: string): string {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const vn = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const mm = String(vn.getUTCMinutes()).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mo = String(vn.getUTCMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} ${dd}/${mo}/${vn.getUTCFullYear()}`;
}

async function checkSlotCollision(pool: pg.Pool, platform: string, scheduledAtUtc: string): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `
      select count(*) as count
      from upload_queue uq
      join social_channels sc on sc.id = uq.channel_id
      where sc.channel_key = 'phat_phap' and uq.platform = $1 and uq.video_type = 'short'
        and uq.status in ('queued', 'uploading', 'done')
        and uq.scheduled_at = $2::timestamptz
    `,
    [platform, scheduledAtUtc],
  );
  return Number(result.rows[0].count) > 0;
}

async function getExistingShortQueueRows(
  pool: pg.Pool,
  contentId: string,
): Promise<{ youtube: { id: string; scheduledAt: string } | null; facebook: { id: string; scheduledAt: string } | null }> {
  const result = await pool.query<{ id: string; platform: string; scheduled_at: string }>(
    `select id, platform, scheduled_at::text from upload_queue where content_id = $1 and video_type = 'short' and status in ('queued', 'uploading', 'done')`,
    [contentId],
  );
  return {
    youtube: result.rows.find((r) => r.platform === "youtube") ? { id: result.rows.find((r) => r.platform === "youtube")!.id, scheduledAt: result.rows.find((r) => r.platform === "youtube")!.scheduled_at } : null,
    facebook: result.rows.find((r) => r.platform === "facebook") ? { id: result.rows.find((r) => r.platform === "facebook")!.id, scheduledAt: result.rows.find((r) => r.platform === "facebook")!.scheduled_at } : null,
  };
}

// Recomputes a fresh full-lane-safe anchor for a phat_phap tts_short item (YouTube Short +
// Facebook Reel only — no quote/photo sidecar lane) when the spec's original slot is
// occupied. Reuses the same pickFullLaneSafeAnchor picker as the cooldown-sync fix so this
// script and the cron path can never disagree about what counts as collision-free.
// social_channels has multiple duplicate rows per real destination under channel_key
// 'phat_phap' (same platform_channel_id, different ids) — a pre-existing data condition,
// not something this script attempts to clean up. checkSlotCollision (the established
// ground truth for this script) scopes occupancy by channel_key + platform, spanning all
// of those duplicate rows; this must use the exact same scope or it will disagree with
// checkSlotCollision and "recompute" straight back onto an already-occupied slot.
async function computeSafeShortSlot(input: {
  pool: pg.Pool;
  notBefore: Date;
  /** Slots already claimed by other items earlier in this same batch run, not yet in the DB. */
  extraTakenMs?: number[];
}): Promise<{ anchor: Date | null; reason: string | null }> {
  const [ytTakenResult, fbTakenResult] = await Promise.all([
    input.pool.query<{ scheduled_at: string }>(
      `select uq.scheduled_at::text from upload_queue uq join social_channels sc on sc.id = uq.channel_id where sc.channel_key = 'phat_phap' and uq.platform = 'youtube' and uq.video_type = 'short' and uq.status in ('queued', 'uploading', 'done')`,
    ),
    input.pool.query<{ scheduled_at: string }>(
      `select uq.scheduled_at::text from upload_queue uq join social_channels sc on sc.id = uq.channel_id where sc.channel_key = 'phat_phap' and uq.platform = 'facebook' and uq.video_type = 'short' and uq.status in ('queued', 'uploading', 'done')`,
    ),
  ]);

  const extra = input.extraTakenMs ?? [];
  const lanes: PhatPhapCampaignLaneOccupancy[] = [
    { videoType: "short", takenMs: [...ytTakenResult.rows.map((r) => new Date(r.scheduled_at).getTime()), ...extra] },
    { videoType: "short", takenMs: [...fbTakenResult.rows.map((r) => new Date(r.scheduled_at).getTime()), ...extra] },
  ];

  return pickFullLaneSafeAnchor({
    notBefore: input.notBefore,
    windowStart: "06:00",
    windowEnd: "22:00",
    intervalMin: 60,
    lanes,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const specPath = path.isAbsolute(args.spec) ? args.spec : path.join(process.cwd(), args.spec);
  const specRaw = JSON.parse(fs.readFileSync(specPath, "utf8")) as { spec: SpecItem[] };
  const allItems = specRaw.spec;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const destResult = await pool.query<{ id: number; platform: string }>(
      `select id, platform from social_channels where channel_key = 'phat_phap' and platform in ('youtube','facebook') and is_active = true`,
    );
    const youtubeChannelId = destResult.rows.find((r) => r.platform === "youtube")?.id ?? null;
    const facebookChannelId = destResult.rows.find((r) => r.platform === "facebook")?.id ?? null;

    const plans: ItemPlan[] = [];
    const claimedInRun: number[] = [];
    for (const index of args.indices) {
      const item = allItems.find((s) => s.index === index);
      const validations: ItemPlan["validations"] = [];

      if (!item) {
        plans.push({
          index, title: "(not found)", topicFamily: "-", hookPattern: "-", selectedHook: "-", shortCoverText: "-",
          shortContent: "-", originalScheduledAtUtc: "-", originalScheduledAtVn: "-", scheduledAtUtc: "-", scheduledAtVn: "-",
          slotMoved: false, moveReason: null,
          validations: [{ check: "index_exists", pass: false, detail: `index ${index} not found in spec` }],
          safeToGenerate: false,
        });
        continue;
      }

      validations.push({ check: "index_exists", pass: true, detail: "found in spec" });
      validations.push({
        check: "format_type_tts_short",
        pass: item.formatType === "tts_short",
        detail: item.formatType,
      });

      const classified = inferHookPattern(item.selectedHook);
      validations.push({
        check: "hook_classifier_matches",
        pass: classified === item.hookPattern,
        detail: `classifier=${classified}, expected=${item.hookPattern}`,
      });

      validations.push({
        check: "cover_text_present",
        pass: Boolean(item.shortCoverText?.trim()),
        detail: item.shortCoverText || "(empty)",
      });

      validations.push({ check: "youtube_destination_active", pass: youtubeChannelId != null, detail: String(youtubeChannelId) });
      validations.push({ check: "facebook_destination_active", pass: facebookChannelId != null, detail: String(facebookChannelId) });

      let finalScheduledAtUtc = item.scheduledAtUtc;
      let finalScheduledAtVn = item.scheduledAtVn;
      let slotMoved = false;
      let moveReason: string | null = null;

      if (youtubeChannelId && facebookChannelId) {
        const ytCollision = await checkSlotCollision(pool, "youtube", item.scheduledAtUtc);
        const fbCollision = await checkSlotCollision(pool, "facebook", item.scheduledAtUtc);
        const claimedBySiblingInBatch = claimedInRun.includes(new Date(item.scheduledAtUtc).getTime());

        if (!ytCollision && !fbCollision && !claimedBySiblingInBatch) {
          validations.push({ check: "slot_available", pass: true, detail: `spec slot free: ${item.scheduledAtVn}` });
          claimedInRun.push(new Date(item.scheduledAtUtc).getTime());
        } else {
          const { anchor, reason } = await computeSafeShortSlot({
            pool,
            notBefore: new Date(Math.max(new Date(item.scheduledAtUtc).getTime(), Date.now())),
            extraTakenMs: claimedInRun,
          });
          if (anchor) {
            finalScheduledAtUtc = anchor.toISOString();
            finalScheduledAtVn = formatVn(anchor.toISOString());
            slotMoved = true;
            moveReason = `spec slot occupied (yt=${ytCollision}, fb=${fbCollision}, claimed_in_batch=${claimedBySiblingInBatch}); moved ${item.scheduledAtVn} -> ${finalScheduledAtVn}`;
            validations.push({ check: "slot_available", pass: true, detail: moveReason });
            claimedInRun.push(anchor.getTime());
          } else {
            validations.push({ check: "slot_available", pass: false, detail: `spec slot occupied and ${reason}` });
          }
        }
      } else {
        validations.push({ check: "slot_available", pass: false, detail: "missing active destination channel" });
      }

      validations.push({
        check: "canonical_short_slot",
        pass: isCanonicalShortSlot(finalScheduledAtUtc),
        detail: finalScheduledAtUtc,
      });

      const shortContent = [
        item.scriptOutline.openingTension,
        item.scriptOutline.reflectionBuddhistInsight,
        item.scriptOutline.softTakeaway,
      ].join(" ");

      plans.push({
        index,
        title: item.titleCandidate,
        topicFamily: item.topicFamily,
        hookPattern: item.hookPattern,
        selectedHook: item.selectedHook,
        shortCoverText: item.shortCoverText,
        shortContent,
        originalScheduledAtUtc: item.scheduledAtUtc,
        originalScheduledAtVn: item.scheduledAtVn,
        scheduledAtUtc: finalScheduledAtUtc,
        scheduledAtVn: finalScheduledAtVn,
        slotMoved,
        moveReason,
        validations,
        safeToGenerate: validations.every((v) => v.pass),
      });
    }

    const results: ItemResult[] = [];

    if (args.dryRun) {
      const payload = {
        mode: "dry_run",
        itemsPlanned: plans.length,
        safeToGenerate: plans.filter((p) => p.safeToGenerate).length,
        plans,
      };
      if (args.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log("## Controlled Batch Generation Dry-run (no DB/media writes)");
      console.log(`- Items planned: ${payload.itemsPlanned}`);
      console.log(`- Safe to generate: ${payload.safeToGenerate}`);
      for (const plan of plans) {
        console.log(`\n### Index ${plan.index}: ${plan.title}`);
        console.log(`- topic_family: ${plan.topicFamily} | hook_pattern: ${plan.hookPattern} | spec_scheduled_at: ${plan.originalScheduledAtVn}`);
        if (plan.slotMoved) {
          console.log(`- SLOT MOVED: ${plan.moveReason}`);
        }
        console.log(`- final_scheduled_at: ${plan.scheduledAtVn} (${plan.scheduledAtUtc})`);
        console.log(`- coverText: ${plan.shortCoverText}`);
        console.log(`- script (3-part outline concatenated): ${plan.shortContent}`);
        console.log(`- media steps that would run: TTS (runTTS) -> Images (runImages, Fal.ai) -> Video (runShortVideo, incl. cover asset)`);
        console.log(`- queue rows that would be created: youtube/short + facebook/short, both at ${plan.scheduledAtUtc}, same content_generation_id, no quote/photo sidecar row`);
        for (const v of plan.validations) {
          console.log(`  - [${v.pass ? "OK" : "FAIL"}] ${v.check}: ${v.detail}`);
        }
        console.log(`- safe_to_generate: ${plan.safeToGenerate}`);
      }
      return;
    }

    // ── Apply ────────────────────────────────────────────────────────────────
    const claimedInApplyRun: number[] = [];
    for (const plan of plans) {
      if (!plan.safeToGenerate) {
        results.push({
          index: plan.index, contentId: null, title: plan.title, topicFamily: plan.topicFamily, hookPattern: plan.hookPattern,
          scheduledAtVn: plan.scheduledAtVn, videoPath: null, coverAssetPath: null,
          status: "validation_failed_skipped",
          detail: plan.validations.filter((v) => !v.pass).map((v) => v.check).join(", "),
          youtubeQueueId: null, facebookQueueId: null,
        });
        continue;
      }

      // Idempotency: if a prior run already fully generated this index's content+media
      // (e.g. a partial failure after media generation but before queue insert), reuse it
      // rather than regenerating and incurring duplicate TTS/image cost.
      const existing = await pool.query<{ id: string; video_path: string | null; short_cover_asset_path: string | null }>(
        `select id, video_path, short_cover_asset_path from content_generations where experiment_id = $1 and experiment_variant = $2 and video_status = 'done' and video_path is not null limit 1`,
        [EXPERIMENT_ID, `index_${plan.index}`],
      );

      let contentId: string;
      let videoPath: string | null = null;
      let coverAssetPath: string | null = null;
      let mediaFailedReason: string | null = null;

      if (existing.rows.length > 0) {
        contentId = existing.rows[0].id;
        videoPath = existing.rows[0].video_path;
        coverAssetPath = existing.rows[0].short_cover_asset_path;
      } else {
        contentId = crypto.randomUUID();
        const promptVersions = mergePromptVersions(null, {
          hook: createPromptVersionEntry("hook", {
            mode: "experiment",
            details: { source: "phat-phap-30-tts-experiment-spec", hookPattern: plan.hookPattern },
          }),
          cover: createPromptVersionEntry("cover", {
            mode: "short",
            details: { metadataSource: "experiment_spec_v1", coverText: plan.shortCoverText },
          }),
        });

        await pool.query(
          `
            insert into content_generations (
              id, topic, niche_id, niche_name, content_profile_key, channel_key,
              script, short_content, short_selected_hook, hook_pattern, hook_type, hook_generated_at,
              long_content, prompt_versions, experiment_id, experiment_variant,
              content_mode, format_type, topic_family, short_cover_text
            ) values (
              $1, $2, $3, 'Phật Pháp', 'buddhism', 'phat_phap',
              '', $4, $5, $6, null, now(),
              '', $7::jsonb, $8, $9,
              'short', 'tts_short', $10, $11
            )
          `,
          [
            contentId, plan.title, PHAT_PHAP_NICHE_ID, plan.shortContent, plan.selectedHook, plan.hookPattern,
            JSON.stringify(promptVersions), EXPERIMENT_ID, `index_${plan.index}`, plan.topicFamily, plan.shortCoverText,
          ],
        );
      }

      if (existing.rows.length === 0 && !args.skipMedia) {
        const ttsResult = await runTTS(contentId, "short");
        if (!ttsResult.success) mediaFailedReason = `TTS failed: ${ttsResult.error}`;

        if (!mediaFailedReason) {
          const imagesResult = await runImages(contentId);
          if (!imagesResult.success) mediaFailedReason = `Images failed: ${imagesResult.error}`;
        }

        if (!mediaFailedReason) {
          const videoResult = await runShortVideo(contentId);
          if (!videoResult.success) mediaFailedReason = `Video render failed: ${videoResult.error}`;
          else videoPath = videoResult.videoPath;
        }

        if (!mediaFailedReason) {
          const refreshed = await db.query.contentGenerations.findFirst({ where: eq(contentGenerations.id, contentId) });
          coverAssetPath = refreshed?.shortCoverAssetPath ?? null;
        }
      }

      if (mediaFailedReason) {
        results.push({
          index: plan.index, contentId, title: plan.title, topicFamily: plan.topicFamily, hookPattern: plan.hookPattern,
          scheduledAtVn: plan.scheduledAtVn, videoPath: null, coverAssetPath: null,
          status: "media_failed_skipped", detail: mediaFailedReason,
          youtubeQueueId: null, facebookQueueId: null,
        });
        continue; // do not queue this item
      }

      // Idempotency: if a prior run already created valid queue rows for this content
      // item (partial crash after queue insert), reuse them rather than duplicating.
      const existingQueue = await getExistingShortQueueRows(pool, contentId);
      if (existingQueue.youtube && existingQueue.facebook) {
        results.push({
          index: plan.index, contentId, title: plan.title, topicFamily: plan.topicFamily, hookPattern: plan.hookPattern,
          scheduledAtVn: formatVn(existingQueue.youtube.scheduledAt), videoPath, coverAssetPath,
          status: "generated_and_queued", detail: "reused existing queue rows from a prior run",
          youtubeQueueId: existingQueue.youtube.id, facebookQueueId: existingQueue.facebook.id,
        });
        continue;
      }

      // Fail-closed re-check immediately before queue insert (race-safety): the queue
      // grows organically between dry-run and apply, so re-validate live and recompute a
      // fresh full-lane-safe anchor if the planned slot was taken in the meantime, rather
      // than just giving up.
      let finalScheduledAtUtc = plan.scheduledAtUtc;
      const ytCollisionNow = youtubeChannelId ? await checkSlotCollision(pool, "youtube", finalScheduledAtUtc) : true;
      const fbCollisionNow = facebookChannelId ? await checkSlotCollision(pool, "facebook", finalScheduledAtUtc) : true;
      const claimedBySiblingThisApply = claimedInApplyRun.includes(new Date(finalScheduledAtUtc).getTime());
      if (!youtubeChannelId || !facebookChannelId) {
        results.push({
          index: plan.index, contentId, title: plan.title, topicFamily: plan.topicFamily, hookPattern: plan.hookPattern,
          scheduledAtVn: plan.scheduledAtVn, videoPath, coverAssetPath,
          status: "queue_collision_skipped", detail: "missing active destination channel",
          youtubeQueueId: null, facebookQueueId: null,
        });
        continue;
      }
      if (ytCollisionNow || fbCollisionNow || claimedBySiblingThisApply) {
        const { anchor, reason } = await computeSafeShortSlot({
          pool,
          notBefore: new Date(Math.max(new Date(plan.scheduledAtUtc).getTime(), Date.now())),
          extraTakenMs: claimedInApplyRun,
        });
        if (!anchor) {
          results.push({
            index: plan.index, contentId, title: plan.title, topicFamily: plan.topicFamily, hookPattern: plan.hookPattern,
            scheduledAtVn: plan.scheduledAtVn, videoPath, coverAssetPath,
            status: "queue_collision_skipped",
            detail: `planned slot taken at apply time and no fresh full-lane-safe anchor found: ${reason}`,
            youtubeQueueId: null, facebookQueueId: null,
          });
          continue;
        }
        finalScheduledAtUtc = anchor.toISOString();
      }
      claimedInApplyRun.push(new Date(finalScheduledAtUtc).getTime());

      // upload_queue.id has no DB-level default (only a Drizzle $defaultFn), so raw SQL
      // inserts must supply it explicitly.
      const ytQueueResult = await pool.query<{ id: string }>(
        `insert into upload_queue (id, content_id, channel_id, platform, video_type, title, scheduled_at, status) values ($1, $2, $3, 'youtube', 'short', $4, $5::timestamptz, 'queued') returning id`,
        [crypto.randomUUID(), contentId, youtubeChannelId, plan.title, finalScheduledAtUtc],
      );
      const fbQueueResult = await pool.query<{ id: string }>(
        `insert into upload_queue (id, content_id, channel_id, platform, video_type, title, scheduled_at, status) values ($1, $2, $3, 'facebook', 'short', $4, $5::timestamptz, 'queued') returning id`,
        [crypto.randomUUID(), contentId, facebookChannelId, plan.title, finalScheduledAtUtc],
      );

      results.push({
        index: plan.index, contentId, title: plan.title, topicFamily: plan.topicFamily, hookPattern: plan.hookPattern,
        scheduledAtVn: formatVn(finalScheduledAtUtc), videoPath, coverAssetPath,
        status: "generated_and_queued",
        detail: finalScheduledAtUtc === plan.scheduledAtUtc ? "ok" : `slot moved at apply time: ${plan.scheduledAtVn} -> ${formatVn(finalScheduledAtUtc)}`,
        youtubeQueueId: ytQueueResult.rows[0].id, facebookQueueId: fbQueueResult.rows[0].id,
      });
    }

    const payload = {
      mode: "apply",
      requested: plans.length,
      generated: results.filter((r) => r.status === "generated_and_queued").length,
      skipped: results.filter((r) => r.status !== "generated_and_queued").length,
      results,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Controlled Batch Generation Apply");
    console.log(`- Requested: ${payload.requested}`);
    console.log(`- Generated and queued: ${payload.generated}`);
    console.log(`- Skipped: ${payload.skipped}`);
    console.log("\n| index | content_id | title | status | detail | yt_queue_id | fb_queue_id |");
    console.log("|---:|---|---|---|---|---|---|");
    for (const r of results) {
      console.log(`| ${r.index} | ${r.contentId ?? "-"} | ${r.title} | ${r.status} | ${r.detail} | ${r.youtubeQueueId ?? "-"} | ${r.facebookQueueId ?? "-"} |`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
