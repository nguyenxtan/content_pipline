import { config } from "dotenv";
import { Pool } from "pg";
import {
  CONTENT_EXPERIMENT_VARIANTS,
  getContentExperimentAssignment,
} from "@/lib/content-experiments";

config({ path: ".env.local" });
config();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const columns = await pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_name = 'content_generations'
         and column_name in ('experiment_id', 'experiment_variant')
       order by column_name`,
    );

    const groups = await pool.query<{
      experiment_id: string | null;
      experiment_variant: string | null;
      content_count: string;
    }>(
      `select experiment_id, experiment_variant, count(*) as content_count
       from content_generations
       group by experiment_id, experiment_variant
       order by count(*) desc, experiment_id nulls last, experiment_variant nulls last`,
    );

    const recent = await pool.query<{
      id: string;
      topic: string;
      niche_name: string;
      content_mode: string;
      experiment_id: string | null;
      experiment_variant: string | null;
      created_at: Date;
    }>(
      `select id, topic, niche_name, content_mode, experiment_id, experiment_variant, created_at
       from content_generations
       order by created_at desc
       limit 10`,
    );

    const existingColumns = new Set(columns.rows.map((row) => row.column_name));

    console.log(JSON.stringify({
      ok: existingColumns.has("experiment_id") && existingColumns.has("experiment_variant"),
      currentAssignmentForNewContent: getContentExperimentAssignment(),
      knownVariants: CONTENT_EXPERIMENT_VARIANTS,
      database: {
        table: "content_generations",
        columns: {
          experimentId: existingColumns.has("experiment_id"),
          experimentVariant: existingColumns.has("experiment_variant"),
        },
      },
      summary: groups.rows.map((row) => ({
        experimentId: row.experiment_id ?? "UNASSIGNED",
        experimentVariant: row.experiment_variant ?? "UNASSIGNED",
        contentCount: Number(row.content_count),
      })),
      recentContent: recent.rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        nicheName: row.niche_name,
        contentMode: row.content_mode,
        experimentId: row.experiment_id ?? null,
        experimentVariant: row.experiment_variant ?? null,
        createdAt: row.created_at,
      })),
      note: "Existing pre-foundation rows may be UNASSIGNED. New content receives currentAssignmentForNewContent without changing generation behavior.",
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
