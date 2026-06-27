# Audio Story Pipeline Plan

Last updated: 2026-06-19 (F4.31 — Controlled auto-QC + auto-approve mode added)  
Status: planning document — living spec for the Audio Story product line.

This document is the authoritative plan for the Audio Story pipeline. Update it instead of creating new roadmap files for Audio Story work. The overall project source of truth remains `docs/PROJECT_MASTER_PLAN.md`.

---

## 1. Purpose

Audio Story is a separate serialized fiction pipeline for Vietnamese/Chinese-style long-form audio stories. It is a new product line inside the same web application infrastructure, not an extension of the existing phat_phap, tang_sau, Buddhist, or healing content flows.

Target formats:
- romance
- rebirth
- system
- rebirth + system
- wealth / business empire
- revenge / face-slap
- evil family / fake daughter / real daughter reveal
- regretful CEO
- trillionaire asset reward
- transmigrated villainess
- contract marriage
- sweet-after-abuse

The audience is Vietnamese listeners of serialized audio fiction. The production model is chapter-by-chapter human-approved authoring, not one-shot AI generation.

Target YouTube destination for Audio Story: **Tee Audio** (`@teeaudio` / channel ID `UCtmtL89-IfuhcGBWwcB48Ng`).

---

## 2. Boundary With Existing Flows

### Hard separation

| Dimension | phat_phap / tang_sau / healing | Audio Story |
|-----------|-------------------------------|-------------|
| Content type | Buddhist dharma, philosophy, psychology shorts/reels | Serialized fiction in 30–40 chapters |
| Script origin | Single-shot LLM generation, hook engine, script engine | Multi-pass LLM with human approval per chapter |
| Data model | `content_generations` as primary store | Isolated story tables; `content_generations` not used |
| Analytics | Views/retention per short video | Episode views, playlist follow-through, genre/trope performance |
| TTS input | One short audio clip per content item | One audio clip per episode or chapter |
| Audience intent | Spiritual education, psychological insight | Serialized fiction entertainment |
| Publishing unit | Individual short or long video | Episode playlist + full compilation |

### Shared infrastructure (allowed)

- Database (PostgreSQL via Drizzle) — shared server, separate tables
- UI shell, sidebar, navigation components
- OpenRouter LLM client (`src/lib/llm/openai-client.ts`)
- Storage directories (`media/`)
- TTS service as a pluggable resource (see Phase E)
- Short/reel publishing pipeline — for short teasers only, as a distribution layer

### Not shared

- Prompt templates in `prompt_templates` table
- Hook engine and hook scoring
- `content_generations` as story store
- phat_phap/tang_sau analytics and channel routing
- `upload_queue` workflow for story episode production (will have its own episode lifecycle)

### Short teasers

Shorts/reels may be shared later as a teaser/distribution layer. When a short teaser is derived from a story episode it must carry explicit metadata linking it back to the story:
- `story_id`
- `episode_id`
- `chapter_number`
- `hook_text`
- `cover_text`
- `cliffhanger_line`
- genre/trope tags

Teaser traffic analytics are separate from story episode analytics. A teaser view is not an episode view.

---

## 3. Current State

**Story Studio MVP — done, smoke-tested (2026-06-15)**

Routes live:
- `/story-studio` — dashboard listing all stories
- `/story-studio/new` — taxonomy selector, trope builder, generate premises
- `/story-studio/[storyId]/premises` — premise cards with scores
- `/story-studio/[storyId]/bible` — editable story bible (story concept, character bible, system rules, world rules)
- `/story-studio/[storyId]/outline` — 30–40 chapter outline; approve to unlock chapter drafting
- `/story-studio/[storyId]/chapters/[chapterNumber]` — 3-pane editor: outline | chapter text | continuity check

DB tables (isolated):
- `story_taxonomy` — genre/subgenre tree with hook scores
- `stories` — core entity; carries premise → bible → outline → chapters lifecycle
- `story_characters` — character cards per story
- `story_chapters` — per-chapter drafts, status (draft / reviewing / approved / locked), quality check
- `story_memories` — approved facts/summaries from previous chapters (context window fuel)
- `story_quality_checks` — continuity check snapshots per chapter

Story status flow (existing):
```
idea → premise → bible_ready → outlining → drafting → reviewing → approved → ready_for_audio
```

Smoke test passed through chapter 1 approval and lock.

**Phase B + C — done (2026-06-16):**
- Multi-chapter continuity: locked_fact, open_thread, relationship_change, chapter_summary memories auto-saved on chapter approval; chapter generation pulls full memory context; continuity check flags locked_fact contradictions as CRITICAL
- Reader Preview at `/story-studio/[storyId]/reader`: approved chapters in TOC, word count, listening time at 130 WPM, prev/next navigation, cliffhanger display
- "Draft Chapter N+1 →" button on chapter page navigates to next chapter with auto-generate trigger

**Writing model routing — done (2026-06-17):**
- 7 per-function env vars added to `src/lib/story-studio/engine.ts`: `STORY_MODEL_PREMISE`, `STORY_MODEL_BIBLE`, `STORY_MODEL_OUTLINE`, `STORY_MODEL_CHAPTER`, `STORY_MODEL_REWRITE`, `STORY_MODEL_QC`, `STORY_MODEL_MEMORY`
- Defaults preserve existing behavior (BALANCED_MODEL for generation, CHEAP_MODEL for QC/memory)
- `STORY_MODEL_CHAPTER` and `STORY_MODEL_REWRITE` can be pointed at a stronger creative model (e.g. `google/gemini-2.5-pro`, `anthropic/claude-opus-4`) without touching other steps

**Phase D — Episode Packaging — done (2026-06-17):**
- `story_episodes` table added (migration `drizzle/0042_story_episodes.sql`)
- `createStoryEpisodePackageAction`, `getStoryEpisodesAction`, `approveStoryEpisodeAction`, `lockStoryEpisodeAction`, `markEpisodeReadyForTTSAction` in `src/actions/story-studio.ts`
- Episode UI at `/story-studio/[storyId]/episodes` with approved-chapter selector, word count + duration preview, episode list, approve/lock/audio-generation-readiness flow
- Nav links: story dashboard, outline page, reader page all link to "Tập audio"
- Safety: unapproved chapter rejection, locked episode protection, duplicate detection, audio-generation readiness only after approved+locked
- Smoke test passed: 1442-word chapter packaged → 12 min episode → approve → lock → ready_for_tts → duplicate blocked

**Phase E1 — Story Episode TTS Adapter — done (2026-06-17):**
- `story_audio_assets` table + migration `drizzle/0043_story_audio_assets.sql`
- `runStoryEpisodeTTS(episodeId, options?)` in `src/lib/pipeline/story-tts.ts`
- `FICTION_STORY_PROFILE` (commaPause=120ms, sentencePause=280ms, paragraphPause=480ms) in `src/lib/pipeline/tts.ts`
- Provider routing: `AUDIO_STORY_TTS_PROVIDER ?? LONGFORM_TTS_PROVIDER ?? TTS_PROVIDER ?? "aimax"`
- Dry-run mode: `AUDIO_STORY_TTS_DRY_RUN=true` — creates fake asset without calling API
- Cache namespace: `media/story-audio-cache/` (isolated from short TTS)
- loudnorm without silenceremove to preserve AiMax natural prosody
- Episode UI: "Tạo audio" button, audio status badge, retry — `src/components/story-studio/episodes-client.tsx`
- Actions: `generateStoryEpisodeAudioAction`, `retryStoryEpisodeAudioAction`, `getStoryEpisodeAudioAssetsAction`
- Smoke test: dry-run asset insert verified in Docker Postgres

**Phase E2 — Real TTS Smoke Test + Audio Preview — done (2026-06-17):**
- Stream route `GET /api/story-audio-assets/[assetId]/stream` in `src/app/api/story-audio-assets/[assetId]/stream/route.ts`
  - DB lookup by UUID (no file path in URL)
  - Status must be `ready`; dry-run assets return 404
  - Path validated against `media/story-audio/` and `media/story-audio-cache/` only
  - Returns 404 if file missing on disk, 403 for unsafe path
  - Full byte-range (206) support for browser `<audio>` seek/scrub
  - Added to `PUBLIC_PATHS` in `src/proxy.ts` — `<audio>` elements can't send session cookies
- Browser audio player added to Episodes UI for non-dry-run ready assets
  - `<audio controls src="/api/story-audio-assets/{assetId}/stream" preload="none" />`
- Smoke test script `scripts/test-story-episode-tts.ts` (`pnpm test:story-episode-tts`)
  - Accepts `--episode-id`, `--dry-run`, `--force`
  - Prints provider, model, voice label, audio path, duration, status, cache key
  - Exits 0 on success, 1 on failure; graceful error if API key missing
- **Real TTS smoke test result**: Tập 1 (1442 words / 6370 chars) via AiMax
  - Provider: `aimax`, model: `speech-2.8-hd`, voice: `Ngọc Huyền 48k`
  - Output: 37.5 MB WAV + SRT, in 100s
  - Cache key: `3bcd698a…` — repeat run will skip synthesis
  - Stream route verified: 200 WAV, 206 range, 404 for dry-run asset
- Idempotency verified: second run returns existing ready asset in <5ms

**Phase E3 — Audio Quality Review + Minimal Fixes — done (2026-06-17):**

Audio reviewed: Tập 1, AiMax `speech-2.8-hd`, Ngọc Huyền 48k, 400s (6:40), 36.7 MB WAV, 129 SRT entries.

*Bugs found and fixed:*
- **SRT double-extension path** (`ep1.wav.raw.srt` → corrected to `ep1.srt`): `rawSynthPath` naming fixed in `story-tts.ts` to use `ep1-raw.wav`; SRT is now renamed after loudnorm. Existing DB record corrected.
- **`voice_label` = raw voice ID**: Fixed in `story-tts.ts` — now uses `getAiMaxVoiceDisplayLabel()` as fallback when `voice.name === voice.id`. DB record corrected to "Ngọc Huyền 48k".
- **`writeCostEvent` fails silently**: Root cause — Drizzle `onConflictDoUpdate` cannot target Postgres partial unique indexes. Fixed in `src/lib/cost/write-cost-event.ts` using select-then-upsert pattern. Pre-existing `uniq_cost_events_source` partial index is sufficient. Added `drizzle/0044_cost_events_source_unique.sql` (no-op, for record).
- **`duration_sec` not stored** (low): AiMax provider returns null durationSec. Non-blocking. Available via ffprobe post-synthesis if needed.

*Tools added:*
- `scripts/review-story-audio-asset.ts` (`pnpm review:story-audio --asset-id <uuid>`) — inspects asset metadata, probes audio via ffprobe, validates SRT, estimates MB/min, prints production risk assessment.

*Audio quality verdict:*
- Codec: PCM 16-bit, 48kHz, mono — correct for narration
- Bitrate: 768 kbps (WAV uncompressed)
- Duration: 6m 40s for 1442 words — reasonable at speed 1.05
- SRT: 129 entries, 0→6:39, max gap 0.5s — valid
- No chunk seams (single-job synthesis), no loudness issues noted
- WAV file is 36.7 MB → ~5.5 MB/min. Full 30-ep story ≈ 5 GB WAV

*Known risks (non-blocking):*
| Risk | Severity | Action |
|------|----------|--------|
| WAV too large for long-term storage | Medium | Re-encode to MP3 192kbps at publish time (Phase F) |
| No MP3 preview copy | Low | Phase F will handle re-encode before YouTube upload |
| `duration_sec` null in DB | Low | Add ffprobe post-step in Phase F if needed for UI |
| `enableSrt` depends on admin setting | Low | Keep `enableSrt=true` in AiMax admin for audio story |
| Voice cache may show raw IDs as name | Low | Run `tts:sync-voices` to refresh enriched labels |

**Tee Audio readiness audit (2026-06-17):**
- Tee Audio is connected in `platform_accounts` and `social_channels`.
- Detected account:
  - display name: `Tee Audio`
  - handle: `@teeaudio`
  - YouTube channel ID: `UCtmtL89-IfuhcGBWwcB48Ng`
- Current risk:
  - Tee Audio `social_channels` rows are connected, but they currently carry `channel_key = phat_phap`.
  - Audio Story does **not** have an explicit publish/upload channel binding in story tables yet.
  - Current manual upload package generation is safe because it does not publish, but any future automation must not infer the target from phat_phap/tang_sau defaults.
- Minimal binding direction:
  - Bind Audio Story explicitly via `audio_story.youtube_channel_id` in `app_config` with env fallback `AUDIO_STORY_YOUTUBE_CHANNEL_ID`.
  - Resolve the channel by YouTube channel ID, not by `channel_key`.
  - Show target channel in Story Studio before video render/manual upload.
  - Include `channel_name`, `handle`, and `platform_channel_id` in upload package metadata.

**Story TTS runtime audit (2026-06-17):**
- Latest real story audio asset used:
  - provider: `aimax`
  - model: `speech-2.8-hd`
  - voice label: `Ngọc Huyền 48k`
  - voice ID: `hn_female_ngochuyen_full_48k-fhg`
  - sample rate: `48000`
  - speed: `1.050`
  - pitch: `2.00`
  - volume: `1.000`
  - generated at: `2026-06-17T10:40:04.414Z`
  - cache key prefix: `3bcd698acf76…`
- Source of truth:
  - story-specific speed/pitch currently come from the Audio Story route fallback in `src/lib/aimax-settings.ts`, not from generic `aimax.speed` / `aimax.pitch` DB settings.
  - generic AiMax DB settings still provide model/language/normalize/enable_srt/volume/use_chunking defaults.
- F3.6 update:
  - Audio Story now has its own settings surface at `/story-studio/settings/audio`.
  - Audio Story TTS defaults are stored under `audio_story.*` app_config keys.
  - Recommended default for the current Audio Story pass is `speed = 1.08`, `pitch = 2`, `volume = 1.00`.
  - The earlier `speed = 1.05`, `pitch = 2.00` asset remains a historical test output, not the required production default.
- UI gap that was fixed:
  - Story Studio now exposes provider/model/voice/speed/pitch/volume/sample rate/generated time/cache hash for each audio asset.
- Known limitation:
  - There is still no dedicated Audio Story settings screen for provider/voice/music overrides yet. Plan that before large-scale production runs.

**Background music audit (2026-06-17):**
- Audio Story video render currently does **not** mix background music.
- There is no story-specific background music settings table/path yet.
- No license status or `user_confirmed` flag is stored for story background music.
- `src/lib/pipeline/story-video.ts` currently renders: static cover image + narration audio only.
- Minimal future phase for music mixing:
  - add story audio/video settings storage for track path, `license_status`, `user_confirmed`
  - support narration+music mix with defaults: `music_volume_db = -30`, `fade_in_sec = 2`, `fade_out_sec = 3`, `loop = true`
  - keep narration dominant; no automatic download from YouTube

**Production-length gate audit (2026-06-17):**
- The current one-chapter output is only a technical smoke test and should not be treated as a real Tee Audio upload.
- Tee Audio production target should default to `45–60 minutes` minimum unless the operator intentionally chooses a short pilot.
- Packaging target:
  - usually `4–8 chapters`, or
  - enough approved+locked chapters to reach the duration target
- Story Studio should show total estimated duration before TTS/render/upload and warn when the package is still smoke-test length.
- F3.7 builder direction:
  - expose `audio_story.target_min_duration_min`, `audio_story.target_max_duration_min`, and `audio_story.allow_short_pilot`
  - block `ready_for_tts` for under-target episodes unless short pilot is explicitly enabled
  - keep re-run audio explicit so operators can regenerate with new speed/pitch/volume defaults without overwriting history

**F3.7 — 45–60 Minute Episode Builder (implemented baseline):**
- Add Audio Story settings surface for production duration target and short-pilot override.
- Show current default TTS settings before `Tạo audio` and keep asset-level settings history visible.
- Provide chapter-range suggestions that land near the Tee Audio production target.
- Make the one-chapter artifact clearly historical smoke-test output, not the model for production packaging.

**F3.8 — Batch Chapter Generation Toward 45–60 Minute Tee Audio Episode:**
- Focus on generating enough human-reviewed chapter inventory to reach one real production-length Tee Audio episode.
- No TTS, no render, and no upload/publish should happen as part of this phase.
- Keep chapter generation operator-controlled:

**Audio compatibility guard (2026-06-18):**
- Added a no-schema compatibility guard before any production episode range mutation.
- `story_audio_assets.episode_id` alone is not sufficient for final render readiness.
- A production audio asset is considered current/renderable only when it still matches the current episode script/range/settings closely enough, primarily via the computed story TTS cache key.
- Old audio attempts remain visible and playable as history, but they must not be selected as the current production audio after the episode script/range changes.
- If an episode range changes and only incompatible historical audio remains, Story Studio should require a new TTS run before render/upload production.

**Production Episode 1 range update (2026-06-18):**
- Production Episode 1 was safely updated from `Ch.1–5` to `Ch.1–8` on the existing production episode row.
- The old `Ch.1–5` production audio remains preserved as a historical partial attempt and is no longer considered current for the updated episode range.
- The no-schema compatibility guard now forces a new matching TTS run before any production render/upload can proceed for the updated `Ch.1–8` range.
- TTS/render/upload remain future phases after metadata reapproval and a new compatible audio pass.
  - suggest the next 3-5 outlined chapters
  - generate one chapter at a time
  - preserve QC, approve, and lock gates before chapters count toward production packaging
- Story Studio should show:
  - approved/locked listening minutes currently available
  - missing minutes to the 45-minute minimum
  - estimated additional chapters needed
  - next chapter number to generate
  - production-readiness warning when the story is still under target

**F3.9 — Guided Chapter Production Sprint:**
- Keep the operator in a chapter-by-chapter sprint until enough approved + locked minutes exist for a real Tee Audio Episode 1.
- Still human-in-the-loop:
  - no bulk blind generation
  - no QC/approve/lock bypass
  - no TTS/render/upload until enough locked content exists
- Story Studio sprint panel should show:
  - target range `45–60 minutes`
  - current approved + locked minutes
  - missing minutes to `45`
  - estimated chapters still needed
  - next chapter number
  - next 3-5 outline chapters
  - next required action (`Generate`, `Run QC`, `Review/Approve`, `Lock`, or `Open chapter`)
- Sprint stop condition:
  - once approved + locked minutes reach the target minimum, show `Ready to assemble production Episode 1`
  - link to `/story-studio/[storyId]/episodes`
  - do not auto-create an episode
- Next recommended phase after F3.9:
  - production Episode 1 assembly only when the target duration is actually met

**Production episode numbering rule (2026-06-18):**
- Smoke-test and short-pilot packages must remain visible for history/debugging, but they do **not** consume production episode numbering.
- Audio Story packaging now separates:
  - internal historical `episode_number` for stable asset/package paths
  - public `production_episode_number` for real Tee Audio releases
- The first production-length package should display as `Tập 1` even if an older one-chapter smoke-test package already exists.
- Production numbering is based on `episode_kind = production` only.
- Under-target packages should default to `smoke_test` unless the operator explicitly enables short pilot behavior.

**F4.0 — Tee Audio SEO Metadata for Production Episode 1:**
- Generate a separate production metadata record for Tee Audio episodes before final manual upload package creation.
- Metadata approval is required before the final production manual upload package should be treated as ready to publish.
- Production metadata should include:
  - title candidates
  - selected YouTube title
  - longform description
  - tags + hashtags
  - pinned comment
  - playlist title/position
  - author + genre text
  - explicit Tee Audio channel identity
- Smoke-test packages keep their historical metadata and do not affect production metadata decisions.

**F4.1 — Production Episode 1 pre-TTS readiness + metadata polish:**
- Before spending TTS/render cost, production episodes should pass a pre-TTS readiness audit:
  - all included chapters approved + locked
  - duration within the production target window or explicitly accepted
  - target Tee Audio channel bound and visible
  - production metadata present and approved
  - no confusion with historical smoke-test packages
- Production metadata should be reviewed for factual support from the included chapters.
- Avoid unsupported clickbait:
  - do not overuse `nghìn tỷ`, `thẻ đen`, `hệ thống`, or similar power-fantasy hooks unless they are central to the included chapter range
  - favor betrayal, revenge, family conflict, thiên kim thật/giả, and emotional tension when that better matches the episode
- TTS should only run after the production episode passes this readiness gate.

**Audio Story TTS settings drift audit (2026-06-18):**
- Audio Story TTS settings are user-controlled and must be respected exactly once saved.
- Current intended Audio Story config:
  - voice label: `Ngọc Huyền 24k`
  - voice id: `hn_female_ngochuyen_full_24k-st`
  - speed: `1.1`
  - pitch: `2.0`
  - volume: `1.00`
  - model: `speech-2.8-hd`
  - provider: `aimax`
- The pipeline must not silently normalize or rewrite valid saved speed/pitch/volume values.
- Drift root cause found:
  - `ensureAudioStorySettingsSeeded()` was rewriting valid saved `1.0 / 0 / 1.0` values as if they were legacy placeholders
  - Audio Story defaults still pointed at removed `Ngọc Huyền 48k` / `hn_female_ngochuyen_full_48k-fhg`
  - some UI/runtime paths still assumed `48000` as a default display/sample-rate hint even when the selected voice identity was `24k`
- Drift did **not** come from:
  - AiMax request payload mutation
  - cache-key reuse across different tuning
  - ffmpeg merge/concat changing speed/pitch
- Note:
  - final narration WAV is still normalized to `48k` mono PCM as an output format choice, but that is separate from the user-selected voice identity and must not be treated as a TTS setting drift.

**F4.2 — Production Episode 1 manual TTS run + post-synthesis verification (2026-06-18):**
- Real TTS run completed for Production Episode 1:
  - story id: `4e6fb304-644b-4a01-80d3-3032996220ae`
  - episode id: `7efba094-4d62-490a-adba-d9c72652a3d1`
  - production episode number: `1`
  - asset id: `7ac9552e-321e-4511-81d7-c50dd8859fca`
- Settings used for the successful run:
  - provider: `aimax`
  - model: `speech-2.8-hd`
  - voice label: `Ngọc Huyền 24k`
  - voice id: `hn_female_ngochuyen_full_24k-st`
  - speed: `1.1`
  - pitch: `2.0`
  - volume: `1.00`
  - enable SRT: `true`
  - normalize: `true`
  - use chunking: `false`
- Verification results:
  - pre-run trace matched saved settings, resolved settings, provider payload, and persisted asset metadata
  - generated audio file: `media/story-audio/4e6fb304-644b-4a01-80d3-3032996220ae-ep2.wav`
  - generated subtitle file: `media/story-audio/4e6fb304-644b-4a01-80d3-3032996220ae-ep2.srt`
  - final narration file is `48k` mono PCM WAV
  - measured final audio duration is about `1562.679s` (`26.0 min`), so the earlier episode-level estimate of `~50 min` was materially too high
  - subtitle QC passed basic checks: starts at `0`, no empty cues, no reversed timestamps, no large unexplained gaps
- Follow-up implication:
  - do not assume chapter word-count estimates are sufficient for the `45–60 min` Tee Audio gate
  - next production-length gating should use measured narration duration or a recalibrated estimate before render/upload
- Blocking bug found and fixed during the run:
  - `runStoryEpisodeTTS()` referenced `textHash` in the usage payload without defining it in the real synthesis path
  - fix was minimal: compute `textHash` from the normalized episode TTS text before provider synthesis
- Still out of scope for this phase:
  - no video render
  - no manual upload
  - no YouTube API publish

**F4.3 — Recalibrate production-length gate using measured TTS duration (2026-06-18):**
- First production TTS run proved the original word-based planning estimate was materially too optimistic:
  - chapters `1–5`
  - words: `6,421`
  - old planning estimate: `~50 min`
  - measured narration duration: `1562.679s` (`~26.0 min`)
- Production readiness must now prefer measured TTS duration over estimated word-based duration whenever a ready non-dry-run audio asset exists.
- The production gate for render/upload must not trust the old `130 WPM` assumption once measured Audio Story narration data exists for the current voice/settings profile.
- Observed calibration guidance for current Audio Story voice/settings:
  - provider/model/voice: `aimax` / `speech-2.8-hd` / `Ngọc Huyền 24k`
  - speed: `1.1`
  - pitch: `2.0`
  - volume: `1.00`
  - observed words per minute: `~246.5`
  - observed seconds per word: `~0.243`
- Planning impact:
  - use measured duration for existing production episodes
  - use calibrated estimation for sprint/reader planning when no measured asset exists yet
  - do not render/upload under-target production episodes unless the operator explicitly marks them as short pilot
- Asset metadata:
  - `story_audio_assets.duration_sec` should be backfilled from the generated WAV when provider duration is absent
  - future Story TTS runs should auto-backfill duration from the output file instead of leaving it null
- Operational implication for current story:
  - Production Episode 1 remains a valid audio test / partial production asset
  - it is **not** a valid `45–60 min` Tee Audio production render/upload candidate yet
  - continue chapter sprint, likely through chapters `6–9` or until measured/calibrated duration reaches target

**F4.4 — Continue guided sprint using measured-duration calibration (2026-06-18):**
- Guided sprint advanced chapter-by-chapter with QC/approve/lock preserved:
  - chapter `6` generated, QC reviewed, approved, locked
  - chapter `7` generated, QC passed, approved, locked
  - chapter `8` generated, QC passed with minor notes, approved, locked
  - chapter `9` was not needed because calibrated duration target was reached after chapter `8`
- Current calibrated production planning state:
  - chapters `1–8` approved + locked
  - total words: `11,536`
  - calibrated duration: `~47 min`
  - production target `45 min` is now reached in planning
- Production Episode 1 range planning:
  - proposed final contiguous range is `Ch.1–8`
  - existing `Ch.1–5` production audio asset remains a valid partial / under-target production test
  - do **not** treat the `Ch.1–5` asset as final render input for production Episode 1
  - do **not** auto-mutate the stored production episode range while the linked `Ch.1–5` audio asset is still the active measured asset and no superseded-audio model exists yet
- Next gate:
  - production render/upload remains blocked until a new TTS run exists for the final selected production range (expected `Ch.1–8` unless later chapter packaging changes it)

**F4.8 — Narration Script Sanitizer + Spoken Script Preview (implemented narrow pass):**
- Status: implemented as a narrow Audio Story-only pass.
- This phase did **not** run TTS.
- This phase did **not** render video.
- This phase did **not** create an upload package, upload, publish, or change public/private visibility logic.
- The sanitized spoken script is now the source of truth before TTS for the Audio Story path.
- `spokenScriptHash` / cache identity is now derived from the final sanitized `spokenScript`, not the raw chapter/package text.
- Story Studio now shows a spoken-script preview before audio generation so the operator can inspect what will actually be spoken.
- Fixed Tee Audio intro now prepends the spoken script:
  - `Tee Audio chào các bạn, chúc các bạn nghe truyện vui vẻ.`
- Optional synopsis / văn án is inserted before the story body when available.
- A pause marker is inserted after the synopsis / văn án before the narration body continues.
- Chapter labels, headings, and chapter-title lines must not be spoken by TTS and are stripped from the spoken-script form.
- This pass is intentionally limited to narration-script sanitation and preview/readiness wiring only:
  - no TTS generation changes in production flow
  - no video-render phase work
  - no upload/package/public action work
- Historical note:
  - private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only
  - it must not be treated as a public release candidate and must not be publiced

**F4.9 — Premium Tee Audio Cover Generator + Motif Preview (preview-only implementation):**
- Status: implemented as a narrow cover-preview pass for Audio Story episodes.
- This phase is cover / thumbnail preview only:
  - no TTS execution
  - no video render
  - no upload package creation
  - no upload / publish / public action
- AI artwork generation is separated from local composition:
  - the image model generates artwork only
  - local compositor owns Vietnamese title, episode label, Tee Audio logo, border/accent motif, and title-safe layout
- Tee Audio logo path for the local compositor:
  - `logo/logo_tee_audio.png`
- Premium image route is configurable via Audio Story settings / app config:
  - `audio_story.cover_image_provider`
  - `audio_story.cover_image_model`
  - `audio_story.cover_style_preset`
- Production cover generation must not silently fall back to a cheap/fast text-only route.
- If premium cover config is missing or unsafe, Story Studio should show a clear blocked/warning preview state instead of pretending a production-ready cover exists.
- Story Studio now exposes a cover preview surface before render/upload with:
  - final cover preview
  - provider/model
  - prompt summary/details
  - status/warnings
  - logo placement note
  - stale detection based on cover input hash
- Default Tee Audio creative direction:
  - premium Chinese manhua/manhwa romance-drama
  - real heiress / wealthy revenge / elite-family mood
  - strong central silhouette
  - clean negative space reserved for local title overlay
  - no AI-rendered text or watermark
- Historical safety note:
  - private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only
  - do not upload, re-render, public, or otherwise treat it as a release candidate in this phase

**F4.10 — Background Music Review + Mixing Layer (review-only implementation):**
- Status: implemented as a narrow Audio Story review / mix-plan pass only.
- This phase does **not** run TTS.
- This phase does **not** perform a full video render.
- This phase does **not** create an upload package, upload, publish, or public anything.
- Story Studio now evaluates a future background-music plan before render/upload using explicit music review rules.
- Production music is blocked unless:
  - a track path is selected
  - license status is explicitly acceptable
  - the operator has user-confirmed the track for production use
- Acceptable production license statuses are:
  - `royalty_free`
  - `owned`
  - `subscription`
  - `public_domain`
- Unknown or unset license must not be treated as safe.
- Default mix targets:
  - volume target around `-30dB`
  - recommended range `-28dB` to `-34dB`
  - fade in `2s`
  - fade out `3s`
  - loop enabled by default
- Story Studio now shows:
  - track path / title
  - license status / notes
  - user confirmation state
  - volume / fades / loop
  - review status / warnings
  - mix plan hash
- A small ffmpeg mix-argument builder may be used for future render wiring, but this phase does not execute a full render.
- Historical safety note:
  - private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only
  - it must not be publiced or otherwise treated as a release candidate in this phase

**F4.11 — Pre-publish Creative Review Gate (creative-review only):**
- Status: implemented as a narrow Audio Story creative-review gate.
- This phase does **not** run TTS.
- This phase does **not** render video.
- This phase does **not** create an upload package.
- This phase does **not** upload, publish, public, or change YouTube visibility.
- Story Studio now aggregates the key creative readiness signals before any future render/upload/public decision:
  - F4.8 spoken-script status
  - current audio + SRT state
  - F4.9 cover preview/final-cover freshness
  - F4.10 background-music review/mix-plan state
  - metadata state
  - video/package/upload history as read-only context only
- The gate produces a conservative `PASS` / `WARNING` / `BLOCKED` result with section-level status for:
  - Spoken Script
  - Audio
  - Subtitles / SRT
  - Cover
  - Music
  - Metadata
  - Video
  - Package
  - Upload / Public
- Spoken script remains blocked if chapter labels/headings/titles still appear in the sanitized spoken text.
- Cover remains blocked if missing, blocked, or stale.
- Background music remains blocked when a track is configured but licensing/user confirmation is not production-safe.
- No-music configuration is treated conservatively as a warning unless `allowNoMusic` is explicitly enabled.
- Missing SRT is treated conservatively as a blocker for this longform Audio Story creative-review gate.
- Human review pass only records approval for the current computed review hash.
- If any creative inputs change after approval, the stored review becomes stale/pending again until a new manual review is recorded.
- `canPublic` must remain `false` in this phase.
- `canUpload` must remain `false` in this phase.
- Historical safety note:
  - private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only
  - it must not be re-rendered, uploaded, publiced, or treated as a release candidate from this gate

**F4.12 — Render-readiness wording cleanup (UI copy only):**
- Status: narrow wording/readiness cleanup only.
- No schema migration.
- No TTS.
- No render.
- No upload package.
- No upload / publish / public action.
- Goal: reduce operator confusion between:
  - audio-generation readiness before TTS exists
  - audio-ready state after a compatible asset exists
  - creative-review readiness
  - render-review readiness after current creative review pass
  - upload/public remaining blocked in this phase
- Internal DB/status values such as `ready_for_tts` remain unchanged in this pass; only user-facing wording is cleaned up.

**F4.13 — Creative review migration hygiene (narrow pass):**
- Status: migration-hygiene pass for the F4.11 creative-review schema addition only.
- No TTS.
- No render.
- No upload package.
- No upload / publish / public action.
- No publish-logic change.
- Goal: make the `story_episodes` creative-review schema addition easier to audit and safer to commit without rewriting unrelated dirty Drizzle state.
- `src/lib/db/schema.ts` and `drizzle/0050_story_episode_creative_review.sql` must stay aligned for:
  - `creative_review_status`
  - `creative_review_notes`
  - `creative_reviewed_at`
  - `creative_review_hash`
  - `creative_reviewer_label`
- Added a narrow verification script for this migration pair.
- Important repo-state note:
  - the current Drizzle journal/meta state in this repo snapshot is already behind many later migrations outside this narrow Audio Story slice
  - therefore this phase does **not** attempt a broad journal/snapshot regeneration
  - instead it records the mismatch clearly and keeps the F4.11 migration isolated/auditable

**F4.14 — Controlled local render preview (local-only):**
- Status: narrow local-preview render pass only.
- No TTS.
- No upload package.
- No upload / publish / public action.
- Local preview output is file-backed only, intended for operator inspection before any future packaging/upload phase.
- Requires:
  - creative review status `passed` for the current review hash
  - creative-review gate `canRender = true`
  - current ready audio asset
  - current final cover that is not stale
  - metadata title present
  - background music either `READY` or `allowNoMusic = true`
- Preview becomes stale when render inputs change, including review hash, audio, cover, music, or metadata title.
- Private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only and must not be publiced from this phase.

**F4.15 — Local render smoke test with dummy assets (offline-only):**
- Status: dummy-asset smoke verification only.
- No TTS.
- No Fal.ai or paid image API.
- No upload package.
- No upload / publish / public action.
- Goal: prove the FFmpeg render path, local file outputs, and preview metadata plumbing using only synthetic local assets.
- The smoke test generates:
  - a tiny local static cover image
  - a short synthetic narration WAV
  - an optional short synthetic music WAV
- The smoke path exercises:
  - allow-no-music render when `allowNoMusic = true`
  - optional music-ready render with a synthetic local track when explicitly enabled for debugging
- Smoke outputs are cleaned up by default, with an opt-in keep flag for manual inspection:
  - `KEEP_AUDIO_STORY_RENDER_SMOKE=1`
  - optional music branch flag: `AUDIO_STORY_RENDER_SMOKE_WITH_MUSIC=1`

**F4.16 — ffprobe duration metadata hardening (local-only):**
- Status: narrow ffprobe fallback cleanup only.
- No TTS.
- No Fal.ai or paid image API.
- No upload package.
- No upload / publish / public action.
- Goal: make local preview duration probing more robust without changing render gating, creative review flow, or publish logic.
- ffprobe resolution order for local preview metadata:
  - explicit `FFPROBE_PATH` if provided
  - `ffprobe-static` package path if installed
  - sibling binary next to `@ffmpeg-installer/ffmpeg` when present
  - common local binary paths
  - system `ffprobe` on PATH
- ffprobe failure remains non-fatal:
  - MP4 preview render still succeeds
  - preview metadata stores `durationSec = null`
- preview metadata also stores a warning such as `ffprobe unavailable; durationSec could not be determined.`
- This phase hardens local preview metadata only. It does not change render hash, upload readiness, packaging, YouTube visibility, or any publish action.

**F4.17 — Real episode local preview render (local-only):**
- Status: controlled real-episode local preview render path only.
- No TTS.
- No Fal.ai or paid image API.
- No cover regeneration in this phase.
- No upload package.
- No upload / publish / public action.
- Requires an explicit episode id from the operator:
  - `AUDIO_STORY_EPISODE_ID=<episodeId> tsx --tsconfig tsconfig.json scripts/render-audio-story-real-preview.ts`
- The real-preview script must not auto-render multiple episodes.
- It reuses the existing Story Studio local-preview gate and will render only when all current requirements pass:
  - creative review status `passed` for the current review hash
  - creative-review gate `canRender = true`
  - current compatible audio asset exists on disk
  - final cover exists and is not stale
  - background music is `READY` or `allowNoMusic = true`
  - metadata title exists
- If no eligible episode exists, the script reports blockers clearly instead of forcing a render.
- Output remains local file-backed only:
  - `media/story-renders/<storyId>/<episodeId>-preview.mp4`
  - `media/story-renders/<storyId>/<episodeId>-preview.json`
- Private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only and must not be publiced from this phase.

**F4.18 — Local DB creative review schema alignment:**
- Status: local DB schema alignment only.
- No TTS.
- No Fal.ai or paid image API.
- No real render except optional read-only eligibility recheck after schema alignment.
- No upload package.
- No upload / publish / public action.
- Goal: make the local `story_episodes` table match the existing F4.11 creative-review gate fields so local preview gating can load normally.
- Intended schema source remains `drizzle/0050_story_episode_creative_review.sql`.
- Because Drizzle journal/meta is still globally stale in this repo snapshot, this phase does **not** attempt broad journal cleanup or a destructive reset.
- Safe local path:
  - verify the five required `story_episodes` columns
  - if missing locally, apply only those columns via an idempotent local helper
  - then rerun creative-review DB verification and real-preview eligibility reporting
- Required columns:
  - `creative_review_status`
  - `creative_review_notes`
  - `creative_reviewed_at`
  - `creative_review_hash`
  - `creative_reviewer_label`
- Private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only and must not be publiced from this phase.

**F4.19 — Real episode asset eligibility fix (no real render):**
- Status: real-episode asset preparation/verification only.
- No TTS.
- No real video render in this phase.
- No upload package.
- No upload / publish / public action.
- Goal: prepare or verify the specific episode assets needed for render eligibility, especially cover and music readiness, without forcing creative review approval.
- Operator entry point:
  - `AUDIO_STORY_EPISODE_ID=<episodeId> tsx --tsconfig tsconfig.json scripts/prepare-audio-story-real-preview-assets.ts`
- Cover rules:
  - report `READY` when a current final cover already exists
  - premium Fal.ai cover generation must remain behind an explicit env flag:
    - `AUDIO_STORY_ALLOW_PAID_COVER_GENERATION=1`
  - do not call paid image generation when that flag is absent
  - local compositor remains responsible for the Vietnamese title/logo/layout using `logo/logo_tee_audio.png`
- Music rules:
  - report selected track, license status, user confirmation, volume/fade/loop, and mix-plan hash
  - do not silently switch production readiness to `allowNoMusic=true`
  - `allowNoMusic` remains a debug/operator-explicit path only
- Creative review rules:
  - do not auto-pass creative review by default
  - the preferred state is “ready for human review” once asset blockers are resolved
- Private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only and must not be publiced from this phase.

**SEO metadata direction for Tee Audio (next metadata phase):**
- Preserve fixed brand info in generated long-video descriptions:
  - YouTube: `/ @teeaudio`
  - MB Bank: `3466778899`
  - TikTok: `tiktok.com/@tee.audio`
- Required outputs:
  - title
  - description
  - tags
  - hashtags
  - pinned comment
  - playlist text
- Author naming:
  - use a Chinese-romance style pen name when the story has no explicit author
  - default recommendation: `Mặc Vũ Thanh Hoan`

**What is NOT done:**
- YouTube/publishing integration (Phase F)
- MP3 re-encode for delivery
- Story analytics (Phase G)

---

## 4. Target Story Structure

### Units

| Unit | Definition |
|------|-----------|
| **Story** | The full serialized work. One story has a title, genre, premise, bible, and 30–40 chapters. |
| **Arc** | A narrative arc spanning multiple chapters (optional grouping, e.g. "Origin Arc", "Revenge Arc"). |
| **Chapter** | The atomic writing unit. Approximately 2,000–2,500 Vietnamese words. Human-approved before production. |
| **Episode** | One audio recording unit. Typically 1–2 chapters packaged together. Approximately 15–25 minutes of audio. |
| **Full compilation** | One long video combining all episodes after the series is complete. Approximately 8–12 hours. |
| **Short teaser** | A 30–60 second clip derived from a hook moment in an episode. Routed through the existing short pipeline with story metadata. |

### Scale estimate

| Metric | Estimate |
|--------|---------|
| Total audio duration (full story) | ~10 hours |
| Vietnamese word count | ~75,000–85,000 words |
| Chapters | 30–40 |
| Words per chapter | ~2,000–2,500 |
| Episodes | 20–25 |
| Chapters per episode | 1–2 |
| Audio per production episode | 45–60 minutes target for Tee Audio |
| Short pilot / smoke test | 6–25 minutes, only with explicit operator intent |
| Full compilation | 8–12 hours |

---

## 5. Core Data Model Direction

### Keep (existing, do not merge with content_generations)

```
story_taxonomy        genre/subgenre tree, trope scores, hook style hints
stories               title, premise, bible, outline, status, genre_id, word_count
story_characters      character cards: name, role, backstory, abilities, arc
story_chapters        chapter number, outline_point, draft text, status, word_count
story_memories        approved summaries, locked facts, open threads, relationship states
story_quality_checks  continuity snapshot per chapter: issues, warnings, locked facts used
```

### Add in future phases

```
story_arcs            optional arc grouping (arc_title, chapter_start, chapter_end)
story_episodes        episode_number, chapter_start, chapter_end, episode_script, estimated_duration, status
story_audio_assets    chapter_audio_path, episode_audio_path, tts_provider, voice_profile, duration_sec
story_playlists       youtube_playlist_id, story_id, episode_order, published_at
story_analytics       story_id, episode_id, platform, views, avg_duration_sec, retention_pct, fetched_at
story_short_teasers   story_id, episode_id, chapter_number, content_generation_id (FK to existing short)
```

Do not add Audio Story columns to `content_generations`. Foreign key references from `story_short_teasers` to `content_generations` are allowed for teaser linking.

---

## 6. Genre Taxonomy

Priority tree for initial story production:

```
rebirth
  rebirth revenge
  rebirth wealth
  rebirth regret
  rebirth family rescue

system
  wealth system
  face-slap system
  villainess system
  love / affection system
  career system
  survival system

rebirth + system (combined — highest engagement expectation)
  rebirth system wealth
  rebirth system revenge
  rebirth system face-slap
  rebirth system trillionaire assets
  rebirth system evil family

transmigration / book
  transmigrated villainess
  cannon fodder escape
  female supporting character counterattack

CEO / rich family
  regretful CEO
  contract marriage
  hidden identity
  fake daughter / real daughter reveal

wealth / business
  real estate
  investment with future knowledge
  business empire
  asset reward system
```

This tree is seeded into `story_taxonomy` by the existing Story Studio MVP. Expand it by adding rows to `story_taxonomy`; do not hardcode new genres in application code.

---

## 7. Roadmap Phases

### Phase A — Story Studio Foundation

**Status: MVP done (2026-06-15).**

Covers: taxonomy, trope builder, premise, bible, outline, chapter draft, continuity check, approve, lock.

Do not expand Phase A unless a specific continuity gap or stability bug is found.

---

### Phase B — Multi-Chapter Continuity

**Status: done (2026-06-16).**

**Goal:** Chapter N can be generated with full awareness of what happened in chapters 1 through N−1.

**Context window provided to the LLM when drafting chapter N:**

| Context block | Source |
|--------------|--------|
| Story bible | `stories.bible` |
| Character bible | `story_characters` |
| System/world rules | `stories.system_rules` |
| Full chapter outline | `stories.outline` |
| Current chapter outline point | `stories.outline[N]` |
| Locked facts summary | `story_memories` where `type = 'locked_fact'` |
| Last 3 chapter summaries | `story_memories` where `type = 'chapter_summary'` |
| Open threads | `story_memories` where `type = 'open_thread'` and `resolved = false` |
| Relationship state | `story_memories` where `type = 'relationship_state'` |
| System/power state | `story_memories` where `type = 'system_state'` |
| Forbidden directions | `story_memories` where `type = 'forbidden'` |

**Memory structure additions (expand `story_memories.type`):**

```
chapter_summary       compressed summary of an approved chapter
locked_fact           canonical world/character fact; cannot be contradicted in later chapters
open_thread           a plot thread introduced but not yet resolved
resolved_thread       a thread marked resolved (with resolution note)
relationship_change   a character relationship shift that happened in a chapter
character_state       current power level, emotional state, location of a character
system_state          current system points, unlocked skills, available resources
timeline_note         date/time reference anchoring events in story timeline
forbidden             direction explicitly banned (by author or continuity checker)
```

**Continuity check additions:**

- Check chapter N draft against all `locked_fact` entries
- Flag contradictions as `CRITICAL`
- Flag open threads not advanced as `WARNING`
- Allow override with human approval note

**Acceptance:**
- Chapter 2 generated using chapter 1 memory
- Chapter 2 QC checks against locked chapter 1 facts
- Locked chapter 1 cannot be overwritten by chapter 2 generation
- Memory entries correctly created after chapter 1 approval

---

### Phase C — Reader Preview UI

**Status: done (2026-06-16).**

**Goal:** Human can read the full approved story in sequence before any audio production.

Route: `/story-studio/[storyId]/reader`

Features:
- Approved chapter list (table of contents)
- Chapter text display
- Previous / next chapter navigation
- Total word count (running and final)
- Estimated listening time (words ÷ 130 WPM for Vietnamese audio)
- Chapter status badge (draft / approved / locked)
- Text-only — no TTS, no audio player, no export

---

### Phase D — Episode Packaging

**Status: done (2026-06-17).**

**Goal:** Group approved chapters into publishable episodes.

New table: `story_episodes`

```
id              uuid
story_id        → stories
episode_number  integer
chapter_start   integer
chapter_end     integer
episode_title   text
episode_script  text (concatenation of chapter texts with episode-level framing)
word_count      integer
estimated_duration_sec  integer
status          draft | ready | published
created_at      timestamptz
published_at    timestamptz
```

UI: `/story-studio/[storyId]/episodes`
- List episodes in order
- Show chapter range, word count, estimated duration, status
- Button: generate episode script from approved chapters
- Button: mark as ready (for TTS production)

---

### Phase E — TTS / Audio Production

**Status: Phase E1 + E2 + E3 done (2026-06-17). Audio quality reviewed, bugs fixed, stream route live. Phase F (YouTube publishing) is safe to start.**

#### TTS Infrastructure Audit (2026-06-17)

**What already exists and is ready:**

| Component | File | Status |
|-----------|------|--------|
| AiMax provider | `src/services/tts/providers/AiMaxProvider.ts` | Ready |
| Provider registry | `src/lib/pipeline/tts-providers/registry.ts` | Ready (vieneu, aimax, openai, elevenlabs, macos-say) |
| TTS service resolver | `src/services/tts/TTSService.ts` | Ready |
| `audio_story` route key | `src/lib/aimax-settings.ts` | Ready — triggers when `contentProfileKey === "audio_story"` or `formatType.includes("audio_story")` |
| Ngọc Huyền 24k voice | `hn_female_ngochuyen_full_24k-st` | Current Audio Story intended voice; user-controlled speed/pitch must be respected exactly |
| Cache key | `buildShortCacheKey` in `src/lib/pipeline/tts.ts` | Correct: `[providerId, voiceId, speed, pitch, textHash]` — no cross-content collision risk |
| Text normalization | `normalizeTextForTTS()` | Handles story text — strips markdown, normalizes newlines, fixes `nh*,nh*` prosody bug (VieNeu-specific, harmless for AiMax) |
| Job tracking | `tts_jobs` table | Tracks `pipelineRoute`, `formatType`, `contentProfileKey`, `cacheIdentity` — ready for Audio Story data separation |
| Chunking | AiMax single-job by default | Story chapters ≈ 2.5K words ≈ 10K chars — well under 500K limit. No chunking needed. |
| Cost tracking | `writeTtsCostEvent()` | Ready |

**What is NOT built for Audio Story TTS:**

1. **No pipeline entry point**: `runTTS(contentId, "short")` reads `content_generations`; story chapters live in `story_chapters`. A new `runStoryChapterTTS(chapterId)` function is needed.
2. **No DB columns on `story_chapters`**: need `chapter_audio_path`, `tts_status`, `tts_provider`, `tts_voice_id`, `tts_duration_sec`, `tts_error_message`.
3. **No `story_audio_assets` table** (see Phase D).
4. **No episode concatenation**: joining chapter audio files into an episode is a post-processing step (ffmpeg concat).
5. **No pause profile for fiction**: the existing `BUDDHIST_CALM_PROFILE` (commaPause=220ms, sentencePause=560ms, paragraphPause=850ms) is tuned for Buddhist narration. Fiction pacing is faster — a `FICTION_STORY_PROFILE` with shorter pauses is needed.
6. **`useSilenceremove`**: defaults to `true` for non-phat_phap channels. Audio Story would be in that bucket. Needs verification on first real chapter audio.
7. **Cache path**: short TTS uses `media/audio-cache/`. Audio Story should use a separate `media/story-audio-cache/` directory to avoid path contamination.

**Recommended Audio Story TTS design:**

- Provider: AiMax (default, via `LONGFORM_TTS_PROVIDER=aimax`)
- Voice: `hn_female_ngochuyen_full_24k-st` (Ngọc Huyền 24k)
- Route: `audio_story` (auto-detected from context)
- Speed / pitch: user-controlled from `audio_story.*` settings, with no silent rewrite
- Text input: `normalizeTextForTTS(chapter.chapterText)` — existing function works
- Cache: per-chapter, keyed by `[provider, voice, speed, pitch, textHash]`
- No chunking needed for chapter-level audio
- Pause profile: new `FICTION_STORY_PROFILE` (shorter pauses than `BUDDHIST_CALM_PROFILE`)
- Output path: `media/story-audio/{storyId}-ch{chapterNumber}.wav`

**New table: `story_audio_assets`**

```
id                  uuid
story_id            → stories
episode_id          → story_episodes (nullable until Phase D)
chapter_id          → story_chapters
tts_provider        text (aimax | vieneu | ...)
voice_id            text
audio_path          text (media/story-audio/{storyId}-ch{n}.wav)
episode_audio_path  text (media/story-audio/{storyId}-ep{n}.wav — set after episode concat)
duration_sec        numeric
word_count          integer
status              pending | processing | done | error
error_message       text
created_at          timestamptz
updated_at          timestamptz
```

TTS design rules (unchanged from original):
- Provider is specified per production run, not hardcoded
- Voice profile is separate from provider
- Chapter-level audio is the atomic unit; episode audio is a concatenation
- Silence, music, intro/outro are post-processing steps, not part of TTS input
- Do NOT use `content_generations` or the existing `runTTS` entry point for story chapters

---

### Phase F — YouTube Audio Story Publishing

#### Phase F1 — Audio Episode Video Render MVP — done (2026-06-17)

**Goal:** Render one story episode audio asset into a YouTube-ready MP4 without publishing it.

**What was built:**

| Component | File |
|-----------|------|
| `story_video_assets` DB table | `drizzle/0045_story_video_assets.sql` |
| Schema + types | `src/lib/db/schema.ts` — `storyVideoAssets`, `StoryVideoAsset` |
| Cover image generator | `src/lib/story-studio/cover-generator.ts` — Sharp SVG→PNG 1920×1080 |
| Render helper | `src/lib/pipeline/story-video.ts` — `renderStoryEpisodeVideo(audioAssetId)` |
| Server actions | `src/actions/story-studio.ts` — `renderStoryEpisodeVideoAction`, `getStoryVideoAssetsAction` |
| Episode UI | `src/components/story-studio/episodes-client.tsx` — Render video button, status badge, file info |
| Episodes page | `src/app/story-studio/[storyId]/episodes/page.tsx` — loads `videoAssets` |
| Smoke test script | `scripts/test-story-episode-render.ts` (`pnpm test:story-episode-render`) |
| engine.ts hotfix | Removed `"use server"` from `src/lib/story-studio/engine.ts` (exported string broke Next.js) |

**Render settings:**

| Parameter | Value |
|-----------|-------|
| Resolution | 1920×1080 |
| FPS | 25 |
| Video codec | h264_videotoolbox (Apple Silicon) / libx264 (fallback) |
| Audio codec | AAC 192k (re-encoded from WAV) |
| Background | Static cover PNG (Sharp SVG: dark #0f172a, rose accent, title/episode text) |
| Subtitles | Sidecar SRT — copied alongside MP4 as `episode-N.srt` |
| Output path | `media/story-videos/{storyId}/episode-{N}.mp4` |
| Cover path | `media/story-covers/{storyId}-ep{N}-cover.png` |

**Subtitle mode rationale:** Sidecar SRT (no burn-in) for MVP. YouTube accepts separately uploaded SRT captions. Avoids libass/fontconfig font complexity and keeps the render pipe simple.

**Smoke test result (2026-06-17):**
- Input: Tập 1, AiMax `speech-2.8-hd`, Ngọc Huyền 48k, 36.7 MB WAV (400s)
- Render time: 56s on Apple Silicon (VideoToolbox H.264)
- Output: `episode-1.mp4` — 45 MB, 6m 40s, H.264 High / AAC 48kHz
- SRT sidecar: `episode-1.srt` — 129 entries ✓
- Video codec: `h264` (Profile: High), 1920×1080, yuv420p, 25fps
- Audio codec: `aac`, 48000 Hz, mono, 170 kbps
- Container: mp4 (movflags: faststart — YouTube compatible)
- No publish, no upload

**Known risks (non-blocking):**

| Risk | Severity | Action |
|------|----------|--------|
| Cover is generated PNG (no real story art) | Low | Add real cover art in Phase F2 |
| Sidecar SRT must be uploaded to YouTube separately | Low | Phase F2 manual upload package includes SRT upload step |
| 45 MB MP4 per 6:40 episode (≈ 6.7 MB/min) | Low | Acceptable for YouTube upload; storage < 5 GB for full 30-ep story |
| No audio normalization delta (WAV already loudnorm'd) | None | E3 loudnorm applies before render |

**What is NOT done (Phase F3+):**
- YouTube channel API upload + playlist assignment — Phase F3+
- Real story cover art — Phase F3+

---

#### Phase F2 — Manual Upload Package — done (2026-06-17)

**Goal:** Package one rendered episode into a self-contained folder for manual YouTube upload. No API calls, no publishing automation.

**What was built:**

| Component | File |
|-----------|------|
| `story_upload_packages` DB table | `drizzle/0046_story_upload_packages.sql` |
| Schema + types | `src/lib/db/schema.ts` — `storyUploadPackages`, `StoryUploadPackage` |
| Package helper | `src/lib/pipeline/story-upload-package.ts` — `createStoryManualUploadPackage(videoAssetId)` |
| Server actions | `src/actions/story-studio.ts` — `createStoryUploadPackageAction`, `getStoryUploadPackagesAction` |
| Episode UI | `src/components/story-studio/episodes-client.tsx` — "Tạo gói upload" button, status, 6-item checklist |
| Episodes page | `src/app/story-studio/[storyId]/episodes/page.tsx` — loads `uploadPackages` |
| Smoke test script | `scripts/test-story-upload-package.ts` (`pnpm test:story-upload-package`) |

**Package directory:** `media/story-upload-packages/{storyId}/episode-{N}/`

**Package contents:**

| File | Description |
|------|-------------|
| `episode-N.mp4` | Video (copied from video asset) |
| `episode-N.srt` | Vietnamese captions (sidecar, if present) |
| `thumbnail.png` | Cover PNG (copied from cover-generator output) |
| `metadata.json` | Machine-readable YouTube upload data |
| `metadata.md` | Human-readable upload checklist with copy-paste fields |
| `checksums.sha256` | SHA256 of all files for integrity verification |

**YouTube title format:** `{story.title} - Tập {N}: {episode.title} | Truyện Audio` (max 100 chars)

**Smoke test result (2026-06-17):**
- Input: `6e68ceb3-1bfd-49e5-9fe4-7e7f15e1b9e6` — Tập 1, 45.0 MB MP4 (400s, ready)
- Package built in 0.1s
- Files: episode-1.mp4 (45.0 MB), episode-1.srt (13 KB), thumbnail.png (90 KB), metadata.json (4 KB), metadata.md (4 KB), checksums.sha256
- Title: `Thiên Kim Thật Trả Thù: Tổng Tài, Đừng Chạy! - Tập 1: ...`
- 23 tags, category_id 22 (Entertainment), subtitle_mode sidecar_srt
- SHA256 checksums for all 5 files ✓
- No upload_queue usage, no publish, no YouTube API call ✓

**What is NOT done (Phase F4+):**
- YouTube channel API upload + playlist assignment — Phase F4+
- Real story cover art — Phase F4+

---

#### Phase F3 — Manual Upload Validation Tracking — implemented; awaiting one real manual upload pass (2026-06-17)

**Goal:** Record the result of a real manual YouTube upload for each episode, without any YouTube API calls or publish automation.

**What was built:**

| Component | File |
|-----------|------|
| `story_manual_upload_validations` DB table | `drizzle/0047_story_manual_upload_validations.sql` |
| Schema + types | `src/lib/db/schema.ts` — `storyManualUploadValidations`, `StoryManualUploadValidation` |
| Server actions | `src/actions/story-studio.ts` — `createManualUploadValidationAction`, `updateManualUploadValidationAction`, `getManualUploadValidationsAction` |
| Episode UI | `src/components/story-studio/episodes-client.tsx` — `ValidationSection` component, "Upload OK" header badge |
| URL parsers | `episodes-client.tsx` — `parseYouTubeVideoId()`, `parseYouTubePlaylistId()` |
| Episodes page | `src/app/story-studio/[storyId]/episodes/page.tsx` — loads `uploadValidations` |
| Smoke test script | `scripts/test-story-upload-validation.ts` (`pnpm test:story-upload-validation`) |

**Validation fields:**

| Field | Purpose |
|-------|---------|
| `youtube_video_url` | Full URL pasted by user |
| `youtube_video_id` | Parsed from URL (watch?v=, youtu.be/, shorts/ warned) |
| `youtube_playlist_url` / `youtube_playlist_id` | Playlist URL + parsed list= param |
| `upload_status` | not_uploaded / uploaded_private / uploaded_unlisted / uploaded_public / failed / needs_fix |
| `visibility` | private / unlisted / public |
| `title_ok`, `thumbnail_ok`, `srt_ok`, `audio_ok`, `description_ok` | Checklist booleans |
| `copyright_status` | clean / no_claim / claimed / blocked |
| `restriction_status` | none / age_restricted / country_blocked / other |
| `validation_notes` | Free text notes |
| `uploaded_at`, `validated_at` | Timestamps set automatically on save |

**Pass condition:** pass only if all of the following are true:
- A real `youtube_video_url` exists
- `audio_ok = true`
- `srt_ok = true`
- `thumbnail_ok = true`
- `title_ok = true`
- `description_ok = true`
- `copyright_status` is `clean` or `no_claim`
- `restriction_status = none`
- No visibility or processing issue remains after YouTube finishes processing
- `upload_status` is `uploaded_private`, `uploaded_unlisted`, or `uploaded_public`

**Real manual upload procedure (one required validation before F4):**
1. Open the episode’s package directory under `media/story-upload-packages/<storyId>/episode-N/`.
2. Use `metadata.md` or `metadata.json` as the source of truth for title, description, tags, playlist text, and pinned comment.
3. Upload `episode-N.mp4` to YouTube Studio.
4. Upload `episode-N.srt` in YouTube Studio → Subtitles as Vietnamese captions.
5. Upload `thumbnail.png` as the custom thumbnail.
6. Paste the title, description, and tags from the package metadata.
7. Set visibility to `private` or `unlisted` first; do not start with public for the first real validation.
8. Wait for YouTube processing to finish before judging the result.
9. Play back the YouTube-hosted version, not just the local MP4.
10. Check audio playback, SRT presence/timing, thumbnail, title, description, and any copyright or restriction banners.
11. Confirm there is no remaining processing problem and the selected visibility is applied correctly.
12. Record the result in Story Studio under `/story-studio/[storyId]/episodes` using the manual upload validation form.

**Manual validation checklist to record in Story Studio:**
- `youtube_video_url`: paste the real watch URL
- `upload_status`: use `uploaded_private`, `uploaded_unlisted`, `uploaded_public`, `needs_fix`, or `failed`
- `visibility`: set the actual YouTube visibility
- `audio_ok`: only true after playback sounds correct on YouTube
- `srt_ok`: only true after the sidecar subtitle is uploaded and displays correctly
- `thumbnail_ok`: only true after the custom thumbnail appears correctly
- `title_ok`: only true after the uploaded title matches the package metadata
- `description_ok`: only true after the uploaded description matches the package metadata
- `copyright_status`: `clean` or `no_claim` required for pass
- `restriction_status`: must be `none` for pass
- `validation_notes`: record any processing delay, mismatch, warning, or retry detail

**UI behaviour:**
- "Ghi nhận upload YouTube" section appears inside each episode card when upload package is ready
- Section collapses to a summary badge/line after save; re-opens with "Sửa" button
- Header badge shows upload status; turns green "Upload OK" when pass condition met
- Shorts URL warning shown if user accidentally pastes a /shorts/ URL
- Playlist ID auto-parsed from URL

**Implementation smoke test result (2026-06-17):**
- Input: `f0483c67-9513-4d98-8a15-51c1f6eda3c8` (ready upload package, Tập 1)
- Validation created: id `264828f6-...`, status=uploaded_unlisted
- Video ID parsed: `TEST_FAKE_ID_F3` ✓
- All 5 checklist items true, copyright=clean, restriction=none ✓
- upload_queue rows created: 0 ✓
- YouTube API called: NO ✓
- content_generations used: NO ✓
- Real manual upload validated: NO — this used fake test data and does **not** unlock F4

**Known risks (non-blocking):**

| Risk | Severity | Action |
|------|----------|--------|
| User enters wrong YouTube URL | Low | URL is stored and video ID parsed; no validation against YouTube API |
| Multiple validations per episode if code path runs twice | Low | createManualUploadValidationAction guards: returns error if record exists; use updateManualUploadValidationAction |
| Checklist items self-reported | Low | No API verification — human operator must actually check |

**What is still required before F4:**
- One real manual YouTube upload using a generated package
- One passing `story_manual_upload_validations` record backed by a real watch URL

**What is NOT done (Phase F4+):**
- YouTube channel API upload + playlist assignment — Phase F4+
- Real story cover art — Phase F4+

---

**Status: future, after Phase E.**

Publishing rules for Audio Story:
- One YouTube playlist per story
- Episode videos: audio + static image (cover art or chapter illustration)
- Full-story compilation video after all episodes are published
- Pinned comment on each episode: links to next/previous episode and playlist
- Playlist ordering: episode 1 → episode N → full compilation

New table: `story_playlists`

```
id                  uuid
story_id            → stories
youtube_playlist_id text
channel_id          integer → social_channels
episode_count       integer
published_episodes  integer
full_compilation_published boolean
created_at          timestamptz
```

Do NOT use `upload_queue` for story episodes in its current form. Story episode publishing has different retry logic, different ordering constraints, and different metadata. Design a story-specific publish queue or extend `upload_queue` with a `source_type` discriminator before using it for Audio Story.

---

### Phase G — Audio Story Analytics

**Status: future, after Phase F.**

Analytics are isolated from phat_phap/tang_sau analytics. Do not add story analytics to existing analytics actions.

New table: `story_analytics`

```
id                  uuid
story_id            → stories
episode_id          → story_episodes (nullable for story-level)
platform            text
platform_video_id   text
views               integer
avg_view_duration_sec numeric
retention_pct       numeric
fetched_at          timestamptz
```

Metrics to track:
- Story-level: total views across all episodes
- Episode-level: views, average listen/view duration, retention percentage
- Drop-off by episode number (which episode loses the most listeners)
- Drop-off by chapter within an episode
- Playlist follow-through (how many playlist starters reach episode 5, 10, etc.)
- Genre/trope performance (rebirth vs system vs rebirth+system)
- Short teaser to episode conversion (teaser views → episode 1 views)
- Voice profile performance (by TTS voice/provider)

---

### Phase H — Short Teaser Bridge

**Status: future, after Phase D at earliest.**

Short teasers derived from Audio Story episodes may use the existing short/reel pipeline for production and publishing. This is the only allowed integration point between Audio Story and the existing phat_phap/tang_sau short pipeline.

New table: `story_short_teasers`

```
id                    uuid
story_id              → stories
episode_id            → story_episodes
chapter_number        integer
content_generation_id → content_generations (the short/reel item)
hook_text             text
cover_text            text
cliffhanger_line      text
genre_tags            jsonb (string[])
trope_tags            jsonb (string[])
created_at            timestamptz
```

Teaser rules:
- Teaser is a standalone short — it does not need the story to be fully produced
- Teaser script is written specifically for 30–60 seconds, not extracted from chapter text
- Teaser hook + cover must reference the story hook/genre, not phat_phap/tang_sau prompt style
- Teaser analytics go into `story_analytics` (not short video analytics) for conversion tracking

---

## 8. What NOT To Do Now

Phases A–D, E1, E2, E3, F1, F2, F3, F4.20–F4.25 done. Chapter 1 approved; Chapter 2 drafted ("Mặt Nạ Rạn Nứt", status=draft). Next: operator reviews Chapter 2, runs continuity check, approves before Chapter 3 unlocks.

- Episode audio concatenation (ffmpeg concat) — **deferred**; current design renders the full episode script as a single TTS job, so no per-chapter concat is needed yet
- YouTube playlist publishing (Phase F) — **not yet built**
- Full-story compilation video (Phase F) — **not yet built**
- Story Studio → short/reel export (Phase H) — **not yet built**
- Story analytics dashboard (Phase G) — **not yet built**
- AI feedback loop from analytics into story generation (Phase G) — **not yet built**
- Merging with Buddhist/tang_sau long video flows (hard boundary, never)
- Reusing `upload_queue` for story episode publishing without explicit design (Phase F note)
- Adding story-specific columns to `content_generations` (hard boundary, never)

---

## 9. Immediate Next Task

**Phase F3.6 — Tee Audio Binding + Production Readiness Audit**

Before any real Tee Audio upload or F4 automation, finish the operational preparation layers below.

### Ordered next phases

1. **Phase F3.6 — Tee Audio explicit channel binding + Audio Story settings surface**
   - Bind Audio Story to Tee Audio by `audio_story.youtube_channel_id` / `AUDIO_STORY_YOUTUBE_CHANNEL_ID`
   - Show target channel in Story Studio and upload package metadata
   - Add Audio Story settings UI for provider/model/voice/speed/pitch/volume/SRT/normalize/chunking/music defaults
   - Do not infer future publishing from `channel_key`
2. **Phase F3.7 — 45–60 minute episode builder**
   - Package `4–8 chapters` or enough approved+locked content to reach production duration
   - Keep one-chapter outputs marked as smoke test / short pilot only
3. **Phase F3.8 — Batch chapter generation readiness**
   - Generate enough approved+locked chapters to form a real Tee Audio episode
   - Do not bulk-generate until channel binding + settings visibility are in place
4. **Phase F4.0 — SEO + thumbnail readiness**
   - Tee Audio brand metadata, hashtags, pinned comment, playlist text, thumbnail direction
5. **Phase F4.1 — Background music mixing design**
   - Story-specific music settings, license/user confirmation, safe defaults
6. **Phase F4.2 — Real manual Tee Audio upload validation**
   - One real private/unlisted upload using the package
   - Record validation in Story Studio
7. **Phase F5 — YouTube API publishing automation**
   - Only after the gates below are satisfied

### Prerequisite gate

Do NOT start F4 until:
1. ✅ At least one episode has `story_manual_upload_validations.upload_status = 'uploaded_unlisted'` or `uploaded_public` with a real YouTube video URL (not fake test data)
2. ✅ All 5 checklist items true for that episode
3. ✅ No copyright claims or restrictions on the uploaded video
4. ✅ No visibility or YouTube processing issue remains on that uploaded video
5. ✅ YouTube OAuth channel connected in `social_channels` with upload scope

For Tee Audio specifically, do NOT treat a one-chapter 6–12 minute render as a production-ready upload unless the operator explicitly marks it as a short pilot.

### What to build (Phase F4 — YouTube API Upload)

1. `story_playlists` table (story → YouTube playlist ID, channel, episode count, published episodes).
2. `publishStoryEpisodeToYouTube(uploadPackageId, channelId)` — uploads MP4, sets title/description/tags from package metadata, assigns to playlist, pins comment.
3. `story_episodes.youtube_video_id` + `youtube_published_at` columns to track state.
4. Episode UI: "Publish to YouTube" button (only after ready upload package + passing validation), published status badge.
5. No upload_queue involvement — story episodes get their own publish path.

### Acceptance criteria (Phase F4)

- Episode MP4 uploaded to YouTube via API, playlist assigned, pinned comment posted
- `story_episodes.youtube_video_id` stored in DB
- SRT uploaded as Vietnamese captions via captions API
- `src/` TypeScript clean
- No phat_phap/tang_sau/healing code touched

---

## 10. Final Instruction For Future AI Agents

This file is the authoritative plan for Audio Story. Update it instead of creating new files.

Before adding any Audio Story feature:
1. Check which phase it belongs to.
2. Confirm the phases before it are done or explicitly skipped.
3. Do not add story logic to `content_generations`, `upload_queue`, `published_videos`, or any phat_phap/tang_sau action file.
4. Shared infrastructure (DB server, LLM client, storage, UI shell) is allowed.
5. Any feature that crosses the Audio Story / short-pipeline boundary must go through `story_short_teasers` only.

---

## 11. Ch.1–8 Real TTS Attempt Status

Date: 2026-06-18

- Production Episode 1 remains `episode_id = 7efba094-4d62-490a-adba-d9c72652a3d1`
- Current intended saved Audio Story TTS settings:
  - provider: `aimax`
  - model: `speech-2.8-hd`
  - voice: `Ngọc Huyền 24k`
  - voice_id: `hn_female_ngochuyen_full_24k-st`
  - speed: `1.1`
  - pitch: `2`
  - volume: `1.0`
  - enable_srt: `true`
  - normalize: `true`
  - use_chunking: `false`
- Pre-run trace passed for Ch.1–8 with cache key `1904e057791aaa2ac1018b2d06373f57a9a79a0e37a4be8b2fabdf18e17d98b6`
- Historical Ch.1–5 asset `7ac9552e-321e-4511-81d7-c50dd8859fca` remains preserved but is incompatible with the current Ch.1–8 episode script/settings
- Minimal safety fix added: `runStoryEpisodeTTS` now only reuses an existing ready asset when `cacheKey` matches the current episode trace
- First real Ch.1–8 attempt failed before job submission completed because the AiMax generate request hit a 30-second fetch timeout
- Minimal provider fix added: AiMax `POST /api/v1/tts/generate` now uses a longer submit timeout for large longform payloads
- Second real Ch.1–8 attempt successfully queued external AiMax job `64be16b4-8e33-46d2-b54d-14b0a00c18ef`
- F4.2a reconciliation path is now implemented:
  - story asset reconcile uses the existing AiMax external job id only
  - no new paid synthesis submission is made during reconciliation
  - if AiMax is still processing, asset remains `generating`
  - if AiMax is completed, the existing `story_audio_assets` row is finalized in place
- Current finalized Ch.1–8 production audio:
  - asset id: `89646d8d-1adb-4c75-8ef2-6340262ec3bb`
  - status: `ready`
  - tts_job_id: `64be16b4-8e33-46d2-b54d-14b0a00c18ef`
  - audio path: `media/story-audio/4e6fb304-644b-4a01-80d3-3032996220ae-ep2.wav`
  - srt path: `media/story-audio/4e6fb304-644b-4a01-80d3-3032996220ae-ep2.srt`
  - duration: `2811.60 sec` (`46m 51s`)
  - compatibility: `compatible = true` via `cache_key_match`
- Ch.1–8 audio/SRT QC result:
  - ffprobe: `pcm_s16le`, `48000 Hz`, mono, `16-bit`
  - file size: `257.4 MB`
  - SRT cue count: `853`
  - first cue: `00:00:00,000`
  - last cue: `00:46:51,103`
  - no empty captions
  - no reversed timestamps
  - max observed SRT gap: `0.5 sec`
- Historical Ch.1–5 asset remains preserved for debug/history:
  - asset id: `7ac9552e-321e-4511-81d7-c50dd8859fca`
  - restored to dedicated history files:
    - `media/story-audio/history/7ac9552e-321e-4511-81d7-c50dd8859fca.wav`
    - `media/story-audio/history/7ac9552e-321e-4511-81d7-c50dd8859fca.srt`
  - it remains incompatible with current Ch.1–8 production script/settings
- Metadata remained `approved = false` immediately after the Ch.1–8 refresh
- F4.2b metadata reapproval result:
  - metadata row `e6f046e3-1229-4c1a-bc50-c747f82cde48` audited and approved
  - `episode_label = Tập 1`
  - `chapter_range_text = Chương 1–8`
  - title does not reference `Chương 1–5`
  - description references `Chương 1–8`
  - tags / hashtags / pinned comment / playlist info all present
  - Tee Audio support block preserved exactly
  - `approved = true`
  - `approved_at` set on the existing row
- F4.2b pre-render readiness result:
  - current compatible production audio remains `89646d8d-1adb-4c75-8ef2-6340262ec3bb`
  - measured duration `2811.60 sec` (`46m51s`)
  - target status `in_target_range`
  - compatible ready audio exists
  - SRT exists
  - blocking issues: none
  - recommended next action: render video
  - old Ch.1–5 audio remains history only and is not selected as current production audio
- Render/upload remain future phases; no render, upload package, upload, or publish occurred in F4.2a or F4.2b

### Immediate next narrow phase

`Phase F4.3 — Production Episode 1 video render only`

- Use the compatible Ch.1–8 audio asset to render the production video
- Do not create upload package or upload in the same phase
- Keep smoke-test assets/history untouched

### F4.3 Result

- Production Episode 1 video render completed successfully
- Render input audio asset:
  - `89646d8d-1adb-4c75-8ef2-6340262ec3bb`
  - compatible with current Ch.1–8 production episode
  - old Ch.1–5 history audio was not selected
- Created video asset:
  - id: `35538dc5-ace9-4747-a44d-6a7ab11999ca`
  - episode id: `7efba094-4d62-490a-adba-d9c72652a3d1`
  - audio asset id: `89646d8d-1adb-4c75-8ef2-6340262ec3bb`
  - status: `ready`
  - video path: `media/story-videos/4e6fb304-644b-4a01-80d3-3032996220ae/episode-2.mp4`
  - cover image path: `media/story-covers/4e6fb304-644b-4a01-80d3-3032996220ae-ep2-cover.png`
  - sidecar subtitle path: `media/story-videos/4e6fb304-644b-4a01-80d3-3032996220ae/episode-2.srt`
- Video QC summary:
  - container: `mp4`
  - video codec: `h264`
  - audio codec: `aac`
  - resolution: `1920x1080`
  - fps: `25`
  - duration: `2813.64 sec`
  - file size: `78,143,562 bytes` (`~74.5 MB`)
  - audio stream present: yes
  - zero-byte output: no
  - subtitle behavior: sidecar SRT copied alongside MP4, not burned into video
- Audio/video duration comparison:
  - source audio: `2811.60 sec`
  - rendered video container duration: `2813.64 sec`
  - acceptable close match for current renderer
- Manual upload package created for Production Episode 1 (Tập 1 — Chương 1–8)
  - package id: `3da4671d-acd4-43f5-8ea6-2ac954b243c3`
  - package path: `media/story-upload-packages/4e6fb304-644b-4a01-80d3-3032996220ae/episode-2`
  - source video asset: `35538dc5-ace9-4747-a44d-6a7ab11999ca`
  - source audio asset: `89646d8d-1adb-4c75-8ef2-6340262ec3bb`
  - exported production label remains `Tập 1`; internal directory stays `episode-2` because the older smoke-test package remains preserved separately in history
  - included files:
    - `episode-2.mp4`
    - `episode-2.srt`
    - `thumbnail.png`
    - `metadata.json`
    - `metadata.md`
    - `checksums.sha256`
  - target channel in package metadata: `Tee Audio` / `@teeaudio` / `UCtmtL89-IfuhcGBWwcB48Ng`
  - metadata exports approved Chương `1–8` title/description/tags plus the exact Tee Audio support block
  - package QC:
    - MP4 exists, non-zero, `h264` video + `aac` audio
    - SRT sidecar exists and is included because subtitles are not burned in
    - thumbnail exists and is included
    - checksums generated for package files
    - packaged video duration remains `2813.64 sec`
- No upload or publish occurred
- Manual upload validation record created for the production package
  - validation id: `e6be863b-0996-4ec9-9608-e1b5f4a0cffe`
  - linked package id: `3da4671d-acd4-43f5-8ea6-2ac954b243c3`
  - linked episode id: `7efba094-4d62-490a-adba-d9c72652a3d1`
  - current status: existing-equivalent pending state = `not_uploaded`
  - operator note stored in validation record:
    - use Tee Audio / `@teeaudio` / `UCtmtL89-IfuhcGBWwcB48Ng`
    - upload `episode-2.mp4`
    - paste approved metadata for `Tập 1 — Chương 1–8`
    - upload `thumbnail.png`
    - upload `episode-2.srt` as Vietnamese subtitles
    - prefer `private` or `unlisted` first for QC
    - verify duration about `46m51s`, audio playback, subtitle sync, and Tee Audio support block
    - after manual upload, paste the real YouTube URL and final visibility into Story Studio
- No API upload, no publish, no scheduler, and no `upload_queue` usage
- Next phase is real manual upload validation/checklist only

#### Phase F4.6 — Production Episode 1 uploaded to Tee Audio via API for private review (2026-06-18)

- Upload used the connected Tee Audio YouTube credential pool after explicit channel guard:
  - target channel: `Tee Audio` / `@teeaudio` / `UCtmtL89-IfuhcGBWwcB48Ng`
  - selected credential row: `social_channels.id = 14`
  - note: the credential row still carries legacy `channel_key = phat_phap`, but the upload guard resolved by exact YouTube channel ID and Tee Audio identity before uploading
- Package guard passed before upload:
  - package id: `3da4671d-acd4-43f5-8ea6-2ac954b243c3`
  - package path: `media/story-upload-packages/4e6fb304-644b-4a01-80d3-3032996220ae/episode-2`
  - checksums matched
  - MP4 ffprobe: `h264` + `aac`, `1920x1080`, duration `2813.64 sec`
  - metadata remained approved for `Tập 1 — Chương 1–8`
  - Tee Audio support block remained present
- Upload result:
  - YouTube video id: `9ILoRB-5THM`
  - YouTube URL: `https://www.youtube.com/watch?v=9ILoRB-5THM`
  - visibility: `private`
  - thumbnail: uploaded successfully
  - captions: API upload did **not** complete because the current credential scopes were insufficient; SRT remains a manual follow-up in YouTube Studio
  - playlist: not attached automatically in this pass; keep as manual follow-up
- Validation record updated in place:
  - validation id: `e6be863b-0996-4ec9-9608-e1b5f4a0cffe`
  - status: `uploaded_pending_review`
  - uploaded_at set
  - checklist booleans intentionally remain pending until human review is completed on the real YouTube-hosted version
- No public publish happened
- No scheduler or generic `upload_queue` flow was used
- Next step:
  - review the private YouTube upload
  - upload SRT manually in YouTube Studio
  - verify audio/subtitles/description/thumbnail on YouTube
  - only then decide whether to keep private, switch to unlisted, or publish public manually

#### Post-Test Human Review — pipeline pass, creative fail (2026-06-18)

- Technical pipeline verdict: **passed**
  - chapter generation worked
  - AiMax TTS generation worked
  - long-running AiMax reconciliation worked
  - measured duration calibration worked
  - video render worked
  - package creation worked
  - YouTube API upload to Tee Audio worked in `private` mode
  - target channel guard worked and prevented wrong-channel upload risk
- Creative/public-readiness verdict: **failed**
  - current private upload `https://www.youtube.com/watch?v=9ILoRB-5THM` must remain `private`
  - this upload is a **pipeline validation artifact**, not a final public release
  - do **not** make this version public
  - treat the current upload as test history / failed creative review
- Human creative review issues:
  1. Thumbnail/cover is too plain and too text-only.
  2. Cover needs manhua/manhwa / Chinese-romance character art, not a plain text poster.
  3. Opening narration is weak and repeats chapter labeling awkwardly.
  4. TTS should not speak chapter labels or chapter titles like `Chương 2`, `Chương 3`.
  5. Tee Audio intro is missing.
  6. Short văn án / premise is missing after intro.
  7. A pause of about `1.0–1.5s` is needed before the story body begins.
  8. Background music is missing or not clearly integrated.
  9. Story Studio still does not expose enough render/upload/review state clearly.
  10. A proper pre-publish listen/review surface is still missing.
- Product decision:
  - the current story can be abandoned or regenerated from Chapter 1
  - the user explicitly allows restarting from Chapter 1
  - current Ch.1–8 content should **not** be treated as final creative quality by default

#### Creative Repair Requirements

- Narration output must **not** speak raw chapter headings or duplicated labels like `Chương 1, Chương 1`.
- Spoken TTS script must be sanitized before synthesis.
- Tee Audio intro is required:
  - `Tee Audio chào các bạn, chúc các bạn nghe truyện vui vẻ.`
- A short văn án / premise is required after the intro.
- Insert a `1.0–1.5s` pause between intro/văn án and the story body.
- Story body should start directly and naturally after the intro/pause.
- Chapter boundaries remain internal production structure only; they should not dominate the spoken listener experience.
- Stronger creative review is required before any upload is considered public-ready.

#### Cover / Thumbnail Upgrade

- Audio Story longform covers should use `fal.ai` or the existing image provider stack rather than plain text-only output.
- Target style:
  - Chinese manhua / manhwa romance drama
  - strong female lead character art
  - revenge / rebirth / wealth / CEO emotional tone
  - cinematic, high-CTR, platform-native YouTube longform look
- Explicitly avoid Buddhist / `phat_phap` visual language.
- Save versioned cover assets rather than silently replacing one file.
- Cover generation should support preview/review before render or upload.

#### Background Music Requirement

- Audio Story longform needs an explicit background music layer.
- Music should be subtle, loopable, and clearly subordinate to narration.
- Recommended defaults:
  - music volume around `-28dB` to `-34dB`
  - fade-in `2s`
  - fade-out `3s`
  - do not overpower narration
- Production use requires music license / user confirmation.
- UI should show:
  - whether music is configured
  - whether license/user confirmation is complete
  - whether the current render includes music or not

#### Story Quality Reset Option

- Current story may be treated as:
  - test-only
  - failed creative review
  - replaceable from Chapter 1
- Supported recovery options should be:
  - `Regenerate from Chapter 1`
  - `Start New Story with Improved Model`
- Do not reuse a weak opening by default just because the technical pipeline already succeeded.
- Chapter 1 must receive creative approval before the system continues toward a full `45–60 minute` production episode.

#### Recommended New Story Flow

- Safer flow from here:
  1. Generate premise + character bible.
  2. Generate **Chapter 1 only**.
  3. Human reads/listens to Chapter 1 preview.
  4. If Chapter 1 passes creatively, continue generating later chapters.
  5. If Chapter 1 fails, regenerate before continuing.
- Do **not** generate 8 chapters blindly again before creative approval of the opening.

#### Writing Model Direction

- For Audio Story prose quality and rewrites, prefer the strongest creative-writing model available in the stack, such as **Sonnet 4** if available.
- Use cheaper models only for utility work:
  - metadata
  - formatting
  - parsing
  - mechanical checks
- Story prose, chapter openings, emotional pacing, character depth, and rewrites should route to the strongest available creative model rather than a cheap default.

#### Narration Script Builder

- Raw chapter text is **not** the same as the spoken TTS script.
- A spoken-script builder is required between approved chapter text and TTS.
- Builder responsibilities:
  - remove heading/title artifacts
  - prevent spoken chapter labels in the listener-facing narration
  - inject Tee Audio intro
  - inject short văn án
  - inject required pause
  - preserve the underlying story prose
- The sanitized spoken script must generate a new cache key / hash.
- Audio compatibility should use the sanitized spoken-script hash rather than raw chapter text alone.

#### Pre-Publish Preview Screen

- Story Studio needs a pre-publish preview/review screen with:
  - full episode listen preview
  - video preview
  - metadata preview
  - thumbnail preview
  - SRT/subtitle status
  - music included / not included
  - duration
  - current audio asset
  - current video asset
  - current package asset
  - upload state
  - validation checklist
  - private/public status
  - final creative review pass/fail
- Public release should be blocked until this review surface is passed by a human.

#### Story Studio Submenu Plan

- Add a clearer Story Studio submenu:
  - Overview
  - Bible
  - Chapters
  - Reader
  - Episodes
  - Audio
  - Video
  - Covers
  - Packages
  - Upload Review
  - Analytics later
  - Settings
- Each tab should expose the relevant state clearly instead of hiding render/upload/review state inside one crowded episode page.

#### Asset Visibility Requirements

- UI should clearly show:
  - chapters generated / approved / locked
  - which chapters are included in each episode
  - current audio asset
  - historical audio assets
  - current video asset
  - historical/test video assets
  - package status
  - upload status
  - validation status
  - YouTube URL if uploaded
  - whether the current upload is test / private / failed creative review

#### Upload Policy

- API upload to Tee Audio is allowed.
- First upload should be `private` or `unlisted`, not public.
- Public release requires human creative review pass.
- A failed private upload/review remains history and should be replaced, not publiced later.
- SRT upload may remain manual if OAuth caption scope is missing.
- Playlist attachment may remain manual until a safe supported path exists.

#### Next Roadmap From Here

- A. Documentation / handoff update only
  - record the creative-review failure and keep the test upload private
- B. Story creative reset
  - either start a new story, or regenerate the current story from Chapter 1
  - use Sonnet 4 or the strongest available creative-writing model
- C. Add narration script sanitizer / spoken-script builder
- D. Add `fal.ai` manhua/manhwa romance cover generation
- E. Add background music layer and music review state
- F. Add pre-publish preview UI and Story Studio submenus
- G. Regenerate Chapter 1 and require creative approval before continuing
- H. Only after that, rerun TTS → render → package → upload private again

### Immediate next recommended phase

`Phase F4.7 — Creative reset planning + Chapter 1 restart flow`

- Decide whether to start a new story or regenerate the current story from Chapter 1
- Route story generation/rewrite to Sonnet 4 or the strongest available creative model
- Define the spoken-script sanitizer requirements before the next TTS run
- Keep the current private upload as non-public test history only

**F4.20 — Live Episode Spoken Script Canonicalization Fix (implemented narrow pass):**
- Goal: fix the real production episode spoken-script canonicalization gap without running TTS, render, packaging, upload, publish, cover generation, or music mixing.
- Root cause confirmed on live episode `7efba094-4d62-490a-adba-d9c72652a3d1`:
  - source script stores headings like `=== Chương 2: ... ===`
  - the original sanitizer removed plain chapter labels, but missed wrapped heading forms, so creative review kept blocking the spoken script
- Sanitizer hardening:
  - chapter-heading detection now normalizes wrapper markers such as `=== ... ===`
  - chapter-heading detection also covers spelled-number forms such as `Chương một`
  - chapter label/title detection is shared between sanitizer warnings and the creative review gate
- Canonical source of truth remains the sanitized `spokenScript`:
  - `spokenScriptHash` stays the cache/review identity input
  - creative review and audio compatibility continue to rely on sanitized spoken-script identity rather than raw chapter package text
- Added operator diagnostics:
  - `scripts/inspect-audio-story-spoken-script.ts --episode-id <id>`
  - prints removed headings, surviving suspicious lines, spoken-script hash, and current audio compatibility for the live episode
- Existing audio safety:
  - any audio generated from a stale pre-fix spoken script must not be treated as current review-ready audio once the sanitized spoken-script hash changes
- This phase does **not** mark creative review passed automatically.
- This phase does **not** run AiMax TTS, Fal.ai, video render, upload package, upload, publish, or any visibility/public action.

**F4.21 — New Story Draft From Scratch (implemented narrow pass):**
- Decision reset:
  - old private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only and must not be publiced
  - old episode `7efba094-4d62-490a-adba-d9c72652a3d1` must not be forced into production
  - this phase switches to a clean new-story flow instead of continuing to patch the old episode
- New operator-safe draft flow:
  - added `scripts/create-audio-story-draft-chapter1.ts`
  - requires `AUDIO_STORY_CREATE_NEW_DRAFT=1` before any DB record is created
  - without the flag, the script stays in dry-run mode and only prints the plan + effective writing models
  - with the flag, the flow creates:
    - new story row
    - premise candidates
    - selected premise
    - story/character bible
    - one-chapter outline
    - Chapter 1 draft only
  - then it stops for human review
- Creative direction for the new story draft:
  - Vietnamese longform audio fiction
  - Chinese manhua/manhwa romance-drama feel
  - real heiress / fake heiress conflict
  - cold elegant female lead
  - wealthy family / mansion / elite social circle
  - revenge / face-slapping / emotional tension
  - no explicit sexual content
  - no franchise / celebrity references
- Chapter 1 guard:
  - Chapter 2+ generation is now blocked until Chapter 1 is approved
  - the guard is enforced server-side in chapter generation, not only in UI
  - Story Studio shows the explicit operator message: `Chapter 2+ generation is blocked until Chapter 1 is approved.`
- Review state:
  - reused existing chapter data model; no new migration in this pass
  - Chapter 1 review state is derived as `pending | approved | rejected`
  - `approved` uses the existing QC + approve flow
  - `rejected` is stored via chapter `status = rejected`
  - human review notes are stored in chapter `qualityNotes` with a review-note prefix so they remain visible without schema churn
- Spoken-script preview:
  - Chapter page now exposes a Chapter 1 spoken-script preview using the F4.8 sanitizer path
  - preview includes Tee Audio intro, synopsis, pause marker, sanitized narration body, removed headings, warnings, and `spokenScriptHash`
- Generation hygiene:
  - generated chapter body is sanitized before persistence so top-line `Chương 1` / chapter-title artifacts do not leak into later narration
- This phase does **not** run AiMax TTS, Fal.ai, cover generation, music mixing, video render, package creation, upload, publish, or any visibility/public action.

**F4.22 — First Real New Story Draft + Chapter 1 (executed):**
- Created one real new Audio Story draft using the F4.21 Chapter-1-only flow.
- Created story:
  - story id: `20f30412-102b-4bae-a279-2ddb25b509eb`
  - title: `Phượng Hoàng Trở Lại`
  - status: `drafting`
- Created Chapter 1 only:
  - chapter id: `36`
  - chapter number: `1`
  - chapter title: `Phượng Hoàng Tái Sinh: Lời Thề Báo Thù`
  - review state remains pending-safe equivalent:
    - `approved = false`
    - `status = draft`
    - no automatic approval happened
- Effective writing model route used:
  - premise / bible / outline / chapter / rewrite: `anthropic/claude-sonnet-4-6`
  - QC default discovered for later use: `google/gemini-2.5-flash-lite`
- Chapter 1 output validation:
  - word count: `1649`
  - spoken-script preview status: `READY`
  - `spokenScriptHash`: `577c112799f86d13bb19a114e10fc03ce230871c838b9d874b0f6697dc17a453`
  - sanitizer warnings: none
  - spoken narration body does **not** contain forbidden spoken label `Chương 1`
  - chapter title metadata does **not** leak into the narration body
- Chapter 2+ guard remains active:
  - `allowed = false`
  - reason: `Chapter 2+ generation is blocked until Chapter 1 is approved.`
- No Chapter 2+ was created.
- No AiMax TTS, Fal.ai, cover generation, music mixing, render, package creation, upload, publish, or visibility/public action happened.
- Old history remains untouched:
  - private YouTube test video `9ILoRB-5THM` remains failed creative-review / private test history only
  - old episode `7efba094-4d62-490a-adba-d9c72652a3d1` remains failed history only and was not patched toward production

**F4.23 — Chapter 1 Human Review Quality Gate (implemented 2026-06-19):**
- Purpose: give the operator a deterministic quality report for Chapter 1 before any human approval decision.
- This phase is a review gate only. No TTS, no Fal.ai, no cover/music/render/upload/publish happened.

Scope constraints enforced:
- Did not touch phat_phap, tang_sau, healing, Buddhist, short/reel, upload_queue, or social cron.
- Did not upload, publish, or change YouTube visibility for any asset.
- Did not implement playlist automation.
- Chapter 1 was NOT approved automatically — the gate is human-only.
- Old private YouTube test video `9ILoRB-5THM` and old failed episode `7efba094-4d62-490a-adba-d9c72652a3d1` remain history only. Not patched, not reused, not approved.
- Chapter 2+ remains blocked until the operator manually approves Chapter 1 via the UI.

Deliverables:
- `src/lib/story-studio/chapter1-quality-checklist.ts` — shared deterministic quality checklist library (10 checks, no LLM calls):
  1. Opening hook strength (action word heuristic, first 300 chars)
  2. No "Chương N" label in body
  3. Female lead introduced in first 500 chars
  4. Conflict/revenge/wealth keywords (≥3 for PASS)
  5. Emotional tension in first 40% of text (≥3 keywords for PASS)
  6. Cliffhanger ending in last 400 chars (≥2 signals for PASS)
  7. No markdown heading lines in body
  8. No code blocks in body
  9. Chapter title not literally present in body
  10. Adequate paragraph breaks for narration (≥8 for PASS, 4–7 WARNING, <4 BLOCKED)
- `scripts/review-audio-story-chapter1.ts` — operator review script:
  - requires `AUDIO_STORY_ID` and `AUDIO_STORY_CHAPTER_NUMBER` env vars; exits cleanly if missing
  - loads story + chapter from DB
  - prints full metadata (id, title, status, approved flag, word count, estimated duration, spokenScriptHash)
  - prints first/last ~1000 chars of chapter body
  - prints Chapter 2+ gate status
  - runs 10-item deterministic quality checklist, labelled PASS / WARNING / BLOCKED
  - prints operator summary; explicitly instructs NOT to approve automatically
  - invoked via: `AUDIO_STORY_ID=<uuid> AUDIO_STORY_CHAPTER_NUMBER=1 pnpm review:story-chapter1`
- `package.json` — added `"review:story-chapter1"` script
- `src/components/story-studio/chapter-client.tsx` — added collapsible `Chapter1Checklist` UI panel in the Chapter 1 sidebar review section; computes checklist live from current `chapterText` state using `useMemo`; also fixed pre-existing `formatDurationSec` missing function

Review script result for `20f30412-102b-4bae-a279-2ddb25b509eb` Chapter 1 (2026-06-19):
- Sanitizer status: `READY`
- spokenScriptHash: `577c112799f86d13bb19a114e10fc03ce230871c838b9d874b0f6697dc17a453` (stable)
- Estimated duration: 13 min 22 sec (~1734 spoken words)
- Checklist result: **10 PASS | 0 WARNING | 0 BLOCKED** — overall ✅ PASS
- Chapter 2+ gate: BLOCKED (correct — chapter is not yet approved)
- Chapter 1 is NOT approved — operator must review full text and approve manually via the UI

Guard verification (run against existing `test-audio-story-draft-chapter1.ts`):
- pending state → Chapter 2+ blocked ✅
- rejected state → Chapter 2+ blocked ✅
- approved state → Chapter 2+ allowed ✅

What comes next (operator decision):
- Read the full Chapter 1 text at `/story-studio/20f30412-102b-4bae-a279-2ddb25b509eb/chapters/1`
- Run "Kiểm tra liên tục" (continuity check) to populate `qualityCheck`
- If satisfied, click "Duyệt chương" to approve
- Only after approval will Chapter 2+ generation unlock

**F4.25 — Chapter 2 Sequential Gate + Verification Pass (2026-06-19):**

State at time of this pass:
- Chapter 1 status: `draft`, `approved = false`, `qualityCheck = null`
- Chapter 2 generation: **BLOCKED** (Chapter 1 not yet approved)
- Chapter 2 was NOT generated in this pass

What changed:
- `src/lib/story-studio/chapter-generation-guard.ts` — guard extended to **sequential**: Chapter N now requires Chapter N-1 to be approved (not just "Chapter 1 for all N≥2"). This means:
  - Chapter 2 blocked until Chapter 1 approved (same effective behavior now)
  - Chapter 3 blocked until Chapter 2 approved (new)
  - Chapter 4 blocked until Chapter 3 approved (new)
  - etc.
- `scripts/test-audio-story-draft-chapter1.ts` — updated tests:
  - updated reason string assertion to match new sequential format
  - added Chapter 3 blocked while Chapter 2 pending test
  - added Chapter 3 blocked while Chapter 2 missing test
  - added Chapter 3 allowed after Chapter 2 approved test
  - added Chapter 2 narration body must not contain "Chương 2" test
  - added Chapter 2 chapter title must not leak into spoken script test
  - all tests pass ✅

Guard verification result:
- Chapter 2 blocked while Chapter 1 pending ✅
- Chapter 2 blocked while Chapter 1 rejected ✅
- Chapter 2 allowed after Chapter 1 approved ✅
- Chapter 3 blocked while Chapter 2 pending ✅
- Chapter 3 blocked while Chapter 2 missing ✅
- Chapter 3 allowed after Chapter 2 approved ✅
- "Chương 2" stripped from Chapter 2 narration body ✅
- Chapter 2 title does not leak into spoken script ✅

Scope enforced:
- Did NOT approve Chapter 1 automatically
- Did NOT generate Chapter 2 (Chapter 1 not approved)
- Did NOT generate Chapter 3+
- No TTS, Fal.ai, cover/music/render/upload/publish
- No phat_phap, tang_sau, upload_queue, or social cron touched
- Old failed video `9ILoRB-5THM` and episode `7efba094-...` remain history only

What the operator must do to unlock Chapter 2:
1. Open `/story-studio/20f30412-102b-4bae-a279-2ddb25b509eb/chapters/1`
2. Click "Kiểm tra liên tục" — this runs the continuity QC and populates `qualityCheck` (required before the approve button activates)
3. Read the full chapter text
4. Click "Duyệt chương" to approve
5. Chapter 2 generation will then unlock — navigate to `/story-studio/20f30412-102b-4bae-a279-2ddb25b509eb/chapters/2?autoGenerate=1` or click the generate button in Story Studio

**F4.25 — Chapter 2 Generation COMPLETE (2026-06-19):**

Operator confirmed Chapter 1 approved in DB (`approved=true`, `status=approved`). Sequential gate opened. Chapter 2 generated.

Chapter 2 result:
- DB id: 37
- Title: "Mặt Nạ Rạn Nứt"
- Status: `draft`, `approved=false` (not auto-approved)
- Word count: 1352 words
- Cliffhanger: Người phụ nữ lạ tự xưng là mẹ của An Hạ xuất hiện trước cửa
- Model: `google/gemini-2.5-flash` (engine default — Claude Sonnet via OpenRouter was not used; it emits unescaped JSON strings that break `json_object` mode for long creative outputs)
- Sanitizer status: READY
- Spoken script hash: `dd2f06ab9d0dc5790836e5dbd8a9c6d92ee9f438f88be5d6d9b06361e3e3ce7f`
- Est. spoken duration: 11 min 5 sec
- "Chương 2" leaked: NO ✅
- Chapter title leaked: NO ✅
- Chapter 3 gate: 🔒 BLOCKED (Chapter 2 not yet approved) ✅

Engine fix (incl. in this session):
- `src/lib/story-studio/engine.ts` — `fixLiteralNewlines()` added to `extractJSON()` to handle literal newlines in Claude-model JSON output through OpenRouter
- `package.json` — `create:story-chapter2` script no longer forces `STORY_MODEL_CHAPTER=anthropic/claude-sonnet-4-6`; engine default (Gemini Flash) is used

Scope enforced:
- Did NOT approve Chapter 2 automatically
- Did NOT generate Chapter 3+
- No TTS, Fal.ai, cover/music/render/upload/publish
- No phat_phap, tang_sau, upload_queue, or social cron touched
- Old failed video `9ILoRB-5THM` and episode `7efba094-...` remain history only

Open threads for Chapter 3 (from engine output):
- Danh tính và mục đích của Tấn Lực — hắn là kẻ thù cũ, biết An Hạ từ trước
- Bằng chứng mới về mẹ ruột của An Hạ — câu hỏi về mẹ còn sống hay không
- Mối quan hệ giữa An Hạ và người phụ nữ bí ẩn tự xưng là mẹ cô

What the operator must do to unlock Chapter 3:
1. Open `/story-studio/20f30412-102b-4bae-a279-2ddb25b509eb/chapters/2`
2. Click "Kiểm tra liên tục" to run continuity QC
3. Read the full chapter text
4. Click "Duyệt chương" to approve
5. Then use `AUDIO_STORY_ID=... pnpm create:story-chapter3` (to be created) or Story Studio UI button

---

**F4.26 — Story Studio Chapter Navigation UX (2026-06-19):**

UX/navigation only — no chapter generation, no TTS, no render/upload/publish.

What changed:
- `src/components/story-studio/chapter-client.tsx`:
  - Added `chapters: StoryChapter[]` prop
  - Added `ChapterNavPanel` sub-component in left sidebar — shows all existing chapters with number, title, status, approved icon, and a link to each chapter page; shows a locked "Chương N" row for the next chapter when the sequential gate is blocked
  - Added "← Truyện" back-link in top bar (links back to `/story-studio`)
  - Generalized the review gate panel for any chapter number (was Chapter 1 only; now shows for Ch2, Ch3, etc. with "Chương N+1 bị khóa cho đến khi chương này được duyệt")
  - Shown spoken script preview for all chapters (was Ch1 only)
- `src/app/story-studio/[storyId]/chapters/[chapterNumber]/page.tsx`:
  - Pass `chapters={chapters}` to `ChapterClient` (chapters already fetched by the page)
- `src/components/story-studio/story-dashboard.tsx`:
  - Story card chapter link now points to the latest chapter (`totalChapters`) instead of always Chapter 1
  - Link label reads "Chương N →" (where N = totalChapters)

How to open Chapter 2 now:
- Go to `/story-studio` → click "Chương 2 →" on the "Phượng Hoàng Trở Lại" card
- OR open any chapter page → see the ChapterNavPanel in the left sidebar → click "Chương 2"

Locked Chapter 3 display:
- In the ChapterNavPanel on any chapter page, a "Chương 3 — khóa" row is shown at the bottom of the chapter list (greyed out, lock icon, no link)
- In the right panel → "Kiểm tra & Duyệt" section, the review gate panel reads: "Chương 3 bị khóa cho đến khi chương này được duyệt."
- No Chapter 3 was created or generated

Scope enforced:
- Did NOT generate Chapter 3
- Did NOT run TTS, Fal.ai, render, upload, or publish anything
- Did NOT touch phat_phap, social cron, upload_queue
- Old failed video/episode remain history only

---

**F4.27a — Audio Story Token/Cost Tracking Fix (2026-06-19):**

Tracking fix only — no chapter generation, no TTS, no render/upload/publish.

**Problem identified:** All Audio Story LLM calls bypassed the canonical `logApiUsage()` mechanism in `src/actions/ai-usage.ts`. The engine (`src/lib/story-studio/engine.ts`) called the OpenRouter client directly and discarded `response.usage`, so no token counts or costs appeared in `/settings/tokens`.

Additionally, `google/gemini-2.5-flash` (the default Audio Story model) and `google/gemini-2.5-flash-lite` (the QC model) were missing from the `AI_MODELS` pricing table in `src/lib/ai-models.ts`, causing `calcCost()` to return 0 even if tokens had been tracked.

**What changed:**

- `src/lib/ai-models.ts`:
  - Added `google/gemini-2.5-pro` (stable alias, $1.25/$10.0 per 1M)
  - Added `google/gemini-2.5-flash` (stable alias, $0.15/$0.60 per 1M) — default Audio Story model
  - Added `google/gemini-2.5-flash-lite` ($0.075/$0.30 per 1M) — QC model

- `src/lib/story-studio/engine.ts`:
  - Added `import { logApiUsage } from "@/actions/ai-usage"`
  - Added `storyId?: string` param to: `generatePremises`, `generateStoryBible`, `generateOutline`, `generateChapterDraft`
  - Added `storyId?: string`, `chapterNumber?: number` params to: `rewriteChapter`, `checkContinuity`
  - Added `void logApiUsage(...)` call after every `client.chat.completions.create()` in all 6 functions, with `feature: "audio_story"` in metadata and task labels: `premise`, `bible`, `outline`, `chapter_generation`, `rewrite`, `qc_continuity`

- `src/actions/story-studio.ts`:
  - `generatePremisesAction`, `generateBibleAction`, `generateOutlineAction`, `generateChapterDraftAction`: added `storyId` pass-through to engine calls
  - `rewriteChapterAction`: added `storyId`, `chapterNumber` pass-through
  - `checkChapterContinuityAction`: added `storyId` pass-through (chapterNumber already available)

- `scripts/create-audio-story-draft-chapter1.ts`:
  - Added `storyId: story.id` to `generatePremises`, `generateStoryBible`, `generateOutline`, `generateChapterDraft` calls

- `scripts/create-audio-story-chapter2.ts`:
  - Added `storyId: STORY_ID` to `generateOutline` and `generateChapterDraft` calls

**Backfill status:** Chapter 1 and Chapter 2 were generated before this fix. The exact token usage from those runs cannot be reconstructed — no per-run DB record was saved. No backfill was performed.

**Scope enforced:**
- Did NOT generate Chapter 3 or any new chapter
- Did NOT run TTS, Fal.ai, render, upload, or publish anything
- Did NOT touch phat_phap, social cron, upload_queue
- Did NOT create a parallel cost system or invent historical costs

---

**F4.28 — Chapter 3 Generation (2026-06-19):**

Chapter generation only — no TTS, no render/upload/publish.

**Pre-checks:**
- DB confirmed: Ch2 `approved=true`, `status=approved` ✅
- Sequential guard: Ch3 gate OPEN ✅

**Generated:**
- Chapter 3 DB id: 38
- Title: "Lật Mặt Kẻ Thù"
- Status: draft / approved: false
- Word count: 1399
- Model: `google/gemini-2.5-flash` via OpenRouter

**Sanitizer result:**
- Status: READY
- Hash: `b9e33d64f79d1cab98ddfc8243ba7ff25a61f66f7330ecd6f91104ad4fb7053c`
- Spoken word count: 1484 / Est. duration: 11 min 27 sec
- "Chương 3" leaked into body: NO ✅
- Title leaked into body: NO ✅

**Token/cost tracking verified:**
- `story_outline_gen`: 808 in / 2305 out → $0.001504 (api_usage_logs id=5859)
- `story_chapter_draft`: 3078 in / 2887 out → $0.002194 (api_usage_logs id=5860)
- Both rows confirmed in `api_usage_logs` with `metadata.feature = "audio_story"`
- **Note:** Scripts must use `--env-file=.env.local` (via `pnpm create:story-chapter3`) for tracking to work. Running `pnpm tsx` without this flag causes the Drizzle `db` pool to initialize before `DATABASE_URL` is available, silently failing `logApiUsage` writes.

**Chapter 4 gate:** BLOCKED until Chapter 3 is approved ✅

**Cliffhanger:** Khi đèn flash của các phóng viên bùng nổ, và An Hạ chuẩn bị kết thúc bài phát biểu vạch trần sự thật, một tiếng súng khô khốc vang lên từ đám đông. An Hạ ngã xuống, một vệt máu đỏ tươi loang ra trên nền áo trắng. Ai đã bắn cô?

**Review at:** `/story-studio/20f30412-102b-4bae-a279-2ddb25b509eb/chapters/3`

**Scope enforced:**
- Did NOT generate Chapter 4+
- Did NOT run TTS, Fal.ai, render, upload, or publish anything
- Did NOT touch phat_phap, social cron, upload_queue

---

**F4.29 — Semi-Auto Chapter Batch Generator (2026-06-19):**

Text-only draft generation — no TTS, no cover, no music, no render, no upload, no publish.

**Files added:**

- `src/lib/story-studio/batch-generation-validator.ts` — pure validation functions (testable without DB/LLM)
- `scripts/create-audio-story-chapter-batch.ts` — batch generation script
- `scripts/test-audio-story-chapter-batch.ts` — 19 unit tests for validation logic

**npm scripts added to package.json:**

```
create:story-chapter-batch   tsx --env-file=.env.local ... scripts/create-audio-story-chapter-batch.ts
test:audio-story-chapter-batch  tsx ... scripts/test-audio-story-chapter-batch.ts
```

**How to run:**

```sh
AUDIO_STORY_ID=20f30412-102b-4bae-a279-2ddb25b509eb \
AUDIO_STORY_BATCH_START_CHAPTER=4 \
AUDIO_STORY_BATCH_COUNT=3 \
pnpm create:story-chapter-batch
```

**Safety defaults:**

| Setting | Default | Override |
|---------|---------|----------|
| Max chapters per run | 3 | `AUDIO_STORY_BATCH_MAX=<n>` (hard cap: 10) |
| First chapter requires prev approved | YES — cannot be disabled | — |
| Draft-chain (subsequent chapters accept draft prev) | disabled | `AUDIO_STORY_BATCH_ALLOW_DRAFT_CHAIN=1` |
| Auto-approve | NEVER | — |
| TTS / render / upload | NEVER | — |

**Draft-chain mode (`AUDIO_STORY_BATCH_ALLOW_DRAFT_CHAIN=1`):**
- First chapter in the batch still always requires the previous chapter to be approved.
- Subsequent chapters within the same batch accept a previous chapter in `draft`, `pending`, or `reviewed` status.
- `rejected` status is not accepted.
- Memory context for chained draft chapters is supplemented from `story_chapters.chapter_summary` (not yet in `story_memories`).

**Per-chapter quality gates (batch stops on any BLOCKED):**
- Sanitizer must return `READY`
- No `"Chương N"` label in spoken script body
- No chapter title in spoken script body
- Quality checklist (same structural checks as Chapter 1 checklist — applies to any chapter)

**Token/cost tracking:**
- Uses `logApiUsage` from engine (fixed in F4.27a)
- Must run via `pnpm create:story-chapter-batch` (uses `--env-file=.env.local`) for tracking to work
- Tracking rows verified in `api_usage_logs` with `metadata.feature = "audio_story"`

**Generated chapter state:**
- `status: draft`
- `approved: false`
- Requires manual review at `/story-studio/<storyId>/chapters/<N>` before any further generation

**Sequential guard unchanged:**
- UI/Story Studio still requires approval before manual next-chapter generation
- Batch script has its own opt-in draft-chain mode — does not affect UI behavior

**F4.30 — Chapter 4 Ending Rewrite — Cliffhanger Blocker Fixed (2026-06-19):**

Batch run for Ch4–6 stopped at Ch4 because quality checklist scored the chapter ending BLOCKED:
"Kết thúc phẳng — không có lý do đọc tiếp". The ending was a triumphant-resolution scene with 0 cliffhanger keyword signals in the last 400 chars.

**Root cause of false-negative in first rewrite attempt:** LLM returns text in Unicode NFD decomposed form; the quality checklist keyword constants are NFC precomposed. JavaScript `includes()` fails across normalization forms, so `bí ẩn` in the text didn't match `bí ẩn` in the keyword list.

**Fix applied:**
- `scripts/rewrite-audio-story-chapter-ending.ts` (new) — ending-only rewrite script:
  - Loads chapter from DB, splits body at paragraph boundary ~N words from end
  - Sends kept body tail + current ending to LLM with cliffhanger-specific prompt
  - NFC-normalizes LLM output before quality checklist comparison
  - Runs sanitizer + quality checklist; aborts without persisting if any blocker remains
  - Persists only if PASS: `status=draft`, `approved=false`, `quality_check=NULL` (cleared for re-run)
  - Token/cost logged to `api_usage_logs`
- `package.json`: added `rewrite:story-chapter-ending` npm script
- Prompt tightened to require `điện thoại` and `rung`/`tin nhắn` explicitly in last 2 sentences

**Chapter 4 result after rewrite:**
- id=39, title="Phượng Hoàng Lột Xác"
- status=draft, approved=false, quality_check=NULL
- word_count=1192
- Sanitizer: READY
- Quality: PASS (10✓ 0⚠ 0✖)
- Cliffhanger: 5 signals in last 400 chars (không biết, ai đó, rung, tin nhắn, bóng tối)
- New ending: phone message from unknown sender revealing An Hạ's birth mother may still be alive and a hidden power was behind the child-swap all along
- No Chapter 5/6 generated. No TTS/Fal.ai/render/upload/public performed.
- Cost: ~$0.000502 (gemini-2.5-flash, 1467 in / 470 out)

**F4.31 — Controlled Auto-QC + Auto-Approve Mode (2026-06-19):**

Adds a new script for automated text-chapter production. Each chapter passes through four sequential gates before being approved; any failure stops the batch.

**New files:**
- `src/lib/story-studio/auto-approve-validator.ts` — pure (no DB/LLM) `validateAutoApprove()` function; all auto-approve conditions in one testable location
- `scripts/create-audio-story-auto-chapter-batch.ts` — main script; calls the same `checkContinuity` engine function as Story Studio UI
- `scripts/test-audio-story-auto-batch.ts` — 17 unit tests (no DB/LLM): 11 auto-approve conditions, 2 hard-cap tests, 4 gate tests
- `package.json`: `create:story-auto-batch`, `test:story-auto-batch`

**Auto-approve gates (ALL must pass):**
1. Sanitizer status = READY (NFC-normalized)
2. Deterministic quality checklist = PASS (no BLOCKED items)
3. No "Chương N" label leaked into narration body
4. Chapter title not leaked into narration body
5. Continuity QC completed and persisted (`quality_check` + `story_quality_checks` row)
6. Continuity QC `passed = true` (no CRITICAL issues, no quality threshold failure)
7. `AUDIO_STORY_AUTO_APPROVE=1` explicitly set (disabled by default)

**Safety defaults:**
- Auto-approve requires `AUDIO_STORY_AUTO_APPROVE=1` — draft-only mode is the default
- Without the flag, chapters are generated + QC-checked + left as draft (easy manual approval)
- `AUDIO_STORY_STOP_ON_WARNING=1` treats WARNING as a blocker for auto-approve
- Batch stops on first blocker; subsequent chapters not generated
- Manual review UI and existing batch script unmodified
- No TTS, Fal.ai, cover, music, render, package, upload, or publish
- Hard cap 10 chapters per run (same as existing batch)

**Usage:**
```
AUDIO_STORY_ID=<uuid> \
AUDIO_STORY_BATCH_START_CHAPTER=5 \
AUDIO_STORY_BATCH_COUNT=3 \
AUDIO_STORY_AUTO_APPROVE=1 \
pnpm create:story-auto-batch
```

**Without auto-approve (draft + QC run, manual approval still required):**
```
AUDIO_STORY_ID=<uuid> \
AUDIO_STORY_BATCH_START_CHAPTER=5 \
AUDIO_STORY_BATCH_COUNT=3 \
pnpm create:story-auto-batch
```

**F4.32 — Controlled Auto-Repair inside Auto-Batch (2026-06-19):**

When a chapter fails any gate, the batch can now automatically repair it and re-run all gates before stopping. Off by default; requires `AUDIO_STORY_AUTO_REPAIR=1`.

**New file:**
- `src/lib/story-studio/chapter-auto-repair.ts` — pure (no DB/LLM) `classifyBlocker()` and `shouldAttemptRepair()` with `REPAIR_HARD_CAP = 3`

**Repair strategies per blocker:**
| Blocker | Strategy |
|---|---|
| QC provider/parse error | `provider_retry` — no body change, retries QC |
| Sanitizer BLOCKED | `sanitizer_patch` — regex-removes structural artifacts |
| Chapter label / title leaked | `sanitizer_patch` — strips the leaked text |
| Checklist BLOCKED (weak cliffhanger) | `ending_rewrite` — rewrites last ~400 words with cliffhanger focus |
| QC `weak_cliffhanger` only | `ending_rewrite` |
| QC `locked_fact_contradiction` / `character_inconsistency` / `system_rule_violation` | `continuity_repair` — `rewriteChapter()` with QC repair guidance + locked facts |
| Other QC failure | `continuity_repair` |

**Repair loop behavior:**
1. Each iteration: re-sanitize (if repaired) → checklist → leak check → QC → approve decision
2. On failure: `classifyBlocker` → `shouldAttemptRepair` → apply repair → persist to DB (clears `quality_check = NULL`) → repeat
3. Approve only after ALL gates pass in the same iteration AND `AUDIO_STORY_AUTO_APPROVE=1`
4. Attempt log printed after all repairs (init + each repair strategy/result)
5. Batch stops after repair attempts exhausted or unfixable blocker

**Safety constraints (never relaxed):**
- `AUDIO_STORY_AUTO_REPAIR=1` must be explicit — off by default
- `REPAIR_MAX_ATTEMPTS` default 2, hard cap 3 (`REPAIR_HARD_CAP`)
- QC gates are never weakened — all criticals still cause failure
- No TTS, Fal.ai, render, upload, or publish at any stage
- Locked facts are never deleted — repair adds clarifying context

**Usage with repair:**
```
AUDIO_STORY_ID=<uuid> \
AUDIO_STORY_BATCH_START_CHAPTER=5 \
AUDIO_STORY_BATCH_COUNT=5 \
AUDIO_STORY_AUTO_APPROVE=1 \
AUDIO_STORY_AUTO_REPAIR=1 \
AUDIO_STORY_REPAIR_MAX_ATTEMPTS=2 \
pnpm create:story-auto-batch
```

**Backlog notes before later production automation:**
- `F4.33 — Chapter Brief + Outline QC`: add stricter per-chapter brief validation before generation so chapter-level body audio is built from cleaner approved material.
- `F4.34 — Story Memory Type + Stale Thread Resolution`: strengthen memory typing and stale thread cleanup so downstream reusable chapter audio does not preserve avoidable continuity drift.

**F4.35 — Reusable Chapter Audio Asset Architecture (2026-06-19):**

Implemented as a narrow architecture/test pass only.

- No chapter generation
- No TTS execution
- No Fal.ai call
- No cover/music/render/package/upload/public action

**Canonical chapter spoken body:**
- `src/lib/audio-story/narration-script-sanitizer.ts`
- `buildCanonicalChapterBodyScript()` is now the single body-only source of truth for chapter narration text.
- It removes:
  - Tee Audio intro
  - episode/full-story outro strings
  - `Văn án`
  - chapter labels such as `Chương N`
  - chapter title/headings
- The stable body hash is `chapterBodyScriptHash`.

**Reusable asset roles:**
- Chapter narration asset pattern:
  - `media/story-audio/<storyId>/chapters/chapter-001.body.wav`
- Shared intro asset:
  - `media/story-audio/assets/tee-intro.wav`
- Shared episode outro asset:
  - `media/story-audio/assets/tee-outro-episode.wav`
- Shared full-story outro asset:
  - `media/story-audio/assets/tee-outro-full-story.wav`
- This phase defines pathing + manifest behavior only; it does not synthesize these files yet.

**Assembly / concat architecture:**
- `src/lib/audio-story/chapter-audio-assembly.ts`
- Episode/full-story spoken outputs are now modeled as ordered assembly manifests built from:
  - intro asset
  - silence segments
  - reusable chapter body assets in order
  - episode or full-story outro asset
- The assembly layer is concat-oriented and is explicitly separate from chapter-body TTS.
- Synopsis/văn án is metadata only and never part of chapter-body TTS or assembly spoken preview.

**Hash/cache behavior:**
- Chapter-body TTS identity is based on the canonical body-only script hash.
- Assembly identity is based on:
  - ordered chapter body hashes / asset paths
  - intro/outro asset hashes
  - pause durations
  - assembly mode (`episode` vs `full_story`)
- Intro/outro changes should invalidate only downstream assembly/render outputs, not reusable chapter-body TTS.

**Story Studio preview behavior:**
- Chapter page preview now shows body-only narration text and body hash.
- Episode page preview now shows an assembly preview:
  - intro exactly once
  - all chapter body segments in order
  - outro exactly once
  - ordered manifest rows for silence + reusable asset roles
- The spoken preview used for episode planning no longer includes synopsis/văn án.

**F4.36 — Episode Audio Manifest Smoke Test (2026-06-20):**

- Added a live smoke script for `Phượng Hoàng Trở Lại` episode assembly validation:
  - `scripts/smoke-audio-story-episode-assembly.ts`
  - `pnpm smoke:story-episode-assembly`
- The smoke path loads approved chapters from a requested range (default `Ch.1–9`) and verifies:
  - canonical body-only chapter scripts
  - reusable chapter audio asset paths
  - intro/outro counts and silence layout
  - stable `assemblyHash` across identical builds
  - synopsis/văn án absence in chapter bodies and episode assembly spoken preview
- `test:audio-story-assembly` (`scripts/test-audio-story-assembly.ts`) added as a package.json script — pure unit coverage (no DB) for missing-chapter, unapproved-chapter, contamination, hash-stability, and pause-only-changes-assembly-hash cases.
- Fixed a type-safety gap in `AudioAssemblySegment` (`chapter-audio-assembly.ts`) where the asset-kind `assetRole` union excluded `"chapter_body"`, and added a proper `isAssetSegment` type guard in `episode-assembly-smoke.ts` so `.filter()` narrows correctly. No runtime/behavior change — `assemblyHash` is identical before and after the fix.
- Live run result against `Phượng Hoàng Trở Lại` (`20f30412-102b-4bae-a279-2ddb25b509eb`), Ch.1–9: all 9 chapters approved, all contamination checks PASS, intro ×1, episode outro ×1, full-story outro ×0, 9 chapter body segments in order, 10 silence segments, `assemblyHash` stable across two builds.
- This phase does not run TTS, render, upload package, upload, or publish.

**F4.37 — Body-only Chapter TTS Dry Run + Gated Real TTS (2026-06-20):**

- Added a chapter-level TTS planning + gated-execution script:
  - `scripts/tts-audio-story-chapters.ts`
  - `pnpm plan:story-chapter-tts` and `pnpm run:story-chapter-tts` (same underlying script — the only thing that gates real synthesis is the `AUDIO_STORY_RUN_TTS=1` env var, not the package script name)
- **Chapter TTS is body-only.** It uses the same `buildCanonicalChapterBodyScript()` / `chapterBodyScriptHash` from F4.35 — no Tee Audio intro, no episode/full-story outro, no synopsis/văn án, no chapter label/title. Intro/outro asset synthesis and episode/full-story assembly (ffmpeg concat) remain separate, later phases — this pass only produces reusable per-chapter body WAVs.
- **Dry run is the default.** Real TTS requires the explicit `AUDIO_STORY_RUN_TTS=1` flag. Without it, the script builds the plan, prints the table, performs read-only provider/voice detection (`checkAvailability()` + `listVoices()` — no `synthesize()` call), and exits — no audio is generated.
- New pure planning module `src/lib/audio-story/chapter-tts-plan.ts` (no DB/fs/provider imports, fully unit-testable):
  - `validateChapterTtsRangeParams()` — hard cap `12` chapters/run, configurable `AUDIO_STORY_TTS_MAX_CHAPTERS_PER_RUN` (default `9`), mirrors the reject-don't-clamp convention from `batch-generation-validator.ts`
  - `checkChapterBodyContamination()` — same contamination rules as F4.36's episode-assembly-smoke, scoped to one chapter body
  - `buildChapterTtsPlan()` — per-chapter status: `CACHE_HIT` (existing asset hash matches) / `NEEDS_TTS` (no asset yet) / `STALE` (hash mismatch) / `FORCE_REGEN` (`AUDIO_STORY_TTS_FORCE=1`); planned action `SKIP` or `TTS_BODY_ONLY`
  - `executeChapterTtsPlan()` — the single choke point that calls the injected `synthesizeChapter` callback; only invoked when `runTts=true`, and only for `TTS_BODY_ONLY` rows (never for `SKIP`) — this is what guarantees dry runs never reach the provider
- Existing-asset detection is filesystem-based, not a DB table: a sidecar `chapter-NNN.body.json` metadata file (written next to the `.wav`) stores `chapterBodyScriptHash` for the cache-hit/stale comparison — `src/lib/audio-story/chapter-tts-fs.ts`.
- Real synthesis (only when `AUDIO_STORY_RUN_TTS=1`) lives in `src/lib/audio-story/chapter-tts-runner.ts`, reusing the existing `getTTSProvider` / `resolveVoiceForProvider` / `normalizeAudioWithLoudnorm` primitives (same loudnorm-without-silenceremove convention as episode TTS). Chapter-body assets are synthesized without SRT for now — per-chapter subtitle timing across concatenated body+intro+outro audio is part of the later assembly phase, not this one.
- Optional env overrides: `AUDIO_STORY_TTS_PROVIDER`, `AUDIO_STORY_TTS_VOICE` (take precedence over saved Audio Story settings for this script only).
- Safety: stops (exit 1) before any provider call on missing chapter, unapproved chapter, chapter-body contamination, or range exceeding the hard cap; stops before real synthesis if provider config is unavailable when `AUDIO_STORY_RUN_TTS=1`.
- `test:audio-story-chapter-tts-plan` (`scripts/test-audio-story-chapter-tts-plan.ts`) — pure unit coverage: missing/unapproved/contamination blocks, cache-hit skip, force-regen override, hash stability across builds, intro/outro text changes proven not to affect the chapter body hash, and dry-run-never-calls-synthesize / real-run-only-calls-for-non-skip-rows via injected callback.
- Live dry-run result against `Phượng Hoàng Trở Lại` (`20f30412-102b-4bae-a279-2ddb25b509eb`), Ch.1–9: all 9 chapters `NEEDS_TTS` (no chapter audio exists yet), all contamination PASS, provider detection resolved `aimax` / `hn_female_ngochuyen_full_24k-st` (Ngọc Huyền 24k), all 9 `chapterBodyScriptHash` values identical to the F4.36 smoke-test run.
- No real TTS was executed in this phase. No intro/outro audio. No episode assembly. No render/upload/public action.
- **Follow-up real run (2026-06-20):** real gated TTS executed once for the full Ch.1–9 range (`AUDIO_STORY_RUN_TTS=1`). All 9 chapter body WAVs + sidecar JSON generated successfully (~50.3 min total). Re-running the dry-run plan afterward showed all 9 chapters as `CACHE_HIT`/`SKIP` with identical hashes — confirms the cache-hit detection round-trips correctly through the sidecar metadata files.

**F4.38 — Intro/Outro Audio Assets + Episode Audio Assembly Preview (2026-06-20):**

- Two new scripts, both dry-run by default:
  - `scripts/prepare-audio-story-intro-outro-assets.ts` → `pnpm prepare:story-intro-outro-audio` (plans/generates the shared intro + episode-outro assets)
  - `scripts/assemble-audio-story-episode-preview.ts` → `pnpm assemble:story-episode-audio-preview` (concatenates existing assets into a local preview WAV — never calls a TTS provider)
- **Intro/outro assets are reusable and story-independent**, not story-scoped: `media/story-audio/assets/tee-intro.wav` and `media/story-audio/assets/tee-outro-episode.wav` are the same files for every story, per `getAudioStoryRoleAssetRef()` (F4.35). `AUDIO_STORY_ID` is accepted only for log context, not for path scoping.
- New pure planning module `src/lib/audio-story/intro-outro-plan.ts` mirrors `chapter-tts-plan.ts`'s design exactly: `CACHE_HIT`/`NEEDS_TTS`/`STALE`/`FORCE_REGEN` status, `SKIP`/`TTS_ASSET` planned action, and the same single-choke-point `executeIntroOutroPlan()` that guarantees dry runs never call `provider.synthesize()`.
  - Cache identity is `buildIntroOutroContentHash()` — hashes spoken-text-hash **plus** provider/voice/speed/pitch/volume/language, so a voice/provider change invalidates the cache even when the intro/outro text itself hasn't changed.
  - Sidecar `tee-intro.json` / `tee-outro-episode.json` (written by `src/lib/audio-story/intro-outro-assets-fs.ts`) store both `contentHash` (cache-hit key) and `spokenTextHash` (text-only, used by the assembly safety check below).
  - Real synthesis (`src/lib/audio-story/intro-outro-runner.ts`) reuses the exact same `resolveChapterTtsProviderAndVoice()` from F4.37's chapter-tts-runner — intro/outro use the same Audio Story provider/voice defaults as chapter body TTS unless explicitly overridden via `AUDIO_STORY_TTS_PROVIDER` / `AUDIO_STORY_TTS_VOICE`.
- **Episode preview assembly uses only existing body-only chapter WAVs and existing intro/outro WAVs — it never re-synthesizes anything.** Implemented as a pure safety-check module `src/lib/audio-story/episode-audio-preview.ts` (`buildEpisodePreviewCheck()`) that walks the F4.35/F4.36 assembly manifest and, for every asset segment, verifies the file exists on disk and its sidecar hash matches the manifest's canonical hash — stopping (no concat) on any missing file or hash mismatch. Expected duration is computed from **real measured** per-asset durations (chapter body + intro + outro sidecar `durationSec` fields), not word-count estimates.
- FFmpeg concat (`src/lib/audio-story/episode-audio-concat.ts`): builds one `filter_complex` graph with one `-i` input per audio file plus `aevalsrc`-generated silence segments (no separate silence files), `aformat`-normalizes every file input to 48kHz mono before the `concat` filter (a faithful pass-through since every input was already produced via `normalizeAudioWithLoudnorm` at that same format), and reports a clear error if FFmpeg itself is unavailable. Output duration is probed and compared against the expected sum with a 2-second tolerance; out-of-tolerance output fails before sidecar metadata is written.
- Episode preview output: `media/story-audio/<storyId>/episodes/episode-{episodeNumber}-ch{start}-ch{end}.preview.wav` + sidecar `.preview.json` (assemblyHash, intro/outro asset hash+path, per-chapter asset hash+path, pause durations, output path, measured durationSec, timestamps). Existing output is preserved unless `AUDIO_STORY_FORCE=1` or the file is missing.
- **No background music in this phase** — concatenation is narration + silence + intro/outro only; music mixing remains a later phase.
- `test:audio-story-intro-outro-plan` and `test:audio-story-episode-preview` — pure unit coverage: missing-intro/outro blocks, missing-chapter-audio blocks, hash-mismatch blocks, duration estimate correctly sums intro+outro+silences+chapters, voice/provider config change invalidates cache even with unchanged text, force-regen override, dry-run-never-calls-synthesize, real-run-only-calls-non-skip-rows, and manifest chapter-body assets all resolve to `/chapters/*.body.wav` paths.
- Live run result against `Phượng Hoàng Trở Lại` (`20f30412-102b-4bae-a279-2ddb25b509eb`), Ch.1–9: intro (2.85s) + episode outro (6.20s) generated once via gated real TTS, then confirmed `CACHE_HIT` on re-plan. Episode preview assembled: 21 segments, `assemblyHash = d336628f98d4e243034a1ad815cad83ed83a0661673fb7432fa8dda661589103` (identical to the F4.36 smoke-test value), actual duration 3035.76s vs expected 3035.76s (delta 0.000s). All 9 chapter body assets reused unchanged from F4.37 — zero chapter re-TTS.
- This phase does not render video, does not mix background music, does not package/upload, and does not change any publish/visibility state.

**F4.38.5 — TTS Artifact Audit + Playability Check (2026-06-20):**

- The operator reported never having heard any TTS output and asked for the artifacts to be verified directly, not assumed from F4.37/F4.38 session logs. This pass is read-only: no TTS, no Fal.ai, no render, no upload/public, no chapter prose edit.
- New script `scripts/audit-audio-story-tts-artifacts.ts` → `pnpm audit:story-tts-artifacts`. Checks, for each of the 9 chapter body WAVs, the 2 shared intro/outro WAVs, and the episode preview WAV:
  - file exists and is non-empty
  - sidecar `.json` exists, parses, and contains the expected identity fields (`storyId`/`chapterNumber`/`chapterBodyScriptHash`/`provider`/`voiceId`/`durationSec` for chapters; `spokenTextHash`/`provider`/`voiceId`/`durationSec` for intro/outro; `assemblyHash`/`durationSec` for the episode preview)
  - audio is actually readable (codec/sample-rate/channel-count + duration), and that probed duration matches the sidecar duration within 2 seconds
- **Finding: `ffprobe` is not installed on this machine** (no binary on `PATH`, no `ffprobe-static` npm package, not in any common install path). This silently affected F4.16's local-render-preview duration probing too (it already degrades to `durationSec = null` with a warning) but had never been investigated as a standalone gap.
  - New module `src/lib/audio-story/audio-file-probe.ts` resolves `ffprobe` the same way as `story-local-render-preview.ts`, and when it isn't resolvable, falls back to parsing `ffmpeg -i <file> -f null -`'s own stderr output for `Duration:` and the `Stream #0:0: Audio: ...` line — the exact technique `tts.ts`'s `getAudioDurationSec()` already uses elsewhere in this codebase. This gives full duration + codec + sample-rate + channel-count readback using only the `@ffmpeg-installer/ffmpeg` npm package already present, with no new system dependency.
- **Result: all 12 artifacts PASS** — every chapter body WAV, both intro/outro WAVs, and the episode preview WAV exist, are non-empty, are `pcm_s16le, 48000 Hz, mono`, and have a probed duration matching their sidecar `durationSec` exactly. Total chapter audio: 3017.92s (~50.3 min). Episode preview: 3035.76s (~50.6 min), `assemblyHash` identical to the F4.36/F4.38 value.
- **UI exposure gap confirmed.** Story Studio's only `<audio>` player (`episodes-client.tsx`) is bound to a `storyAudioAssets` DB row via `/api/story-audio-assets/[assetId]/stream`. The F4.37 chapter-body, F4.38 intro/outro, and episode-preview artifacts are pure filesystem + sidecar JSON with no corresponding DB row, so that route/player cannot serve them — confirmed by grepping the entire `src/app`/`src/components`/`src/actions` tree for any reference to the new file-based modules (zero matches). **Overall result: WARNING** (files valid, but operator cannot play them from the UI yet).
- A 20-second sample clip was created for quick manual listening (first 20s of the episode preview, which starts with the Tee Audio intro line): `media/story-audio/<storyId>/episodes/episode-001-ch001-ch009.sample-20s.wav` (lossless `-c copy` trim, no re-TTS, no upload).
- Recommended next small task (not built in this pass): a minimal local-only Story Studio UI surface (or a dedicated `/api/story-audio-file` static-serving route restricted to `media/story-audio/**`) that lets the operator browse/play the F4.37/F4.38 file-based artifacts without needing a DB row — out of scope for this audit-only pass.

**F4.38.6 — Story Studio Local Audio Preview UI (2026-06-20):**

- Closes the F4.38.5 UI exposure gap: file-based Audio Story TTS artifacts (chapter body WAVs, intro/outro WAVs, episode preview WAV, 20s sample) are now playable/downloadable directly from `/story-studio/[storyId]/episodes` — **local preview only, not upload/public.**
- New read-only discovery helper `src/lib/audio-story/local-audio-artifacts.ts` (`discoverLocalAudioArtifacts()`): scans the known F4.37/F4.38 paths for one story (chapter bodies 1–9, shared intro/outro, episode preview, 20s sample) and returns label/kind/size/duration/sidecar-presence/exists for each — never an absolute filesystem path, only a `streamPath` relative to `media/story-audio/`.
- New streaming route `src/app/api/story-audio-local/[...path]/route.ts`, scoped strictly to `media/story-audio/`:
  - rejects any path segment containing `..`, `/`, or `\` before even joining
  - re-validates the joined+normalized path doesn't escape the root, then re-checks the final absolute path is still inside the root (defense in depth)
  - allows only `.wav` (the only format these artifacts are ever written in)
  - 404 for missing files, 403 for path/extension violations, never echoes an absolute path in any response
  - streams via `fs.createReadStream` (not buffered into memory — the episode preview is ~278 MB) with byte-range support for `<audio>` seek/scrub
  - the core path-safety logic is extracted into a pure, unit-tested module `src/lib/audio-story/local-audio-route-safety.ts` (`resolveSafeStoryAudioPath()`)
  - added to `proxy.ts`'s `PUBLIC_PATHS` (same rationale as the existing `/api/story-audio-assets` and `/api/tts/stream` entries — `<audio>` elements don't reliably forward session cookies; admin UI access already requires auth)
- Story Studio episodes page (`episodes-client.tsx`) gained a new "Xem trước Audio cục bộ (Local)" section, shown only when `anyExists` is true: the 20s sample and full episode preview (with duration, file size, `<audio controls>`, and a download link) always visible at the top, intro/outro side by side below, and a collapsible "Audio từng chương" list for the 9 chapter body WAVs. The section explicitly states these are local files, not uploaded/public assets. The existing `storyAudioAssets`-DB-backed player (episode-level TTS from F4.0–F4.2) is untouched and still works exactly as before.
- New tests `scripts/test-audio-story-local-audio-preview.ts` (`pnpm test:audio-story-local-audio-preview`): pure path-safety tests (traversal segments, smuggled slashes, wrong extension, empty path, never leaks an absolute path on rejection) plus a real-fs smoke check confirming discovery finds all 12 known artifacts for the existing story and that every `streamPath` round-trips safely through the route's own safety check.
- Live-verified against the actual running dev server (not a synthetic test): `GET /api/story-audio-local/.../tee-intro.wav` → 200 with `audio/wav` + `Accept-Ranges: bytes`; a `Range: bytes=0-1023` request → 206 with correct `Content-Range`; a traversal attempt → 400; a `.json` sidecar request → 403; a missing chapter file → 404.
- This phase does not run TTS, call Fal.ai, render video, mix background music, or package/upload/publish anything.

**F4.38.7 — Văn án Intro Update + Background Music Mix + Local Video Render (2026-06-20):**

- **Intro now includes "Văn án."** `AUDIO_STORY_FIXED_INTRO` (`narration-script-sanitizer.ts`) changed permanently from `"Tee Audio chào các bạn, chúc các bạn nghe truyện vui vẻ."` to `"Tee Audio chào các bạn, chúc các bạn nghe truyện vui vẻ. Văn án."` — applies to every story's default intro going forward, not just this one.
- **Post-intro pause is now 1.0s** (was 1.2s) — `AUDIO_STORY_DEFAULT_INTRO_PAUSE_SEC` in `chapter-audio-assembly.ts` changed from `1.2` to `1.0`. Chapter-to-chapter (`0.8s`) and pre-outro (`1.2s`) pauses are unchanged. This is a global default change (not a one-off override) so every code path that builds an assembly manifest — Story Studio's spoken-preview, the episode-assembly smoke check, and the actual render — stays self-consistent on the same `assemblyHash`.
- **Contamination-check recalibration (real bug fixed, not weakened):** `episode-assembly-smoke.ts`'s "Văn án must be absent" checks previously tested a boolean (`/văn án/.test(...)`) against the *entire* spoken script. Once the intro legitimately contains "Văn án.", that boolean is always true — a false-positive contamination failure on every story. Fixed to count occurrences: the intro's own contribution is the baseline: if "văn án" appears strictly more times than the intro alone contributes, instead, the chapter/outro is correctly flagged. The per-chapter-body contamination check (`chapter-tts-plan.ts`'s `checkChapterBodyContamination`) is untouched — chapter bodies must still never contain "Văn án" or a synopsis paragraph.
- Re-generated **only the intro asset** via real gated TTS (`AUDIO_STORY_RUN_TTS=1`): intro went `STALE` → regenerated (3.64s); outro stayed `CACHE_HIT`; all 9 chapter body WAVs stayed `CACHE_HIT` (verified by file mtimes — zero re-TTS).
- Reassembled the episode preview WAV (`AUDIO_STORY_FORCE=1`, since intro content changed): new `assemblyHash`, duration 3036.35s (+0.59s vs the prior 3035.76s — exactly accounted for by the longer intro plus the shorter pause).
- **Background music:** new modules `episode-audio-mix.ts` (`mixNarrationWithBackgroundMusic()`) reuse the already-existing, already-tested `buildAudioStoryMusicFfmpegArgs()` from `story-background-music.ts` — no new mixing logic, just the ffmpeg execution wrapper + path convention (`episode-{N}-ch{s}-ch{e}.mixed.wav`). New script `scripts/mix-audio-story-background-music.ts` (`pnpm mix:story-episode-background-music`) resolves the track by **exact title** from the existing `music_tracks` DB table (not a new download, not Fal.ai) — refuses to guess if zero or multiple exact matches exist. Track used: **"Điều Gì Làm Nên Một Tuổi Thơ Đáng Nhớ"** (`media/music/phat-phap/2f863262-caee-4cbc-96a6-da8678a37e0e.mp3`, pre-existing pipeline asset). Mix settings: `-30dB`, fade-in `2s`, fade-out `3s`, looped — the exact `AUDIO_STORY_MUSIC_RECOMMENDED` defaults already defined for Audio Story. Output duration always equals narration duration (`amix duration=first`) — narration remains dominant by construction, not just by volume.
- **Local video render:** new modules `local-episode-cover.ts` (Fal.ai-free SVG+Sharp placeholder cover, reused only when no real cover already exists under `media/story-covers/<storyId>/`) and `episode-video-render.ts` (ffmpeg `-loop 1` cover + mixed audio, same hardware/software encoder fallback pattern as `story-local-render-preview.ts`). New script `scripts/render-audio-story-episode-preview-video.ts` (`pnpm render:story-episode-preview-video`) — output `media/story-renders/<storyId>/episode-001-ch001-ch009.preview.mp4`, 1920×1080 h264/AAC, duration 3036.88s (within 2s tolerance of the mixed audio).
- **No Fal.ai call was made** — the placeholder cover path was used since no real cover existed for this story; Fal.ai remains reserved for premium cover generation, untouched in this pass.
- **Story Studio UI extended further:** `discoverLocalAudioArtifacts()` now also returns `episodeMixed` and `episodePreviewVideo`; the episodes page shows the rendered video (`<video controls>`) and the mixed-with-music audio above the narration-only preview. A second local-only streaming route, `/api/story-render-local/[...path]`, serves the MP4 (scoped to `media/story-renders/`, `.mp4` only) — the path-safety core was generalized into a single shared, unit-tested resolver (`resolveSafeLocalMediaPath()` in `local-audio-route-safety.ts`) used by both the audio and video routes, and the byte-range streaming logic was extracted into a shared `local-media-stream.ts` so a fix to one route's streaming is a fix to both.
- `audit-audio-story-tts-artifacts.ts` extended to also probe the mixed audio and rendered video (renamed its internal `auditWavFile` → `auditMediaFile` since it now audits non-WAV files too), and its previously-stale "UI exposure: NOT exposed" finding is corrected to reflect F4.38.6's UI work — **overall audit result is now PASS** (all 14 artifacts valid, UI exposed).
- This phase does not call Fal.ai for new artwork, does not upload, does not publish, and does not change any YouTube visibility.

**F4.40 — Premium Manhua Cover Visual + Re-render (2026-06-20):**

- **Post-intro pause shortened to 0.6s** (was 1.0s, set in F4.38.7). `AUDIO_STORY_DEFAULT_INTRO_PAUSE_SEC` in `chapter-audio-assembly.ts` changed `1.0` → `0.6` — global default, so every manifest-building call site stays consistent on one `assemblyHash`. Inter-chapter (`0.8s`) and pre-outro (`1.2s`) pauses unchanged. Operator feedback: the prior gap between "Văn án." and Chapter 1 felt too long.
- **No intro re-TTS needed** — pause is a manifest/assembly-time parameter, not part of the intro asset's own TTS content/hash. Re-confirmed via `prepare:story-intro-outro-audio`: both intro and outro stayed `CACHE_HIT`. Chapters 1–9 also confirmed `CACHE_HIT` 9/9 (mtimes unchanged, verified via `stat`).
- Reassembled the narration-only episode preview (new `assemblyHash`, duration 3035.95s — exactly −0.40s vs the prior 3036.35s, matching the 0.4s pause reduction) and re-mixed with the same accepted track ("Điều Gì Làm Nên Một Tuổi Thơ Đáng Nhớ", −30dB, fade-in 2s, fade-out 3s, looped) — no track change, no settings change, just re-run against the updated narration.
- **Premium manhua/manhwa cover replaces the placeholder.** New script `scripts/generate-audio-story-premium-cover.ts` (`pnpm generate:story-premium-cover`) is a two-stage pipeline mirroring `story-cover-generator.ts`'s existing design but decoupled from the DB-row-coupled `story_episodes` table (the file-based F4.37+ pipeline has no such row to key off):
  1. **Fal.ai artwork only** — calls the already-configured premium route (`fal` / `fal-ai/flux-pro/v1.1-ultra`, confirmed pre-existing in `audio_story.cover_image_*` settings) via the existing `buildAudioStoryCoverPrompt()` (style preset `tee_audio_manhua_romance`: cold elegant heiress female lead, luxury revenge mood, cinematic lighting — already matches the requested direction exactly). The prompt and negative prompt explicitly forbid rendered text/letters/watermarks — this is the **only** network/paid call in the script, and the script **stops and reports the blocker** if `FAL_KEY` or a premium model isn't configured, rather than silently falling back to the placeholder.
  2. **Local composite only** — new `compositePremiumEpisodeCover()` in `local-episode-cover.ts` adds the Vietnamese title ("Phượng Hoàng Trở Lại"), episode label ("Tập 1 • Ch.1–9"), small label ("Audio Truyện"), and Tee Audio logo via local SVG+Sharp — never AI-generated text. Layout: bottom-left text block over a dark gradient (title large but left-biased so it never covers the character's face, which the Fal.ai prompt already weights center-right), small Tee Audio logo top-right, full-width dark band at the very bottom.
  3. **Real-world finding:** despite the negative prompt, the diffusion model hallucinated small faux-watermark glyphs in both bottom corners (a known diffusion-model quirk). Fixed by widening the bottom overlay to a full-width opaque band rather than re-rolling generation — robust against this artifact regardless of which corner it lands in, and reads as a clean premium vignette either way.
  4. **Idempotent and cost-safe:** re-running without `AUDIO_STORY_FORCE_ARTWORK=1` reuses the existing downloaded artwork and only re-composites locally — confirmed by a real second run that recomposited (to fix the watermark issue) without any additional Fal.ai call. The superseded placeholder file is deleted so the render script's cover-discovery (`*-cover.jpg` glob) never has an ambiguous choice between two candidates.
  - Outputs: `media/story-covers/<storyId>/episode-001-ch001-ch009-artwork.jpg` (raw Fal.ai output), `...-cover.jpg` (final composited cover), `...-cover.json` (sidecar metadata: provider/model/prompt/paths).
  - `isPremiumConfigured()` and `PREMIUM_FAL_MODELS` exported from `story-cover-generator.ts` for reuse instead of duplicating the premium-model allowlist logic.
- Re-rendered the local video preview (same path, `AUDIO_STORY_FORCE=1`) with the updated mixed audio + new premium cover: 1920×1080, h264 High/AAC 48kHz mono, duration 3036.48s (within 2s tolerance of the 3035.95s mixed audio).
- Full artifact audit (`audit:story-tts-artifacts`) re-run: **all 14 artifacts PASS**, UI exposed. Story Studio's local preview routes (`/api/story-audio-local`, `/api/story-render-local`) live-verified serving the updated files at their unchanged paths — no UI/discovery code changes were needed since paths stayed the same.
- This phase does not generate new chapters, does not modify chapter prose, does not re-TTS chapters or outro, does not upload, does not publish, and does not change YouTube visibility. Fal.ai was called exactly once (for the artwork only, no text/audio).

**F4.42 — Tee Audio YouTube Metadata Template (2026-06-20):**

- The first manual-review upload of episode 1 (video `3BUIlEP5LRI`) used ad hoc title/description/tags with "manhua/manhwa" wording — visual-style wording, not Tee Audio's actual ngôn tình SEO motif.
- Added a reusable, pure (no DB/network) metadata template: `buildAudioStoryYouTubeMetadata()` in `src/lib/audio-story/youtube-metadata-template.ts`. Produces the Tee Audio house style: top hashtags (`#ngôntìnhhaynhất #ngôntìnhhay #hiendai`), follow CTA, donation/TikTok block, story metadata lines (`💫Truyện/TÁC GIẢ/Thể loại`), episode line, short hook description, and a deterministic bottom hashtag line built from a canonical genre→hashtag map (`mapGenreToHashtag`) — `ngôn tình` is excluded from the variable hashtags/tags since it's already in the fixed footer. A parallel `mapGenreToTag` covers the tags list. Never emits "manhua"/"manhwa".
- `scripts/upload-audio-story-episode-youtube.ts` now builds its upload metadata from this template instead of hardcoded manhua/manhwa text, so future episode uploads default to the correct house style.
- Unit-tested in `scripts/test-audio-story-youtube-metadata-template.ts` (`pnpm test:audio-story-youtube-metadata-template`) — covers exact title/description/tag reproduction, genre mapping, slug helpers, and an explicit "no manhua/manhwa" assertion.
- Fixed video `3BUIlEP5LRI`'s live metadata via new `scripts/update-audio-story-episode-youtube-metadata.ts` (`pnpm update:story-episode-youtube-metadata`), using a new snippet-only `updateYouTubeVideoMetadata()` helper added to `src/lib/social/youtube-api.ts`. Title/description/tags now match the Tee Audio house style; persisted to `story_upload_packages` (title/description/tagsJson) and `story_manual_upload_validations.validatedAt`.
- Operator note / known issue: the live video's visibility was found to have drifted from `unlisted` (at original upload) to `public` outside of this pipeline (likely a manual YouTube Studio edit). Per explicit task scope, this metadata-fix script does not touch visibility — it only reports the mismatch. Reverting it to `unlisted` (or confirming `public` is intentional) requires a separate, explicitly-authorized action.
- No re-upload, no thumbnail change, no category change, no Fal.ai, no TTS, no render performed.

**F4.41 / F4.42 — One-command production runner + production state sync (2026-06-20):**

- Added the canonical file-based artifact resolver: `src/lib/audio-story/episode-production-artifacts.ts`.
  It resolves, for one story + episode number + chapter range:
  - approved/locked chapters in range
  - reusable chapter body WAVs
  - shared intro/outro assets
  - narration-only episode WAV
  - mixed episode WAV
  - premium artwork/final cover
  - local rendered MP4
  - Tee Audio metadata motif preview
  - upload package / manual upload validation / uploaded YouTube URL history when an episode row already exists
- Added the one-command runner: `scripts/produce-audio-story-episode.ts` with package script `pnpm produce:story-episode`.
  - Dry-run by default.
  - Required inputs: `AUDIO_STORY_ID`, `AUDIO_STORY_START_CHAPTER`, `AUDIO_STORY_END_CHAPTER`, `AUDIO_STORY_EPISODE_NUMBER`.
  - Real local execution requires `AUDIO_STORY_PRODUCE_EXECUTE=1`.
  - Real YouTube upload remains separately gated behind `AUDIO_STORY_UPLOAD_UNLISTED_EXECUTE=1`.
  - Public upload remains intentionally blocked; `AUDIO_STORY_PUBLIC_EXECUTE=1` is rejected.
- Story Studio production-state sync now prefers real file-based episode artifacts when they exist:
  - Creative Review Gate can pass/reuse file-based mixed audio, final cover, rendered video, upload package, and upload validation history even when no matching DB-row-style `story_audio_assets` / `story_video_assets` were created for that chapter range.
  - Local Render Preview can surface an already-existing file-based render as reusable history instead of acting like no render exists.
  - Missing SRT is now a **warning, not a blocker**, when Audio Story is explicitly running in no-SRT mode (`audio_story.enable_srt = false`).
- The Tee Audio metadata motif remains reusable at `src/lib/audio-story/youtube-metadata-template.ts`.
  - Title: `{{STORY_TITLE}} Tập {{EPISODE_NUMBER}} | Truyện Audio {{MAIN_GENRE_KEYWORDS}}`
  - Description: top hashtags, follow CTA, Tee Audio support block, story/author/genre lines, episode label, short hook, and a deterministic footer hashtag line.
  - Default output never emits `manhua` / `manhwa`.
- Dry-run verification target for the current successful episode:
  - story id `20f30412-102b-4bae-a279-2ddb25b509eb`
  - `Phượng Hoàng Trở Lại`
  - Episode 1, Ch.1–9
  - Expected dry-run outcome: chapter audio/mixed audio/final cover/final video/upload history all recognized as reusable; no regeneration and no re-upload.
- Upload remains unlisted by default. Public remains a separate explicit future gate.
- This phase does not, by itself, run TTS, call Fal.ai, render, update the current YouTube metadata, re-upload the current episode, or make anything public during dry-run verification.

**F4.43 — Episode Freeze + Music Production Sync (2026-06-20):**

- No new schema or migration was added in this pass. The existing `story_episodes` row is reused as the canonical episode-level freeze anchor (`approved`, `locked`, `status`, `chapter_ids_json`, `script_text`, `word_count`, `estimated_duration_min`), and a file-based production snapshot is stored next to the episode audio artifacts:
  - `media/story-audio/<storyId>/episodes/episode-001-ch001-ch009.production-state.json`
- The production snapshot records:
  - story / episode / chapter range
  - included chapter IDs
  - per-chapter approved-content hashes
  - metadata hash
  - episode assembly hash
  - cover / mixed-audio / video paths and stable hashes
  - freeze status
  - synced production music selection
- Added `scripts/sync-audio-story-production-state.ts` with package script `pnpm sync:story-production-state`.
  - Dry-run by default.
  - Real sync only with `AUDIO_STORY_SYNC_EXECUTE=1`.
  - Reads existing production artifacts, syncs the freeze snapshot, and records the production music state from the existing mixed-audio sidecar.
  - Does not generate chapters, run TTS, render video, call Fal.ai, upload, change YouTube metadata, or public anything.
- Current Episode 1 (`Phượng Hoàng Trở Lại`, Ch.1–9) is now synced as:
  - `approved 9/9`
  - `episode range frozen`
  - production music synced from the historical mixed audio:
    - track: `Điều Gì Làm Nên Một Tuổi Thơ Đáng Nhớ`
    - path: `media/music/phat-phap/2f863262-caee-4cbc-96a6-da8678a37e0e.mp3`
    - volume: `-30dB`
    - fade-in: `2s`
    - fade-out: `3s`
    - loop: `true`
    - license/status: `production_confirmed`
- Runner dry-run now reports `9/9 approved · episode range frozen · production synced` and still reuses the existing preview audio, mixed audio, cover, video, and unlisted upload history without regenerating or re-uploading anything.
- Story Studio gate wording/readiness now respects episode-level freeze:
  - frozen production episode ranges no longer surface `Chương chưa locked: ...` as a blocker
  - file-based frozen longform episodes treat missing SRT as a warning path rather than a hard blocker
  - production-synced music can PASS the creative gate from the historical mix state even if today’s global Audio Story music settings differ

**F4.44 — Auto-Public Production Runner (2026-06-20):**

- Operator has explicitly approved auto-public for Audio Story production once strict gates pass. `scripts/produce-audio-story-episode.ts` now accepts `AUDIO_STORY_PUBLIC_EXECUTE=1` (previously hard-blocked) alongside `AUDIO_STORY_UPLOAD_EXECUTE=1` (canonical name; `AUDIO_STORY_UPLOAD_UNLISTED_EXECUTE` still accepted). Public is refused unless this run is uploading or an existing upload already exists to finalize.
- New `EpisodeProductionRunPlan.canPublic` / `.alreadyPublic` fields and a `youtube_public` plan step in `episode-production-artifacts.ts`, gated on: episode range frozen, all chapters approved, metadata generated and free of manhua/manhwa wording (new `containsManhuaManhwaWording()` export), final video/cover/mixed-audio present, cover is not the placeholder, music production-confirmed or `allowNoMusic` explicitly set, Tee Audio channel bound, and an upload existing or about to happen.
- New `scripts/publish-audio-story-episode-public.ts` (`pnpm publish:story-episode-public`) performs the actual visibility transition: dry-run by default; on execute, re-reads the live video via the YouTube Data API, refuses to proceed if madeForKids isn't false or no thumbnail is detected, reports processing status if returned (explicitly states copyright/claims status is **not available** — no Content ID helper exists in this codebase, so that limitation is reported rather than invented), calls the existing `updateYouTubeVideoMetadata()` helper with `privacyStatus: "public"`, then re-reads and only claims success if the readback confirms `privacyStatus === "public"`. Persists `story_manual_upload_validations.visibility/uploadStatus` only after that confirmation. Already-public episodes short-circuit to a no-op before any API call.
- Fixed a stale gate in `story-creative-review-gate.ts`: `canUpload`/`canPublic` were hardcoded `false` with an obsolete "F4.11 doesn't allow upload/public" comment, and any existing upload history was shown as a `WARNING`. Now: `canUpload = status !== "BLOCKED"`; `canPublic = status !== "BLOCKED" && has upload history`; the upload/public section is always informational (`PASS`) and an already-public video reads as a final published state, not a warning.
- Fixed two latent type bugs surfaced while wiring this: the gate's `episode` param `Pick<>` omitted `locked` even though the function body reads it (added), and `AudioStorySettings` was missing the `allowNoMusic` field the gate already depended on (added with the same `audio_story.allow_no_music` app_config pattern as the other settings, default `false`).
- Current episode (`Phượng Hoàng Trở Lại`, Ch.1–9, video `3BUIlEP5LRI`) was synced only — no re-upload, no re-render, no cover regen, no TTS, no metadata update, and no live visibility change. The operator had already made it public manually; `story_manual_upload_validations.visibility/uploadStatus` was updated to `public`/`uploaded_public` to match, after re-confirming via a read-only YouTube Data API call that the live video is in fact still public. Runner dry-run now reports `Public status: YouTube public already achieved` and plans the `youtube_public` step as `REUSE`.
- New tests added: `canPublic`/`canUpload`/already-public/duplicate-upload-blocks-public cases in `test-audio-story-production-runner.ts` and `test-audio-story-creative-review-gate.ts`; added missing `test:audio-story-creative-review-gate` and `test:audio-story-local-render-preview` package scripts (the files existed but weren't wired into package.json yet).
- Story Studio episode panel's "next action" text no longer claims "upload/public vẫn chưa được phép" — it now reflects the real gate state (`canUpload`/`canPublic`) and shows a terminal "đã publish công khai" message for `uploaded_public` episodes instead of generic guidance.

**F4.45 — Nightly Cron + Disk Guard + Media Cleanup Safety (2026-06-20):**

- Disk is genuinely tight on this machine: free space measured ~39–40GB during this pass, right at the new-episode threshold below.
- New `src/lib/ops/disk-guard.ts`: `getFreeDiskBytes()` (reads `df -k`), `estimateAudioStoryEpisodeJobBytes()` (~2.3GB estimate for a 9-chapter/~50min episode, based on this story's observed artifact sizes), and `evaluateDiskGuard({ action, freeBytes?, estimatedJobBytes? })`. Thresholds (env-overridable, no app_config needed — these are ops knobs, not content settings):
  - block new production episode below **40GB** free (`AUDIO_STORY_DISK_BLOCK_NEW_GB`)
  - hard-block all production below **25GB** free (`AUDIO_STORY_DISK_HARD_BLOCK_GB`) — audit/report-only actions remain allowed
  - hard-block all render/TTS/media-heavy actions below **15GB** free (`AUDIO_STORY_DISK_HARD_BLOCK_MEDIA_GB`)
  - additionally require free ≥ `estimatedJobBytes × 2 + 10GB` headroom (`AUDIO_STORY_DISK_HEADROOM_GB`)
  - `report_only` actions (audit, cleanup dry-run) are always allowed regardless of pressure.
- New `src/lib/ops/job-lock.ts`: minimal PID-checked exclusive file lock (`acquireJobLock`/`releaseJobLock`), reclaims automatically if the previous holder's PID is no longer running.
- New `scripts/audit-media-storage.ts` (`pnpm audit:media-storage`, `--json` supported): read-only report of filesystem free/total/used, repo size, per-category media sizes, top 30 largest files / top 20 largest directories under `media/`, stale cache files (>14d, configurable via `AUDIT_STALE_DAYS`), naive duplicate-size groupings, and a count of protected Audio Story production paths (derived from every `*.production-state.json` on disk, not hardcoded to one story). Never deletes or modifies anything.
- New `scripts/cleanup-media-storage.ts` (`pnpm cleanup:media-storage`): dry-run by default; deletion requires both `MEDIA_CLEANUP_EXECUTE=1` and `MEDIA_CLEANUP_CONFIRM=YES`. Scoped only to `media/story-renders`, `media/story-covers`, `media/story-audio` (never touches anything outside `media/`; never follows symlinks). Pure planning logic (`planCleanupCandidates`) is exported and unit-tested separately from the file-deleting `main()`. Only `SAFE` candidates (ffmpeg/concat temp-file patterns, zero-byte failed outputs) are ever auto-deleted; anything else unreferenced is flagged `NEEDS_REVIEW` and left alone. Protection is derived the same way as the audit script — production-state snapshots, their sibling cover/render files, all chapter body WAVs, and the shared intro/outro assets are never candidates.
- New `scripts/nightly-audio-story-production.ts` (`pnpm nightly:story-production`): acquires `tmp/audio-story-production.lock`, skips (exit 0, not an error) if another run is active, runs the disk guard (`new_production` action) before anything else, prints a media audit summary, then delegates to `produce-audio-story-episode.ts` — forwarding `AUDIO_STORY_PRODUCE_EXECUTE`/`AUDIO_STORY_UPLOAD_EXECUTE`/`AUDIO_STORY_PUBLIC_EXECUTE` only when `AUDIO_STORY_NIGHTLY_EXECUTE=1` is also set. Defaults to dry-run/report-only. Bounded to 1 episode / 1 upload / 1 public transition per invocation — does not loop. Suggested crontab (not installed by this change):
  ```
  30 23 * * * cd /Users/bichtuyen/code/content_pipline && pnpm nightly:story-production >> logs/nightly-story-production.log 2>&1
  ```
- `scripts/produce-audio-story-episode.ts` now prints a disk forecast in every dry-run (`free=…GB, action=ALLOWED|BLOCKED`) and, in execute mode, hard-fails before the run starts if the guard disallows it, plus re-checks immediately before each of chapter TTS / intro-outro TTS / narration assembly / music mix / cover generation / video render (defensive against disk changing mid-run). Upload/public were already gated on artifact completeness from F4.44; unchanged here.
- Current episode (`Phượng Hoàng Trở Lại`, Ch.1–9) was touched read-only only — confirmed via mtime comparison that the rendered video, mixed audio, cover, and production-state snapshot were not modified by any audit/cleanup/guard logic in this pass.
- New tests: `test:disk-guard` (threshold behavior at each tier), `test:media-cleanup-planner` (protected-path exclusion, SAFE vs NEEDS_REVIEW classification), `test:job-lock` (acquire/release/stale-lock reclaim). All pass; full regression suite for F4.41–F4.44 re-run clean.
- No chapters generated, no TTS run, no Fal.ai call, no render, no upload, no public/visibility change, no YouTube metadata update in this pass — confirmed via mtime checks and by construction (audit/cleanup-dry-run/disk-guard-test are the only scripts executed against real data; cleanup execute mode was never invoked).

**F4.46 — Emergency Disk Recovery Audit + Abandoned Story Cleanup Planner (2026-06-20):**

- New `scripts/cleanup-abandoned-audio-story.ts` (`pnpm cleanup:abandoned-story` / `pnpm cleanup:abandoned-story:dry-run`, both same dry-run-by-default script): targets one story by exact `ABANDONED_STORY_ID` or `ABANDONED_STORY_TITLE`, resolves every on-disk file referenced by that story's DB rows (`story_audio_assets`, `story_video_assets`, `story_upload_packages` — the older DB-coupled pipeline, not the file-based production-state pipeline), and classifies each as `SAFE_DELETE`, `PROTECTED` (shared music/intro-outro, or anything matching the active-story id), or `BLOCKED` (outside `media/`, `tmp/`, `logs/`). Refuses outright if the target id is the protected active story. Execute requires both `ABANDONED_STORY_CLEANUP_EXECUTE=1` and `ABANDONED_STORY_CLEANUP_CONFIRM=YES`; DB hard-delete (cascades safely via existing FK `onDelete: "cascade"` from `stories.id`) requires an additional `ABANDONED_STORY_DB_DELETE_EXECUTE=1` — default DB behavior without that flag is a safe `status='abandoned'` update, no row deletion.
- Identified abandoned story: `4e6fb304-644b-4a01-80d3-3032996220ae` ("Thiên Kim Thật Trả Thù: Tổng Tài, Đừng Chạy!"). Dry-run resolved 20 on-disk files, all `SAFE_DELETE`, totaling **669MB** — entirely under `media/story-audio/`, `media/story-videos/`, `media/story-covers/`, `media/story-upload-packages/`, none overlapping the protected active story's id.
- Important finding surfaced by the dry-run: one of this story's `story_manual_upload_validations` rows is a **real** (non-test) upload — `youtube.com/watch?v=9ILoRB-5THM`, visibility `private`, status `uploaded_pending_review`. This script never calls the YouTube API, so deleting local media/DB rows will not remove or affect that video — flagged explicitly rather than silently ignored. A separate manual decision is needed if that private video should also be removed from YouTube.
- VieNeu TTS audit (Part 4): the `cp_tts` Docker container is currently **running and healthy** (4 days uptime, image `content_pipline-tts:latest`, 1.94GB / ~197MB writable layer), and VieNeu is still wired in as the registry's fallback provider (`src/lib/pipeline/tts-providers/vieneu-provider.ts`, `registry.ts`, referenced by `tts.ts`/`longform-narration.ts`/`script-engine.ts`). Conclusion: **still actively used — not touched, no cleanup script written for it.** No model/cache deletion proposed; a dedicated VieNeu cleanup script was deliberately not built since the audit's conclusion is unambiguous "do not remove."
- General `cleanup:media-storage` (F4.45) independently flags 434MB of this same abandoned story's files as `NEEDS_REVIEW` (it scans by directory, not by DB reference, and only covers `story-audio`/`story-renders`/`story-covers`, not `story-videos`/`story-upload-packages`) — cross-validates the targeted script's findings for the overlapping paths.
- All work in this pass was dry-run only: no execute flags were set, no files deleted, no DB rows changed. Confirmed via mtime comparison that the active/public story's rendered video, mixed audio, cover, and production-state snapshot are unchanged, and that the abandoned story's files are still present on disk.

**F4.47 — Emergency Disk Cleanup Execution + Final Safety Audit (2026-06-20):**

This entry records the actual execution of the F4.46 dry-run plan plus host-level maintenance, after explicit operator approval for each step.

- **Abandoned story cleanup executed.** `pnpm cleanup:abandoned-story` run with `ABANDONED_STORY_CLEANUP_EXECUTE=1` + `ABANDONED_STORY_CLEANUP_CONFIRM=YES` (no DB-delete flag) against story `4e6fb304-644b-4a01-80d3-3032996220ae` ("Thiên Kim Thật Trả Thù: Tổng Tài, Đừng Chạy!"): **20 files deleted, 669MB reclaimed**, matching the F4.46 dry-run exactly. `stories.status` set to `'abandoned'` — **no DB hard delete performed**, all child rows (chapters, episodes, audio/video assets, upload packages/validations) remain intact. The real (non-test) YouTube video `9ILoRB-5THM` referenced by this story's upload-validation row was **not touched** — this script makes no YouTube API calls. Re-verified after deletion: the general `cleanup:media-storage` and the targeted abandoned-story dry-run both confirm 0 remaining files for this story; the active/public story's artifacts were confirmed byte-for-byte unchanged via mtime comparison before and after.
- **Docker build cache cleanup executed.** `docker builder prune -f` (no `--all`) — **5.527GB reclaimed**. No images, containers, or volumes removed; `cp_tts` and `cp_postgres` confirmed still `Up (healthy)` before and after with unchanged sizes; `content_pipline_postgres_data` volume confirmed present and unchanged.
- **Next.js dev cache cleanup executed.** Identified and gracefully stopped the repo-local `next-server` process (PID 71946, cwd confirmed as this repo) via `SIGTERM`, then removed `.next/` (`rm -rf .next`, repo root only) — **~10GB reclaimed**. No other directory touched.
- **Git maintenance executed.** `git fsck --no-reflogs` passed clean (no corruption; only harmless dangling-tree notices). Standard `git gc` (non-aggressive, no `--prune=now`, no history rewrite) run — `.git` reduced from 20GB to 15GB (**~5GB reclaimed**), loose objects dropped from 77,894 (17.90GiB) to 53,187 (10.81GiB), packs consolidated from 3 to 2. `git status --short` line count identical before/after, confirming no working-tree files changed.
- **Final disk safety audit (read-only).** Free disk ~63GiB (up from ~41GiB at the start of this cleanup sequence), repo size 28GB (down from 43GB), `media/` unchanged at 11GB. Disk guard (`evaluateDiskGuard({ action: "new_production" })`) now **PASSes** for starting one new Audio Story episode (64GB free vs. ~16.1GB required). `pnpm nightly:story-production` dry-run (no execute flags) confirmed it stays strictly report-only end-to-end and correctly recognizes the current episode as already complete and public — no action needed.
- **Remaining opportunities, deliberately not acted on:**
  - `git prune --expire=now` — would reclaim more by removing all unreachable objects regardless of age, but bypasses git's default 2-week safety grace period; not run without separate explicit approval.
  - `media/audio/*.bak` (18 files, 1.65GB, historical TTS incident-response backups per ADR-023/024) — flagged for human review, not a blocker for production.
  - VieNeu/`cp_tts` — confirmed not eligible for cleanup: container is running/healthy and VieNeu remains the active fallback TTS provider in code; no model/cache/container action taken.
- No chapters generated, no TTS, no Fal.ai call, no render, no upload, no public/visibility change, no YouTube metadata update, and no DB mutation beyond the single `stories.status` field update — confirmed throughout via mtime checks, dry-run-only verification passes, and the construction of each script (none of them call the YouTube API or the content-generation pipeline).

**F4.48 — Audio Story Lane Paused, Local Media Purged (2026-06-20):**

- **Operator decision:** the Audio Story lane is temporarily paused. All local Audio Story media was deliberately purged to reclaim disk space, with explicit operator approval.
- New `scripts/purge-audio-story-media.ts` (`pnpm purge:audio-story-media`): dry-run by default; execute requires both `AUDIO_STORY_MEDIA_PURGE_EXECUTE=1` and `AUDIO_STORY_MEDIA_PURGE_CONFIRM=YES`. Scope is every top-level `media/story-*` directory (proven to resolve under `media/` and match the `story-` naming convention before being added to the plan) — no other content lane uses this prefix, so `media/music`, `media/audio`, `media/videos`, etc. were never in scope and were not scanned.
- **Executed:** deleted `media/story-renders` (1.6GB), `media/story-audio` (835MB), `media/story-audio-cache` (541MB), `media/story-covers` (1.2MB), `media/story-upload-packages` (15KB), `media/story-videos` (6KB) — **2.9GB reclaimed total**, 54 files across 6 directories.
- **YouTube untouched.** This purge only ever deletes local files — it makes no network/API calls of any kind. Both `3BUIlEP5LRI` (Phượng Hoàng Trở Lại, public) and `9ILoRB-5THM` (abandoned story, private) remain exactly as they were on YouTube; the public episode is unaffected by the local-media deletion.
- **DB hard delete not performed.** No `stories`/`story_episodes`/`story_audio_assets`/etc. rows were deleted or modified. The `stories.status` field has no existing "paused"/"archived" convention safe to reuse for a lane-level pause (the one "abandoned" value in use was introduced ad hoc for a single specific story in F4.46/F4.47 and isn't a system-wide lifecycle status) — per instructions, the DB was left untouched rather than inventing a new status value.
- **Code retained.** All Audio Story pipeline code (chapter TTS, intro/outro assembly, music mix, premium cover generation, video render, upload/public scripts, production-state resolver, creative-review gate, disk guard, nightly runner) is untouched and ready to resume.
- **Restart note:** resuming Audio Story production will require regenerating every local artifact from DB/source text — chapter body TTS, intro/outro TTS, narration assembly, background-music mix, premium cover, and video render must all run again from scratch (their on-disk caches/outputs are gone); the production-state freeze/music-sync snapshot and upload-package/validation DB rows still exist and still reference the now-deleted file paths, so the very first step on restart must be re-running the production pipeline for the affected episode(s) before any gate will read as ready again.

**F4.49 — Audio Story Lane Pause Guard (2026-06-20):**

- Following the F4.48 media purge, the lane needed an explicit safety switch so a stray cron tick or manual run can't start regenerating/uploading/publishing against the now-empty media state. New `src/lib/ops/audio-story-pause-guard.ts` exports `isAudioStoryLanePaused()` and `enforceAudioStoryPauseGuard(scriptName)`. The guard is **never set by code** — it only ever reads `process.env.AUDIO_STORY_LANE_PAUSED`, and is opt-in per invocation/cron-config by the operator.
- Wired as the very first line of `run()` — before any lock acquisition, disk guard check, DB query, file read, or network call — in:
  - `scripts/nightly-audio-story-production.ts`
  - `scripts/produce-audio-story-episode.ts`
  - `scripts/upload-audio-story-episode-youtube.ts`
  - `scripts/publish-audio-story-episode-public.ts`
  - `scripts/update-audio-story-episode-youtube-metadata.ts`
  
  When `AUDIO_STORY_LANE_PAUSED=1`, each of these prints a clear "Audio Story lane is PAUSED" notice (explaining the F4.48 media purge and that resuming means full regeneration) and exits with code **0** — a paused lane is an intentional no-op, not a failure. Dry-run mode is irrelevant here: the guard fires before the dry-run/execute branch is even reached, so dry-runs are paused too.
- **Operator usage:**
  ```
  AUDIO_STORY_LANE_PAUSED=1 pnpm nightly:story-production
  AUDIO_STORY_LANE_PAUSED=1 pnpm produce:story-episode
  ```
  Or add `AUDIO_STORY_LANE_PAUSED=1` to `.env.local` / the cron environment so every invocation is paused by default without per-command flags. Paused-mode crontab example:
  ```
  30 23 * * * cd /Users/bichtuyen/code/content_pipline && AUDIO_STORY_LANE_PAUSED=1 pnpm nightly:story-production >> logs/nightly-story-production.log 2>&1
  ```
  To resume later: remove the env var (or set it to `0`) once ready to regenerate Audio Story artifacts from source/DB.
- **Scope is Audio Story only.** `cleanup-abandoned-audio-story.ts`, `purge-audio-story-media.ts`, `audit-media-storage.ts`, and `cleanup-media-storage.ts` deliberately do **not** check this guard — they are read-mostly/maintenance tools, not production/upload/public actions, and remain usable while paused. Confirmed by source-grep that no phat_phap, tang_sau, shorts/reels, Facebook quote/photo, or generic `upload_queue` code imports this module — those lanes are completely unaffected.
- New `scripts/test-audio-story-pause-guard.ts` (`pnpm test:audio-story-pause-guard`): verifies `isAudioStoryLanePaused()` reads only its one env var; verifies the nightly script, production runner, upload wrapper, public wrapper, and metadata-update wrapper all exit cleanly (code 0) with the pause banner and never reach their normal work (lock acquisition, disk forecast, upload/public banners) when paused; statically confirms unrelated-lane source files never import the guard.
- Verified live: `AUDIO_STORY_LANE_PAUSED=1 pnpm nightly:story-production` printed the pause notice and exited 0 without acquiring the lock or running the disk guard. No chapters generated, no TTS, no Fal.ai, no render, no upload, no public, no YouTube metadata update, no DB mutation, no file deletion in this pass.
