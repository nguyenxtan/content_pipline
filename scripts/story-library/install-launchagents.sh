#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/launchd"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
RENDER_DIR="$PROJECT_ROOT/tmp/story-library-launchd"
LOG_DIR="$PROJECT_ROOT/logs"

LABELS=(
  "com.contentpipeline.story-catalog"
  "com.contentpipeline.story-chapters"
  "com.contentpipeline.story-retry-failed"
)

SCRIPTS=(
  "$SCRIPT_DIR/crawl-catalog-once.sh"
  "$SCRIPT_DIR/crawl-chapters-once.sh"
  "$SCRIPT_DIR/retry-failed-once.sh"
  "$SCRIPT_DIR/install-launchagents.sh"
  "$SCRIPT_DIR/uninstall-launchagents.sh"
  "$SCRIPT_DIR/status-launchagents.sh"
)

mkdir -p "$LAUNCH_AGENTS_DIR" "$RENDER_DIR" "$LOG_DIR"
chmod +x "${SCRIPTS[@]}"

LAUNCHD_STDOUT="$LOG_DIR/story-crawler.launchd.out.log"
LAUNCHD_STDERR="$LOG_DIR/story-crawler.launchd.err.log"

render_template() {
  local template_path="$1"
  local output_path="$2"

  sed \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__LAUNCHD_STDOUT__|$LAUNCHD_STDOUT|g" \
    -e "s|__LAUNCHD_STDERR__|$LAUNCHD_STDERR|g" \
    -e "s|__CATALOG_SCRIPT__|$SCRIPT_DIR/crawl-catalog-once.sh|g" \
    -e "s|__CHAPTERS_SCRIPT__|$SCRIPT_DIR/crawl-chapters-once.sh|g" \
    -e "s|__RETRY_SCRIPT__|$SCRIPT_DIR/retry-failed-once.sh|g" \
    "$template_path" >"$output_path"
}

render_template \
  "$TEMPLATE_DIR/com.contentpipeline.story-catalog.plist" \
  "$RENDER_DIR/com.contentpipeline.story-catalog.plist"

render_template \
  "$TEMPLATE_DIR/com.contentpipeline.story-chapters.plist" \
  "$RENDER_DIR/com.contentpipeline.story-chapters.plist"

render_template \
  "$TEMPLATE_DIR/com.contentpipeline.story-retry-failed.plist" \
  "$RENDER_DIR/com.contentpipeline.story-retry-failed.plist"

for label in "${LABELS[@]}"; do
  target="$LAUNCH_AGENTS_DIR/$label.plist"
  cp "$RENDER_DIR/$label.plist" "$target"

  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  fi

  if launchctl bootstrap "gui/$(id -u)" "$target" >/dev/null 2>&1; then
    :
  else
    launchctl load -w "$target"
  fi
done

echo "Installed Story Library LaunchAgents:"
for label in "${LABELS[@]}"; do
  echo "  - $label"
done
echo
echo "Status command:"
echo "  pnpm run story-library:schedule:status"
echo
echo "Logs:"
echo "  $PROJECT_ROOT/logs/story-crawler.log"
echo "  $PROJECT_ROOT/logs/story-crawler.launchd.out.log"
echo "  $PROJECT_ROOT/logs/story-crawler.launchd.err.log"
