import assert from "node:assert/strict";
import { chunkTextForTTS } from "@/services/tts/chunking";
import { getConfiguredTTSProviderId } from "@/services/tts/TTSService";
import { aiMaxTestUtils } from "@/services/tts/providers/AiMaxProvider";

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const previous = process.env[key];
  if (value == null) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (previous == null) delete process.env[key];
    else process.env[key] = previous;
  }
}

function run() {
  const chunked = chunkTextForTTS(
    "Đây là đoạn mở đầu khá dài để thử nghiệm chunking.\n\n" +
    "Mỗi đoạn cần giữ nguyên ranh giới câu để không làm hỏng prosody. " +
    "Khi tổng ký tự vượt ngưỡng thì hệ thống phải tách sang chunk mới nhưng không cắt nửa câu. " +
    "Đây là một câu nữa để chắc chắn chunking theo giới hạn ký tự vẫn ổn định.",
    { maxCharsPerChunk: 140, targetWords: 18, minWords: 10 },
  );
  assert.ok(chunked.length >= 2);
  assert.ok(chunked.every((chunk) => chunk.charCount <= 140));
  assert.ok(chunked[0].text.endsWith("."));

  const page = aiMaxTestUtils.extractVoiceItems({
    voices: [
      { voice_id: "vn_male_1", name: "Nam Trầm", gender: "male", language: "Vietnamese" },
    ],
    pagination: { has_more: false },
  });
  assert.equal(page.items.length, 1);
  const normalized = aiMaxTestUtils.normalizeVoice(page.items[0] as Record<string, unknown>);
  assert.equal(normalized.id, "vn_male_1");
  assert.equal(normalized.gender, "male");
  assert.equal(normalized.locale, "Vietnamese");

  const completion = aiMaxTestUtils.parseCompletionPayload({
    status: "completed",
    chars_deducted: 92,
    result: {
      audio_url: "https://example.com/audio.wav",
      srt_url: "https://example.com/audio.srt",
      duration_sec: 78.4,
    },
  });
  assert.equal(completion.status, "completed");
  assert.equal(completion.audioUrl, "https://example.com/audio.wav");
  assert.equal(completion.srtUrl, "https://example.com/audio.srt");
  assert.equal(completion.durationSec, 78.4);
  assert.equal(completion.creditUsed, 92);

  const shortProvider = withEnv("TTS_PROVIDER", "aimax", () => getConfiguredTTSProviderId("short"));
  const longProvider = withEnv("LONGFORM_TTS_PROVIDER", "openai", () => getConfiguredTTSProviderId("long"));
  assert.equal(shortProvider, "aimax");
  assert.equal(longProvider, "openai");
}

run();
console.log("test-aimax-provider: ok");
