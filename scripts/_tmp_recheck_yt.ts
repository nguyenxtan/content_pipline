import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { listYouTubeVideos } from "@/lib/social/youtube-api";

async function run() {
  const items = await listYouTubeVideos(12, ["3BUIlEP5LRI"]);
  const v = items[0];
  console.log(JSON.stringify({
    title: v?.snippet?.title,
    tags: v?.snippet?.tags,
    privacyStatus: v?.status?.privacyStatus,
  }, null, 2));
}
run();
