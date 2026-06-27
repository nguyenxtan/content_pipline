/**
 * Emergency Backlog Stop — 2026-06-16
 * Acquires the SAME Postgres advisory lock used by cron (72400131),
 * then classifies and either cancels or defers all overdue queued rows.
 *
 * SAFETY: read-only until DRY_RUN=false
 */

import pg from '/Users/bichtuyen/code/content_pipline/node_modules/pg/lib/index.js';
const { Client } = pg;

const DB_URL = 'postgresql://admin:admin123@localhost:5433/content_pipeline';
const CRON_LOCK_KEY = 72400131;
const DRY_RUN = process.argv.includes('--dry-run');
const INVALID_GRANT_RETRY_IDS = [
  'ec4a563f-6ee5-4def-bef5-91172aeb41f7',
  '1b4c553d-acb5-49d7-a6d4-8eca32a5a89f',
  '1c718684-5fb6-4744-abdf-5a75ff22dacd',
];

// VN tomorrow 07:00..22:05 slots (UTC)
// 2026-06-17 VN 07:00 = 2026-06-17 00:00 UTC
function buildTomorrowSlots() {
  const slots = [];
  // VN 07:00–22:00 => UTC 00:00–15:00 on 2026-06-17
  for (let hh = 0; hh <= 15; hh++) {
    const utcH = hh.toString().padStart(2, '0');
    slots.push({
      utc: `2026-06-17T${utcH}:00:00Z`,
      vnH: hh + 7,
      minute: 0,
    });
    // HH:05 VN = HH:05 UTC+7
    if (hh <= 14) {
      slots.push({
        utc: `2026-06-17T${utcH}:05:00Z`,
        vnH: hh + 7,
        minute: 5,
      });
    }
  }
  return slots; // includes VN 07:00..22:00 and 07:05..22:05
}

const client = new Client({ connectionString: DB_URL });

async function run() {
  await client.connect();
  console.log('\n=== Emergency Backlog Stop ===');
  console.log(`DRY_RUN: ${DRY_RUN}`);

  // ── Step 0: Acquire advisory lock ─────────────────────────────
  const lockRes = await client.query(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [CRON_LOCK_KEY]
  );
  const locked = lockRes.rows[0].locked;
  if (!locked) {
    console.error('LOCK_FAILED: Advisory lock already held by cron — try again in 30s');
    await client.end();
    process.exit(1);
  }
  console.log(`\n[LOCK] Advisory lock ${CRON_LOCK_KEY} ACQUIRED`);

  const timeRes = await client.query(
    `SELECT NOW() AS db_now_utc, NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh' AS db_now_vn`
  );
  const dbNow = timeRes.rows[0].db_now_utc;
  console.log(`[TIME] DB UTC: ${new Date(dbNow).toISOString()}`);
  console.log(`[TIME] DB VN : ${new Date(dbNow).toISOString()} (+7h offset not shown in raw)`);

  // ── Step 1: Snapshot ──────────────────────────────────────────
  const overdueRes = await client.query(`
    SELECT uq.id, uq.content_id, uq.platform, sc.channel_key, uq.video_type,
           uq.status, uq.scheduled_at, uq.error_message,
           cg.topic, cg.youtube_video_url, cg.facebook_video_url,
           cg.video_status, cg.video_path
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE uq.status = 'queued' AND uq.scheduled_at < NOW()
    ORDER BY uq.scheduled_at ASC
  `);
  const futureRes = await client.query(`
    SELECT uq.id, uq.content_id, uq.platform, sc.channel_key, uq.video_type,
           uq.status, uq.scheduled_at
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.status IN ('queued', 'uploading')
      AND uq.scheduled_at >= NOW()
      AND uq.scheduled_at < NOW() + INTERVAL '48 hours'
    ORDER BY uq.scheduled_at ASC
  `);
  const uploadingRes = await client.query(`
    SELECT id, content_id, platform, video_type, status, updated_at
    FROM upload_queue WHERE status='uploading'
    ORDER BY updated_at ASC
  `);
  const errorRes = await client.query(`
    SELECT uq.id, uq.content_id, uq.platform, sc.channel_key, uq.video_type,
           uq.status, uq.error_message, uq.updated_at
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.status = 'error'
      AND uq.updated_at >= NOW() - INTERVAL '48 hours'
    ORDER BY uq.updated_at DESC
  `);
  const doneLastHourRes = await client.query(`
    SELECT COUNT(*) AS cnt FROM upload_queue
    WHERE status='done' AND updated_at >= NOW() - INTERVAL '1 hour'
  `);

  console.log('\n── Snapshot ──────────────────────────────────────────────');
  console.log(`  Overdue queued (will process) : ${overdueRes.rows.length}`);
  console.log(`  Future queued/uploading (48h) : ${futureRes.rows.length}`);
  console.log(`  Currently uploading           : ${uploadingRes.rows.length}`);
  console.log(`  Error rows (48h)              : ${errorRes.rows.length}`);
  console.log(`  Done last 1h                  : ${doneLastHourRes.rows[0].cnt}`);

  if (uploadingRes.rows.length > 0) {
    console.log('\n  [WARNING] uploading rows exist — will complete on their own:');
    uploadingRes.rows.forEach(r => console.log(`    ${r.id.substring(0,8)} ${r.platform} ${r.video_type}`));
  }

  // ── Step 2: Classify overdue rows ─────────────────────────────
  // Check published_videos for each content + platform + video_type
  const allContentIds = [...new Set(overdueRes.rows.map(r => r.content_id))];

  let pubCheckRows = [];
  if (allContentIds.length > 0) {
    const pubRes = await client.query(`
      SELECT pv.content_id, pv.platform, pv.video_type
      FROM published_videos
      WHERE content_id = ANY($1::text[])
    `, [allContentIds]);
    pubCheckRows = pubRes.rows;
  }

  // Build set of "already published" combos
  const pubSet = new Set(pubCheckRows.map(r => `${r.content_id}|${r.platform}|${r.video_type}`));

  // Build set of "already done in upload_queue" for same content/platform/video_type
  const doneQueueRes = await client.query(`
    SELECT uq.content_id, uq.platform, uq.video_type, sc.channel_key
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.status = 'done'
      AND uq.content_id = ANY($1::text[])
  `, [allContentIds]);
  const doneQSet = new Set(doneQueueRes.rows.map(r => `${r.content_id}|${r.platform}|${r.video_type}|${r.channel_key}`));

  // Classify
  const toCancel = [];
  const toDefer = [];

  for (const row of overdueRes.rows) {
    const pubKey = `${row.content_id}|${row.platform}|${row.video_type}`;
    const doneKey = `${row.content_id}|${row.platform}|${row.video_type}|${row.channel_key}`;
    const isAlreadyPublished = pubSet.has(pubKey) || doneQSet.has(doneKey);
    const isInvalidGrantRetry = INVALID_GRANT_RETRY_IDS.includes(row.id);
    const isVideoReady = row.video_status === 'done' && row.video_path;

    if (isAlreadyPublished) {
      toCancel.push({ ...row, reason: 'already_published_in_published_videos_or_done_queue' });
    } else if (isInvalidGrantRetry) {
      toCancel.push({ ...row, reason: 'invalid_grant_retry_not_needed' });
    } else if (!isVideoReady) {
      // video not generated — cannot publish
      toCancel.push({ ...row, reason: 'video_not_ready_video_status_' + (row.video_status || 'null') });
    } else {
      toDefer.push(row);
    }
  }

  console.log(`\n── Classification ────────────────────────────────────────`);
  console.log(`  Cancel : ${toCancel.length}`);
  console.log(`  Defer  : ${toDefer.length}`);

  toCancel.forEach(r => console.log(`    CANCEL ${r.id.substring(0,8)} ${r.platform}/${r.channel_key}/${r.video_type} | ${r.reason.substring(0,50)} | ${r.topic.substring(0,30)}`));
  toDefer.forEach(r => console.log(`    DEFER  ${r.id.substring(0,8)} ${r.platform}/${r.channel_key}/${r.video_type} | ${r.topic.substring(0,30)}`));

  // ── Step 3: Build tomorrow slot assignments ───────────────────
  if (toDefer.length > 0) {
    // Find already-taken slots tomorrow
    const takenRes = await client.query(`
      SELECT uq.scheduled_at, uq.platform, sc.channel_key, uq.video_type
      FROM upload_queue uq
      JOIN social_channels sc ON sc.id = uq.channel_id
      WHERE uq.status IN ('queued', 'uploading', 'done')
        AND uq.scheduled_at >= '2026-06-17T00:00:00Z'
        AND uq.scheduled_at < '2026-06-18T00:00:00Z'
    `);
    const takenSlotSet = new Set(
      takenRes.rows.map(r => `${new Date(r.scheduled_at).toISOString()}|${r.platform}|${r.channel_key}|${r.video_type}`)
    );

    // Group defer rows by content_id to assign consistent slots per group
    const byContent = {};
    for (const row of toDefer) {
      if (!byContent[row.content_id]) byContent[row.content_id] = [];
      byContent[row.content_id].push(row);
    }

    // Track assigned slots this run to avoid self-collision
    const assignedSlots = new Set();

    // Find next free HH:00 slot for a given platform/channel/video_type
    function findFreeSlot(platform, channelKey, videoType, minute = 0) {
      // VN 07:00..22:00 = UTC 00:00..15:00 on 2026-06-17
      for (let h = 0; h <= 15; h++) {
        const utcH = h.toString().padStart(2, '0');
        const utcMin = minute.toString().padStart(2, '0');
        const slotUTC = `2026-06-17T${utcH}:${utcMin}:00.000Z`;
        const key = `${slotUTC}|${platform}|${channelKey}|${videoType}`;
        if (!takenSlotSet.has(key) && !assignedSlots.has(key)) {
          return slotUTC;
        }
      }
      // Try 2026-06-18 if tomorrow full
      for (let h = 0; h <= 15; h++) {
        const utcH = h.toString().padStart(2, '0');
        const utcMin = minute.toString().padStart(2, '0');
        const slotUTC = `2026-06-18T${utcH}:${utcMin}:00.000Z`;
        const key = `${slotUTC}|${platform}|${channelKey}|${videoType}`;
        if (!takenSlotSet.has(key) && !assignedSlots.has(key)) {
          return slotUTC;
        }
      }
      return null;
    }

    // For phat_phap groups: assign all 3 rows (yt short, fb short, fb quote) to same HH
    // For tang_sau: assign yt short to next free HH
    const deferAssignments = []; // { id, newScheduledAt }

    // Process phat_phap groups together
    const phatPhapContents = Object.entries(byContent)
      .filter(([_, rows]) => rows.some(r => r.channel_key === 'phat_phap'))
      .sort(([aid], [bid]) => aid.localeCompare(bid));

    for (const [contentId, rows] of phatPhapContents) {
      const ytRow = rows.find(r => r.platform === 'youtube' && r.video_type === 'short');
      const fbShortRow = rows.find(r => r.platform === 'facebook' && r.video_type === 'short');
      const fbQuoteRow = rows.find(r => r.platform === 'facebook' && r.video_type === 'quote');

      // Find a free HH that works for all 3
      let chosenSlotBase = null;
      for (let h = 0; h <= 15; h++) {
        const utcH = h.toString().padStart(2, '0');
        const slotBase = `2026-06-17T${utcH}:00:00.000Z`;
        const slotQuote = `2026-06-17T${utcH}:05:00.000Z`;

        const ytKey   = ytRow ? `${slotBase}|youtube|phat_phap|short` : null;
        const fbShKey = fbShortRow ? `${slotBase}|facebook|phat_phap|short` : null;
        const fbQuKey = fbQuoteRow ? `${slotQuote}|facebook|phat_phap|quote` : null;

        const allFree = [ytKey, fbShKey, fbQuKey]
          .filter(Boolean)
          .every(k => !takenSlotSet.has(k) && !assignedSlots.has(k));

        if (allFree) {
          chosenSlotBase = { base: slotBase, quote: slotQuote };
          // Mark assigned
          if (ytKey) assignedSlots.add(ytKey);
          if (fbShKey) assignedSlots.add(fbShKey);
          if (fbQuKey) assignedSlots.add(fbQuKey);
          break;
        }
      }

      // Fallback: 2026-06-18
      if (!chosenSlotBase) {
        for (let h = 0; h <= 15; h++) {
          const utcH = h.toString().padStart(2, '0');
          const slotBase = `2026-06-18T${utcH}:00:00.000Z`;
          const slotQuote = `2026-06-18T${utcH}:05:00.000Z`;
          const ytKey   = ytRow ? `${slotBase}|youtube|phat_phap|short` : null;
          const fbShKey = fbShortRow ? `${slotBase}|facebook|phat_phap|short` : null;
          const fbQuKey = fbQuoteRow ? `${slotQuote}|facebook|phat_phap|quote` : null;
          const allFree = [ytKey, fbShKey, fbQuKey]
            .filter(Boolean)
            .every(k => !takenSlotSet.has(k) && !assignedSlots.has(k));
          if (allFree) {
            chosenSlotBase = { base: slotBase, quote: slotQuote };
            if (ytKey) assignedSlots.add(ytKey);
            if (fbShKey) assignedSlots.add(fbShKey);
            if (fbQuKey) assignedSlots.add(fbQuKey);
            break;
          }
        }
      }

      if (chosenSlotBase) {
        if (ytRow) deferAssignments.push({ id: ytRow.id, newScheduledAt: chosenSlotBase.base, topic: ytRow.topic, platform: ytRow.platform, channel_key: ytRow.channel_key, video_type: ytRow.video_type });
        if (fbShortRow) deferAssignments.push({ id: fbShortRow.id, newScheduledAt: chosenSlotBase.base, topic: fbShortRow.topic, platform: fbShortRow.platform, channel_key: fbShortRow.channel_key, video_type: fbShortRow.video_type });
        if (fbQuoteRow) deferAssignments.push({ id: fbQuoteRow.id, newScheduledAt: chosenSlotBase.quote, topic: fbQuoteRow.topic, platform: fbQuoteRow.platform, channel_key: fbQuoteRow.channel_key, video_type: fbQuoteRow.video_type });
      } else {
        console.error(`[WARN] Could not find free slot for phat_phap contentId ${contentId}`);
      }
    }

    // Process tang_sau
    const tangSauContents = Object.entries(byContent)
      .filter(([_, rows]) => rows.some(r => r.channel_key === 'tang_sau'));

    for (const [contentId, rows] of tangSauContents) {
      const ytRow = rows.find(r => r.platform === 'youtube' && r.video_type === 'short');
      if (!ytRow) continue;

      // Find a free HH for tang_sau (prefer NOT same hour as a phat_phap group)
      let chosenSlot = null;
      for (let h = 0; h <= 15; h++) {
        const utcH = h.toString().padStart(2, '0');
        const slotBase = `2026-06-17T${utcH}:00:00.000Z`;
        const key = `${slotBase}|youtube|tang_sau|short`;
        const phatPhapHourTaken = assignedSlots.has(`${slotBase}|youtube|phat_phap|short`);
        if (!takenSlotSet.has(key) && !assignedSlots.has(key) && !phatPhapHourTaken) {
          chosenSlot = slotBase;
          assignedSlots.add(key);
          break;
        }
      }
      // Relaxed fallback: same hour as phat_phap is ok if needed
      if (!chosenSlot) {
        for (let h = 0; h <= 15; h++) {
          const utcH = h.toString().padStart(2, '0');
          const slotBase = `2026-06-17T${utcH}:00:00.000Z`;
          const key = `${slotBase}|youtube|tang_sau|short`;
          if (!takenSlotSet.has(key) && !assignedSlots.has(key)) {
            chosenSlot = slotBase;
            assignedSlots.add(key);
            break;
          }
        }
      }

      if (chosenSlot) {
        deferAssignments.push({ id: ytRow.id, newScheduledAt: chosenSlot, topic: ytRow.topic, platform: ytRow.platform, channel_key: ytRow.channel_key, video_type: ytRow.video_type });
      } else {
        console.error(`[WARN] Could not find free slot for tang_sau contentId ${contentId}`);
      }
    }

    console.log('\n── Defer Assignments ─────────────────────────────────────');
    deferAssignments.forEach(a => {
      const vnHour = new Date(a.newScheduledAt).getUTCHours() + 7;
      const vnMin  = new Date(a.newScheduledAt).getUTCMinutes();
      console.log(`  ${a.id.substring(0,8)} → ${a.newScheduledAt} (VN ${vnHour.toString().padStart(2,'0')}:${vnMin.toString().padStart(2,'0')}) ${a.platform}/${a.channel_key}/${a.video_type} | ${a.topic.substring(0,30)}`);
    });

    // Execute defers
    if (!DRY_RUN) {
      for (const a of deferAssignments) {
        await client.query(`
          UPDATE upload_queue
          SET scheduled_at = $1,
              error_message = 'deferred_by_operator_stop_backlog_drain_2026_06_16',
              updated_at = NOW()
          WHERE id = $2 AND status = 'queued'
        `, [a.newScheduledAt, a.id]);
      }
      console.log(`\n[DEFER] Executed ${deferAssignments.length} defers`);
    } else {
      console.log(`\n[DRY_RUN] Would defer ${deferAssignments.length} rows`);
    }
  }

  // ── Step 4: Cancel rows ────────────────────────────────────────
  // Also cancel the known invalid_grant retry rows
  const allToCancel = [
    ...toCancel,
    ...INVALID_GRANT_RETRY_IDS.map(id => ({ id, _isGrantRetry: true }))
  ];
  const cancelIds = [...new Set(allToCancel.map(r => r.id))];

  const cancelReasons = {};
  for (const r of toCancel) cancelReasons[r.id] = r.reason || 'stop_backlog_drain';
  for (const id of INVALID_GRANT_RETRY_IDS) {
    if (!cancelReasons[id]) cancelReasons[id] = 'invalid_grant_retry_not_needed';
  }

  console.log(`\n── Cancel (${cancelIds.length} rows) ─────────────────────────────`);
  cancelIds.forEach(id => console.log(`  CANCEL ${id.substring(0,8)} | ${cancelReasons[id] || ''}`));

  let cancelledCount = 0;
  if (!DRY_RUN && cancelIds.length > 0) {
    // Cancel in batches (reason per-ID)
    for (const id of cancelIds) {
      const reason = cancelReasons[id] || 'cancelled_by_operator_stop_backlog_drain_2026_06_16';
      const res = await client.query(`
        UPDATE upload_queue
        SET status = 'cancelled',
            error_message = $1,
            updated_at = NOW()
        WHERE id = $2 AND status = 'queued'
      `, [`cancelled_by_operator_${reason}_2026_06_16`, id]);
      cancelledCount += res.rowCount || 0;
    }
    console.log(`[CANCEL] Executed: ${cancelledCount} rows cancelled`);
  } else if (DRY_RUN) {
    console.log(`[DRY_RUN] Would cancel ${cancelIds.length} rows`);
  }

  // ── Step 5: Verify ────────────────────────────────────────────
  const verifyOverdue = await client.query(`
    SELECT COUNT(*) AS cnt FROM upload_queue
    WHERE status='queued' AND scheduled_at < NOW()
  `);
  const verifyCollisions = await client.query(`
    SELECT
      uq.scheduled_at,
      uq.platform,
      sc.channel_key,
      uq.video_type,
      uq.status,
      COUNT(*) AS cnt
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.status IN ('queued','uploading')
      AND uq.scheduled_at >= NOW()
      AND uq.scheduled_at < NOW() + INTERVAL '48 hours'
    GROUP BY 1,2,3,4,5
    HAVING COUNT(*) > 1
    ORDER BY 1 ASC
  `);
  const nextQueue = await client.query(`
    SELECT uq.id, uq.platform, sc.channel_key, uq.video_type,
           uq.scheduled_at,
           uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS sched_vn
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.status = 'queued'
      AND uq.scheduled_at >= NOW()
      AND uq.scheduled_at < NOW() + INTERVAL '24 hours'
    ORDER BY uq.scheduled_at ASC
  `);

  console.log('\n── Verification ──────────────────────────────────────────');
  console.log(`  overdue_queued = ${verifyOverdue.rows[0].cnt} (expected: 0)`);
  console.log(`  active collisions (queued/uploading) = ${verifyCollisions.rows.length}`);
  if (verifyCollisions.rows.length > 0) {
    verifyCollisions.rows.forEach(r => console.log(`    COLLISION: ${new Date(r.scheduled_at).toISOString().substring(0,16)} ${r.platform}/${r.channel_key}/${r.video_type} cnt:${r.cnt} status:${r.status}`));
  }
  console.log(`\n  Next 24h queue (${nextQueue.rows.length} rows):`);
  nextQueue.rows.forEach(r => {
    const vnH = new Date(r.scheduled_at).getUTCHours() + 7;
    const vnM = new Date(r.scheduled_at).getUTCMinutes();
    console.log(`    ${r.id.substring(0,8)} ${r.platform}/${r.channel_key}/${r.video_type} → VN ${vnH.toString().padStart(2,'0')}:${vnM.toString().padStart(2,'0')} ${new Date(r.scheduled_at).toISOString().substring(0,16)}`);
  });

  // ── Step 6: Release lock ───────────────────────────────────────
  await client.query(`SELECT pg_advisory_unlock($1)`, [CRON_LOCK_KEY]);
  console.log(`\n[LOCK] Advisory lock ${CRON_LOCK_KEY} RELEASED`);

  await client.end();
  console.log('\n=== Done ===');

  // Summary for report
  return {
    dbNow: new Date(dbNow).toISOString(),
    cancelled: cancelledCount,
    deferred: toDefer.length,
    overdueAfter: parseInt(verifyOverdue.rows[0].cnt),
    collisions: verifyCollisions.rows.length,
    nextRows: nextQueue.rows.length,
  };
}

run().catch(async e => {
  console.error('FATAL:', e.message);
  try { await client.query(`SELECT pg_advisory_unlock($1)`, [CRON_LOCK_KEY]); } catch {}
  try { await client.end(); } catch {}
  process.exit(1);
});
