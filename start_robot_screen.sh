#!/usr/bin/env bash
# ==============================================================================
# NavPro Mini - Onboard Robot Screen UI Launcher (Headless & Fullscreen)
# ==============================================================================

set -e

# Detect environment and display
CURRENT_USER="$(whoami)"
if [[ "${CURRENT_USER}" == "navpromini" ]]; then
    export DISPLAY="${DISPLAY:-:0}"
    export XAUTHORITY="${XAUTHORITY:-/home/navpromini/.Xauthority}"
    UI_DIR="/home/navpromini/navpromini_robot_ui"
else
    export DISPLAY="${DISPLAY:-:1}"
    export XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"
    UI_DIR="${HOME}/Projects/navpromini_robot_ui"
fi

PORT=8090
URL="http://127.0.0.1:${PORT}/ui/"

# If running on host and port 8090 is offline, auto-spawn background HTTP server
if ! curl -s -m 1 "http://127.0.0.1:${PORT}/" > /dev/null 2>&1; then
    echo "[Robot Screen] Starting local server on port ${PORT}..."
    setsid python3 -m http.server ${PORT} --directory "${UI_DIR}" </dev/null >/dev/null 2>&1 &
    sleep 1
    URL="http://127.0.0.1:${PORT}/"
fi

# Kill any previous instance of the kiosk browser to ensure clean single-window full screen
pkill -f "epiphany.*navpro_ui_profile" 2>/dev/null || true

# Launch browser in borderless kiosk / application mode
if command -v epiphany-browser > /dev/null 2>&1 || command -v epiphany > /dev/null 2>&1; then
    BROWSER_CMD="$(command -v epiphany-browser || command -v epiphany)"
    setsid "${BROWSER_CMD}" \
        --profile=/tmp/navpro_ui_profile \
        --new-window \
        "${URL}" </dev/null >/tmp/navpro_screen.log 2>&1 &
elif command -v google-chrome > /dev/null 2>&1; then
    setsid google-chrome \
        --app="${URL}" \
        --start-fullscreen \
        --kiosk \
        --user-data-dir="/tmp/navpro_robot_screen_profile" \
        --no-first-run \
        --no-default-browser-check </dev/null >/tmp/navpro_screen.log 2>&1 &
elif command -v chromium-browser > /dev/null 2>&1; then
    setsid chromium-browser \
        --app="${URL}" \
        --start-fullscreen \
        --kiosk \
        --user-data-dir="/tmp/navpro_robot_screen_profile" </dev/null >/tmp/navpro_screen.log 2>&1 &
elif command -v chromium > /dev/null 2>&1; then
    setsid chromium \
        --app="${URL}" \
        --start-fullscreen \
        --kiosk \
        --user-data-dir="/tmp/navpro_robot_screen_profile" </dev/null >/tmp/navpro_screen.log 2>&1 &
elif command -v firefox > /dev/null 2>&1; then
    setsid firefox --kiosk "${URL}" </dev/null >/tmp/navpro_screen.log 2>&1 &
else
    xdg-open "${URL}" &
fi

# Ensure window is set to borderless full-screen via wmctrl / xdotool
(
    for i in {1..8}; do
        sleep 0.5
        if command -v wmctrl >/dev/null 2>&1; then
            if wmctrl -l | grep -qi "NavPro"; then
                wmctrl -r "NavPro" -b add,fullscreen 2>/dev/null || true
                break
            fi
        fi
    done
) &

echo "[Robot Screen] Launched headless fullscreen kiosk at ${URL}"
