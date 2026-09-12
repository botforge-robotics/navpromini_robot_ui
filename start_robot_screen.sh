#!/usr/bin/env bash
# ==============================================================================
# NavPro Mini - Onboard Robot Screen UI Launcher
# Starts the background UI server if not running and opens a dedicated app kiosk
# ==============================================================================

set -e

export DISPLAY="${DISPLAY:-:1}"
UI_DIR="/home/chaitu/Projects/navpromini_robot_ui"
PORT=8090
URL="http://127.0.0.1:${PORT}/"

# Check if port 8090 is already responding
if ! curl -s -m 1 "http://127.0.0.1:${PORT}/" > /dev/null 2>&1; then
    echo "[Robot Screen] Starting background server on port ${PORT}..."
    setsid python3 -m http.server ${PORT} --directory "${UI_DIR}" </dev/null >/dev/null 2>&1 &
    sleep 1
fi

# Launch in dedicated Chrome App window (no address bar, feels like physical touchscreen tablet)
if command -v google-chrome > /dev/null 2>&1; then
    setsid google-chrome \
        --app="${URL}" \
        --window-size=1024,640 \
        --window-position=120,80 \
        --user-data-dir="/tmp/navpro_robot_screen_profile" \
        --disable-features=Translate \
        --no-first-run \
        --no-default-browser-check </dev/null >/dev/null 2>&1 &
elif command -v chromium > /dev/null 2>&1; then
    setsid chromium \
        --app="${URL}" \
        --window-size=1024,640 \
        --window-position=120,80 \
        --user-data-dir="/tmp/navpro_robot_screen_profile" </dev/null >/dev/null 2>&1 &
elif command -v xdg-open > /dev/null 2>&1; then
    xdg-open "${URL}"
else
    firefox "${URL}" &
fi

echo "[Robot Screen] Launched successfully at ${URL}"
