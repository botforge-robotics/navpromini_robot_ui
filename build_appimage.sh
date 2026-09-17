#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCH="$(uname -m)"
echo "=== Building NavPro Mini Robot UI AppImage for ${ARCH} ==="

APPDIR="${DIR}/AppDir"
rm -rf "${APPDIR}"
mkdir -p "${APPDIR}"

# 1. Copy UI Files into AppDir
mkdir -p "${APPDIR}/usr/share/navpromini-robot-ui"
cp "${DIR}/index.html" "${APPDIR}/"
cp "${DIR}/style.css" "${APPDIR}/"
cp "${DIR}/app.js" "${APPDIR}/"
cp "${DIR}/version.json" "${APPDIR}/"
cp -r "${DIR}/assets" "${APPDIR}/"
cp -r "${DIR}/vendor" "${APPDIR}/"
cp "${DIR}/navpromini_robot_ui_runner.py" "${APPDIR}/"

# Mirror files to standard usr hierarchy as well
cp "${DIR}/index.html" "${DIR}/style.css" "${DIR}/app.js" "${DIR}/version.json" "${DIR}/navpromini_robot_ui_runner.py" "${APPDIR}/usr/share/navpromini-robot-ui/"
cp -r "${DIR}/assets" "${DIR}/vendor" "${APPDIR}/usr/share/navpromini-robot-ui/"

# 2. Create Desktop File
cat << 'DESK' > "${APPDIR}/navpromini-robot-ui.desktop"
[Desktop Entry]
Type=Application
Name=NavPro Mini Robot UI
Comment=NavPro Mini Onboard Touchscreen Operations Hub & Rive Face
Exec=AppRun
Icon=navpromini-robot-ui
Categories=Robotics;Utility;
Terminal=false
DESK

# 3. Create Icon
if [ -f "${DIR}/assets/mobilDockInstruction.png" ]; then
    cp "${DIR}/assets/mobilDockInstruction.png" "${APPDIR}/navpromini-robot-ui.png"
fi

# 4. Create AppRun entrypoint
cat << 'APPRUN' > "${APPDIR}/AppRun"
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "${0}")")"
export APPDIR="${HERE}"

# Enforce Portrait Left rotation and touch calibration
if command -v xrandr >/dev/null 2>&1; then
    xrandr --output HDMI-2 --rotate left 2>/dev/null || true
fi
if command -v xinput >/dev/null 2>&1; then
    xinput set-prop "Waveshare  Waveshare " "Coordinate Transformation Matrix" 0 -1 1 1 0 0 0 0 1 2>/dev/null || \
    xinput set-prop 6 "Coordinate Transformation Matrix" 0 -1 1 1 0 0 0 0 1 2>/dev/null || true
fi

# Run native GTK WebKit2 kiosk runner
exec python3 "${HERE}/navpromini_robot_ui_runner.py" "$@"
APPRUN
chmod +x "${APPDIR}/AppRun"

# 5. Locate or Download appimagetool
TOOL=""
if command -v appimagetool >/dev/null 2>&1; then
    TOOL="appimagetool"
elif [ -f "/tmp/appimagetool" ]; then
    TOOL="/tmp/appimagetool"
else
    echo "[Build] Downloading appimagetool for ${ARCH}..."
    curl -fsSL -o /tmp/appimagetool "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
    chmod +x /tmp/appimagetool
    TOOL="/tmp/appimagetool"
fi

RUNTIME_ARG=""
if [ -f "${DIR}/runtime-${ARCH}" ]; then
    RUNTIME_ARG="--runtime-file ${DIR}/runtime-${ARCH}"
fi

OUTPUT_NAME="NavProMiniRobotUI-${ARCH}.AppImage"
echo "[Build] Packaging ${OUTPUT_NAME}..."
ARCH="${ARCH}" "${TOOL}" --appimage-extract-and-run --no-appstream ${RUNTIME_ARG} "${APPDIR}" "${DIR}/${OUTPUT_NAME}" || \
ARCH="${ARCH}" "${TOOL}" --no-appstream ${RUNTIME_ARG} "${APPDIR}" "${DIR}/${OUTPUT_NAME}"

chmod +x "${DIR}/${OUTPUT_NAME}"
echo "=== Successfully built: ${DIR}/${OUTPUT_NAME} ==="
ls -lh "${DIR}/${OUTPUT_NAME}"
