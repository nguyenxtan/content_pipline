# Operations Cheat Sheet

## Posting Window: 06:00–22:00 VN (updated 2026-06-08)

All YouTube and Facebook destinations (Giới Định Tuệ + Trí Tuệ An Nhiên) use **06:00–22:00 Asia/Ho_Chi_Minh**.

| Destination | Platform | Window | Changed from |
|---|---|---|---|
| Giới Định Tuệ (ch 1) | YouTube | 06:00–22:00 | 08:00–21:00 |
| Trí Tuệ An Nhiên (ch 6) | Facebook | 06:00–22:00 | 08:00–21:00 |

**Tầng Sâu** retains its own window (07:00–22:00) and is NOT affected.

**Existing queued rows** were not rebalanced — they keep their originally scheduled times (all within 08:00–21:00, which is a valid subset of the new window). To reschedule existing rows into the new window (e.g. to fill 06:xx–08:xx slots), an operator can call `rebalanceQueuedUploadsAction("youtube")` and `rebalanceQueuedUploadsAction("facebook")` from a server action or script.

**Where the window is configured:**
- Live runtime source: `app_config` key `channel_publish_configs_v1`
- UI compatibility mirror: `app_config` key `auto_schedule_settings` (saved alongside runtime config so `/publishing/config` and runtime stay aligned for both `phat_phap` and `tang_sau`)
- Workspace registry: `src/lib/channel-workspace-registry.ts` — `buddhist_healing_workspace.schedulePlan.postingWindows` (used by auto-refill-watcher and schedule mixer)
- Code defaults (quote fallback): `src/lib/config/channel-configs.ts` `DEFAULT_QUOTE_DESTINATION` and `src/actions/social-channels.ts` `getFallbackDestinationSetting`

**Protected queue logic (2026-06-18):**
- Cooldown deferral must use canonical slot occupancy from `src/lib/publishing/slot-occupancy.ts`.
- Blocking statuses for slot selection are `queued`, `uploading`, `done`. `cancelled` must not block.
- Any future scheduler/publish changes must re-run `scripts/verify-upload-queue-cooldown-deferral.ts` and an upload slot audit before rollout.

## Finding a TTS Short by ID (2026-06-08)

Navigate to **Nội dung → TTS Shorts** (`/content/gallery`) and type the contentId (full UUID or first 8 hex chars) into the search box. The box auto-detects IDs (7+ characters of hex/dashes) and switches to ID-search mode — visible as a `#` icon, rose border, and "ID Search" tab in the toolbar.

- 8-char prefix: `8fc6f065` → finds the item even if published/error/old
- Full UUID: `8fc6f065-c63b-4837-9a31-ee87e96c2fe3` → same
- Direct URL: `/content/gallery?q=8fc6f065`
- Status filters (Chờ TTS / Sẵn sàng / Đã đăng / Lỗi) are bypassed when searching by ID so all statuses are visible.
- Topic text search still works as before for everything that isn't all-hex.

## Pre-Publish Quality Audit (2026-06-08)

Run before each publishing cycle to catch TTS artifacts, duplicate queue rows, already-published content, and channel mismatches.

```bash
node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/pre-publish-quality-audit.ts
```

Outputs:
- `docs/PRE_PUBLISH_QUALITY_AUDIT.md` — human-readable report
- `output/manifests/pre-publish-quality-audit.json` — machine-readable full detail

**Read-only. No DB/queue/media mutations.**

**Interpreting results:**
- `ALREADY_PUBLISHED` (HIGH) — content was already published to this channel. Cancel the duplicate queue row manually via DB or admin UI.
- `DUPLICATE_QUEUE_ROW` (MEDIUM) — same content queued twice for same platform/channel/videoType. Cancel the later-scheduled row. Note: as of 2026-06-08 the dedup key includes `video_type`, so `short+quote` co-scheduled pairs no longer trigger this code.
- `TTS_TYPE_A_SEPARATOR` (MEDIUM) — `---`/`***`/`___` prefix in short_content. Normalizer strips it ✅, but audio rendered before 2026-06-04T04:33:00Z may still have artifact.
- `TTS_TYPE_B_NH_PAIR` (HIGH if rendered before fix) — `nhX, nhY` pattern. Normalizer converts comma to period ✅, but audio rendered before 2026-06-08 may have elongation artifact.
- `TTS_MARKDOWN_BULLETS` (MEDIUM) — dash/bullet prefix after separator. Normalizer strips separator but the remaining bullet may persist. Verify audio.
- `TTS_SHORT_OPENING_CLAUSE` (LOW) — short opening fragment before main hook. Informational only.
- `TTS_NORMALIZER_CHANGES_HASH` (LOW) — normalizer changes text enough to invalidate existing audio cache hash. TTS will regenerate on next run.

**To cancel a queue row (already-published duplicate):**
```sql
UPDATE upload_queue SET status = 'cancelled' WHERE id = '<queue_id>';
```

## Duplicate Upload Queue Rows After Facebook Re-enable (2026-06-08)

**Root cause:** When admin disables Facebook posting (all pending rows → `cancelled`) then re-enables it, automated schedulers (auto-refill-watcher, schedule-mixer, bulkScheduleAction) previously only checked `status IN ('queued','uploading','done')` — they ignored 'cancelled'. So they re-scheduled the same content, leaving a duplicate pair: one cancelled row + one new row.

**Fix applied 2026-06-08:** All automated dedupe checks now include `'cancelled'`. See ADR-022.

**Checking for remaining duplicates:**
```bash
DOTENV_CONFIG_PATH=.env.local npx tsx --require dotenv/config scripts/probe-duplicate-queue-rows.ts
```

**Cleanup of inert cancelled+cancelled pairs:**
Both rows are already inactive — no double-posting risk. To clean up cosmetically, for each pair cancel the row with the lower `scheduled_at`:
```sql
-- Dry-run: see pairs
SELECT content_id, channel_id, video_type,
       array_agg(id ORDER BY scheduled_at) AS ids,
       array_agg(status ORDER BY scheduled_at) AS statuses
FROM upload_queue
WHERE platform = 'facebook'
GROUP BY content_id, channel_id, video_type
HAVING count(*) >= 2;

-- Delete older row from each cancelled+cancelled pair (run after confirming dry-run)
DELETE FROM upload_queue
WHERE id IN (
  SELECT (array_agg(id ORDER BY scheduled_at))[1]
  FROM upload_queue
  WHERE platform = 'facebook'
  GROUP BY content_id, channel_id, video_type
  HAVING count(*) >= 2
    AND bool_and(status = 'cancelled')
);
```

## Content Intelligence Dashboard — Topic-First Model V3 (2026-06-08)

The Content Intelligence dashboard at `/publishing/analytics/content-intelligence` uses a topic-first profile model. Each topic profile owns multiple platform destinations.

**Topic Profiles:**

| Profile key | YouTube | Facebook | TikTok |
|---|---|---|---|
| `phat_phap` (default) | Giới Định Tuệ (account 1) | Trí Tuệ An Nhiên (account 3) | Not configured |
| `tang_sau` | Tầng Sâu (account 4) | — | Not configured |

**Deep-link params:** `?profile=tang_sau`, `?profile=phat_phap`, `?platform=youtube`, `?platform=facebook`, `?platform=all` (default). Client selectors also switch without page reload.

**Giới Định Tuệ tabs (phat_phap) — 7 tabs:**
- **Era Performance** — era × YouTube breakdown with time-window avg columns (24h / 48h / 7d / 30d). CTA-contaminated like% shown with amber `*`.
- **Format** — 7 format groups.
- **Topic Family** — 9 Buddhist topic families.
- **Hook Pattern** — 8 Buddhist hook patterns.
- **Cross-Platform** — per content item: YouTube status + views + age badge + 24h/7d window · Facebook status + views (null note) · TikTok (not configured).
- **Voice / Audio** — TTS intelligence: duration, word count, WPM, pacing category (too_slow <130 / normal 130–230 / fast >230), script length category, quality flags. Summary stats: avg WPM, coverage, outlier count.
- **Quality Flags** — CTA contamination (critical), HOOK_V2 insufficient data, Legacy era dominant, Cover intro underperform, Visual metadata unavailable.

**Age badges:** too_early (<24h) / early_signal (24–48h) / first_decision (2–7d) / stable (7–30d) / evergreen (>30d). Shown on Cross-Platform and Voice/Audio tabs.

**Tầng Sâu tabs (tang_sau):** Format, Topic Family, Hook Pattern, Learning Lineage + Visual Style summary. Unchanged.

**Read-only guarantee:** No upload, schedule, processUploadQueueAction, or queue mutation is triggered by this dashboard. All data is fetched via SELECT queries only.

**Facebook metrics note:** Facebook published videos for phat_phap (account 3) have mostly null view/like counts. Cross-Platform tab shows "null" with note when Facebook views unavailable.

**CTA benchmarking:** HOOK_V1 items have CTA-inflated like% (~+1.2pp). The Era tab marks these with `*` and warns not to use HOOK_V1 like% as a clean benchmark for HOOK_V2 comparison. Use view count and retention instead.

---

## Publishing Queue & Calendar Pages

**Routes:** `/publishing/queue` (Hàng chờ) · `/publishing/calendar` (Lịch theo ngày)

Both pages are read-only operator views of `upload_queue`. No mutations, uploads, or scheduling from these pages.

**Queue page** — shows upcoming, error, and historical rows. Default view: `statusFilter = upcoming` (queued + uploading), all platforms, all formats. Filters: status / platform / định dạng / workspace. Refreshes every 30s automatically; manual "Làm mới dữ liệu" button also available.

**Calendar page** — same data grouped by Vietnam date. Default view: next 7 days with upcoming rows. Quick views: Hôm nay / 7 ngày tới / Tất cả lịch sắp tới / Lịch đã đăng. Timezone: all times displayed in Asia/Ho_Chi_Minh.

**Data source:** `getUploadQueueAction` in `src/actions/social-channels.ts`. Fetches 300 rows ordered by `scheduledAt DESC` — this ensures all active (future-dated) queued rows appear first, before old done/cancelled history. History window: last ~233 most recent rows (300 minus active rows).

**Empty state:** If the page shows "Không có mục nào," check:
1. Total count shown in the empty state box — if > 0, a filter is hiding rows → click "Đặt lại bộ lọc"
2. If total is 0, check ops-health: `pnpm ops:health`
3. DB: `SELECT status, COUNT(*) FROM upload_queue GROUP BY status`

---

## Tầng Sâu Visual Scene Pool Update (2026-06-08)

`TANG_SAU_SCENE_POOL` in `src/lib/pipeline/quote-short-pipeline.ts` updated to lighter, less gloomy distribution.

**New mix (36 entries):**

| Category | Slots | % | Notes |
|---|---|---|---|
| Bright interior (indoor_objects) | 14 | 39% | Window light, cafe, desk, reading corner |
| Bright city/transit (urban_city) | 9 | 25% | Morning streets, transit platform, overcast midday |
| Airy nature (nature_scenery) | 7 | 19% | Lake, riverside, meadow, beach, park |
| Warm evening (warm_evening) | 4 | 11% | Golden hour, dusk, rooftop — new category |
| Dark moody (dark_moody) | 2 | 6% | Night street, rain-slicked alley |
| Person scenes (minimal_person) | 5 | 14% | Distributed across above categories |

**What changed:**
- Removed 6 `abstract_light` entries (replaced with more interior + city scenes)
- Added `warm_evening` and `dark_moody` as new `TangSauSceneCategory` values
- Dark scenes reduced from scattered to 2 explicit `dark_moody` slots (5.6% of pool)
- Added 2 new `indoor_objects` scenes (sunlit kitchen counter, bright reading corner)
- Added 3 new `urban_city` scenes (overcast city corner, train carriage, glass atrium)
- Added 1 new `warm_evening` scene (outdoor cafe terrace at golden hour)
- `buildQuoteShortImagePrompt` now uses a warm amber Kinfolk anchor for `warm_evening` scenes instead of the default cool-light Kinfolk anchor

**Actual distribution over 20 Tang Sau topics (hash-seeded):**
- BRIGHT: 16/20 (80%) · WARM: 2/20 (10%) · DARK: 2/20 (10%) · PERSON: 3/20 (15%)

**Vision guard:** `inspectTangSauBackground` unchanged — still rejects text and Buddhist/spiritual imagery.

---

## Buddhist Auto-Schedule Legacy CTA Guard (2026-06-08)

`autoScheduleVideoAction` in `src/actions/social-channels.ts` now blocks any `phat_phap` content whose `short_content` contains legacy subscriber CTA terms (`nhấn thích`, `theo dõi kênh`, `đăng ký`) from being auto-queued.

**Why it exists:** Old HOOK_V1/null-era Buddhist items had `video_status='done'` and no active queue rows after the 2026-06-07 cancellation. Each cron tick re-queued them via `autoScheduleVideoAction`. Cancelling rows alone was not durable — cron re-created them. The guard makes the block permanent without deleting media.

**Scope:** `channelKey === 'phat_phap'` only. Tầng Sâu, other channels, and all HOOK_V2 Buddhist content (no CTA) are unaffected.

**Log line:** `[autoSchedule] blocked_legacy_buddhist_cta contentId=<id>` — appears in cron logs when a blocked item is skipped.

**Removal condition:** If old HOOK_V1 Buddhist items are ever deleted or their `short_content` cleaned, this guard becomes a no-op automatically. Do not remove it until all CTA-contaminated `phat_phap` items have been deleted or cleaned.

---

## Buddhist TTS Short — CTA Policy (2026-06-07)

Subscriber CTA is permanently disabled for the `phat-phap` / `buddhist_healing_v1` content profile.

**Changes in effect:**
- `content-profiles.ts` (`buddhist_healing_v1`): `requireShortCta: false`, `shortCta: null`
- `ensureShortCta()` in `script-engine.ts` is now a no-op for Buddhist content
- `prompt_templates` id=41 (Buddhist short): "Kết thúc" section changed to "Không kêu gọi đăng ký, thích, hay theo dõi kênh"

**Why:** Old Buddhist TTS shorts contained a hardcoded subscribe CTA ("Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh…"). This was enforced by `ensureShortCta()` regardless of prompt template content, and tagged into all HOOK_V1 era queue rows. The fix removes CTA at all three layers. All new Buddhist `short_content` fields are now CTA-free by default.

**No operator action required.** Cron, auto-refill, and new generation all use the updated config automatically.

---

## Buddhist HOOK_V1 Queue Cleanup (2026-06-07)

35 old-era Buddhist queue rows (`status='queued'`, generated 2026-06-01/02, `experiment_variant=HOOK_V1` or null) were cancelled to clear contaminated CTA content from the schedule.

15 replacement HOOK_V2 scripts were regenerated with no CTA. These are in `content_generations` with `tts_status='pending'`, `video_status='pending'`, and `experiment_variant='HOOK_V2'`. Cron will handle TTS → images → video → auto-schedule automatically.

**Tầng Sâu queue was not touched.** 70 active Tầng Sâu queue rows remain intact.

---

## Subtitle Chunking — Buddhist/Short TTS (2026-06-07)

`MAX_WORDS_PER_CHUNK` raised from 4 → 6 in `src/lib/video/subtitle.ts`. Improvements:
- No final 1-word orphan chunks (merger into previous chunk)
- 8 protected Vietnamese phrase pairs are never split across subtitle chunks: thực tại, hiện tại, khổ đau, buông xuống, chấp nhận, bình an, vô thường, nhân quả
- ASS outline reduced from 5 → 3, shadow from 3 → 2 (less meme-like)

No operator action required. All new renders automatically use the updated chunking.

---

## Channel Workspaces

Workspaces separate channels and niches so that the pipeline can be re-used across multiple projects without code changes.

A workspace bundles:
- **Prompt profile** — controls LLM tone, vocabulary, and avoid-terms (e.g. `tang_sau_v1`, `buddhist_healing_v1`)
- **Topic plan** — curated topic families with priority, seed ideas, and avoid-terms
- **Format mix** — which formats are enabled (TTS Short, Quote Short, Long) and their ratio weights
- **Schedule plan** — posting window, interval, max daily posts, platforms

### Configured workspaces

| workspaceId | displayName | promptProfileId | Key formats |
|-------------|-------------|-----------------|-------------|
| `buddhist_healing_workspace` | Giới Định Tuệ / Trí Tuệ An Nhiên | `buddhist_healing_v1` | TTS Short + Quote Short, YouTube + Facebook |
| `tang_sau_workspace` | Tầng sâu | `tang_sau_v1` | Quote Short only (TTS not enabled), YouTube |

Current cadence defaults:
- `buddhist_healing_workspace`: 60-minute interval inside the configured posting window.
- `tang_sau_workspace`: 60-minute interval inside the configured posting window.

### UI entry point

- `/content/workspaces` — read-only workspace list with topic families, format mix, schedule plan, and AI topic suggestion preview.

### Integration points

**Quote generator** (`/content/quotes`):
- Select a workspace to auto-fill the prompt profile and topic family list.
- Without a workspace: manual channel profile + topic family selection (existing behavior).

**Schedule Mixer** (`/content/scheduler`):
- Select a workspace to auto-fill interval, platforms, and format mix weights.
- Without a workspace: fully manual controls (existing behavior).

### Config location

Workspace definitions live in `src/lib/channel-workspace-registry.ts`.
Add a new workspace by appending to the `WORKSPACES` array.
No DB change required. DB CRUD can be layered on top later.

---

## Tầng Sâu Text Style Pack V1

Three opt-in quote short format variants available exclusively for `workspaceId = tang_sau_workspace` / `channelProfileId = tang_sau_v1`. All are non-TTS, music-backed, vertical 9:16.

| Format | experimentVariant | visualMode | quoteStyle | Notes |
|--------|-------------------|-----------|------------|-------|
| Kinetic Text | `LEGACY_QUOTE_KINETIC_TEXT_V1` | `kinetic_typography` | `kinetic_quote` | 12–28 VN words, 4–8 chunks + optional `kineticText.microReflection`; **V1.3 seeded layout variants** (see Kinetic Text V1.3 section below) |
| Reflection Card | `LEGACY_QUOTE_REFLECTION_V1` | `quote_reflection_card` | `reflection_card` | mainQuote 12–24 words + reflectionText 25–55 words; modern introspective, not Buddhist |
| Note Letter Card | `LEGACY_QUOTE_NOTE_LETTER_V1` | `note_letter_card` | `note_letter` | 35–90 VN words, 3–6 lines, diary/letter layout, left-aligned with "LỜI NHẮN XX" header |
| Bilingual Minimal | `LEGACY_QUOTE_BILINGUAL_MINIMAL_V1` | `bilingual_minimal` | `bilingual_minimal` | English + Vietnamese, 2–4 lines, English italic above, Vietnamese bold below |

### How to generate

1. Go to `/content/quotes`.
2. Select workspace **Tầng sâu**.
3. Under **Quote format**, choose one of: *Note Letter Card*, *Kinetic Text*, or *Bilingual Minimal*.
4. Click **Tạo Quote Short**.

The three new buttons are hidden for non-Tầng Sâu workspaces.

### Tone rules enforced

Content avoids: Phật, nghiệp, duyên, vô thường, giác ngộ, tỉnh thức, an nhiên, bình an trong tâm, tâm hồn, bản ngã, chữa lành, vũ trụ, ánh sáng, biết ơn, hành trình, khởi đầu mới, thành công, ước mơ, tích cực, nghị lực, truyền cảm hứng.

Preferred topics: mệt, im lặng, giải thích, bị hiểu lầm, một mình, ngày rất dài, tin nhắn, cuộc gọi, người cũ, trưởng thành, cố tỏ ra ổn, càng lớn càng ít nói.

### Sidecar fields added (V1)

Both `channelKey` and `contentProfileKey` are now written to every legacy quote short sidecar JSON when provided via the pipeline. Existing sidecars without these fields are unaffected.

### Auto-generation format mix policy

When Auto Refill / cron generates Tầng Sâu quote shorts without an explicit format, the pipeline applies a **deterministic per-topic format mix** defined in `TANG_SAU_FORMAT_POLICY` (`src/lib/pipeline/quote-short-pipeline.ts`):

| Format | Weight | ~% of auto batch |
|--------|--------|-----------------|
| `kinetic_text` | 35 | ~35% |
| `quote_reflection` | 30 | ~30% |
| `note_letter_card` | 20 | ~20% |
| `bilingual_minimal` | 15 | ~15% |
| `short_quote` | — | fallback only |

**Trigger condition:** Tầng Sâu context (`tang_sau_workspace` / `tang_sau_v1` / `tang_sau` / `philosophy`) **and** no `quoteFormat` specified in the call. Manual UI selection always overrides the mix.

**Format selection:** deterministic hash of the topic string → `hash % 100` → bucket. Same topic always produces the same format, so batches with the same topic pool are reproducible.

**Sidecar recording:** `experimentVariant` in the DB and sidecar JSON reflects the actual format used, not the hardcoded default `LEGACY_QUOTE_NO_VOICE_V2`.

**Buddhist workspace:** unaffected — no format policy applies; defaults to `short_quote` as before.

### Background image routing and visual scene pool

Quote short image generation is routed by workspace/channel context via `buildQuoteShortImagePrompt` in `quote-short-pipeline.ts`:

| Context | fal.ai prompt style |
|---------|-------------------|
| Tầng Sâu (`tang_sau_workspace` / `tang_sau_v1` / `channelKey=tang_sau` / `contentProfileKey=philosophy`) | 36-scene bright/modern cinematic pool — see categories below. No Buddhist/spiritual terms or visual cues. |
| All other workspaces | Vietnamese Buddhist spiritual scene — existing behavior unchanged. |

**Tầng Sâu `TANG_SAU_SCENE_POOL` (36 entries, `quote-short-pipeline.ts`):**

| Category | Count | Description |
|----------|-------|-------------|
| `urban_city` | 8 | Bus stop after rain (blue hour), blue-hour bokeh street, golden-hour rooftop, train window dusk, quiet morning street, transit corridor (skylights), sunlit morning sidewalk, dark amber streetlight (1 dark) |
| `indoor_objects` | 10 | Cafe table + window, minimal desk + phone, empty cafe chair, bedsheet + pen, morning apartment window, curtains in sunlight, glass on windowsill, warm wooden table, notebook + pen, bright window seat |
| `nature_scenery` | 7 | Lake under overcast sky, open road at dusk, bright cloudy riverside, open hillside, beach under pale sky, sunlit park path, wide meadow path |
| `abstract_light` | 6 | Rain on glass + pastel bokeh, blind shadow on white wall, light leak on floor, warm window reflection on wood, overcast sky on wet tiles, morning light on white wall |
| `minimal_person` | 5 | Tiny silhouette on wide city street, back view at window, hand with phone on cafe table, lone figure in open landscape, casual person walking daylit path |

**Visual diversity constraints (enforced by pool metadata):**
- Person scenes: 5/36 = 14% — max 25% ✓
- Dark/night scenes: 1/36 = 3% — bright scenes 97% ✓
- Color direction: off-white, warm beige, soft gray, pale blue-gray, soft gold — avoid muddy olive, dirty sepia, dark green-gray
- `buildQuoteShortImagePrompt` front-loads a style anchor per `isDark`: bright scenes use "Kinfolk magazine, commercial lifestyle photography"; dark scenes use "Monocle magazine, urban documentary photography"
- **Important**: Buddhist/spiritual negative terms are intentionally ABSENT from the generation prompt. Naming them (even as "no X") activates those concepts in CLIP embedding space and causes Buddhist generation. The guard handles rejection instead.
- Forbidden in prompt (text only): typography, caption, watermark, logo, poster, readable signage, subtitles, quote card
- `inspectTangSauBackground` vision guard checks for both text contamination AND visual Buddhist/spiritual cues — this is the rejection layer, not the prompt
- Guard flag rate after hotfix: 2/8 (text contamination only, 0 Buddhist) — production reroll (3 attempts) clears these

**Scene selection:** deterministic hash of the topic text → index into pool. Same topic always picks the same scene, so batches are reproducible.

### Visual color palette policy (2026-06-07)

**Tầng Sâu visual identity:**
- Style reference: Kinfolk magazine / Monocle magazine — modern editorial, quiet, introspective, secular
- Preferred colors: warm beige, soft cream, muted amber, coffee brown, soft charcoal, off-white, window light, desk lamp warmth
- Avoid: blue-gray gloom, dark green depression, temple/spiritual footage, Buddha/lotus/monk/praying, overly sad stock footage, meditation pose, cold foggy visuals
- `colorPalette` sidecar value: `"warm-neutral editorial (warm beige, soft cream, muted amber, off-white, Kinfolk/Monocle)"`
- `visualTemperature` sidecar value: `"warm-neutral"`

**Buddhist / Phật pháp visual identity:**
- Style reference: serene golden light, warm sunrise, lotus, peaceful temple
- Preferred colors: warm gold, ivory, lotus pink, sunrise amber, soft green, bright sky blue
- Preferred motifs: Buddha statue, lotus, sunrise, temple morning, peaceful nature, halo-like soft light
- Avoid: gloomy, dark gray, lonely urban sadness, cold depressive tone, heavy shadow
- `colorPalette` sidecar value: `"bright warm healing (warm gold, ivory, lotus pink, sunrise amber, peaceful temple)"`
- `visualTemperature` sidecar value: `"bright-warm"`
- Buddhist `buildQuoteShortImagePrompt` now uses 4 seeded style anchors (Buddha statue, temple sunrise, monastery dawn, lotus pond) + explicit warm color direction + explicit negative: "no dark shadows, no cold blue tones, no gloomy mood"

**Sidecar fields added (2026-06-07):** `colorPalette`, `visualTemperature` — written to sidecar JSON and surfaced in `/content/quotes` UI review as a badge and in Chi tiết kỹ thuật.

### Kinetic Text V1.3 — Seeded Layout Variants, Safe Frame, and Note Readability

Implemented in `buildKineticTypographyAss` (`src/lib/legacy-quote-short-generator.ts`).
`experimentVariant` remains `LEGACY_QUOTE_KINETIC_TEXT_V1` — no auto-refill policy change.

V1.3 keeps the animated quote hook from V1.1/V1.2, but upgrades the `microReflection` note block into a seeded layout system for Tầng Sâu. This is still the same format and the same experiment id.

#### Typography

| Size | Font (px) | Bold | Opacity | Role |
|------|-----------|------|---------|------|
| `small` | 50 | no | ~73% muted | supporting / bridge |
| `medium` | 66 | no | ~80% muted | supporting |
| `large` | 90 | yes | ~91% off-white | emphasis |
| `xlarge` | 112 | yes | 100% off-white | final emphasis |

- Main text is **off-white** (`&H00EEF0F2`) — not pure white.
- Supporting lines are dimmer (`&H00BAC8D4` / `&H00CCD8E0`).
- **Accent color:** one per video, picked deterministically from the first `accentWord`. At most 1–2 `large`/`xlarge` emphasis chunks receive the accent color inline.

**Accent palette (5 options, no neon / no rainbow):**

| Color | Hex (ASS BGR) | RGB |
|-------|---------------|-----|
| Warm amber | `&H0050B4E6` | RGB(230,180,80) |
| Soft beige | `&H00AAC8DC` | RGB(220,200,170) |
| Muted cyan | `&H00D2C86E` | RGB(110,200,210) |
| Dusty rose | `&H009BA0D2` | RGB(210,160,155) |
| Pale gold | `&H0082D2F0` | RGB(240,210,130) |

#### Layout presets

- `kineticText.layoutPreset` is written to sidecar metadata after render.
- Preset selection is deterministic, seeded from stable content metadata. No `Math.random()` is used.
- The renderer tries seeded presets first, then silently chooses another seeded-safe preset if the first one would overlap or overflow.
- Only hard fallback / dense-fit / clamp situations create `layoutWarnings`.

Current preset pool:

| Preset | Intent |
|--------|--------|
| `note_left_kinetic_right` | note left / kinetic right |
| `note_right_kinetic_left` | note right / kinetic left |
| `note_top_kinetic_bottom` | note high / kinetic low |
| `note_bottom_kinetic_top` | note low / kinetic high |
| `note_center_low_kinetic_upper` | note center-low / kinetic upper |
| `note_wide_center_kinetic_split` | wider editorial note block / kinetic offset away from it |

- Explicit safe frame for readable content:
  - `leftSafeX >= 80`
  - `rightSafeX <= 920`
  - `topSafeY >= 180`
  - `bottomSafeY <= 1680`
-  `microReflection` width varies by preset, typically `620–760 px`
-  `microReflection` height stays inside preset-specific safe bounds
- No main readable text should be placed above `y=160` or below `y=1680`.
- Bottom `220 px` should remain mostly clear.
- Right edge should remain relatively clear for Shorts/TikTok UI when possible.

#### Motion

- **Supporting chunks** (`emphasis: false`): `\move()` upward drift (18 px) + fade-in 320 ms.
- **Emphasis chunks** (`emphasis: true`): scale-in 93→100 % over 350 ms + fade-in 200 ms; accent color applied inline via `\1c`.
- **Hold time:** 1.2–1.8 s — final composition stays fully visible before video ends.
- `microReflection` is fixed on screen and only fades in once. It is never animated chunk-by-chunk.

#### Sidecar fields

- `kineticText.chunks[].emphasis` — drives per-chunk styling.
- `kineticText.accentWords[]` — list of chunk texts that receive the accent color (1–3 entries).
- `kineticText.microReflection` — 35–90 Vietnamese words, generally 4–8 short lines, clearer and more emotionally complete than V1.2.
- `kineticText.layoutPreset` — final preset used by the renderer.
- `kineticText.layoutWarnings[]` — optional renderer warnings. Clean samples should usually have none; warnings mainly mean dense-fit, stress-fit, line clamp, or hard preset fallback.

#### Overflow protection

If `microReflection` is too large for the safe frame, the renderer must:

1. Wrap to max width.
2. Reduce font size gradually, targeting `36–44 px` first.
3. Keep normal minimum at `34 px`; only go below that in stress-fit situations.
4. Tighten line spacing slightly.
5. If still too tall, clamp to 8 visible lines and record a layout warning in sidecar metadata.

The renderer must never silently place text outside the frame or let `microReflection` overlap the kinetic block.

#### Note readability rules

- Treat `microReflection` like an editorial note block, not a tiny subtitle.
- Preserve paragraph breaks.
- Note text should feel complete, specific, and emotionally clear.
- Avoid vague poetic phrasing that sounds nice but says too little.
- Avoid advice-like endings and self-help tone.

### No-upload guarantee

These variants **never** call `processUploadQueueAction`, mutate `upload_queue`, or schedule posts. Generation creates local video + sidecar only.

---

## If you do not want to run CLI commands

### Browser dashboard

Publishing is now split into clearer subpages:

- `/publishing/queue` — Hàng chờ theo thứ tự thời gian
- `/publishing/calendar` — Lịch theo ngày / giờ VN
- `/publishing/mixer` — Lập lịch trộn TTS Short + Quote Short
- `/publishing/config` — Cấu hình auto-schedule theo kênh
- `/publishing/errors` — Queue row lỗi và retry
- `/publishing/analytics` — Phân tích
- `/publishing/health` — Sức khoẻ hệ thống

`/publishing` tự chuyển sang `/publishing/queue`.

Open `/publishing/health` in the running app (e.g. `http://localhost:3000/publishing/health`).

The page shows all the same information as `pnpm ops:health`:

- Production status: **ALLOWED** or **PAUSED** with a colored banner
- Blocking reasons listed inline
- Upload queue count, rendered video count, media size, free disk
- Safe-deletable storage estimate
- Recent cron errors (last 3 hours)
- Short cover intro flag, current experiment id/variant, model flags
- Recommended next action
- Auto-refreshes every 60 seconds — no manual reload needed

The page is read-only. No buttons that modify data except the Telegram summary toggle described below.

### API endpoint

`GET /api/admin/factory-health` returns the same data as JSON.
Protected by either:

- `Authorization: Bearer <CRON_SECRET>` or `ADMIN_API_SECRET`
- or a valid admin app session cookie

### Telegram Health Check

Use these Telegram commands in the configured owner chat:

- `/health`
- `/factory`
- `/status`

The bot replies with the current Factory Health report and an inline button:

- `🏭 Check Factory Health`

Pressing the button sends the same on-demand report again.

Required env vars:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `NEXT_PUBLIC_APP_URL` pointing to the running app

Recommended env vars:

- `TELEGRAM_ADMIN_USER_ID` to lock commands to one Telegram user inside the allowed chat
- `TELEGRAM_WEBHOOK_SECRET` to require Telegram's webhook secret header

Webhook endpoint:

- `POST /api/telegram/webhook`

Suggested webhook setup:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "'"$NEXT_PUBLIC_APP_URL"'/api/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'"
  }'
```

How to test:

1. Confirm the app is reachable from Telegram with a public HTTPS URL.
2. Configure the webhook.
3. Open the allowed Telegram chat.
4. Send `/health`.
5. Confirm the bot returns a Factory Health message with:
   - production status
   - blocking reasons
   - recommended next action
6. Tap `🏭 Check Factory Health` and confirm a second on-demand report is sent.

Common failure cases:

- Bot sends alerts but ignores `/health`:
  webhook not configured, or `NEXT_PUBLIC_APP_URL` still points to localhost.
- Route returns 401:
  `TELEGRAM_WEBHOOK_SECRET` does not match the secret configured in Telegram.
- No response in group/private chat:
  chat ID does not match `TELEGRAM_CHAT_ID`, or `TELEGRAM_ADMIN_USER_ID` does not match the sender.
- Empty/delayed report:
  app can receive webhook, but DB/app runtime is unhealthy or cold-starting.

### Telegram daily summary

In the `/publishing/health` page, scroll to the **Tóm tắt Telegram hàng ngày** section.

Toggle it on, pick a send time (Vietnam timezone), and save. Once per day at that time, the cron will send a summary to your configured Telegram chat:

```
🏭 Factory Health - 2026-06-02

✅ Status: ALLOWED

Upload queue: 3 / 60
Rendered trên disk: 2 / 30
Tạo hôm nay: 5 / 20
Media: 1.35 GB / 10 GB
Disk trống: 120.00 GB
```

If paused, the blocking reasons are appended. A link to open the dashboard is included in every message.

Requirements: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` must be configured in `.env.local`.

---

## Upload Schedule Safety

- Manual scheduler/debug actions must never call real upload. Only cron may call `processUploadQueueAction({ source: "cron", allowUpload: true })`.
- Never run the upload queue manually in execute mode during debugging unless you explicitly intend to publish.
- `upload_queue.scheduled_at` is stored as a timezone-aware timestamp in UTC.
- Queue screens and history display the schedule in Vietnam time (`Asia/Ho_Chi_Minh`).
- Cron is allowed to publish items whose `scheduled_at <= now` and to catch up overdue items if the server missed the original slot.
- Cron must not publish items scheduled in the future. A second execution guard skips those rows with `not_due_yet` even if a bad query or manual call selects them.
- Manual retry should only reset a row back to `queued`. It should keep the existing `scheduled_at` unless you intentionally implement a force-publish path.
- Scheduler/debug runs should only create queue rows. They should not auto-run uploads immediately after scheduling.

How to verify a missed upload safely:

1. Check the queue row in `/publishing` or `/content/scheduler`.
2. Confirm `status = queued` and note the scheduled time shown in VN.
3. Run `pnpm verify:upload-schedule` to confirm dry-run and due/catch-up behavior.
4. If the row is overdue and still `queued`, let cron catch it up.
5. If the row is `error`, retry it without force-publish. It will wait until due or upload immediately only if already overdue.

## Quote Shorts Flow

Quote Shorts are managed as **production content**, not sample/debug assets. The `/content/quotes` page is the primary management UI.

- Generation flow is one-click:
  1. Choose count, optional topic family, optional duration.
  2. Choose `Quote format`:
     - `Short Quote`
     - `Quote + Reflection` (currently intended for `Tầng Sâu`)
  3. Click **Tạo N Quote Shorts**.
  4. System automatically writes quote text, generates/selects background image, picks music, renders video, writes sidecar metadata, and inserts `content_generations`.
- Quote generation does **not** preview first, does **not** schedule, and does **not** upload.
- `Quote + Reflection` keeps the same no-TTS music-backed flow, but sidecar metadata additionally stores:
  - `mainQuote`
  - `reflectionText`
  - `quoteStyle=reflection_card`
  - `visualMode=quote_reflection_card`
- Source data is read from `output/legacy-quote-short-v1/experiment-batch.json` (primary manifest), supplemented by sidecar files matching `output/legacy-quote-short-v1/*-legacy-quote-short.json`.
- Khi manifest và sidecar cùng có một `contentId`, sidecar được ưu tiên để override metadata mới hơn như `workspaceId`, `channelProfileId`, `channelName`, `topicFamily`.
- Sidecar cũ chưa có `workspaceId/channelProfileId` hiện được coi là thuộc workspace mặc định Buddhist Healing để tránh lẫn sang `Tầng sâu`.
- The page shows each Quote Short as a content item with:
  - human fields first: topic, quote text, format type, experiment, status, scheduled/published platforms
  - `Reflection Card` badge for `Quote + Reflection` items
  - status badges: **Sẵn sàng** (ready to schedule), **Đang chờ lịch** (queued), **Đã đăng** (published), **Thiếu file** (video asset missing)
  - preview assets (video, contact sheet) accessible via "Xem preview" link — optional, collapsed under "Chi tiết kỹ thuật"
- Primary flow is **batch scheduling**:
  1. Set start time, interval, max items, platforms.
  2. Click **Tạo lịch Quote batch** — always runs a dry-run preview first.
  3. Review the preview panel (slots, capacity warning, queue delta).
  4. Click **Tạo queued rows** to create `upload_queue` rows in `queued` state.
- Scheduling never uploads immediately. It only creates future `scheduled_at` rows.
- Cron is the only path that may publish those queued rows when the time is due.
- Do not manually upload Quote Shorts from debug scripts or ad-hoc action calls.
- Technical details (outputVideoPath, musicPath, visualMode, motionStrength, contactSheet link, contentId) are collapsed under **Chi tiết kỹ thuật** per item — not shown by default.
- After scheduling, review `/publishing` to confirm the queue and use the `TTS Short / Legacy Quote` filter if needed.

### Mixed publishing flow

- Tạo video TTS ở `/content/gallery` hoặc pipeline render hiện có.
- Tạo video Quote ở `/content/quotes`.
- Trộn để đăng tại `/publishing/mixer`.
- `/publishing/mixer` chỉ tạo `upload_queue` rows cho video đã có sẵn.
- Không upload ngay từ màn này. Cron vẫn là đường duy nhất đăng thật khi tới giờ.
- Sau khi tạo hàng chờ, theo dõi thứ tự và trạng thái tại `/publishing/queue` hoặc `/publishing/calendar`.

## Prompt Studio / Channel Profiles

Prompt Studio lives at `/content/prompts`.

Mục tiêu của màn này là gom prompt/profile về một chỗ để dễ nhìn, dễ mở rộng nhiều kênh hơn, thay vì để prompt rải trong code, DB prompt editor và các panel riêng lẻ.

Hierarchy hiện tại:

- `Global`
- `Platform`
- `Channel`
- `Format`
- `Topic Family`
- `Template`
- `Variant`

Ý nghĩa:

- `Global`: các rule kỹ thuật dùng chung như no markdown separators, validation constraints.
- `Platform`: rule riêng cho YouTube Shorts, Facebook Reels, Facebook Quote/Photo, YouTube Long.
- `Channel`: phong cách theo kênh, ví dụ `buddhist_healing_v1` và `tang_sau_v1`.
- `Format`: kiểu nội dung như `tts_short`, `legacy_quote_short`, `long_video`.
- `Topic Family`: nhóm chủ đề để AI không viết lan man sai hướng.
- `Template`: lớp creative prompt theo từng stage/format.
- `Variant`: biến thể prompt cho experiment hoặc tone khác nhau.

Prompt Studio v1 là **read-only / opt-in first**:

- Dùng để xem profile, topic family, template map, option groups và active DB prompt templates.
- Có AI suggestion helper dạng preview-only.
- Không tự sửa prompt production.
- Không tự đổi generation behavior toàn hệ thống.

Quote Short generator hiện chỉ nối nhẹ với Prompt Studio:

- Có thể chọn `channelProfileId` và `topicFamily` khi tạo Quote Short.
- Nếu không chọn, hệ thống giữ behavior cũ.
- Nếu chọn `Tầng sâu`, prompt quote sẽ dùng tone/vocabulary hiện đại hơn và tránh wording Phật pháp trực diện.

Quote option groups hiện được quản lý tập trung:

- `topicFamily`
- `quoteStyle`
- `visualMood`
- `musicMood`
- `audienceProfile`
- `channelProfile`
- `contentType`, `teachingType`, `contentMood`, `audienceIntent`, `retentionDevice`, `openingSceneType`, `visualMotif` (added 2026-06-07)

## Audience Profile Layer

Audience profiles sống trong `src/lib/prompt-studio-registry.ts` dưới dạng static TypeScript registry (không phải DB).

Hai profile hiện có:
- `buddhist_healing_v1` (id: `healing_seekers`) — áp dụng cho `buddhist_healing_workspace` / `phat_phap`
- `tang_sau_v1` (id: `modern_reflective`) — áp dụng cho `tang_sau_workspace` / `tang_sau`

Mỗi profile gồm 10 trường: `audienceDescription`, `ageRange`, `audiencePainPoints`, `audienceDesires`, `tonePreference`, `visualPreference`, `avoidedTone`, `avoidedVisuals`, `bestKnownAngles`, `experimentalAngles`.

Tích hợp hiện tại:
- **Quote Short generation**: audience context (pain points, desires, tone) được inject vào system prompt của tất cả LLM generators khi `channelProfileId` khớp với profile.
- **Image prompt generation** (`src/lib/pipeline/images.ts`): `buildImagePromptPair()` inject `TARGET AUDIENCE`, `AUDIENCE VISUAL PREFERENCE`, `AVOID THESE VISUALS` vào system prompt cho cả Buddhist và Psychology pipelines.
- **UI**: `/content/prompts` hiển thị Audience Profiles section (pain points, desires, visual preference, avoided visuals). `/content/workspaces` hiển thị audience summary card dưới stats grid của mỗi workspace.
- **Sidecar**: `tags.audienceIntent` được ghi vào Quote Short sidecar khi generate.

Audience data là static — không có automatic feedback loop. Nếu cần update data từ performance analytics, phải sửa thủ công trong registry.

`PERFORMANCE_DIMENSIONS` định nghĩa 8 dimensions để future analytics segmentation (source, description cho mỗi dimension). Không có pipeline nào tự đọc hay ghi dimensions này hiện tại.

Lưu ý vận hành:

- Prompt Studio không thay thế ngay DB Prompt Editor cũ trong `/niches`.
- DB prompt templates đang active vẫn được hiển thị để đối chiếu.
- Trước khi feed Prompt Studio ngược vào production prompts hoặc cron, cần có explicit implementation riêng; không tự suy diễn.

---

## Daily Commands

| Task | Command |
|------|---------|
| Health check (one-liner) | `pnpm ops:health` |
| Full capacity report | `pnpm production:capacity` |
| Storage usage report | `pnpm storage:report` |
| Cleanup uploaded assets (dry-run) | `pnpm cleanup:uploaded-assets` |
| Cleanup uploaded assets (delete) | `pnpm cleanup:uploaded-assets:delete` |
| Audit-cancel old Facebook quote backlog (dry-run) | `pnpm facebook:quotes:cancel:dry-run` |
| Cancel old Facebook quote backlog (execute) | `pnpm facebook:quotes:cancel` |
| Sync YouTube analytics manually | `tsx --tsconfig tsconfig.json scripts/run-yt-analytics-sync.ts` |
| Dry-run historical YouTube import | `pnpm youtube:historical:dry-run` |
| Execute historical YouTube import | `pnpm youtube:historical:sync` |
| Check YouTube token expiry | `tsx --tsconfig tsconfig.json scripts/check-yt-reauth.ts` |
| DB migrations | `pnpm db:migrate` |
| Verify upload schedule safety | `pnpm verify:upload-schedule` |

---

## Important Feature Flags

### 1. `CONTENT_GEN_MODEL`

| | |
|---|---|
| **Default** | `openai/gpt-4o-mini` (via OpenRouter) |
| **Controls** | LLM model used for short script generation, hook generation, and title scoring |
| **When to change** | Upgrade to GPT-4o for quality experiments; downgrade to a cheaper model to cut costs |
| **Safe range** | Any OpenRouter model identifier; tested with `openai/gpt-4o-mini`, `openai/gpt-4o` |
| **Danger** | Changing to a model with a different context window may cause JSON parse failures in structured outputs |

### 2. `LONGFORM_MODEL`

| | |
|---|---|
| **Default** | `google/gemini-2.0-flash` (via OpenRouter) |
| **Controls** | LLM model used for long-form script generation and metadata (title, description, chapters, tags) |
| **When to change** | Upgrade to Gemini Pro or GPT-4o for higher quality; switch if Gemini rate-limits |
| **Safe range** | Any OpenRouter model with ≥ 128k context window (long scripts need headroom) |
| **Danger** | Short-context models will fail mid-script; structured JSON output format must be supported |

### 3. `CONTENT_EXPERIMENT_VARIANT`

| | |
|---|---|
| **Default** | `HOOK_V1` |
| **Controls** | Which A/B variant is assigned to all newly generated content |
| **Valid values** | `HOOK_V1`, `HOOK_V2`, `TITLE_V1`, `TITLE_V2`, `THUMBNAIL_V1`, `THUMBNAIL_V2` |
| **When to change** | Start a new experiment batch; switch mid-run is safe — existing rows keep their original variant |
| **Danger** | Mixing variants within a batch makes analytics comparisons noisy; complete a batch before switching |

### 4. `CONTENT_EXPERIMENT_ID`

| | |
|---|---|
| **Default** | Auto-inferred from variant (e.g. `HOOK` from `HOOK_V1`) |
| **Controls** | Experiment group label stored on each content row |
| **When to change** | Override when running a named experiment that doesn't follow the auto-infer pattern |
| **Danger** | Mismatched IDs across a batch breaks the analytics grouping in the dashboard |

### 5. `SHORT_COVER_INTRO_ENABLED`

| | |
|---|---|
| **Default** | `false` |
| **Controls** | Whether a static cover image intro is prepended to short videos before the main content |
| **When to change** | Enable for branding experiments; disable to revert to plain shorts |
| **Safe range** | `true` / `false` (also accepts `1`/`0`, `yes`/`no`) |
| **Danger** | Enabling this extends video duration — ensure total video remains ≤ 60s or YouTube Shorts eligibility may be affected |

### 6. `SHORT_COVER_DURATION_SEC`

| | |
|---|---|
| **Default** | `1.5` |
| **Controls** | How long the cover intro frame is displayed (seconds) |
| **When to change** | Tune for branding impact vs. watch-time cost |
| **Safe range** | `0.25` – `3.0` (clamped automatically to audio duration) |
| **Danger** | Values > 3s noticeably eat into the 60s budget; combined with fade-out must leave at least 0.05s hold |

### 7. `SHORT_COVER_FADE_OUT_SEC`

| | |
|---|---|
| **Default** | `0.25` |
| **Controls** | Duration of the fade-out transition at the end of the cover intro |
| **When to change** | Smooth branding transitions; set to `0` for instant cut |
| **Safe range** | `0.0` – `(SHORT_COVER_DURATION_SEC - 0.05)` (auto-clamped) |
| **Danger** | Setting this longer than the cover duration causes the clamp to force it to 0 with no warning |

### 8. `MAX_PENDING_UPLOAD_QUEUE`

| | |
|---|---|
| **Default** | `60` |
| **Controls** | Upload queue depth threshold; generation is paused when queue exceeds this |
| **When to change** | Raise if upload throughput improves; lower if disk/bandwidth is constrained |
| **Safe range** | `10` – `200` |
| **Danger** | Setting too high allows unbounded queue growth, which causes memory and disk pressure |

Suggested balance policy:

- Global pending max: `60`
- Facebook quote/photo soft cap: `15`
- Facebook total soft cap: `25`
- Protected YouTube headroom: keep at least `20` pending slots available when possible

These are warning thresholds first. Cron uploads are never blocked by this policy.

### 9. `MAX_UNPUBLISHED_RENDERED_VIDEOS`

| | |
|---|---|
| **Default** | `30` |
| **Controls** | How many rendered (done) videos can sit uncleaned before new rendering is paused |
| **When to change** | Raise during scheduled bulk uploads; lower if disk is tight |
| **Safe range** | `10` – `100` |
| **Danger** | High values keep rendered MP4s on disk indefinitely — combine with cleanup scheduling |

### 10. `MAX_MEDIA_SIZE_GB`

| | |
|---|---|
| **Default** | `10` (GB) |
| **Controls** | Total `media/` directory size threshold; generation and rendering pause when exceeded |
| **When to change** | Adjust based on available disk; run `pnpm storage:report` to see current usage |
| **Safe range** | `5` – `50` (stay well below physical disk) |
| **Danger** | Setting above free disk capacity defeats the disk-floor check (`MIN_FREE_DISK_GB`) |

### 11. `MIN_FREE_DISK_GB`

| | |
|---|---|
| **Default** | `30` (GB) |
| **Controls** | Minimum free disk required for generation and rendering to proceed |
| **When to change** | Lower on small-disk servers (careful); raise if ffmpeg temp files are large |
| **Safe range** | `5` – `100` |
| **Danger** | Setting below ~5 GB risks ffmpeg and TTS temp file failures mid-render |

### 12. `MAX_DAILY_NEW_CONTENT`

| | |
|---|---|
| **Default** | `20` |
| **Controls** | Maximum new content_generations rows created in a calendar day; blocks **only** new script generation (not existing renders) |
| **When to change** | Lower to reduce API costs; raise during catch-up days |
| **Safe range** | `1` – `100` |
| **Danger** | This is a soft limit — already-created content will continue through the render pipeline regardless |

### 13. `AUTO_REFILL_ENABLED`

| | |
|---|---|
| **Default** | `false` |
| **Controls** | Whether the Auto Refill Watcher may run from cron after upload processing |
| **When to change** | Enable for unattended periods only after verifying queue health and dry-run output |
| **Safe range** | `true` / `false` |
| **Danger** | If enabled with bad routing or stale queue metadata, the watcher may keep creating queued rows repeatedly until the low-water policy is adjusted |

### 14. `AUTO_REFILL_LOW_WATERMARK`

| | |
|---|---|
| **Default** | `45` |
| **Controls** | Queue depth below which Auto Refill is allowed to start planning inserts |
| **When to change** | Raise if you want earlier refill; lower if queue pressure should drain further before refill |
| **Safe range** | `10` – `MAX_PENDING_UPLOAD_QUEUE - 2` |
| **Danger** | Setting too high makes the watcher run too often and can crowd queue headroom needed for manual experiments |

### 15. `AUTO_REFILL_TARGET_PENDING`

| | |
|---|---|
| **Default** | `55` |
| **Controls** | Target queue depth the watcher refills toward when it runs |
| **When to change** | Raise only if upload throughput is stable and you want more unattended runway |
| **Safe range** | `AUTO_REFILL_LOW_WATERMARK` – `MAX_PENDING_UPLOAD_QUEUE - 2` |
| **Danger** | The watcher clamps this to keep at least 2 free slots, but setting it too high still reduces operational headroom |

### 16. `AUTO_REFILL_MAX_GENERATE_PER_RUN`

| | |
|---|---|
| **Default** | `8` |
| **Controls** | Maximum number of new Quote Shorts the watcher may generate in one run |
| **When to change** | Lower if generation cost or render backlog is rising; raise carefully for unattended weekends |
| **Safe range** | `0` – `20` |
| **Danger** | High values can increase render backlog quickly even if upload queue is healthy |

### 17. `AUTO_REFILL_MAX_QUEUE_INSERTS_PER_RUN`

| | |
|---|---|
| **Default** | `12` |
| **Controls** | Hard cap on how many `upload_queue` rows Auto Refill may create in one run |
| **When to change** | Lower to keep the watcher more conservative; raise only if queue headroom and destination cadence both justify it |
| **Safe range** | `1` – `20` |
| **Danger** | Setting this too high can refill multiple destinations at once and make queue balance harder to reason about |

---

## Content Intelligence Dashboard (Read-Only)

**Route:** `/publishing/analytics/content-intelligence`

**Scope:** Tầng Sâu channel only (channel_key = `tang_sau`, platform_account_id = 4).

**Access:** Sidebar → Đăng bài → Content Intel

**What it shows:**

| Tab | Description |
|-----|-------------|
| Format | Performance by `experiment_variant` (Short Quote Classic, Kinetic Text, Bilingual Minimal, Reflection Card, Note Letter) — views, likes, like/view ratio, views 24h/48h, sufficiency badge |
| Topic Family | Views aggregated by inferred topic family (Kiệt sức hiện đại, Chính xác/Bản thân, Cô đơn, Triết lý, etc.) |
| Hook Pattern | Views aggregated by inferred hook pattern from `short_content` text |
| Learning Lineage | Last 50 items with variant, topic family, hook pattern, hotfix group badge |

**Data sufficiency badges:**
- Quá sớm (< 3 published)
- Định hướng (3–9 published)
- Đủ để đánh giá (10–24 published)
- Đủ cho auto-learning (≥ 25 published)

**Hotfix group timeline:**
- Pre Style Pack: before 2026-06-05 15:00 UTC (LEGACY_QUOTE_NO_VOICE_V2 only)
- Post Style Pack: 2026-06-05 15:00 – 2026-06-07 08:00 UTC (Text Style Pack introduced)
- Post Kinfolk Fix: from 2026-06-07 08:00 UTC (Kinfolk/Monocle visual reset applied)

**Important:** This dashboard is strictly read-only. No mutations to DB, queue, upload, or media. The recommendations section only shows suggested actions — none are applied automatically.

**Analytics data (Phase A — as of 2026-06-08):**
- `avg_view_duration_sec` and `retention_pct`: populated via YouTube Analytics API (1,565/4,927 snapshots — 32% coverage, delay expected).
- `share_count`, `estimated_minutes_watched`, `subscribers_gained`, `subscribers_lost`: Phase A additions. Written to `video_metric_snapshots` on each cron-triggered analytics sync. Backfilled for last 90 days via `scripts/backfill-yt-phase-a.ts` on 2026-06-08 (100 videos, 72 with full analytics, 28 Data API only). Post-backfill coverage: 178/4210 snapshots with share_count/subs_gained/lost, 134/4210 with estimated_minutes_watched.
- `engaged_views`: schema column reserved; null until a supported API method is available.
- `ctr`: permanently null — Google API blocks impressions data at this scope.
- Dashboard shows "—" for null values. Phase A columns appear in Era Performance tab under "Avg Shares / Share/View / Avg Mins Watched / Subs Gained".

---

## Current Operational Rules

1. **Upload queue runs first, always.** `processUploadQueueAction` is never gated by backpressure.
2. **Analytics sync is never gated.** YouTube and Facebook analytics run on every cron tick regardless of capacity.
3. **Pipeline rendering ignores the daily generation limit.** Once a script exists, `short_pipeline` and `long_pipeline` proceed even if `MAX_DAILY_NEW_CONTENT` is hit.
4. **Cleanup runs on every cron tick** after scheduler jobs. It only deletes files where `mediaScheduledCleanAt` is in the past and `mediaCleanedAt` is null.
5. **Advisory lock prevents concurrent cron runs.** If a cron run is still in progress when the next tick fires, the new tick exits immediately.
6. **Backpressure Telegram alerts are rate-limited to 30 minutes.** State is stored in `appConfig.backpressure_state`.
7. **The `storage:report` and `cleanup:uploaded-assets` scripts are safe to run any time.** The cleanup script defaults to dry-run; add `--delete` to actually remove files.
8. **Never delete files from `media/videos` or `media/images` manually** unless you've verified no pending upload references them — use the cleanup scripts instead.
9. **Auto Refill Watcher never uploads.** It may only generate content and/or insert `upload_queue` rows, and only when `AUTO_REFILL_ENABLED=true`.
10. **Auto Refill always leaves at least 2 queue slots free.** It does not refill past `MAX_PENDING_UPLOAD_QUEUE - 2`, and it skips entirely when queue is still above `AUTO_REFILL_LOW_WATERMARK`.

---

## YouTube Analytics Phase A Backfill

**Script:** `scripts/backfill-yt-phase-a.ts`

**Purpose:** Backfill Phase A analytics metrics (`share_count`, `estimated_minutes_watched`, `subscribers_gained`, `subscribers_lost`) into `video_metric_snapshots` for existing published videos. Always inserts new snapshot rows — never modifies existing rows.

**Commands:**

```bash
# Dry-run (no writes) — 90-day window, 100 videos
pnpm youtube:backfill-phase-a:dry-run

# Execute — 90-day window, 100 videos (default)
pnpm youtube:backfill-phase-a:run

# Execute — all time, 200 videos
pnpm youtube:backfill-phase-a:run -- --all-days --limit 200

# Execute — last 30 days only, 50 videos
pnpm youtube:backfill-phase-a:run -- --days 30 --limit 50
```

**Flags:**
- `--dry-run` / `--execute` — required, one or the other
- `--limit N` — max videos to process (default: 100)
- `--days N` — analytics window in days back (default: 90)
- `--all-days` — full historical window (overrides `--days`)
- `--channel phat_phap` — only supported channel (default: phat_phap)

**Safety:** Never touches `upload_queue`, never uploads, never deletes media. Inserts only into `video_metric_snapshots`.

**Quota note:** Each video consumes 1 Data API unit + 1 Analytics API call. 100-video run ≈ 200 API calls — well under daily quota.

**First run results (2026-06-08, 90-day scope, limit 100):**
- Videos processed: 100 of 170 in scope
- Snapshots inserted: 100 (72 with full Phase A analytics, 28 Data API only)
- Before: share_count non-null 84 → After: 178

**To backfill remaining videos:** Run `pnpm youtube:backfill-phase-a:run -- --all-days --limit 200` (processes up to 200 videos from oldest to newest).

---

## Auto Refill Watcher

Auto Refill Watcher V1 is a queue-health helper for unattended publishing windows such as weekends.

What it does:

- runs after upload processing inside the existing cron route
- checks current pending queue depth
- skips if queue is still healthy/high
- audits the next 48 hours for:
  - `YouTube · Tầng Sâu`
  - `YouTube · Giới Định Tuệ`
  - `Facebook · Trí Tuệ An Nhiên`
- fills safe queue gaps up to the configured target
- may generate new `Tầng Sâu` Quote Shorts if that destination has gap slots but no ready pool
- records the latest watcher state in `appConfig.auto_refill_watcher_state`

What it does **not** do:

- does not upload
- does not call `processUploadQueueAction`
- does not bypass wrong-channel or workspace routing guards
- does not auto-enable TTS for `Tầng Sâu`
- does not inject untagged Buddhist quote pool into `Tầng Sâu`
- does not create new Facebook quote/photo backlog

Current priority order:

1. `YouTube · Tầng Sâu`
   - quote-only
   - `07:00–22:00` VN
   - 1 hour cadence
2. `YouTube · Giới Định Tuệ`
   - prefer ready TTS Shorts first
   - then safe Buddhist Quote Shorts
3. `Facebook · Trí Tuệ An Nhiên`
   - only if YouTube queue health is acceptable and soft-cap warnings are not already dominant

Quick controls:

- Disable immediately:
  - set `AUTO_REFILL_ENABLED=false`
- Safe dry-run:
  - `pnpm auto-refill:dry-run`
- Real watcher run from shell:
  - `pnpm auto-refill:run`

Safety rules:

- dry-run must not mutate DB, queue, upload, or media
- cron remains the only real publisher
- Auto Refill inserts `upload_queue` rows only with `status = queued`
- Auto Refill must keep pending queue at or below `MAX_PENDING_UPLOAD_QUEUE - 2`
- if queue is still crowded, Auto Refill must skip and report why
- Tầng Sâu content must remain YouTube-only and quote-only unless TTS/profile routing is explicitly expanded later
- **Visual reset guard (2026-06-07):** `getDestinationCandidates` for `youtube_tang_sau` permanently excludes any `content_id` that has an `upload_queue` row with `status=cancelled` AND `error_message=tang_sau_visual_topic_reset`. To permanently block a bad Tầng Sâu content_id, cancel its queue row(s) with that error_message — no code change needed.

**Tầng Sâu visual reset — how to block a content_id permanently:**
```sql
-- Cancel all active rows and stamp error_message so guard picks them up:
UPDATE upload_queue
SET status = 'cancelled',
    error_message = 'tang_sau_visual_topic_reset',
    updated_at = NOW()
WHERE content_id = '<the-bad-content-id>'
  AND status IN ('queued', 'uploading', 'error');
-- Also stamp any previously cancelled rows (no status filter needed for those):
UPDATE upload_queue
SET error_message = 'tang_sau_visual_topic_reset', updated_at = NOW()
WHERE content_id = '<the-bad-content-id>'
  AND status = 'cancelled'
  AND (error_message IS NULL OR error_message != 'tang_sau_visual_topic_reset');
```
The guard in `getDestinationCandidates` (`src/lib/auto-refill-watcher.ts`) reads all cancelled rows with that `error_message` and adds them to `usedContentIds` before the candidate filter runs, so they can never be re-scheduled by auto-refill.

---

## Recovery Playbooks

### Tầng Sâu visual reset (2026-06-07)

**Problem:** 11 pre-hotfix Tầng Sâu items with Buddhist/spiritual visual keywords (`cinematic spiritual footage`, `meditation pose`, etc.) were cancelled but auto-refill kept re-creating new queue rows every minute because `getDestinationCandidates` reads `content_generations` directly (not sidecar files) and only excluded `queued/uploading/done` rows from the candidate set — cancelled rows re-qualified.

**Fix applied:**
1. `src/lib/auto-refill-watcher.ts` — `getDestinationCandidates` for `youtube_tang_sau` now also loads all cancelled `upload_queue` rows with `error_message = tang_sau_visual_topic_reset` into `usedContentIds` before the candidate filter runs.
2. All 11 unsafe content_ids (42 historical queue rows) stamped with `error_message = tang_sau_visual_topic_reset`.
3. Sidecar files for 11 unsafe items renamed to `.json.excluded` so `readLegacySidecarSamples()` cannot find them.

**Unsafe content_ids (permanently blocked):**
`qgen-mq11xsny-gkd3p`, `qgen-mq11xznu-qu186`, `qgen-mq11y6kd-d1tdc`, `qgen-mq11ydg8-zczkt`, `qgen-mq11yk41-5qer6`, `qgen-mq11yruf-xn2ls`, `qgen-mq11yxwf-py32g`, `qgen-mq11z4rn-sfwz1`, `qgen-mq1rnjwt-bk5a8`, `qgen-mq1ro1qk-66zl7`, `qgen-mq1rob6d-u6tut`

**One item published before fix** (`qgen-mq1rob6d-u6tut`, published 2026-06-07 at 11:00 VN) — manual review in YouTube Studio required; do not auto-delete.

**To block a new bad content_id:** see the SQL in the Auto Refill safety rules section above.

---

### Old Facebook quote backlog

After confirming [docs/FACEBOOK_QUEUE_BACKLOG_AUDIT.md](/Users/bichtuyen/code/content_pipline/docs/FACEBOOK_QUEUE_BACKLOG_AUDIT.md), use:

1. `pnpm facebook:quotes:cancel:dry-run`
2. Confirm the script still selects exactly the audited safe set.
3. `pnpm facebook:quotes:cancel`

The script only cancels old queued Facebook quote rows matching the audited `safe_to_cancel_old_quote` criteria. It does not touch Facebook reels, media files, `content_generations`, `published_videos`, or analytics tables.

### Upload queue stuck (items in `error` state)

1. `pnpm ops:health` — check how many errors, read error messages.
2. Check YouTube/Facebook token expiry: `tsx --tsconfig tsconfig.json scripts/check-yt-reauth.ts`
3. If token expired: re-authenticate via `/channels` page in the UI, then reset queue items:
   ```sql
   UPDATE upload_queue SET status = 'queued', error_message = NULL WHERE status = 'error';
   ```
4. Re-run `pnpm ops:health` — queue should start draining on next cron tick.

### Generation paused (backpressure active)

1. `pnpm production:capacity` — identify which violations are blocking.
2. **Upload queue too large:** Wait for uploads to drain, or manually trigger upload: call `/api/cron/run`.
3. **Too many rendered videos on disk:** If `tang_sau` has a large backlog of queued items, the threshold may need to be raised instead of cleaned. Set `MAX_UNPUBLISHED_RENDERED_VIDEOS=80` (or higher) in `.env.local` — Next.js dev server picks up the change automatically (watch for `Reload env: .env.local` in the server log). Default is 30, which is easily exceeded when both `tang_sau` (44 queued videos) and `phat_phap` (13+ pending renders) are active simultaneously. After raising, the next cron tick unblocks `short_pipeline`. Otherwise, run `pnpm cleanup:uploaded-assets:delete` to free space.
4. **Media size too large:** Run `pnpm storage:report` then `pnpm cleanup:uploaded-assets:delete`.
5. **Low free disk:** Free disk externally (clear logs, docker images, etc.) then verify with `pnpm ops:health`.
6. **Daily limit hit:** Wait for midnight UTC reset, or temporarily raise `MAX_DAILY_NEW_CONTENT`.

### TTS audio artifact — Artifact Type A: Markdown separator ("tts_asset_may_be_pre_sanitizer")

**Symptom:** A queued TTS Short is blocked at upload with `tts_asset_may_be_pre_sanitizer`, or a published video has a stretched/elongated first word.

**Root cause:** The `short_content` field starts with a standalone Markdown separator (`---`) that was not stripped before sending to VieNeu-TTS. VieNeu-TTS treated the separator as a speakable prosody token, elongating the first real word.

**Fix committed:** Commit `3741701` (2026-06-07) — `normalizeTextForTTS` now strips standalone `---`, `***`, `___` separators before TTS submission.

**Pre-publish guard:** If a TTS Short with `---` prefix was rendered before `2026-06-04T04:33:00Z`, the upload is blocked with `tts_asset_may_be_pre_sanitizer`. To repair:

1. Find the blocked queue row:
   ```sql
   SELECT id, content_id, scheduled_at FROM upload_queue WHERE error_message = 'tts_asset_may_be_pre_sanitizer';
   ```
2. Reset TTS status to re-render audio and video:
   ```sql
   UPDATE content_generations SET
     tts_status = 'pending', tts_error_message = NULL,
     video_status = 'pending', video_error_message = NULL,
     audio_path = NULL, video_path = NULL
   WHERE id = '<content_id>';
   ```
3. Reset the queue row back to queued:
   ```sql
   UPDATE upload_queue SET status = 'queued', error_message = NULL WHERE id = '<queue_id>';
   ```
4. Cron will re-render TTS and video with the fixed normalizer on the next tick.

**Already-published posts with the artifact:** Cannot be repaired automatically. Decide manually whether to leave as-is or delete from the platform.

---

### TTS audio artifact — Artifact Type B: "nhX, nhY" phonological pair elongation (2026-06-08)

**Symptom:** A published TTS Short has a word elongated mid-sentence (e.g. "nhưuuuu" lasting 1–2s instead of ~0.2s), typically in the 00:08–00:20 window. The artifact is NOT at the very start of the video and not caused by a Markdown separator.

**Confirmed example:** Video `GxR_7Ib73Nw` (contentId `8fc6f065-c63b-4837-9a31-ee87e96c2fe3`), topic "Nỗi sợ bị ruồng bỏ", voice ngoc. Whisper analysis showed word "như" at 11.34s–13.02s (1.68s, 10× normal). Root cause: the phrase "trên mái nhà, như đang thì thầm" — both "nhà" and "như" start with "nh-" and are separated by a comma. VieNeu-TTS ngoc voice produces a loop/stuck artifact on this phonological pair.

**Fix committed:** 2026-06-08 — `normalizeTextForTTS` now converts `(nhX), (nhY)` comma pairs to `(nhX). (nhY)` via:
```
.replace(/(nh\p{L}*),\s*(nh)/gu, "$1. $2")
```
This applies a prosody break (period) between any two "nh-" words separated by a comma, preventing the elongation.

**Pattern this catches:** `nhà, như` → `nhà. như` · `nhiều, nhưng` → `nhiều. nhưng` · `nhỏ, nhẹ` → `nhỏ. nhẹ`

**Cache impact:** Content regenerated after this fix gets a new TTS cache hash — the TTS API will be called again. Old cached audio at the pre-fix hash remains on disk but is never served (different hash). Existing published videos with this artifact cannot be automatically repaired.

**Repair of an already-rendered item (not yet uploaded):**
1. Reset TTS + video status to force re-render:
   ```sql
   UPDATE content_generations SET
     tts_status = 'pending', tts_error_message = NULL,
     video_status = 'pending', video_error_message = NULL,
     audio_path = NULL, video_path = NULL
   WHERE id = '<content_id>';
   ```
2. Cron picks up on next tick and regenerates with the patched normalizer.

**Already-published posts with the artifact:** Cannot be repaired automatically. Decide manually whether to leave as-is or delete/replace on YouTube.

**Scanning for risky queued content:**
```bash
node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/scan-tts-risk.ts
```
Reports any queued TTS Short that still contains an unresolved `nhX, nhY` pattern (should be 0 for content generated after the fix).

### TTS failures (ttsStatus = 'error')

1. Check if TTS API is up: `curl http://localhost:8765/health` (or `$TTS_API_URL/health`).
2. If down, restart the VieNeu-TTS service.
3. Reset failed TTS jobs:
   ```sql
   UPDATE content_generations SET tts_status = 'pending', tts_error_message = NULL
   WHERE tts_status = 'error';
   ```
4. Cron will pick them up on next tick.

### Long-form render stuck

1. `pnpm ops:health` — check `longVideoStatus` breakdown.
2. Inspect `long_video_error_message` for the stuck row.
3. If it's a TTS issue, see TTS playbook above.
4. If it's an ffmpeg crash (usually disk full), free disk first then reset:
   ```sql
   UPDATE content_generations SET long_video_status = 'pending', long_video_error_message = NULL
   WHERE long_video_status = 'error';
   ```

### YouTube analytics not updating

1. `tsx --tsconfig tsconfig.json scripts/check-yt-reauth.ts` — check token status.
2. If token expired: re-authenticate via `/channels` UI page.
3. Manual sync: `tsx --tsconfig tsconfig.json scripts/run-yt-analytics-sync.ts`
4. Check `publishedVideos` table — rows with `youtubeVideoId` null will be skipped.

### Experiment data contaminated (mixed variants in batch)

1. Identify the contaminated date range in the analytics dashboard.
2. Mark those rows with a corrected experimentId:
   ```sql
   UPDATE content_generations SET experiment_variant = 'HOOK_V1', experiment_id = 'HOOK'
   WHERE created_at BETWEEN '2024-01-01' AND '2024-01-02'
   AND experiment_variant != 'HOOK_V1';
   ```
3. Note the correction in `docs/DECISIONS.md`.

### Cron gap detected (Telegram alert fires)

1. Check server uptime — was there a restart?
2. Check `/api/cron/run` HTTP logs for 5xx responses.
3. If the cron trigger (external) was down, content may have missed publish windows.
4. Manually reschedule: set `scheduledAt` on affected upload_queue rows to near-future timestamps.

### Media directory exceeds threshold

1. `pnpm storage:report` — see breakdown and safe-to-delete estimate.
2. `pnpm cleanup:uploaded-assets:delete` — removes media for already-uploaded content.
3. If still over threshold, lower `MAX_MEDIA_SIZE_GB` temporarily or clean output/:
   ```bash
   rm -rf output/experiment_*
   ```
4. Verify with `pnpm ops:health`.

---

## Buddhist Visual Direction V1 (2026-06-09)

### Overview

All `phat_phap` / `buddhism` image generation now uses **BUDDHIST_VISUAL_V1** — bright, sacred, warm, uplifting, clearly Buddhist.

Tone: bright · peaceful · sacred · warm · clean · uplifting · hopeful · luminous · elegant · emotionally comforting  
Avoid: dark · gloomy · horror · cold · generic AI poster · tiny subject · cropped head

**Applies to:**
- `channelKey = phat_phap` or `contentProfileKey = buddhism`
- Does **not** affect Tầng Sâu / `psychology` paths

### V1 Visual Categories (12 + 1 practical lane)

| Category | Label | Best For |
|---|---|---|
| BUDDHA_GOLDEN_ENLIGHTENMENT | Phật vàng giác ngộ | trí tuệ, tỉnh thức, giác ngộ, vô thường |
| GUANYIN_WHITE_JADE_COMPASSION | Quan Âm ngọc trắng từ bi | chữa lành, tha thứ, bình an, mệt mỏi |
| AMITABHA_PURE_LAND_LIGHT | A Di Đà cõi sáng | niệm Phật, an lạc, tịnh độ |
| BODHISATTVA_BRIGHT_VOW | Bồ Tát hạnh nguyện | làm thiện, hạnh nguyện, giúp đời |
| LOTUS_PARADISE_PEACE | Hồ sen an nhiên | bình an, thiền, tâm tĩnh |
| TEMPLE_SUNRISE_SERENITY | Chùa sáng bình minh | tu tập, giới định tuệ, kỷ luật |
| BAMBOO_MEDITATION_GREEN | Rừng trúc thiền định | chánh niệm, định lực, tĩnh lặng |
| SKY_CLOUD_HEAVENLY_BUDDHA | Phật giữa mây trời | hy vọng, vượt qua, khai sáng |
| DHARMA_CITY_LIGHT | Phật pháp giữa đời | tiền, áp lực, công việc, xã hội |
| SCRIPTURE_CANDLE_GOLD | Kinh sách ánh nến vàng | lời Phật dạy, sám hối, giới luật |
| MANDALA_BRIGHT_KARMA | Mandala nhân quả sáng | nhân quả, nghiệp, luân hồi, duyên |
| VIETNAMESE_BUDDHIST_TEMPLE | Chùa Việt thanh bình | hiếu đạo, gia đình, cầu bình an |
| PRACTICAL_DAILY_LIFE | Phật pháp đời thường | sống an lạc mỗi ngày, ứng dụng giáo lý |

### Topic → Category Mapping

Deterministic keyword-based: `getBuddhistVisualCategory(topic, scriptHint)` in `src/lib/config/buddhist-visual-categories.ts`.

Fallback pool (no keyword match): LOTUS_PARADISE_PEACE → TEMPLE_SUNRISE_SERENITY → BUDDHA_GOLDEN_ENLIGHTENMENT → VIETNAMESE_BUDDHIST_TEMPLE (hash-seeded, deterministic).

### Practical Buddhism Daily-Life Exception

Topics matching daily-life patterns (`ứng dụng giáo lý`, `sống an lạc mỗi ngày`, `chánh niệm trong việc nhỏ`, `một phút dừng lại`, `tách trà buổi sáng`) use warm daily-life visuals — tea cup, morning window, prayer beads nearby — instead of large Buddha statue imagery. This lane is first-priority in the mapping logic.

### Sample Prompts

See `output/manifests/buddhist-visual-v1-sample-prompts.json` for 12 dry-run sample prompts (one per category).

### Composition Rules (all Buddhist prompts)

- Main Buddhist subject: 55–70% of frame
- Subject must NOT be tiny or cropped
- Vertical 9:16
- No text/signage/watermark/logo in image
- Clear silhouette, enough clean space for subtitles at bottom
- Style: realistic cinematic Buddhist art

### Negative Prompt (all Buddhist generation)

`text, watermark, logo, blurry, dark horror atmosphere, gloomy, depressing, scary face, distorted face, deformed hands, western angel, christian cross, gothic church, fantasy warrior armor, weapon, blood, fire, demon, skull, cyberpunk neon, cartoon, anime, overexposed, oversaturated, tiny subject, cropped head, dark gloomy colors, cold gray-green fog, horror temple, ruined temple, sad monk, generic AI poster`

### Metadata Added to Sidecar / promptVersions

Each Buddhist generation now stores:

```json
{
  "buddhistVisualCategory": "LOTUS_PARADISE_PEACE",
  "buddhistVisualCategoryLabel": "Hồ sen an nhiên",
  "visualBrightness": "bright",
  "emotionalTone": "peaceful_uplifting",
  "visualPromptVersion": "BUDDHIST_VISUAL_V1",
  "visualStyle": "bright_sacred_buddhist",
  "practicalDailyLifeVisual": false,
  "colorPalette": "jade green, warm sunlight, ivory white, lotus pink"
}
```

### Safety Rules

- No upload, no schedule, no processUploadQueueAction called during this change.
- Buddhist V1 changes do NOT leak into Tầng Sâu — `isTangSauContext()` / `isTangSauInput()` guards are preserved.
- DB schema: no migration needed. Metadata stored in existing `promptVersions` JSON column and sidecar JSON file.
- Existing queued/published content: unchanged (no historical sidecar rewrite).

## TTS Pacing Audit — "Khựng" Root Cause (2026-06-12)

### Problem

After Pass 2 TTS remediation (deterministic punctuation-pause injection), 26 phat_phap tts_short items sound "khựng" — stuttered/unnaturally interrupted.

### Root Cause: Double-Pause Stacking

**PRIMARY cause:** The `BUDDHIST_CALM_PROFILE` pause constants **exceed** Buddhist pacing guidelines, AND the `silenceremove` normalization filter was changed in Pass 1 to preserve natural TTS pauses. So injected pauses stack ON TOP of preserved natural pauses.

| Pause type | Profile value | Guideline max | Natural TTS pause (est) | Stacked total | Exceeds by |
|---|---|---|---|---|---|
| Comma (`,`) | 220ms | 180ms | ~150ms | ~370ms | 2× |
| Sentence (`.`) | 560ms | 450ms | ~400ms | ~960ms | 2–3× |

**Why natural pauses are now preserved:**
`normalizeAudioWithLoudnorm` uses `stop_duration=0.80:stop_silence=0.28` — only trims silences >800ms, keeps 280ms. The VieNeu "Ly" voice naturally produces ~100–200ms at commas and ~300–500ms at sentence ends. These are now kept instead of being stripped (old: `stop_duration=0.35:stop_silence=0.16`).

**CONTRIBUTING causes:**
- Cause 2: Whisper timestamps off by ±50–150ms → silence cut may land mid-phoneme → click artifact
- Cause 4: FFmpeg `atrim` hard-cuts at floating-point seconds that may not be zero-crossings → pop at splice

### Diagnostic Data (13 files analyzed)

| ID (8ch) | Topic | Duration | Segs>150ms | Max sil | Ratio | Clusters |
|---|---|---|---|---|---|---|
| aff684e0 | Sự cô đơn trong lòng | 37.8s | 15 | 560ms | 14% | 1 |
| f48a5849 | Mất lòng tự trọng | 36.8s | 15 | 560ms | 14% | 2 |
| fb263643 | Nhân quả khổ đau | 38.9s | 18 | 561ms | 16% | 3 |
| 5d02ce90 | Nỗi nhớ chưa nguôi | 41.0s | 23 | 563ms | 16% | 5 |
| b9977f99 | Tìm kiếm sự chấp nhận | 34.0s | 15 | 560ms | 17% | 2 |
| 122386da | Nỗi đau trả giá | 43.3s | 19 | 560ms | 15% | 3 |
| ea1c1edf | Nỗi đau bị phản bội | 40.7s | 18 | 560ms | 17% | 2 |
| 8285d11f | Lòng tự trọng | 35.2s | 19 | 560ms | 19% | 5 |

"Cluster" = ≥3 pause boundaries within a 3-second window (triggers strong "khựng" perception).

5 preview clips exported: `media/qa/tts-pacing-audit/preview_*.wav`
Audit script: `scripts/audit-tts-pacing.ts`

### Queue Urgency (as of 2026-06-12 12:57 VN)

3 items scheduled within 6h (all Facebook ch=6, Trí Tuệ An Nhiên):
- `8d12d8ba` Ghen tị — scheduled 17:00 VN
- `b9977f99` Tìm kiếm sự chấp nhận — scheduled 13:00 VN
- `2f18fadb` Trả giá vì tham lam — scheduled 15:00 VN

### Fix Options (AWAITING APPROVAL)

| Option | Description | Effort | Quality |
|---|---|---|---|
| **A** | Reduce constants: comma 220→150ms, sentence 560→375ms | Low (constant change + re-render) | Moderate (stacking reduced but not eliminated) |
| **B** | Strip-then-inject: aggressive silenceremove strips all pauses >200ms first, then inject | Medium (2-pass audio) | Good (no stacking, loses natural prosody) |
| **C** | Reduce to guideline ceilings: comma 220→180ms, sentence 560→450ms | Low | Partial (stacked sentence ~850ms still long) |
| **D** | Remove injection entirely, rely on natural TTS prosody | Low (revert) | Reverts to pre-Pass-2 state |
| **E** | Net-addition logic: measure existing silence, inject only the difference | High | Best (precise, zero stacking) |

Recommended order: **E > B > A > C > D**. For urgently-scheduled items: Option A is fastest.

Do NOT re-render, re-run remediation, or cancel queue rows without explicit approval.

## TTS Pause Injection — Feature Flag (2026-06-12)

**Current state: injection OFF (Option D emergency rollback)**

Deterministic pause injection is gated behind `TTS_ENABLE_PUNCTUATION_PAUSES` env flag in `src/lib/pipeline/tts.ts`.

| Value | Behavior |
|---|---|
| unset or `false` (default) | No injection — natural TTS prosody only (loudnorm-only for phat_phap) |
| `"true"` | Injection ON — `BUDDHIST_CALM_PROFILE` constants used (DO NOT enable until Option E is shipped) |

**Why injection is off:** Double-pause stacking caused "khựng" artifacts. See § TTS Pacing Audit above and ADR-023.

**Emergency re-render:** `scripts/emergency-rerender-tts-option-d.ts` re-renders all queued/unpublished phat_phap tts_short items with injection off.

**Re-enable path:** Only after Option E (net-addition logic) is implemented. Option E measures existing silence at each punctuation boundary and injects only the difference: `max(0, targetMs - existingMs)`.

**Silenceremove filter:** ~~Kept at `stop_duration=0.80:stop_silence=0.28`~~ → **SUPERSEDED by ADR-024.** See § TTS Audio Normalization Policy below.

---

## TTS Audio Normalization Policy — Loudnorm-Only for phat_phap (ADR-024, 2026-06-12)

**Current state: loudnorm-only for phat_phap (silenceremove disabled)**

### Background

Native prosody test (`scripts/test-vieneu-native-prosody.ts`) across 3 content IDs × 4 variants showed that silenceremove (`stop_duration=0.80:stop_silence=0.28`) still strips 70–100% of VieNeu's natural prosodic pauses even at the generous 0.80s threshold. Item 8d12d8ba: zero detectable pauses after silenceremove — completely breathless audio. Loudnorm alone preserves pauses faithfully.

### Current normalization policy

| Channel key | silenceremove | loudnorm | Policy |
|-------------|--------------|---------|--------|
| `phat_phap` | **OFF** | ON | loudnorm-only (ADR-024) |
| other | ON | ON | silenceremove + loudnorm (pre-ADR-024, pending audit) |

### How it's enforced

In `src/lib/pipeline/tts.ts`, `normalizeAudioWithLoudnorm()` accepts `{ useSilenceremove: boolean }`.  
`runTTS()` sets `useSilenceremove = channelKey !== "phat_phap"`.

The silenceremove code path is preserved and still active for other channels — it was not deleted.

### QA log fields (new as of ADR-024)

Every TTS run now logs:
```
[TTS-QA] content_id=<id> channel_key=phat_phap loudnorm=true silenceremove=false
         injection=off(disabled) duration=35.5s pauses_150ms=5 pauses_300ms=0 ...
```

Healthy loudnorm-only run: `pauses_150ms` typically 4–10, `pauses_300ms` 0–3.  
If `pauses_150ms=0` for a 30s+ file, investigate — silenceremove may still be running.

### Re-render script

`scripts/rerender-tts-loudnorm-only.ts` — re-renders all 26 queued/unpublished phat_phap tts_short items with loudnorm-only. Run as:
```bash
DATABASE_URL=postgresql://admin:admin123@localhost:5433/content_pipeline \
  npx tsx scripts/rerender-tts-loudnorm-only.ts
```

### Path forward

- Option E (net-addition pause injection): measure existing silence at punctuation boundary, inject `max(0, targetMs - existingMs)`. This brings pacing to guideline (comma 120–180ms, sentence 300–450ms) without stacking. Only re-enable `TTS_ENABLE_PUNCTUATION_PAUSES=true` after Option E ships.
- Consider rewriting scripts to shorter sentences (≤15 words): variant D in the prosody test produced 2× more natural pauses and the only sentence-length pause (656ms) in the entire dataset.
