/**
 * Unit tests for normalizeTextForTTS — run after any change to the function.
 *
 * Does NOT call TTS server or DB.
 */

function normalizeTextForTTS(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    // nh-comma-nh prosody fix (ADR-005 artifact, GxR_7Ib73Nw)
    .replace(/(nh\p{L}*),\s*(nh)/gu, "$1. $2")
    .trim();
}

let passed = 0;
let failed = 0;

function expect(label: string, input: string, expected: string): void {
  const actual = normalizeTextForTTS(input);
  if (actual === expected) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     input:    ${JSON.stringify(input)}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log("=== normalizeTextForTTS tests ===\n");

// ── Separator stripping ──────────────────────────────────────────────────────
console.log("Separator stripping:");
expect(
  "strips standalone --- separator",
  "---\nĐôi khi trời mưa.",
  "Đôi khi trời mưa.",
);
expect(
  "strips standalone *** separator",
  "***\nĐôi khi trời mưa.",
  "Đôi khi trời mưa.",
);
expect(
  "strips --- only if standalone (not mid-sentence)",
  "A---B",
  "A---B",
);

// ── Newline folding ──────────────────────────────────────────────────────────
console.log("\nNewline folding:");
expect(
  "double newline → period-space",
  "Câu một.\n\nCâu hai.",
  "Câu một. Câu hai.",
);
expect(
  "single newline → space",
  "Câu một.\nCâu hai.",
  "Câu một. Câu hai.",
);
expect(
  "trailing space before newline cleaned",
  "tâm hồn mình. \n\nQuý vị,",
  "tâm hồn mình. Quý vị,",
);

// ── Punctuation cleanup ──────────────────────────────────────────────────────
console.log("\nPunctuation cleanup:");
expect(
  "space before comma removed",
  "từ người khác , mà còn",
  "từ người khác, mà còn",
);
expect(
  "double punctuation collapsed",
  "đã qua.. Từ bi",
  "đã qua. Từ bi",
);
expect(
  "?. collapsed to last punct char (.)",
  "tràn ngập?. Những",
  "tràn ngập. Những",
);

// ── nh-comma-nh prosody fix (GxR_7Ib73Nw) ───────────────────────────────────
console.log("\nnh-comma-nh prosody fix:");
expect(
  "nhà, như → nhà. như",
  "tiếng mưa rơi trên mái nhà, như đang thì thầm.",
  "tiếng mưa rơi trên mái nhà. như đang thì thầm.",
);
expect(
  "nhiều, nhưng → nhiều. nhưng",
  "có nhiều, nhưng không đủ.",
  "có nhiều. nhưng không đủ.",
);
expect(
  "nhỏ, nhẹ → nhỏ. nhẹ",
  "giọng nhỏ, nhẹ như hơi thở.",
  "giọng nhỏ. nhẹ như hơi thở.",
);
expect(
  "nh pair IS caught even mid-sentence",
  "mái nhà, như đang thì thầm.",
  "mái nhà. như đang thì thầm.",
);
expect(
  "non-nh first word NOT affected",
  "mái hiên, như đang thì thầm.",
  "mái hiên, như đang thì thầm.",
);
expect(
  "nhà followed by non-nh word NOT affected",
  "trên mái nhà, gió thổi qua.",
  "trên mái nhà, gió thổi qua.",
);

// ── Full content from GxR_7Ib73Nw ───────────────────────────────────────────
console.log("\nFull content (GxR_7Ib73Nw):");
const gxrRaw = `Cảm giác bị bỏ rơi thường đến vào những khoảnh khắc tĩnh lặng nhất. Quý vị có bao giờ ngồi một mình, nhìn ra cửa sổ, và cảm thấy nỗi cô đơn tràn ngập?\n\nNhững buổi chiều mưa, tiếng mưa rơi lộp độp trên mái nhà, như đang thì thầm những nỗi niềm sâu thẳm. Chiếc ghế trong góc phòng, nơi từng có những tiếng cười, giờ chỉ còn lại vết hằn của thời gian, gợi nhớ về những kỷ niệm đã qua.\n\nTừ bi khởi nguồn từ chính lòng mình. Khi ta mở lòng, ta nhận ra rằng nỗi đơn độc không chỉ thuộc về cá nhân mình. Những mối liên kết xung quanh vẫn đang chờ đợi được khôi phục. Có thể, chính nỗi sợ bị ruồng bỏ ấy là bài học để ta nhận ra rằng tình thương không chỉ đến từ người khác, mà còn từ chính tâm hồn mình. \n\nQuý vị, hãy dành chút thời gian để suy ngẫm về những liên kết trong cuộc sống này.`;

const gxrNormalized = normalizeTextForTTS(gxrRaw);
const hasNhaNhu = /\bnh\w+,\s*nh\w+/.test(gxrNormalized);
if (!hasNhaNhu) {
  console.log("  ✅ GxR content: 'nhX, nhY' pattern eliminated after normalization");
  passed++;
} else {
  console.log("  ❌ GxR content: 'nhX, nhY' still present after normalization");
  const m = gxrNormalized.match(/\bnh\w+,\s*nh\w+/);
  console.log(`     found: ${JSON.stringify(m?.[0])}`);
  failed++;
}
const idx = gxrNormalized.indexOf("nhà. như");
if (idx !== -1) {
  console.log(`  ✅ GxR content: 'nhà. như' present at index ${idx}`);
  passed++;
} else {
  console.log("  ❌ GxR content: 'nhà. như' NOT found");
  failed++;
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
