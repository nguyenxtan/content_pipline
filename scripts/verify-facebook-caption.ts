import {
  FACEBOOK_SAFE_CAPTION_MAX_LENGTH,
  buildDefaultVideoDescription,
  buildSafeFacebookCaption,
  validateFacebookCaption,
} from "@/lib/social/youtube-metadata";

const badTail = "... thấy mình chỉ l";
const prefix = (
  "Có những ngày quý vị im lặng không phải vì hết chuyện để nói. " +
  "Quý vị chỉ đang học cách giữ lòng mình khỏi những điều làm đau thêm. "
).repeat(40).slice(0, 2200 - badTail.length);

const oldRawCaption = `${prefix}${badTail}à người yếu đuối.\n\n#phatphap #thathu #binhan`;
const oldCaption = oldRawCaption.slice(0, 2200);
const safeCaption = buildSafeFacebookCaption(oldRawCaption);
const validation = validateFacebookCaption(safeCaption);

const generatedQuoteCaption = buildDefaultVideoDescription({
  platform: "facebook",
  contentType: "quote",
  topic: "Tha thứ",
  nicheName: "Phật Pháp",
  shortContent: (
    "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu. " +
    "Còn quý vị thì vẫn giữ nó trong lòng như một vết thương chưa khép miệng. " +
    "Tha thứ không phải để người kia đúng, mà để lòng mình được nhẹ hơn."
  ).repeat(20),
});
const generatedValidation = validateFacebookCaption(generatedQuoteCaption);

const exactBrokenExamples = [
  "... liệu mình có bị t\n\n#phatphap #that",
  "Trong những khoảnh k\n\n#phatphap #long",
  "... những ước mơ và đam\n\n#phatphap #phuong #huong",
].map((caption) => {
  const repaired = buildSafeFacebookCaption(caption);
  return {
    before: caption,
    beforeValidation: validateFacebookCaption(caption),
    after: repaired,
    afterValidation: validateFacebookCaption(repaired),
  };
});

const result = {
  maxCaptionLengthRule: `${FACEBOOK_SAFE_CAPTION_MAX_LENGTH} Vietnamese graphemes`,
  oldBehavior: {
    endsWithBadTail: oldCaption.endsWith(badTail),
    length: oldCaption.length,
    tail: oldCaption.slice(-40),
  },
  newBehavior: {
    length: safeCaption.length,
    tail: safeCaption.slice(-120),
    validation,
  },
  generatedQuoteCaption: {
    length: generatedQuoteCaption.length,
    caption: generatedQuoteCaption,
    validation: generatedValidation,
  },
  exactBrokenExamples,
};

console.log(JSON.stringify(result, null, 2));

if (
  !validation.ok ||
  !generatedValidation.ok ||
  safeCaption.endsWith(badTail) ||
  exactBrokenExamples.some((example) => !example.afterValidation.ok)
) {
  process.exit(1);
}
