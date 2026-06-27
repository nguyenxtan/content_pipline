import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {

  // ── upload_queue schema ─────────────────────────────────────────────────────
  const cols = await db.execute(sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'upload_queue'
    ORDER BY ordinal_position
  `);
  console.log("SCHEMA:", JSON.stringify(cols.rows, null, 2));

  // ── unique constraints on upload_queue ─────────────────────────────────────
  const constraints = await db.execute(sql`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'upload_queue'::regclass
  `);
  console.log("CONSTRAINTS:", JSON.stringify(constraints.rows, null, 2));

  // ── Step 1: exact FB rows for the 3 recovery content_ids ──────────────────
  const step1Rows = await db.execute(sql`
    SELECT
      uq.id as uq_id,
      uq.content_id,
      uq.channel_id,
      sc.platform,
      uq.video_type,
      uq.status,
      uq.privacy_status,
      uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as scheduled_vn,
      uq.scheduled_at as scheduled_utc,
      cg.channel_key
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    JOIN content_generations cg ON uq.content_id = cg.id
    WHERE uq.content_id IN (
      '544afe4b-1e86-4214-8eb2-5e47568dbaf0',
      '059368a3-ffcb-4dd9-8db5-7f3aaa18e527',
      '4dca8c6f-a3fb-48fd-978a-fde1bc4f45f9'
    )
    ORDER BY uq.content_id, sc.platform, uq.scheduled_at
  `);
  console.log("STEP1_ROWS:", JSON.stringify(step1Rows.rows, null, 2));

  // ── Step 2: exact data for the 30 FB-only tts_short content_ids ──────────
  const fbOnlyIds = [
    '45bc05a4-167f-4623-80cb-4aa334c1348c',
    '122386da-cf49-4164-b7b5-ff1feefd7e5a',
    'ea1c1edf-7e98-4b78-a8c8-06d6e8e865c5',
    '8285d11f-60ed-40dd-bf86-30ba563c87a7',
    'd3cd102a-1ac8-4cfb-8772-7de68401f23d',
    'aff684e0-721e-47cc-9b5a-836b468b4ca4',
    'f48a5849-1b47-490d-a7cd-598510ca03f5',
    'fb263643-35c9-497c-abea-96e9ac0fb210',
    '5d02ce90-4cea-4ba5-9c5a-09704186a98e',
    '6da37cbf-b238-44bc-98ee-92cfa98c3041',
    '4f329607-d814-49c1-ba84-f79ad2e31219',
    '89268bc4-e27d-49fe-a4dd-f8d0753575d0',
    '3de5c664-de4b-4ca1-b435-fa1bdc75ef9d',
    '9ff85256-7783-4eaa-9681-713b8b378746',
    'abb316ce-df3c-4e9b-90d5-17b9110da123',
    '941f5c33-7a83-4258-8ed5-0487bfca69df',
    'f97cbd15-2690-4b90-8134-3d941e6b8f5d',
    'cba79d1b-dcc1-472c-81a4-7a2908dfe9be',
    '4b7d763b-c95a-4be6-84c5-99a5e44a40b2',
    'bb26a433-d728-4803-bb6e-681eebaace3c',
    '41059eee-a985-4f19-a616-4a0fbedb2c5c',
    'cfc1744e-a73c-48f3-8ede-af18952eba24',
    '31ea6daa-61f8-4571-a19e-d0a95c3f5eec',
    'bc583b3d-bb67-4062-aa37-ee8db9bc3270',
    'bdcb1648-7e39-46ba-b896-ac6f2d31cd8c',
    'ad7cad64-62d8-4a65-bf33-ba11560445b6',
    'a2c24a26-5139-4610-bd48-50503bb16023',
    '858849ed-7c24-4400-a1ee-36c9f5491d82',
    'd8b370fa-0f30-4b09-b37c-882008e5a8e6',
    '2131eb18-b75f-40de-b717-49a20522628b',
  ];
  const idList = fbOnlyIds.map(id => `'${id}'`).join(',');

  const step2Rows = await db.execute(sql.raw(`
    SELECT
      uq.id as uq_id,
      uq.content_id,
      sc.platform,
      sc.channel_key,
      uq.video_type,
      uq.status,
      uq.privacy_status,
      uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as scheduled_vn,
      uq.scheduled_at as scheduled_utc,
      cg.topic,
      cg.topic_family,
      cg.format_type,
      cg.video_status,
      cg.video_path,
      cg.channel_key as content_channel_key
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    JOIN content_generations cg ON uq.content_id = cg.id
    WHERE uq.content_id IN (${idList})
      AND uq.status = 'queued'
    ORDER BY uq.content_id, uq.scheduled_at ASC
  `));
  console.log("STEP2_ROWS:", JSON.stringify(step2Rows.rows, null, 2));

  // Verify none of the 30 already have a YT row (including done)
  const ytCheck = await db.execute(sql.raw(`
    SELECT uq.content_id, uq.status, sc.platform
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    WHERE uq.content_id IN (${idList})
      AND sc.platform = 'youtube'
  `));
  console.log("YT_CHECK_EXISTING:", JSON.stringify(ytCheck.rows, null, 2));

  // ── baseline queue count ───────────────────────────────────────────────────
  const totalCount = await db.execute(sql`SELECT count(*) as cnt FROM upload_queue`);
  console.log("BASELINE_TOTAL:", JSON.stringify(totalCount.rows, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
