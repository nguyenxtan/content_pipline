import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentSchedulerJobs, niches } from "@/lib/db/schema";
import { getChannelPublishConfig } from "@/lib/config/channel-configs";
import { getWorkspaceById } from "@/lib/channel-workspace-registry";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

function computeNextWindowRunAt(windowStart: string): Date {
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const startMin = parseMinutes(windowStart);
  const currentMin = vnNow.getUTCHours() * 60 + vnNow.getUTCMinutes();
  const nextVn = new Date(Date.UTC(
    vnNow.getUTCFullYear(),
    vnNow.getUTCMonth(),
    vnNow.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  const chosenMinutes = currentMin < startMin
    ? startMin
    : Math.ceil((currentMin + 1) / 60) * 60;
  if (chosenMinutes >= 24 * 60) {
    nextVn.setUTCDate(nextVn.getUTCDate() + 1);
  }
  const normalized = chosenMinutes % (24 * 60);
  nextVn.setUTCHours(Math.floor(normalized / 60), normalized % 60, 0, 0);
  return new Date(nextVn.getTime() - 7 * 60 * 60 * 1000);
}

async function main() {
  const execute = hasFlag("--execute");
  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, "tang_sau"), eq(niches.isActive, true)),
  });
  assert(niche, "No active tang_sau niche found.");

  const publishConfig = await getChannelPublishConfig("tang_sau");
  const workspace = getWorkspaceById("tang_sau_workspace");
  const windowStart = publishConfig?.shortDestinations[0]?.windowStart
    ?? workspace?.schedulePlan.postingWindows[0]?.start
    ?? "07:00";
  const windowEnd = publishConfig?.shortDestinations[0]?.windowEnd
    ?? workspace?.schedulePlan.postingWindows[0]?.end
    ?? "22:00";
  const intervalMin = publishConfig?.shortDestinations[0]?.intervalMin
    ?? workspace?.schedulePlan.intervalMinutes
    ?? 60;
  const nextRunAt = computeNextWindowRunAt(windowStart);

  const desiredJobs = [
    {
      jobType: "content_gen" as const,
      contentMode: "short" as const,
      batchSize: 3,
      frequency: "hourly",
      topic: "",
      bgMusic: null as boolean | null,
    },
    {
      jobType: "short_pipeline" as const,
      contentMode: "short" as const,
      batchSize: 1,
      frequency: "hourly",
      topic: "",
      bgMusic: true as boolean | null,
    },
  ];

  const existingJobs = await db.query.contentSchedulerJobs.findMany({
    where: eq(contentSchedulerJobs.nicheId, niche.id),
  });
  const existingByType = new Map(existingJobs.map((job) => [job.jobType ?? "content_gen", job]));

  const plan = desiredJobs.map((desired) => {
    const existing = existingByType.get(desired.jobType);
    return {
      action: existing ? "update" : "insert",
      desired,
      existing,
    };
  });

  console.log(`mode=${execute ? "execute" : "dry-run"}`);
  console.log(`niche=${niche.id} ${niche.name}`);
  console.log(`window=${windowStart}-${windowEnd} interval=${intervalMin} nextRunAt=${nextRunAt.toISOString()}`);
  for (const item of plan) {
    console.log([
      item.action,
      item.desired.jobType,
      `contentMode=${item.desired.contentMode}`,
      `batchSize=${item.desired.batchSize}`,
      `frequency=${item.desired.frequency}`,
      item.existing ? `existingId=${item.existing.id}` : "existingId=new",
    ].join(" | "));
  }

  if (!execute) {
    console.log("Dry run only. Re-run with --execute to upsert tang_sau scheduler jobs.");
    return;
  }

  for (const item of plan) {
    if (item.action === "insert") {
      await db.insert(contentSchedulerJobs).values({
        nicheId: niche.id,
        nicheName: niche.name,
        topic: item.desired.topic,
        frequency: item.desired.frequency,
        isEnabled: true,
        jobType: item.desired.jobType,
        contentMode: item.desired.contentMode,
        batchSize: item.desired.batchSize,
        nextRunAt,
        bgMusic: item.desired.bgMusic,
        ytWindowStart: windowStart,
        ytWindowEnd: windowEnd,
        ytIntervalMin: intervalMin,
      });
      continue;
    }

    await db.update(contentSchedulerJobs)
      .set({
        nicheName: niche.name,
        topic: item.desired.topic,
        frequency: item.desired.frequency,
        isEnabled: true,
        jobType: item.desired.jobType,
        contentMode: item.desired.contentMode,
        batchSize: item.desired.batchSize,
        nextRunAt,
        bgMusic: item.desired.bgMusic,
        ytWindowStart: windowStart,
        ytWindowEnd: windowEnd,
        ytIntervalMin: intervalMin,
        updatedAt: new Date(),
      })
      .where(eq(contentSchedulerJobs.id, item.existing!.id));
  }

  console.log(`Upserted ${plan.length} tang_sau scheduler jobs.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
