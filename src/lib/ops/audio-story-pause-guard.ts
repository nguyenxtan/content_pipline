/**
 * Lane-level pause guard for Audio Story production entrypoints.
 *
 * F4.48 purged all local Audio Story media (chapter WAVs, narration/mix,
 * covers, renders, upload packages) while the lane is intentionally
 * paused. Every Audio Story script that can generate, render, upload, or
 * change YouTube visibility/metadata must check this guard first and
 * refuse to proceed while paused — otherwise a stray cron tick or manual
 * run could silently start regenerating/uploading against stale state.
 *
 * The env var is never set by code — only an operator (or their cron/env
 * config) flips it. Checking it is just `process.env.AUDIO_STORY_LANE_PAUSED
 * === "1"`; this helper exists so the message and the check stay
 * consistent across every entrypoint.
 *
 * Scope: Audio Story only. This must never be read by phat_phap, tang_sau,
 * shorts/reels, Facebook quote/photo, or the generic upload_queue
 * processor — none of those import this module.
 */

export function isAudioStoryLanePaused(): boolean {
  return process.env.AUDIO_STORY_LANE_PAUSED === "1";
}

/**
 * Prints the pause notice and exits the process with code 0 — a paused
 * lane is an intentional, expected no-op, not a failure. Call this as
 * early as possible, before any disk/media-heavy work, DB write, or
 * network call, and before printing any dry-run plan.
 */
export function enforceAudioStoryPauseGuard(scriptName: string): void {
  if (!isAudioStoryLanePaused()) return;

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Audio Story lane is PAUSED");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`  ${scriptName} refused to run because AUDIO_STORY_LANE_PAUSED=1 is set.`);
  console.log("  Local Audio Story media was intentionally purged (F4.48) — chapter TTS,");
  console.log("  narration/mix audio, covers, renders, and upload packages no longer exist");
  console.log("  on disk. Resuming would mean regenerating everything from source/DB before");
  console.log("  any gate reads as ready again.");
  console.log("\n  No chapters generated, no TTS, no Fal.ai, no render, no upload, no public,");
  console.log("  no YouTube metadata update, no DB mutation, no file deletion performed.");
  console.log("\n  To resume: unset AUDIO_STORY_LANE_PAUSED (or set it to 0) once you are ready");
  console.log("  to regenerate Audio Story artifacts.");
  console.log("\nPASS (skipped — lane paused)\n");
  process.exit(0);
}
