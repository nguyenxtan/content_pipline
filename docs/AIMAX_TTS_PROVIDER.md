# AiMax TTS Provider

This repo now supports AiMax Studio as a second TTS provider alongside the existing VieNeu integration.

## Env

Required for AiMax:

- `AIMAX_API_KEY`
- `AIMAX_BASE_URL`

Optional:

- `TTS_PROVIDER=aimax`
- `LONGFORM_TTS_PROVIDER=aimax`
- `AIMAX_PROVIDER=minimax`
- `AIMAX_MODEL=speech-2.8-hd`
- `AIMAX_VOICE_ID=<voice_id>`
- `AIMAX_LANGUAGE=Vietnamese`
- `AIMAX_ENABLE_SRT=true`
- `AIMAX_NORMALIZE=true`
- `AIMAX_USE_CHUNKING=false`
- `AIMAX_MAX_CHARS_PER_JOB=500000`
- `AIMAX_SPEED=1.0`
- `AIMAX_PITCH=0`
- `AIMAX_VOLUME=1.0`
- `TTS_MAX_CHARS_PER_CHUNK=2000`

DB/admin settings take priority over env for the AiMax-specific keys above. Env remains the fallback for scripts, CI, and local benchmarks.

## Commands

- `npm run tts:sync-voices`
  - fetches bookmarked/saved AiMax voices from `/api/v1/voices/my/saved-ids`
  - updates `tts_voices`
  - refreshes local cache at `media/cache/tts/aimax-voices.json`

- `npm run tts:discover-best-voice`
  - fetches AiMax voices
  - writes `reports/aimax-voices.md`

- `npm run benchmark:tts`
  - reads `tts_benchmark/story_15min.txt`
  - benchmarks `vieneu` and `aimax`
  - writes `reports/tts-benchmark.json`

- `npm run test:aimax-provider`
  - runs non-network unit checks for chunking/provider parsing

## Notes

- VieNeu remains the default fallback provider.
- Existing short and long TTS flows remain intact unless `TTS_PROVIDER` / `LONGFORM_TTS_PROVIDER` are explicitly changed.
- AiMax longform prefers a single job by default. Chunking is only used when:
  - `aimax.use_chunking=true` in admin settings, or
  - `AIMAX_USE_CHUNKING=true` in env, or
  - the text exceeds `aimax.max_chars_per_job` / `AIMAX_MAX_CHARS_PER_JOB`.
- AiMax job/voice tracking persists to:
  - `tts_voices`
  - `tts_jobs`
- Admin UI:
  - `Settings -> TTS -> General` keeps the existing VieNeu controls.
  - `Settings -> TTS -> AiMax` manages API connection, balance, saved/bookmarked voice sync, default voices, and test generation.
  - The API key is masked after save and is not sent to the client in plaintext.
  - AiMax voice catalog now follows `/api/v1/voices/my/saved-ids` as the source of truth, so only bookmarked voices are shown/synced.
  - Saved AiMax voices are enriched locally with friendly labels / families / recommended use cases:
    - `Thiện Tâm` for `phat_phap_short`
    - `Ngọc Huyền 48k` for `audio_story`
    - `Ngọc Huyền 24k` for test/short validation

## Runtime Metadata

- Effective TTS routing metadata is now persisted into `content_generations.prompt_versions.tts.details`.
- Longform narration manifests and segment-cache metadata also store the resolved provider/voice/tuning metadata.
- This keeps later analytics/classification able to answer:
  - which provider/voice family was used
  - which route selected the voice
  - what speed/pitch/cache identity produced the final audio
