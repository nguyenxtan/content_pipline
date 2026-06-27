import { config } from "dotenv";

config({ path: ".env.local" });
config();

function readArgs() {
  const args = process.argv.slice(2);
  const deleteMode = args.includes("--delete");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  return {
    dryRun: !deleteMode,
    limit: Number.isFinite(limit) ? limit : undefined,
  };
}

async function main() {
  const input = readArgs();
  const { cleanupUploadedAssetsAction } = await import("@/actions/cleanup-uploaded-assets");
  const result = await cleanupUploadedAssetsAction(input);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
