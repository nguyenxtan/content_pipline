# Visual Rollout Status — 2026-06-12

**Audit date:** 2026-06-12  
**Scope:** Phase 1, Phase 1.1, and Quote Alignment visual pipeline changes  
**Status: NEW VISUAL PIPELINE IS LIVE AND PUBLISHING**

---

## Summary

The new visual pipeline (`image-prompts-v3` / `portrait_16_9` / `cover_safe_v1`) is already running locally and has published YouTube Shorts since **2026-06-11 13:00 UTC**. The code changes are untracked in git (`??` status) but are executing in the local Next.js dev server. Quote Alignment changes (legacy-quote sidecar `imageMeta`, `dimFactor 0.20`) have **not yet produced any new outputs** — the legacy-quote-short pipeline has not been triggered since Jun 8.

---

## 1. Version Transition Timeline

| Version | First published | Last published (approx) | Features |
|---------|----------------|------------------------|----------|
| `image-prompts-v1` | Pre Jun 11 | 2026-06-11 08:00 UTC | Old prompt, no imageSize tracked, no compositionProfile |
| `image-prompts-v2` | 2026-06-11 08:00 UTC | 2026-06-11 12:00 UTC | `portrait_16_9` tracked, no compositionProfile, no heroSubject |
| `image-prompts-v3` | **2026-06-11 13:00 UTC** | now (ongoing) | `portrait_16_9` + `cover_safe_v1` + `heroSubject` + `BUDDHIST_VISUAL_V2` |
| Legacy quote (no version) | 2026-06-08 17:21 UTC | 2026-06-08 17:21 UTC | Frozen pre-Phase-1 artifacts |

---

## 2. Already-Published Old Visual Outputs (YouTube)

All published before 2026-06-11 13:00 UTC — generated under `image-prompts-v1` or v2 (no cover-safe, no heroSubject).

| YouTube ID | Published (UTC) | Topic | Version |
|------------|----------------|-------|---------|
| XXzN3VdAnv0 | Jun 11 00:00 | Sự cô đơn trong lòng | v1 |
| OOz0WZz_D9c | Jun 11 01:00 | Mất lòng tự trọng | v1 |
| iuNfLwQmUT8 | Jun 11 02:00 | Nhân quả khổ đau | v1 |
| eajNiIJ2bUk | Jun 11 03:00 | Nỗi nhớ chưa nguôi | v1 |
| **Zgz2yHvjiFE** | Jun 11 04:00 | Nhẫn không phải yếu (QUOTE) | legacy — pre-Phase-1 |
| **T5IerzhdbOM** | Jun 11 05:00 | Người khôn không tranh (QUOTE) | legacy — pre-Phase-1 |
| **IactiE3pp1I** | Jun 11 06:00 | Không phải chuyện nào (QUOTE) | legacy — pre-Phase-1 |
| ZREPOs5ulkc | Jun 11 07:00 | Cảm giác phản bội | v1 |
| dkZMzAyRw_k | Jun 11 08:00 | Chấp nhận sự im lặng | v2 |
| pzeqmAXVA_k | Jun 11 09:00 | Sự thù hằn | v2 |
| fjl8hxQunEU | Jun 11 10:00 | Sự tha thứ | v2 |
| OKPQz22ungU | Jun 11 11:00 | Cám dỗ và trả giá | v2 |
| GfaNCK_2MSw | Jun 11 12:00 | Tội lỗi và chuộc lỗi | v2 |

The 3 QUOTE entries (bold) are the subjects of the prior forensics audits — confirmed old visual style, pre-Phase-1 pipeline.

---

## 3. Already-Published New Visual Outputs (YouTube)

All carry `image-prompts-v3`, `portrait_16_9`, `compositionProfile: cover_safe_v1`, and a `heroSubject`.

| YouTube ID | Published (UTC) | Topic | Hero | Video path |
|------------|----------------|-------|------|------------|
| nVhXCBJ6HeM | **Jun 11 13:00** | Trả giá cho tham vọng | buddha_statue | `media/videos/941f5c33-...-short.mp4` |
| rAPynzYqDFc | Jun 11 14:00 | Mất mát hy vọng | elder_monk | `media/videos/f97cbd15-...-short.mp4` |
| IxwnbGuxhq8 | Jun 11 15:00 | Chấp nhận sự mất mát | elder_monk | `media/videos/cba79d1b-...-short.mp4` |
| bePRHTCUZHo | Jun 11 23:00 | Tìm kiếm sự tha thứ | guanyin | `media/videos/bb26a433-...-short.mp4` |
| rJBXRMSEtcU | Jun 12 00:00 | Tìm kiếm công bằng | temple_corridor | `media/videos/41059eee-...-short.mp4` |
| MNNzIZaxgQ8 | Jun 12 01:00 | Báo ứng tàn khốc | guanyin | `media/videos/cfc1744e-...-short.mp4` |

**First v3 YouTube Short:** `nVhXCBJ6HeM` — published 2026-06-11 13:00 UTC.

---

## 4. Pending New Visual Outputs (YouTube, queued)

All confirmed `image-prompts-v3` / `portrait_16_9` / `cover_safe_v1` — ready on disk, awaiting cron publish.

| Scheduled (UTC) | Topic | Hero | Content ID | Video path |
|----------------|-------|------|------------|------------|
| Jun 12 02:00 | Nỗi buồn không tên | guanyin | 31ea6daa-... | `media/videos/31ea6daa-...-short.mp4` (20 MB, born Jun 11 22:01) |
| Jun 12 03:00 | Sự cô lập | guanyin | bc583b3d-... | `media/videos/bc583b3d-...-short.mp4` (17 MB, born Jun 12 07:01) |
| Jun 12 04:00 | Sự trả giá ẩn giấu | buddha_statue | bdcb1648-... | `media/videos/bdcb1648-...-short.mp4` |

---

## 5. Facebook Queue State

The Facebook queue (50+ items scheduled Jun 12–14) uses `video_type = 'short'` and `video_type = 'quote'`. Facebook short items reference `content_generations` rows that carry `image-prompts-v1` (no visual metadata change for Facebook — the `quote` posts use the legacy-quote pipeline which has not been re-triggered). These will continue publishing as old visual style until the legacy-quote pipeline is re-run.

---

## 6. Quote Visual Pipeline Status (Legacy Quote Alignment)

| Check | Result |
|-------|--------|
| Any `legacy-quote-short-v1/*.json` sidecar with `imageMeta` field | **0** — no new quote outputs |
| Most recent file in `output/legacy-quote-short-v1/` | `qgen-mq529ylj-45p4k-*` — Jun 8 17:21 UTC |
| `dimFactor` change (0.34 → 0.20) deployed | Code on disk; untracked in git; **has not been used** (no new renders) |
| New keyword routing for wisdom/silence/patience | Code on disk; untracked in git; **has not been used** |
| `getImageConfig()` replacing hardcoded Fal constants | Code on disk; untracked in git; **has not been used** |

**No new-version quote videos have been generated.** The legacy quote short pipeline requires a manual trigger or a new generation run to produce v2 quote outputs.

---

## 7. Metadata Verification (v3 Feature Checklist)

Confirmed from `content_generations.prompt_versions` for queued/published YouTube Shorts:

| Feature | v3 Status | Evidence |
|---------|-----------|----------|
| `imageSize = portrait_16_9` | ✅ ACTIVE | All 3 YouTube queued rows confirmed |
| `compositionProfile = cover_safe_v1` | ✅ ACTIVE | All 3 YouTube queued rows confirmed |
| `heroSubject` populated | ✅ ACTIVE | guanyin, buddha_statue, elder_monk, temple_corridor seen |
| `visualVariant = schnell/portrait_16_9` | ✅ ACTIVE | Seen in details object |
| `visualPromptVersion = BUDDHIST_VISUAL_V2` | ✅ ACTIVE | GUANYIN_WHITE_JADE_COMPASSION, AMITABHA_PURE_LAND_LIGHT confirmed |
| `prompt version = image-prompts-v3` | ✅ ACTIVE | `"version": "image-prompts-v3"` in all queued YouTube rows |
| `VISUAL_BRAND_ANCHOR` in raw prompt | ✅ ACTIVE | Prompt snippets contain "warm golden morning light", "jade green accents" language |
| Cover-safe upper-third in prompt | ✅ ACTIVE | "large open pastel sky in upper third for title text" in prompt snippets |
| `inferenceSteps = 8` | ✅ ACTIVE | (up from hardcoded 4 in legacy; `app_config.image_steps=8`) |
| `falModel = fal-ai/flux/schnell` | ℹ️ UNCHANGED | DB config unchanged; Phase 1 ready for Dev but config not updated |
| `imageMeta` in legacy-quote sidecars | ❌ NOT YET | No new quote renders since Jun 8 |
| `dimFactor = 0.20` in quote renders | ❌ NOT YET | No new quote renders since Jun 8 |

---

## 8. Pending Old Visual Outputs Still in Queue

The Facebook queue (all `video_type = 'quote'` and `video_type = 'short'`) extending through Jun 14+ contains old-generation content. These are TTS Shorts generated before the Phase 1 cutover, now paired with Facebook-only queue entries. They will publish as old visual style.

No YouTube items remain in the queue with old (`v1`/`v2`) visual metadata — all current YouTube queue entries are v3.

---

## 9. First New Visual Version Publish Summary

| Platform | First v3 video ID | Published | Topic |
|----------|------------------|-----------|-------|
| YouTube | `nVhXCBJ6HeM` | **2026-06-11 13:00 UTC** | Trả giá cho tham vọng |
| Facebook | N/A | Not yet | (requires new generation run) |
| Legacy quote pipeline | N/A | Not yet | (requires manual trigger) |

---

## 10. Action Required for Quote Pipeline

To produce new-version quote shorts (with `dimFactor=0.20`, `portrait_16_9`, `cover_safe_v1`, `imageMeta` tracking):

**Step 1 — Commit all untracked visual pipeline files:**
```
git add src/lib/pipeline/quote-short-pipeline.ts
git add src/lib/legacy-quote-short-generator.ts
git add src/lib/config/buddhist-visual-categories.ts
git add src/lib/quote-image-meta.ts
git add src/lib/prompt-version-registry.ts
git add src/lib/pipeline/images.ts
git add src/actions/app-config.ts
git commit -m "feat(visual): Phase 1/1.1/Alignment — v3 prompts, portrait_16_9, cover-safe, hero library, dim 0.20"
```

**Step 2 — Trigger a new quote generation run** from the content gallery or scheduler UI (select Buddhist topics with wisdom/silence/patience family, or run a batch generate). The new pipeline will pick up automatically from the committed code on the next generation.

**No code changes are needed** — everything is already written and running for TTS Shorts. Only the quote pipeline requires a new trigger because the old outputs from Jun 8 are frozen and the pipeline has not run since.

---

## 11. Local Files to Inspect (v3 Samples)

To visually verify the new composition on disk:

| Content ID | Topic | Local image path (approx) |
|-----------|-------|--------------------------|
| 941f5c33-... | Trả giá cho tham vọng | `media/images/941f5c33-*-0.jpg` |
| f97cbd15-... | Mất mát hy vọng | `media/images/f97cbd15-*-0.jpg` |
| cba79d1b-... | Chấp nhận sự mất mát | `media/images/cba79d1b-*-0.jpg` |
| 31ea6daa-... | Nỗi buồn không tên | `media/videos/31ea6daa-...-short.mp4` (20 MB, Jun 11 22:01) |

These are the first videos with `heroSubject`, `cover_safe_v1` composition, `VISUAL_BRAND_ANCHOR` palette, and `BUDDHIST_VISUAL_V2` category routing. They are the baseline for measuring visual improvement from Phase 1.1.
