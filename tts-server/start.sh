#!/bin/bash
# TTS Server management script
# Dùng: bash tts-server/start.sh [install|uninstall|run|status]

PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.contentpipeline.tts.plist"
PLIST_DEST=~/Library/LaunchAgents/com.contentpipeline.tts.plist

install_service() {
  cp "$PLIST_SRC" "$PLIST_DEST"
  launchctl load "$PLIST_DEST"
  echo "✅ TTS service đã cài xong."
  echo "   - Tự chạy mỗi lần boot"
  echo "   - Log: tts-server/tts.log"
  echo "   - Gỡ: bash tts-server/start.sh uninstall"
}

uninstall_service() {
  launchctl unload "$PLIST_DEST" 2>/dev/null
  rm -f "$PLIST_DEST"
  echo "✅ Đã gỡ TTS service"
}

status_service() {
  if launchctl list | grep -q "com.contentpipeline.tts"; then
    echo "✅ TTS service đang chạy"
    curl -s http://localhost:8765/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "   (server chưa phản hồi)"
  else
    echo "⛔ TTS service không chạy"
  fi
}

run_foreground() {
  echo "🚀 Khởi động VieNeu-TTS Server (foreground)..."
  source ~/venv-tts-new/bin/activate
  python "$(dirname "$0")/server.py"
}

case "${1:-run}" in
  install)   install_service ;;
  uninstall) uninstall_service ;;
  status)    status_service ;;
  run|*)     run_foreground ;;
esac
