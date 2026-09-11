#!/usr/bin/env bash
# NavPro Mini Touchscreen Kiosk Launcher
# Starts local web server hosting Flutter web build and launches Chromium in fullscreen kiosk mode.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_BUILD_DIR="${APP_DIR}/build/web"
PORT=8088

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/home/navpromini/.Xauthority}"

# Ensure web build exists
if [ ! -d "${WEB_BUILD_DIR}" ]; then
    echo "[KIOSK] Web build not found at ${WEB_BUILD_DIR}. Run 'flutter build web' first."
    exit 1
fi

# Kill any existing server on port 8088
fuser -k ${PORT}/tcp 2>/dev/null || true

# Start background static HTTP server
python3 -m http.server ${PORT} --directory "${WEB_BUILD_DIR}" &
SERVER_PID=$!
trap "kill ${SERVER_PID} 2>/dev/null || true" EXIT

# Give server time to bind
sleep 1

# Disable screen blanking & DPMS
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Launch Chromium in dedicated Kiosk mode
exec chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --check-for-update-interval=31536000 \
    --overscroll-history-navigation=0 \
    --touch-events=enabled \
    --autoplay-policy=no-user-gesture-required \
    "http://127.0.0.1:${PORT}"
