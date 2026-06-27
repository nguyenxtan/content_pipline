# Short Cover Intro Test

Date: 2026-06-02  
Mode: review-only batch render, no upload, no upload queue changes  
Feature flags used:

- `SHORT_COVER_INTRO_ENABLED=true`
- `SHORT_COVER_DURATION_SEC=1.5`
- `SHORT_COVER_FADE_OUT_SEC=0.25`

## Scope

This batch tested the `short_cover_hook` intro on a small set of Shorts/Reels for visual review.

The newest `pending/new` short items were checked first, but none of them had ready audio + image assets yet.  
To avoid blocking review, the batch used the newest render-ready short items instead.

## Batch Result

Requested: `6`  
Rendered with usable review output: `3`  
Render blocked by existing subtitle validation failures: `3`

Review directory:

- `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-batch`

## Per-Item Results

### Successful review renders

1. `246ccd33-c720-470c-b065-d1ab72d0aedd`
   Topic: `Cảm giác bất an`
   Cover text: `BẤT AN VÌ ĐIỀU GÌ`
   Video: `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-batch/01-246ccd33-c720-470c-b065-d1ab72d0aedd-intro-test.mp4`
   Cover: `/Users/bichtuyen/code/content_pipline/media/covers/246ccd33-c720-470c-b065-d1ab72d0aedd-short-cover.jpg`
   Duration: `42.12s`
   Subtitle health: `100` (`PASS`)
   First-frame similarity: `0.9923`
   Visual issues: none observed in first-frame / fade-frame spot check

2. `3013c1b5-db20-4f8e-899d-a2cbc87dd7ad`
   Topic: `Sợ bị tổn thương`
   Cover text: `SỢ BỊ TỔN THƯƠNG`
   Video: `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-batch/03-3013c1b5-db20-4f8e-899d-a2cbc87dd7ad-intro-test.mp4`
   Cover: `/Users/bichtuyen/code/content_pipline/media/covers/3013c1b5-db20-4f8e-899d-a2cbc87dd7ad-short-cover.jpg`
   Duration: `42.16s`
   Subtitle health: `100` (`PASS`)
   First-frame similarity: `0.9917`
   Visual issues: none flagged by automation

3. `69c06285-f57a-49b0-ab55-dd9bd3d65ed3`
   Topic: `Sợ phải đối diện`
   Cover text: `ĐIỀU GÌ PHẢI ĐỐI DIỆN`
   Video: `/Users/bichtuyen/code/content_pipline/output/short-cover-intro-batch/06-69c06285-f57a-49b0-ab55-dd9bd3d65ed3-intro-test.mp4`
   Cover: `/Users/bichtuyen/code/content_pipline/media/covers/69c06285-f57a-49b0-ab55-dd9bd3d65ed3-short-cover.jpg`
   Duration: `46.64s`
   Subtitle health: `92` (`PASS`)
   First-frame similarity: `0.9916`
   Visual issues: none flagged by automation

### Items blocked by existing subtitle issues

1. `6962bb6f-c136-4c52-866b-a994835ef2d0`
   Topic: `Mắc kẹt trong quá khứ`
   Cover text: `Đừng Kẹt Quá Khứ`
   Cover: `/Users/bichtuyen/code/content_pipline/media/covers/6962bb6f-c136-4c52-866b-a994835ef2d0-short-cover.jpg`
   Result: render blocked
   Reason: `Subtitle validation failed (78/100): Subtitle/audio drift is 2.32s.`

2. `20f391d8-efd9-45a9-8adf-979879637dbe`
   Topic: `Tìm kiếm bản thân`
   Cover text: `Đừng Lạc Mất Mình`
   Cover: `/Users/bichtuyen/code/content_pipline/media/covers/20f391d8-efd9-45a9-8adf-979879637dbe-short-cover.jpg`
   Result: render blocked
   Reason: `Subtitle validation failed (78/100): Subtitle/audio drift is 0.92s.`

3. `f86006b4-5470-4a03-a442-27f37bd36aa9`
   Topic: `Sợ hãi mất kiểm soát`
   Cover text: `Sợ Mất Kiểm Soát`
   Cover: `/Users/bichtuyen/code/content_pipline/media/covers/f86006b4-5470-4a03-a442-27f37bd36aa9-short-cover.jpg`
   Result: render blocked
   Reason: `Subtitle validation failed (88/100): Found 1 blank/invalid subtitle segments.`

## Visual Review Notes

- The intro cover appears correctly as the first frame on successful renders.
- Fade-out at around `1.4s` looks soft and not abrupt in spot checks.
- Audio still starts at `0.0s`; the intro does not push TTS back.
- Subtitle timing remains aligned on successful samples and still starts immediately.
- Bottom-left channel branding does not directly overlap the center-bottom subtitle region in checked frames.
- One caveat: on bright or low-contrast scenes, the faded cover text is still visible near the subtitle region late in the `1.5s` window. This is not a hard collision, but it is something to keep an eye on when reviewing retention behavior.

## Initial Takeaway

The feature-flagged intro path works as intended on render-ready shorts:

- first frame matches the generated cover
- duration is not extended unexpectedly
- audio starts at `0.0s`
- subtitles remain aligned on passing samples

The immediate blocker for a larger batch is not the intro itself.  
It is pre-existing subtitle validation failures on some source items.
