-- Voice Rotation V1
-- Adds per-content TTS voice column to content_generations.
-- Populated at INSERT time by voice-rotation.ts pickVoiceForContent().
-- NULL = use niche default (Ly). Non-null = locked voice, never changed after audio is generated.
ALTER TABLE "content_generations" ADD COLUMN "tts_voice" varchar(50);
