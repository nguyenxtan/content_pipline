# Short Visual Performance Audit

Date: 2026-06-10  
Scope: Data-driven audit of recent and historical YouTube Shorts visual performance.  
Status: audit only — no code changes.

Data sources: `published_videos`, `content_generations`, `video_metric_snapshots` (live DB query 2026-06-10).

---

## 1. Dataset Summary

### Query scope

- Platform: YouTube, video_type = short
- Date range captured: 2026-06-05 → 2026-06-10 (most recent 120 rows)
- All-time top performers: separate query ordered by view_count DESC

### Coverage

| Metric | Count |
|--------|-------|
| Total Shorts in dataset | 120 |
| Phật Pháp niche | 63 |
| Tầng Sâu niche | 57 |
| Videos with views > 0 | 100 |
| Videos with retention data | 37 |
| Videos with CTR data | **0** |

**CTR is completely unavailable.** YouTube's Data API does not expose impressions/CTR at the per-video level for this account scope. All CTR-based analysis in this audit is impossible. Every CTR reference in the audit task spec cannot be answered from real data.

### Retention coverage note

37 retention records exist. Most are from the "no-image" era (pre-Buddhist-Visual-V1) and Tầng Sâu quote shorts. BUDDHIST_VISUAL_V1 was only deployed on 2026-06-09 to 2026-06-10 — all BUDDHIST_VISUAL_V1 category videos are 0–48 hours old at time of this audit. Their retention data does not exist yet and cannot be evaluated.

---

## 2. Visual Category Breakdown

### BUDDHIST_VISUAL_V1 distribution (recent 63 Phật Pháp videos)

| Visual category | Count | Avg views | Max views | Notes |
|----------------|-------|-----------|-----------|-------|
| pre-v1 (Schnell, no category metadata) | 36 | 382 | 1,290 | Dominant era, most data |
| no-image (quota short format) | 12 | 104 | 368 | Mostly new, 0-2 days old |
| MANDALA_BRIGHT_KARMA | 3 | 69 | 206 | Low performer so far |
| GUANYIN_WHITE_JADE_COMPASSION | 3 | 239 | 477 | Moderate |
| BAMBOO_MEDITATION_GREEN | 2 | 0 | 0 | Brand new, 0 views |
| VIETNAMESE_BUDDHIST_TEMPLE | 2 | 770 | 1,354 | Best V1 result (2 samples only) |
| BUDDHA_GOLDEN_ENLIGHTENMENT | 2 | 356 | 414 | Moderate |
| LOTUS_PARADISE_PEACE | 1 | 414 | 414 | 1 sample |
| SKY_CLOUD_HEAVENLY_BUDDHA | 1 | 1,300 | 1,300 | Best single V1 result |
| TEMPLE_SUNRISE_SERENITY | 1 | 76 | 76 | 1 sample |

**Important caveat:** BUDDHIST_VISUAL_V1 categories (everything except pre-v1 and no-image) represent only 15 videos, all published in the last 48 hours. View counts on YouTube Shorts accumulate over 3–7 days. Average views for V1 categories should not be compared to pre-v1 averages until 2026-06-17 at the earliest.

### Tầng Sâu (no AI image)

All 57 Tầng Sâu videos have empty `image_paths` — they are pure text-on-background quote shorts. No AI image generation data to audit.

---

## 3. Topic vs. Visual Findings

### Top-performing Phật Pháp topics and their visual categories

| Topic | Views | Visual category | Match quality |
|-------|-------|----------------|---------------|
| Trả giá vì tham lam | 1,354 | VIETNAMESE_BUDDHIST_TEMPLE | ✅ Good — greed/karma mapped to temple |
| Tìm kiếm sự chấp nhận | 1,300 | SKY_CLOUD_HEAVENLY_BUDDHA | ✅ Good — acceptance/hope mapped to sky |
| Nỗi lo lắng | 1,290 | pre-v1 | N/A — no category metadata |
| Nỗi sợ thất bại | 1,042 | pre-v1 | N/A |
| Tiểu nhân đắc chí chỉ là tạm thời | 976 | pre-v1 | N/A |
| Buông xả tổn thương | 868 | pre-v1 | N/A |
| Tìm kiếm sự thấu hiểu | 846 | pre-v1 | N/A (66.9% retention — strong) |

### MANDALA_BRIGHT_KARMA mismatch

MANDALA_BRIGHT_KARMA is triggered by karma/betrayal keywords. It has been applied to:
- "Nỗi đau bị phản bội" (betrayal pain) — 0 views, brand new
- "Ghen tị" (jealousy) — 2 views, brand new
- "Nỗi buồn phản bội" (betrayal sadness) — 206 views

The mandala concept (geometric cosmic light patterns) is abstract and cool-toned. Betrayal and jealousy are hot emotional topics that likely need warmer, more human imagery. The GUANYIN_WHITE_JADE_COMPASSION category (healing, forgiveness) is visually softer and more emotionally accessible — a closer match for these topics.

### BAMBOO_MEDITATION_GREEN over-assignment

Applied to:
- "Chấp nhận sự im lặng" (accepting silence) — plausible match
- "Chờ đợi sự trở về" (waiting for return) — weak match; this is a relationship topic

Bamboo/meditation imagery is suitable for meditation and mindfulness topics. Waiting/longing topics need warmer, more intimate visual direction.

### TEMPLE_SUNRISE_SERENITY assignment issue

Applied to "Nỗi đau mất mát" (grief, loss) — 76 views. Temple sunrise is uplifting and morning-oriented. Grief topics may benefit from gentler GUANYIN imagery. The temple category is better suited to discipline, practice, and early-morning dedication content.

### Topics without strong visual category alignment

Several common Buddhist topics do not have a dedicated visual category and fall to deterministic hash-based fallback:

| Topic pattern | Current fallback behavior | Better fit |
|--------------|--------------------------|------------|
| Ghen tị, phản bội, lừa dối (emotional betrayal) | MANDALA (hash-based) | GUANYIN_WHITE_JADE_COMPASSION |
| Chờ đợi, nhớ nhung (longing/waiting) | BAMBOO (hash-based) | GUANYIN or PRACTICAL_DAILY_LIFE |
| Tiền bạc, tham lam (money/greed) | Currently works (DHARMA_CITY_LIGHT or VIETNAMESE_BUDDHIST_TEMPLE) | Keep as-is |
| Nỗi sợ (fear topics — sợ thất bại, sợ cô đơn) | LOTUS or TEMPLE (hash-based) | SKY_CLOUD_HEAVENLY_BUDDHA (hope/light) |

---

## 4. Prompt Findings

### Pre-V1 era (36 of 63 recent Phật Pháp)

Pre-V1 images have `falModel: fal-ai/flux/schnell` but no `buddhistVisualCategory`. These were generated before the BUDDHIST_VISUAL_V1 system (prior to 2026-06-09). The prompt details are not stored — the raw prompt sent to Fal.ai was never persisted.

**What we can infer**: Pre-V1 videos account for nearly all high-view items in the recent dataset (top 15 includes 9 pre-V1 items). This does not mean pre-V1 prompts are better — it means pre-V1 videos have had 1–4 days to accumulate views while V1 videos are 0–48 hours old.

### BUDDHIST_VISUAL_V1 prompt structure

The current prompt construction for Buddhist content:
1. LLM (gpt-4o-mini) receives the `categoryPromptHint` from `buildBuddhistImagePrompt()` — a 60–80 word structured concept already including composition, color palette, and composition rules.
2. LLM generates 1 English image prompt (15–30 words) based on that concept.
3. A randomly-selected `BUDDHIST_IMAGE_STYLES` style anchor is appended.
4. `PROMPT_NO_TEXT` suffix is appended.

**Redundancy issue**: The `categoryPromptHint` already contains detailed composition instructions. The LLM-generated 15–30 word prompt is then appended with another style anchor that overlaps with the category concept. For example, `LOTUS_PARADISE_PEACE` already includes "Buddha statue... lotus platform... turquoise water..." and then the style anchor `serene_buddha_light` or `warm_monastery_peace` adds another Buddha/lotus description. This produces prompt stacking rather than refinement.

**The raw prompt is not stored.** It is impossible to audit which specific prompts were sent to Fal for any given video. This means there is no prompt-to-outcome data at all.

### Prompt patterns identified in recent high performers

From topic analysis of top-view items (inferred category, actual prompt unknown):
- "Tham lam" (greed) → VIETNAMESE_BUDDHIST_TEMPLE → bright temple, golden Bronze Buddha → 1,354 views — warm and recognizable
- "Sự chấp nhận" (acceptance) → SKY_CLOUD_HEAVENLY_BUDDHA → soft blue sky, floating Buddha — 1,300 views — ethereal and light

Both are bright, single-subject, high-contrast compositions. Both feature large recognizable Buddhist figures as the dominant element.

### Prompt variety assessment

13 distinct visual categories in BUDDHIST_VISUAL_V1. In the recent 15 V1 videos:
- 3 categories appear 3× (MANDALA, GUANYIN, BAMBOO)
- 6 categories appear 1–2×
- BODHISATTVA_BRIGHT_VOW, AMITABHA_PURE_LAND_LIGHT, SCRIPTURE_CANDLE_GOLD, DHARMA_CITY_LIGHT have 0 appearances in this dataset

Variety is present in the category system but the sample is too small and too new to evaluate whether it produces enough visual differentiation in output images.

---

## 5. Thumbnail Findings

### Thumbnail generation method

Thumbnails are extracted from the video at `t = 0.35 × image[0]_duration` (approximately 0.35–0.9 seconds in). This means the thumbnail captures the video at near-frame-0. The first frame shows:
- The AI-generated background image
- The cover title overlay (white text on slight dark scrim, top-left position)
- Possibly the first subtitle chunk if it starts immediately

### What the data shows about thumbnails

**No direct thumbnail quality signal is available** — CTR is 0 records, so thumbnail quality cannot be linked to click performance.

**Observable structural issue**: The cover title text (derived from the topic) is placed at top-left using `[an7]` ASS alignment. For a vertical 9:16 Short, this positions text in the upper portion of the frame. The AI image subject (Buddha statue, temple) is typically centered or vertically centered. Depending on image composition, the cover text may overlap with or crowd the image's main subject.

Since `portrait_4_3` (≈768×1024) is cropped to 1080×1920 by FFmpeg via `force_original_aspect_ratio=increase + crop`, the effective composition is center-cropped. For an image generated as `portrait_4_3` with a centrally-placed subject, the sides are cut. The bottom 20–30% of the frame (where subtitles appear) may be poorly composed as the AI image was not generated with subtitle-safe framing in mind.

### Cover text quality

The `chooseCoverTitle()` function uses the raw topic string (up to 72 characters), with word-wrap into 3 lines of ~14 characters each. Topics like:

- "Điều mệt nhất không phải bận rộn mà là không còn cảm thấy mình đang sống" (72 chars) — long, gets truncated at 72 chars
- "Nỗi sợ thất bại" — short and impactful
- "Tìm kiếm sự chấp nhận" — clear
- "Kẻ phản bội sống ác, trời không tha" — punchy topic title

The cover text system is functional but the `Short Cover Engine` (`src/lib/short-cover-engine.ts`) generates a distinct `coverText` that is computed but not yet used for the first-frame overlay. The current title comes directly from `topic`, not from the cover engine output.

---

## 6. Top Performer Analysis

### Top 10 by views (all-time)

| Rank | Views | Topic | Visual | Niche | Retention |
|------|-------|-------|--------|-------|-----------|
| 1 | 1,558 | Có những người nói rất nhiều nhưng không ai thật sự hiểu họ | no-image | Tầng Sâu | 71.9% |
| 2 | 1,424 | Có khi ta sống quá lâu trong phiên bản người khác mong muốn | no-image | Tầng Sâu | 82.1% |
| 3 | 1,354 | Trả giá vì tham lam | VIETNAMESE_BUDDHIST_TEMPLE | Phật Pháp | N/A |
| 4 | 1,300 | Tìm kiếm sự chấp nhận | SKY_CLOUD_HEAVENLY_BUDDHA | Phật Pháp | N/A |
| 5 | 1,290 | Nỗi lo lắng | pre-v1 | Phật Pháp | N/A |
| 6 | 1,070 | Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều | no-image | Tầng Sâu | 66.3% |
| 7 | 1,042 | Nỗi sợ thất bại | pre-v1 | Phật Pháp | N/A |
| 8 | 1,012 | Sách hay không dạy ta sống, chỉ giúp ta thôi sống hời hợt | no-image | Tầng Sâu | 106.3% |
| 9 | 1,008 | Nghệ Thuật Tha Thứ: Giải Phóng Tâm Hồn Khỏi Xiềng Xích Oán Hận | no-image | Phật Pháp | 77.5% |
| 10 | 976 | Tiểu nhân đắc chí chỉ là tạm thời | pre-v1 | Phật Pháp | N/A |

**Common patterns — top 10 by views:**
- 4 of 10 are Tầng Sâu no-image — and these also have retention data showing 66–106%
- 5 of 10 are Phật Pháp pre-V1 (no visual category metadata, unknown prompt)
- 1 is Phật Pháp V1 (VIETNAMESE_BUDDHIST_TEMPLE, BUDDHIST_VISUAL_V1)
- Topic themes: self-recognition, social pressure, fear, karma/consequences, betrayal — all emotionally resonant and universally relatable
- All topics are short, punchy, and specific — NOT long academic Buddhist titles

### Top 10 by retention (excluding anomalous >200%)

| Rank | Retention | Views | Duration | Topic | Category | Niche |
|------|-----------|-------|----------|-------|----------|-------|
| 1 | 170.9% | 68 | 104s | Nghệ Thuật Buông Bỏ... (long-form title) | no-image | Phật Pháp |
| 2 | 127.6% | 4 | 77s | Giải Mã Nghệ Thuật Tâm Linh... | no-image | Phật Pháp |
| 3 | 122.6% | 86 | 56s | Mất phương hướng | no-image | Phật Pháp |
| 4 | 117.0% | 51 | 62s | Bí Mật Của Hơi Thở... | no-image | Phật Pháp |
| 5 | 106.3% | 1,012 | 15s | Sách hay không dạy ta sống... | no-image | Tầng Sâu |
| 6 | 101.3% | 388 | 61s | Thiền Nguyên: Bí Ẩn Về Năng Lượng... | no-image | Phật Pháp |
| 7 | 95.6% | 155 | 14s | Sự im lặng đúng lúc nói nhiều hơn... | no-image | Tầng Sâu |
| 8 | 94.3% | 5 | 54s | Thiền Ngữ Huyền Nhiệm... | no-image | Phật Pháp |
| 9 | 91.9% | 708 | 13s | Có những đêm ta không buồn, chỉ thấy mình trống | no-image | Tầng Sâu |
| 10 | 86.9% | 73 | 11s | Điều mệt nhất không phải bận rộn... | no-image | Tầng Sâu |

**Common patterns — top 10 by retention:**
- **100% are no-image** — every single top-retention video has no AI-generated image
- Tầng Sâu no-image videos have both high retention AND high views (top 5 in views)
- Older Phật Pháp "Nghệ Thuật / Bí Mật" style shorts (pre-image-system era) have extremely high retention (95–170%) but very low views — they held viewers who arrived, but very few arrived
- avg_view_duration for top-retention items: 8–15 seconds (short videos), suggesting the entire video was watched

**Critical structural insight:** The no-image format achieves retention rates of 60–95%+ while image-based Phật Pháp shorts cluster at 30–55%. This is not because images hurt — the no-image videos are a different format (quote shorts, text-on-background) with different scripting and pacing. A direct A/B comparison does not exist yet.

---

## 7. Bottom Performer Analysis

### Bottom 10 by views (videos older than 48h with views data)

| Views | Topic | Visual | Niche | Notes |
|-------|-------|--------|-------|-------|
| 0 | Multiple Tầng Sâu titles | no-image | Tầng Sâu | Brand new (<12h), normal |
| 2 | Kẻ xấu gặp quả đắng | pre-v1 | Phật Pháp | Hook mismatched to topic |
| 3 | Nhẫn nhịn không phải yếu đuối mà là trí tuệ | pre-v1 | Phật Pháp | Long topic, weak hook |
| 4 | Im lặng trước người xấu là trí tuệ cao nhất | pre-v1 | Phật Pháp | Similar to above |
| 5 | Buông bỏ người không còn yêu thương ta nữa | pre-v1 | Phật Pháp | Emotional topic, low performance |
| 6 | Sự giả dối | pre-v1 | Phật Pháp | Generic topic title |

### Bottom 10 by retention

| Retention | Views | Topic | Pattern |
|-----------|-------|-------|---------|
| 8.3% | 1 | Gốc Rễ Của Khổ Đau: Nghệ Thuật Nhận Diện... | "Nghệ Thuật/Giải Mã" long academic title |
| 9.1% | 30 | Sợ hãi mất kiểm soát | Fear topic, weak hook format |
| 9.9% | 49 | Bí Mật Chuyển Hóa Nghiệp Chướng... | "Bí Mật" academic title |
| 11.1% | 42 | Sợ bị tổn thương | Fear topic pattern |
| 11.2% | 2 | Sợ bị bỏ rơi | Fear topic, low volume |
| 12.4% | 102 | Trí Tuệ Giữa Ngã Chấp... | Academic formula title |
| 12.6% | 47 | Giải Mã Sức Mạnh Của Sự Cảm Thông... | "Giải Mã" pattern |
| 12.9% | 81 | Nghệ Thuật Buông Bỏ Hão Huyền... | Long academic title |
| 13.4% | 246 | Nghệ Thuật Tự Thuận: Hành Trình... | Academic pattern |
| 15.6% | 230 | Hoang mang | Very generic topic |

**Visual causes for bottom performance:**

1. **All bottom-retention videos are "no-image"** — these are old-era pre-image-system Phật Pháp shorts. This is the same category as top-retention performers, but these are the worst performers within that group.

2. **Pattern: "Nghệ Thuật / Bí Mật / Giải Mã / Hành Trình" titles** — long, academic, compound-noun titles. These attract generic Buddhist/spiritual search traffic but fail to hold viewers. The content feels like a documentary chapter title rather than a relatable emotional hook. Viewers click in but leave within 4–8 seconds.

3. **Fear topics cluster ("Sợ hãi...", "Sợ bị...")** — these generated low retention and low views. Fear-based topics may be too common across the channel without differentiation.

4. **"Hoang mang" (confusion)** — single-word abstract topic with 15.6% retention. No clear visual anchor, vague emotional hook.

**Important**: None of the bottom-retention items are from the BUDDHIST_VISUAL_V1 era — that system is too new. The worst retention patterns predate the current visual system entirely.

---

## 8. Recommended Experiments

### Experiment ranking by expected ROI

**ROI is assessed as: (likely views/retention improvement) × (implementation effort)**. CTR cannot be measured — all CTR-based rankings are theoretical.

---

### Experiment 1: Flux Dev migration (Highest ROI)

**Expected benefit:** Sharper image detail, better prompt adherence, stronger Buddha/Guanyin subject definition.  
**Measurement:** Track views at day 3 and day 7 per video. Compare BUDDHIST_VISUAL_V1 categories pre-switch vs. post-switch once 20+ samples per group exist.  
**Risk:** $10/month cost increase. No other risk.  
**Implementation:** Single DB config change — `setFalImageModel("fal-ai/flux/dev")`.

---

### Experiment 2: Aspect ratio fix — portrait_4_3 → portrait_16_9 (High ROI, zero cost)

**Expected benefit:** AI-generated image natively fills the 9:16 frame without center-cropping. Subject placement (Buddha, temple) will better occupy the frame without head/feet cutoff artifacts from crop.  
**Why this matters:** The current `portrait_4_3` (768×1024) is approximately 3:4. Cropping to 9:16 (1080×1920) removes roughly 25% of the image width. A native 9:16 image gives the model accurate compositional intent.  
**Risk:** Low — verify 2–3 images before full rollout.  
**Implementation:** One line in `images.ts:42`.

---

### Experiment 3: MANDALA_BRIGHT_KARMA → GUANYIN routing for betrayal/jealousy topics (Medium ROI)

**Problem identified:** "Ghen tị" (jealousy), "Nỗi đau bị phản bội" (betrayal), "Nỗi buồn phản bội" — these emotional-interpersonal topics are routed to MANDALA_BRIGHT_KARMA (cosmic geometry). The mandala visual is cool-toned, abstract, and does not emotionally match the content.  
**Expected benefit:** Warmer, more emotionally resonant imagery for the top-trafficked topic cluster (betrayal/loss is the most common recent topic family).  
**Implementation:** Add `"phản bội", "lừa dối", "ghen tị", "ghen"` to `GUANYIN_WHITE_JADE_COMPASSION.useForKeywords` in `buddhist-visual-categories.ts`. No other change.

---

### Experiment 4: Ken Burns zoom on background image (Medium ROI, measurable)

**Expected benefit:** Reduces "dead" static feel. Hypothesis: zoom motion increases mid-video retention by making the viewer feel something is happening even during dense script sections.  
**Measurement:** Retention comparison between zoom and no-zoom videos, same visual category, same topic family.  
**Risk:** Low — gate with `SHORT_ZOOM_ENABLED=false` env flag.  
**Note:** Since retention data is available (37 records), this experiment IS measurable once 15–20 zoom videos accumulate retention.

---

### Experiment 5: Hook-to-cover alignment (Medium ROI, requires Cover Engine integration)

**Problem:** The `Short Cover Engine` computes an optimized `coverText` from the hook/topic but it is not used in the video's first-frame overlay. The current first frame shows the raw `topic` field word-wrapped to 14 chars/line.  
**Expected benefit:** A hook-derived cover text is shorter, punchier, and better matched to the emotion of the first 2 seconds.  
**Implementation:** Complete the Cover Asset Generator integration (P1 task in roadmap).

---

### Experiment 6: Add rawPrompt to promptVersions tracking (Medium ROI — enables all future experiments)

**Problem:** The actual English prompt sent to Fal.ai is never stored. This makes it impossible to diagnose why a specific image looks good or bad, or to compare prompts across model upgrades.  
**Expected benefit:** Every future experiment becomes measurable at the prompt level.  
**Implementation:** Add `rawPrompt: prompts[0]` to `promptVersions.image.details` in `images.ts`. Low overhead.

---

### Experiment 7: Direct Buddhist prompt path (Low ROI near-term, reduces LLM cost)

**Problem:** The current flow sends a detailed `categoryPromptHint` to gpt-4o-mini and asks it to generate a 15–30 word prompt. The LLM output is then appended with a style anchor that overlaps with the category concept. The LLM step adds latency, ~$0.0001/image in cost, and a layer of potential quality loss if the model doesn't follow the direction perfectly.  
**Proposed alternative:** Use `buildBuddhistImagePrompt(category, topic)` output directly as the Fal.ai prompt, skipping the LLM relay. The category system already produces 80–120 word, fully structured, validated prompts.  
**Expected benefit:** Elimination of LLM variance, consistent prompt quality, and a clear tracking baseline.  
**Risk:** Medium — requires validation that direct prompts produce better or equal outputs vs. LLM-interpreted prompts.

---

### Experiment 8: Style anchor routing by visual category (Low-Medium ROI)

**Problem:** The `BUDDHIST_IMAGE_STYLES` style anchor (3 options: serene_buddha_light, lotus_temple_sunrise, warm_monastery_peace) is selected randomly regardless of visual category. MANDALA_BRIGHT_KARMA content may receive `lotus_temple_sunrise`, creating a style conflict.  
**Recommendation:** Map each category to its best-fit style anchor:
- MANDALA → warm_monastery_peace
- GUANYIN → lotus_temple_sunrise
- AMITABHA → lotus_temple_sunrise
- BAMBOO/MEDITATION → warm_monastery_peace
- SKY_CLOUD/BUDDHA → serene_buddha_light
- Others → serene_buddha_light (default)

---

## 9. Expected Impact

| Experiment | Measurability | Expected lift | Confidence |
|-----------|--------------|---------------|------------|
| Flux Dev migration | Views after 7 days | +10–25% visual clarity, unknown view impact | Low — no A/B data yet |
| Aspect ratio fix | Image quality (visual check) | Fewer crop artifacts | High — deterministic improvement |
| MANDALA→GUANYIN reroute | Views after 7 days | +5–15% for betrayal/jealousy topics | Low — small sample |
| Ken Burns zoom | Retention comparison | +5–15% retention hypothesis | Medium — measurable with 20 samples |
| Hook-to-cover alignment | CTR (not measurable) / first-frame quality | Unknown — CTR unavailable | Low — no measurement path |
| rawPrompt tracking | Enables all other experiments | N/A (prerequisite) | High |
| Direct Buddhist prompt | Image consistency | Less LLM variance | Medium |
| Style routing | Image coherence | Small | Low |

**CTR note (repeated):** CTR is unavailable in this dataset (0 records). Any experiment that claims to improve CTR cannot be measured with the current analytics setup. Focus experiments on measurable signals: views at day 3/7, retention_pct.

---

## 10. Implementation Priority Order

Priority is ordered by: (signal availability) × (effort) × (expected impact).

### Immediate — no-risk changes

1. **Store rawPrompt in promptVersions** — enables all future experiments  
   File: `src/lib/pipeline/images.ts:350–362`

2. **Fix aspect ratio: portrait_4_3 → portrait_16_9**  
   File: `src/lib/pipeline/images.ts:42`

3. **Route betrayal/jealousy to GUANYIN, not MANDALA**  
   File: `src/lib/config/buddhist-visual-categories.ts` — add 3 keywords to GUANYIN `useForKeywords`

### Week 1 — model upgrade

4. **Switch to Flux Dev via app_config** — no code deploy needed  
   Action: `setFalImageModel("fal-ai/flux/dev")` in admin or via direct DB update

5. **Assign experiment IDs** — tag new Dev-era videos with `experimentId = "IMAGE_QUALITY/DEV_V1"`  
   File: `src/lib/pipeline/images.ts` — small addition to generation call

### Week 2 — motion experiment

6. **Add Ken Burns zoom behind `SHORT_ZOOM_ENABLED=false` flag**  
   File: `src/lib/pipeline/short-video.ts`  
   Collect retention on 20+ zoom videos before declaring any result

### Week 3 — prompt routing

7. **Route style anchors by visual category**  
   File: `src/lib/pipeline/images.ts` — `resolveImageStyle()` function

8. **Evaluate direct Buddhist prompt path** (skip LLM relay) on 10 test items, compare image files manually

### Week 4+ — data collection

9. **Wait for BUDDHIST_VISUAL_V1 category data to mature**  
   The V1 system is 48 hours old. No performance conclusions can be drawn on MANDALA, BAMBOO, GUANYIN, TEMPLE, LOTUS, SKY_CLOUD categories until each has 10+ videos with view data (approximately 2026-06-17+).

10. **Wait for Ken Burns retention to accumulate**  
    20–30 videos with `retention_pct` data needed before any conclusion on zoom experiment.

---

## Key Findings Summary

| Finding | Implication |
|---------|------------|
| CTR is completely unavailable | All CTR-based thumbnail quality analysis is impossible with current API scope |
| BUDDHIST_VISUAL_V1 is only 48h old | Category performance data does not exist yet. Do not draw conclusions on V1 vs pre-V1 |
| Tầng Sâu (no AI image) has highest retention: 60–92% | Format difference, not visual quality difference. Different script length, pacing, and delivery |
| Pre-V1 Phật Pháp has highest views among image-based Shorts | Age effect — these videos had 3–7 days to accumulate views |
| MANDALA_BRIGHT_KARMA is misrouted for betrayal/jealousy topics | Actionable — add 3 keywords to GUANYIN routing |
| Raw Fal prompts are never stored | The most critical gap for experiment tracking — add immediately |
| Bottom retention cluster: "Nghệ Thuật/Bí Mật/Giải Mã" academic titles | Pre-image-system era problem. Not related to visual quality. Topic/title/hook issue |
| portrait_4_3 crops 25% of image width in 9:16 render | Fixable in one line — native 9:16 gives better compositional control |
| Flux Dev switchover requires no code deploy | Fastest quality improvement available |
