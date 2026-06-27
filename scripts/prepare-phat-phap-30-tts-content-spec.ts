import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

type Args = {
  start: string | null;
  slots: number;
  dryRun: boolean;
  json: boolean;
  output: string | null;
  noAi: boolean;
};

type ChecklistItem = {
  slot: number;
  topicFamily: string;
  hookPattern: string;
  titleSeed: string;
  proposedSelectedHook: string;
  proposedShortCoverText: string;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  generationStatus: "ready" | "blocked";
  blockers: string[];
};

// Deterministic, non-AI script-outline scaffolding per topic family. Grounded in the
// family descriptions from src/lib/config/topic-family-registry.ts, paraphrased into a
// fixed reflective sentence and a fixed soft-takeaway sentence — never generated at runtime.
const REFLECTION_BY_FAMILY: Record<string, string> = {
  tri_tue_song_im_lang_nhan_nhin:
    "Người có trí tuệ không cần tranh cãi để chứng minh mình đúng; sự im lặng đúng lúc tự nó đã là một câu trả lời.",
  nhan_qua_nguoi_xau_bao_ung:
    "Nhân quả không cần ai nhắc nhở, mọi việc ta làm rồi cũng sẽ quay trở lại với ta theo một cách nào đó.",
  buong_bo_chua_lanh:
    "Buông bỏ không có nghĩa là quên đi, mà là không còn để nỗi đau ấy điều khiển những ngày còn lại của mình.",
  binh_yen_an_lac:
    "Bình yên không ở nơi xa, nó nằm ngay trong cách ta chọn nhìn cuộc sống mỗi ngày.",
};

const TAKEAWAY_BY_FAMILY: Record<string, string> = {
  tri_tue_song_im_lang_nhan_nhin: "Hãy học cách im lặng đúng lúc, đó cũng là một dạng trí tuệ.",
  nhan_qua_nguoi_xau_bao_ung: "Hãy sống tử tế, phần còn lại cứ để nhân quả lo.",
  buong_bo_chua_lanh: "Hãy cho phép mình buông bỏ, để tâm được nhẹ nhàng hơn.",
  binh_yen_an_lac: "Hãy dừng lại một chút, bình yên vẫn luôn ở đó.",
};

function titleCaseVietnamese(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("vi-VN") + word.slice(1).toLocaleLowerCase("vi-VN"))
    .join(" ");
}

function parseArgs(argv: string[]): Args {
  let start: string | null = null;
  let slots = 30;
  let dryRun = true;
  let json = false;
  let output: string | null = null;
  let noAi = true;

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
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--output") {
      output = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--no-ai") {
      noAi = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { start, slots, dryRun, json, output, noAi };
}

function loadChecklist(args: Args): ChecklistItem[] {
  const scriptPath = path.join(process.cwd(), "scripts", "plan-phat-phap-tts-experiment-generation.ts");
  const tsxBin = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const cliArgs = [
    "--env-file=.env.local",
    tsxBin,
    "--tsconfig",
    "tsconfig.json",
    scriptPath,
    "--slots",
    String(args.slots),
    "--json",
  ];
  if (args.start) cliArgs.push("--start", args.start);
  const stdout = execFileSync(process.execPath, cliArgs, { cwd: process.cwd(), encoding: "utf8" });
  const parsed = JSON.parse(stdout) as { checklist: ChecklistItem[] };
  return parsed.checklist;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // --no-ai is the only supported mode: this script never calls any external AI provider,
  // regardless of the flag's value. No code path here performs a network/model call.

  const checklist = loadChecklist(args);
  const blocked = checklist.filter((item) => item.generationStatus !== "ready");
  if (blocked.length > 0) {
    console.log(`## Content Spec Generation Stopped`);
    console.log(`- Blocked items: ${blocked.length}/${checklist.length}`);
    for (const item of blocked) {
      console.log(`- slot ${item.slot} (${item.topicFamily}/${item.hookPattern}): ${item.blockers.join("; ")}`);
    }
    console.log("Not all items are ready. Resolve blockers before producing a full content spec.");
    process.exit(1);
  }

  const spec = checklist.map((item) => {
    const angle = item.titleSeed.includes(": ") ? item.titleSeed.split(": ").slice(1).join(": ") : item.titleSeed;
    const titleCandidate = titleCaseVietnamese(angle);
    const reflection = REFLECTION_BY_FAMILY[item.topicFamily] ?? "Mỗi câu chuyện đều mang một bài học để ta dừng lại và suy ngẫm.";
    const takeaway = TAKEAWAY_BY_FAMILY[item.topicFamily] ?? "Hãy sống chậm lại một chút mỗi ngày.";

    return {
      index: item.slot,
      scheduledAtUtc: item.scheduledAtUtc,
      scheduledAtVn: item.scheduledAtVn,
      topicFamily: item.topicFamily,
      hookPattern: item.hookPattern,
      titleCandidate,
      selectedHook: item.proposedSelectedHook,
      shortCoverText: item.proposedShortCoverText,
      scriptOutline: {
        openingTension: item.proposedSelectedHook,
        reflectionBuddhistInsight: reflection,
        softTakeaway: takeaway,
      },
      requiredPlatforms: ["youtube_short", "facebook_reel"],
      coverAssetRequiredBeforePublish: true,
      coverAssetNote: "deferred until source image exists — not generated by this script",
      generationReadiness: item.generationStatus,
      channelKey: "phat_phap",
      formatType: "tts_short",
    };
  });

  const payload = {
    meta: {
      start: args.start,
      slots: args.slots,
      mode: "dry_run",
      externalApiCalled: false,
    },
    summary: {
      itemsPlanned: spec.length,
      ready: spec.filter((s) => s.generationReadiness === "ready").length,
    },
    spec,
  };

  if (args.output) {
    const outputPath = path.isAbsolute(args.output) ? args.output : path.join(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    console.log(`## 30-Item Content Spec (dry-run, no DB/queue writes, no media/AI calls)`);
    console.log(`- Items planned: ${payload.summary.itemsPlanned}`);
    console.log(`- Ready: ${payload.summary.ready}`);
    console.log(`- Output written: ${outputPath}`);
    if (!args.json) return;
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("## 30-Item Content Spec (dry-run, no DB/queue writes, no media/AI calls)");
  console.log(`- Items planned: ${payload.summary.itemsPlanned}`);
  console.log(`- Ready: ${payload.summary.ready}`);
  console.log("\n| index | scheduled_at_vn | topic_family | hook_pattern | title | hook | coverText |");
  console.log("|---:|---|---|---|---|---|---|");
  for (const item of spec) {
    console.log(
      `| ${item.index} | ${item.scheduledAtVn} | ${item.topicFamily} | ${item.hookPattern} | ${item.titleCandidate} | ${item.selectedHook} | ${item.shortCoverText} |`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
