# Short Cover Intro Experiment

Generated at: 2026-06-02 21:23 ICT

## Goal

Prepare a small publish-safe experiment batch for the short cover intro feature without changing upload logic or modifying the existing upload queue.

## Experiment Marker

- `experimentId`: `SHORT_COVER_INTRO`
- `experimentVariant`: `COVER_INTRO_ON`

## Render Config

- `SHORT_COVER_INTRO_ENABLED=true`
- `SHORT_COVER_DURATION_SEC=1.5`
- `SHORT_COVER_FADE_OUT_SEC=0.25`

## Batch Result

- Requested: `5`
- Selected: `5`
- Skipped: `0`

All selected items passed subtitle validation and had `subtitleHealthScore >= 90`.

## Selected Batch

| Content ID | Topic | Cover Text | Subtitle Health | Experiment Video | Baseline Snapshot |
| --- | --- | --- | ---: | --- | --- |
| `246ccd33-c720-470c-b065-d1ab72d0aedd` | Cảm giác bất an | `BẤT AN VÌ ĐIỀU GÌ` | `100` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/01-246ccd33-c720-470c-b065-d1ab72d0aedd-cover-intro.mp4` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/01-246ccd33-c720-470c-b065-d1ab72d0aedd-baseline.mp4` |
| `69c06285-f57a-49b0-ab55-dd9bd3d65ed3` | Sợ phải đối diện | `ĐIỀU GÌ PHẢI ĐỐI DIỆN` | `92` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/02-69c06285-f57a-49b0-ab55-dd9bd3d65ed3-cover-intro.mp4` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/02-69c06285-f57a-49b0-ab55-dd9bd3d65ed3-baseline.mp4` |
| `ac597251-376d-4ef4-bf33-bc320d73ffe5` | Mất mát tình thương | `TRƯỚC KHI MẤT ĐI` | `100` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/03-ac597251-376d-4ef4-bf33-bc320d73ffe5-cover-intro.mp4` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/03-ac597251-376d-4ef4-bf33-bc320d73ffe5-baseline.mp4` |
| `9ed7d2d2-3356-4f9d-a84a-d8f675335812` | Cố chấp | `ĐỪNG TỰ LÀM KHỔ` | `100` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/04-9ed7d2d2-3356-4f9d-a84a-d8f675335812-cover-intro.mp4` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/04-9ed7d2d2-3356-4f9d-a84a-d8f675335812-baseline.mp4` |
| `62f9c8c1-cef2-444d-896a-c585d9c009d0` | Sợ cô đơn | `CÔ ĐƠN KHÔNG ĐÁNG SỢ` | `100` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/05-62f9c8c1-cef2-444d-896a-c585d9c009d0-cover-intro.mp4` | `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/05-62f9c8c1-cef2-444d-896a-c585d9c009d0-baseline.mp4` |

## Output Assets

Each selected item also has:

- cover asset in `media/covers/<contentId>-short-cover.jpg`
- experiment thumb snapshot in `output/short-cover-intro-experiment/<nn>-<contentId>-cover-intro-thumb.jpg`
- summary JSON in `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/summary.json`

## Safety Checks

- The canonical short video path in `media/videos/<contentId>-short.mp4` was restored after each render.
- SHA1 check confirmed the restored canonical file matches the saved baseline snapshot for all 5 selected items.
- `content_generations.experiment_id` and `experiment_variant` were updated only for the selected batch.
- No upload was triggered.
- `upload_queue` was not modified.

## Queue State Note

These selected items are still already queued for short publishing on YouTube and Facebook. This task intentionally did not touch those queue rows.

That means the experiment videos are ready, but the canonical publish path still points to the restored baseline file in `media/videos/<contentId>-short.mp4`.

## Skipped Items

None in this batch.

## Visual Issues

No render-time or subtitle validation failures were detected in this preparation batch.

Known review note carried over from earlier visual QA:

- branding at the lower-left remains subtle, but on bright scenes it sits relatively close to the subtitle-safe zone
- the selected batch is publish-safe from a subtitle-health perspective, but one final human spot-check before live publish is still recommended

## How To Publish This Batch Manually

This batch is prepared for publish testing, but not activated automatically.

### Safest path without changing queue rows

1. Pick one content item from the batch.
2. Copy the experiment render over the canonical pipeline path right before the scheduled short upload runs:

```bash
cp /Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/01-246ccd33-c720-470c-b065-d1ab72d0aedd-cover-intro.mp4 \
  /Users/bichtuyen/code/content_pipline/media/videos/246ccd33-c720-470c-b065-d1ab72d0aedd-short.mp4
```

3. Let the existing publish workflow upload that canonical short file.
4. After publish completes, restore the local baseline if you want to keep the original canonical asset on disk:

```bash
cp /Users/bichtuyen/code/content_pipline/output/short-cover-intro-experiment/01-246ccd33-c720-470c-b065-d1ab72d0aedd-baseline.mp4 \
  /Users/bichtuyen/code/content_pipline/media/videos/246ccd33-c720-470c-b065-d1ab72d0aedd-short.mp4
```

### If you want to publish immediately instead of waiting for the queued schedule

You should first pause cron processing or manually clear/reschedule the existing queued short rows in the app, then swap in the experiment file and trigger the normal publish flow. This document does not automate that step.

## How To Compare Later Against Baseline

Use both the saved files and the analytics markers:

1. Asset-level comparison:
   - baseline: `output/short-cover-intro-experiment/<nn>-<contentId>-baseline.mp4`
   - experiment: `output/short-cover-intro-experiment/<nn>-<contentId>-cover-intro.mp4`

2. Data-level comparison:
   - experiment group: `content_generations.experiment_id = 'SHORT_COVER_INTRO'`
   - variant: `content_generations.experiment_variant = 'COVER_INTRO_ON'`
   - compare against nearby shorts without this experiment marker

3. Primary metrics to compare after analytics sync:
   - views
   - `avgViewDurationSec`
   - `avgRetentionPct`

## Files Added For This Experiment

- `/Users/bichtuyen/code/content_pipline/scripts/prepare-short-cover-intro-experiment.ts`
- `/Users/bichtuyen/code/content_pipline/docs/SHORT_COVER_INTRO_EXPERIMENT.md`
