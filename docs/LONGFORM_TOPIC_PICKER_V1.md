# Longform Topic Picker V1

Date: 2026-06-12
Status: Implemented

## Goal

Select the best existing Shorts topics to expand into `30-45 minute` Buddhist long-form videos.

V1 is read-only:

- no rendering
- no upload
- no Shorts pipeline changes

## Output

The picker generates a daily long-form topic plan with:

- `4` recommended long-form topics per day
- source short evidence
- ranking explanation
- suggested long-form packaging

Output location:

- `reports/longform-topic-plans/YYYY-MM-DD.json`
- `reports/longform-topic-plans/YYYY-MM-DD.md`

Primary script:

- [`scripts/generate-longform-topic-candidates.ts`](/Users/bichtuyen/code/content_pipline/scripts/generate-longform-topic-candidates.ts:1)

## Data Sources

The picker is built on existing Shorts analytics tables:

- `content_generations`
- `published_videos`
- `video_metric_snapshots`

It filters to:

- `channel_key = phat_phap`
- `platform = youtube`
- `video_type = short`
- recent published Shorts within the last `180` days

## Ranking Factors

Each topic is ranked using five signals:

1. `views`
2. `retention`
3. `average view duration`
4. `repeated topic family strength`
5. `long-form suitability`

### Weighting

V1 weighted score:

- views: `28%`
- retention: `24%`
- average view duration: `16%`
- repeated family strength: `16%`
- long-form suitability: `16%`

This keeps raw audience response as the primary signal while still rewarding themes that can sustain a `30-45 minute` teaching arc.

## Topic Family Logic

The picker uses the existing Buddhist strategic topic family registry:

- `Nhân quả / Người xấu / Báo ứng`
- `Buông bỏ / Chữa lành`
- `Trí tuệ sống / Im lặng / Nhẫn nhịn`
- `Gia đình / Hiếu đạo`
- `Tình yêu / Chia tay / Tổn thương`
- `Bình yên / An lạc`
- `Phước báo / Nghiệp duyên`

It prefers topics from stronger families and penalizes unclassified items.

## Inclusion Rules

V1 includes only topics that pass all of:

- average retention present
- average retention `>= 55%`
- total views `>= 200`
- average view duration `>= 10s` when available

Additional practical filter:

- single-source topics with weak view count and weak long-form suitability are excluded

## Exclusion Rules

V1 excludes:

- topics with missing retention
- topics with weak retention
- topics with very narrow or one-off signals
- topics in `needs_topic_family_review`

This matches the project direction from the long-form Buddhist audit: prioritize repeatable emotional/philosophical themes over spikes with thin evidence.

## Daily Recommendation Fields

Each recommendation includes:

- source short IDs
- short titles
- topic family
- reason selected
- suggested long-form title
- suggested `30-45 min` angle
- suggested thumbnail text
- suggested visual direction

## Suitability Heuristic

Long-form suitability is not LLM-generated in V1. It is deterministic and family-aware.

It rewards:

- broad emotional topics
- Buddhist teaching-friendly themes
- repeated audience interest
- proven long-form families from the Buddhist audit

It penalizes:

- overly narrow event-like topics
- under-classified topics
- very short or vague topic labels

## Diversity Rule

The picker tries not to fill all four daily slots with the same family.

V1 behavior:

- first pass prefers family spread
- second pass fills remaining slots by score

This keeps the daily long-form slate varied while still ranking by performance.

## Example Workflow

1. Query recent published YouTube Shorts for `phat_phap`.
2. Pull the latest metric snapshot per published short.
3. Group rows by normalized topic.
4. Compute topic aggregates and family strength.
5. Filter weak topics.
6. Rank survivors by weighted score.
7. Select top `4`.
8. Write daily JSON + Markdown plan.

## How To Run

Use the existing local TypeScript runner pattern:

```bash
./node_modules/.bin/tsx --tsconfig tsconfig.json scripts/generate-longform-topic-candidates.ts
```

## V1 Limits

V1 does not:

- auto-render any long-form video
- call LLMs for topic expansion
- write to upload queue
- change Shorts generation or scheduling

V1 also does not yet:

- de-duplicate semantically similar but differently phrased topics across wider clusters
- compare CTR because CTR coverage is still incomplete
- optimize by niche beyond the current `phat_phap` target

## Future V2 Ideas

- topic-cluster merging across similar titles
- richer packaging generation with LLM support
- explicit chapter-outline suggestions
- operator review UI
- automatic feed into long-form content planning queue

## Today’s Example

After running the script, today’s example plan is written to:

- `reports/longform-topic-plans/2026-06-12.json`
- `reports/longform-topic-plans/2026-06-12.md`

