import "dotenv/config";

import fs from "fs";
import path from "path";
import { aiMaxProvider } from "@/services/tts/providers/AiMaxProvider";

const OUTPUT_PATH = path.join(process.cwd(), "tmp", "voice-tests", "phat_phap_thien_tam_speed1_pitch0.wav");
const TEXT = "Nam mo Bo Tat Quan The Am. Day la mau giong Thien Tam cho kenh Gioi Dinh Tue, toc do mot cham khong, pitch bang khong, am luong mot cham khong.";

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  const result = await aiMaxProvider.synthesize({
    text: TEXT,
    voiceId: "s_sg_male_thientam_ytstable_vc",
    outputPath: OUTPUT_PATH,
    contentId: `aimax-thien-tam-sample-${Date.now()}`,
    chapterId: `aimax-thien-tam-sample-${Date.now()}`,
    model: "speech-2.8-hd",
    language: "Vietnamese",
    normalize: true,
    enableSrt: true,
    speed: 1.0,
    pitch: 0,
    volume: 1.0,
    usageContext: {
      pipelineRoute: "phat_phap_sample_local",
      contentProfileKey: "buddhism",
      nicheName: "Giới Định Tuệ",
      formatType: "tts_short",
      voiceLabel: "Thiện Tâm",
      voiceFamily: "thien_tam",
      textHash: null,
      textCharCount: TEXT.length,
      cacheIdentity: null,
    },
  });

  console.log(JSON.stringify({
    success: true,
    provider: result.providerId,
    voiceId: result.voiceId,
    model: result.model,
    audioPath: result.audioPath,
    srtPath: result.srtPath ?? null,
    durationSec: result.durationSec ?? null,
    creditUsed: result.creditUsed ?? null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
