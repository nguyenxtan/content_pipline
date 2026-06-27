import assert from "node:assert/strict";
import {
  analyzeChapterAudioText,
  normalizeChapterAudioText,
  normalizeEpisodeAudioText,
} from "@/lib/story-library/audio-text-normalizer";

function repeatWord(word: string, times: number): string {
  return Array.from({ length: times }, (_, i) => `Đây là câu chuyện số ${i + 1} kể về ${word} hôm nay rồi.`).join(" ");
}

function main() {
  // 1. c.h.ế.t -> chết
  {
    const { normalizedText } = analyzeChapterAudioText({ text: "Hắn đã c.h.ế.t rồi." });
    assert.equal(normalizedText, "Hắn đã chết rồi.");
  }

  // 2. t.h.ả.m -> thảm
  {
    const { normalizedText } = analyzeChapterAudioText({ text: "Một cảnh tượng t.h.ả.m thương." });
    assert.equal(normalizedText, "Một cảnh tượng thảm thương.");
  }

  // 3. t.h.ạ.i -> thại (mechanical dot removal only)
  {
    const { normalizedText } = analyzeChapterAudioText({ text: "Nó nói t.h.ạ.i quá." });
    assert.equal(normalizedText, "Nó nói thại quá.");
  }

  // 4. đ.a.o.c -> đaoc, marked needs_review (never guess đọc)
  {
    const analysis = analyzeChapterAudioText({ text: `${repeatWord("an toàn", 40)} Nó đ.a.o.c lên tiếng.` });
    assert.ok(analysis.normalizedText.includes("đaoc"));
    assert.ok(!analysis.normalizedText.includes("đọc lên tiếng"), "must not guess/invent the word đọc");
    assert.equal(analysis.status, "needs_review");
  }

  // 5. g**t ch*t -> giết chết
  {
    const { normalizedText, issues } = analyzeChapterAudioText({ text: "Nó bị g**t ch*t rồi." });
    assert.equal(normalizedText, "Nó bị giết chết rồi.");
    assert.ok(issues.some((i) => i.issueType === "star_obfuscated_word" && i.replacement === "giết chết"));
  }

  // 6. l**m -> làm
  {
    const { normalizedText } = analyzeChapterAudioText({ text: "Hắn không biết phải l**m sao." });
    assert.equal(normalizedText, "Hắn không biết phải làm sao.");
  }

  // 7. unknown star token (đ*i) remains unresolved -> block
  {
    const analysis = analyzeChapterAudioText({ text: `${repeatWord("an toàn", 40)} Anh đ*i đâu vậy?` });
    assert.ok(analysis.normalizedText.includes("đ*i"), "unresolved token must be left untouched, not guessed");
    const unresolved = analysis.issues.find((i) => i.issueType === "star_obfuscated_word" && i.original === "đ*i");
    assert.ok(unresolved);
    assert.equal(unresolved!.replacement, null);
    assert.equal(unresolved!.severity, "block");
    assert.equal(analysis.status, "block");
  }

  // 8. URLs are not changed
  {
    const text = "Xem thêm tại https://example.com/a.b để biết thêm.";
    const { normalizedText } = analyzeChapterAudioText({ text });
    assert.ok(normalizedText.includes("https://example.com/a.b"));
  }

  // 9. decimals are not changed
  {
    const text = "Số Pi xấp xỉ 3.14 theo toán học.";
    const { normalizedText } = analyzeChapterAudioText({ text });
    assert.ok(normalizedText.includes("3.14"));
  }

  // 10. ellipsis is not changed
  {
    const text = "Nó dừng lại... rồi nói tiếp.";
    const { normalizedText } = analyzeChapterAudioText({ text });
    assert.ok(normalizedText.includes("..."));
  }

  // 11. placeholder text blocks
  {
    const analysis = analyzeChapterAudioText({ text: "Nguồn thiếu chương này, mong độc giả thông cảm." });
    assert.equal(analysis.status, "block");
    assert.ok(analysis.issues.some((i) => i.issueType === "placeholder_source_noise"));
  }

  // 12. "nhập mã để đọc tiếp" blocks
  {
    const analysis = analyzeChapterAudioText({ text: `${repeatWord("an toàn", 40)} Vui lòng nhập mã để đọc tiếp.` });
    assert.equal(analysis.status, "block");
  }

  // 13. repeated spaces collapse
  {
    const { normalizedText } = analyzeChapterAudioText({ text: "Một câu có   nhiều    khoảng trắng." });
    assert.equal(normalizedText, "Một câu có nhiều khoảng trắng.");
  }

  // 14. spaces before punctuation fixed
  {
    const { normalizedText } = analyzeChapterAudioText({ text: "Anh ấy đã đi rồi , đừng tìm nữa ." });
    assert.equal(normalizedText, "Anh ấy đã đi rồi, đừng tìm nữa.");
  }

  // 15. system bracket text [Nâng cấp...] is preserved verbatim
  {
    const text = "[Nâng cấp...]  Trần Dã cảm thấy có gì đó l**m thay đổi.[Đếm ngược... 3.2.1]";
    const { normalizedText } = analyzeChapterAudioText({ text });
    assert.ok(normalizedText.includes("[Nâng cấp...]"));
    assert.ok(normalizedText.includes("[Đếm ngược... 3.2.1]"), "bracket system text must be preserved byte-for-byte, including its own dots");
    assert.ok(normalizedText.includes("làm"), "normal text outside brackets must still be normalized");
  }

  // 16. no raw text overwrite — analyzeChapterAudioText/normalizeChapterAudioText are pure
  {
    const text = "Hắn đã c.h.ế.t rồi.";
    const result = normalizeChapterAudioText({ text });
    assert.equal(result.originalText, text, "originalText must equal the input verbatim");
    assert.equal(text, "Hắn đã c.h.ế.t rồi.", "input string must never be mutated");
  }

  // 17. clean text passes
  {
    const analysis = analyzeChapterAudioText({ text: repeatWord("câu chuyện bình thường", 40) });
    assert.equal(analysis.status, "pass");
    assert.equal(analysis.stats.issueCount, 0);
  }

  // 18. multi-chapter episode-level normalization combines per-chapter results
  {
    const result = normalizeEpisodeAudioText({
      chapters: [
        { chapterNumber: 1, text: repeatWord("an toàn", 30) },
        { chapterNumber: 2, text: `${repeatWord("an toàn", 30)} Hắn đã c.h.ế.t rồi.` },
      ],
    });
    assert.equal(result.chapters.length, 2);
    assert.equal(result.chapters[0]!.status, "pass");
    assert.equal(result.chapters[1]!.status, "needs_review");
    assert.equal(result.overallStatus, "needs_review");
    assert.ok(result.combinedNormalizedText.includes("chết"));
  }

  console.log("[STORY_CRAWLER] audio_text_normalizer_smoke_ok");
}

main();
