# Content Quality Audit

> Reviewed: 2026-06-01 | Focus: Vietnamese Buddhist/spiritual short & long-form video

---

## Executive Summary

The prompt architecture is more sophisticated than most pipelines. The hook engine (generate 20 → score → pick top 3) is genuinely good. The multi-stage long script (outline → opening → 4 sections → closing) is the right structure. However, several systemic weaknesses erode final quality:

1. **Sections are contextually isolated.** Each section only sees the last 35 words of the previous section. No section knows what hooks or emotional beats the others use. This produces sections that feel written by different people.
2. **The scoring prompts are self-referential.** The hook scorer and title scorer are instructed to reward "not clickbait" while simultaneously rewarding "curiosity" — these criteria conflict, and the model resolves the conflict inconsistently.
3. **Validation is length-focused, not quality-focused.** The script validator checks word count, duration, and banned phrases — but doesn't check emotional arc, story completeness, or CTA placement.
4. **Image prompts have no awareness of video pacing.** 5 landscape images are generated from a static 3000-char script excerpt — the same excerpt regardless of position in the 20-minute video. Images don't track emotional arc (opening quiet → climax → resolution).

---

## Prompt-by-Prompt Assessment

---

### P-01 — Topic Suggestion

| Attribute | Value |
|-----------|-------|
| **Purpose** | Suggest 1–8 short themes (1–5 words) per niche to seed the pipeline |
| **Inputs** | nicheContext, dedupBlock (last 30 topics, 14 days) |
| **Outputs** | List of themes: "Tha thứ", "Buông bỏ", "Cô đơn" |
| **Redundancy score** | 2/10 — serves a real purpose, not duplicated |
| **Quality score** | 6/10 |

**Issues:**
- The dedup block injects 30 raw topic strings but there's no semantic similarity check. "Buông bỏ" and "Buông xuống" and "Buông tay" are all semantically identical but all three would pass the string-match dedup filter.
- The prompt specifies 1–5 words but produces themes that are sometimes 6-7 words when the model adds qualifiers ("Sự cô đơn trong hôn nhân" = 5 words but borderline).
- No diversity enforcement across topic categories (loss, fear, forgiveness, impermanence). A week of topics could all cluster around "loss" themes.

**Fix:** Add category tagging to the dedup block and require at least one topic from each of the 5 emotional categories per batch.

---

### P-02 — Hook Generation (20 hooks)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate 20 diverse opening sentences for emotional impact |
| **Inputs** | topic, nicheName, nicheDescription, tone, dedupBlock |
| **Outputs** | 20 hook candidates, 1 per line |
| **Redundancy score** | 2/10 |
| **Quality score** | 7/10 |

**Issues:**
- Temperature 0.95 generates highly diverse hooks but also generates structurally redundant ones ("Người làm bạn tổn thương..." vs "Kẻ đã làm bạn đau..."). At 20 hooks, ~4-6 are near-duplicates in practice.
- The prompt lists 4 example hooks that are all "Người / người ta" sentence patterns. This biases generation toward third-person observer framing. The most emotionally powerful hooks are often second-person ("Quý vị đã bao giờ...") or first-person universal, which the examples don't demonstrate.
- The constraint "each hook max 20 words" eliminates many naturally strong two-sentence hooks.
- No explicit constraint against starting hooks the same way (multiple hooks starting with "Có những...").

**Fix:** Reduce pool to 12-15 hooks, add 3-5 example patterns per structural type (not just observer-type), add dedup check within the generated set.

---

### P-03 — Hook Scoring

| Attribute | Value |
|-----------|-------|
| **Purpose** | Score 20 hooks on 4 dimensions to pick top 3 |
| **Inputs** | topic, nicheName, hooks list |
| **Outputs** | JSON scores + top3 indices |
| **Redundancy score** | 3/10 |
| **Quality score** | 6/10 |

**Issues:**
- **4 dimensions are not independent.** `curiosity` and `retention` are strongly correlated (~0.8). In practice, the model gives near-identical scores to both for any given hook. This wastes 50% of the scoring effort.
- **No weighting.** All 4 dimensions sum equally. For this content type, `emotion` and `relatability` are much stronger predictors of retention than `curiosity`. A hook that scores [5, 9, 9, 7] (total: 30) beats one that scores [8, 6, 6, 9] (total: 29) — but the second hook is probably better for this audience.
- **`top3` is not used correctly.** The code takes `top3[0]` as the selected hook. But `top3` comes from the LLM's judgment, while `scoredHooks` is sorted by `total`. These can disagree and the code sometimes ignores the LLM's own recommendation.
- **Fallback heuristic is naive.** Keyword counting for `curiosity` ("?", "đừng", "giữ"...) has no understanding of sentence structure or emotional truth.

**Fix:** Replace 4 criteria with 2: `emotional_resonance` (0-10) and `authenticity` (0-10). Weight `emotional_resonance × 1.5`. This correlates better with actual viewer stop-rate.

---

### P-04 — Short Script Draft

| Attribute | Value |
|-----------|-------|
| **Purpose** | Write 130-150 word script from selected hook |
| **Inputs** | topic, nicheName, selectedHook, basePrompt |
| **Outputs** | Plain text script with fixed CTA |
| **Redundancy score** | 2/10 |
| **Quality score** | 7/10 |

**Issues:**
- **The 5-step structure is prescriptive and visible.** "1. Hook → 2. Tình huống → 3. Chiêm nghiệm → 4. Phật pháp → 5. CTA" creates predictable story beats that trained viewers will feel as formulaic after 10 videos.
- **The base prompt (`DEFAULT_SHORT_PROMPT`) is injected after the structural instructions**, which means the model gets conflicting format requirements (the structure prompt says "use this flow", the base prompt says "make it natural and not formulaic"). The model resolves this by picking one — usually the latter template since it's more specific.
- **130-150 word constraint is too narrow.** The validation window is 120-170 words. The prompt says 130-150. After normalizeGenericPhrases and ensureShortCta, scripts that start at 150 words often end up at 145 — cutting into content word-count. The CTA itself is 24 words, so only 106-126 words of actual content.
- **The CTA is hardcoded and appears on every single video verbatim.** "Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống." — After 20 videos, regular viewers have this memorized. It becomes background noise, not a call to action.

**Fix:** Give the model 3 approved CTA variants and rotate. Expand word count to 140-170 (the 24-word CTA takes up too much percentage of the 150-word budget). Remove the numbered flow — describe the desired emotional arc instead.

---

### P-05 — Short Script Repair

| Attribute | Value |
|-----------|-------|
| **Purpose** | Fix validation failures in the draft script |
| **Inputs** | topic, nicheName, selectedHook, currentScript, issues[] |
| **Outputs** | Corrected script |
| **Redundancy score** | 4/10 |
| **Quality score** | 6/10 |

**Issues:**
- **Runs up to 3 times.** A script that fails on word count, banned phrase, AND missing CTA will run the repair loop 3 times. At $0.0001/call, cost is negligible, but each repair is 1-2 seconds.
- **The repair prompt doesn't tell the model which issues are most important.** If the script has 165 words AND contains "bí quyết", the model might fix the phrase but push word count to 175. The next repair fixes words but reintroduces the phrase. Circular repair loops occur.
- **At temperature 0.45, repairs are conservative** — the model tends to only minimally edit, which means a structurally flawed script often fails validation again on the same issue.

**Fix:** Prioritize issues in the prompt (word count first, then phrase, then CTA). On second repair attempt, increase temperature to 0.7 to break circular editing patterns.

---

### P-06/07/08/09 — Long Script (Outline + Opening + Sections + Closing)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate 1600-2600 word narrative script for 15-18 min video |
| **Inputs** | topic, nicheName, hook, basePrompt, plus rolling context |
| **Outputs** | Full long-form script in narrative prose |
| **Redundancy score** | 2/10 — stages are genuinely additive |
| **Quality score** | 6/10 |

**Issues:**
- **Section continuity is broken by design.** Each section only receives 35 words from the previous section's end. The model has no awareness of:
  - What emotional peaks have already been hit
  - What images/scenes were used earlier
  - Whether the same metaphor is being repeated
  - Whether the story arc is ascending or descending

  Result: Videos where sections 2 and 4 both use the "lotus in mud" metaphor independently, or where the emotional low comes in section 4 after section 3 already resolved.

- **The outline's `emotionalShift` field is one of the strongest features** but it's a free-text string generated at outline time and then just string-interpolated into each section prompt. There's no enforcement that the section actually delivers the emotional shift. A section prompt can say `emotionalShift: "từ lo sợ → chấp nhận"` but the generated section stays in "lo sợ" mode throughout.

- **Opening and closing are generated independently.** The opening doesn't know how the closing will end, and vice versa. A strong narrative has bookending — the opening image should echo in the closing. This is architecturally impossible with the current sequential-but-isolated approach.

- **The closing receives only 120 words summary of 4 sections** — too little context to write a resonant conclusion. The model defaults to generic "lắng xuống" endings.

**Fix (high impact):**
1. Generate all section drafts first, then pass the full concatenated draft to a "narrative integration pass" that smooths transitions, removes repeated metaphors, and creates opening/closing bookends.
2. Add `previousSection: lastNWords(200)` (not 35) to section prompts.
3. Add explicit metaphor tracking: generate a "visual vocabulary" at outline time ("core image: lotus pond, supporting images: morning mist, stone Buddha") and inject into every section prompt.

---

### P-10 — Long Script Repair

| Attribute | Value |
|-----------|-------|
| **Purpose** | Fix validation failures in assembled long script |
| **Inputs** | topic, nicheName, full script, issues[] |
| **Outputs** | Corrected full script (max 2500 tokens) |
| **Redundancy score** | 3/10 |
| **Quality score** | 5/10 |

**Issues:**
- **2500 max tokens is too low for a 2000-word repair.** A 2000-word script contains ~4000 Vietnamese tokens. At max_tokens=2500, the repair will truncate mid-sentence approximately 40-50% of the time. The resulting truncated script then fails validation again on word count, creating an endless repair loop.
- **The repair prompt sends the full script as context.** For a 2000-word script, the input prompt is ~3000 tokens before the repair instructions. This is expensive and approaches the practical limit for consistent quality from gpt-4o-mini.

**Fix:** Increase max_tokens to 4000 for long script repair. Or implement targeted repair that only rewrites the failing section(s) rather than the full script.

---

### P-11 — Image Prompts (Short Video)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate N English prompts for Buddhist scene images |
| **Inputs** | Full script, topic, niche |
| **Outputs** | N image prompts (15-25 words each) |
| **Redundancy score** | 2/10 |
| **Quality score** | 6/10 |

**Issues:**
- **IMAGE_COUNT_DEFAULT = 1.** Short videos are generated with a single background image by default. This means the entire 45-60 second video shows one static scene. For a spiritual content channel, this creates a "radio with a picture" experience.
- **The default style is random** (`randomBuddhistStyle()`). This means back-to-back videos can have completely different visual aesthetics (watercolor one day, vintage film the next), breaking brand consistency.

**Fix:** Set `IMAGE_COUNT_DEFAULT = 3` for shorts. Fix the style to one brand style per niche (stored in niches table). Create `nicheVisualStyle` column.

---

### P-12 — Image Prompts (Long Video Landscape)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate N landscape prompts + SEO description |
| **Inputs** | script (first 3000 chars), topic, niche, style |
| **Outputs** | N image prompts + Vietnamese SEO description |
| **Redundancy score** | 3/10 — SEO description generation is partially redundant with P-16 (description) |
| **Quality score** | 6/10 |

**Issues:**
- **The SEO description here and the description from P-16 (longform engine) are two separately generated pieces of text for the same video.** The upload flow uses the description from `longform-engine.ts`. The `seoDescription` from `generateLandscapePrompts` appears to be stored but its consumption path is unclear — it may be dead code.
- **Only the first 3000 characters of the script are sent for image prompt generation.** A 20-minute script is ~10,000-12,000 characters. Using only the first 3000 means all 5 landscape images are visually themed around the opening of the video. The emotional arc of sections 3-4 (the climax) is visually absent.

**Fix:** Send 5 excerpts: one per section (opening, S1, S2, S3, closing) and generate one image prompt per excerpt. Remove SEO description from this prompt — it's already generated better in P-16.

---

### P-13 — Thumbnail Prompt

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate single dramatic thumbnail image prompt |
| **Inputs** | topic, niche, first 500 chars of script |
| **Outputs** | Plain text English prompt (30-50 words) |
| **Redundancy score** | 1/10 — unique purpose |
| **Quality score** | 8/10 |

**Issues:**
- "ABSOLUTELY NO: text, words, people's faces" — this is correct for pure image generation, but the best-performing Buddhist content thumbnails often have a text overlay (2-5 words) added in post-processing on top of the image. The current pipeline has no post-processing text overlay step.
- First 500 chars of script = opening hook. This actually works well — the thumbnail should capture the emotional essence of the opening. ✅

**Fix:** Add a post-processing text overlay step using FFmpeg drawtext or Pillow to add the `thumbnail_intent.text` field (generated in P-19) over the image. This is the missing last 10%.

---

### P-14/15 — Title Generation and Scoring

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate 10 title candidates, score and select best |
| **Inputs** | topic, 200-word script excerpt |
| **Outputs** | Best title (string) |
| **Redundancy score** | 3/10 — two-call approach (gen + score) is justified but expensive |
| **Quality score** | 7/10 |

**Issues:**
- **`not_clickbait` criterion is structurally flawed for this content.** YouTube titles need some degree of clickbait to perform algorithmically. A title scoring 10/10 on `not_clickbait` ("Bài học về sự tha thứ") will outperform ethically but underperform algorithmically vs. a 6/10 title ("Người ta tổn thương bạn có thể đã quên từ lâu rồi"). The scoring system penalizes the better-performing title.
- **Scoring uses Gemini Flash but generation uses the same model.** This is inconsistent — if you trust Gemini's judgment enough to score, why not trust it to generate? Or vice versa.
- **10 titles for one video is excess.** After scoring, 9 are discarded. A better approach: generate 5 with higher temperature and score 5 — same quality selection, fewer tokens.

**Fix:** Replace `not_clickbait` with `emotional_authenticity` (does the title feel true, not manufactured?). Reduce title pool from 10 to 5.

---

### P-16 — Description

| Attribute | Value |
|-----------|-------|
| **Purpose** | YouTube video description 150-250 words |
| **Inputs** | bestTitle, topic, scriptExcerpt |
| **Outputs** | Plain text Vietnamese description |
| **Redundancy score** | 1/10 — unique |
| **Quality score** | 7/10 |

**Issues:**
- The disclaimer "Nội dung mang tính chiêm nghiệm cá nhân, không thay thế tư vấn chuyên môn" is added conditionally ("nếu phù hợp"). The model adds it nearly always, making it formulaic. YouTube's algorithm may flag repeated disclaimer boilerplate across videos.
- No timestamp injection in the description (YouTube chapters require timestamps in description). This is done separately in `buildTimestampedChapters` but the description doesn't include them.

**Fix:** Remove the disclaimer instruction — add it as a static footer in the upload action instead. Inject timestamps directly into the description template.

---

### P-17 — Tags

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate topic-specific tags for YouTube SEO |
| **Inputs** | bestTitle, topic |
| **Outputs** | Up to 5 extra tags merged with 10 base tags |
| **Redundancy score** | 3/10 |
| **Quality score** | 5/10 |

**Issues:**
- **10 base tags are static across ALL videos on ALL niches.** "phật pháp, lời phật dạy, chữa lành, buông xả, nhân quả, vô thường, bình an, chiêm nghiệm, sống đẹp, tâm lý" — these are hardcoded in `longform-engine.ts`. A niche about "relationship healing" and a niche about "Buddhist meditation" get identical base tags.
- Total tags = 15 max. YouTube allows 500 characters / ~30-50 tags. Only using 15 is leaving SEO surface area unused.
- Tags at temperature 0.3 are very predictable — typically just topic synonyms. No long-tail keyword discovery.

**Fix:** Move base tags to the `niches` table as a per-niche field. Increase tag generation to 10-15 extra tags. Use a keyword research perspective in the prompt.

---

### P-18 — Pinned Comment

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate engagement-driving pinned comment |
| **Inputs** | bestTitle, topic |
| **Outputs** | 1-2 sentence Vietnamese question |
| **Redundancy score** | 5/10 — very similar outputs across videos |
| **Quality score** | 5/10 |

**Issues:**
- At max_tokens=100 and temperature=0.7, the model produces nearly identical structures every time: "Có [something] mà quý vị đang học cách [action] không? Chia sẻ trong phần bình luận nhé."
- The pinned comment is never actually posted automatically — it requires a separate YouTube API call to pin a comment. This call is not implemented in the publishing pipeline. The `pinned_comment` field is generated but sits unused in the DB.

**Fix:** Implement auto-pin in the upload flow. If auto-pin isn't implemented, remove this prompt entirely — it's wasted tokens.

---

### P-19 — Thumbnail Intent

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate metadata for thumbnail design |
| **Inputs** | topic, scriptExcerpt |
| **Outputs** | JSON: emotion, mainVisual, text, colorMood |
| **Redundancy score** | 7/10 — nearly redundant with P-13 (thumbnail prompt) |
| **Quality score** | 5/10 |

**Issues:**
- **P-13 generates a full Fal.ai image prompt for the thumbnail.** P-19 generates metadata (emotion, mainVisual, text, colorMood) for the thumbnail. These two prompts serve overlapping purposes — both are trying to define what the thumbnail looks like.
- The `text` field (max 5 Vietnamese words in caps) is generated but not used in any rendered output. The thumbnail image from Fal.ai has no text (by design — "ABSOLUTELY NO: text" in P-13). And there's no post-processing text overlay step.
- The `emotion` field outputs from a fixed set ("tha_thu/buon_ba/hoi_tiec/binh_an/nhan_qua/buon_xa/vo_thuong/so_hai/tinh_than_tu_bi") that has 9 options — too coarse for nuanced content.

**Fix:** Merge P-19 into P-13. Add the emotion + text fields to the thumbnail system prompt: "Also return a JSON object: {emotion, text_overlay}". Saves one full LLM call per long video.

---

## Cross-Cutting Issues

### CQ-1: No Analytics Feedback Loop
The system tracks `viewCount`, `likeCount`, `commentCount` in `videoMetricSnapshots`. This data is never used to improve prompts. A video that gets 10K views should influence future hook generation for the same topic cluster. There is no mechanism to close this loop.

### CQ-2: Visual Style Is Inconsistent
The `randomBuddhistStyle()` function randomly picks between cinematic, watercolor, and vintage styles per video. After 50 videos, the channel has no coherent visual identity. This is a brand consistency failure.

### CQ-3: No Human-in-the-Loop Review Point
The pipeline runs fully automated. There is no checkpoint where a human can approve the script before TTS, or approve the hook before full generation. For a spiritual content channel where tone is paramount, a single miscalibrated script can damage the channel's reputation.

### CQ-4: Script Validation Is Shallow
`validateShortScript()` checks: word count, duration estimate, banned opening phrases, generic AI phrases, pronoun usage, CTA presence. It does NOT check:
- Whether the script is emotionally coherent
- Whether the hook and CTA are thematically connected
- Whether the script repeats the same idea twice
- Whether the script has a clear emotional turn (chiêm nghiệm moment)

---

## Prompts That Can Be Merged or Removed

| Prompt | Action | Reason |
|--------|--------|--------|
| P-19 Thumbnail Intent | **Merge into P-13** | Overlapping purpose; saves 1 LLM call per long video |
| P-12 SEO Description | **Remove seoDescription field** | Duplicates P-16's description; seoDescription is likely unused |
| P-18 Pinned Comment | **Remove until auto-pin is implemented** | Generated but never posted; pure waste |
| P-03 Hook Scoring (4 criteria) | **Simplify to 2 criteria** | 4 criteria produce redundant signal; 2 better criteria are cheaper and more predictive |
| P-17 Tags (base 10) | **Move to niche config** | Static tags hardcoded in code are not prompts; remove from LLM scope |
