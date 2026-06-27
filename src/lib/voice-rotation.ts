/**
 * voice-rotation.ts — Voice Rotation V1
 *
 * Deterministic, per-content voice selection for VieNeu TTS.
 * Rules:
 *   - Voice is picked once at content INSERT time and stored in content_generations.tts_voice.
 *   - After audio is generated the stored voice is immutable.
 *   - Selection is deterministic: same contentId always → same voice.
 *   - Fallback to Ly on any TTS failure (logged, not silently swallowed).
 *
 * phat_phap V1 mix: 80% Ly · 20% Ngoc
 *   Both are nữ miền Bắc — culturally appropriate for Buddhist dharma narration.
 *   Ngoc is the only non-default voice in V1 to enable A/B audience data without
 *   audience fragmentation.
 */

import crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VoiceEntry = {
  id: string;
  name: string;
  gender: "Nữ" | "Nam";
  region: "Bắc" | "Nam";
  /** Allocation weight 0–100 across all voices. Weights must sum to exactly 100. */
  weight: number;
};

export type VoiceRotationConfig = {
  /** Voice used for new content when no rotation config applies. */
  defaultVoice: string;
  /** Voice used on TTS failure (fallback). Must always be confirmed-working. */
  fallbackVoice: string;
  voices: VoiceEntry[];
};

// ── All confirmed-working VieNeu voices ──────────────────────────────────────
// Verified against TTS server /voices endpoint 2026-06-12.

export const VIENEU_VOICES: VoiceEntry[] = [
  { id: "Ly",    name: "Trúc Ly",    gender: "Nữ", region: "Bắc", weight: 0 },
  { id: "Ngoc",  name: "Bích Ngọc",  gender: "Nữ", region: "Bắc", weight: 0 },
  { id: "Binh",  name: "Thanh Bình", gender: "Nam", region: "Bắc", weight: 0 },
  { id: "Tuyen", name: "Phạm Tuyên", gender: "Nam", region: "Bắc", weight: 0 },
  { id: "Doan",  name: "Thục Đoan",  gender: "Nữ", region: "Nam", weight: 0 },
  { id: "Vinh",  name: "Xuân Vĩnh",  gender: "Nam", region: "Nam", weight: 0 },
  { id: "Sơn",   name: "Thái Sơn",   gender: "Nam", region: "Nam", weight: 0 },
];

// ── Per-channel rotation configs ─────────────────────────────────────────────

/**
 * phat_phap V1: 80% Ly (proven) + 20% Ngoc (A/B test candidate).
 * Both nữ miền Bắc. Conservative split to preserve audience consistency
 * while gathering engagement data across voices.
 */
export const PHAT_PHAP_ROTATION_V1: VoiceRotationConfig = {
  defaultVoice: "Ly",
  fallbackVoice: "Ly",
  voices: [
    { id: "Ly",   name: "Trúc Ly",   gender: "Nữ", region: "Bắc", weight: 80 },
    { id: "Ngoc", name: "Bích Ngọc", gender: "Nữ", region: "Bắc", weight: 20 },
  ],
};

/** Channel key → rotation config. Channels not listed use niche.ttsVoice directly. */
const ROTATION_BY_CHANNEL: Partial<Record<string, VoiceRotationConfig>> = {
  phat_phap: PHAT_PHAP_ROTATION_V1,
};

// ── Core selector ─────────────────────────────────────────────────────────────

/**
 * Deterministically pick a TTS voice for a given contentId and channel.
 *
 * Algorithm:
 *  1. Read first 4 bytes of SHA-256(contentId) as a big-endian uint32.
 *  2. bucket = uint32 % 100  → always 0–99.
 *  3. Walk the voices array with cumulative weights until bucket is covered.
 *
 * Same contentId + same config always returns the same voice.
 * No state, no side effects. Safe to call multiple times.
 *
 * Returns null when the channel has no rotation config (caller should use
 * niche.ttsVoice or "Ly" default instead).
 */
export function pickVoiceForContent(
  contentId: string,
  channelKey: string,
): string | null {
  const config = ROTATION_BY_CHANNEL[channelKey];
  if (!config || config.voices.length === 0) return null;

  const totalWeight = config.voices.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight !== 100) {
    // Misconfigured — log and fall back to default to avoid silent bad behavior
    console.warn(
      `[voice-rotation] weights sum to ${totalWeight} (expected 100) for channel ${channelKey} — using defaultVoice`,
    );
    return config.defaultVoice;
  }

  const hash = crypto.createHash("sha256").update(contentId, "utf8").digest();
  const bucket = hash.readUInt32BE(0) % 100; // deterministic 0–99

  let cumulative = 0;
  for (const voice of config.voices) {
    cumulative += voice.weight;
    if (bucket < cumulative) return voice.id;
  }

  // Should never reach here if weights sum to 100
  return config.fallbackVoice;
}

/**
 * Return the fallback voice for a channel (used when primary TTS fails).
 * Always "Ly" for phat_phap. Defaults to "Ly" for unrecognised channels.
 */
export function getFallbackVoice(channelKey: string): string {
  return ROTATION_BY_CHANNEL[channelKey]?.fallbackVoice ?? "Ly";
}

/**
 * Return the rotation config for a channel, or null if no rotation is defined.
 */
export function getRotationConfig(channelKey: string): VoiceRotationConfig | null {
  return ROTATION_BY_CHANNEL[channelKey] ?? null;
}
