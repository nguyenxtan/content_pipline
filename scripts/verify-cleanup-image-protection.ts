import { config } from "dotenv";

config({ path: ".env.local" });
config();

function readLimit(): number {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 500;
}

async function main() {
  const { cleanupUploadedAssetsAction } = await import("@/actions/cleanup-uploaded-assets");
  const result = await cleanupUploadedAssetsAction({ dryRun: true, limit: readLimit() });

  const eligibleBefore = result.results.filter((item) => item.filesEligibleBeforeProtection > 0);
  const eligibleAfter = result.results.filter((item) => item.filesDeleted.length > 0);
  const protectedItems = result.results.filter((item) => item.protectedImageAssetsReason);
  const protectedImageCount = result.results.reduce((total, item) => total + item.protectedImageFiles.length, 0);
  const protectedImageBytes = result.results.reduce((total, item) => total + item.protectedImageBytes, 0);
  const bytesEligibleBeforeProtection = result.results.reduce(
    (total, item) => total + item.bytesEligibleBeforeProtection,
    0,
  );

  console.log(JSON.stringify({
    dryRun: result.dryRun,
    scanned: result.scanned,
    eligibleBefore: eligibleBefore.length,
    eligibleAfter: eligibleAfter.length,
    protectedContentItems: protectedItems.length,
    protectedImageCount,
    protectedImageBytes,
    bytesEligibleBeforeProtection,
    bytesStillCleanupEligible: result.bytesFreed,
    protectedExamples: protectedItems.slice(0, 10).map((item) => ({
      contentId: item.contentId,
      topic: item.topic,
      protectedImageAssetsReason: item.protectedImageAssetsReason,
      protectedImageFiles: item.protectedImageFiles,
      protectedImageBytes: item.protectedImageBytes,
      filesStillCleanupEligible: item.filesDeleted,
      bytesStillCleanupEligible: item.bytesFreed,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
