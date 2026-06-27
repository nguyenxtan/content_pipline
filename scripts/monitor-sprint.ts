import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue, socialChannels } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";
import { getStrategicFamilyCoverageAction } from "@/actions/publishing-analytics";
import { STRATEGIC_FAMILY_DISPLAY, type StrategicTopicFamilyId } from "@/lib/config/topic-family-registry";

const CONTENT_IDS = [
  "8c0da12f-08b0-4009-bd55-80ae3b871e21",
  "9839af14-c1ed-4af4-9c2a-3d1adfabc210",
  "1fcd2512-83e1-480c-8b6b-eb282c7e76de",
  "fe2b62e4-9871-40c4-a7f2-9aa411530dd9",
  "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2",
  "8d9eb929-4730-487a-bbd0-1c0f1d9ac744",
  "957b26f5-990e-489d-adff-fd7964fae7be",
  "qgen-mq529m74-gfgmk",
  "qgen-mq529sg9-mkvas",
  "qgen-mq529ylj-45p4k",
];

async function main() {
  const cg = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, CONTENT_IDS),
    columns: { id: true, topic: true, topicFamily: true, formatType: true, videoStatus: true, videoPath: true },
    orderBy: (t, { asc }) => asc(t.createdAt),
  });

  const uq = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.contentId, CONTENT_IDS),
    columns: {
      id: true, contentId: true, videoType: true, status: true,
      scheduledAt: true, uploadedAt: true, platformVideoId: true,
      errorMessage: true, socialChannelId: true,
    },
    orderBy: (t, { asc }) => asc(t.scheduledAt),
  });

  const channelIdSet = [...new Set(uq.map(q => q.socialChannelId).filter((x): x is string => !!x))];
  const channelMap = new Map<string, string>();
  if (channelIdSet.length > 0) {
    const channels = await db.query.socialChannels.findMany({
      where: inArray(socialChannels.id, channelIdSet),
      columns: { id: true, name: true, platform: true },
    });
    for (const c of channels) channelMap.set(c.id, `${c.platform}:${c.name}`);
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Sprint Batch Publish Status Monitor");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  // ── topic_family ──────────────────────────────────────────────────
  console.log("\n── topic_family check ───────────────────────────────────────");
  let familyOkCount = 0;
  for (const r of cg) {
    const ok = !!r.topicFamily;
    if (ok) familyOkCount++;
    const display = STRATEGIC_FAMILY_DISPLAY[r.topicFamily as StrategicTopicFamilyId] ?? r.topicFamily ?? "(none)";
    console.log(`  ${ok ? "✓" : "⚠"} ${r.id.slice(0, 8)} | ${display}`);
  }
  console.log(`\n  topic_family: ${familyOkCount}/${cg.length} populated ${familyOkCount === cg.length ? "✓" : "⚠"}`);

  // ── Status summary table ──────────────────────────────────────────
  console.log("\n── Status table ─────────────────────────────────────────────");
  console.log("  ID       | format        | vid    | entries | outcome");
  console.log("  " + "─".repeat(70));
  for (const r of cg) {
    const entries = uq.filter(q => q.contentId === r.id);
    const done = entries.filter(q => q.status === "done");
    const queued = entries.filter(q => q.status === "queued");
    const errored = entries.filter(q => q.status === "error");
    const outcome =
      entries.length === 0 ? "not in queue"
      : done.length > 0 ? `published (x${done.length})`
      : errored.length > 0 ? `error (x${errored.length})`
      : `queued (x${queued.length})`;
    const fmt = (r.formatType ?? "tts_short").slice(0, 13).padEnd(13);
    console.log(`  ${r.id.slice(0, 8)} | ${fmt} | ${(r.videoStatus ?? "?").padEnd(6)} | ${String(entries.length).padStart(7)} | ${outcome}`);
  }

  // ── Upload queue detail ───────────────────────────────────────────
  console.log("\n── Upload queue detail ──────────────────────────────────────");
  for (const id of CONTENT_IDS) {
    const entries = uq.filter(q => q.contentId === id);
    if (entries.length === 0) { console.log(`  ${id.slice(0, 8)}: (no entries)`); continue; }
    for (const q of entries) {
      const sched = q.scheduledAt ? new Date(q.scheduledAt).toISOString().replace("T", " ").slice(0, 16) : "—";
      const uploaded = q.uploadedAt ? new Date(q.uploadedAt).toISOString().replace("T", " ").slice(0, 16) : "—";
      const chan = q.socialChannelId ? (channelMap.get(q.socialChannelId) ?? q.socialChannelId.slice(0, 12)) : "—";
      const platId = q.platformVideoId ? q.platformVideoId.slice(0, 30) : "—";
      const err = q.errorMessage ? ` ⚠ ${q.errorMessage.slice(0, 60)}` : "";
      console.log(`  ${id.slice(0, 8)} | ${(q.videoType ?? "?").padEnd(5)} | ${(q.status ?? "?").padEnd(10)} | sched=${sched} | uploaded=${uploaded} | chan=${chan}${err}`);
      if (q.platformVideoId) console.log(`           platformId=${platId}`);
    }
  }

  // ── Duplicate check ───────────────────────────────────────────────
  console.log("\n── Duplicate check ──────────────────────────────────────────");
  const exactMap = new Map<string, number>();
  for (const q of uq) {
    const key = `${q.contentId}::${q.videoType}::${q.socialChannelId ?? "?"}::${q.scheduledAt?.toISOString() ?? ""}`;
    exactMap.set(key, (exactMap.get(key) ?? 0) + 1);
  }
  const exactDups = [...exactMap.entries()].filter(([, n]) => n > 1);
  console.log(exactDups.length === 0 ? "  ✓ No exact duplicate (contentId+type+channel+slot)" : `  ⚠ ${exactDups.length} exact duplicates`);
  for (const [key, n] of exactDups) console.log(`    x${n}: ${key}`);

  const broadMap = new Map<string, number>();
  for (const q of uq) {
    const key = `${q.contentId}::${q.videoType}::${q.socialChannelId ?? "?"}`;
    broadMap.set(key, (broadMap.get(key) ?? 0) + 1);
  }
  const broadDups = [...broadMap.entries()].filter(([, n]) => n > 1);
  if (broadDups.length > 0) {
    console.log(`  ⚠ Same content queued multiple times for same channel:`);
    for (const [key, n] of broadDups) console.log(`    x${n}: ${key}`);
  } else {
    console.log("  ✓ No same-content/same-channel multi-slot duplicates");
  }

  // ── Queue backlog ─────────────────────────────────────────────────
  const totalQueued = await db.$count(uploadQueue, sql`status = 'queued'`);
  const totalUploading = await db.$count(uploadQueue, sql`status = 'uploading'`);
  const totalDone = await db.$count(uploadQueue, sql`status = 'done'`);
  const totalError = await db.$count(uploadQueue, sql`status = 'error'`);
  console.log("\n── Overall queue backlog ─────────────────────────────────────");
  console.log(`  queued=${totalQueued}  uploading=${totalUploading}  done=${totalDone}  error=${totalError}`);
  console.log(`  Backpressure threshold 60 → ${totalQueued > 60 ? `⚠ OVER (${totalQueued})` : `✓ OK (${totalQueued})`}`);

  // ── Coverage ──────────────────────────────────────────────────────
  console.log("\n── Strategic Topic Family Coverage ──────────────────────────");
  try {
    const coverage = await getStrategicFamilyCoverageAction();
    for (const r of coverage) {
      if (r.sampleDepth.total === 0) continue;
      const vq = `${r.videoCount.total}v/${r.quoteCount.total}q`;
      console.log(`  [${(r.sprintLabel ?? "—").padEnd(12)}] ${r.displayName.padEnd(40)} total=${r.sampleDepth.total} (${vq}) ${r.sampleDepthStatus}`);
    }
    console.log("  ✓ Coverage action OK");
  } catch (e) { console.error(`  ✗ ${e}`); }

  console.log("\n═══════════════════════════════════════════════════════════");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
