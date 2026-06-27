import fs from "fs";
import path from "path";
import { fal } from "@fal-ai/client";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { musicTracks } from "@/lib/db/schema";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { callWithRetry } from "@/lib/llm/retry";
import {
  buildQuoteProfilePromptHints,
  getAudienceProfile,
  getTopicFamiliesForChannel,
} from "@/lib/prompt-studio-registry";
import {
  getBuddhistVisualCategory,
  buildBuddhistImagePrompt,
  buildBuddhistVisualMetadata,
  getHeroSubjectForCategory,
  BUDDHIST_NEGATIVE_PROMPT,
  type BuddhistVisualMetadata,
  type HeroSubjectKey,
} from "@/lib/config/buddhist-visual-categories";
import { getImageConfig } from "@/actions/app-config";
import { FAL_IMAGE_MODEL_DEFAULT, FAL_IMAGE_SIZE_DEFAULT } from "@/lib/image-config-constants";
export type { QuoteImageMeta } from "@/lib/quote-image-meta";
import {
  getWorkspaceById,
  getWorkspaceByProfileId,
} from "@/lib/channel-workspace-registry";
import {
  renderLegacyQuoteShort,
  generateLegacyQuoteText,
  harmonizeKineticTextSidecar,
  type LegacyQuoteShortMetadata,
  type KineticTextSidecar,
  type KineticChunk,
} from "@/lib/legacy-quote-short-generator";
import {
  buildFallbackQuote,
  validateQuoteText,
} from "@/lib/quotes/quote-quality";
import {
  resolveQuoteShortFormat,
  resolveQuoteVisualStyle,
  type QuoteFormatKey,
} from "@/lib/quotes/quote-style";

// initialise fal.ai credentials once at module load
fal.config({ credentials: process.env.FAL_KEY });

// ── Constants ─────────────────────────────────────────────────────────────

const OUTPUT_DIR = "output/legacy-quote-short-v1";
const IMAGE_SUBDIR = "images";
// Fal model, image size, and steps are now read from shared app_config (same as images.ts).
// Fallback values used only if getImageConfig() throws.
const FAL_MODEL_FALLBACK = FAL_IMAGE_MODEL_DEFAULT;
const FAL_IMAGE_SIZE_FALLBACK = FAL_IMAGE_SIZE_DEFAULT;
const FAL_STEPS_FALLBACK = 8;
const TANG_SAU_BG_REROLL_LIMIT = 3;
export const QS_EXPERIMENT_ID = "LEGACY_QUOTE_SHORT";
export const QS_EXPERIMENT_VARIANT = "LEGACY_QUOTE_NO_VOICE_V2";
export const QS_REFLECTION_EXPERIMENT_VARIANT = "LEGACY_QUOTE_REFLECTION_V1";
export const QS_NOTE_LETTER_EXPERIMENT_VARIANT = "LEGACY_QUOTE_NOTE_LETTER_V1";
export const QS_KINETIC_TEXT_EXPERIMENT_VARIANT = "LEGACY_QUOTE_KINETIC_TEXT_V1";
export const QS_BILINGUAL_MINIMAL_EXPERIMENT_VARIANT = "LEGACY_QUOTE_BILINGUAL_MINIMAL_V1";
export const QS_BUDDHIST_TEACHING_SINGLE_EXPERIMENT_VARIANT = "BUDDHIST_TEACHING_SINGLE_V1";
export const QS_BUDDHIST_TEACHING_NUMBERED_EXPERIMENT_VARIANT = "BUDDHIST_TEACHING_NUMBERED_V1";
export const QS_BUDDHIST_LIFE_REFLECTION_EXPERIMENT_VARIANT = "BUDDHIST_LIFE_REFLECTION_V1";
export const QS_BUDDHIST_QUOTE_BRIGHT_EXPERIMENT_VARIANT = "BUDDHIST_QUOTE_BRIGHT_V1";
const LLM_MODEL = "openai/gpt-4o-mini";

type FalResult = { data: { images: Array<{ url: string }> } };

// ── Curated topic pool ─────────────────────────────────────────────────────

const CURATED_BY_FAMILY: Record<string, string[]> = {
  // ── Strategic families (current focus sprint) ─────────────────────────────
  nhan_qua_nguoi_xau_bao_ung: [
    "Người hại bạn thật ra đang tự tạo nghiệp cho chính họ",
    "Đừng vội trả thù người làm bạn đau",
    "Tiểu nhân sợ điều này nhất",
    "Khi bị phản bội, im lặng là cách trả lời mạnh nhất",
    "Người sống ác không thắng, họ chỉ chưa đến lúc trả giá",
    "Đừng kể khổ với người từng vui khi bạn gục ngã",
    "Có 3 kiểu người càng giúp, bạn càng mất phước",
    "Báo ứng đến muộn nhưng không bao giờ quên",
    "Im lặng trước kẻ xấu là cách giữ lại phước cho mình",
    "Người bạc bẽo sẽ tự nhận ra khi họ cần đến bạn",
  ],
  buong_bo_chua_lanh: [
    "Buông bỏ để nhẹ lòng",
    "Tha thứ là giải phóng chính mình",
    "Học cách buông để tìm lại bản thân",
    "Tha thứ không phải cho người kia mà cho mình",
    "Giữ oán hận chỉ làm đau chính mình mà thôi",
    "Chữa lành vết thương từ bên trong",
    "Cô đơn đôi khi là quà để hiểu chính mình sâu hơn",
    "Nỗi đau hôm nay là cơ hội để lớn lên ngày mai",
    "Bình an đến khi ta thôi chạy theo nỗi sợ",
    "Vết thương nào cũng cần một khoảng lặng để lành",
  ],
  tri_tue_song_im_lang_nhan_nhin: [
    "Im lặng là trí tuệ của người từng trải",
    "Không phải chuyện nào cũng cần giải thích",
    "Người khôn không tranh hơn thua với kẻ không đáng",
    "Nhẫn không phải yếu, nhẫn là sức mạnh của tâm",
    "Biết lùi đúng lúc là biết thắng trong dài hạn",
    "Đôi khi im lặng là câu trả lời đanh thép nhất",
  ],
  gia_dinh_hieu_dao: [
    "Cha mẹ còn sống là phước lành lớn nhất cuộc đời",
    "Đừng để ngày hối hận mới biết trân trọng cha mẹ",
    "Hiếu thảo là nền tảng của mọi phước báo",
    "Gia đình là nhân duyên quý giá nhất đời người",
    "Phúc báo của người biết hiếu thảo đến rất sớm",
  ],
  tinh_yeu_ton_thuong: [
    "Người rời đi là để dạy ta bài học về duyên nợ",
    "Yêu sai người không có lỗi, níu lại mới là tự làm khổ mình",
    "Chia tay trong bình an là điều khó nhưng cần thiết",
    "Ngừng oán trách người cũ để lòng ta được nhẹ",
    "Duyên hết thì buông, đừng cố giữ điều không còn thuộc về mình",
  ],
  binh_yen_an_lac: [
    "Bình an trong từng hơi thở",
    "Khoảnh khắc hiện tại là quà tặng lớn nhất",
    "Tĩnh lặng là sức mạnh vô hình",
    "Sống chậm để cảm nhận sâu hơn",
    "Hạnh phúc bắt đầu từ bên trong tâm trí",
    "Một phút lặng thinh có thể cứu cả một ngày rối ren",
  ],
  phuoc_bao_nghiep_duyen: [
    "Nhân quả không bao giờ quên",
    "Gieo điều lành hôm nay gặt quả tốt ngày mai",
    "Phước lành đến từ tấm lòng thiện lành",
    "Mỗi hành động nhỏ đều để lại dấu vết trong cuộc đời",
    "Từ bi chữa lành mọi vết thương trong lòng",
    "Đời nhẹ hơn khi ta biết đủ và biết ơn",
  ],
  // ── Legacy English aliases — kept for backward compatibility ──────────────
  peace_mindfulness: [
    "Bình an trong từng hơi thở",
    "Khoảnh khắc hiện tại là quà tặng lớn nhất",
    "Tĩnh lặng là sức mạnh vô hình",
    "Sống chậm để cảm nhận sâu hơn",
    "Hạnh phúc bắt đầu từ bên trong tâm trí",
    "Một phút lặng thinh có thể cứu cả một ngày rối ren",
  ],
  letting_go_forgiveness: [
    "Buông bỏ để nhẹ lòng",
    "Tha thứ là giải phóng chính mình",
    "Học cách buông để tìm lại bản thân",
    "Tha thứ không phải cho người kia mà cho mình",
    "Giữ oán hận chỉ làm đau chính mình mà thôi",
  ],
  fear_anxiety: [
    "Vượt qua nỗi sợ bằng tâm bình",
    "Lo lắng không thay đổi được ngày mai",
    "Can đảm không phải không sợ mà vẫn bước tiếp",
    "Nỗi sợ lớn nhất thường chỉ là suy nghĩ trong đầu ta",
  ],
  karma: [
    "Nhân quả không bao giờ quên",
    "Gieo điều lành hôm nay gặt quả tốt ngày mai",
    "Phước lành đến từ tấm lòng thiện lành",
    "Mỗi hành động nhỏ đều để lại dấu vết trong cuộc đời",
  ],
  hurt_loneliness: [
    "Chữa lành vết thương từ bên trong",
    "Cô đơn đôi khi là quà để hiểu chính mình sâu hơn",
    "Nỗi đau hôm nay là cơ hội để lớn lên ngày mai",
    "Mỗi vết thương đều có thể lành theo thời gian và tình thương",
  ],
  buddhist_life_wisdom: [
    "Từ bi chữa lành mọi vết thương trong lòng",
    "Đời nhẹ hơn khi ta biết đủ và biết ơn",
    "Sống đơn giản để tâm luôn thanh thản",
    "Mỗi ngày mới là một món quà quý giá",
    "Ý nghĩa cuộc sống nằm ở chính khoảnh khắc hiện tại",
    "Trí tuệ đến từ sự trải nghiệm và chiêm nghiệm",
  ],
};

const ALL_TOPICS: string[] = Object.values(CURATED_BY_FAMILY).flat();
const TANG_SAU_TOPICS: Record<string, string[]> = {
  modern_loneliness: [
    "Có những người nói rất nhiều nhưng không ai thật sự hiểu họ",
    "Cô đơn giữa một thành phố quá đông người",
    "Có những đêm ta không buồn, chỉ thấy mình trống",
    "Điều mệt nhất không phải bận rộn mà là không còn cảm thấy mình đang sống",
  ],
  identity_choice: [
    "Điều khó nhất không phải chọn đúng mà là dám chịu trách nhiệm",
    "Có khi ta sống quá lâu trong phiên bản người khác mong muốn",
    "Bản ngã thích chiến thắng, còn nội tâm chỉ muốn được yên",
    "Nhiều lựa chọn không làm ta tự do hơn, chỉ làm ta mỏi hơn",
  ],
  inner_freedom: [
    "Tự do nhất là khi không còn phải đóng vai ai nữa",
    "Có những sợi dây không ai buộc, nhưng ta vẫn mang theo nhiều năm",
    "Khao khát tự do đôi khi chỉ là khao khát được sống thật",
    "Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều",
  ],
  books_philosophy: [
    "Có những cuốn sách không trả lời mà chỉ buộc ta nhìn lại mình",
    "Một ý tưởng đúng lúc có thể thay đổi cả cách ta sống",
    "Triết lý không làm đời dễ hơn, nhưng làm ta bớt mù hơn",
    "Sách hay không dạy ta sống, chỉ giúp ta thôi sống hời hợt",
  ],
  meaning_silence: [
    "Không phải im lặng nào cũng là trống rỗng",
    "Có những câu trả lời chỉ đến khi ta chịu ngồi yên",
    "Sự im lặng đúng lúc nói nhiều hơn mọi lời giải thích",
    "Có những ngày ta cần khoảng lặng hơn là thêm lời khuyên",
  ],
};

function getTopicPool(topicFamily?: string, channelProfileId?: string): string[] {
  if (channelProfileId === "tang_sau_v1") {
    if (topicFamily && TANG_SAU_TOPICS[topicFamily]) return TANG_SAU_TOPICS[topicFamily];
    return Object.values(TANG_SAU_TOPICS).flat();
  }
  if (topicFamily && CURATED_BY_FAMILY[topicFamily]) return CURATED_BY_FAMILY[topicFamily];
  return ALL_TOPICS;
}

// ── Public types ──────────────────────────────────────────────────────────

export type QuoteGenPreviewItem = {
  topic: string;
  topicFamily: string;
  quoteText: string;
  mainQuote: string;
  quoteSourceType?: "independent_llm" | "fallback";
  quoteModel?: string | null;
  reflectionText?: string;
  noteLetterText?: string;
  englishLine?: string;
  kineticText?: KineticTextSidecar;
  quoteStyle: "short_quote" | "reflection_card" | "note_letter" | "kinetic_quote" | "bilingual_minimal" | "static_deep_quote";
  visualMood: string;
  musicMood: string;
  visualMode: "ken_burns_image" | "quote_reflection_card" | "note_letter_card" | "kinetic_typography" | "bilingual_minimal";
  experimentVariant: string;
  channelProfileId?: string;
  workspaceId?: string;
  channelKey?: string;
  contentProfileKey?: string;
  colorPalette?: string;
  visualTemperature?: string;
  buddhistVisualMeta?: BuddhistVisualMetadata;
  tags?: import("@/lib/legacy-quote-short-generator").ContentTagFields;
};

export type QuoteGenResult = {
  ok: boolean;
  contentId: string;
  topic: string;
  quoteText: string;
  reflectionText?: string;
  videoPath: string;
  sidecarPath: string;
  renderedImagePath: string;
  /** Absolute path to the clean background image (bg.jpg). Used by the caller to persist image_paths in content_generations. */
  sourceImagePath: string;
  experimentVariant?: string;
  error?: string;
};

export type QuoteGenBatchOptions = {
  count: number;
  topicFamily?: string;
  durationSec?: number;
  channelProfileId?: string;
  workspaceId?: string;
  quoteFormat?: "short_quote" | "quote_reflection" | "note_letter_card" | "kinetic_text" | "bilingual_minimal" | "buddhist_teaching_single" | "buddhist_teaching_numbered" | "buddhist_life_reflection" | "buddhist_quote_bright";
};

function getQuoteContext(options: {
  channelProfileId?: string;
  workspaceId?: string;
  channelKey?: string;
  contentProfileKey?: string;
  nicheName?: string;
}) {
  return {
    channelProfileId: options.channelProfileId,
    workspaceId: options.workspaceId,
    channelKey: options.channelKey,
    contentProfileKey: options.contentProfileKey,
    nicheName: options.nicheName,
  };
}

async function repairQuoteTextOnce(params: {
  topic: string;
  original: string;
  channelProfileId?: string;
  workspaceId?: string;
  channelKey?: string;
  contentProfileKey?: string;
}): Promise<string | null> {
  try {
    const client = getOpenRouterClient();
    const style = resolveQuoteVisualStyle(getQuoteContext(params));
    const prompt = style.reason === "phat_phap_static_guard"
      ? [
          "Viết lại câu quote tiếng Việt thành đúng 1 quote hoàn chỉnh.",
          "Mục tiêu: sâu, người thật, bình tĩnh, giàu chiêm nghiệm, không dạy đời.",
          "Độ dài: 18-36 từ, tối đa 2 câu.",
          "Tránh tuyệt đối: buông bỏ đúng lúc, bình an trong tâm, mọi chuyện rồi sẽ qua, hãy sống chậm lại, tâm an vạn sự an, gieo nhân nào gặt quả nấy.",
          "Không dùng từ mở đầu mệnh lệnh như 'hãy'.",
          "Ưu tiên: chấp trước, oán giận, so sánh, kỳ vọng, đau âm thầm, tha thứ, vô thường, lòng trắc ẩn.",
          "Chỉ trả về quote cuối cùng.",
        ].join(" ")
      : style.reason === "tang_sau_static_guard"
        ? [
            "Viết lại câu quote tiếng Việt thành đúng 1 quote hoàn chỉnh.",
            "Mục tiêu: sắc, chín, chính xác về cảm xúc, không khoa trương, không self-help.",
            "Độ dài: 18-38 từ, tối đa 2 câu.",
            "Tránh tuyệt đối: yêu bản thân, chữa lành, phiên bản tốt hơn, mạnh mẽ lên, mọi thứ đều có lý do, vết thương nào rồi cũng lành.",
            "Ưu tiên: bị bỏ quên cảm xúc, trừng phạt im lặng, phản bội, cô đơn, tự bảo vệ, sợ làm phiền, people-pleasing, vết thương cũ, oán giận âm thầm.",
            "Chỉ trả về quote cuối cùng.",
          ].join(" ")
        : "Viết lại câu quote tiếng Việt thành một câu hoàn chỉnh, sạch, tự nhiên, chỉ trả về 1 quote cuối cùng.";

    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.45,
      max_tokens: 120,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Chủ đề: "${params.topic}". Bản nháp cần sửa: "${params.original}"`,
        },
      ],
    });
    return resp.choices[0]?.message.content?.trim() ?? null;
  } catch {
    return null;
  }
}

async function finalizeQuoteText(params: {
  topic: string;
  generated: string;
  channelProfileId?: string;
  workspaceId?: string;
  channelKey?: string;
  contentProfileKey?: string;
}): Promise<string> {
  const context = getQuoteContext(params);
  const firstPass = validateQuoteText(params.generated, context);
  if (firstPass.ok) return firstPass.normalized;

  const repaired = await repairQuoteTextOnce({
    topic: params.topic,
    original: firstPass.normalized || params.generated,
    channelProfileId: params.channelProfileId,
    workspaceId: params.workspaceId,
    channelKey: params.channelKey,
    contentProfileKey: params.contentProfileKey,
  });
  if (repaired) {
    const secondPass = validateQuoteText(repaired, context);
    if (secondPass.ok) return secondPass.normalized;
  }

  return buildFallbackQuote(context, params.topic);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function pickTopics(count: number, topicFamily?: string, channelProfileId?: string): string[] {
  const pool = getTopicPool(topicFamily, channelProfileId);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function makeContentId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 7);
  return `qgen-${ts}-${rnd}`;
}

// ── Music selection ────────────────────────────────────────────────────────

/**
 * Returns a path to a usable music track.
 * Throws `missing_background_music` if none is available — Quote Shorts require
 * background music because they have no TTS voice.
 */
export async function pickMusicPath(): Promise<string> {
  const tracks = await db
    .select({ filePath: musicTracks.filePath })
    .from(musicTracks)
    .where(and(eq(musicTracks.status, "done"), isNotNull(musicTracks.filePath)));
  const valid = tracks.filter((t) => {
    if (!t.filePath) return false;
    const abs = path.isAbsolute(t.filePath)
      ? t.filePath
      : path.join(process.cwd(), t.filePath);
    return fs.existsSync(abs);
  });
  if (valid.length === 0) {
    throw Object.assign(
      new Error(
        "missing_background_music: Không tìm thấy nhạc nền hợp lệ. " +
          "Quote Shorts cần nhạc nền vì không có TTS. " +
          "Thêm nhạc tại Settings → Nhạc nền.",
      ),
      { code: "missing_background_music" },
    );
  }
  return valid[Math.floor(Math.random() * valid.length)].filePath!;
}

// ── LLM quote generation ──────────────────────────────────────────────────

async function generateQuoteTextLLM(
  topic: string,
  options: { channelProfileId?: string; topicFamily?: string },
): Promise<string> {
  const outcome = await generateQuoteTextOutcome(topic, options);
  return outcome.quoteText;
}

async function generateQuoteTextOutcome(
  topic: string,
  options: { channelProfileId?: string; topicFamily?: string },
): Promise<{
  quoteText: string;
  quoteSourceType: "independent_llm" | "fallback";
  model: string | null;
}> {
  const isTangSau = options.channelProfileId === "tang_sau_v1";
  const channelKey = isTangSau ? "tang_sau" : "phat_phap";
  const contentProfileKey = isTangSau ? "psychology" : "buddhism";
  try {
    const client = getOpenRouterClient();
    const hints = buildQuoteProfilePromptHints(options.channelProfileId);
    const audience = getAudienceProfile(options.channelProfileId);
    const audienceCtx = audience
      ? `Người xem: ${audience.audienceDescription}. ` +
        `Nỗi đau của họ: ${audience.audiencePainPoints.slice(0, 3).join("; ")}. ` +
        `Mong muốn: ${audience.audienceDesires.slice(0, 3).join("; ")}. ` +
        `Tone họ thích: ${audience.tonePreference.slice(0, 2).join(", ")}. ` +
        `Tránh tone: ${audience.avoidedTone.slice(0, 2).join(", ")}.`
      : "";
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.85,
      max_tokens: 80,
      messages: [
        {
          role: "system",
          content:
            (isTangSau
              ? "Bạn viết đúng 1 câu quote tiếng Việt cho Tầng Sâu, về cô đơn hiện đại, phản bội, people-pleasing, tự bảo vệ, oán giận âm thầm và những vết thương cũ. "
              : "Bạn viết đúng 1 câu quote tiếng Việt cho Phật Pháp, giàu chiêm nghiệm và lòng trắc ẩn, chạm vào chấp trước, kỳ vọng, oán giận, vô thường và tha thứ. ") +
            "Câu quote phải nghe như một quan sát thật, không như khẩu hiệu. " +
            (isTangSau
              ? "Độ dài 18-38 từ, tối đa 2 câu, không dùng jargon trị liệu, không melodrama, không self-help, không lời khuyên trực diện. " +
                "Tránh tuyệt đối: yêu bản thân, chữa lành, phiên bản tốt hơn, mạnh mẽ lên, mọi thứ đều có lý do, vết thương nào rồi cũng lành. "
              : "Độ dài 18-36 từ, tối đa 2 câu, bình tĩnh, từ ái, không preachy, không fortune-cookie, không mệnh lệnh trực diện. " +
                "Tránh tuyệt đối: buông bỏ đúng lúc, bình an trong tâm, mọi chuyện rồi sẽ qua, hãy sống chậm lại, tâm an vạn sự an, gieo nhân nào gặt quả nấy. ") +
            "Chỉ trả về quote cuối cùng, không giải thích, không hashtag, không đánh số, không dấu ngoặc kép." +
            (hints
              ? ` Channel profile: ${hints.channelName}. Tone: ${hints.tone.join(", ")}. ` +
                `Ưu tiên vocabulary: ${hints.vocabulary.join(", ")}. Tránh: ${hints.avoid.join(", ")}.`
              : "") +
            (audienceCtx ? ` ${audienceCtx}` : ""),
        },
        {
          role: "user",
          content:
            `Viết một câu châm ngôn tiếng Việt về chủ đề: "${topic}". ` +
            `Topic family: ${options.topicFamily ?? "auto"}. ` +
            (isTangSau
              ? "Tập trung vào cảm giác bị bỏ quên, im lặng như trừng phạt, sợ làm phiền, lớn lên trong cảnh phải tự biến mất để được yên. "
              : "Tập trung vào xung đột nội tâm rất thật: chấp trước, kỳ vọng, so sánh, oán giận, khổ âm thầm, lòng biết thương chính mình và người khác. ") +
            "Chỉ trả về 1 quote cuối cùng.",
        },
      ],
    });
    const raw = resp.choices[0]?.message.content?.trim() ?? "";
    const cleaned = raw.replace(/^["'"'"«»]+|["'"'"«»]+$/g, "").trim();
    return {
      quoteText: await finalizeQuoteText({
        topic,
        generated: cleaned,
        channelProfileId: options.channelProfileId,
        channelKey,
        contentProfileKey,
      }),
      quoteSourceType: "independent_llm",
      model: LLM_MODEL,
    };
  } catch {
    // fall through to deterministic fallback
  }
  return {
    quoteText: await finalizeQuoteText({
      topic,
      generated: generateLegacyQuoteText(topic),
      channelProfileId: options.channelProfileId,
      channelKey,
      contentProfileKey,
    }),
    quoteSourceType: "fallback",
    model: null,
  };
}

function buildReflectionFallback(topic: string, mainQuote: string): string {
  const lower = topic.toLocaleLowerCase("vi-VN");
  if (/im lặng|khoảng lặng/.test(lower)) {
    return "Giống như mặt hồ chỉ soi rõ khi gió ngừng lại, lòng người cũng chỉ hiểu mình khi thôi cố giải thích với tất cả. Có những khoảng lặng không phải để tránh né, mà để giữ lại phần bình yên cuối cùng.";
  }
  if (/cô đơn|trống/.test(lower)) {
    return "Cô đơn không phải lúc quanh ta không có ai, mà là lúc những điều bên trong không còn nơi để đặt xuống. Nó giống căn phòng đầy đồ nhưng vẫn lạnh, vì thứ thiếu nhất lại là cảm giác được hiểu.";
  }
  if (/tự do|công nhận|sống thật/.test(lower)) {
    return "Có lúc ta tưởng tự do nằm ở việc đi xa hơn, nhưng thật ra nó bắt đầu từ khoảnh khắc không còn sống để xin ai đó gật đầu. Như tháo một chiếc áo quá chật, sự nhẹ nhõm đến trước cả niềm vui.";
  }
  if (/lựa chọn|bản ngã|chịu trách nhiệm/.test(lower)) {
    return "Nhiều người muốn một con đường không khiến mình hối hận, nhưng trưởng thành thường bắt đầu ở chỗ dám đi và dám trả giá cho lựa chọn đó. Như bước qua chiếc cầu hẹp, điều giữ ta vững không phải chắc chắn mà là quyết tâm.";
  }
  if (/sách|triết|ý tưởng/.test(lower)) {
    return "Một câu đúng lúc không đổi cuộc đời ngay lập tức, nhưng nó giống hạt bụi nhỏ rơi vào mắt: đủ để buộc ta dừng lại và nhìn khác đi. Từ đó, cách sống cũ bắt đầu trở nên không còn vừa vặn nữa.";
  }
  return `Có những điều nghe rất nhỏ, nhưng ở lại trong lòng rất lâu. ${mainQuote} giống như một vệt sáng mỏng trong căn phòng tối: không giải quyết mọi thứ ngay, nhưng đủ để ta nhìn rõ mình đang mệt vì điều gì và nên buông điều gì trước.`;
}

const TANG_SAU_AVOID_TERMS =
  "Phật, nghiệp, duyên, vô thường, giác ngộ, tỉnh thức, an nhiên, bình an trong tâm, tâm hồn, bản ngã, " +
  "chữa lành, vũ trụ, ánh sáng, biết ơn, hành trình, khởi đầu mới, thành công, ước mơ, tích cực, " +
  "nghị lực, truyền cảm hứng, nội tâm, ý nghĩa sâu xa, món quà";

async function generateReflectionQuoteLLM(
  topic: string,
  options: { channelProfileId?: string; topicFamily?: string },
): Promise<{ mainQuote: string; reflectionText: string }> {
  const isTangSau = options.channelProfileId === "tang_sau_v1";
  const channelKey = isTangSau ? "tang_sau" : "phat_phap";
  const contentProfileKey = isTangSau ? "psychology" : "buddhism";
  try {
    const client = getOpenRouterClient();
    const hints = buildQuoteProfilePromptHints(options.channelProfileId);
    const audience = getAudienceProfile(options.channelProfileId);
    const audienceCtx = audience
      ? `Người xem: ${audience.audienceDescription}. ` +
        `Nỗi đau: ${audience.audiencePainPoints.slice(0, 3).join("; ")}. ` +
        `Mong muốn: ${audience.audienceDesires.slice(0, 3).join("; ")}.`
      : "";
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.9,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Bạn viết nội dung quote tiếng Việt cho video dọc kiểu reflection card. " +
            "Trả về strict JSON với keys mainQuote, reflectionText. " +
            (isTangSau
              ? "mainQuote: 18-38 từ, sắc gọn, chạm cảm xúc, đời thường, không hoa mỹ. " +
                "reflectionText: 25-55 từ, 1-2 câu ngắn, quan sát hoặc phản chiếu nhẹ, không giải thích dài dòng. " +
                `Tránh tuyệt đối: ${TANG_SAU_AVOID_TERMS}. `
              : "mainQuote: 18-36 từ, sắc gọn, giàu cảm xúc nhưng không preachy. " +
                "reflectionText: 25-70 từ, 1-3 câu ngắn, mang tính ẩn dụ hoặc phản chiếu. ") +
            "Không dùng markdown, không hashtag, không ngoặc kép, không quý vị. " +
            (hints
              ? `Channel profile: ${hints.channelName}. Tone: ${hints.tone.join(", ")}. ` +
                `Ưu tiên vocabulary: ${hints.vocabulary.join(", ")}. Tránh: ${hints.avoid.join(", ")}.`
              : "") +
            (audienceCtx ? ` ${audienceCtx}` : ""),
        },
        {
          role: "user",
          content:
            `Chủ đề: "${topic}". Topic family: ${options.topicFamily ?? "auto"}. ` +
            (isTangSau
              ? "Phong cách: đời thường, hiện đại, cảm xúc chính xác, hơi đau nhẹ, im lặng, không hùng tráng, không Phật giáo, không chữa lành. " +
                "Ưu tiên chủ đề: mệt, im lặng, bị hiểu lầm, một mình, người cũ, trưởng thành, không còn muốn giải thích. "
              : "Phong cách: triết lý, nội tâm, đời sống hiện đại. ") +
            "Tránh đóng khung Phật giáo trực diện, tránh từ Phật, nhân quả, nghiệp, chánh niệm, từ bi, phước.",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "quote_reflection_card",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              mainQuote: { type: "string" },
              reflectionText: { type: "string" },
            },
            required: ["mainQuote", "reflectionText"],
          },
        },
      },
    });
    const raw = resp.choices[0]?.message.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { mainQuote?: string; reflectionText?: string };
    const mainQuote = (parsed.mainQuote ?? "").replace(/\s+/g, " ").trim();
    const reflectionText = (parsed.reflectionText ?? "").replace(/\s+/g, " ").trim();
    const mainWords = mainQuote.split(/\s+/).filter(Boolean).length;
    const reflectionWords = reflectionText.split(/\s+/).filter(Boolean).length;
    const mainOk = mainWords >= 18 && mainWords <= (isTangSau ? 38 : 36);
    const reflOk = reflectionWords >= 25 && reflectionWords <= (isTangSau ? 55 : 70);
    if (mainQuote && reflectionText && mainOk && reflOk) {
      return {
        mainQuote: await finalizeQuoteText({
          topic,
          generated: mainQuote,
          channelProfileId: options.channelProfileId,
          channelKey,
          contentProfileKey,
        }),
        reflectionText,
      };
    }
  } catch {
    // fall through
  }

  const mainQuote = await generateQuoteTextLLM(topic, options);
  return {
    mainQuote,
    reflectionText: buildReflectionFallback(topic, mainQuote),
  };
}

// ── Tầng Sâu-only LLM generators ─────────────────────────────────────────

function buildNoteLetterFallback(topic: string): string {
  const lower = topic.toLocaleLowerCase("vi-VN");
  if (/mệt|kiệt sức|không còn sức/.test(lower)) {
    return "LỜI NHẮN\n\nCó những ngày,\nmột tin nhắn cũng làm mình thấy mệt.\n\nKhông phải vì ghét ai.\nChỉ là mình không còn đủ sức\nđể trả lời như chưa có gì xảy ra.";
  }
  if (/im lặng|không nói|thôi giải thích/.test(lower)) {
    return "LỜI NHẮN\n\nĐôi khi mình không im lặng\nvì không có gì để nói.\n\nMình im lặng vì đã giải thích\nquá nhiều lần rồi.\nVà lần nào cũng không đến đâu.";
  }
  if (/một mình|cô đơn|không ai hiểu/.test(lower)) {
    return "LỜI NHẮN\n\nCó những lúc,\nquanh mình đầy người\nmà vẫn thấy trống.\n\nKhông ai sai.\nChỉ là mình đang ở\nchỗ không ai tới được.";
  }
  return "LỜI NHẮN\n\nCó những thứ không cần nói thành lời.\nMình chỉ cần biết rằng mình biết.\n\nVà đôi khi, chỉ vậy thôi\ncũng đủ để tiếp tục.";
}

async function generateNoteLetterCardLLM(
  topic: string,
  options: { topicFamily?: string },
): Promise<string> {
  try {
    const client = getOpenRouterClient();
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.92,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Bạn viết một mảnh giấy nhắn / nhật ký ngắn bằng tiếng Việt. " +
            "Viết theo định dạng ghi chú cá nhân, không phải châm ngôn. " +
            "35-90 từ. 3-6 dòng ngắn. Mỗi dòng kết thúc bằng dấu xuống hàng thực sự. " +
            "Không viết tiêu đề 'LỜI NHẮN'. Không viết essay. Không viết câu khẩu hiệu. " +
            `Tránh tuyệt đối: ${TANG_SAU_AVOID_TERMS}. ` +
            "Tone: đời thường, hơi mệt, im lặng, không giải thích, cảm xúc chính xác.",
        },
        {
          role: "user",
          content:
            `Chủ đề: "${topic}". Topic family: ${options.topicFamily ?? "auto"}. ` +
            "Viết như đang nhắn nhủ cho chính mình. " +
            "Ưu tiên: mệt, im lặng, bị hiểu lầm, một mình, không còn muốn, ngày rất dài, cuộc gọi, tin nhắn, người cũ, cố tỏ ra ổn.",
        },
      ],
    });
    const raw = (resp.choices[0]?.message.content ?? "").trim();
    const cleaned = raw.replace(/^["'"'"«»]+|["'"'"«»]+$/g, "").trim();
    const words = cleaned.split(/\s+/).filter(Boolean).length;
    const lines = cleaned.split(/\n/).filter((l) => l.trim().length > 0);
    if (words >= 30 && words <= 100 && lines.length >= 2) return cleaned;
  } catch {
    // fall through
  }
  return buildNoteLetterFallback(topic);
}

function buildKineticTextFallback(topic: string): KineticTextSidecar {
  const lower = topic.toLocaleLowerCase("vi-VN");
  if (/im lặng|rời đi|mất liên lạc/.test(lower)) {
    return {
      chunks: [
        { text: "Có những người", emphasis: false, size: "medium" },
        { text: "không rời đi", emphasis: true, size: "large" },
        { text: "họ chỉ", emphasis: false, size: "small" },
        { text: "im lặng dần.", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["không rời đi", "im lặng dần."],
      microReflection:
        "Có những người từng nói rất nhiều,\n" +
        "vì lúc đó họ còn nghĩ mình sẽ được nghe.\n\n" +
        "Đến một lúc, họ hiểu rằng nói thêm cũng chỉ làm câu chuyện dài hơn,\n" +
        "chứ không làm người kia hiểu hơn.\n" +
        "Thế là họ bớt nói,\n" +
        "rồi im luôn.",
    };
  }
  if (/mệt|không còn sức|kiệt/.test(lower)) {
    return {
      chunks: [
        { text: "Không phải", emphasis: false, size: "medium" },
        { text: "lười biếng.", emphasis: true, size: "large" },
        { text: "Chỉ là", emphasis: false, size: "small" },
        { text: "mệt thật sự.", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["lười biếng.", "mệt thật sự."],
      microReflection:
        "Có những ngày người ta không yếu đi vì một chuyện lớn,\n" +
        "mà vì quá nhiều thứ nhỏ cứ dồn lên nhau.\n\n" +
        "Tin nhắn phải trả lời,\n" +
        "gương mặt phải giữ bình thường,\n" +
        "câu hỏi phải né cho khéo.\n" +
        "Mệt nhất là lúc chẳng còn chỗ nào để đặt mình xuống.",
    };
  }
  return {
    chunks: [
      { text: "Có những ngày", emphasis: false, size: "medium" },
      { text: "ta chỉ muốn", emphasis: false, size: "small" },
      { text: "được yên.", emphasis: true, size: "xlarge" },
      { text: "Không hơn không kém.", emphasis: true, size: "large" },
    ],
    accentWords: ["được yên.", "Không hơn không kém."],
    microReflection:
      "Có những lúc mình không cần ai kéo ra khỏi cảm giác nặng nề ấy ngay lập tức.\n" +
      "Chỉ cần một khoảng đủ yên để thở chậm lại,\n" +
      "để không phải gồng lên cho giống người vẫn ổn.\n\n" +
      "Nhiều khi điều thiếu nhất không phải lời khuyên,\n" +
      "mà là một chỗ cho mình được mệt.",
  };
}

function buildKineticMicroReflectionFallback(topic: string): string {
  const lower = topic.toLocaleLowerCase("vi-VN");
  if (/im lặng|rời đi|giải thích|hiểu lầm/.test(lower)) {
    return [
      "Có những người từng rất muốn nói hết lòng mình.",
      "Họ nhắn dài, giải thích kỹ,",
      "thậm chí tự trách mình vì sợ người kia buồn.",
      "",
      "Nhưng sau vài lần vẫn bị hiểu sai,",
      "họ học cách dừng lại.",
      "Không phải vì hết thương,",
      "mà vì đã quá mệt để tiếp tục chứng minh.",
    ].join("\n");
  }
  if (/mệt|kiệt|cạn sức|quá tải/.test(lower)) {
    return [
      "Có những ngày mình không gục vì một chuyện nào quá lớn.",
      "Mọi thứ chỉ lặng lẽ dồn lên nhau,",
      "từ tin nhắn chưa trả lời đến gương mặt phải giữ bình thường.",
      "",
      "Đến cuối ngày,",
      "điều mệt nhất không phải công việc,",
      "mà là cảm giác mình không còn chỗ nào để buông vai xuống.",
    ].join("\n");
  }
  if (/cô đơn|một mình|trống/.test(lower)) {
    return [
      "Có những buổi tối nhìn ngoài thì rất yên,",
      "nhưng bên trong lại đầy những điều không biết đặt vào đâu.",
      "",
      "Không hẳn vì buồn một chuyện nào cụ thể,",
      "chỉ là có quá nhiều thứ không thể kể vừa trong một câu.",
      "Nên mình để chúng nằm đó,",
      "rồi thấy căn phòng rộng hơn,",
      "mà lòng thì chật hơn một chút.",
    ].join("\n");
  }
  return [
    "Có những điều không ập đến một lần cho xong.",
    "Chúng ở lại theo kiểu âm ỉ,",
    "như tiếng quạt chạy suốt đêm trong một căn phòng kín.",
    "",
    "Ban đầu mình vẫn sống bình thường,",
    "nhưng càng để lâu càng mệt.",
    "Không phải vì đau hơn,",
    "mà vì phải sống cạnh nó quá lâu.",
  ].join("\n");
}

async function generateKineticTextLLM(
  topic: string,
  options: { topicFamily?: string },
): Promise<{ quoteText: string; kineticText: KineticTextSidecar }> {
  try {
    const client = getOpenRouterClient();
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.9,
      max_tokens: 250,
      messages: [
        {
          role: "system",
          content:
            "Bạn tạo nội dung kinetic typography tiếng Việt cho video ngắn dọc. " +
            "Trả về strict JSON với keys: quoteText, chunks, accentWords, microReflection. " +
            "quoteText: 12-28 từ tiếng Việt, ngắn, sắc, đời thường. " +
            "chunks: 4-8 phần, mỗi phần là { text, emphasis (bool), size (small|medium|large|xlarge) }. " +
            "Đánh dấu 1-3 chunks là emphasis=true (các từ/cụm quan trọng nhất). " +
            "accentWords: mảng 1-3 chuỗi là text của các chunk emphasis. " +
            "microReflection: 35-90 từ tiếng Việt, 4-8 dòng ngắn, giữ line breaks bằng \\n, không markdown, không bullet, không hashtag. " +
            "microReflection phải rõ ý, đủ nghĩa, có đầu có cuối, và thêm ngữ cảnh cảm xúc chứ không lặp lại nguyên văn quoteText. " +
            "Cho phép 3 độ dài: short 35-50 từ, medium 50-70 từ, long 70-90 từ. " +
            "Tone: đời thường, modern, emotionally precise, quiet, slightly painful. Không grandiose. Không self-help. Không quá mơ hồ hoặc quá thơ nếu thiếu ý nghĩa. " +
            "Không viết tiếng Anh. Không giải thích ngoài JSON. Không châm ngôn Phật giáo. " +
            `Tránh: ${TANG_SAU_AVOID_TERMS}. ` +
            "Cũng tránh: Phật, nghiệp, duyên, vô thường, giác ngộ, tỉnh thức, an nhiên, bình an trong tâm, tâm hồn, bản ngã, chữa lành, vũ trụ, ánh sáng, biết ơn, hành trình, khởi đầu mới, thành công, ước mơ, tích cực, nghị lực, truyền cảm hứng, quý vị.",
        },
        {
          role: "user",
          content:
            `Chủ đề: "${topic}". Topic family: ${options.topicFamily ?? "auto"}. ` +
            "Tạo kinetic text ngắn làm hook chính, rồi thêm microReflection như một quan sát cá nhân lặng, rõ, và đủ nghĩa. " +
            "microReflection nên đọc như một đoạn note được bẻ dòng đẹp: có bối cảnh, có chuyển ý, có cảm giác khép lại tự nhiên; không như lời khuyên. " +
            "Ví dụ chunks: ['Có những người', 'không rời đi', 'họ chỉ', 'im lặng dần']",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "kinetic_text",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              quoteText: { type: "string" },
              chunks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: { type: "string" },
                    emphasis: { type: "boolean" },
                    size: { type: "string", enum: ["small", "medium", "large", "xlarge"] },
                  },
                  required: ["text", "emphasis", "size"],
                },
              },
              accentWords: { type: "array", items: { type: "string" } },
              microReflection: { type: "string" },
            },
            required: ["quoteText", "chunks", "accentWords", "microReflection"],
          },
        },
      },
    });
    const raw = resp.choices[0]?.message.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as {
      quoteText?: string;
      chunks?: KineticChunk[];
      accentWords?: string[];
      microReflection?: string;
    };
    const quoteText = (parsed.quoteText ?? "").replace(/\s+/g, " ").trim();
    const chunks = (parsed.chunks ?? []).filter(
      (c): c is KineticChunk =>
        typeof c.text === "string" &&
        c.text.length > 0 &&
        typeof c.emphasis === "boolean" &&
        ["small", "medium", "large", "xlarge"].includes(c.size),
    );
    const accentWords = (parsed.accentWords ?? []).filter((w) => typeof w === "string");
    const microReflection = (parsed.microReflection ?? "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const totalWords = quoteText.split(/\s+/).filter(Boolean).length;
    const reflectionWords = microReflection.split(/\s+/).filter(Boolean).length;
    const reflectionLines = microReflection.split("\n").filter((line) => line.trim().length > 0).length;
    if (
      quoteText &&
      chunks.length >= 4 &&
      chunks.length <= 8 &&
      totalWords >= 10 &&
      totalWords <= 30 &&
      microReflection &&
      reflectionWords >= 35 &&
      reflectionWords <= 95 &&
      reflectionLines >= 4 &&
      reflectionLines <= 8 &&
      microReflection.replace(/\s+/g, " ").trim() !== quoteText
    ) {
      return {
        quoteText,
        kineticText: harmonizeKineticTextSidecar({ chunks, accentWords, microReflection }, quoteText),
      };
    }
  } catch {
    // fall through
  }
  const fallback = buildKineticTextFallback(topic);
  const quoteText = fallback.chunks.map((c) => c.text).join(" ");
  return {
    quoteText,
    kineticText: harmonizeKineticTextSidecar(
      {
        ...fallback,
        microReflection: fallback.microReflection ?? buildKineticMicroReflectionFallback(topic),
      },
      quoteText,
    ),
  };
}

function buildBilingualFallback(topic: string): { englishLine: string; vietnameseLine: string } {
  const lower = topic.toLocaleLowerCase("vi-VN");
  if (/im lặng|rời đi/.test(lower)) {
    return {
      englishLine: "Some people don't leave.\nThey just go quiet.",
      vietnameseLine: "Có những người không rời đi.\nHọ chỉ im lặng dần.",
    };
  }
  if (/mệt|kiệt sức/.test(lower)) {
    return {
      englishLine: "It's not laziness.\nIt's just exhaustion.",
      vietnameseLine: "Không phải lười biếng.\nChỉ là mệt thật sự.",
    };
  }
  if (/một mình|cô đơn/.test(lower)) {
    return {
      englishLine: "Being alone and feeling lonely\nare two different things.",
      vietnameseLine: "Ở một mình và cảm thấy cô đơn\nlà hai điều khác nhau.",
    };
  }
  return {
    englishLine: "Some things don't need explaining.\nThey just are.",
    vietnameseLine: "Có những thứ không cần giải thích.\nChúng chỉ là vậy.",
  };
}

async function generateBilingualMinimalLLM(
  topic: string,
  options: { topicFamily?: string },
): Promise<{ quoteText: string; englishLine: string }> {
  try {
    const client = getOpenRouterClient();
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.88,
      max_tokens: 180,
      messages: [
        {
          role: "system",
          content:
            "Bạn viết nội dung bilingual minimal cho video ngắn. " +
            "Trả về strict JSON: englishText (tiếng Anh), vietnameseText (tiếng Việt). " +
            "englishText: 8-24 từ, đơn giản, tự nhiên, 1-2 dòng. Không dùng: Every day is a new beginning, Believe in yourself, Follow your dreams, Stay positive, Success will come. " +
            "vietnameseText: 8-28 từ, cảm xúc hơn bản tiếng Anh, không dịch máy, 1-2 dòng. " +
            `Tránh: ${TANG_SAU_AVOID_TERMS}. ` +
            "Tone: im lặng, đời thường, cảm xúc chính xác, hơi đau nhẹ.",
        },
        {
          role: "user",
          content:
            `Chủ đề: "${topic}". Topic family: ${options.topicFamily ?? "auto"}. ` +
            "Viết bilingual theo phong cách Tầng Sâu: modern, emotionally precise, quiet. " +
            "Ưu tiên: mệt, im lặng, bị hiểu lầm, một mình, người cũ, trưởng thành.",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "bilingual_minimal",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              englishText: { type: "string" },
              vietnameseText: { type: "string" },
            },
            required: ["englishText", "vietnameseText"],
          },
        },
      },
    });
    const raw = resp.choices[0]?.message.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { englishText?: string; vietnameseText?: string };
    const englishText = (parsed.englishText ?? "").replace(/\s+/g, " ").trim();
    const vietnameseText = (parsed.vietnameseText ?? "").replace(/\s+/g, " ").trim();
    const enWords = englishText.split(/\s+/).filter(Boolean).length;
    const vnWords = vietnameseText.split(/\s+/).filter(Boolean).length;
    if (englishText && vietnameseText && enWords >= 5 && enWords <= 30 && vnWords >= 5 && vnWords <= 35) {
      return { quoteText: vietnameseText, englishLine: englishText };
    }
  } catch {
    // fall through
  }
  const fallback = buildBilingualFallback(topic);
  return { quoteText: fallback.vietnameseLine, englishLine: fallback.englishLine };
}

// ── Buddhist format LLM generators ────────────────────────────────────────

function buildBuddhistAudienceContext(): string {
  const audience = getAudienceProfile("buddhist_healing_v1");
  if (!audience) return "";
  return (
    `Người xem: ${audience.audienceDescription}. ` +
    `Nỗi đau của họ: ${audience.audiencePainPoints.slice(0, 3).join("; ")}. ` +
    `Mong muốn: ${audience.audienceDesires.slice(0, 3).join("; ")}. ` +
    `Tone họ thích: ${audience.tonePreference.slice(0, 2).join(", ")}.`
  );
}

const BUDDHIST_FAMILY_CONTEXT: Record<string, string> = {
  nhan_qua_nguoi_xau_bao_ung:
    "Nội dung xoay quanh nhân quả, người xấu tự nhận báo ứng, đừng trả thù — để nhân quả lo. Cảm xúc: tức giận được giải phóng, lòng được nhẹ. Tone: khẳng định, có lửa nhưng không căm thù.",
  buong_bo_chua_lanh:
    "Nội dung về buông bỏ, chữa lành vết thương tâm hồn, thôi gánh nặng người khác. Tone: ấm áp, nhẹ nhàng, chữa lành.",
  tri_tue_song_im_lang_nhan_nhin:
    "Nội dung về trí tuệ sống, im lặng có sức mạnh, nhẫn nhịn không phải yếu đuối. Tone: điềm tĩnh, sâu sắc, mạnh mẽ thầm lặng.",
  gia_dinh_hieu_dao:
    "Nội dung về gia đình, hiếu đạo, cha mẹ, ơn nghĩa. Tone: gần gũi, cảm động, trân trọng.",
  tinh_yeu_ton_thuong:
    "Nội dung về tình yêu, bị tổn thương, phản bội, học cách yêu đúng cách. Tone: đồng cảm, chữa lành, không oán giận.",
  binh_yen_an_lac:
    "Nội dung về bình yên nội tâm, sống an lạc, không bị kéo bởi thế gian. Tone: thanh thản, nhẹ nhàng.",
  phuoc_bao_nghiep_duyen:
    "Nội dung về phước báo, nghiệp duyên, gieo nhân thiện gặt quả lành. Tone: khích lệ, hy vọng.",
};

function buildBuddhistFamilyContext(topicFamily?: string): string {
  if (!topicFamily) return "";
  const ctx = BUDDHIST_FAMILY_CONTEXT[topicFamily];
  return ctx ? `\nHướng nội dung: ${ctx}` : "";
}

// Safe attribution openers — no implicit Buddha/sutra attribution
const SAFE_ATTRIBUTION_OPENERS = [
  "Một lời nhắc theo tinh thần Phật pháp:",
  "Góc nhìn nhân quả:",
  "Có những điều trong đời nên nhớ:",
  "Một lời nhắc để sống nhẹ lòng hơn:",
];

function pickSafeOpener(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return SAFE_ATTRIBUTION_OPENERS[hash % SAFE_ATTRIBUTION_OPENERS.length];
}

async function generateBuddhistTeachingSingleLLM(topic: string, topicFamily?: string): Promise<string> {
  try {
    const client = getOpenRouterClient();
    const audienceCtx = buildBuddhistAudienceContext();
    const familyCtx = buildBuddhistFamilyContext(topicFamily);
    const opener = pickSafeOpener(topic);
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.75,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Bạn viết lời nhắc theo tinh thần Phật pháp cho video ngắn kênh Phật pháp Việt Nam. " +
            `Mở đầu bằng '${opener}' rồi xuống dòng, viết nội dung. ` +
            "Nội dung: 18-36 từ, tối đa 2 câu, ngắn gọn nhưng giàu quan sát đời sống, đọc một mình vẫn hiểu ngay. " +
            "KHÔNG quy nạp lời nói cho Đức Phật hay bất kỳ danh nhân nào nếu không có nguồn cụ thể. " +
            "Không dùng ngôn ngữ học thuật khô khan. Không trích dẫn kinh điển cụ thể. " +
            "Tránh tuyệt đối: buông bỏ đúng lúc, bình an trong tâm, mọi chuyện rồi sẽ qua, hãy sống chậm lại, tâm an vạn sự an, gieo nhân nào gặt quả nấy. " +
            "Không có chú thích, không có câu hỏi tu từ. Chỉ trả về đoạn văn thuần túy." +
            familyCtx +
            "\n" + audienceCtx,
        },
        {
          role: "user",
          content: `Chủ đề: "${topic}". Viết một lời nhắc theo tinh thần Phật pháp ngắn gọn, cảm xúc, dễ chia sẻ.`,
        },
      ],
    });
    const text = (resp.choices[0]?.message.content ?? "").trim();
    return await finalizeQuoteText({
      topic,
      generated: text,
      channelKey: "phat_phap",
      contentProfileKey: "buddhism",
      channelProfileId: "buddhist_healing_v1",
    });
  } catch {
    // fall through
  }
  const opener = pickSafeOpener(topic);
  return finalizeQuoteText({
    topic,
    generated: `${opener}\nCó những nặng lòng không vì đời quá khắt khe, mà vì ta còn giữ mãi một mong cầu chưa chịu lắng xuống.`,
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
    channelProfileId: "buddhist_healing_v1",
  });
}

async function generateBuddhistTeachingNumberedLLM(
  topic: string,
  options: { number?: number; topicFamily?: string },
): Promise<{ quoteText: string; teachingNumber: number }> {
  const num = options.number ?? Math.floor(Math.random() * 7) + 1;
  try {
    const client = getOpenRouterClient();
    const audienceCtx = buildBuddhistAudienceContext();
    const familyCtx = buildBuddhistFamilyContext(options.topicFamily);
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.75,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Bạn viết lời nhắc có đánh số theo tinh thần Phật pháp cho video ngắn kênh Phật pháp Việt Nam. " +
            `Bắt đầu bằng 'Nhắc nhở thứ ${num}:' rồi xuống dòng, viết nội dung. ` +
            "Nội dung: 18-36 từ, súc tích, cảm xúc, dễ nhớ, đọc một mình vẫn hiểu ngay. " +
            "KHÔNG quy nạp lời nói cho Đức Phật hay bất kỳ danh nhân nào nếu không có nguồn cụ thể. " +
            "Không trích kinh điển cụ thể. Không câu hỏi tu từ. " +
            "Tránh tuyệt đối: buông bỏ đúng lúc, bình an trong tâm, mọi chuyện rồi sẽ qua, hãy sống chậm lại, tâm an vạn sự an, gieo nhân nào gặt quả nấy. " +
            "Chỉ trả về văn bản thuần túy." +
            familyCtx +
            "\n" + audienceCtx,
        },
        {
          role: "user",
          content: `Chủ đề: "${topic}". Viết nhắc nhở thứ ${num} ngắn gọn, cảm xúc, theo tinh thần Phật pháp.`,
        },
      ],
    });
    const text = (resp.choices[0]?.message.content ?? "").trim();
    return {
      quoteText: await finalizeQuoteText({
        topic,
        generated: text,
        channelKey: "phat_phap",
        contentProfileKey: "buddhism",
        channelProfileId: "buddhist_healing_v1",
      }),
      teachingNumber: num,
    };
  } catch {
    // fall through
  }
  return {
    quoteText: await finalizeQuoteText({
      topic,
      generated: `Nhắc nhở thứ ${num}:\nKhi không còn cố ép người khác hiểu nỗi lòng mình, ta mới thấy phần mệt nhất bấy lâu thật ra nằm ở sự chấp giữ của chính mình.`,
      channelKey: "phat_phap",
      contentProfileKey: "buddhism",
      channelProfileId: "buddhist_healing_v1",
    }),
    teachingNumber: num,
  };
}

async function generateBuddhistLifeReflectionLLM(topic: string, topicFamily?: string): Promise<{ quoteText: string; reflectionText: string }> {
  try {
    const client = getOpenRouterClient();
    const audienceCtx = buildBuddhistAudienceContext();
    const familyCtx = buildBuddhistFamilyContext(topicFamily);
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.8,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "Bạn viết nội dung 'Phật pháp giữa đời thường' cho video ngắn kênh Phật pháp Việt Nam. " +
            "Trả về strict JSON: mainQuote (câu chính, 18-36 từ, bắt đầu bằng 'Phật pháp giữa đời thường...'), reflectionText (đoạn suy ngẫm, 30-50 từ, ấm áp, gần gũi, kết nối với cuộc sống thực, cảm xúc, dễ chia sẻ). " +
            "KHÔNG quy nạp lời nói cho Đức Phật hay bất kỳ danh nhân nào nếu không có nguồn cụ thể. " +
            "Không trích dẫn kinh điển cụ thể. Không dùng từ ngữ khô khan hàn lâm. Ngôn ngữ: gần gũi, từ bi, thực tiễn. " +
            "Tránh tuyệt đối: buông bỏ đúng lúc, bình an trong tâm, mọi chuyện rồi sẽ qua, hãy sống chậm lại, tâm an vạn sự an, gieo nhân nào gặt quả nấy." +
            familyCtx +
            "\n" + audienceCtx,
        },
        {
          role: "user",
          content: `Chủ đề: "${topic}". Viết nội dung Phật pháp giữa đời thường, ngắn gọn và dễ chia sẻ.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "buddhist_life_reflection",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              mainQuote: { type: "string" },
              reflectionText: { type: "string" },
            },
            required: ["mainQuote", "reflectionText"],
          },
        },
      },
    });
    const raw = resp.choices[0]?.message.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { mainQuote?: string; reflectionText?: string };
    const main = (parsed.mainQuote ?? "").trim();
    const reflection = (parsed.reflectionText ?? "").trim();
    if (main && reflection && main.split(/\s+/).length >= 8) {
      return {
        quoteText: await finalizeQuoteText({
          topic,
          generated: main,
          channelKey: "phat_phap",
          contentProfileKey: "buddhism",
          channelProfileId: "buddhist_healing_v1",
        }),
        reflectionText: reflection,
      };
    }
  } catch {
    // fall through
  }
  return {
    quoteText: await finalizeQuoteText({
      topic,
      generated: "Phật pháp giữa đời thường nhắc ta rằng nhiều nỗi khổ kéo dài không vì đời quá nặng, mà vì trong lòng ta còn cố giữ một điều đã đến lúc phải nhìn cho thật rõ.",
      channelKey: "phat_phap",
      contentProfileKey: "buddhism",
      channelProfileId: "buddhist_healing_v1",
    }),
    reflectionText: `Trong nhịp sống bận rộn hàng ngày, không cần phải tìm đến chùa hay ngồi thiền hàng giờ. Chỉ cần một khoảnh khắc dừng lại, thở sâu và nhìn thấy điều tốt đẹp xung quanh — đó đã là thực hành rồi.`,
  };
}

async function generateBuddhistQuoteBrightLLM(topic: string, topicFamily?: string): Promise<string> {
  try {
    const client = getOpenRouterClient();
    const audienceCtx = buildBuddhistAudienceContext();
    const familyCtx = buildBuddhistFamilyContext(topicFamily);
    const resp = await client.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.8,
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content:
            "Bạn viết câu nhắc nhở an lành theo tinh thần Phật pháp cho video ngắn kênh Phật pháp Việt Nam. " +
            "Câu văn: 18-36 từ, tươi sáng nhưng không sáo rỗng, ấm áp, có sức nâng đỡ, đọc một mình vẫn hiểu ngay. " +
            "KHÔNG quy nạp lời nói cho Đức Phật hay bất kỳ danh nhân nào nếu không có nguồn cụ thể. " +
            "Không dùng: buồn, đau, cô đơn, sợ hãi, tối tăm, u ám. " +
            "Ưu tiên: ánh sáng, hoa sen, từ bi, bình an, hy vọng, niềm vui, lòng biết ơn. " +
            "Tránh tuyệt đối: buông bỏ đúng lúc, bình an trong tâm, mọi chuyện rồi sẽ qua, hãy sống chậm lại, tâm an vạn sự an, gieo nhân nào gặt quả nấy. " +
            "Không trích kinh điển cụ thể. Chỉ trả về câu văn thuần túy, không giải thích." +
            familyCtx +
            "\n" + audienceCtx,
        },
        {
          role: "user",
          content: `Chủ đề: "${topic}". Viết một câu nhắc nhở an lành, tươi sáng, dễ chia sẻ về chủ đề này.`,
        },
      ],
    });
    const text = (resp.choices[0]?.message.content ?? "").trim();
    return await finalizeQuoteText({
      topic,
      generated: text,
      channelKey: "phat_phap",
      contentProfileKey: "buddhism",
      channelProfileId: "buddhist_healing_v1",
    });
  } catch {
    // fall through
  }
  return finalizeQuoteText({
    topic,
    generated: "Mỗi ngày thức dậy đều là dịp để lòng mình bớt chật hơn một chút, nhờ biết thương người khác mà cũng biết dịu lại với chính nỗi mệt của mình.",
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
    channelProfileId: "buddhist_healing_v1",
  });
}

// ── Fal.ai image generation ────────────────────────────────────────────────

export type ImagePromptContext = {
  channelProfileId?: string;
  workspaceId?: string;
  channelKey?: string;
  contentProfileKey?: string;
};

export type TangSauSceneCategory =
  | "urban_city"
  | "indoor_objects"
  | "nature_scenery"
  | "warm_evening"
  | "dark_moody"
  | "minimal_person";

export type TangSauSceneEntry = {
  scene: string;
  category: TangSauSceneCategory;
  /** Primarily dark or night-time scene */
  isDark: boolean;
  /** Contains any human figure */
  hasPerson: boolean;
};

/**
 * Tầng Sâu visual scene pool — 36 entries across 6 categories.
 *
 * Visual direction: bright, clean, modern editorial, airy — not gloomy.
 * Not Buddhist/spiritual. Not muted olive/sepia. Dark scenes < 6%.
 *
 * Mix policy:
 *   - Bright interior  40% (14/36) — indoor_objects + 2 minimal_person
 *   - Bright city      25% (9/36)  — urban_city    + 1 minimal_person
 *   - Airy nature      19% (7/36)  — nature_scenery + 1 minimal_person
 *   - Warm evening     11% (4/36)  — warm_evening   + 1 minimal_person
 *   - Dark moody        6% (2/36)  — dark_moody
 *   - Person scenes ≤ 14% (5/36)
 *   - Zero Buddhist/spiritual scene descriptors
 */
export const TANG_SAU_SCENE_POOL: TangSauSceneEntry[] = [
  // ── Bright interior (12 non-person + 2 person = 14, ~39%) ─────────────────
  { scene: "quiet cafe table beside a window, warm golden afternoon light, ceramic cup, soft beige and cream tones, no writing anywhere", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "minimal desk with phone screen face down, bright soft daylight from window, clean white and warm wood tones", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "empty wooden chair in a cafe corner, bright afternoon window light behind it, warm beige and off-white tones", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "plain light bedsheet fold beside a pen, natural window light from the side, clean composition, off-white and soft gray tones, no writing", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "apartment window in early morning, pale bright sky outside, white curtain at edge, airy and light-filled", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "curtains lifting beside a window in morning, warm sunlight across the floor, golden and ivory tones", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "glass of water on a windowsill, soft rain visible outside, bright ambient indoor light, clean and minimal", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "empty wooden table in warm afternoon golden light, quiet clean room, soft cream and gold tones, no writing", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "clean notebook and pen on a warm desk surface, soft daylight from side window, modern and minimal, no writing visible", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "bright window seat in a clean room, morning light flooding in, off-white walls, soft pale cushion, calm and open", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "sunlit kitchen counter in bright morning, white ceramic bowl on pale cream surface, soft natural light, minimal and clean, no text", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "bright reading corner, white painted wall, edge of wooden shelf, soft diffused daylight, clean and minimal, no writing visible", category: "indoor_objects", isDark: false, hasPerson: false },
  { scene: "back view of person at apartment window looking out at the city, face not visible, modern casual clothing, bright window light", category: "minimal_person", isDark: false, hasPerson: true },
  { scene: "hand holding a phone face down on a warm cafe table, soft ambient daylight, casual modern setting", category: "minimal_person", isDark: false, hasPerson: true },

  // ── Bright city / transit (8 non-person + 1 person = 9, 25%) ─────────────
  { scene: "empty bus stop after rain, city lights reflected on wet pavement, pale blue hour, clean tones, no people", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "city street at pale blue hour, blurred warm bokeh lights, soft blue-gray atmosphere, calm and spacious, no people", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "quiet residential street in early morning, soft pale daylight, long clean shadows, no people", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "empty transit platform corridor, clean geometric lines, soft even daylight from skylights, pale off-white tones, no signs in frame", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "sunlit city sidewalk in bright morning, warm pale concrete, open blue sky, clean and airy, no people", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "overcast midday city corner, pale even diffused light, clean concrete and glass, soft blurred midground, no people", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "bright train carriage interior, empty rows of seats, daylight through windows, clean geometric lines, no people, no signage", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "modern glass building atrium, diffused overcast daylight, open and airy, minimal interior, no people", category: "urban_city", isDark: false, hasPerson: false },
  { scene: "person in casual modern clothing walking along a bright daylit city path, seen from behind, clean and open", category: "minimal_person", isDark: false, hasPerson: true },

  // ── Airy nature / open sky (6 non-person + 1 person = 7, ~19%) ───────────
  { scene: "lake surface under a wide bright overcast sky, still water reflection, clean pale silver tones, no people", category: "nature_scenery", isDark: false, hasPerson: false },
  { scene: "bright cloudy riverside path, clean pale sky reflected on water, spacious and open, no people", category: "nature_scenery", isDark: false, hasPerson: false },
  { scene: "open hillside under bright overcast sky, wide and airy, clean pale gray-white tones, no people", category: "nature_scenery", isDark: false, hasPerson: false },
  { scene: "beach shoreline under bright pale overcast sky, calm sea, wide and empty, soft white light, no people", category: "nature_scenery", isDark: false, hasPerson: false },
  { scene: "sunlit park path in bright morning, soft leaf shadows on clean pavement, airy and spacious, no people", category: "nature_scenery", isDark: false, hasPerson: false },
  { scene: "wide open meadow path under pale morning sky, soft clouds, clean and spacious, no people", category: "nature_scenery", isDark: false, hasPerson: false },
  { scene: "lone figure extremely small against a wide bright open landscape, back view, airy pale sky", category: "minimal_person", isDark: false, hasPerson: true },

  // ── Warm evening / golden hour (3 non-person + 1 person = 4, ~11%) ────────
  { scene: "rooftop view of city at golden hour, soft warm sky, clean wide horizon, no people", category: "warm_evening", isDark: false, hasPerson: false },
  { scene: "train window view at dusk, passing city lights outside, warm interior ambient glow, soft reflection", category: "warm_evening", isDark: false, hasPerson: false },
  { scene: "quiet outdoor cafe terrace at golden hour, long amber shadows, empty wooden chairs, warm evening glow, no people", category: "warm_evening", isDark: false, hasPerson: false },
  { scene: "very small silhouette of lone person walking far away on a wide clean city street at dusk, pale warm gold horizon", category: "warm_evening", isDark: false, hasPerson: true },

  // ── Dark / moody (2, ~6%) ─────────────────────────────────────────────────
  { scene: "empty urban street corner at late night, single warm amber streetlight, clean dark pavement, quiet, no people", category: "dark_moody", isDark: true, hasPerson: false },
  { scene: "rain-slicked alley at night, single warm lamp glow reflecting on dark wet pavement, quiet and still, no people", category: "dark_moody", isDark: true, hasPerson: false },
];

function seedIndex(seed: string, length: number): number {
  return Array.from(seed).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) % length;
}

function isTangSauContext(ctx: ImagePromptContext): boolean {
  return (
    ctx.workspaceId === "tang_sau_workspace" ||
    ctx.channelProfileId === "tang_sau_v1" ||
    ctx.channelKey === "tang_sau" ||
    ctx.contentProfileKey === "philosophy"
  );
}

export function buildQuoteShortImagePrompt(topic: string, ctx: ImagePromptContext): string {
  const isTangSau = isTangSauContext(ctx);

  if (isTangSau) {
    const entry = TANG_SAU_SCENE_POOL[seedIndex(topic, TANG_SAU_SCENE_POOL.length)]!;
    // Style anchor: use specific secular commercial photography references that are far from
    // Buddhist/spiritual in CLIP embedding space. Avoid naming religious concepts at all —
    // even negative mentions ("no Buddha") activate those concepts in CLIP and pull generation
    // toward Buddhist imagery. Instead anchor positively to well-known secular aesthetics.
    const styleAnchor = entry.isDark
      ? "shot for Monocle magazine, contemporary urban documentary photography, modern city life after hours, ISO 800 film grain, secular daily life, clean dark palette"
      : entry.category === "warm_evening"
      ? "shot for Kinfolk magazine, golden hour lifestyle photography, warm amber and honey-gold tones, long soft shadows, evening light, modern secular lifestyle, clean warm palette, avoid cold blue"
      : "shot for Kinfolk magazine, commercial lifestyle photography, contemporary interior or street photography, natural window light, modern everyday life, clean bright palette, soft off-white and warm beige, pale blue-gray or soft gold, avoid muddy olive, avoid dirty sepia";
    return [
      styleAnchor,
      entry.scene,
      "no text, no typography, no lettering, no quote, no caption, no watermark, no logo, no poster, no readable signage, no subtitles, no words, no letters, no book cover text, no phone screen text, no packaging text",
      "clean photographic background only, never a rendered quote card, never a poster, never a collage, never an image with baked-in writing",
      "no close-up face, no centered subject, no busy foreground clutter",
      "portrait orientation 9:16, high quality",
    ].join(", ");
  }

  // BUDDHIST_VISUAL_V1 — deterministic category-based prompt per topic
  const categoryKey = getBuddhistVisualCategory(topic);
  const prompt = buildBuddhistImagePrompt(categoryKey, topic);
  return [
    prompt,
    "no dark shadows, no cold blue tones, no gloomy mood, no heavy shadow",
    `negative: ${BUDDHIST_NEGATIVE_PROMPT}`,
  ].join(", ");
}

import type { QuoteImageMeta } from "@/lib/quote-image-meta";

function modelSupportsGuidanceScale(falModel: string): boolean {
  return falModel !== "fal-ai/flux/schnell";
}

function buildQuoteVisualVariant(falModel: string, imageSize: string): string {
  const slug = falModel.replace("fal-ai/flux-pro/", "pro-").replace("fal-ai/flux/", "");
  return `${slug}/${imageSize}`;
}

async function generateAndSaveImage(
  contentId: string,
  topic: string,
  ctx: ImagePromptContext = {},
): Promise<{ imagePath: string; imageMeta: QuoteImageMeta }> {
  const config = await getImageConfig().catch(() => ({
    falModel: FAL_MODEL_FALLBACK,
    imageSize: FAL_IMAGE_SIZE_FALLBACK,
    steps: FAL_STEPS_FALLBACK,
    llmModel: "openai/gpt-4o-mini",
    numImages: 1,
  }));

  const falModel    = config.falModel;
  const imageSize   = config.imageSize;
  const steps       = config.steps ?? FAL_STEPS_FALLBACK;
  const guidanceScale = modelSupportsGuidanceScale(falModel) ? 3.5 : null;

  const prompt = buildQuoteShortImagePrompt(topic, ctx);

  // Hero subject and category for tracking (Buddhist path only)
  const isBuddhist = !isTangSauContext(ctx);
  let heroSubject: HeroSubjectKey | null = null;
  let buddhistVisualCategory: string | null = null;
  if (isBuddhist) {
    const categoryKey = getBuddhistVisualCategory(topic);
    heroSubject = getHeroSubjectForCategory(categoryKey);
    buddhistVisualCategory = categoryKey;
  }

  const imageMeta: QuoteImageMeta = {
    rawPrompt: prompt.slice(0, 500),
    imageModel: falModel,
    imageSize,
    inferenceSteps: steps,
    guidanceScale,
    visualVariant: buildQuoteVisualVariant(falModel, imageSize),
    heroSubject,
    compositionProfile: "cover_safe_v1",
    buddhistVisualCategory,
  };

  const imgDir = path.join(process.cwd(), OUTPUT_DIR, IMAGE_SUBDIR);
  fs.mkdirSync(imgDir, { recursive: true });
  const destAbs = path.join(imgDir, `${contentId}-bg.jpg`);
  const rerollLimit = isTangSauContext(ctx) ? TANG_SAU_BG_REROLL_LIMIT : 1;
  let lastReason = "";

  for (let attempt = 1; attempt <= rerollLimit; attempt++) {
    const result = await callWithRetry(
      () =>
        fal.run(falModel, {
          input: {
            prompt,
            image_size: imageSize,
            num_inference_steps: steps,
            num_images: 1,
            enable_safety_checker: false,
            ...(guidanceScale !== null ? { guidance_scale: guidanceScale } : {}),
          },
        }) as unknown as Promise<FalResult>,
      { label: `quote_image_${contentId}_attempt_${attempt}`, baseDelayMs: 2_000 },
    );

    const url = result.data?.images?.[0]?.url;
    if (!url) throw new Error("Fal.ai không trả về URL ảnh");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download ảnh thất bại: ${res.status}`);
    fs.writeFileSync(destAbs, Buffer.from(await res.arrayBuffer()));

    if (!isTangSauContext(ctx)) return { imagePath: destAbs, imageMeta };

    const inspection = await inspectTangSauBackground(destAbs);
    if (inspection.ok) return { imagePath: destAbs, imageMeta };
    lastReason = inspection.reason;
    console.warn(`[tang_sau_bg_guard] reroll ${attempt}/${rerollLimit} for ${contentId}: ${inspection.reason}`);
  }

  throw new Error(`Tầng Sâu background rejected after ${rerollLimit} attempts: ${lastReason || "unknown_reason"}`);
}

export async function inspectTangSauBackground(imagePath: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const client = getOpenRouterClient();
    const imageBase64 = fs.readFileSync(imagePath).toString("base64");
    const resp = await callWithRetry(
      () =>
        client.chat.completions.create({
          model: "openai/gpt-4.1-mini",
          temperature: 0,
          max_tokens: 80,
          messages: [
            {
              role: "system",
              content:
                "Bạn là bộ lọc background cho quote video Tầng Sâu. " +
                "Quyết định ảnh có bị contaminate bởi: (1) chữ đọc được / typography, hoặc (2) hình ảnh mang tính Buddhist/spiritual. " +
                "Trả về strict JSON: {\"ok\": boolean, \"reason\": string}. " +
                "ok=true chỉ khi ảnh sạch: không chữ, không typography, không caption, không watermark, không logo, không poster, không readable signage, không subtitles, không quote card, " +
                "VÀ không có: bàn thờ, chùa, tượng Phật, tượng thần, nhang khói, hoa sen dùng trong bối cảnh tôn giáo, tràng hạt, áo cà sa, áo tu hành, bàn thờ, đền miếu. " +
                "Nếu nghi ngờ có chữ hoặc hình ảnh tôn giáo/tâm linh, trả ok=false.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Kiểm tra ảnh này có bị contaminate bởi: chữ/typography/signage đọc được, HOẶC hình ảnh Buddhist/spiritual (bàn thờ, tượng Phật, chùa, tượng tôn giáo, nhang, hoa sen tôn giáo, tràng hạt, áo tu hành) không. " +
                    "Không đánh giá thẩm mỹ. Chỉ lọc text và visual contamination.",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "tang_sau_background_guard",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  ok: { type: "boolean" },
                  reason: { type: "string" },
                },
                required: ["ok", "reason"],
              },
            },
          },
        }),
      { label: `inspect_tang_sau_background_${path.basename(imagePath)}`, baseDelayMs: 1_000 },
    );
    const raw = resp.choices[0]?.message.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { ok?: boolean; reason?: string };
    return {
      ok: parsed.ok === true,
      reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "unclassified",
    };
  } catch (error) {
    console.warn(
      `[tang_sau_bg_guard] inspection fallback-pass for ${path.basename(imagePath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { ok: true, reason: "inspection_unavailable" };
  }
}

// ── Preview (dry-run) ──────────────────────────────────────────────────────

const TANG_SAU_FORMATS = new Set<QuoteGenBatchOptions["quoteFormat"]>([
  "quote_reflection",
  "note_letter_card",
  "kinetic_text",
  "bilingual_minimal",
]);

const BUDDHIST_FORMATS = new Set<QuoteGenBatchOptions["quoteFormat"]>([
  "buddhist_teaching_single",
  "buddhist_teaching_numbered",
  "buddhist_life_reflection",
  "buddhist_quote_bright",
]);

// ── Tầng Sâu format mix policy ────────────────────────────────────────────────
// Applied automatically when no explicit quoteFormat is passed for Tầng Sâu.
// Manual UI selection overrides this policy.

export const TANG_SAU_FORMAT_POLICY = [
  { format: "quote_reflection" as const, weight: 65 },
  { format: "note_letter_card" as const, weight: 20 },
  { format: "bilingual_minimal" as const, weight: 15 },
] satisfies Array<{ format: NonNullable<QuoteGenBatchOptions["quoteFormat"]>; weight: number }>;

const POLICY_TOTAL_WEIGHT = TANG_SAU_FORMAT_POLICY.reduce((s, p) => s + p.weight, 0);

/**
 * Deterministically selects a Tầng Sâu format for a given seed string (typically the topic).
 * Returns "short_quote" only as a safety fallback if the policy weights don't sum correctly.
 */
export function selectTangSauFormat(seed: string): NonNullable<QuoteGenBatchOptions["quoteFormat"]> {
  const hash = Array.from(seed).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0);
  const pick = hash % POLICY_TOTAL_WEIGHT;
  let cumulative = 0;
  for (const { format, weight } of TANG_SAU_FORMAT_POLICY) {
    cumulative += weight;
    if (pick < cumulative) return format;
  }
  return "short_quote";
}

// ── Buddhist format mix policy ────────────────────────────────────────────
// Applied automatically when Buddhist workspace + no explicit quoteFormat.

export const BUDDHIST_FORMAT_POLICY = [
  { format: "buddhist_teaching_single" as const, weight: 35 },
  { format: "short_quote" as const, weight: 25 },
  { format: "buddhist_teaching_numbered" as const, weight: 20 },
  { format: "buddhist_life_reflection" as const, weight: 10 },
  { format: "buddhist_quote_bright" as const, weight: 10 },
] satisfies Array<{ format: NonNullable<QuoteGenBatchOptions["quoteFormat"]>; weight: number }>;

const BUDDHIST_POLICY_TOTAL_WEIGHT = BUDDHIST_FORMAT_POLICY.reduce((s, p) => s + p.weight, 0);

export function selectBuddhistFormat(seed: string): NonNullable<QuoteGenBatchOptions["quoteFormat"]> {
  const hash = Array.from(seed).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0);
  const pick = hash % BUDDHIST_POLICY_TOTAL_WEIGHT;
  let cumulative = 0;
  for (const { format, weight } of BUDDHIST_FORMAT_POLICY) {
    cumulative += weight;
    if (pick < cumulative) return format;
  }
  return "short_quote";
}

export async function previewQuoteGeneration(
  options: QuoteGenBatchOptions,
): Promise<QuoteGenPreviewItem[]> {
  const isTangSau = options.channelProfileId === "tang_sau_v1" ||
    options.workspaceId === "tang_sau_workspace";
  const isBuddhist = options.workspaceId === "buddhist_healing_workspace" ||
    options.channelProfileId === "buddhist_healing_v1";
  // Auto-mix: when workspace + no explicit format, select format per-topic from policy.
  const useAutoMix = (isTangSau || isBuddhist) && options.quoteFormat === undefined;
  // When format is explicit, resolve it once upfront.
  const staticResolvedFormat = useAutoMix
    ? null
    : (() => {
        const qf = options.quoteFormat ?? "short_quote";
        // Workspace-exclusive formats silently fall back to short_quote for other workspaces.
        if (TANG_SAU_FORMATS.has(qf) && !isTangSau) return "short_quote";
        if (BUDDHIST_FORMATS.has(qf) && !isBuddhist) return "short_quote";
        return qf;
      })();

  const topics = pickTopics(options.count, options.topicFamily, options.channelProfileId);
  const items: QuoteGenPreviewItem[] = [];

  for (const topic of topics) {
    const allowedFamilies = getTopicFamiliesForChannel(options.channelProfileId);
    const resolvedTopicFamily =
      options.topicFamily ??
      allowedFamilies.find((family) =>
        family.exampleTopics.some((sample) => sample.toLocaleLowerCase("vi-VN") === topic.toLocaleLowerCase("vi-VN")),
      )?.id ??
      "auto";
    const audienceProfileId = isTangSau
      ? "modern_reflective"
      : isBuddhist
        ? "healing_seekers"
        : undefined;
    const baseAttrs = {
      topic,
      topicFamily: resolvedTopicFamily,
      visualMood: isTangSau ? "editorial_stillness" : isBuddhist ? "warm_temple" : "gentle_nature",
      musicMood: isTangSau ? "ambient_reflection" : "soft_meditation",
      channelProfileId: options.channelProfileId,
      workspaceId: options.workspaceId,
      channelKey: isTangSau ? "tang_sau" : isBuddhist ? "phat_phap" : undefined,
      contentProfileKey: isTangSau ? "philosophy" : isBuddhist ? "buddhism" : undefined,
      colorPalette: isTangSau
        ? "warm-neutral editorial (warm beige, soft cream, muted amber, off-white, Kinfolk/Monocle)"
        : isBuddhist
          ? "bright warm healing (warm gold, ivory, lotus pink, sunrise amber, peaceful temple)"
          : undefined,
      visualTemperature: isTangSau ? "warm-neutral" : isBuddhist ? "bright-warm" : undefined,
      buddhistVisualMeta: isBuddhist
        ? buildBuddhistVisualMetadata(getBuddhistVisualCategory(topic))
        : undefined,
      tags: audienceProfileId
        ? { audienceIntent: audienceProfileId }
        : undefined,
    };

    // Per-topic format: use policy mix when no explicit format was given.
    const requestedFormat = (staticResolvedFormat ??
      (isBuddhist ? selectBuddhistFormat(topic) : selectTangSauFormat(topic))) as QuoteFormatKey;
    const styleResolution = resolveQuoteVisualStyle(baseAttrs);
    const resolvedFormat = resolveQuoteShortFormat(baseAttrs, requestedFormat);
    const resolvedQuoteStyle = styleResolution.style === "static_deep_quote"
      ? "static_deep_quote"
      : undefined;

    if (resolvedFormat === "quote_reflection") {
      const generated = await generateReflectionQuoteLLM(topic, {
        channelProfileId: options.channelProfileId,
        topicFamily: options.topicFamily,
      });
      items.push({
        ...baseAttrs,
        quoteText: generated.mainQuote,
        mainQuote: generated.mainQuote,
        reflectionText: generated.reflectionText,
        quoteStyle: resolvedQuoteStyle ?? "reflection_card",
        visualMode: "quote_reflection_card",
        experimentVariant: QS_REFLECTION_EXPERIMENT_VARIANT,
      });
    } else if (resolvedFormat === "note_letter_card") {
      const noteLetterText = await generateNoteLetterCardLLM(topic, {
        topicFamily: options.topicFamily,
      });
      const firstLine = noteLetterText.split("\n").find((l) => l.trim().length > 0) ?? noteLetterText;
      items.push({
        ...baseAttrs,
        quoteText: firstLine.replace(/\s+/g, " ").trim(),
        mainQuote: firstLine.replace(/\s+/g, " ").trim(),
        noteLetterText,
        quoteStyle: resolvedQuoteStyle ?? "note_letter",
        visualMode: "note_letter_card",
        experimentVariant: QS_NOTE_LETTER_EXPERIMENT_VARIANT,
      });
    } else if (resolvedFormat === "kinetic_text") {
      const { quoteText, kineticText } = await generateKineticTextLLM(topic, {
        topicFamily: options.topicFamily,
      });
      items.push({
        ...baseAttrs,
        quoteText,
        mainQuote: quoteText,
        kineticText,
        quoteStyle: "kinetic_quote",
        visualMode: "kinetic_typography",
        experimentVariant: QS_KINETIC_TEXT_EXPERIMENT_VARIANT,
      });
    } else if (resolvedFormat === "bilingual_minimal") {
      const { quoteText, englishLine } = await generateBilingualMinimalLLM(topic, {
        topicFamily: options.topicFamily,
      });
      items.push({
        ...baseAttrs,
        quoteText,
        mainQuote: quoteText,
        englishLine,
        quoteStyle: resolvedQuoteStyle ?? "bilingual_minimal",
        visualMode: "bilingual_minimal",
        experimentVariant: QS_BILINGUAL_MINIMAL_EXPERIMENT_VARIANT,
      });
    } else if (resolvedFormat === "buddhist_teaching_single") {
      console.log(`[quote-gen:preview] topic="${topic}" format="buddhist_teaching_single" family="${resolvedTopicFamily}" visual="ken_burns_image"`);
      const quoteText = await generateBuddhistTeachingSingleLLM(topic, options.topicFamily ?? (resolvedTopicFamily !== "auto" ? resolvedTopicFamily : undefined));
      items.push({
        ...baseAttrs,
        quoteText,
        mainQuote: quoteText,
        quoteStyle: resolvedQuoteStyle ?? "short_quote",
        visualMode: "ken_burns_image",
        experimentVariant: QS_BUDDHIST_TEACHING_SINGLE_EXPERIMENT_VARIANT,
      });
    } else if (resolvedFormat === "buddhist_teaching_numbered") {
      console.log(`[quote-gen:preview] topic="${topic}" format="buddhist_teaching_numbered" family="${resolvedTopicFamily}" visual="ken_burns_image"`);
      const { quoteText } = await generateBuddhistTeachingNumberedLLM(topic, {
        topicFamily: options.topicFamily ?? (resolvedTopicFamily !== "auto" ? resolvedTopicFamily : undefined),
      });
      items.push({
        ...baseAttrs,
        quoteText,
        mainQuote: quoteText,
        quoteStyle: resolvedQuoteStyle ?? "short_quote",
        visualMode: "ken_burns_image",
        experimentVariant: QS_BUDDHIST_TEACHING_NUMBERED_EXPERIMENT_VARIANT,
      });
    } else if (resolvedFormat === "buddhist_life_reflection") {
      console.log(`[quote-gen:preview] topic="${topic}" format="buddhist_life_reflection" family="${resolvedTopicFamily}" visual="quote_reflection_card"`);
      const { quoteText, reflectionText } = await generateBuddhistLifeReflectionLLM(
        topic,
        options.topicFamily ?? (resolvedTopicFamily !== "auto" ? resolvedTopicFamily : undefined),
      );
      items.push({
        ...baseAttrs,
        quoteText,
        mainQuote: quoteText,
        reflectionText,
        quoteStyle: resolvedQuoteStyle ?? "reflection_card",
        visualMode: "quote_reflection_card",
        experimentVariant: QS_BUDDHIST_LIFE_REFLECTION_EXPERIMENT_VARIANT,
      });
    } else if (resolvedFormat === "buddhist_quote_bright") {
      console.log(`[quote-gen:preview] topic="${topic}" format="buddhist_quote_bright" family="${resolvedTopicFamily}" visual="ken_burns_image"`);
      const quoteText = await generateBuddhistQuoteBrightLLM(
        topic,
        options.topicFamily ?? (resolvedTopicFamily !== "auto" ? resolvedTopicFamily : undefined),
      );
      items.push({
        ...baseAttrs,
        quoteText,
        mainQuote: quoteText,
        quoteStyle: resolvedQuoteStyle ?? "short_quote",
        visualMode: "ken_burns_image",
        experimentVariant: QS_BUDDHIST_QUOTE_BRIGHT_EXPERIMENT_VARIANT,
      });
    } else {
      // short_quote (default)
      const quoteOutcome = await generateQuoteTextOutcome(topic, {
        channelProfileId: options.channelProfileId,
        topicFamily: options.topicFamily,
      });
      items.push({
        ...baseAttrs,
        quoteText: quoteOutcome.quoteText,
        mainQuote: quoteOutcome.quoteText,
        quoteSourceType: quoteOutcome.quoteSourceType,
        quoteModel: quoteOutcome.model,
        quoteStyle: resolvedQuoteStyle ?? "short_quote",
        visualMode: "ken_burns_image",
        experimentVariant: QS_EXPERIMENT_VARIANT,
      });
    }
  }
  return items;
}

// ── Full generation ────────────────────────────────────────────────────────

async function generateSingleItem(
  contentId: string,
  item: QuoteGenPreviewItem,
  musicPath: string,
  durationSec: number,
): Promise<LegacyQuoteShortMetadata> {
  const { imagePath: imageAbsPath, imageMeta } = await generateAndSaveImage(contentId, item.topic, {
    channelProfileId: item.channelProfileId,
    workspaceId: item.workspaceId,
    channelKey: item.channelKey,
    contentProfileKey: item.contentProfileKey,
  });
  const relMusicPath = path.isAbsolute(musicPath)
    ? path.relative(process.cwd(), musicPath)
    : musicPath;
  const workspace =
    (item.workspaceId ? getWorkspaceById(item.workspaceId) : null) ??
    (item.channelProfileId ? getWorkspaceByProfileId(item.channelProfileId) : null);
  const channelName =
    workspace?.platformAccounts.find((account) => account.platform === "youtube")?.displayName ??
    workspace?.displayName ??
    undefined;

  return renderLegacyQuoteShort({
    contentId,
    topic: item.topic,
    sourceImagePath: imageAbsPath,
    quoteText: item.mainQuote,
    reflectionText: item.reflectionText,
    noteLetterText: item.noteLetterText,
    englishLine: item.englishLine,
    kineticText: item.kineticText,
    topicFamily: item.topicFamily,
    durationSec,
    musicPath: relMusicPath,
    channelName,
    channelProfileId: item.channelProfileId,
    workspaceId: item.workspaceId,
    channelKey: item.channelKey,
    contentProfileKey: item.contentProfileKey,
    experimentId: QS_EXPERIMENT_ID,
    experimentVariant: item.experimentVariant,
    visualMode: item.visualMode,
    quoteStyle: item.quoteStyle,
    visualMood: item.visualMood,
    musicMood: item.musicMood,
    colorPalette: item.colorPalette,
    visualTemperature: item.visualTemperature,
    buddhistVisualMeta: item.buddhistVisualMeta,
    imageMeta,
    tags: item.tags,
  });
}

export async function runQuoteShortBatch(
  previewItems: QuoteGenPreviewItem[],
  options: Pick<QuoteGenBatchOptions, "durationSec">,
): Promise<QuoteGenResult[]> {
  // pickMusicPath throws missing_background_music if no track is available.
  // This fails the entire batch before any image or video work starts.
  const musicPath = await pickMusicPath();
  const durationSec = options.durationSec ?? 14;
  const results: QuoteGenResult[] = [];

  for (const item of previewItems) {
    const contentId = makeContentId();
    try {
      const meta = await generateSingleItem(contentId, item, musicPath, durationSec);
      results.push({
        ok: true,
        contentId,
        topic: item.topic,
        quoteText: meta.quoteText,
        reflectionText: meta.reflectionText,
        videoPath: meta.videoPath,
        sidecarPath: meta.metadataPath,
        renderedImagePath: meta.renderedImagePath,
        sourceImagePath: meta.sourceImagePath,
        experimentVariant: meta.experimentVariant,
      });
    } catch (err) {
      results.push({
        ok: false,
        contentId,
        topic: item.topic,
        quoteText: item.quoteText,
        videoPath: "",
        sidecarPath: "",
        renderedImagePath: "",
        sourceImagePath: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Brief pause so makeContentId() timestamps stay unique
    await new Promise<void>((r) => setTimeout(r, 20));
  }

  return results;
}

// ── Analytics helper ──────────────────────────────────────────────────────

export type BuddhistQuoteMetadata = {
  topic: string;
  topicFamily: string | null;
  quoteText: string;
  reflectionText: string | null;
  quoteStyle: string;
  visualMood: string;
  formatType: string;
  experimentVariant: string;
};

/**
 * Read-only helper: maps preview item fields to a flat analytics-ready structure.
 * No DB writes. Use this to normalize QuoteGenPreviewItem before export or dashboard display.
 */
export function normalizeBuddhistQuoteMetadata(
  item: QuoteGenPreviewItem,
): BuddhistQuoteMetadata {
  return {
    topic: item.topic,
    topicFamily: item.topicFamily ?? null,
    quoteText: item.quoteText,
    reflectionText: item.reflectionText ?? null,
    quoteStyle: item.quoteStyle,
    visualMood: item.visualMood,
    formatType: "legacy_quote_short",
    experimentVariant: item.experimentVariant,
  };
}
