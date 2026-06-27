import "dotenv/config";

import { getTopicPerformanceAction } from "@/actions/publishing-analytics";

async function main() {
  const rows = await getTopicPerformanceAction({
    platform: "youtube",
    limit: 10,
  });

  console.log(JSON.stringify({
    count: rows.length,
    rows,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
