# Long-Form TTS Audit

Date: 2026-06-12

## Scope

Audit of the current local VieNeu-TTS production path only. No code was changed.

Primary implementation inspected:

- [`tts-server/server.py`](/Users/bichtuyen/code/content_pipline/tts-server/server.py:30)
- [`src/lib/pipeline/tts.ts`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:38)
- [`src/lib/finance-news/render-draft.ts`](/Users/bichtuyen/code/content_pipline/src/lib/finance-news/render-draft.ts:165)

## Executive Summary

The current TTS stack is not safe for unchunked long-form generation.

Observed behavior on 2026-06-12:

- `500` words completed quickly enough, but quality already degraded badly.
- `1000` words still completed within the main `25 min` production timeout, but transcript coverage dropped to about `86%`.
- `2000` words still completed within `25 min`, but transcript coverage collapsed to about `23%`.
- `4000` words was still `processing` after `25 minutes`, which means it is not production-safe under the current caller timeout.
- `6000` words was not run to completion in this audit because the system is single-worker and `4000` already exceeded the production SLA. Given the monotonic slowdown and the `4000` result, `6000` is not safe under the current design.

Recommended operating point:

- Safe chunk size: `600-900 words`
- Conservative default: `750 words`
- Hard stop per chunk: `<= 1000 words`

## Current Implementation

### Server behavior

The TTS server:

- Loads `Vieneu(mode="standard", backbone_device="cpu", emotion="natural")` at startup.
- Loads `faster-whisper` `base` for timestamps.
- Allows only `1` TTS job at a time via `_tts_lock = asyncio.Semaphore(1)`.
- Queues async jobs in memory and processes them serially.
- Enforces only a minimum input length of `5` characters.
- Does **not** enforce a maximum text length.

Relevant refs:

- [`tts-server/server.py:38`](/Users/bichtuyen/code/content_pipline/tts-server/server.py:38)
- [`tts-server/server.py:54`](/Users/bichtuyen/code/content_pipline/tts-server/server.py:54)
- [`tts-server/server.py:65`](/Users/bichtuyen/code/content_pipline/tts-server/server.py:65)
- [`tts-server/server.py:206`](/Users/bichtuyen/code/content_pipline/tts-server/server.py:206)
- [`tts-server/server.py:255`](/Users/bichtuyen/code/content_pipline/tts-server/server.py:255)

### Production caller behavior

Main production caller in `src/lib/pipeline/tts.ts`:

- Submit timeout: `30s`
- Poll interval: `15s`
- Poll timeout: `10s`
- Overall timeout: `25 min`
- No true retry/resubmit loop for failed synthesis
- Transient poll failures are ignored and polling continues

Relevant refs:

- [`src/lib/pipeline/tts.ts:38`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:38)
- [`src/lib/pipeline/tts.ts:39`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:39)
- [`src/lib/pipeline/tts.ts:438`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:438)
- [`src/lib/pipeline/tts.ts:453`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:453)
- [`src/lib/pipeline/tts.ts:556`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:556)

Secondary standalone caller in finance draft path:

- Submit timeout: `30s`
- Poll interval: `15s`
- Poll timeout: `10s`
- Overall timeout: `10 min`

Relevant ref:

- [`src/lib/finance-news/render-draft.ts:165`](/Users/bichtuyen/code/content_pipline/src/lib/finance-news/render-draft.ts:165)

## Timeout Settings

### TTS server

- No server-side generation timeout found in the FastAPI TTS endpoints.
- Timestamps endpoint also has no explicit server-side request timeout.

### Main production TTS path

- Submit request timeout: `30_000 ms`
- Poll request timeout: `10_000 ms`
- Poll interval: `15_000 ms`
- Overall wait timeout: `25 * 60 * 1000 ms`

### Finance draft standalone path

- Submit request timeout: `30_000 ms`
- Poll request timeout: `10_000 ms`
- Poll interval: `15_000 ms`
- Overall wait timeout: `10 * 60 * 1000 ms`

## Retry Settings

Current retry behavior is minimal:

- No automatic resubmission on TTS failure.
- No exponential backoff.
- No limited retry count.
- Polling ignores transient non-OK responses and continues.
- Timestamp fetch for optional pause injection returns `[]` on failure and silently skips that step.

In practice, this means long-form jobs are exposed to:

- single-shot synth failure
- silent validation degradation
- queue delay from earlier jobs because only one job runs at a time

## Max Text Length

### Hard limit in code

No hard maximum text length was found.

Current constraints are practical, not explicit:

- only `min 5 characters` enforced at the API layer
- `25 min` caller timeout in production
- one-job-at-a-time server model
- growing memory and latency with longer text
- quality degradation before timeout

### Effective max safe length

Based on the 2026-06-12 tests, the effective safe limit for a single unchunked request is below `1000 words`, and the quality-safe limit is closer to `750 words`.

## Current Audio Validation

The stack does some post-processing and limited QA, but not long-form safety validation.

Present today:

- text normalization before synth
- optional audio cache keyed by normalized text hash
- FFmpeg loudness normalization and silence trimming
- optional Whisper-based punctuation pause injection path
- QA logs for punctuation/pause insertion counts
- file existence checks

Missing today:

- transcript-vs-source coverage check
- truncation detection
- repeated phrase detection
- hallucination/content drift detection
- silence artifact detection
- audio duration sanity envelope
- max words/chars guard before submit
- queue age / wait budgeting

Relevant refs:

- [`src/lib/pipeline/tts.ts:73`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:73)
- [`src/lib/pipeline/tts.ts:101`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:101)
- [`src/lib/pipeline/tts.ts:134`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:134)
- [`src/lib/pipeline/tts.ts:340`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:340)
- [`src/lib/pipeline/tts.ts:510`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:510)

## Controlled Tests

### Method

On 2026-06-12, I submitted controlled Vietnamese scripts of approximately:

- `500` words
- `1000` words
- `2000` words
- `4000` words

Each script repeated a stable narration pattern with incrementing section numbers so truncation and drift were easier to spot.

Metrics collected:

- server-reported generation time
- output audio duration
- container memory snapshots from `docker stats`
- Whisper transcript word count from `/timestamps`
- FFmpeg long-silence scan with `silencedetect=noise=-35dB:d=1.2`

Note:

- `6000` words was not completed because the server is single-worker and the `4000`-word job was still running after the production timeout window. The `6000` conclusion below is therefore an inference from observed monotonic scaling plus the hard `25 min` client timeout.

### Results Table

| Size | Approx chars | TTS status | Generation time | Audio duration | Transcript words | Coverage vs input | Memory observed | Notes |
|---|---:|---|---:|---:|---:|---:|---|---|
| 500 words | 2,137 | done | 70.6s | 112.7s | 325 | 65.0% | ~1.57 GiB spot | strong drift/corruption already visible |
| 1000 words | 4,286 | done | 303.3s | 246.7s | 859 | 85.9% | ~1.82 GiB spot | within timeout, quality already unstable |
| 2000 words | 8,577 | done | 700.9s | 481.4s | 458 | 22.9% | ~1.61 GiB sustained spot | severe truncation/drift |
| 4000 words | 17,187 | still processing after 25 min | >1500s | n/a at timeout boundary | n/a | n/a | ~1.85-2.30 GiB | exceeds production caller timeout |
| 6000 words | ~25k+ | not run to completion | expected >25 min | n/a | n/a | n/a | n/a | unsafe by inference under current architecture |

### Failures

#### 500 words

- No HTTP failure.
- No FFmpeg-detected silent gaps longer than `1.2s`.
- Quality failure present:
  - transcript coverage only `325 / 500`
  - strong content drift
  - obvious token corruption
  - a long stretched region around one word timestamp span (`hiện` from about `47.52s` to `62.94s`) indicating elongation/stall rather than silence

#### 1000 words

- No synthesis failure.
- Stayed within the `25 min` production timeout.
- Whisper transcript returned `859` words, indicating meaningful loss/corruption already.

#### 2000 words

- No synthesis failure.
- Stayed within the `25 min` production timeout.
- Transcript dropped to `458` words on an input of `2000`, indicating severe truncation or unusable drift.

#### 4000 words

- Still `processing` at `13:12:27` local time on 2026-06-12, which is `25 minutes` after submission at `12:47:19`.
- This means the current main caller in [`src/lib/pipeline/tts.ts:39`](/Users/bichtuyen/code/content_pipline/src/lib/pipeline/tts.ts:39) would have timed out before completion.

#### 6000 words

- Not executed to completion in this audit because the single-worker queue was already occupied by the `4000`-word case beyond the main production timeout window.
- Since `4000` already breaches the `25 min` wait budget, `6000` is not a viable single-request production path.

## Interpretation

### Maximum safe script length

For production, the maximum safe unchunked script length should be treated as:

- `Not safe`: `>= 1000 words`
- `Operationally unsafe`: `>= 4000 words`
- `Recommended safe chunk`: `600-900 words`
- `Best default`: `750 words`

Reasoning:

- `500` words already shows quality drift.
- `1000` words remains fast enough operationally but not reliably faithful.
- `2000` words is operationally possible but quality collapses.
- `4000` words exceeds the current caller timeout.

## Recommended Chunking Strategy

### Chunk size

Use:

- target `750 words`
- max `900 words`
- fallback split at sentence boundary if above `900`

Do not send:

- `>1000 words` in one request

### Split rules

Split on:

- paragraph boundaries first
- then sentence boundaries
- then clause boundaries only if needed

Avoid:

- splitting inside quotations
- splitting inside numbered lists without carrying the number into the next chunk
- splitting after commas unless no sentence boundary exists

### Overlap

Use text overlap only in metadata, not in spoken output:

- keep `1` previous sentence as merge context for QA/comparison
- do **not** include duplicated overlap in the synthesized text itself

## Recommended Merge Strategy

### Audio merge

Merge chunk WAV files with:

- sample-rate normalization first
- short crossfade or fixed join padding only if needed

Recommended join behavior:

- `120-180 ms` silence between chunks, not more
- no large fade-in/fade-out per chunk
- normalize loudness per chunk before concatenation to avoid level jumps

### Ordering

- preserve chunk index order
- store per-chunk manifest:
  - chunk id
  - source text
  - word count
  - char count
  - duration
  - generation time
  - validation status

## Recommended Validation Strategy

Minimum production validation per chunk:

1. Run Whisper transcription on the chunk.
2. Compare transcript word count to input word count.
3. Reject chunk if coverage is below `90%`.
4. Reject chunk if final `15-20` source words do not appear in transcript tail.
5. Reject chunk if any single token duration exceeds `3s`.
6. Reject chunk if adjacent repeated `2-gram` or `3-gram` phrases appear above a small threshold.
7. Reject chunk if FFmpeg finds silence gaps longer than `1.2s` unless intentionally inserted.

Recommended acceptance thresholds:

- transcript coverage: `>= 90%`
- tail match: `>= 12 of last 20 source words`
- max word duration: `< 3.0s`
- long silence count (`>1.2s`): `0`

## Final Recommendation

If the system must stay code-identical, the safest operating policy is:

- chunk all long-form scripts into `~750-word` pieces
- never submit a single request above `1000 words`
- reject any chunk whose transcript coverage is under `90%`
- concatenate only validated chunks

If forced to pick one number for production today:

- **Maximum safe script length: `750 words per TTS request`**

If forced to pick one red line:

- **Do not ship single-request scripts above `1000 words`**

