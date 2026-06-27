#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

LABELS=(
  "com.contentpipeline.story-catalog"
  "com.contentpipeline.story-chapters"
  "com.contentpipeline.story-retry-failed"
)

for label in "${LABELS[@]}"; do
  plist_path="$LAUNCH_AGENTS_DIR/$label.plist"

  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  elif [[ -f "$plist_path" ]]; then
    launchctl unload -w "$plist_path" >/dev/null 2>&1 || true
  fi

  rm -f "$plist_path"
  echo "Removed $label"
done

echo
echo "Story Library LaunchAgents removed from $LAUNCH_AGENTS_DIR"
