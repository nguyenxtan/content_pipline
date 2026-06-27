import fs from "fs";
import path from "path";
import { generateShortCover } from "@/lib/short-cover-engine";
import { generateShortCoverAsset } from "@/lib/image/short-cover-asset-generator";

type VerificationSample = {
  key: string;
  contentId: string;
  topic: string;
  selectedHook: string;
  script: string;
};

type VerificationResult = {
  key: string;
  contentId: string;
  topic: string;
  inputQuote: string;
  coverText: string;
  coverReason: string;
  confidence: number;
  outputPath: string;
  dimensions: `${number}x${number}`;
  fileSizeBytes: number;
  metadataPath: string;
  metadataExists: boolean;
  sourceImagePath: string;
};

const OUTPUT_DIR = path.join(process.cwd(), "output", "short-cover-asset-verification");

const SAMPLES: VerificationSample[] = [
  {
    key: "short",
    contentId: "verify-short-cover-short",
    topic: "Buông bỏ",
    selectedHook: "Đừng ôm mãi điều làm tim mình mệt.",
    script:
      "Có những ngày chỉ cần thôi nắm quá chặt, lòng người đã nhẹ đi một nửa. Buông bỏ không phải yếu đuối, mà là biết dừng đúng lúc để tự cứu lấy sự bình an của mình.",
  },
  {
    key: "medium",
    contentId: "verify-short-cover-medium",
    topic: "Sợ già",
    selectedHook: "Sợ già không đáng sợ bằng sống mà chưa kịp hiểu mình cần gì.",
    script:
      "Nhiều người sợ tuổi tác vì nghĩ thanh xuân đang rời đi. Nhưng điều làm ta hoảng hốt hơn thường là cảm giác một quãng đời đã trôi qua mà mình vẫn chưa thật sự sống theo điều trái tim cần.",
  },
  {
    key: "long",
    contentId: "verify-short-cover-long",
    topic: "Tha thứ",
    selectedHook:
      "Có những vết thương chỉ dịu lại khi ta ngừng chờ người khác trả lời cho nỗi đau của mình.",
    script:
      "Tha thứ không bắt đầu từ việc quên hết những gì đã xảy ra. Nó bắt đầu khi ta thôi bắt trái tim phải gồng lên để chứng minh mình ổn, thôi chờ một lời xin lỗi đến quá muộn, và chấp nhận trả lại quá khứ cho đúng nơi của nó để hôm nay được thở nhẹ hơn.",
  },
];

function findFirstImage(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFirstImage(fullPath);
      if (found) return found;
      continue;
    }

    if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
      return fullPath;
    }
  }

  return null;
}

function resolveSourceImagePath(): string {
  const cliPath = process.argv[2];
  if (cliPath) {
    const absolute = path.isAbsolute(cliPath) ? cliPath : path.join(process.cwd(), cliPath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Source image does not exist: ${absolute}`);
    }
    return absolute;
  }

  const candidates = [
    path.join(process.cwd(), "media", "images"),
    path.join(process.cwd(), "media", "news-images"),
    path.join(process.cwd(), "media", "videos"),
    path.join(process.cwd(), "media"),
  ];

  for (const candidate of candidates) {
    const found = findFirstImage(candidate);
    if (found) return found;
  }

  throw new Error("No source image found. Pass an image path as the first argument.");
}

async function renderSample(sample: VerificationSample, sourceImagePath: string): Promise<VerificationResult> {
  const cover = generateShortCover({
    topic: sample.topic,
    selectedHook: sample.selectedHook,
    script: sample.script,
  });

  const outputPath = path.join(OUTPUT_DIR, `${sample.key}-${sample.contentId}-short-cover.jpg`);
  const metadata = await generateShortCoverAsset({
    contentId: sample.contentId,
    topic: sample.topic,
    hookOrScriptExcerpt: sample.selectedHook,
    sourceImagePath,
    coverText: cover.coverText,
    layoutPreset: "short_cover_hook",
    channelName: "Trí Tuệ An Nhiên",
    showBranding: true,
    outputPath,
  });

  const stats = fs.statSync(metadata.outputPath);

  return {
    key: sample.key,
    contentId: sample.contentId,
    topic: sample.topic,
    inputQuote: sample.selectedHook,
    coverText: cover.coverText,
    coverReason: cover.coverReason,
    confidence: cover.confidence,
    outputPath: metadata.outputPath,
    dimensions: `${metadata.width}x${metadata.height}`,
    fileSizeBytes: stats.size,
    metadataPath: metadata.metadataPath,
    metadataExists: fs.existsSync(metadata.metadataPath),
    sourceImagePath: metadata.sourceImagePath,
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const sourceImagePath = resolveSourceImagePath();
  const results: VerificationResult[] = [];

  for (const sample of SAMPLES) {
    results.push(await renderSample(sample, sourceImagePath));
  }

  const reportPath = path.join(OUTPUT_DIR, "report.json");
  const report = {
    sourceImagePath,
    generatedAt: new Date().toISOString(),
    sampleCount: results.length,
    results,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
