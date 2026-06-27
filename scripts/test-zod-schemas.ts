/**
 * Zod schema regression tests for GAP-7.
 *
 * Run with:  npm run test:zod
 * Exit code 0 = all pass, 1 = any fail.
 */

import {
  LongOutlineSchema,
  TitleArraySchema,
  TitleScoreArraySchema,
  TagsArraySchema,
  ThumbnailIntentSchema,
  ShortImagePromptsSchema,
  LandscapePromptsSchema,
  formatZodError,
} from "@/lib/llm/schemas";

let passed = 0;
let failed = 0;

function ok(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  FAIL: ${description}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LongOutlineSchema
// ─────────────────────────────────────────────────────────────────────────────

function testLongOutline() {
  console.log("\n── LongOutlineSchema");

  const valid = {
    titleAngle: "Góc nhìn mới về vô thường",
    openingAngle: "Mở đầu bằng câu chuyện thực",
    closingAngle: "Kết thúc nhẹ nhàng với lời nhắn",
    sections: [
      { title: "Phần 1", purpose: "Giới thiệu", emotionalShift: "Bình thản" },
      { title: "Phần 2", purpose: "Phát triển",  emotionalShift: "Tò mò" },
      { title: "Phần 3", purpose: "Kết luận",    emotionalShift: "Bình an" },
    ],
    chapters: ["Mở đầu", "Nội dung", "Kết"],
  };

  const r1 = LongOutlineSchema.safeParse(valid);
  ok(r1.success, "valid outline passes");
  ok(r1.success && r1.data.sections.length === 3, "sections preserved");
  ok(r1.success && r1.data.chapters.length === 3, "chapters preserved");

  // chapters defaults to []
  const noChapters = { ...valid, chapters: undefined };
  const r2 = LongOutlineSchema.safeParse(noChapters);
  ok(r2.success, "missing chapters defaults to []");
  ok(r2.success && Array.isArray(r2.data?.chapters), "chapters is array when defaulted");

  // too few sections
  const r3 = LongOutlineSchema.safeParse({ ...valid, sections: valid.sections.slice(0, 2) });
  ok(!r3.success, "rejects outline with < 3 sections");
  if (!r3.success) {
    const msg = formatZodError(r3.error);
    ok(msg.includes("sections"), "error message mentions 'sections'");
  }

  // missing required field
  const r4 = LongOutlineSchema.safeParse({ ...valid, titleAngle: "" });
  ok(!r4.success, "rejects empty titleAngle");
}

// ─────────────────────────────────────────────────────────────────────────────
// TitleArraySchema
// ─────────────────────────────────────────────────────────────────────────────

function testTitleArray() {
  console.log("\n── TitleArraySchema");

  const valid = [{ title: "Buông Bỏ Là Sức Mạnh" }, { title: "Vô Thường Và Bình An" }];
  const r1 = TitleArraySchema.safeParse(valid);
  ok(r1.success, "valid title array passes");
  ok(r1.success && r1.data.length === 2, "both titles preserved");

  // empty array rejected
  const r2 = TitleArraySchema.safeParse([]);
  ok(!r2.success, "rejects empty title array");

  // non-array rejected
  const r3 = TitleArraySchema.safeParse({ title: "single" });
  ok(!r3.success, "rejects object instead of array");
}

// ─────────────────────────────────────────────────────────────────────────────
// TitleScoreArraySchema
// ─────────────────────────────────────────────────────────────────────────────

function testTitleScoreArray() {
  console.log("\n── TitleScoreArraySchema");

  const valid = [
    { curiosity: 8, clarity: 7, emotion: 9, search_potential: 6, not_clickbait: 8 },
    { curiosity: 5, clarity: 6, emotion: 7, search_potential: 8, not_clickbait: 9 },
  ];
  const r1 = TitleScoreArraySchema.safeParse(valid);
  ok(r1.success, "valid score array passes");

  // missing field
  const r2 = TitleScoreArraySchema.safeParse([{ curiosity: 8, clarity: 7 }]);
  ok(!r2.success, "rejects item missing required score fields");

  // non-number field
  const r3 = TitleScoreArraySchema.safeParse([{ ...valid[0], curiosity: "high" }]);
  ok(!r3.success, "rejects string score value");
}

// ─────────────────────────────────────────────────────────────────────────────
// TagsArraySchema
// ─────────────────────────────────────────────────────────────────────────────

function testTagsArray() {
  console.log("\n── TagsArraySchema");

  const r1 = TagsArraySchema.safeParse(["phật pháp", "thiền định", "chữa lành"]);
  ok(r1.success, "valid tags pass");
  ok(r1.success && r1.data.length === 3, "all tags preserved");

  // empty string tag rejected
  const r2 = TagsArraySchema.safeParse(["phật pháp", ""]);
  ok(!r2.success, "rejects empty-string tag");

  // non-array rejected
  const r3 = TagsArraySchema.safeParse("phật pháp");
  ok(!r3.success, "rejects string instead of array");
}

// ─────────────────────────────────────────────────────────────────────────────
// ThumbnailIntentSchema (partial — all fields optional)
// ─────────────────────────────────────────────────────────────────────────────

function testThumbnailIntent() {
  console.log("\n── ThumbnailIntentSchema");

  const full = { emotion: "binh_an", mainVisual: "Cảnh thiền", text: "BÌNH AN", colorMood: "Vàng ấm" };
  const r1 = ThumbnailIntentSchema.safeParse(full);
  ok(r1.success, "full valid intent passes");

  // partial — all fields optional
  const r2 = ThumbnailIntentSchema.safeParse({ emotion: "binh_an" });
  ok(r2.success, "partial intent (only emotion) passes");
  ok(r2.success && r2.data?.mainVisual === undefined, "missing field is undefined");

  // empty object passes (all partial)
  const r3 = ThumbnailIntentSchema.safeParse({});
  ok(r3.success, "empty object passes (fully partial schema)");

  // empty string rejected (min(1) on present fields)
  const r4 = ThumbnailIntentSchema.safeParse({ emotion: "" });
  ok(!r4.success, "rejects empty-string emotion");
}

// ─────────────────────────────────────────────────────────────────────────────
// ShortImagePromptsSchema (union: array | {prompts: array})
// ─────────────────────────────────────────────────────────────────────────────

function testShortImagePrompts() {
  console.log("\n── ShortImagePromptsSchema");

  // bare array form
  const arr = ["serene Buddhist temple at dawn", "lotus flower on still water", "mountain mist and monks"];
  const r1 = ShortImagePromptsSchema.safeParse(arr);
  ok(r1.success, "bare string array passes");

  // wrapped form
  const r2 = ShortImagePromptsSchema.safeParse({ prompts: arr });
  ok(r2.success, "wrapped {prompts: [...]} form passes");
  ok(r2.success && !Array.isArray(r2.data) && r2.data.prompts.length === 3, "wrapped prompts accessible");

  // too-short string rejected
  const r3 = ShortImagePromptsSchema.safeParse(["ab"]);
  ok(!r3.success, "rejects prompt string shorter than 3 chars");

  // non-array / non-object rejected
  const r4 = ShortImagePromptsSchema.safeParse("just a string");
  ok(!r4.success, "rejects bare string");
}

// ─────────────────────────────────────────────────────────────────────────────
// LandscapePromptsSchema
// ─────────────────────────────────────────────────────────────────────────────

function testLandscapePrompts() {
  console.log("\n── LandscapePromptsSchema");

  const valid = {
    imagePrompts: [
      "misty mountain valley with ancient pagoda at sunrise",
      "calm river reflection of full moon through bamboo forest",
    ],
    seoDescription: "Khám phá nội tâm qua cảnh thiên nhiên Phật giáo.",
  };
  const r1 = LandscapePromptsSchema.safeParse(valid);
  ok(r1.success, "valid landscape prompts pass");
  ok(r1.success && r1.data.imagePrompts.length === 2, "image prompts preserved");
  ok(r1.success && r1.data.seoDescription !== "", "seoDescription preserved");

  // seoDescription defaults to ""
  const r2 = LandscapePromptsSchema.safeParse({ imagePrompts: valid.imagePrompts });
  ok(r2.success, "missing seoDescription defaults to ''");
  ok(r2.success && r2.data?.seoDescription === "", "seoDescription is empty string when defaulted");

  // empty imagePrompts rejected
  const r3 = LandscapePromptsSchema.safeParse({ imagePrompts: [] });
  ok(!r3.success, "rejects empty imagePrompts array");

  // too-short prompt rejected
  const r4 = LandscapePromptsSchema.safeParse({ imagePrompts: ["ab"] });
  ok(!r4.success, "rejects landscape prompt shorter than 3 chars");
}

// ─────────────────────────────────────────────────────────────────────────────
// formatZodError helper
// ─────────────────────────────────────────────────────────────────────────────

function testFormatZodError() {
  console.log("\n── formatZodError");

  const result = LongOutlineSchema.safeParse({});
  if (result.success) {
    console.error("  ✗  FAIL: expected parse failure for empty object");
    failed++;
    return;
  }
  const msg = formatZodError(result.error);
  ok(typeof msg === "string" && msg.length > 0, "returns non-empty string");
  ok(msg.includes(":"), "contains path:message format");
  ok(!msg.includes("[object Object]"), "no stringified objects");
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Zod schema tests (GAP-7)");

  testLongOutline();
  testTitleArray();
  testTitleScoreArray();
  testTagsArray();
  testThumbnailIntent();
  testShortImagePrompts();
  testLandscapePrompts();
  testFormatZodError();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
