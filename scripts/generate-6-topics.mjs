import { createRequire } from "module";
import { randomUUID } from "crypto";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const DB_URL = process.env.DATABASE_URL ?? "postgresql://admin:admin123@localhost:5433/content_pipeline";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = "openai/gpt-4o-mini";
const NICHE_ID = 13;
const NICHE_NAME = "Phật Pháp";

const TOPICS = [
  "Tha thứ",
  "Buông bỏ",
  "Mất mát",
  "Lo lắng",
  "Cô đơn",
  "Tiếc nuối",
];

const pool = new Pool({ connectionString: DB_URL });

async function callAI(messages, temperature = 0.7, max_tokens = 500) {
  if (!OPENROUTER_KEY) throw new Error("Missing OPENROUTER_API_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens }),
  });
  if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0]?.message?.content ?? "";
}

function extractHooks(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.replace(/^\d+[\).\-\s]+/, ""))
    .map((l) => l.replace(/^["'""]+|["'""]+$/g, ""))
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 12 && l.length <= 180)
    .filter((l) => !/^(hook|mở đầu|câu \d+)/i.test(l))
    .filter((l, i, arr) => arr.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === i)
    .slice(0, 30);
}

async function generateForTopic(topic) {
  console.log(`\n▶ [${topic}] — Sinh hook...`);

  // Bước 1: 30 hooks
  const hookPrompt = `Bạn là người từng trải, hiểu Phật pháp nhưng không giảng đạo. Bạn nói bằng ngôn ngữ của người đời thường.

Lĩnh vực: ${NICHE_NAME}
Chủ đề: ${topic}

Hãy tạo đúng 30 câu mở đầu bằng tiếng Việt cho video short về chủ đề trên.

KHÔNG ĐƯỢC mở đầu bằng:
- Khái niệm trừu tượng hoặc định nghĩa ("Tha thứ là...", "Nỗi sợ hãi là...")
- Đạo lý hoặc lời Phật dạy
- "Trong cuộc sống...", "Có những...", "Chúng ta thường...", "Bạn có biết..."
- Bất kỳ câu nào nghe như bài giảng hoặc sách self-help
- Từ ngữ marketing: "hook", "viral", "engagement"

BẮT BUỘC mỗi câu phải thuộc một trong các dạng:
- Một sự thật khiến người nghe giật mình
- Một điều tiếc nuối mà nhiều người từng trải qua
- Một tình huống rất đời thường
- Một nghịch lý trong cuộc sống
- Một câu khiến người nghe thấy bản thân trong đó

YÊU CẦU THÊM:
- Mỗi câu chỉ 1 câu, không quá 20 từ
- Giọng trầm tĩnh, chân thật, như người lớn tuổi kể lại điều mình đã nghiệm ra
- Phân bổ đều các dạng, không tập trung vào 1 dạng

ĐỊNH DẠNG OUTPUT:
- Chỉ xuất đúng 30 dòng
- Mỗi dòng là một câu mở đầu
- Không thêm giải thích, không tiêu đề, không markdown`;

  const hookRaw = await callAI([{ role: "user", content: hookPrompt }], 0.95, 700);
  const hooks = extractHooks(hookRaw);
  console.log(`   → ${hooks.length} hooks trích được`);

  // Bước 2: Chấm điểm → top 5 → winner
  const hooksBlock = hooks.map((h, i) => `${i + 1}. ${h}`).join("\n");
  const pickPrompt = `Chủ đề: ${topic}
Lĩnh vực: ${NICHE_NAME}

Đây là ${hooks.length} hook ứng viên:
${hooksBlock}

Nhiệm vụ: Chấm điểm từng hook theo 4 tiêu chí, sau đó chọn top 5.

TIÊU CHÍ CHẤM ĐIỂM (mỗi tiêu chí 0-10):
- Tò mò: Hook có khiến người nghe muốn biết tiếp không?
- Cảm xúc: Hook có chạm đúng cảm xúc thật không?
- Gần gũi: Hook có khiến người nghe thấy bản thân trong đó không?
- Giữ chân: Hook có đủ sức giữ người xem ở lại không?

SAU KHI CHẤM:
- Tính tổng điểm mỗi hook (max 40)
- Chọn top 5 hook có tổng điểm cao nhất
- Từ top 5, chọn 1 hook tốt nhất để dùng làm câu mở đầu

ĐỊNH DẠNG OUTPUT — theo đúng cấu trúc này:
TOP5:
[số thứ tự gốc]. [nguyên văn hook]
[số thứ tự gốc]. [nguyên văn hook]
[số thứ tự gốc]. [nguyên văn hook]
[số thứ tự gốc]. [nguyên văn hook]
[số thứ tự gốc]. [nguyên văn hook]
WINNER:
[nguyên văn hook được chọn]

Không thêm giải thích, không markdown ngoài cấu trúc trên.`;

  const pickRaw = await callAI([{ role: "user", content: pickPrompt }], 0.3, 400);
  const winnerMatch = pickRaw.match(/WINNER:\s*\n(.+)/);
  const winnerRaw = winnerMatch?.[1]?.trim() ?? "";
  const selectedHook = hooks.find((h) => h.toLowerCase() === winnerRaw.toLowerCase()) ?? hooks[0];
  console.log(`   → Hook winner: "${selectedHook}"`);

  // Bước 3: Viết script
  const scriptPrompt = `Bạn là một người từng trải, hiểu Phật pháp nhưng không giảng đạo.

Nhiệm vụ của bạn là tạo một kịch bản video ngắn khiến người xem cảm thấy nội dung đang nói đúng về cuộc đời họ.

Lĩnh vực: ${NICHE_NAME}
Chủ đề: ${topic}

Hook đã được chọn:
${selectedHook}

Nhiệm vụ:
1. Dùng đúng hook trên làm câu đầu tiên.
2. Viết toàn bộ short script hoàn chỉnh xoay quanh chính hook đó.
3. Câu đầu tiên của output phải chính là hook đã chọn, giữ nguyên wording.

YÊU CẦU QUAN TRỌNG NHẤT

Trong 3 giây đầu tiên, người xem phải muốn nghe tiếp.

KHÔNG ĐƯỢC:
- Mở đầu bằng khái niệm trừu tượng hoặc định nghĩa
- Mở đầu bằng đạo lý
- Mở đầu bằng lời Phật dạy
- Mở đầu bằng "Trong cuộc sống..."
- Mở đầu bằng bất kỳ câu nghe như bài giảng

SAU ĐÓ:
- Kể một câu chuyện nhỏ hoặc một quan sát đời thường
- Dùng hình ảnh cụ thể
- Tránh nói về khái niệm chung chung
- Mỗi câu phải dẫn sang câu tiếp theo một cách tự nhiên

Ở 20% CUỐI VIDEO:
- Lồng ghép nhẹ nhàng một bài học mang tinh thần Phật pháp
- Không trích kinh dài, không thuyết giảng
- Không dùng quá nhiều thuật ngữ tôn giáo

KẾT THÚC:
- Một câu khiến người nghe suy ngẫm thêm vài giây
- Mang cảm giác buông xuống, thức tỉnh hoặc bình an

ĐỘ DÀI: 130–170 từ

GIỌNG VĂN:
- Trầm tĩnh, chân thật
- Giống một người lớn tuổi kể lại điều mình đã nghiệm ra
- Không giống bài giảng, không giống sách self-help, không giống AI
- Xưng hô: "quý vị", "chúng ta", hoặc "người ta"
- Tuyệt đối không dùng: "hook", "twist", "viral", hay bất kỳ ngôn ngữ marketing nào

YÊU CẦU BỔ SUNG:
- Hook phải xuất hiện nguyên vẹn ở câu đầu tiên
- Các câu sau phải triển khai đúng mạch cảm xúc của hook, không bị rơi xuống giọng an toàn quá sớm
- Nội dung phải cụ thể, không triết lý chung chung

ĐỊNH DẠNG OUTPUT:
- Chỉ xuất nội dung cuối cùng
- Không tiêu đề, không markdown, không ghi chú, không emoji

Chỉ xuất script, không giải thích thêm.`;

  const shortContent = await callAI([{ role: "user", content: scriptPrompt }], 0.75, 450);
  const cleanedScript = shortContent.trim().replace(/\n{3,}/g, "\n\n");
  console.log(`   → Script (${cleanedScript.split(/\s+/).length} từ): "${cleanedScript.slice(0, 80)}..."`);

  return {
    id: randomUUID(),
    topic,
    shortContent: cleanedScript,
    selectedHook,
    hookCandidates: hooks,
  };
}

async function main() {
  console.log("🚀 Generate 6 content với prompt mới\n");
  const results = [];

  for (const topic of TOPICS) {
    try {
      const result = await generateForTopic(topic);
      results.push(result);
    } catch (err) {
      console.error(`❌ Lỗi topic "${topic}":`, err.message);
    }
  }

  console.log("\n💾 Lưu vào DB...");
  for (const r of results) {
    await pool.query(
      `INSERT INTO content_generations
         (id, topic, niche_id, niche_name, script, short_content, long_content,
          status, total_cost,
          tts_status, images_status, video_status,
          long_tts_status, long_images_status, long_video_status,
          short_hook_candidates, short_selected_hook)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',0,
               'pending','pending','pending',
               'pending','pending','pending',
               $8,$9)`,
      [
        r.id,
        r.topic,
        NICHE_ID,
        NICHE_NAME,
        "",
        r.shortContent,
        "",
        JSON.stringify(r.hookCandidates),
        r.selectedHook,
      ]
    );
    console.log(`   ✅ ${r.topic} → ${r.id}`);
  }

  console.log("\n✅ Xong! Đã tạo", results.length, "content.");
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
