// NavPro Mini - Interactive Map Viewer, Dock/Location Editor & Waypoints

let touchHeadingPrevAngle = 0;
let touchHeadingPrevX = 0;
let touchHeadingPrevY = 0;

/* --------------------------------------------------------------------------
   10. Interactive Map Viewer & Dock / Location Editor
   -------------------------------------------------------------------------- */
let viewerMapName = "";
let viewerMapImg = null;
let viewerMetadata = null;
let viewerWaypoints = [];
let viewerDockPose = null;
let viewerStandoffPose = null;
let viewerPan = { x: 0, y: 0, scale: 1.0, userControlled: false };
let viewerPanLocked = false;
let viewerEditorMode = null; // null, 'edit_dock', 'save_location'
let viewerDraftPose = null;  // { x, y, theta } for saving locations
let viewerIsAdjustingAngle = false;
let viewerDraggingHeading = false;
let viewerDraggingMarker = false;
let viewerLongPressTimer = null;
let viewerDockEditTarget = 'dock'; // 'dock' or 'standoff'
let viewerDockUndoStack = [];
let viewerNewDock = null;
let viewerNewStandoff = null;
let viewerPointers = new Map();
let viewerInitialPinch = null;
let viewerRenderRequested = false;
let viewerLayers = {
  labels: true,
  lidar: true,
  costmap: false
};
let viewerLidarScan = null;
let viewerLidarInterval = null;
let viewerCostmapImg = null;

function requestViewerRender() {
  if (!viewerRenderRequested) {
    viewerRenderRequested = true;
    requestAnimationFrame(() => {
      viewerRenderRequested = false;
      renderViewerCanvas();
    });
  }
}

window.toggleViewerLayersPopover = function(e, forceState) {
  if (e && e.stopPropagation) e.stopPropagation();
  const popover = document.getElementById("viewer-layers-popover");
  if (!popover) return;
  const isShown = popover.style.display !== "none";
  const shouldShow = forceState !== undefined ? forceState : !isShown;
  popover.style.display = shouldShow ? "block" : "none";
  const btnLayers = document.getElementById("btn-viewer-layers");
  if (btnLayers) btnLayers.classList.toggle("active", shouldShow);
};

window.handleViewerLayerChange = function(layer, enabled) {
  viewerLayers[layer] = !!enabled;
  if (layer === "lidar") {
    if (enabled) {
      startViewerLidarPolling();
    } else {
      stopViewerLidarPolling();
      viewerLidarScan = null;
    }
  } else if (layer === "costmap" && enabled) {
    fetchViewerCostmap();
  }
  requestViewerRender();
};

function startViewerLidarPolling() {
  stopViewerLidarPolling();
  if (!viewerLayers.lidar) return;
  pollViewerLidarScan();
  viewerLidarInterval = setInterval(pollViewerLidarScan, 300);
}

function stopViewerLidarPolling() {
  if (viewerLidarInterval) {
    clearInterval(viewerLidarInterval);
    viewerLidarInterval = null;
  }
}

function isViewerMapActive() {
  if (!viewerMapName) return false;
  if (!activeMapName) return true; // optimistic default before poll
  const clean = (s) => String(s || "").replace(/\.ya?ml$/i, "").trim().toLowerCase();
  return clean(viewerMapName) === clean(activeMapName);
}

async function pollViewerLidarScan() {
  if (!viewerLayers.lidar) return;
  const screen = document.getElementById("screen-map-viewer");
  if (!screen || screen.style.display === "none") {
    stopViewerLidarPolling();
    return;
  }
  if (!isViewerMapActive()) return;

  try {
    const [scanRes, poseRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/state/scan`),
      fetch(`${API_BASE}/api/v1/state/pose`)
    ]);
    if (poseRes.ok) {
      const pData = await poseRes.json();
      if (pData && pData.data && pData.data.x != null) {
        liveRobotPose = {
          x: pData.data.x,
          y: pData.data.y,
          yaw: pData.data.theta || 0
        };
        isLocalized = !!pData.localized;
      }
    }
    if (scanRes.ok) {
      const json = await scanRes.json();
      if (json && json.data) {
        viewerLidarScan = json.data;
      }
    }
    requestViewerRender();
  } catch (e) {
    // skip network blips
  }
}

async function fetchViewerCostmap() {
  if (!viewerLayers.costmap) return;
  try {
    const res = await fetch(`${API_BASE}/api/v1/maps/current/costmap?rotate=0&t=${Date.now()}`);
    if (res.ok) {
      const blob = await res.blob();
      const img = new Image();
      img.onload = () => {
        viewerCostmapImg = img;
        requestViewerRender();
      };
      img.src = URL.createObjectURL(blob);
    } else {
      showToast("Costmap active when navigation is running", false);
    }
  } catch (e) {
    // skip
  }
}

function handleViewerMarkerTap(sx, sy) {
  if (viewerEditorMode) return;

  // 1. Check Stations (Waypoints)
  for (const wp of viewerWaypoints) {
    if (wp.name === "Dock Standoff" || wp.name === "Charging Dock") continue;
    const pt = toCanvasCoords(wp.x, wp.y);
    if (Math.hypot(sx - pt.x, sy - pt.y) <= 32) {
      if (viewerMapName && activeMapName && !isViewerMapActive()) {
        showToast(`Cannot navigate: "${wp.name}" is on map "${viewerMapName}", active map is "${activeMapName}"`, true);
        return;
      }
      showDangerConfirmation({
        title: `Send Robot to "${wp.name}"`,
        message: `Dispatch NavPro Mini to "${wp.name}"? The robot will navigate smoothly to this destination.`,
        confirmText: `Dispatch to ${wp.name}`,
        isDanger: false,
        icon: "📍",
        onConfirm: () => {
          closeMapViewer();
          navigateToLocation(wp.name);
        }
      });
      return;
    }
  }

  // 2. Check Charging Dock
  const dock = viewerNewDock || viewerDockPose;
  if (dock) {
    const dp = toCanvasCoords(dock.x, dock.y);
    if (Math.hypot(sx - dp.x, sy - dp.y) <= 32) {
      if (viewerMapName && activeMapName && !isViewerMapActive()) {
        showToast(`Cannot dock: Charging dock is on map "${viewerMapName}", active map is "${activeMapName}"`, true);
        return;
      }
      showDangerConfirmation({
        title: "Return to Charging Dock",
        message: "Send NavPro Mini to the Charging Station? The robot will navigate to staging and dock automatically to recharge.",
        confirmText: "Auto-Dock Now",
        isDanger: false,
        icon: "⚡",
        onConfirm: () => {
          closeMapViewer();
          triggerAutoDock();
        }
      });
      return;
    }
  }
}

function placeDraftLocation(sx, sy) {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas) return;

  const px = (sx - viewerPan.x) / viewerPan.scale;
  const py = (sy - viewerPan.y) / viewerPan.scale;

  let wx = 0, wy = 0;
  if (viewerMetadata && viewerMetadata.resolution > 0) {
    wx = viewerMetadata.origin.x + px * viewerMetadata.resolution;
    wy = viewerMetadata.origin.y + (viewerMetadata.height - py) * viewerMetadata.resolution;
  } else {
    wx = px * 0.05;
    wy = py * 0.05;
  }

  const prevTheta = viewerDraftPose ? viewerDraftPose.theta : 0;
  viewerDraftPose = { x: wx, y: wy, theta: prevTheta };
  viewerDraggingHeading = false;

  updateViewerEditorBarUI();
  requestViewerRender();
}

window.snapDraftToRobot = function() {
  if (!liveRobotPose) {
    showToast("Robot live position not available yet", true);
    return;
  }
  viewerDraftPose = {
    x: liveRobotPose.x,
    y: liveRobotPose.y,
    theta: liveRobotPose.yaw || 0
  };
  viewerDraggingHeading = false;
  updateViewerEditorBarUI();
  requestViewerRender();
  showToast("Marker snapped to robot pose!");
};

window.rotateDraftPose = function(degrees) {
  if (!viewerDraftPose) return;
  const rad = degrees * Math.PI / 180;
  let newTheta = (viewerDraftPose.theta || 0) + rad;
  while (newTheta > Math.PI) newTheta -= 2 * Math.PI;
  while (newTheta < -Math.PI) newTheta += 2 * Math.PI;
  viewerDraftPose.theta = newTheta;
  updateViewerEditorBarUI();
  requestViewerRender();
};

window.toggleViewerPanLock = function() {
  viewerPanLocked = !viewerPanLocked;
  updateViewerEditorBarUI();
  showToast(viewerPanLocked ? "Map pan locked — marker adjustments only" : "Map pan enabled");
};

/* --------------------------------------------------------------------------
   Localize Options (Parity with Desktop Mission Planner)
   -------------------------------------------------------------------------- */
window.openViewerLocalizeModal = function() {
  const modal = document.getElementById("modal-viewer-localize");
  if (modal) modal.style.display = "flex";
};

window.closeViewerLocalizeModal = function() {
  const modal = document.getElementById("modal-viewer-localize");
  if (modal) modal.style.display = "none";
};

window.triggerViewerLocalizeDock = async function() {
  closeViewerLocalizeModal();
  try {
    showToast("Setting robot pose to Charging Dock...");
    await (window.localizeAtDock ? window.localizeAtDock() : localizeAtDock());
    showToast("Initial pose set to charging dock!");
    triggerFaceExpression("happy");
    setTimeout(pollViewerLidarScan, 200);
  } catch (e) {
    showToast("Dock localization failed: " + e.message, true);
  }
};

window.startViewerLocalizeOnMap = function() {
  closeViewerLocalizeModal();
  if (viewerEditorMode === "localize") {
    cancelViewerEditMode();
    return;
  }
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDockUndoStack = [];

  viewerEditorMode = "localize";
  viewerDraftPose = liveRobotPose ? { x: liveRobotPose.x, y: liveRobotPose.y, theta: liveRobotPose.yaw || 0 } : null;
  viewerIsAdjustingAngle = false;
  viewerDraggingHeading = false;
  updateViewerEditorBarUI();
  renderViewerCanvas();
  showToast("🎯 Select on Map: Tap map to place estimated pose");
};

window.confirmViewerLocalize = async function() {
  if (!viewerDraftPose) {
    showToast("Tap on map to place robot pose first", true);
    return;
  }
  try {
    showToast("Setting robot pose on map...");
    const res = await fetch(`${API_BASE}/api/v1/navigation/localize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x: viewerDraftPose.x,
        y: viewerDraftPose.y,
        theta: viewerDraftPose.theta,
        frame: "map"
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || (err.error && err.error.message) || "Failed to set pose");
    }
    showToast("Robot position set! Particles localized.");
    triggerFaceExpression("happy");
    cancelViewerEditMode();
    setTimeout(pollViewerLidarScan, 200);
  } catch (e) {
    showToast("Localize failed: " + e.message, true);
  }
};

window.triggerViewerGlobalRelocalize = async function() {
  closeViewerLocalizeModal();
  try {
    showToast("360° global lidar relocalization initiated...");
    const res = await fetch(`${API_BASE}/api/v1/navigation/relocalize/global`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || (err.error && err.error.message) || "Failed");
    }
    triggerFaceExpression("curios");
    showToast("AMCL particles dispersed across map! Drive or rotate robot to converge.");
  } catch (e) {
    showToast("Global relocalization failed: " + e.message, true);
  }
};

/* --------------------------------------------------------------------------
   Smooth Zoom & Canvas Pan Engine
   -------------------------------------------------------------------------- */
function zoomViewer(factor, centerX, centerY) {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas) return;
  const cx = centerX !== undefined ? centerX : canvas.width / 2;
  const cy = centerY !== undefined ? centerY : canvas.height / 2;
  const oldScale = viewerPan.scale;
  const newScale = Math.max(0.2, Math.min(8.0, oldScale * factor));
  if (Math.abs(newScale - oldScale) < 0.0001) return;

  const ratio = newScale / oldScale;
  viewerPan.x = cx - (cx - viewerPan.x) * ratio;
  viewerPan.y = cy - (cy - viewerPan.y) * ratio;
  viewerPan.scale = newScale;
  viewerPan.userControlled = true;
  requestViewerRender();
}

function initMapViewerInteractivity() {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas || canvas._viewerInteractivity) return;
  canvas._viewerInteractivity = true;

  let isTouchPanning = false;
  let touchMovedDist = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartPos = { x: 0, y: 0, time: 0 };
  let lastPinchDist = 0;
  let lastPinchMid = { x: 0, y: 0 };

  const getCanvasPos = (touchOrMouse) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return {
      sx: (touchOrMouse.clientX - rect.left) * scaleX,
      sy: (touchOrMouse.clientY - rect.top) * scaleY
    };
  };

  let touchSuppressPan = false;
  let mouseSuppressPan = false;

  // Touch Events
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const { sx, sy } = getCanvasPos(t);
      touchStartPos = { x: t.clientX, y: t.clientY, time: Date.now() };
      lastTouchX = t.clientX;
      lastTouchY = t.clientY;
      touchMovedDist = 0;
      isTouchPanning = false;
      touchSuppressPan = false;

      // In save_location or localize mode: check rotation handle, marker body, or adjustment orbit
      if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraftPose) {
        const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
        const handleDist = 56;
        const hx = center.x + handleDist * Math.cos(-viewerDraftPose.theta);
        const hy = center.y + handleDist * Math.sin(-viewerDraftPose.theta);
        const distToHandle = Math.hypot(sx - hx, sy - hy);
        const distToCenter = Math.hypot(sx - center.x, sy - center.y);

        // 1. Touch inside center chassis disc -> Drag marker position directly
        if (distToCenter <= 38) {
          viewerDraggingMarker = true;
          viewerDraggingHeading = false;
          touchSuppressPan = true;
          isTouchPanning = false;
          return;
        }

        // 2. Touch on or near the rotation handle OR anywhere in the outer rotation ring
        // Dedicated rotation zone: anywhere from 38px to 180px from marker center, or within 65px of handle
        if (distToHandle <= 65 || (distToCenter > 38 && distToCenter <= 180)) {
          viewerDraggingHeading = true;
          viewerDraggingMarker = false;
          touchSuppressPan = true;
          isTouchPanning = false;
          touchHeadingPrevAngle = -Math.atan2(sy - center.y, sx - center.x);
          touchHeadingPrevX = sx;
          touchHeadingPrevY = sy;
          return;
        }

        // If pan is explicitly locked in editor bar, suppress all map panning
        if (viewerPanLocked) {
          touchSuppressPan = true;
          isTouchPanning = false;
          return;
        }
      }
    } else if (e.touches.length === 2) {
      isTouchPanning = false;
      viewerDraggingHeading = false;
      viewerDraggingMarker = false;
      touchSuppressPan = false;

      const t0 = e.touches[0];
      const t1 = e.touches[1];
      lastPinchDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || 1);
      const scaleY = canvas.height / (rect.height || 1);
      lastPinchMid = {
        x: ((t0.clientX + t1.clientX) / 2 - rect.left) * scaleX,
        y: ((t0.clientY + t1.clientY) / 2 - rect.top) * scaleY
      };
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const { sx, sy } = getCanvasPos(t);

      // Rotating heading handle in save_location or localize mode (NO PAN)
      if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraggingHeading && viewerDraftPose) {
        const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
        const curTouchAngle = -Math.atan2(sy - center.y, sx - center.x);

        let dOrbital = curTouchAngle - touchHeadingPrevAngle;
        while (dOrbital > Math.PI) dOrbital -= 2 * Math.PI;
        while (dOrbital < -Math.PI) dOrbital += 2 * Math.PI;

        const dsx = sx - touchHeadingPrevX;
        const dsy = sy - touchHeadingPrevY;
        const rx = sx - center.x;
        const ry = sy - center.y;
        const r = Math.hypot(rx, ry);

        let dTheta = dOrbital;

        // If orbital angle delta is very small (< 0.003 rad) but finger moved linearly/radially:
        if (Math.abs(dOrbital) < 0.003 && Math.hypot(dsx, dsy) > 1.2 && r > 10) {
          // Tangential scrub formula: (ry * dsx - rx * dsy) / (r * r)
          const dTangent = (ry * dsx - rx * dsy) / (r * r);
          if (Math.abs(dTangent) > 0.001) {
            dTheta = dTangent;
          } else {
            // Linear swipe scrub: swiping to and fro across the radial axis
            const scrub = Math.abs(rx) >= Math.abs(ry) ? dsx : -dsy;
            dTheta = (scrub / 70) * 0.15;
          }
        }

        if (Math.abs(dTheta) > 0.0001) {
          let newTheta = (viewerDraftPose.theta || 0) + dTheta;
          while (newTheta > Math.PI) newTheta -= 2 * Math.PI;
          while (newTheta < -Math.PI) newTheta += 2 * Math.PI;
          viewerDraftPose.theta = newTheta;

          const metaEl = document.getElementById("editor-bar-meta");
          if (metaEl) {
            const deg = Math.round(newTheta * 180 / Math.PI);
            metaEl.textContent = `Heading: ${deg}°`;
          }
          requestViewerRender();
        }

        touchHeadingPrevAngle = curTouchAngle;
        touchHeadingPrevX = sx;
        touchHeadingPrevY = sy;
        return; // NEVER PAN
      }

      // Dragging marker body in save_location or localize mode (NO PAN)
      if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraggingMarker && viewerDraftPose) {
        const { px, py } = toPixelCoords(sx, sy);
        if (viewerMetadata && viewerMetadata.resolution > 0) {
          viewerDraftPose.x = viewerMetadata.origin.x + px * viewerMetadata.resolution;
          viewerDraftPose.y = viewerMetadata.origin.y + (viewerMetadata.height - py) * viewerMetadata.resolution;
        } else {
          viewerDraftPose.x = px * 0.05;
          viewerDraftPose.y = py * 0.05;
        }
        updateViewerEditorBarUI();
        requestViewerRender();
        return; // NEVER PAN
      }

      // If pan was suppressed for this gesture or if pan is locked
      if (touchSuppressPan || viewerPanLocked) {
        return; // NEVER PAN
      }

      // Single-finger pan with 8px deadzone to protect tap detection
      const dx = t.clientX - lastTouchX;
      const dy = t.clientY - lastTouchY;
      touchMovedDist += Math.hypot(dx, dy);

      if (touchMovedDist > 8) {
        isTouchPanning = true;
        viewerPan.x += dx;
        viewerPan.y += dy;
        viewerPan.userControlled = true;
        requestViewerRender();
      }
      lastTouchX = t.clientX;
      lastTouchY = t.clientY;
    } else if (e.touches.length === 2 && lastPinchDist > 0) {
      if (viewerPanLocked) return;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || 1);
      const scaleY = canvas.height / (rect.height || 1);
      const curMid = {
        x: ((t0.clientX + t1.clientX) / 2 - rect.left) * scaleX,
        y: ((t0.clientY + t1.clientY) / 2 - rect.top) * scaleY
      };

      if (dist > 0) {
        const factor = dist / lastPinchDist;
        viewerPan.x += (curMid.x - lastPinchMid.x);
        viewerPan.y += (curMid.y - lastPinchMid.y);
        zoomViewer(factor, curMid.x, curMid.y);
      }
      lastPinchDist = dist;
      lastPinchMid = curMid;
    }
  }, { passive: false });

  const endTouch = (e) => {
    if (viewerDraggingHeading || viewerDraggingMarker || touchSuppressPan) {
      viewerDraggingHeading = false;
      viewerDraggingMarker = false;
      touchSuppressPan = false;
      isTouchPanning = false;
      updateViewerEditorBarUI();
      requestViewerRender();
      return;
    }

    if (e.touches.length === 0) {
      // Tap detection (<28px cumulative move, <800ms duration)
      const elapsed = Date.now() - touchStartPos.time;
      if (!isTouchPanning && touchMovedDist < 28 && elapsed < 800) {
        const { sx, sy } = getCanvasPos({ clientX: touchStartPos.x, clientY: touchStartPos.y });
        if (viewerEditorMode === "save_location" || viewerEditorMode === "localize") {
          placeDraftLocation(sx, sy);
        } else if (viewerEditorMode === "edit_dock") {
          handleViewerCanvasTap(touchStartPos.x, touchStartPos.y);
        } else {
          handleViewerMarkerTap(sx, sy);
        }
      }
      isTouchPanning = false;
      touchMovedDist = 0;
      lastPinchDist = 0;
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      touchMovedDist = 0;
      isTouchPanning = false;
      lastPinchDist = 0;
    }
  };

  canvas.addEventListener("touchend", endTouch, { passive: false });
  canvas.addEventListener("touchcancel", endTouch, { passive: false });

  // Mouse fallback
  let isMouseDown = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseStartTime = 0;
  let mouseMovedDist = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const { sx, sy } = getCanvasPos(e);
    mouseSuppressPan = false;

    if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraftPose) {
      const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
      const handleDist = 56;
      const hx = center.x + handleDist * Math.cos(-viewerDraftPose.theta);
      const hy = center.y + handleDist * Math.sin(-viewerDraftPose.theta);
      const distToHandle = Math.hypot(sx - hx, sy - hy);
      const distToCenter = Math.hypot(sx - center.x, sy - center.y);

      if (distToCenter <= 38) {
        viewerDraggingMarker = true;
        viewerDraggingHeading = false;
        mouseSuppressPan = true;
        return;
      }

      if (distToHandle <= 65 || (distToCenter > 38 && distToCenter <= 180)) {
        viewerDraggingHeading = true;
        viewerDraggingMarker = false;
        mouseSuppressPan = true;
        touchHeadingPrevAngle = -Math.atan2(sy - center.y, sx - center.x);
        touchHeadingPrevX = sx;
        touchHeadingPrevY = sy;
        return;
      }

      if (viewerPanLocked) {
        mouseSuppressPan = true;
        return;
      }
    }
    isMouseDown = true;
    lastTouchX = e.clientX;
    lastTouchY = e.clientY;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseStartTime = Date.now();
    mouseMovedDist = 0;
  });

  window.addEventListener("mousemove", (e) => {
    if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraggingHeading && viewerDraftPose) {
      const { sx, sy } = getCanvasPos(e);
      const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
      const curTouchAngle = -Math.atan2(sy - center.y, sx - center.x);

      let dOrbital = curTouchAngle - touchHeadingPrevAngle;
      while (dOrbital > Math.PI) dOrbital -= 2 * Math.PI;
      while (dOrbital < -Math.PI) dOrbital += 2 * Math.PI;

      const dsx = sx - touchHeadingPrevX;
      const dsy = sy - touchHeadingPrevY;
      const rx = sx - center.x;
      const ry = sy - center.y;
      const r = Math.hypot(rx, ry);

      let dTheta = dOrbital;

      if (Math.abs(dOrbital) < 0.003 && Math.hypot(dsx, dsy) > 1.2 && r > 10) {
        const dTangent = (ry * dsx - rx * dsy) / (r * r);
        if (Math.abs(dTangent) > 0.001) {
          dTheta = dTangent;
        } else {
          const scrub = Math.abs(rx) >= Math.abs(ry) ? dsx : -dsy;
          dTheta = (scrub / 70) * 0.15;
        }
      }

      if (Math.abs(dTheta) > 0.0001) {
        let newTheta = (viewerDraftPose.theta || 0) + dTheta;
        while (newTheta > Math.PI) newTheta -= 2 * Math.PI;
        while (newTheta < -Math.PI) newTheta += 2 * Math.PI;
        viewerDraftPose.theta = newTheta;

        const metaEl = document.getElementById("editor-bar-meta");
        if (metaEl) {
          const deg = Math.round(newTheta * 180 / Math.PI);
          metaEl.textContent = `Heading: ${deg}°`;
        }
        requestViewerRender();
      }

      touchHeadingPrevAngle = curTouchAngle;
      touchHeadingPrevX = sx;
      touchHeadingPrevY = sy;
      return;
    }
    if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraggingMarker && viewerDraftPose) {
      const { sx, sy } = getCanvasPos(e);
      const { px, py } = toPixelCoords(sx, sy);
      if (viewerMetadata && viewerMetadata.resolution > 0) {
        viewerDraftPose.x = viewerMetadata.origin.x + px * viewerMetadata.resolution;
        viewerDraftPose.y = viewerMetadata.origin.y + (viewerMetadata.height - py) * viewerMetadata.resolution;
      } else {
        viewerDraftPose.x = px * 0.05;
        viewerDraftPose.y = py * 0.05;
      }
      updateViewerEditorBarUI();
      requestViewerRender();
      return;
    }
    if (mouseSuppressPan || viewerPanLocked) return;
    if (!isMouseDown) return;
    const dx = e.clientX - lastTouchX;
    const dy = e.clientY - lastTouchY;
    mouseMovedDist += Math.hypot(dx, dy);
    lastTouchX = e.clientX;
    lastTouchY = e.clientY;
    if (mouseMovedDist > 6) {
      viewerPan.x += dx;
      viewerPan.y += dy;
      viewerPan.userControlled = true;
      requestViewerRender();
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (viewerDraggingHeading || viewerDraggingMarker || mouseSuppressPan) {
      viewerDraggingHeading = false;
      viewerDraggingMarker = false;
      mouseSuppressPan = false;
      isMouseDown = false;
      updateViewerEditorBarUI();
      requestViewerRender();
      return;
    }
    if (!isMouseDown) return;
    isMouseDown = false;
    if (mouseMovedDist < 20 && (Date.now() - mouseStartTime) < 700) {
      const { sx, sy } = getCanvasPos(e);
      if (viewerEditorMode === "save_location" || viewerEditorMode === "localize") {
        placeDraftLocation(sx, sy);
      } else if (viewerEditorMode === "edit_dock") {
        handleViewerCanvasTap(e.clientX, e.clientY);
      } else {
        handleViewerMarkerTap(sx, sy);
      }
    }
  });

  // Mouse wheel zoom centered on cursor
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    const { sx, sy } = getCanvasPos(e);
    zoomViewer(factor, sx, sy);
  }, { passive: false });

  // Floating controls with smooth center-origin zoom
  document.getElementById("btn-viewer-zoom-in")?.addEventListener("click", () => {
    zoomViewer(1.3);
  });
  document.getElementById("btn-viewer-zoom-out")?.addEventListener("click", () => {
    zoomViewer(1 / 1.3);
  });
  document.getElementById("btn-viewer-recenter")?.addEventListener("click", () => {
    viewerPan.userControlled = false;
    centerViewerMap();
    requestViewerRender();
  });
}

function toCanvasCoords(wx, wy) {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!viewerMetadata || !canvas) {
    const w = viewerMapImg ? viewerMapImg.width : 800;
    const h = viewerMapImg ? viewerMapImg.height : 1280;
    return { x: viewerPan.x + (w / 2) * viewerPan.scale, y: viewerPan.y + (h / 2) * viewerPan.scale };
  }
  const u = (wx - viewerMetadata.origin.x) / viewerMetadata.resolution;
  const v = viewerMetadata.height - ((wy - viewerMetadata.origin.y) / viewerMetadata.resolution);
  return { x: viewerPan.x + u * viewerPan.scale, y: viewerPan.y + v * viewerPan.scale };
}

function handleViewerCanvasTap(clientX, clientY) {
  if (!viewerEditorMode || !viewerMetadata || !viewerMapImg) return;
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  const sx = (clientX - rect.left) * scaleX;
  const sy = (clientY - rect.top) * scaleY;

  // Inverse transform: screen pixel -> world coordinates
  const u = (sx - viewerPan.x) / viewerPan.scale;
  const v = (sy - viewerPan.y) / viewerPan.scale;
  const wx = viewerMetadata.origin.x + u * viewerMetadata.resolution;
  const wy = viewerMetadata.origin.y + (viewerMetadata.height - v) * viewerMetadata.resolution;

  if (viewerEditorMode === "edit_dock") {
    viewerDockUndoStack.push({
      dock: viewerNewDock ? { ...viewerNewDock } : null,
      standoff: viewerNewStandoff ? { ...viewerNewStandoff } : null,
      target: viewerDockEditTarget
    });

    if (viewerDockEditTarget === "dock") {
      const curTheta = viewerNewDock ? viewerNewDock.theta : 0;
      viewerNewDock = { x: wx, y: wy, theta: curTheta };
      if (!viewerNewStandoff) {
        viewerNewStandoff = { x: wx + 0.70, y: wy, theta: 0 };
      } else {
        const dx = viewerNewStandoff.x - viewerNewDock.x;
        const dy = viewerNewStandoff.y - viewerNewDock.y;
        const angle = Math.atan2(dy, dx);
        viewerNewDock.theta = angle;
        viewerNewStandoff.theta = angle;
      }
      viewerDockEditTarget = "standoff";
    } else {
      if (!viewerNewDock) {
        viewerNewDock = { x: wx - 0.70, y: wy, theta: 0 };
      }
      viewerNewStandoff = { x: wx, y: wy };
      const dx = viewerNewStandoff.x - viewerNewDock.x;
      const dy = viewerNewStandoff.y - viewerNewDock.y;
      const angle = Math.atan2(dy, dx);
      viewerNewDock.theta = angle;
      viewerNewStandoff.theta = angle;
    }
    updateViewerEditorBarUI();
    requestViewerRender();
  } else if (viewerEditorMode === "save_location") {
    placeDraftLocation(sx, sy);
  }
}

function centerViewerMap() {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas || !viewerMapImg) return;
  canvas.width = canvas.clientWidth || window.innerWidth || 800;
  canvas.height = canvas.clientHeight || window.innerHeight || 1280;
  const fitScale = Math.min((canvas.width * 0.85) / viewerMapImg.width, (canvas.height * 0.75) / viewerMapImg.height);
  viewerPan.scale = Math.max(0.5, fitScale);
  viewerPan.x = (canvas.width - viewerMapImg.width * viewerPan.scale) / 2;
  viewerPan.y = (canvas.height - viewerMapImg.height * viewerPan.scale) / 2;
}

function drawViewerPillLabel(ctx, x, y, text, borderColor) {
  ctx.save();
  ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const pillW = textWidth + 16;
  const pillH = 22;
  const rx = x - pillW / 2;
  const ry = y - pillH / 2;

  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(rx, ry, pillW, pillH, pillH / 2);
  } else {
    ctx.rect(rx, ry, pillW, pillH);
  }
  ctx.fill();

  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPinHeadingArrow(ctx, center, headingAngle, color) {
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(-headingAngle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(23, 0);
  ctx.lineTo(13, -7);
  ctx.lineTo(13, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderViewerCanvas() {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas || !viewerMapImg) return;
  const ctx = canvas.getContext("2d");

  // Keep canvas buffer matching display size
  if (canvas.clientWidth > 0 && (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight)) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }

  // High-contrast clean dark viewport background (matches CAD / robotics viewports)
  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle clean grid lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  const gridStep = 40;
  for (let x = 0; x < canvas.width; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw occupancy grid map
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(viewerMapImg, viewerPan.x, viewerPan.y, viewerMapImg.width * viewerPan.scale, viewerMapImg.height * viewerPan.scale);
  ctx.restore();

  // Draw Costmap Overlay if layer enabled
  if (viewerLayers.costmap && viewerCostmapImg) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(viewerCostmapImg, viewerPan.x, viewerPan.y, viewerCostmapImg.width * viewerPan.scale, viewerCostmapImg.height * viewerPan.scale);
    ctx.restore();
  }

  // Draw Saved Waypoints (Stations)
  viewerWaypoints.forEach(wp => {
    if (wp.name === "Dock Standoff" || wp.name === "Charging Dock") return;
    const pt = toCanvasCoords(wp.x, wp.y);
    ctx.save();
    ctx.translate(pt.x, pt.y);

    // Blue pin circle
    ctx.fillStyle = "#2563EB";
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Center white dot
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();

    // Pill badge label above pin (if labels layer enabled)
    if (viewerLayers.labels) {
      drawViewerPillLabel(ctx, pt.x, pt.y - 20, wp.name, "#2563EB");
    }
  });

  // Draw Dock & Standoff Poses (Exact visual parity with Desktop Mission Planner)
  const dock = viewerNewDock || viewerDockPose;
  const standoff = viewerNewStandoff || viewerStandoffPose;

  if (dock && standoff) {
    const dp = toCanvasCoords(dock.x, dock.y);
    const sp = toCanvasCoords(standoff.x, standoff.y);
    const distMeters = Math.hypot(standoff.x - dock.x, standoff.y - dock.y);

    const dockHeading = Math.atan2(standoff.y - dock.y, standoff.x - dock.x);
    const standoffHeading = Math.atan2(dock.y - standoff.y, dock.x - standoff.x);

    // 1. Connecting guide dashed line
    ctx.save();
    ctx.strokeStyle = "rgba(16, 185, 129, 0.8)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(dp.x, dp.y);
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
    ctx.restore();

    // 2. Standoff Marker (🎯 Standoff Point - #2563EB Blue)
    if (viewerEditorMode === "edit_dock" && viewerDockEditTarget === "standoff") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 22, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(37, 99, 235, 0.25)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 18, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(37, 99, 235, 0.40)";
      ctx.fill();
      ctx.restore();
    }

    drawPinHeadingArrow(ctx, sp, standoffHeading, "#2563EB");

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.fillStyle = "#2563EB";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Target Crosshairs Icon 🎯
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, 2 * Math.PI);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(0, -5);
    ctx.moveTo(0, 5);  ctx.lineTo(0, 9);
    ctx.moveTo(-9, 0); ctx.lineTo(-5, 0);
    ctx.moveTo(5, 0);  ctx.lineTo(9, 0);
    ctx.stroke();
    ctx.restore();

    // 3. Charging Dock Marker (⚡ Dock Station - #10B981 Emerald Green)
    if (viewerEditorMode === "edit_dock" && viewerDockEditTarget === "dock") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 22, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(16, 185, 129, 0.25)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 18, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(16, 185, 129, 0.40)";
      ctx.fill();
      ctx.restore();
    }

    drawPinHeadingArrow(ctx, dp, dockHeading, "#10B981");

    ctx.save();
    ctx.translate(dp.x, dp.y);
    ctx.fillStyle = "#10B981";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Lightning Bolt / EV Charging Icon ⚡
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⚡", 0, 0);
    ctx.restore();
  }

  // Draw Live 2D Lidar Scan Points if layer enabled and map is active
  if (viewerLayers.lidar && isViewerMapActive() && liveRobotPose && viewerLidarScan && Array.isArray(viewerLidarScan.ranges)) {
    const ranges = viewerLidarScan.ranges;
    const angleMin = viewerLidarScan.angle_min || 0;
    const angleInc = viewerLidarScan.angle_increment || 0;
    const rMin = viewerLidarScan.range_min || 0.15;
    const rMax = viewerLidarScan.range_max || 12.0;
    const rx = liveRobotPose.x;
    const ry = liveRobotPose.y;
    const ryaw = liveRobotPose.yaw || 0;

    ctx.save();
    ctx.fillStyle = "#10B981"; // Vibrant Emerald Green lidar returns
    for (let i = 0; i < ranges.length; i += 2) {
      const r = ranges[i];
      if (r === null || r === undefined || r < rMin || r > rMax) continue;
      const beamAngle = angleMin + i * angleInc;
      const mapAngle = ryaw + beamAngle;
      const px = rx + r * Math.cos(mapAngle);
      const py = ry + r * Math.sin(mapAngle);
      const pt = toCanvasCoords(px, py);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  // Draw Live Robot Marker if this map is active (exact 1:1 parity with Desktop Mission Planner _drawRobotMarker)
  if (isViewerMapActive() && liveRobotPose) {
    const rp = toCanvasCoords(liveRobotPose.x, liveRobotPose.y);
    const r = 13.0; // Chassis disc radius
    const coneR = 40.0; // Headlight cone radius
    const coneHalfAngle = 0.52; // ~30° spread
    const segments = 16;

    ctx.save();
    ctx.translate(rp.x, rp.y);
    ctx.rotate(-liveRobotPose.yaw);

    // 1. Soft wide orientation field / headlight cone
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= segments; i++) {
      const t = -coneHalfAngle + (2 * coneHalfAngle) * (i / segments);
      ctx.lineTo(coneR * Math.cos(t), coneR * Math.sin(t));
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(203, 60, 0, 0.22)";
    ctx.fill();

    // 2. Chassis outer shadow ring
    ctx.beginPath();
    ctx.arc(0, 0, r + 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fill();

    // 3. Chassis outer shock / glow ring
    ctx.beginPath();
    ctx.arc(0, 0, r + 2.0, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(203, 60, 0, 0.40)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 4. Robot chassis body disc
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.fillStyle = "#CB3C00";
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 5. Prominent high-contrast forward chevron arrow
    const arrowTipDist = r + 8.5;
    const arrowBaseDist = r * 0.15;
    const arrowWingDist = r * 0.95;
    const arrowWingAngle = 0.70;

    const tip = { x: arrowTipDist, y: 0 };
    const leftWing = { x: arrowWingDist * Math.cos(-arrowWingAngle), y: arrowWingDist * Math.sin(-arrowWingAngle) };
    const rightWing = { x: arrowWingDist * Math.cos(arrowWingAngle), y: arrowWingDist * Math.sin(arrowWingAngle) };
    const base = { x: arrowBaseDist, y: 0 };

    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(leftWing.x, leftWing.y);
    ctx.lineTo(base.x, base.y);
    ctx.lineTo(rightWing.x, rightWing.y);
    ctx.closePath();

    // Dark stroke outline around arrow for maximum contrast against any background
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Solid bright white pointer arrow
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    // 6. Center pivot core
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    ctx.restore();
  }

  // Draw Draft Pose Marker when in save_location or localize mode (Desktop Mission Planner visual parity)
  if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraftPose) {
    const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
    const yaw = viewerDraftPose.theta || 0;
    const isLocalize = viewerEditorMode === "localize";
    const color = isLocalize ? "#2563EB" : "#14B8A6"; // Blue for localize, Teal for save station
    const r = 14;
    const handleDist = 56;
    const handlePos = {
      x: center.x + handleDist * Math.cos(-yaw),
      y: center.y + handleDist * Math.sin(-yaw)
    };

    // 0. Visual Rotation Orbit Ring (affordance for touch rotation)
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, handleDist, 0, 2 * Math.PI);
    ctx.strokeStyle = isLocalize ? "rgba(37, 99, 235, 0.40)" : "rgba(20, 184, 166, 0.40)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.restore();

    // 1. Anchor tether line to rotation handle node
    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(handlePos.x, handlePos.y);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(handlePos.x, handlePos.y);
    ctx.stroke();

    // Large rotation handle node at tip for reliable touch grabbing
    ctx.beginPath();
    ctx.arc(handlePos.x, handlePos.y, 22, 0, 2 * Math.PI);
    ctx.fillStyle = isLocalize ? "rgba(37, 99, 235, 0.30)" : "rgba(20, 184, 166, 0.30)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(handlePos.x, handlePos.y, 14, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Circular rotation arrow in handle
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⟳", handlePos.x, handlePos.y);
    ctx.restore();

    // 2. Robot-style Chassis Body Disc
    ctx.save();
    // Outer shadow
    ctx.beginPath();
    ctx.arc(center.x, center.y, r + 4, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fill();

    // Translucent outer shock ring
    ctx.beginPath();
    ctx.arc(center.x, center.y, r + 2, 0, 2 * Math.PI);
    ctx.strokeStyle = isLocalize ? "rgba(37, 99, 235, 0.5)" : "rgba(20, 184, 166, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Main chassis disc
    ctx.beginPath();
    ctx.arc(center.x, center.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 3. Prominent forward-pointing arrow chevron on chassis body
    ctx.translate(center.x, center.y);
    ctx.rotate(-yaw);

    const arrowTip = r + 8;
    const arrowBase = r * 0.15;
    const arrowWing = r * 0.95;
    const wingAngle = 0.70;

    ctx.beginPath();
    ctx.moveTo(arrowTip, 0);
    ctx.lineTo(arrowWing * Math.cos(wingAngle), -arrowWing * Math.sin(wingAngle));
    ctx.lineTo(arrowBase, 0);
    ctx.lineTo(arrowWing * Math.cos(-wingAngle), -arrowWing * Math.sin(-wingAngle));
    ctx.closePath();

    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    // Center pivot dot
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.restore();

    // 4. In location picker mode, do not show position label. Only show heading in localize mode.
    if (isLocalize) {
      const deg = Math.round(yaw * 180 / Math.PI);
      drawViewerPillLabel(ctx, center.x, center.y - 30, `🎯 Initial Pose: ${deg}°`, color);
    }
  }
}

window.openMapViewer = async function(mapName, options = {}) {
  viewerMapName = mapName;
  viewerEditorMode = options.mode || null;
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDraftPose = (options.mode === "save_location" && liveRobotPose) ? { x: liveRobotPose.x, y: liveRobotPose.y, theta: liveRobotPose.yaw || 0 } : null;
  viewerDockUndoStack = [];
  viewerDockEditTarget = 'dock';
  viewerPan.userControlled = false;

  const screen = document.getElementById("screen-map-viewer");
  const nameEl = document.getElementById("map-viewer-name");
  const badgeEl = document.getElementById("map-viewer-active-badge");
  const loadingEl = document.getElementById("map-viewer-loading");
  const legendRobot = document.getElementById("legend-robot-item");
  const popover = document.getElementById("viewer-layers-popover");
  if (popover) popover.style.display = "none";
  const btnLayers = document.getElementById("btn-viewer-layers");
  if (btnLayers) btnLayers.classList.remove("active");

  if (screen) screen.style.display = "flex";
  if (nameEl) nameEl.textContent = mapName;
  if (badgeEl) badgeEl.style.display = isViewerMapActive() ? "inline-flex" : "none";
  if (legendRobot) legendRobot.style.display = isViewerMapActive() ? "flex" : "none";
  if (loadingEl) loadingEl.style.display = "flex";

  updateViewerEditorBarUI();

  const canvas = document.getElementById("map-viewer-canvas");
  if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }

  initMapViewerInteractivity();

  // Start lidar polling if enabled
  if (viewerLayers.lidar) {
    startViewerLidarPolling();
  }

  try {
    // 1. Fetch map image
    const imgRes = await fetch(`${API_BASE}/api/v1/maps/current/image?rotate=0&t=${Date.now()}`);
    if (imgRes.ok) {
      const blob = await imgRes.blob();
      viewerMapImg = new Image();
      viewerMapImg.onload = () => {
        if (!viewerPan.userControlled) centerViewerMap();
        renderViewerCanvas();
        if (loadingEl) loadingEl.style.display = "none";
      };
      viewerMapImg.src = URL.createObjectURL(blob);
    }

    // 2. Fetch metadata, waypoints, dock pose, live robot pose, and lidar scan concurrently
    const [infoRes, wpRes, dockRes, poseRes, scanRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/maps/current/info`),
      fetch(`${API_BASE}/api/v1/waypoints?map=${encodeURIComponent(mapName)}`),
      fetch(`${API_BASE}/api/v1/dock/pose`),
      fetch(`${API_BASE}/api/v1/state/pose`),
      fetch(`${API_BASE}/api/v1/state/scan`)
    ]);

    if (infoRes.ok) {
      const info = await infoRes.json();
      if (info.loaded) viewerMetadata = info;
    }

    if (poseRes.ok) {
      const pData = await poseRes.json();
      if (pData && pData.data && pData.data.x != null) {
        liveRobotPose = {
          x: pData.data.x,
          y: pData.data.y,
          yaw: pData.data.theta || 0
        };
        isLocalized = !!pData.localized;
        if (options.mode === "save_location" && !viewerDraftPose) {
          viewerDraftPose = { x: liveRobotPose.x, y: liveRobotPose.y, theta: liveRobotPose.yaw || 0 };
        }
      }
    }

    if (scanRes.ok) {
      const sData = await scanRes.json();
      if (sData && sData.data) {
        viewerLidarScan = sData.data;
      }
    }

    if (badgeEl) badgeEl.style.display = isViewerMapActive() ? "inline-flex" : "none";
    if (legendRobot) legendRobot.style.display = isViewerMapActive() ? "flex" : "none";

    if (wpRes.ok) {
      const wData = await wpRes.json();
      viewerWaypoints = wData.waypoints || [];
      const stWp = viewerWaypoints.find(w => w.name === "Dock Standoff");
      if (stWp) viewerStandoffPose = { x: stWp.x, y: stWp.y, theta: stWp.theta || 0 };
    }

    if (dockRes.ok) {
      const dData = await dockRes.json();
      if (dData.data) {
        viewerDockPose = { x: dData.data.x, y: dData.data.y, theta: dData.data.theta || 0 };
        if (!viewerStandoffPose) {
          viewerStandoffPose = {
            x: viewerDockPose.x + 0.70 * Math.cos(viewerDockPose.theta),
            y: viewerDockPose.y + 0.70 * Math.sin(viewerDockPose.theta),
            theta: viewerDockPose.theta
          };
        }
      }
    }
  } catch (err) {
    console.warn("Failed loading map viewer data:", err);
  } finally {
    if (loadingEl) loadingEl.style.display = "none";
    updateViewerEditorBarUI();
    renderViewerCanvas();
  }
};

window.closeMapViewer = function() {
  const screen = document.getElementById("screen-map-viewer");
  if (screen) screen.style.display = "none";
  const popover = document.getElementById("viewer-layers-popover");
  if (popover) popover.style.display = "none";
  const btnLayers = document.getElementById("btn-viewer-layers");
  if (btnLayers) btnLayers.classList.remove("active");
  stopViewerLidarPolling();
  viewerEditorMode = null;
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDraftPose = null;
  viewerDockUndoStack = [];
  updateViewerEditorBarUI();
};

function updateViewerEditorBarUI() {
  const editorBar = document.getElementById("map-viewer-editor-bar");
  const iconEl = document.getElementById("editor-bar-icon");
  const titleEl = document.getElementById("editor-bar-title");
  const metaEl = document.getElementById("editor-bar-meta");
  const toolsEl = document.getElementById("editor-bar-tools");
  const promptEl = document.getElementById("editor-bar-prompt");
  const actionsEl = document.getElementById("map-viewer-editor-bar")?.querySelector(".editor-bar-actions");
  const btnAddLoc = document.getElementById("btn-viewer-add-location");
  const btnEditDock = document.getElementById("btn-viewer-edit-dock");
  const btnLocalize = document.getElementById("btn-viewer-localize");

  if (btnAddLoc) {
    const isSave = viewerEditorMode === "save_location";
    btnAddLoc.classList.toggle("active", isSave);
  }

  if (btnEditDock) {
    const isDock = viewerEditorMode === "edit_dock";
    btnEditDock.classList.toggle("active", isDock);
  }

  if (btnLocalize) {
    const isLocalize = viewerEditorMode === "localize";
    btnLocalize.classList.toggle("active", isLocalize);
  }

  if (!editorBar || !promptEl || !actionsEl) return;

  if (!viewerEditorMode) {
    editorBar.style.display = "none";
    if (promptEl) promptEl.innerHTML = "";
    if (actionsEl) actionsEl.innerHTML = "";
    if (toolsEl) toolsEl.innerHTML = "";
    if (metaEl) metaEl.style.display = "none";
    return;
  }

  editorBar.style.display = "flex";

  if (viewerEditorMode === "save_location") {
    editorBar.className = "map-viewer-editor-bar mode-save-location";
    if (iconEl) iconEl.textContent = "📍";
    if (titleEl) titleEl.textContent = "Save Station Location";

    if (toolsEl) {
      const snapBtn = liveRobotPose
        ? `<button type="button" class="editor-tool-btn" onclick="snapDraftToRobot()" title="Snap to Robot Pose"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/></svg><span>Snap</span></button>`
        : "";
      const rotBtns = viewerDraftPose
        ? `<button type="button" class="editor-tool-btn" onclick="rotateDraftPose(-15)" title="Rotate -15°">↺ -15°</button><button type="button" class="editor-tool-btn" onclick="rotateDraftPose(15)" title="Rotate +15°">↻ +15°</button>`
        : "";
      const panBtn = `<button type="button" class="editor-tool-btn ${viewerPanLocked ? 'active' : ''}" onclick="toggleViewerPanLock()">${viewerPanLocked ? '🔒 Pan Locked' : '✋ Pan On'}</button>`;
      toolsEl.innerHTML = `${snapBtn}${rotBtns}${panBtn}`;
    }

    if (!viewerDraftPose) {
      if (metaEl) metaEl.style.display = "none";
      promptEl.innerHTML = `<span class="prompt-hint">Tap anywhere on the map to place location pin</span>`;
    } else {
      const deg = Math.round((viewerDraftPose.theta || 0) * 180 / Math.PI);
      if (metaEl) {
        metaEl.style.display = "inline-flex";
        metaEl.textContent = `Heading: ${deg}°`;
      }
      promptEl.innerHTML = `<span class="prompt-hint">Tap/drag marker to reposition • Drag handle or ring to rotate</span>`;
    }

    actionsEl.innerHTML = `
      <button type="button" class="btn-editor-cancel" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn-editor-save" onclick="confirmViewerSaveLocation()">✓ Save Location</button>
    `;
  } else if (viewerEditorMode === "localize") {
    editorBar.className = "map-viewer-editor-bar mode-localize";
    if (iconEl) iconEl.textContent = "🎯";
    if (titleEl) titleEl.textContent = "Set Robot Initial Pose";

    if (toolsEl) {
      const snapBtn = liveRobotPose
        ? `<button type="button" class="editor-tool-btn" onclick="snapDraftToRobot()" title="Snap to Current"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/></svg><span>Snap</span></button>`
        : "";
      const rotBtns = viewerDraftPose
        ? `<button type="button" class="editor-tool-btn" onclick="rotateDraftPose(-15)" title="Rotate -15°">↺ -15°</button><button type="button" class="editor-tool-btn" onclick="rotateDraftPose(15)" title="Rotate +15°">↻ +15°</button>`
        : "";
      const panBtn = `<button type="button" class="editor-tool-btn ${viewerPanLocked ? 'active' : ''}" onclick="toggleViewerPanLock()">${viewerPanLocked ? '🔒 Pan Locked' : '✋ Pan On'}</button>`;
      toolsEl.innerHTML = `${snapBtn}${rotBtns}${panBtn}`;
    }

    if (!viewerDraftPose) {
      if (metaEl) metaEl.style.display = "none";
      promptEl.innerHTML = `<span class="prompt-hint">Tap on map where robot is currently positioned</span>`;
    } else {
      const deg = Math.round((viewerDraftPose.theta || 0) * 180 / Math.PI);
      if (metaEl) {
        metaEl.style.display = "inline-flex";
        metaEl.textContent = `Heading: ${deg}°`;
      }
      promptEl.innerHTML = `<span class="prompt-hint">Tap/drag marker to reposition • Drag handle or ring to align direction</span>`;
    }

    actionsEl.innerHTML = `
      <button type="button" class="btn-editor-cancel" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn-editor-save" onclick="confirmViewerLocalize()">✓ Set Initial Pose</button>
    `;
  } else if (viewerEditorMode === "edit_dock") {
    editorBar.className = "map-viewer-editor-bar mode-edit-dock";
    if (iconEl) iconEl.textContent = "⚡";
    if (titleEl) titleEl.textContent = "Edit Charging Station & Standoff";

    if (toolsEl) {
      toolsEl.innerHTML = `
        <div class="editor-segmented-group">
          <button type="button" class="editor-segmented-btn ${viewerDockEditTarget === 'dock' ? 'active' : ''}" onclick="setDockEditTarget('dock')">⚡ Dock Station</button>
          <button type="button" class="editor-segmented-btn ${viewerDockEditTarget === 'standoff' ? 'active' : ''}" onclick="setDockEditTarget('standoff')">🎯 Standoff Pose</button>
        </div>
      `;
    }

    if (viewerDockEditTarget === "dock") {
      if (metaEl) {
        metaEl.style.display = "inline-flex";
        metaEl.textContent = "Target: Dock Station";
      }
      promptEl.innerHTML = `<span class="prompt-hint">Tap map to place charger • Drag ⟳ handle pointing out into room</span>`;
    } else {
      const dist = (viewerNewDock && viewerNewStandoff)
        ? Math.hypot(viewerNewStandoff.x - viewerNewDock.x, viewerNewStandoff.y - viewerNewDock.y).toFixed(2)
        : null;
      if (metaEl) {
        metaEl.style.display = "inline-flex";
        metaEl.textContent = dist ? `Standoff: ${dist}m` : "Target: Standoff Pose";
      }
      promptEl.innerHTML = `<span class="prompt-hint">Tap map to place approach point (~0.7m facing dock)</span>`;
    }

    const canUndo = viewerDockUndoStack.length > 0;
    actionsEl.innerHTML = `
      <button type="button" class="btn-editor-undo ${!canUndo ? 'disabled' : ''}" ${!canUndo ? 'disabled' : ''} onclick="undoViewerDock()">↩ Undo</button>
      <button type="button" class="btn-editor-cancel" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn-editor-save" onclick="saveViewerEditMode()">✓ Save Changes</button>
    `;
  }
}

window.toggleViewerEditDock = function() {
  if (viewerEditorMode === "edit_dock") {
    cancelViewerEditMode();
    showToast("Exited dock editing mode");
    return;
  }
  // Clear any draft station pose
  viewerDraftPose = null;
  viewerIsAdjustingAngle = false;
  viewerDraggingHeading = false;

  viewerEditorMode = "edit_dock";
  viewerDockEditTarget = "dock";
  viewerDockUndoStack = [];
  viewerNewDock = viewerDockPose ? { ...viewerDockPose } : null;
  viewerNewStandoff = viewerStandoffPose ? { ...viewerStandoffPose } : null;
  updateViewerEditorBarUI();
  renderViewerCanvas();
  showToast("⚡ Edit Dock: Tap map to place Charging Dock position");
};

window.setDockEditTarget = function(target) {
  viewerDockEditTarget = target;
  updateViewerEditorBarUI();
  renderViewerCanvas();
};

window.undoViewerDock = function() {
  if (viewerDockUndoStack.length === 0) return;
  const prev = viewerDockUndoStack.pop();
  viewerNewDock = prev.dock;
  viewerNewStandoff = prev.standoff;
  viewerDockEditTarget = prev.target || "dock";
  updateViewerEditorBarUI();
  renderViewerCanvas();
  showToast("Undid last dock change");
};

window.toggleViewerSaveLocation = function() {
  if (viewerEditorMode === "save_location") {
    cancelViewerEditMode();
    showToast("Exited location placement mode");
    return;
  }
  // Clear any dock edit state
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDockUndoStack = [];

  viewerEditorMode = "save_location";
  viewerDraftPose = liveRobotPose ? { x: liveRobotPose.x, y: liveRobotPose.y, theta: liveRobotPose.yaw || 0 } : null;
  viewerIsAdjustingAngle = false;
  viewerDraggingHeading = false;
  updateViewerEditorBarUI();
  renderViewerCanvas();
  showToast("📍 Save Location: Tap map to place location marker");
};

window.promptViewerAddLocation = function() {
  toggleViewerSaveLocation();
};

window.confirmViewerSaveLocation = function() {
  if (!viewerDraftPose) {
    showToast("Tap on map to place a location marker first", true);
    return;
  }
  openTouchKeyboard("Location Name:", async (name) => {
    if (!name || !name.trim()) return;
    const wpName = name.trim();
    try {
      showToast(`Saving location "${wpName}"...`);
      await fetch(`${API_BASE}/api/v1/waypoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wpName,
          type: "waypoint",
          x: viewerDraftPose.x,
          y: viewerDraftPose.y,
          theta: viewerDraftPose.theta,
          map: viewerMapName
        })
      });
      showToast(`Location "${wpName}" saved!`);
      cancelViewerEditMode();
      openMapViewer(viewerMapName);
      loadWaypoints();
    } catch (e) {
      showToast(`Failed to save location: ${e.message}`, true);
    }
  });
};

window.cancelViewerEditMode = function() {
  viewerEditorMode = null;
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDraftPose = null;
  viewerDockUndoStack = [];
  viewerIsAdjustingAngle = false;
  viewerDraggingHeading = false;
  viewerDraggingMarker = false;
  viewerPanLocked = false;
  updateViewerEditorBarUI();
  renderViewerCanvas();
};

window.saveViewerEditMode = async function() {
  if (viewerEditorMode === "edit_dock" && viewerNewDock) {
    try {
      showToast("Saving Dock & Standoff poses...");
      const standoff = viewerNewStandoff || {
        x: viewerNewDock.x + 0.70 * Math.cos(viewerNewDock.theta),
        y: viewerNewDock.y + 0.70 * Math.sin(viewerNewDock.theta),
        theta: viewerNewDock.theta
      };

      // 1. Set dock pose
      await fetch(`${API_BASE}/api/v1/dock/pose`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x: viewerNewDock.x,
          y: viewerNewDock.y,
          theta: viewerNewDock.theta
        })
      });

      // 2. Save Dock Standoff waypoint
      await fetch(`${API_BASE}/api/v1/waypoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Dock Standoff",
          type: "dock",
          x: standoff.x,
          y: standoff.y,
          theta: standoff.theta,
          map: viewerMapName
        })
      });

      // 3. Save Charging Dock waypoint
      await fetch(`${API_BASE}/api/v1/waypoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Charging Dock",
          type: "dock",
          x: viewerNewDock.x,
          y: viewerNewDock.y,
          theta: viewerNewDock.theta,
          map: viewerMapName
        })
      });

      showToast("Dock & Standoff poses updated successfully!");
      cancelViewerEditMode();
      openMapViewer(viewerMapName);
    } catch (e) {
      showToast("Failed to save dock pose: " + e.message, true);
    }
  } else {
    cancelViewerEditMode();
  }
};


/* --------------------------------------------------------------------------
   11. Active Map State Syncing & Scoping
   -------------------------------------------------------------------------- */
function getActiveMapFromState(stateData) {
  if (!stateData) return "";
  if (typeof stateData.map === "string") return stateData.map.trim();
  if (stateData.map && typeof stateData.map === "object") {
    const name = stateData.map.name || stateData.map.id;
    if (name) return String(name).trim();
  }
  if (stateData.current_map) return String(stateData.current_map).trim();
  return "";
}

async function handleActiveMapChanged(newMapName) {
  if (!newMapName) return;
  const prevMap = activeMapName;
  activeMapName = newMapName;

  // Update UI headers & subtitles
  const hubMapDesc = document.getElementById("hub-active-map-name");
  if (hubMapDesc) hubMapDesc.textContent = `Active: ${activeMapName}`;

  const locSub = document.getElementById("locations-map-subtitle");
  if (locSub) locSub.textContent = `Showing stations on "${activeMapName}"`;

  const misSub = document.getElementById("missions-map-subtitle");
  if (misSub) misSub.textContent = `Showing visual routines on "${activeMapName}"`;

  const schedSub = document.getElementById("schedules-map-subtitle");
  if (schedSub) schedSub.textContent = `Showing automated timers on "${activeMapName}"`;

  // Enable / update Add Location button
  const addBtn = document.getElementById("btn-add-location");
  if (addBtn) {
    addBtn.disabled = false;
    addBtn.classList.remove("disabled");
  }

  // Refresh current subpage if open
  if (currentOpenSubpage === "locations") {
    loadWaypoints();
  } else if (currentOpenSubpage === "missions") {
    loadMissions();
  } else if (currentOpenSubpage === "schedules") {
    loadSchedules();
  } else if (currentOpenSubpage === "maps") {
    loadMaps();
  }

  // Always refresh dashboard counters for active map
  refreshHubCounters();
}

async function refreshHubCounters() {
  try {
    const mapParam = activeMapName ? `?map=${encodeURIComponent(activeMapName)}` : "";
    const [wRes, mRes, sRes, mapsRes] = await Promise.allSettled([
      fetch(`${API_BASE}/api/v1/waypoints${mapParam}`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/v1/missions${mapParam}`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/v1/schedules${mapParam}`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/v1/maps`).then(r => r.ok ? r.json() : null)
    ]);

    if (wRes.status === "fulfilled" && wRes.value) {
      let waypoints = wRes.value.waypoints || [];
      if (activeMapName) waypoints = waypoints.filter(wp => !wp.map || wp.map === activeMapName);
      const hubCount = document.getElementById("hub-locations-count");
      if (hubCount) hubCount.textContent = `${waypoints.length} Stations`;
    }

    if (mRes.status === "fulfilled" && mRes.value) {
      let missions = mRes.value.missions || [];
      if (activeMapName) missions = missions.filter(m => !m.map || m.map === activeMapName);
      const hubCount = document.getElementById("hub-missions-count");
      if (hubCount) hubCount.textContent = `${missions.length} Routines`;
    }

    if (sRes.status === "fulfilled" && sRes.value) {
      const schedules = sRes.value.schedules || [];
      const hubCount = document.getElementById("hub-schedules-count");
      if (hubCount) hubCount.textContent = `${schedules.length} Active`;
    }

    if (mapsRes.status === "fulfilled" && mapsRes.value) {
      const maps = mapsRes.value.maps || [];
      const hubMapDesc = document.getElementById("hub-active-map-name");
      if (hubMapDesc) {
        hubMapDesc.textContent = activeMapName ? `Active: ${activeMapName}` : `${maps.length} Maps Saved`;
      }
    }
  } catch (err) {
    console.warn("refreshHubCounters error:", err);
  }
}

async function loadMaps() {
  const list = document.getElementById("maps-list");
  if (!list) return;
  list.innerHTML = `<div class="loading-spinner">Loading maps...</div>`;

  try {
    const res = await fetch(`${API_BASE}/api/v1/maps`);
    const data = await res.json();
    const maps = data.maps || [];

    // Also get active map info
    const curRes = await fetch(`${API_BASE}/api/v1/maps/current`);
    const curData = await curRes.json();
    const curMap = curData.name || curData.map_name || curData.current || data.current || (typeof maps[0] === 'string' ? maps[0] : maps[0]?.name) || "";
    if (curMap && curMap !== activeMapName) {
      activeMapName = curMap;
    }

    // Update Hub Badge & Card Subtitle
    const hubMapDesc = document.getElementById("hub-active-map-name");
    if (hubMapDesc) hubMapDesc.textContent = activeMapName ? `Active: ${activeMapName}` : "No map loaded";

    const locSub = document.getElementById("locations-map-subtitle");
    if (locSub) locSub.textContent = `Showing stations on "${activeMapName || 'all'}"`;

    const misSub = document.getElementById("missions-map-subtitle");
    if (misSub) misSub.textContent = `Showing visual routines on "${activeMapName || 'all'}"`;

    const schedSub = document.getElementById("schedules-map-subtitle");
    if (schedSub) schedSub.textContent = `Showing automated timers on "${activeMapName || 'all'}"`;

    if (maps.length === 0) {
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No saved maps available. Click "+ Create Map" to start SLAM.</p>`;
      return;
    }

    list.innerHTML = maps.map(m => {
      const mapName = typeof m === 'string' ? m : (m.name || m.id);
      const isCur = mapName === activeMapName;
      return `
        <div class="swipeable-wrapper">
          <div class="swipe-delete-action">
            <button type="button" class="btn-swipe-delete" onclick="deleteMapPrompt('${escapeQuotes(mapName)}')">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Delete</span>
            </button>
          </div>
          <div class="swipeable-content map-item-card ${isCur ? 'is-active-map' : ''}">
            <div class="map-item-info" ${isCur ? `onclick="openMapViewer('${escapeQuotes(mapName)}')"` : ''}>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h3>${escapeHtml(mapName)}</h3>
                ${isCur ? `<span class="badge badge-ok">ACTIVE</span>` : ''}
              </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              ${isCur 
                ? `<button class="btn btn-secondary btn-sm" onclick="openMapViewer('${escapeQuotes(mapName)}')">Preview & Edit</button>`
                : `<button class="btn btn-primary btn-sm" onclick="confirmActivateMap('${escapeQuotes(mapName)}')">Load Map</button>`
              }
            </div>
          </div>
        </div>
      `;
    }).join("");

    makeSwipeable(list);
  } catch (e) {
    list.innerHTML = `<p style="color: var(--danger); padding: 16px;">Failed to load maps: ${escapeHtml(e.message)}</p>`;
  }
}

window.confirmActivateMap = function(mapName) {
  showDangerConfirmation({
    title: "Switch Active Map",
    message: `Switching active map to "${mapName}" will reload stations, routines, and navigation for this environment. Continue?`,
    confirmText: "Load Map",
    isDanger: false,
    icon: "🗺️",
    onConfirm: () => activateMap(mapName)
  });
};

window.activateMap = async function(mapName) {
  try {
    showToast(`Activating map "${mapName}"...`);
    await fetch(`${API_BASE}/api/v1/maps/${encodeURIComponent(mapName)}/activate`, {
      method: "POST"
    });
    showToast(`Map "${mapName}" activated!`);
    await handleActiveMapChanged(mapName);
  } catch (e) {
    showToast(`Failed to activate map: ${e.message}`, true);
  }
};

window.deleteMapPrompt = function(mapName) {
  if (mapName === activeMapName) {
    showToast("Cannot delete the active map. Switch to another map first.", true);
    return;
  }
  showDangerConfirmation({
    title: "Delete Map",
    message: `Are you sure you want to delete map "${mapName}"? All stations and dock settings on this map will be permanently removed.`,
    confirmText: "Delete Map",
    isDanger: true,
    icon: "🗺️",
    onConfirm: () => deleteMap(mapName)
  });
};

window.deleteMap = async function(mapName) {
  try {
    showToast(`Deleting map "${mapName}"...`);
    const res = await fetch(`${API_BASE}/api/v1/maps/${encodeURIComponent(mapName)}`, {
      method: "DELETE"
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to delete map");
    }
    showToast(`Map "${mapName}" deleted.`);
    loadMaps();
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, true);
  }
};

/* --------------------------------------------------------------------------
   12. Locations Subpage (Current Map Scoped)
   -------------------------------------------------------------------------- */
async function loadWaypoints() {
  const list = document.getElementById("locations-full-list");
  if (!list) return;
  list.innerHTML = `<div class="loading-spinner">Loading locations for "${activeMapName || 'active map'}"...</div>`;

  // Enable / disable Save Position button based on active map
  const addBtn = document.getElementById("btn-add-location");
  if (addBtn) {
    if (!activeMapName) {
      addBtn.disabled = true;
      addBtn.classList.add("disabled");
    } else {
      addBtn.disabled = false;
      addBtn.classList.remove("disabled");
    }
  }

  const locSub = document.getElementById("locations-map-subtitle");
  if (locSub) locSub.textContent = `Showing stations on "${activeMapName || 'all'}"`;

  try {
    const url = activeMapName
      ? `${API_BASE}/api/v1/waypoints?map=${encodeURIComponent(activeMapName)}`
      : `${API_BASE}/api/v1/waypoints`;
    const res = await fetch(url);
    const data = await res.json();
    let waypoints = data.waypoints || [];

    // Filter to current active map if waypoint has map metadata
    if (activeMapName) {
      waypoints = waypoints.filter(wp => !wp.map || wp.map === activeMapName);
    }

    // Update hub count
    const hubCount = document.getElementById("hub-locations-count");
    if (hubCount) hubCount.textContent = `${waypoints.length} Stations`;

    if (waypoints.length === 0) {
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No saved locations on "${activeMapName || 'current map'}". Tap "+ Save Position" to record a waypoint.</p>`;
      return;
    }

    list.innerHTML = waypoints.map(wp => `
      <div class="swipeable-wrapper">
        <div class="swipe-delete-action">
          <button type="button" class="btn-swipe-delete" onclick="deleteWaypointPrompt('${escapeQuotes(wp.name)}')">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <span>Delete</span>
          </button>
        </div>
        <div class="swipeable-content location-item">
          <div class="location-item-info" onclick="navigateToLocation('${escapeQuotes(wp.name)}')">
            <h3>${escapeHtml(wp.name)}</h3>
            <p>X: ${(wp.x || 0).toFixed(2)}m • Y: ${(wp.y || 0).toFixed(2)}m • θ: ${((wp.theta || 0) * 180 / Math.PI).toFixed(0)}°</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary btn-sm" onclick="navigateToLocation('${escapeQuotes(wp.name)}')">Dispatch Here</button>
          </div>
        </div>
      </div>
    `).join("");

    makeSwipeable(list);
  } catch (e) {
    list.innerHTML = `<p style="color: var(--danger); padding: 16px;">Failed to load locations: ${escapeHtml(e.message)}</p>`;
  }
}

window.navigateToLocation = async function(wpName) {
  try {
    showToast(`Navigating to "${wpName}"...`);
    onScreenNavInitiated = true;

    // Show navigation progress screen immediately
    const navScreen = document.getElementById("screen-nav-progress");
    const destEl = document.getElementById("nav-screen-destination");
    if (destEl) destEl.innerHTML = `Navigating to <span class="nav-target-highlight">${escapeHtml(wpName)}</span>`;
    if (navScreen) navScreen.style.display = "flex";

    await fetch(`${API_BASE}/api/v1/navigation/goto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoint: wpName })
    });

    triggerFaceExpression("thinking");
  } catch (e) {
    onScreenNavInitiated = false;
    const navScreen = document.getElementById("screen-nav-progress");
    if (navScreen) navScreen.style.display = "none";
    showToast(`Navigation failed: ${e.message}`, true);
  }
};

window.triggerAutoDock = async function() {
  try {
    showToast("Starting Auto-Dock to charging station...");
    triggerFaceExpression("thinking");
    const res = await fetch(`${API_BASE}/api/v1/dock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navigate_to_staging: true })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail?.message || err.error?.message || "Robot busy or dock unavailable");
    }
  } catch (e) {
    showToast(`Auto-Dock failed: ${e.message}`, true);
  }
};

window.triggerUndock = async function() {
  try {
    showToast("Undocking from charging station...");
    triggerFaceExpression("thinking");
    const res = await fetch(`${API_BASE}/api/v1/undock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail?.message || err.error?.message || "Robot busy or not docked");
    }
  } catch (e) {
    showToast(`Undock failed: ${e.message}`, true);
  }
};

window.deleteWaypointPrompt = function(wpName) {
  showDangerConfirmation({
    title: "Delete Station",
    message: `Are you sure you want to delete station "${wpName}"?`,
    confirmText: "Delete Station",
    isDanger: true,
    icon: "📍",
    onConfirm: () => deleteWaypoint(wpName)
  });
};

window.deleteWaypoint = async function(wpName) {
  try {
    await fetch(`${API_BASE}/api/v1/waypoints/${encodeURIComponent(wpName)}`, { method: "DELETE" });
    showToast(`Deleted "${wpName}".`);
    loadWaypoints();
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, true);
  }
};

