import { getContentProfile, findForbiddenProfileTerms } from "../src/lib/config/content-profiles";
import { validateShortScript } from "../src/lib/script-engine";
import {
  buildDefaultVideoDescription,
  buildDefaultVideoTitle,
  buildFacebookQuoteText,
  buildYouTubeVideoMetadata,
} from "../src/lib/social/youtube-metadata";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const SAMPLE_TOPIC = "Càng trưởng thành, bạn càng ít muốn giải thích";
const SAMPLE_HOOK = "Người càng trưởng thành càng ít muốn giải thích.";
const SAMPLE_SCRIPT = [
  SAMPLE_HOOK,
  "Không phải vì bạn lạnh hơn.",
  "Mà vì bạn đã từng giải thích rất nhiều, rồi vẫn bị hiểu sai.",
  "Có một lúc bạn nhận ra vấn đề không nằm ở cách mình nói.",
  "Nó nằm ở việc người kia chỉ nghe điều họ muốn nghe.",
  "Nhiều người trẻ càng lớn càng bớt tranh thắng từng câu.",
  "Họ không im vì yếu.",
  "Họ im vì biết có những cuộc nói chuyện chỉ làm mình mệt thêm.",
  "Tâm lý học gọi đó là lúc bạn bắt đầu giữ ranh giới cảm xúc.",
  "Bạn không còn nộp hết suy nghĩ của mình cho mọi ánh nhìn xung quanh.",
  "Bạn chọn nói ít hơn, nhưng rõ hơn.",
  "Và đôi khi, trưởng thành chỉ là biết điều gì không cần giải thích nữa.",
].join(" ");

function verifyProfileDefinition() {
  const profile = getContentProfile("psychology");

  assert(profile.key === "psychology", "psychology profile should resolve");
  assert(profile.defaultNicheName === "Tầng Sâu", "psychology default niche should be Tầng Sâu");
  assert(profile.status === "draft", "psychology profile should remain draft");
}

function verifyValidation() {
  const valid = validateShortScript(SAMPLE_SCRIPT, "psychology");
  assert(valid.passes, `sample psychology script should pass: ${valid.issues.join(" | ")}`);

  const contaminated = validateShortScript(
    `${SAMPLE_HOOK} Quý vị hãy nhớ rằng nhân quả luôn đến rất công bằng. A Di Đà Phật.`,
    "psychology",
  );
  assert(!contaminated.passes, "Buddhist-contaminated psychology script should fail");
  assert(
    contaminated.forbiddenTerms.some((term) => term.includes("quý vị") || term.includes("nhân quả") || term.includes("a di đà phật")),
    "forbidden Buddhist terms should be detected",
  );
}

function verifyImagePromptGuard() {
  const safePrompt = "lonely young adult in a quiet city cafe, soft cinematic lighting, subtle tension in facial expression";
  const unsafePrompt = "monk inside a temple with lotus flowers and prayer beads";

  assert(findForbiddenProfileTerms("psychology", safePrompt, "image").length === 0, "safe psychology image prompt should pass");
  assert(findForbiddenProfileTerms("psychology", unsafePrompt, "image").length > 0, "Buddhist image prompt should fail for psychology");
}

function verifyMetadata() {
  const youtube = buildYouTubeVideoMetadata({
    contentType: "short",
    topic: SAMPLE_TOPIC,
    nicheName: "Tầng Sâu",
    shortContent: SAMPLE_SCRIPT,
    contentProfileKey: "psychology",
  });

  assert(youtube.tags.some((tag) => tag.toLowerCase().includes("tâm lý") || tag.toLowerCase().includes("tamly")), "psychology tags should be present");
  assert(!youtube.tags.some((tag) => /phật|nhân quả|nghiệp/i.test(tag)), "Buddhist tags should be absent");

  const fbDescription = buildDefaultVideoDescription({
    platform: "facebook",
    contentType: "short",
    topic: SAMPLE_TOPIC,
    nicheName: "Tầng Sâu",
    shortContent: SAMPLE_SCRIPT,
    contentProfileKey: "psychology",
  });
  assert(/#tamly|#moiquanhe|#truongthanh/i.test(fbDescription), "psychology Facebook hashtags should be present");
  assert(!/phật|nhân quả|nghiệp/i.test(fbDescription), "Buddhist hashtags should be absent from psychology caption");

  const quoteText = buildFacebookQuoteText({
    topic: SAMPLE_TOPIC,
    shortContent: SAMPLE_SCRIPT,
    contentProfileKey: "psychology",
  });
  assert(!/phật|nhân quả|nghiệp|a di đà phật/i.test(quoteText), "psychology quote text should avoid Buddhist wording");

  const title = buildDefaultVideoTitle({
    platform: "facebook",
    contentType: "quote",
    topic: SAMPLE_TOPIC,
    shortContent: SAMPLE_SCRIPT,
    contentProfileKey: "psychology",
  });
  assert(title.length > 0, "default title should be generated");
}

function main() {
  verifyProfileDefinition();
  verifyValidation();
  verifyImagePromptGuard();
  verifyMetadata();
  console.log("psychology profile checks: ok");
}

main();
