import "dotenv/config";
import { getTTSProvider } from "@/lib/pipeline/tts-providers/registry";
import { syncAiMaxVoicesToDatabase } from "@/services/tts/providers/AiMaxProvider";

async function main() {
  const providerId = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1] ?? "aimax";
  const language = process.argv.find((arg) => arg.startsWith("--language="))?.split("=")[1];
  const gender = process.argv.find((arg) => arg.startsWith("--gender="))?.split("=")[1];

  if (providerId !== "aimax") {
    const provider = await getTTSProvider(providerId);
    const voices = await provider.listVoices({ language, gender, forceRefresh: true });
    console.log(JSON.stringify({
      providerId,
      storedToDb: false,
      reason: "DB sync is currently implemented for AiMax voices only.",
      voiceCount: voices.length,
    }, null, 2));
    return;
  }

  const voices = await syncAiMaxVoicesToDatabase({ language, gender, forceRefresh: true });
  console.log(JSON.stringify({
    providerId,
    voiceCount: voices.length,
    voiceIds: voices.map((voice) => voice.id),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
