import { config } from "dotenv";
import { Pool } from "pg";
import {
  PROMPT_VERSION_REGISTRY,
  createPromptVersionEntry,
} from "@/lib/prompt-version-registry";

config({ path: ".env.local" });
config();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const column = await pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_name = 'content_generations'
         and column_name = 'prompt_versions'
       limit 1`,
    );

    const latest = await pool.query<{
      id: string;
      topic: string;
      niche_name: string;
      content_mode: string;
      prompt_versions: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `select id, topic, niche_name, content_mode, prompt_versions, created_at
       from content_generations
       order by created_at desc
       limit 1`,
    );

    const promptVersions = latest.rows[0]?.prompt_versions ?? null;
    const hasStoredVersions = Boolean(
      promptVersions &&
      Object.keys(promptVersions).length > 0,
    );

    const expectedNewRecordShape = {
      hook: createPromptVersionEntry("hook", {
        model: "example-model",
        stage: "hook_engine",
        mode: "short",
      }),
      script: createPromptVersionEntry("script", {
        model: "example-model",
        stage: "short_gen",
        mode: "short",
        templateId: 1,
        templateVersion: 1,
      }),
      image: createPromptVersionEntry("image", {
        model: "example-model",
        stage: "short_image_prompts",
        mode: "short",
      }),
      titleMetadata: createPromptVersionEntry("titleMetadata", {
        model: null,
        mode: "short",
      }),
      thumbnailIntent: createPromptVersionEntry("thumbnailIntent", {
        model: "example-model",
        stage: "long_thumbnail_intent",
        mode: "long",
      }),
    };

    console.log(JSON.stringify({
      ok: column.rows.length === 1,
      registry: PROMPT_VERSION_REGISTRY,
      database: {
        table: "content_generations",
        column: "prompt_versions",
        columnExists: column.rows.length === 1,
      },
      latestContentRecord: latest.rows[0]
        ? {
            id: latest.rows[0].id,
            topic: latest.rows[0].topic,
            nicheName: latest.rows[0].niche_name,
            contentMode: latest.rows[0].content_mode,
            createdAt: latest.rows[0].created_at,
            hasStoredPromptVersions: hasStoredVersions,
            promptVersions,
          }
        : null,
      expectedNewRecordShape,
      note: hasStoredVersions
        ? "Latest record already has prompt version metadata."
        : "Existing records may be pre-foundation and remain empty until content is generated or rerun through prompt-producing steps.",
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
