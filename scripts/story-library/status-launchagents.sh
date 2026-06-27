#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

LABELS=(
  "com.contentpipeline.story-catalog"
  "com.contentpipeline.story-chapters"
  "com.contentpipeline.story-retry-failed"
)

echo "Story Library LaunchAgent status"
echo "Project root: $PROJECT_ROOT"
echo

for label in "${LABELS[@]}"; do
  plist_path="$LAUNCH_AGENTS_DIR/$label.plist"
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    echo "[loaded]  $label"
  elif [[ -f "$plist_path" ]]; then
    echo "[present] $label (plist exists but is not loaded)"
  else
    echo "[absent]  $label"
  fi
done

echo
for log_file in \
  "$LOG_DIR/story-crawler.log" \
  "$LOG_DIR/story-crawler.launchd.out.log" \
  "$LOG_DIR/story-crawler.launchd.err.log"; do
  echo "==> $log_file"
  if [[ -f "$log_file" ]]; then
    tail -n 20 "$log_file"
  else
    echo "(missing)"
  fi
  echo
done
