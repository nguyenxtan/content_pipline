import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseCatalogPage,
  parseChapterPage,
  parseStoryDetailPage,
} from "@/lib/story-library/parsers/truyenfull-today";
import { parseWebTruyenDichFallbackApiResponse } from "@/lib/story-library/parsers/webtruyendich";
import { parseTvTruyenFallbackHtml } from "@/lib/story-library/parsers/tvtruyen-fit";
import { parseITruyenChuFallbackHtml } from "@/lib/story-library/parsers/itruyenchu";
import { parseMetruyenChuFallbackHtml } from "@/lib/story-library/parsers/metruyenchu";

async function readFixture(name: string) {
  const fixturePath = path.join(process.cwd(), "src/lib/story-library/__fixtures__", name);
  return readFile(fixturePath, "utf8");
}

async function main() {
  const catalogHtml = await readFixture("catalog.html");
  const detailHtml = await readFixture("detail.html");
  const chapterHtml = await readFixture("chapter.html");
  const chapterBreakHtml = await readFixture("chapter-breaks.html");
  const sourceMissingHtml = await readFixture("chapter-source-missing.html");
  const webtruyendichApiJson = await readFixture("webtruyendich-api.json");
  const tvtruyenValidHtml = await readFixture("tvtruyen-valid.html");
  const tvtruyenPlaceholderHtml = await readFixture("tvtruyen-placeholder.html");
  const itruyenchuValidHtml = await readFixture("itruyenchu-valid.html");

  const catalog = parseCatalogPage(catalogHtml, "https://truyenfull.today/danh-sach/truyen-moi/");
  assert.equal(catalog.stories.length, 2);
  assert.equal(catalog.stories[0]?.title, "Ai Duong");
  assert.equal(catalog.nextPageUrl, "https://truyenfull.today/danh-sach/truyen-moi/trang-2/");

  const detail = parseStoryDetailPage(detailHtml, "https://truyenfull.today/ai-duong/");
  assert.equal(detail.title, "Ai Duong");
  assert.equal(detail.author, "Zhihu");
  assert.equal(detail.chapterPageCount, 1);
  assert.equal(detail.chapters.length, 3);
  assert.equal(detail.chapters[0]?.chapterNumber, 1);

  const chapter = parseChapterPage(chapterHtml);
  assert.equal(chapter.storyTitle, "Ai Duong");
  assert.equal(chapter.chapterNumber, 1);
  assert.equal(chapter.wordCount > 10, true);
  assert.equal(chapter.contentText.includes("Doan mo dau"), true);

  const chapterBreak = parseChapterPage(chapterBreakHtml);
  assert.equal(chapterBreak.storyTitle, "Sau Khi Chuyen Gia Toi Pham Tro Thanh Sao Nu Nhieu Tai Tieng");
  assert.equal(chapterBreak.chapterNumber, 40);
  assert.equal(chapterBreak.wordCount > 30, true);
  assert.equal(chapterBreak.contentText.includes("Roi khoi doan phim"), true);

  assert.throws(
    () => parseChapterPage(sourceMissingHtml),
    (error: unknown) => error instanceof Error && error.message === "source_missing_chapter"
  );

  const fallbackApi = parseWebTruyenDichFallbackApiResponse(JSON.parse(webtruyendichApiJson));
  assert.equal(fallbackApi.chapterNumber, 94);
  assert.equal(fallbackApi.wordCount > 20, true);
  assert.equal(fallbackApi.contentText.includes("Chen Ye"), true);

  const tvtruyenValid = parseTvTruyenFallbackHtml({
    html: tvtruyenValidHtml,
    fallbackUrl: "https://www.tvtruyen.fit/danh-sach-duong-cai-cau-sinh-ta-tai-tan-the-thang-cap-vat-tu/chuong-1",
    expectedStoryTitle: "Danh Sách Đường Cái Cầu Sinh: Ta Tại Tận Thế Thăng Cấp Vật Tư",
    expectedChapterNumber: 1,
  });
  assert.equal(tvtruyenValid.verdict, "valid_fallback");
  assert.equal(tvtruyenValid.wordCount > 20, true);

  const tvtruyenPlaceholder = parseTvTruyenFallbackHtml({
    html: tvtruyenPlaceholderHtml,
    fallbackUrl: "https://www.tvtruyen.fit/danh-sach-duong-cai-cau-sinh-ta-tai-tan-the-thang-cap-vat-tu/chuong-108",
    expectedStoryTitle: "Danh Sách Đường Cái Cầu Sinh: Ta Tại Tận Thế Thăng Cấp Vật Tư",
    expectedChapterNumber: 108,
  });
  assert.equal(tvtruyenPlaceholder.verdict, "empty_or_placeholder");

  const itruyenchuValid = parseITruyenChuFallbackHtml({
    html: itruyenchuValidHtml,
    fallbackUrl: "https://itruyenchu.org/truyen/danh-sach-duong-cai-cau-sinh-ta-tai-tan-the-thang-cap-vat-tu/chuong-305",
    expectedStoryTitle: "Danh Sách Đường Cái Cầu Sinh: Ta Tại Tận Thế Thăng Cấp Vật Tư",
    expectedChapterNumber: 305,
  });
  assert.equal(itruyenchuValid.verdict, "valid_fallback");
  assert.equal(itruyenchuValid.wordCount > 20, true);

  const metruyenchuValid = parseMetruyenChuFallbackHtml({
    html: `
      <html>
        <head>
          <title>Danh Sách Đường Cái Cầu Sinh: Ta Tại Tận Thế Thăng Cấp Vật Tư - Chương 305 - Mê Truyện Chữ VN</title>
          <link rel="canonical" href="https://metruyenchuvn.com/danh-sach-duong-cai-cau-sinh-ta-tai-tan-the-thang-cap-vat-tu/chuong-305-_fixture" />
        </head>
        <body>
          <h1>Danh Sách Đường Cái Cầu Sinh: Ta Tại Tận Thế Thăng Cấp Vật Tư</h1>
          <h2>Chương 305: Kiem tra fallback cong khai</h2>
          <div id="chapter-content">
            <p>Doan mot noi ve nhan vat dang tiep tuc hanh trinh trong tan the.</p>
            <p>Doan hai bo sung tinh tiet, doi thoai, va nhung chi tiet du de parser xem day la noi dung that.</p>
            <p>Doan ba giu cau truc van ban don gian nhung dai hon nguong toi thieu de co the dung cho smoke test.</p>
          </div>
        </body>
      </html>
    `,
    fallbackUrl: "https://metruyenchuvn.com/danh-sach-duong-cai-cau-sinh-ta-tai-tan-the-thang-cap-vat-tu/chuong-305-_fixture",
    expectedStoryTitle: "Danh Sách Đường Cái Cầu Sinh: Ta Tại Tận Thế Thăng Cấp Vật Tư",
    expectedChapterNumber: 305,
  });
  assert.equal(metruyenchuValid.verdict, "valid_fallback");
  assert.equal(metruyenchuValid.wordCount > 20, true);

  const metruyenchuGated = parseMetruyenChuFallbackHtml({
    html: `
      <html>
        <head><title>Chuong 305</title></head>
        <body>
          <div id="chapter-content">Nhập mã để đọc tiếp</div>
        </body>
      </html>
    `,
    fallbackUrl: "https://metruyenchuvn.com/danh-sach-duong-cai-cau-sinh-ta-tai-tan-the-thang-cap-vat-tu/chuong-305-_gated",
    expectedStoryTitle: "Danh Sách Đường Cái Cầu Sinh: Ta Tại Tận Thế Thăng Cấp Vật Tư",
    expectedChapterNumber: 305,
  });
  assert.equal(metruyenchuGated.verdict, "gated_or_unreadable");

  console.log("[STORY_CRAWLER] parser_smoke_ok");
}

main().catch((error) => {
  console.error("[STORY_CRAWLER] parser_smoke_failed", error);
  process.exitCode = 1;
});
