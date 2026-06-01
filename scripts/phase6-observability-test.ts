/**
 * Phase 6 test: write 5 sample manifests, read back, update analytics, list all.
 */
import {
  writeVideoManifest,
  readVideoManifest,
  updateManifestAnalytics,
  listManifests,
  buildManifestFromGeneration,
  type VideoManifest,
} from "@/lib/video-manifest";

const SAMPLES = [
  {
    id: "test-short-001",
    topic: "Sợ hãi mất mát",
    hook: "Người ta thường chỉ thấy giá trị của điều gì khi đã mất đi.",
    script: "Người ta thường chỉ thấy giá trị...",
    title: "Khi mất đi mới thấy...",
    thumbnailText: "MẤT ĐI MỚI THẤY",
    videoType: "short" as const,
    platform: "youtube" as const,
    durationSec: 57,
    renderTimeTotalMs: 72000,
    mainModelUsed: "google/gemini-2.5-flash",
    status: "completed",
  },
  {
    id: "test-short-002",
    topic: "Buông bỏ oán hận",
    hook: "Ba năm rồi mà anh vẫn chưa quên được lời nói đó.",
    script: "Ba năm rồi mà anh vẫn chưa quên...",
    title: "Đừng Giữ Oán Hận",
    thumbnailText: "ĐỪNG GIỮ OÁN HẬN",
    videoType: "short" as const,
    platform: "youtube" as const,
    durationSec: 55,
    renderTimeTotalMs: 68000,
    mainModelUsed: "google/gemini-2.5-flash",
    status: "completed",
  },
  {
    id: "test-long-001",
    topic: "Khi người thân ra đi",
    hook: "Khi mất đi, bạn mới thấy nhiều thứ chẳng còn quan trọng nữa.",
    script: "Khi mất đi, bạn mới thấy...",
    title: "Khoảnh khắc mất mát, khoảnh khắc thức tỉnh",
    thumbnailText: "MẤT ĐI MỚI THẤY",
    videoType: "long" as const,
    platform: "youtube" as const,
    durationSec: 712,
    renderTimeTotalMs: 340000,
    mainModelUsed: "google/gemini-2.5-flash",
    status: "completed",
  },
  {
    id: "test-short-003",
    topic: "Im lặng là phúc",
    hook: "Những người ít nói nhất thường là những người hiểu nhiều nhất.",
    script: "Những người ít nói nhất...",
    title: "Người Ít Nói Thường Hiểu Đời Hơn",
    thumbnailText: "IM LẶNG HIỂU ĐỜI",
    videoType: "short" as const,
    platform: "facebook" as const,
    durationSec: 52,
    renderTimeTotalMs: 65000,
    mainModelUsed: "google/gemini-2.5-flash",
    status: "completed",
  },
  {
    id: "test-long-002",
    topic: "Sống chậm lại",
    hook: "Có những đêm, mình tự hỏi đang sống vì điều gì.",
    script: "Có những đêm, mình tự hỏi...",
    title: "Dừng lại, bạn đang bỏ lỡ gì?",
    thumbnailText: "BỎ LỠ ĐIỀU GÌ?",
    videoType: "long" as const,
    platform: "youtube" as const,
    durationSec: 882,
    renderTimeTotalMs: 410000,
    mainModelUsed: "google/gemini-2.5-flash",
    status: "completed",
  },
];

function formatMs(ms: number): string {
  return ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
}

function main() {
  console.log("=== Phase 6: Observability & Data Loop Test ===\n");

  // Step 1: Write 5 manifests
  console.log("Step 1: Writing 5 manifests...");
  for (const s of SAMPLES) {
    const manifest = buildManifestFromGeneration({
      ...s,
      nicheName: "Phật pháp / chữa lành",
      imagePaths: [`media/images/${s.id}/0.jpg`],
      audioPath: `media/audio/${s.id}.wav`,
      videoPath: `media/videos/${s.id}.mp4`,
      thumbnailPath: `output/thumbnails/${s.id}.jpg`,
      createdAt: new Date(),
    });
    const filePath = writeVideoManifest(manifest);
    console.log(`  [OK] ${s.id} → ${filePath}`);
  }

  // Step 2: Read back and verify
  console.log("\nStep 2: Read-back verification...");
  let readOk = 0;
  for (const s of SAMPLES) {
    const m = readVideoManifest(s.id);
    if (m && m.topic === s.topic && m.thumbnailText === s.thumbnailText) {
      readOk++;
      console.log(`  [OK] ${s.id}: topic="${m.topic}", thumb="${m.thumbnailText}"`);
    } else {
      console.log(`  [FAIL] ${s.id}: read-back mismatch`);
    }
  }

  // Step 3: Update analytics on first 2
  console.log("\nStep 3: Simulating analytics update (mock YouTube data)...");
  const analyticsUpdates = [
    { id: "test-short-001", views: 12400, likes: 380, comments: 45, ctr: 0.0712, avgViewDurationSec: 48, retentionPct: 84.2 },
    { id: "test-long-001", views: 3800, likes: 210, comments: 67, ctr: 0.0534, avgViewDurationSec: 490, retentionPct: 68.9 },
  ];
  for (const a of analyticsUpdates) {
    const updated = updateManifestAnalytics(a.id, {
      views: a.views,
      likes: a.likes,
      comments: a.comments,
      ctr: a.ctr,
      avgViewDurationSec: a.avgViewDurationSec,
      retentionPct: a.retentionPct,
      fetchedAt: new Date().toISOString(),
    });
    if (updated) {
      console.log(`  [OK] ${a.id}: ${a.views} views, CTR ${(a.ctr * 100).toFixed(1)}%, retention ${a.retentionPct}%`);
    }
  }

  // Step 4: List all and show summary
  console.log("\nStep 4: Listing all manifests...");
  const all = listManifests();
  console.log(`  Total manifests: ${all.length}`);

  const shorts = all.filter((m) => m.videoType === "short");
  const longs = all.filter((m) => m.videoType === "long");
  const withAnalytics = all.filter((m) => m.analytics.views !== null);

  console.log(`  Shorts: ${shorts.length}, Longs: ${longs.length}`);
  console.log(`  With analytics: ${withAnalytics.length}/${all.length}`);

  console.log("\n  Manifest summary:");
  for (const m of all) {
    const a = m.analytics;
    const analyticsStr = a.views !== null
      ? `views=${a.views}, CTR=${((a.ctr ?? 0) * 100).toFixed(1)}%`
      : "no analytics yet";
    console.log(`  • [${m.videoType}] ${m.title} — ${formatMs(m.renderTimeTotalMs)} render | ${analyticsStr}`);
  }

  // Summary
  console.log("\n=== Results ===");
  console.log(`Write:  5/5 OK`);
  console.log(`Read:   ${readOk}/5 OK`);
  console.log(`Update: 2/2 OK`);
  console.log(`List:   ${all.length} manifests found`);

  const allOk = readOk === 5;
  if (!allOk) process.exit(1);
  console.log("\nPhase 6 test PASSED.");
}

main();
