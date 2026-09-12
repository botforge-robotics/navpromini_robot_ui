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

# Enforce display orientation to Portrait Left (800x1280) and set touchscreen matrix
if command -v xrandr >/dev/null 2>&1; then
    xrandr --output HDMI-2 --rotate left 2>/dev/null || true
fi
if command -v xinput >/dev/null 2>&1; then
    xinput set-prop "Waveshare  Waveshare " "Coordinate Transformation Matrix" 0 -1 1 1 0 0 0 0 1 2>/dev/null || \
    xinput set-prop 6 "Coordinate Transformation Matrix" 0 -1 1 1 0 0 0 0 1 2>/dev/null || true
fi

# Ensure Onboard virtual keyboard settings (undocked, starts minimized, auto-show off)
if command -v gsettings >/dev/null 2>&1; then
    sudo -u navpromini DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gsettings set org.onboard.window docking-enabled false 2>/dev/null || true
    sudo -u navpromini DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gsettings set org.onboard start-minimized true 2>/dev/null || true
    sudo -u navpromini DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gsettings set org.onboard.auto-show enabled false 2>/dev/null || true
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

# Clean up previous instances of the kiosk browser to ensure clean single-window
pkill -9 -f epiphany 2>/dev/null || true
rm -rf /tmp/navpro_ui_profile
sleep 0.5

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

# Ensure window is set to borderless full-screen and always on top of all
(
    for i in {1..20}; do
        sleep 0.5
        WID=""
        if command -v xdotool >/dev/null 2>&1; then
            WID=$(xdotool search --onlyvisible --name "NavPro" 2>/dev/null | tail -n 1 || true)
            if [ -z "${WID}" ]; then
                WID=$(xdotool search --onlyvisible --class epiphany 2>/dev/null | tail -n 1 || true)
            fi
        fi

        if [ -n "${WID}" ]; then
            if command -v wmctrl >/dev/null 2>&1; then
                wmctrl -i -r "${WID}" -b add,fullscreen,above 2>/dev/null || true
            fi
            if command -v xdotool >/dev/null 2>&1; then
                xdotool windowactivate "${WID}" 2>/dev/null || true
                xdotool key --window "${WID}" F11 2>/dev/null || xdotool key F11 2>/dev/null || true
            fi
            break
        fi
    done
) &

echo "[Robot Screen] Launched headless fullscreen kiosk at ${URL}"
