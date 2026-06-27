import "dotenv/config";

import { getTopicPerformanceSummaryAction } from "@/actions/publishing-analytics";

async function main() {
  const summary = await getTopicPerformanceSummaryAction({
    platform: "youtube",
    limit: 100,
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
