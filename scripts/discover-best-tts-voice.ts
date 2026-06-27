import "dotenv/config";
import fs from "fs";
import path from "path";
import { discoverAiMaxVoices } from "@/services/tts/providers/AiMaxProvider";

const REPORT_PATH = path.join(process.cwd(), "reports", "aimax-voices.md");

function isVietnameseLocale(locale?: string): boolean {
  const normalized = (locale ?? "").trim().toLowerCase();
  return ["vi", "vn", "vietnamese", "tiếng việt", "tieng viet"].includes(normalized);
}

function getProvider(voice: { rawJson?: unknown }): string {
  return typeof voice.rawJson === "object" && voice.rawJson && "provider" in voice.rawJson
    ? String((voice.rawJson as Record<string, unknown>).provider ?? "")
    : "";
}

function scoreVoice(voice: {
  id: string;
  name: string;
  gender?: string;
  category?: string;
  useCase?: string;
  locale?: string;
  rawJson?: unknown;
}): number {
  let score = 0;
  const name = `${voice.name} ${voice.category ?? ""} ${voice.useCase ?? ""}`.toLowerCase();
  if (isVietnameseLocale(voice.locale)) score += 10;
  if (voice.gender?.toLowerCase() === "male") score += 1;
  if (name.includes("warm")) score += 1;
  if (name.includes("deep")) score += 1;
  if (name.includes("narr")) score += 1;
  if (name.includes("calm")) score += 1;
  if (getProvider(voice).toLowerCase().includes("minimax")) score += 2;
  return score;
}

async function main() {
  const voices = await discoverAiMaxVoices({ forceRefresh: true });
  const ranked = [...voices].sort((left, right) => scoreVoice(right) - scoreVoice(left));
  const vietnamese = ranked.filter((voice) => isVietnameseLocale(voice.locale));
  const pool = vietnamese.length > 0 ? vietnamese : ranked;
  const male = pool.filter((voice) => voice.gender?.toLowerCase() === "male");
  const female = pool.filter((voice) => voice.gender?.toLowerCase() === "female");

  const lines: string[] = [];
  lines.push("# AiMax Voices");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Suggested buckets");
  lines.push("");
  lines.push(`- Truyện audio nữ: \`${female[0]?.id ?? "n/a"}\``);
  lines.push(`- Truyện audio nam: \`${male[0]?.id ?? "n/a"}\``);
  lines.push(`- Phật pháp nam trầm: \`${male.find((voice) => /deep|calm|narr/i.test(`${voice.name} ${voice.category ?? ""} ${voice.useCase ?? ""}`))?.id ?? male[0]?.id ?? "n/a"}\``);
  lines.push(`- Triết học nam trung: \`${male.find((voice) => /warm|narr/i.test(`${voice.name} ${voice.category ?? ""} ${voice.useCase ?? ""}`))?.id ?? male[0]?.id ?? "n/a"}\``);
  lines.push("");
  lines.push("| VoiceID | Tên | Provider | Giới tính | Language | Category | Use case |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const voice of ranked) {
    const provider = getProvider(voice);
    lines.push(`| ${voice.id} | ${voice.name} | ${provider} | ${voice.gender ?? ""} | ${voice.locale ?? ""} | ${voice.category ?? ""} | ${voice.useCase ?? ""} |`);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({
    reportPath: REPORT_PATH,
    voiceCount: voices.length,
    maleCount: male.length,
    femaleCount: female.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
