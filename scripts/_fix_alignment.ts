import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const STEP1_CONTENT_IDS = [
  '544afe4b-1e86-4214-8eb2-5e47568dbaf0',
  '059368a3-ffcb-4dd9-8db5-7f3aaa18e527',
  '4dca8c6f-a3fb-48fd-978a-fde1bc4f45f9',
];

const STEP2_CONTENT_IDS = [
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function fmtVN(ts: string) { return ts.replace('T', ' ').replace('.000Z', '').replace('+00', ''); }
function toVN(utcStr: string): string {
  const d = new Date(utcStr);
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace('T', ' ');
}

async function main() {

  // ── SAFETY PRE-CHECKS ───────────────────────────────────────────────────────
  const baseline = await db.execute(sql`SELECT count(*) as cnt FROM upload_queue`);
  const baselineCount = Number((baseline.rows[0] as any).cnt);
  console.log(`[PRE] Baseline upload_queue total: ${baselineCount}`);

  // Verify all Step1 IDs are phat_phap
  const step1ChannelCheck = await db.execute(sql.raw(`
    SELECT id, channel_key FROM content_generations
    WHERE id IN (${STEP1_CONTENT_IDS.map(id => `'${id}'`).join(',')})
  `));
  const nonPhatPhap1 = step1ChannelCheck.rows.filter((r: any) => r.channel_key !== 'phat_phap');
  if (nonPhatPhap1.length > 0) {
    console.error('[ABORT] Step1 contains non-phat_phap content:', nonPhatPhap1);
    process.exit(1);
  }
  console.log(`[PRE-S1] All ${step1ChannelCheck.rows.length} Step1 content_ids confirmed phat_phap ✓`);

  // Verify all Step2 IDs are phat_phap
  const step2ChannelCheck = await db.execute(sql.raw(`
    SELECT id, channel_key FROM content_generations
    WHERE id IN (${STEP2_CONTENT_IDS.map(id => `'${id}'`).join(',')})
  `));
  const nonPhatPhap2 = step2ChannelCheck.rows.filter((r: any) => r.channel_key !== 'phat_phap');
  if (nonPhatPhap2.length > 0) {
    console.error('[ABORT] Step2 contains non-phat_phap content:', nonPhatPhap2);
    process.exit(1);
  }
  console.log(`[PRE-S2] All ${step2ChannelCheck.rows.length} Step2 content_ids confirmed phat_phap ✓`);

  // Verify no tang_sau content in either set
  const allIds = [...STEP1_CONTENT_IDS, ...STEP2_CONTENT_IDS];
  const tangSauCheck = await db.execute(sql.raw(`
    SELECT id FROM content_generations
    WHERE id IN (${allIds.map(id => `'${id}'`).join(',')})
      AND channel_key = 'tang_sau'
  `));
  if (tangSauCheck.rows.length > 0) {
    console.error('[ABORT] tang_sau content detected!', tangSauCheck.rows);
    process.exit(1);
  }
  console.log(`[PRE] No tang_sau content in target set ✓`);

  // Verify no done rows in the FB rows we intend to update for Step1
  const doneCheck = await db.execute(sql.raw(`
    SELECT uq.id, uq.status FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    WHERE uq.content_id IN (${STEP1_CONTENT_IDS.map(id => `'${id}'`).join(',')})
      AND sc.platform = 'facebook'
      AND uq.status = 'done'
  `));
  if (doneCheck.rows.length > 0) {
    console.error('[ABORT] Some FB rows already done:', doneCheck.rows);
    process.exit(1);
  }
  console.log(`[PRE] No done/published FB rows in Step1 targets ✓`);

  console.log('\n─────────────────────────────────────────────────\n');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Reschedule 3 recovery batch FB rows to match YT
  // ─────────────────────────────────────────────────────────────────────────
  console.log('[STEP 1] Rescheduling FB rows to match YT slots...\n');

  const step1Results: Array<{
    content_id: string;
    fb_queue_id: string;
    video_type: string;
    old_scheduled_vn: string;
    new_scheduled_vn: string;
    action: string;
  }> = [];

  for (const contentId of STEP1_CONTENT_IDS) {
    // Get the YT queued row's scheduled_at
    const ytRow = await db.execute(sql.raw(`
      SELECT uq.id, uq.scheduled_at, uq.status
      FROM upload_queue uq
      JOIN social_channels sc ON uq.channel_id = sc.id
      WHERE uq.content_id = '${contentId}'
        AND sc.platform = 'youtube'
        AND sc.id = 1
        AND uq.status = 'queued'
      LIMIT 1
    `));
    if (ytRow.rows.length === 0) {
      console.warn(`[S1-SKIP] ${contentId}: no queued YT row found`);
      continue;
    }
    const ytScheduledUtc = (ytRow.rows[0] as any).scheduled_at;
    // Parse YT UTC, compute +5 min for quote row
    const ytTime = new Date(ytScheduledUtc);
    const qtTime = new Date(ytTime.getTime() + 5 * 60 * 1000); // +5 min for quote row

    // Get the FB queued rows (short + quote)
    const fbRows = await db.execute(sql.raw(`
      SELECT uq.id, uq.video_type, uq.scheduled_at, uq.status
      FROM upload_queue uq
      JOIN social_channels sc ON uq.channel_id = sc.id
      WHERE uq.content_id = '${contentId}'
        AND sc.platform = 'facebook'
        AND sc.id = 6
        AND uq.status = 'queued'
      ORDER BY uq.video_type ASC  -- 'quote' then 'short'
    `));

    for (const fbRow of fbRows.rows as any[]) {
      const isQuote = fbRow.video_type === 'quote';
      const newTime = isQuote ? qtTime : ytTime;
      const newUtc = newTime.toISOString();
      const oldVN = toVN(fbRow.scheduled_at);
      const newVN = toVN(newUtc);

      // Safety: must not be 'done'
      if (fbRow.status !== 'queued') {
        console.warn(`[S1-SKIP] ${contentId} fb row ${fbRow.id}: status=${fbRow.status} not queued`);
        continue;
      }

      await db.execute(sql.raw(`
        UPDATE upload_queue
        SET scheduled_at = '${newUtc}',
            updated_at = now()
        WHERE id = '${fbRow.id}'
          AND status = 'queued'
      `));

      step1Results.push({
        content_id: contentId,
        fb_queue_id: fbRow.id,
        video_type: fbRow.video_type,
        old_scheduled_vn: oldVN,
        new_scheduled_vn: newVN,
        action: 'RESCHEDULE_TO_MATCH_YT',
      });
      console.log(`  [S1-UPDATE] ${fbRow.video_type} ${fbRow.id}: ${oldVN} → ${newVN}`);
    }
  }

  console.log(`\n[STEP 1] Done. ${step1Results.length} rows rescheduled.`);
  console.log('\n─────────────────────────────────────────────────\n');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Check 30 FB-only content_ids for existing YT rows
  // ─────────────────────────────────────────────────────────────────────────
  console.log('[STEP 2] Checking 30 FB-only content_ids for YT status...\n');

  const step2Results: Array<{
    content_id: string;
    topic: string;
    yt_queue_id: string | null;
    scheduled_at_vn: string | null;
    matched_fb_slot_vn: string | null;
    action: string;
    reason: string;
  }> = [];

  let insertedCount = 0;
  let skippedCount = 0;

  for (const contentId of STEP2_CONTENT_IDS) {
    // Check if any YT row already exists (any status)
    const ytExisting = await db.execute(sql.raw(`
      SELECT uq.id, uq.status
      FROM upload_queue uq
      JOIN social_channels sc ON uq.channel_id = sc.id
      WHERE uq.content_id = '${contentId}'
        AND sc.platform = 'youtube'
    `));

    // Get content info
    const cgRow = await db.execute(sql.raw(`
      SELECT id, topic, topic_family, format_type, video_status, video_path
      FROM content_generations
      WHERE id = '${contentId}'
    `));
    const cg = cgRow.rows[0] as any;

    if (ytExisting.rows.length > 0) {
      const existingStatuses = (ytExisting.rows as any[]).map(r => r.status).join(',');
      step2Results.push({
        content_id: contentId,
        topic: cg?.topic ?? '?',
        yt_queue_id: null,
        scheduled_at_vn: null,
        matched_fb_slot_vn: null,
        action: 'SKIP',
        reason: `YouTube row already exists (status=${existingStatuses})`,
      });
      skippedCount++;
      continue;
    }

    // No YT row — check video readiness
    if (!cg || cg.video_status !== 'done' || !cg.video_path) {
      step2Results.push({
        content_id: contentId,
        topic: cg?.topic ?? '?',
        yt_queue_id: null,
        scheduled_at_vn: null,
        matched_fb_slot_vn: null,
        action: 'SKIP',
        reason: `video not ready (status=${cg?.video_status}, path=${cg?.video_path ?? 'null'})`,
      });
      skippedCount++;
      continue;
    }

    // Get first FB queued slot (earliest scheduled_at)
    const fbFirst = await db.execute(sql.raw(`
      SELECT uq.scheduled_at, uq.title, uq.description, uq.tags
      FROM upload_queue uq
      JOIN social_channels sc ON uq.channel_id = sc.id
      WHERE uq.content_id = '${contentId}'
        AND sc.platform = 'facebook'
        AND uq.status = 'queued'
        AND uq.video_type = 'short'
      ORDER BY uq.scheduled_at ASC
      LIMIT 1
    `));

    if (fbFirst.rows.length === 0) {
      step2Results.push({
        content_id: contentId,
        topic: cg.topic,
        yt_queue_id: null,
        scheduled_at_vn: null,
        matched_fb_slot_vn: null,
        action: 'SKIP',
        reason: 'no FB short queued row found to match against',
      });
      skippedCount++;
      continue;
    }

    const fb = fbFirst.rows[0] as any;
    const newId = crypto.randomUUID();
    const fbSlotVN = toVN(fb.scheduled_at);

    await db.execute(sql.raw(`
      INSERT INTO upload_queue
        (id, content_id, channel_id, platform, video_type, title, description, tags,
         privacy_status, scheduled_at, status, created_at, updated_at)
      VALUES (
        '${newId}',
        '${contentId}',
        1,
        'youtube',
        'short',
        ${fb.title ? `'${(fb.title as string).replace(/'/g, "''")}'` : `'${(cg.topic as string).replace(/'/g, "''")}'`},
        '',
        '[]'::jsonb,
        'public',
        '${fb.scheduled_at}',
        'queued',
        now(),
        now()
      )
    `));

    step2Results.push({
      content_id: contentId,
      topic: cg.topic,
      yt_queue_id: newId,
      scheduled_at_vn: fbSlotVN,
      matched_fb_slot_vn: fbSlotVN,
      action: 'INSERT',
      reason: 'new YT row created matching first FB short slot',
    });
    insertedCount++;
  }

  console.log(`[STEP 2] Done. ${insertedCount} rows inserted, ${skippedCount} skipped.`);
  console.log('\n─────────────────────────────────────────────────\n');

  // ─────────────────────────────────────────────────────────────────────────
  // POST-MUTATION VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────
  const postCount = await db.execute(sql`SELECT count(*) as cnt FROM upload_queue`);
  const postTotal = Number((postCount.rows[0] as any).cnt);
  console.log(`[POST] upload_queue total: ${baselineCount} → ${postTotal} (delta: +${postTotal - baselineCount})`);

  // Verify no duplicate YT rows for any step1 or step2 content_id
  const dupCheck = await db.execute(sql.raw(`
    SELECT uq.content_id, sc.platform, count(*) as cnt
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    WHERE uq.content_id IN (${allIds.map(id => `'${id}'`).join(',')})
      AND sc.platform = 'youtube'
      AND uq.video_type = 'short'
    GROUP BY uq.content_id, sc.platform
    HAVING count(*) > 1
  `));
  if (dupCheck.rows.length > 0) {
    console.error('[POST-ERROR] Duplicate YT short rows detected!', dupCheck.rows);
  } else {
    console.log('[POST] No duplicate YT short rows ✓');
  }

  // Verify no done rows were touched (FB rows for step1 items should not be done)
  const donePostCheck = await db.execute(sql.raw(`
    SELECT uq.id, uq.status, sc.platform
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    WHERE uq.content_id IN (${STEP1_CONTENT_IDS.map(id => `'${id}'`).join(',')})
      AND sc.platform = 'facebook'
      AND uq.status = 'done'
  `));
  console.log(`[POST] Done FB rows for step1 content (should be 0): ${donePostCheck.rows.length}`);

  // Coverage: tts_short with and without YT row
  const allTtsIds = [...new Set([...STEP1_CONTENT_IDS, ...STEP2_CONTENT_IDS])];
  const ytCoverage = await db.execute(sql.raw(`
    SELECT
      cg.id,
      count(uq_yt.id) as yt_count,
      count(uq_fb.id) as fb_count
    FROM content_generations cg
    LEFT JOIN upload_queue uq_yt ON uq_yt.content_id = cg.id
      AND uq_yt.channel_id = 1
    LEFT JOIN upload_queue uq_fb ON uq_fb.content_id = cg.id
      AND uq_fb.channel_id = 6
      AND uq_fb.video_type = 'short'
      AND uq_fb.status = 'queued'
    WHERE cg.id IN (${allTtsIds.map(id => `'${id}'`).join(',')})
    GROUP BY cg.id
  `));
  const withYT = (ytCoverage.rows as any[]).filter(r => Number(r.yt_count) > 0).length;
  const noYT = (ytCoverage.rows as any[]).filter(r => Number(r.yt_count) === 0).length;
  console.log(`[POST] tts_short coverage (of 33 total): YT covered=${withYT}, missing YT=${noYT}`);

  // YT backlog
  const ytBacklog = await db.execute(sql`
    SELECT
      count(*) as cnt,
      min(scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as earliest_vn,
      max(scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as latest_vn
    FROM upload_queue uq
    WHERE uq.channel_id = 1
      AND uq.status = 'queued'
  `);
  console.log('[POST] YT backlog:', JSON.stringify(ytBacklog.rows[0], null, 2));

  // FB backlog
  const fbBacklog = await db.execute(sql`
    SELECT
      count(*) as cnt,
      min(scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as earliest_vn,
      max(scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as latest_vn
    FROM upload_queue uq
    WHERE uq.channel_id = 6
      AND uq.status = 'queued'
  `);
  console.log('[POST] FB backlog:', JSON.stringify(fbBacklog.rows[0], null, 2));

  // Check drift remaining (YT+FB queued for same content, compare scheduled_at)
  const driftCheck = await db.execute(sql.raw(`
    SELECT
      uq_yt.content_id,
      cg.topic,
      uq_yt.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as yt_vn,
      uq_fb.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as fb_vn,
      extract(epoch from (uq_fb.scheduled_at - uq_yt.scheduled_at))/3600.0 as drift_hours
    FROM upload_queue uq_yt
    JOIN upload_queue uq_fb ON uq_fb.content_id = uq_yt.content_id
      AND uq_fb.channel_id = 6
      AND uq_fb.video_type = 'short'
      AND uq_fb.status = 'queued'
    JOIN social_channels sc ON uq_yt.channel_id = sc.id
    JOIN content_generations cg ON uq_yt.content_id = cg.id
    WHERE uq_yt.channel_id = 1
      AND uq_yt.status = 'queued'
    ORDER BY ABS(extract(epoch from (uq_fb.scheduled_at - uq_yt.scheduled_at))) DESC
  `));
  console.log('[POST] YT+FB queued drift check:');
  for (const row of driftCheck.rows as any[]) {
    const drift = Number(row.drift_hours).toFixed(1);
    const flag = Math.abs(Number(row.drift_hours)) > 1 ? ' ⚠️' : '';
    console.log(`  ${(row.topic as string).slice(0, 40)}: drift=${drift}h${flag}`);
  }

  // ── Output Step 1 table ─────────────────────────────────────────────────
  console.log('\n══════════ STEP 1 RESULT ══════════');
  console.log('content_id (short) | fb_queue_id | video_type | old_scheduled_vn | new_scheduled_vn | action');
  for (const r of step1Results) {
    console.log(`${r.content_id.slice(0,8)} | ${r.fb_queue_id.slice(0,8)} | ${r.video_type} | ${r.old_scheduled_vn} | ${r.new_scheduled_vn} | ${r.action}`);
  }

  // ── Output Step 2 table ─────────────────────────────────────────────────
  console.log('\n══════════ STEP 2 RESULT ══════════');
  console.log('content_id (short) | topic | yt_queue_id | scheduled_vn | matched_fb_slot | action | reason');
  for (const r of step2Results) {
    const ytId = r.yt_queue_id ? r.yt_queue_id.slice(0,8) : 'N/A';
    const slot = r.scheduled_at_vn ?? 'N/A';
    console.log(`${r.content_id.slice(0,8)} | ${r.topic.slice(0,25)} | ${ytId} | ${slot} | ${r.matched_fb_slot_vn ?? 'N/A'} | ${r.action} | ${r.reason}`);
  }

  console.log('\n[DONE]');
  process.exit(0);
}
main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
