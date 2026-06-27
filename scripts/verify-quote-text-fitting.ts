import assert from "node:assert/strict";
import {
  fitQuoteText,
  fitReflectionText,
} from "@/lib/legacy-quote-short-generator";
import {
  getConfig,
  prepareQuoteExcerpt,
  fitText,
} from "@/lib/image/social-image-enhancer";

function hasEllipsis(lines: string[]): boolean {
  return lines.some((line) => line.endsWith("…"));
}

function endsWithBrokenHalfWord(line: string): boolean {
  return /[A-Za-zÀ-ỹ]\.\.\.$/u.test(line);
}

function main() {
  const shortQuote = "Bình an bắt đầu từ một hơi thở biết đủ.";
  const mediumQuote = "Có những ngày lòng người chỉ dịu lại khi ta thôi đòi cuộc đời phải trả lời ngay lập tức.";
  const longQuote =
    "Có những ngày ta đi qua rất nhiều tiếng ồn, rất nhiều kỳ vọng, rất nhiều lời thúc ép phải mạnh mẽ hơn, nhanh hơn, giỏi hơn. Nhưng đến cuối cùng, điều cứu mình không phải là cố thêm một chút nữa, mà là dám ngồi xuống, nhìn thẳng vào nỗi mệt trong lòng, và thừa nhận rằng có những vết thương chỉ lành khi ta thôi ép mình phải ổn ngay hôm nay.";
  const longNoPunctuation =
    "Có những ngày ta cứ đi mãi giữa vô số suy nghĩ chồng chất và những nỗi lo không gọi thành tên để rồi càng bước càng thấy lòng mình nặng hơn càng cố tỏ ra bình thường càng thấy bản thân cạn sức";
  const oddLongWord = "Pneumonoultramicroscopicsilicovolcanoconiosis khiến đoạn quote này trở nên rất khó xử nhưng renderer vẫn phải không crash";

  const shortFit = fitQuoteText(shortQuote);
  assert.ok(shortFit.lines.length >= 1 && shortFit.lines.length <= 2, "short quote should stay compact when it fits");
  assert.equal(hasEllipsis(shortFit.lines), false, "short quote should not gain ellipsis");

  const mediumFit = fitQuoteText(mediumQuote);
  assert.ok(mediumFit.lines.length >= 1 && mediumFit.lines.length <= 5, "medium quote should fit within quote layout limit");
  assert.equal(hasEllipsis(mediumFit.lines), false, "medium quote should remain complete when it fits");

  const longFit = fitQuoteText(longQuote);
  assert.ok(longFit.lines.length <= 5, "long quote should respect max line count");
  assert.ok(hasEllipsis(longFit.lines), "long quote fallback should end with a clean ellipsis");
  assert.equal(endsWithBrokenHalfWord(longFit.lines.at(-1) ?? ""), false, "long quote should not end with a broken half-word marker");

  const longNoPunctuationFit = fitQuoteText(longNoPunctuation);
  assert.ok(longNoPunctuationFit.lines.length <= 5, "long punctuation-free quote should still fit");
  assert.ok(hasEllipsis(longNoPunctuationFit.lines), "long punctuation-free quote should still get clean ellipsis");

  const oddWordFit = fitQuoteText(oddLongWord);
  assert.ok(oddWordFit.lines.length >= 1, "odd long word quote should not crash");

  const reflectionFit = fitReflectionText(`${longQuote} ${mediumQuote}`);
  assert.ok(reflectionFit.lines.length <= 6, "reflection quote should respect max line count");
  assert.ok(hasEllipsis(reflectionFit.lines), "reflection fallback should use ellipsis when truncated");

  const socialConfig = getConfig("facebook_quote", "4:5", "facebook_quote_premium");
  const preserved = prepareQuoteExcerpt(longQuote.repeat(2), socialConfig);
  assert.ok(preserved.length > 170, "facebook quote enhancer should not pre-truncate at old 170-char limit");

  const socialFit = fitText(preserved, socialConfig);
  assert.ok(socialFit.lines.length <= socialConfig.maxLines, "facebook quote fit should respect max lines");
  assert.ok(socialFit.safeAreaPass, "facebook quote fit should stay inside safe area");

  console.log("quote-text-fitting verification passed");
}

main();
