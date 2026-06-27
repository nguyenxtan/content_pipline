#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/story-crawler.log"

mkdir -p "$LOG_DIR"

PNPM_BIN="${PNPM_BIN:-}"
if [[ -z "$PNPM_BIN" ]]; then
  PNPM_BIN="$(command -v pnpm || true)"
fi
if [[ -z "$PNPM_BIN" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm" ]]; then
  PNPM_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm"
fi
if [[ -z "$PNPM_BIN" ]]; then
  echo "[STORY_CRAWLER] failed_request {\"mode\":\"retry-failed-once\",\"error\":\"pnpm not found\"}" >>"$LOG_FILE"
  exit 1
fi

PNPM_DIR="$(cd "$(dirname "$PNPM_BIN")" && pwd)"
export PATH="$PNPM_DIR:$PATH"

NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" && -x "$PNPM_DIR/node" ]]; then
  NODE_BIN="$PNPM_DIR/node"
fi
if [[ -z "$NODE_BIN" ]]; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "[STORY_CRAWLER] failed_request {\"mode\":\"retry-failed-once\",\"error\":\"node not found\"}" >>"$LOG_FILE"
  exit 1
fi

NODE_DIR="$(cd "$(dirname "$NODE_BIN")" && pwd)"
export PATH="$NODE_DIR:$PATH"

MAX_STORIES="${STORY_LIBRARY_RETRY_MAX_STORIES:-5}"
MAX_CHAPTERS="${STORY_LIBRARY_RETRY_MAX_CHAPTERS:-10}"
SOURCE_SITE="${STORY_LIBRARY_SOURCE_SITE:-truyenfull.today}"

{
  echo "[STORY_CRAWLER] wrapper_start {\"mode\":\"retry-failed-once\",\"sourceSite\":\"$SOURCE_SITE\",\"maxStories\":$MAX_STORIES,\"maxChapters\":$MAX_CHAPTERS}"
  cd "$PROJECT_ROOT"
  "$PNPM_BIN" run crawl:stories:resume -- --source-site "$SOURCE_SITE" --failed-only --max-stories "$MAX_STORIES" --max-chapters "$MAX_CHAPTERS"
  echo "[STORY_CRAWLER] wrapper_complete {\"mode\":\"retry-failed-once\",\"sourceSite\":\"$SOURCE_SITE\",\"maxStories\":$MAX_STORIES,\"maxChapters\":$MAX_CHAPTERS}"
} >>"$LOG_FILE" 2>&1
