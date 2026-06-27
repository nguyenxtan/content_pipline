import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = process.argv.includes("--dry-run") || !EXECUTE;

async function main() {
  const { runAutoRefillWatcher } = await import("@/lib/auto-refill-watcher");

  const result = await runAutoRefillWatcher({
    dryRun: DRY_RUN,
    source: "script",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
