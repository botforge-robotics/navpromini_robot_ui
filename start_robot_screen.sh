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

# Terminate any external virtual keyboards to avoid X11 window focus hangs
pkill -9 -f onboard 2>/dev/null || true

PORT=8090
URL="http://127.0.0.1:${PORT}/ui/"

# Wait for SDK (on robot) or spawn dev server (on dev machine)
if [[ "${CURRENT_USER}" == "navpromini" ]]; then
    # On the robot: NEVER spawn a competing server — wait for the SDK service
    if ! curl -s -m 1 "http://127.0.0.1:${PORT}/" > /dev/null 2>&1; then
        echo "[Robot Screen] Waiting for SDK on port ${PORT}..."
        for _i in $(seq 1 30); do
            if curl -s -m 1 "http://127.0.0.1:${PORT}/" > /dev/null 2>&1; then
                echo "[Robot Screen] SDK is up after ${_i}s."
                break
            fi
            sleep 1
        done
    fi
else
    # Dev machine: spawn a local static-file server only if nothing is on the port
    if ! curl -s -m 1 "http://127.0.0.1:${PORT}/" > /dev/null 2>&1; then
        echo "[Robot Screen] (dev) Starting local server on port ${PORT}..."
        setsid python3 -m http.server ${PORT} --directory "${UI_DIR}" </dev/null >/dev/null 2>&1 &
        sleep 1
        URL="http://127.0.0.1:${PORT}/"
    fi
fi

# Clean up previous instances to ensure single clean instance
pkill -9 -f NavProMiniRobotUI 2>/dev/null || true
pkill -9 -f navpromini_robot_ui_runner 2>/dev/null || true
pkill -9 -f test_runner 2>/dev/null || true
pkill -9 -f epiphany 2>/dev/null || true
pkill -9 -f .mount_NavPro 2>/dev/null || true
fusermount -u /tmp/.mount_NavPro* 2>/dev/null || true
rm -rf /tmp/navpro_ui_profile
sleep 0.5

APPIMAGE_BIN="/home/navpromini/navpromini_robot_ui_app/current/NavProMiniRobotUI-aarch64.AppImage"
LOCAL_APPIMAGE="${UI_DIR}/NavProMiniRobotUI-$(uname -m).AppImage"

# Launch Headless AppImage or Native WebKitGTK Runner (No browser)
if [ -x "${APPIMAGE_BIN}" ]; then
    echo "[Robot Screen] Launching Headless AppImage: ${APPIMAGE_BIN}..."
    setsid "${APPIMAGE_BIN}" "${URL}" </dev/null >/tmp/navpro_screen.log 2>&1 &
elif [ -x "${LOCAL_APPIMAGE}" ]; then
    echo "[Robot Screen] Launching Local Headless AppImage: ${LOCAL_APPIMAGE}..."
    setsid "${LOCAL_APPIMAGE}" "${URL}" </dev/null >/tmp/navpro_screen.log 2>&1 &
elif [ -f "${UI_DIR}/navpromini_robot_ui_runner.py" ]; then
    echo "[Robot Screen] Launching Native Headless WebKitGTK Kiosk Runner..."
    setsid python3 "${UI_DIR}/navpromini_robot_ui_runner.py" "${URL}" </dev/null >/tmp/navpro_screen.log 2>&1 &
elif command -v epiphany-browser > /dev/null 2>&1 || command -v epiphany > /dev/null 2>&1; then
    BROWSER_CMD="$(command -v epiphany-browser || command -v epiphany)"
    setsid "${BROWSER_CMD}" "${URL}" </dev/null >/tmp/navpro_screen.log 2>&1 &
else
    xdg-open "${URL}" &
fi

# Ensure window is set to borderless full-screen and always on top of all (quick 2s check)
(
    for i in {1..4}; do
        sleep 0.5
        WID=""
        if command -v xdotool >/dev/null 2>&1; then
            WID=$(xdotool search --onlyvisible --name "NavPro" 2>/dev/null | tail -n 1 || true)
        fi

        if [ -n "${WID}" ]; then
            if command -v wmctrl >/dev/null 2>&1; then
                wmctrl -i -r "${WID}" -b add,fullscreen,above 2>/dev/null || true
            fi
            break
        fi
    done
) &

echo "[Robot Screen] Launched headless fullscreen kiosk at ${URL}"
