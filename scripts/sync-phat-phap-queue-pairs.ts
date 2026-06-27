import "dotenv/config";

import {
  executePhatPhapQueueSync,
  type PhatPhapQueueSyncInput,
} from "@/lib/publishing/phat-phap-queue-sync";

type Args = {
  input: PhatPhapQueueSyncInput;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  let from: Date | null = null;
  let to: Date | null = null;
  let contentId: string | null = null;
  let apply = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") {
      from = new Date(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--to") {
      to = new Date(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--content-id") {
      contentId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      apply = false;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!from || Number.isNaN(from.getTime())) {
    throw new Error("--from <ISO datetime> is required");
  }
  if (!to || Number.isNaN(to.getTime())) {
    throw new Error("--to <ISO datetime> is required");
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error("--from must be earlier than --to");
  }

  return {
    input: {
      from,
      to,
      contentId,
      apply,
    },
    json,
  };
}

function printHuman(result: Awaited<ReturnType<typeof executePhatPhapQueueSync>>) {
  console.log("## Dry-run Sync Plan");
  console.log(`Mode: ${result.mode}`);
  console.log(`Window: ${result.window.fromUtc} -> ${result.window.toUtc}`);
  console.log(`Items scanned: ${result.summary.itemsScanned}`);
  console.log(`Complete pairs: ${result.summary.completePairs}`);
  console.log(`Safe creates: ${result.summary.safeCreates}`);
  console.log(`Safe aligns: ${result.summary.safeAligns}`);
  console.log(`Manual review: ${result.summary.manualReview}`);
  console.log(`Unsafe skipped: ${result.summary.unsafeSkipped}`);
  console.log(`Wrong lane: ${result.summary.wrongLane}`);
  console.log(`Content collisions: ${result.summary.contentCollisions}`);
  if (result.mode === "apply") {
    console.log(`Applied: ${result.applyResult.applied}`);
    console.log(`Created: ${result.applyResult.created}`);
    console.log(`Aligned: ${result.applyResult.aligned}`);
    console.log(`State changed: ${result.applyResult.stateChanged}`);
  }

  for (const item of result.items) {
    console.log([
      `- ${item.formatType}`,
      item.contentId,
      item.diagnosis,
      item.proposedAction,
      item.currentScheduledAtVn ?? "no-slot",
      item.targetScheduledAtVn ?? "no-target",
      item.reason,
    ].join(" | "));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await executePhatPhapQueueSync(args.input);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printHuman(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
