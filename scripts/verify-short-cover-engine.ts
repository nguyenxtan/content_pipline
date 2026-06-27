import { config } from "dotenv";
import pg from "pg";
import {
  generateShortCoversWithDiversity,
  getShortCoverOpenerPattern,
} from "@/lib/short-cover-engine";

config({ path: ".env.local" });
config();

const { Pool } = pg;

const FALLBACK_SAMPLES = [
  "Tha thứ",
  "Sợ nghèo khó",
  "Tiếc nuối",
  "Ganh đua",
  "Tự ti",
  "Sợ thất bại",
  "Mất phương hướng",
  "Sợ già",
  "Hoang mang",
  "Mất lòng tin",
  "Vô vọng",
  "Bế tắc",
  "Bất lực",
  "Nỗi đau chia ly",
  "Sợ mất kiểm soát",
  "Mong manh hy vọng",
  "Bị hiểu lầm",
  "Sợ mất mát",
  "Cô đơn",
  "Buông bỏ",
].map((topic) => ({
  topic,
  selectedHook: `Có những điều về ${topic.toLowerCase()} người ta chỉ hiểu khi đã quá mệt.`,
  script: `Có những điều về ${topic.toLowerCase()} khiến quý vị cứ giữ mãi trong lòng. Đôi khi điều làm mình khổ không nằm ở chuyện đã xảy ra, mà ở cách mình tiếp tục sống với nó.`,
}));

function ensureSampleCount<T>(samples: T[], count: number): T[] {
  if (samples.length >= count) return samples.slice(0, count);
  const expanded = [...samples];
  let index = 0;
  while (expanded.length < count && samples.length > 0) {
    expanded.push(samples[index % samples.length]);
    index += 1;
  }
  return expanded;
}

async function loadSamples() {
  if (!process.env.DATABASE_URL) return FALLBACK_SAMPLES;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await client.query<{
      topic: string;
      short_selected_hook: string | null;
      script: string | null;
      short_content: string | null;
    }>(`
      SELECT topic, short_selected_hook, script, short_content
      FROM content_generations
      WHERE topic IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 50
    `);

    if (result.rows.length === 0) return FALLBACK_SAMPLES;
    return result.rows.map((row) => ({
      topic: row.topic,
      selectedHook: row.short_selected_hook,
      script: row.script || row.short_content,
    }));
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const samples = ensureSampleCount(await loadSamples(), 50);
  const covers = generateShortCoversWithDiversity(samples);
  const rows = samples.map((sample, index) => ({
    topic: sample.topic,
    selectedHook: sample.selectedHook,
    ...covers[index],
  }));
  const openerDistribution = rows.reduce<Record<string, number>>((acc, row) => {
    const pattern = getShortCoverOpenerPattern(row.coverText);
    acc[pattern] = (acc[pattern] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    sampleCount: rows.length,
    openerDistribution,
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
