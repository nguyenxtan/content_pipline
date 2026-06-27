# Repo Disk Usage Report

Generated: 2026-06-03 00:17 ICT

## Scope

This report audits disk usage for:

- repo root: `/Users/bichtuyen/code/content_pipline`
- parent code folder: `/Users/bichtuyen/code`

No files were deleted. No code behavior was changed.

## Executive Summary

The repo itself is the main reason `~/code` is heavy right now:

- `~/code`: `15G`
- repo root: `15G`

The biggest drivers are:

1. `.next` — `9.4G`
2. `.git` — `3.3G`
3. `media` — `1.5G`
4. `node_modules` — `933M`

Within `.next`, the dominant source is:

- `.next/dev/cache/turbopack` — `6.6G`

Within `.git`, the dominant source is:

- `.git/objects` — `3.3G`
- `.git/objects/pack` is only `188K`

That means git storage is currently mostly loose objects, not packed history.

## Size Breakdown

| Target | Size |
| --- | ---: |
| repo root total | `15G` |
| `~/code` total | `15G` |
| `node_modules` | `933M` |
| `.next` | `9.4G` |
| `.git` | `3.3G` |
| `media` | `1.5G` |
| `output` | `8.0K` |
| `.next/dev/cache` | `6.6G` |
| `.next/cache` | `596K` |
| `media/audio-cache` | `192M` |
| `drizzle` | `404K` |
| `docs` | `460K` |
| `src` | `1.7M` |

### `.next` internals

| Target | Size |
| --- | ---: |
| `.next/dev` | `8.8G` |
| `.next/standalone` | `580M` |
| `.next/server` | `38M` |
| `.next/static` | `2.1M` |
| `.next/build` | `848K` |
| `.next/cache` | `596K` |

### `media` internals

| Target | Size |
| --- | ---: |
| `media/videos` | `966M` |
| `media/music` | `219M` |
| `media/audio-cache` | `192M` |
| `media/audio` | `132M` |
| `media/images` | `8.6M` |
| `media/covers` | `4.5M` |

### `git` internals

| Target | Size |
| --- | ---: |
| `.git/objects` | `3.3G` |
| `.git/objects/pack` | `188K` |
| `.git/logs` | `20K` |
| `.git/hooks` | `60K` |

### pnpm store outside repo

Discovered on this machine:

| Target | Size |
| --- | ---: |
| `/Users/bichtuyen/Library/pnpm` | `924M` |
| `/Users/bichtuyen/Library/Caches/pnpm` | `355M` |

### Docker-related files inside repo

Present, but not currently the disk problem:

- `Dockerfile`
- `docker-compose.yml`
- `.next/standalone/Dockerfile`
- `.next/standalone/docker-compose.yml`
- `facebook-page-token-manager/Dockerfile`
- `facebook-page-token-manager/docker-compose.yml`
- `tts-server/Dockerfile`

## Top 20 Largest Directories

| Rank | Directory | Size |
| --- | --- | ---: |
| 1 | `.` | `15G` |
| 2 | `./.next` | `9.4G` |
| 3 | `./.next/dev` | `8.8G` |
| 4 | `./.next/dev/cache` | `6.6G` |
| 5 | `./.next/dev/cache/turbopack/ee6e79b1` | `6.6G` |
| 6 | `./.next/dev/cache/turbopack` | `6.6G` |
| 7 | `./.git` | `3.3G` |
| 8 | `./.git/objects` | `3.3G` |
| 9 | `./media` | `1.5G` |
| 10 | `./.next/dev/server` | `1.3G` |
| 11 | `./.next/dev/server/chunks` | `1.3G` |
| 12 | `./.next/dev/server/chunks/ssr` | `1.2G` |
| 13 | `./media/videos` | `966M` |
| 14 | `./node_modules` | `933M` |
| 15 | `./node_modules/.pnpm` | `933M` |
| 16 | `./.next/dev/static` | `809M` |
| 17 | `./.next/dev/static/chunks` | `809M` |
| 18 | `./.next/standalone` | `580M` |
| 19 | `./.next/standalone/media` | `456M` |
| 20 | `./media/music` | `219M` |

## Top 30 Largest Files

Most of the largest files are Turbopack cache SST files under `.next/dev/cache/turbopack`.

| Rank | File | Size |
| --- | --- | ---: |
| 1 | `./.next/dev/cache/turbopack/ee6e79b1/00019737.sst` | `253M` |
| 2 | `./.next/dev/cache/turbopack/ee6e79b1/00020288.sst` | `253M` |
| 3 | `./.next/dev/cache/turbopack/ee6e79b1/00021794.sst` | `252M` |
| 4 | `./.next/dev/cache/turbopack/ee6e79b1/00026331.sst` | `252M` |
| 5 | `./.next/dev/cache/turbopack/ee6e79b1/00018109.sst` | `252M` |
| 6 | `./.next/dev/cache/turbopack/ee6e79b1/00021894.sst` | `251M` |
| 7 | `./.next/dev/cache/turbopack/ee6e79b1/00017999.sst` | `251M` |
| 8 | `./.next/dev/cache/turbopack/ee6e79b1/00012178.sst` | `251M` |
| 9 | `./.next/dev/cache/turbopack/ee6e79b1/00017664.sst` | `251M` |
| 10 | `./.next/dev/cache/turbopack/ee6e79b1/00021798.sst` | `251M` |
| 11 | `./.next/dev/cache/turbopack/ee6e79b1/00012061.sst` | `251M` |
| 12 | `./.next/dev/cache/turbopack/ee6e79b1/00022378.sst` | `249M` |
| 13 | `./.next/dev/cache/turbopack/ee6e79b1/00008975.sst` | `249M` |
| 14 | `./.next/dev/cache/turbopack/ee6e79b1/00007961.sst` | `249M` |
| 15 | `./.next/dev/cache/turbopack/ee6e79b1/00024298.sst` | `248M` |
| 16 | `./.next/dev/cache/turbopack/ee6e79b1/00007806.sst` | `248M` |
| 17 | `./.next/dev/cache/turbopack/ee6e79b1/00005194.sst` | `244M` |
| 18 | `./.next/dev/cache/turbopack/ee6e79b1/00006230.sst` | `244M` |
| 19 | `./.next/dev/cache/turbopack/ee6e79b1/00006318.sst` | `244M` |
| 20 | `./.next/dev/cache/turbopack/ee6e79b1/00006313.sst` | `242M` |
| 21 | `./.next/dev/cache/turbopack/ee6e79b1/00021885.sst` | `213M` |
| 22 | `./.git/objects/f8/3760296982e80f877d8835805bfa2d290a0b96` | `203M` |
| 23 | `./.git/objects/ca/a6d59998a59c5ad1044ceaee5d802f4c9c7475` | `203M` |
| 24 | `./.git/objects/a6/e14738dc76eca0492223a4fc0deb68aaac6680` | `203M` |
| 25 | `./.git/objects/b0/a09ef5532ef6134bd69a3c522f5fd6c5310e5c` | `201M` |
| 26 | `./.git/objects/10/2d0bffe0b77bc49a204d60904174d907145863` | `201M` |
| 27 | `./.git/objects/21/c37e62ac9d2dd135808c942f7618cdc8d03b33` | `200M` |
| 28 | `./.git/objects/05/4e7fd542f741b1d4fb9b2946e19e8b0e8b8795` | `199M` |
| 29 | `./.git/objects/2d/0f47aeccda07a7ddb63bb78acc6728b4c1ebde` | `198M` |
| 30 | `./.git/objects/0c/eb4a7c866c8b3e64e25576b4811bea950e6347` | `197M` |

## Why The Repo Is Large

### 1. Turbopack dev cache is the biggest issue

`.next/dev/cache/turbopack` alone is `6.6G`.

This is the single largest reclaimable area in the repo. It is generated cache, not source.

### 2. Git object storage is abnormally large

`.git/objects` is `3.3G`, while `.git/objects/pack` is only `188K`.

That pattern usually means:

- many large files were committed in repo history
- local git objects have not been garbage-collected/packed recently
- generated artifacts may have been committed or rewritten historically

### 3. Media is real project payload

`media` is `1.5G`, mostly:

- `media/videos` — `966M`
- `media/music` — `219M`
- `media/audio-cache` — `192M`
- `media/audio` — `132M`

This is not accidental bloat in the same way as `.next`; it is actual pipeline asset storage.

### 4. `node_modules` is normal but still heavy

`node_modules` is `933M`, which is large but not unusual for a Next.js + media tooling stack with ffmpeg/sharp/native packages.

## What Is Safe To Delete

These are generally safe to remove and regenerate later:

- `.next/`
  - especially `.next/dev/cache/turbopack`
  - regenerated by Next dev/build
- `output/`
  - current report shows it is tiny anyway
  - contains test/export artifacts, not canonical pipeline state
- `media/audio-cache/`
  - safe if you accept cache misses and possible reprocessing cost
- `node_modules/`
  - safe only if you are prepared to reinstall dependencies
- external pnpm caches/stores:
  - `/Users/bichtuyen/Library/pnpm`
  - `/Users/bichtuyen/Library/Caches/pnpm`
  - best cleaned with pnpm prune/store commands, not blind deletion

## What Should Not Be Deleted Blindly

- `.git/`
  - especially not `.git/objects`
  - deleting this corrupts repo history
- `media/videos/`
  - may still be needed for publish, comparison, or review
- `media/audio/`
  - may still be needed for render or audit
- `media/images/`
  - may still be needed for Facebook quote/photo fallback or rerender paths
- `media/covers/`
  - used by short cover and review workflows
- `media/music/`
  - curated pipeline asset library
- `.env.local`
- `src/`, `docs/`, `drizzle/`

## Practical Next Cleanup Candidates

If the goal is fast space recovery with low risk, the order is:

1. `.next/`
2. `output/`
3. `media/audio-cache/`
4. pnpm caches outside repo

If the goal is structural cleanup, a separate future task should inspect:

- why `.git/objects` is `3.3G`
- whether large generated assets entered git history
- whether `git gc` / history cleanup is needed

## Added Tooling

Optional script added:

- `scripts/repo-disk-usage.ts`
- package script: `npm run repo:disk` / `pnpm repo:disk`

It prints:

- key folder sizes
- discovered pnpm stores
- top 20 directories
- top 30 files

## No Action Taken

No files were deleted.
No repo cleanup was executed.
This report is read-only.
