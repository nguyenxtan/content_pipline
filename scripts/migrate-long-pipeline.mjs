import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const pool = new Pool({ connectionString: "postgresql://admin:admin123@localhost:5433/content_pipeline" });

await pool.query(`
  ALTER TABLE content_generations
  ADD COLUMN IF NOT EXISTS long_tts_status         VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS long_tts_error_message  TEXT,
  ADD COLUMN IF NOT EXISTS long_audio_path         TEXT,
  ADD COLUMN IF NOT EXISTS long_video_status       VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS long_video_error_message TEXT,
  ADD COLUMN IF NOT EXISTS long_video_path         TEXT
`);
console.log("✅ Migration OK — long content pipeline columns added");
await pool.end();
