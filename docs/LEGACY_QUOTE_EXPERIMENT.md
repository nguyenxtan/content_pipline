# Legacy Quote Short V1.5 Experiment

Generated: 2026-06-04  
Status: prepared for manual publish testing only.

## Goal

Prepare a small publish-test batch for `legacy_quote_footage_no_voice_v2`, based on the historical finding that old no-voice footage/music/quote shorts outperformed the newer `pipeline_tts_ai_image` format.

This batch does not change the normal TTS pipeline and does not enable the legacy format globally.

## Experiment Identity

- Format type: `legacy_quote_footage_no_voice_v2`
- Experiment ID: `LEGACY_QUOTE_SHORT`
- Experiment variant: `LEGACY_QUOTE_NO_VOICE_V2`
- Render style: no TTS, quote text, music audio, Ken Burns motion, 14s duration
- Publish mode: manual review only
- Auto-upload: no
- Upload queue changed: no

Batch metadata is also stored at:

- `output/legacy-quote-short-v1/experiment-batch.json`

## Prepared Samples

| Sample | Topic | Topic family | Quote text | Visual mode | Motion score | Audio loudness | Video path |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| `legacy-quote-v2-sample-01` | Bình an từ chính chánh niệm | `peace_mindfulness` | Tâm càng đơn giản, đời càng nhẹ nhàng. | `ken_burns_image` / `medium_strong` | 20.12 | mean -21.0 dB, max -3.5 dB | `/Users/bichtuyen/code/content_pipline/output/legacy-quote-short-v1/legacy-quote-v2-sample-01-legacy-quote-short.mp4` |
| `legacy-quote-v2-sample-02` | Buông bỏ khổ đau | `letting_go_forgiveness` | Tha thứ không phải quên đi, mà là thôi tự làm đau mình. | `ken_burns_image` / `medium_strong` | 17.52 | mean -19.1 dB, max -4.4 dB | `/Users/bichtuyen/code/content_pipline/output/legacy-quote-short-v1/legacy-quote-v2-sample-02-legacy-quote-short.mp4` |
| `legacy-quote-v2-sample-03` | Nhân quả không quên | `karma` | Gieo điều lành hôm nay, lòng đã nhẹ hơn ngày hôm qua. | `ken_burns_image` / `medium_strong` | 14.82 | mean -20.4 dB, max -4.8 dB | `/Users/bichtuyen/code/content_pipline/output/legacy-quote-short-v1/legacy-quote-v2-sample-03-legacy-quote-short.mp4` |
| `legacy-quote-v2-sample-04` | Từ bi chữa lành | `buddhist_life_wisdom` | Người hiểu đời không nói nhiều, chỉ sống sâu hơn mỗi ngày. | `ken_burns_image` / `medium_strong` | 18.26 | mean -21.0 dB, max -3.5 dB | `/Users/bichtuyen/code/content_pipline/output/legacy-quote-short-v1/legacy-quote-v2-sample-04-legacy-quote-short.mp4` |
| `legacy-quote-v2-sample-05` | Đời nhẹ hơn khi biết đủ | `buddhist_life_wisdom` | Có những điều mất đi để lòng người học cách rộng hơn. | `ken_burns_image` / `medium_strong` | 17.63 | mean -20.1 dB, max -3.6 dB | `/Users/bichtuyen/code/content_pipline/output/legacy-quote-short-v1/legacy-quote-v2-sample-05-legacy-quote-short.mp4` |

## QC Status

All five samples passed technical QC:

- Duration: 14s
- Audio stream: present
- Audio loudness: ok
- Quote safe area: pass
- Black frames: none detected
- Motion score: 14.82 to 20.12

Full QC report:

- `docs/LEGACY_QUOTE_SAMPLE_QC.md`

Contact sheets:

- `output/legacy-quote-short-v1/contact-sheets/legacy-quote-v2-sample-01-contact.jpg`
- `output/legacy-quote-short-v1/contact-sheets/legacy-quote-v2-sample-02-contact.jpg`
- `output/legacy-quote-short-v1/contact-sheets/legacy-quote-v2-sample-03-contact.jpg`
- `output/legacy-quote-short-v1/contact-sheets/legacy-quote-v2-sample-04-contact.jpg`
- `output/legacy-quote-short-v1/contact-sheets/legacy-quote-v2-sample-05-contact.jpg`

## How To Manually Publish One Test

Use only one sample first. Recommended first test:

- `legacy-quote-v2-sample-02`
- Reason: strongest emotional topic family match for current channel, clean quote, good motion score, good loudness.

Manual publish checklist:

1. Watch the MP4 locally before upload.
2. Confirm no TTS voice is present.
3. Confirm music is audible.
4. Confirm quote text is readable on mobile.
5. Upload manually through the existing YouTube Studio or controlled app workflow.
6. Record the published URL manually with:
   - format type: `legacy_quote_footage_no_voice_v2`
   - experiment ID: `LEGACY_QUOTE_SHORT`
   - experiment variant: `LEGACY_QUOTE_NO_VOICE_V2`
   - topic family from the table above

Do not run upload queue manually for this experiment. Manual scheduler/debug actions must never call real upload.

## How To Compare Later

Compare this batch against two groups:

### Against `pipeline_tts_ai_image`

Use recent shorts with:

- format type: `pipeline_tts_ai_image`
- similar publish window
- similar topic family where possible
- duration under 60s

Primary comparison metrics:

- views after 24h
- views after 72h
- average view duration
- retention percentage
- like rate if available

Interpretation:

- If V1.5 gets higher early views but lower retention, the format may improve stop-scroll but need stronger quote/topic selection.
- If V1.5 gets higher retention and higher views, prepare a larger 20-video batch.
- If V1.5 is neutral, test with cleaner raw footage before abandoning the format.

### Against historical `legacy_quote_footage_no_voice`

Use imported 2025 historical videos classified as `legacy_quote_footage_no_voice`.

Primary comparison metrics:

- median views
- average views
- average retention
- duration-normalized watch time

Important caveat:

V1.5 uses Ken Burns image motion, not clean real footage. If it underperforms historical legacy videos, the likely missing ingredient may be raw footage/background variation rather than the no-voice quote format itself.

## Decision Rule

After one manual test:

- No visual/audio issue: publish the remaining 4 manually, spaced at normal schedule.
- Audio too weak or visual feels artificial: adjust V1.5 style before publishing more.
- Early retention clearly worse than TTS baseline: pause and inspect topic/quote fit.
- Early views promising but sample too thin: expand to 20 samples before feeding this into automation.

Do not enable this format globally until at least 5 manually published samples have analytics.
