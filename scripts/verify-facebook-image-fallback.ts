import pg from "pg";
import { resolveFacebookQuoteImageSource } from "@/lib/social/facebook-quote-source";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const result = await client.query<{
      queue_id: string;
      content_id: string;
      topic: string;
      status: string;
      scheduled_at: Date | null;
      image_paths: string[] | null;
    }>(`
      SELECT
        uq.id AS queue_id,
        uq.content_id,
        cg.topic,
        uq.status,
        uq.scheduled_at,
        cg.image_paths
      FROM upload_queue uq
      JOIN content_generations cg ON cg.id = uq.content_id
      WHERE uq.platform = 'facebook'
        AND uq.video_type = 'quote'
        AND uq.status IN ('queued', 'uploading')
      ORDER BY uq.scheduled_at ASC
    `);

    const rows = result.rows.map((row) => {
      const resolution = resolveFacebookQuoteImageSource({
        contentId: row.content_id,
        imagePaths: row.image_paths,
      });
      return {
        queueId: row.queue_id,
        contentId: row.content_id,
        topic: row.topic,
        status: row.status,
        scheduledAt: row.scheduled_at?.toISOString() ?? null,
        originalImagePath: row.image_paths?.[0] ?? null,
        resolution,
      };
    });

    const originalAvailable = rows.filter((row) => row.resolution.ok && row.resolution.sourceImageMode === "original");
    const fallbackAvailable = rows.filter((row) => row.resolution.ok && row.resolution.sourceImageMode === "short_thumb_fallback");
    const stillMissing = rows.filter((row) => !row.resolution.ok);

    const missingExamples = fallbackAvailable.slice(0, 3).map((row) => ({
      contentId: row.contentId,
      topic: row.topic,
      before: row.originalImagePath,
      after: row.resolution.ok ? row.resolution.sourceImagePath : null,
      sourceImageMode: row.resolution.ok ? row.resolution.sourceImageMode : null,
    }));

    console.log(JSON.stringify({
      totalPending: rows.length,
      originalSourceAvailable: originalAvailable.length,
      fallbackAvailable: fallbackAvailable.length,
      stillMissing: stillMissing.length,
      missingExamples,
      stillMissingExamples: stillMissing.slice(0, 10).map((row) => ({
        contentId: row.contentId,
        topic: row.topic,
        originalImagePath: row.originalImagePath,
        fallbackImagePath: row.resolution.fallbackImagePath,
        error: row.resolution.ok ? null : row.resolution.error,
      })),
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
