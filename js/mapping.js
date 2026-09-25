// NavPro Mini - Live SLAM Mapping Screen & Occupancy Grid Renderer

/* --------------------------------------------------------------------------
   9. SLAM Mapping Live Screen & Live Occupancy Grid Renderer
   -------------------------------------------------------------------------- */
let liveMapFetchInterval = null;
let liveMapFastPoller = null;
let liveMapAnimId = null;
let liveMapCamera = { worldX: 0.0, worldY: 0.0, scale: 1.0, userControlled: false };
let liveMapMetadata = null; // { width, height, resolution, origin: { x, y } }
let targetRobotPose = { x: 0, y: 0, yaw: 0 };
let smoothRobotPose = { x: 0, y: 0, yaw: 0 };
let liveDockPose = { x: 0, y: 0, theta: 0 };
let liveStandoffPose = { x: 0.70, y: 0, theta: 0 };
let liveTrajectory = [];
let liveLaserScan = null; // { angle_min, angle_max, angle_increment, ranges, range_min, range_max }
let liveHasMovedAway = false;
let activeTouchPointers = new Map();
let initialPinchDistance = null;
let initialPinchScale = 1.0;
let latestMapImage = null;
let liveRosWs = null;
let liveRosWsReconnectTimer = null;
let liveMapOdomTf = null;

function quatToEulerYaw(q) {
  if (!q) return 0.0;
  const siny_cosp = 2.0 * (q.w * q.z + q.x * q.y);
  const cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
  return Math.atan2(siny_cosp, cosy_cosp);
}

function initMappingViewportInteractivity() {
  const canvas = document.getElementById("mapping-live-canvas");
  if (!canvas || canvas._interactivityAttached) return;
  canvas._interactivityAttached = true;

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinchDist = 0;
  let pinchScale = 1.0;

  // Touch Events (Touchscreen Kiosk)
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      isDragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      pinchDist = 0;
    } else if (e.touches.length === 2) {
      isDragging = false;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      pinchDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      pinchScale = liveMapCamera.scale;
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - lastX;
      const dy = e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;

      const res = (liveMapMetadata && liveMapMetadata.resolution) ? liveMapMetadata.resolution : 0.05;
      const pxPerMeter = (liveMapCamera.scale / res);
      if (pxPerMeter > 0) {
        liveMapCamera.worldX -= dx / pxPerMeter;
        liveMapCamera.worldY += dy / pxPerMeter;
        liveMapCamera.userControlled = true;
      }
    } else if (e.touches.length === 2 && pinchDist > 0) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const factor = dist / pinchDist;
      liveMapCamera.scale = Math.max(0.2, Math.min(6.0, pinchScale * factor));
      liveMapCamera.userControlled = true;
    }
  }, { passive: false });

  const endTouch = (e) => {
    if (e.touches.length === 1) {
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      isDragging = true;
      pinchDist = 0;
    } else if (e.touches.length === 0) {
      isDragging = false;
      pinchDist = 0;
    }
  };
  canvas.addEventListener("touchend", endTouch, { passive: false });
  canvas.addEventListener("touchcancel", endTouch, { passive: false });

  // Mouse fallback
  let isMouseDown = false;
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isMouseDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("mousemove", (e) => {
    if (!isMouseDown) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const res = (liveMapMetadata && liveMapMetadata.resolution) ? liveMapMetadata.resolution : 0.05;
    const pxPerMeter = (liveMapCamera.scale / res);
    if (pxPerMeter > 0) {
      liveMapCamera.worldX -= dx / pxPerMeter;
      liveMapCamera.worldY += dy / pxPerMeter;
      liveMapCamera.userControlled = true;
    }
  });
  window.addEventListener("mouseup", () => {
    isMouseDown = false;
  });

  // Mouse wheel zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    liveMapCamera.scale = Math.max(0.2, Math.min(6.0, liveMapCamera.scale * zoomFactor));
    liveMapCamera.userControlled = true;
  }, { passive: false });

  // Floating button controls
  document.getElementById("btn-mapping-zoom-in")?.addEventListener("click", () => {
    liveMapCamera.scale = Math.min(liveMapCamera.scale * 1.25, 6.0);
    liveMapCamera.userControlled = true;
  });
  document.getElementById("btn-mapping-zoom-out")?.addEventListener("click", () => {
    liveMapCamera.scale = Math.max(liveMapCamera.scale / 1.25, 0.2);
    liveMapCamera.userControlled = true;
  });
  document.getElementById("btn-mapping-recenter")?.addEventListener("click", () => {
    liveMapCamera.worldX = smoothRobotPose.x;
    liveMapCamera.worldY = smoothRobotPose.y;
    liveMapCamera.userControlled = false;
  });
}

function startLiveMapRenderer() {
  stopLiveMapRenderer();
  const canvas = document.getElementById("mapping-live-canvas");
  const loadingEl = document.getElementById("mapping-canvas-loading");
  if (loadingEl) loadingEl.style.display = "flex";
  if (!canvas) return;

  initMappingViewportInteractivity();

  let firstFrameLoaded = false;
  latestMapImage = null;

  // 1. Map Image & Metadata fetcher (every 1200ms)
  const fetchMapData = async () => {
    try {
      const [imgRes, infoRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/maps/current/image?rotate=0&t=${Date.now()}`),
        fetch(`${API_BASE}/api/v1/maps/current/info`)
      ]);

      if (infoRes.ok) {
        const info = await infoRes.json();
        if (info.loaded) liveMapMetadata = info;
      }

      if (imgRes.ok) {
        const blob = await imgRes.blob();
        const img = new Image();
        img.onload = () => {
          latestMapImage = img;
          if (loadingEl) loadingEl.style.display = "none";

          if (!firstFrameLoaded && liveMapMetadata) {
            firstFrameLoaded = true;
            const fitScale = Math.min(
              (canvas.width * 0.75) / (img.width || 200),
              (canvas.height * 0.65) / (img.height || 200)
            );
            liveMapCamera.scale = Math.max(0.6, Math.min(fitScale, 2.5));
            liveMapCamera.worldX = targetRobotPose.x || 0.0;
            liveMapCamera.worldY = targetRobotPose.y || 0.0;
          }
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(blob);
      }
    } catch (_) {}
  };

  // 2. High-speed ROSBridge WebSocket (port 9090) for zero-latency pose & lidar sync
  const connectRosBridge = () => {
    if (liveRosWs) {
      try { liveRosWs.close(); } catch (_) {}
      liveRosWs = null;
    }
    clearTimeout(liveRosWsReconnectTimer);

    try {
      const wsHost = window.location.hostname || "127.0.0.1";
      liveRosWs = new WebSocket(`ws://${wsHost}:9090`);

      liveRosWs.onopen = () => {
        // Track map -> odom transform live from /tf
        liveRosWs.send(JSON.stringify({
          op: "subscribe",
          topic: "/tf",
          type: "tf2_msgs/msg/TFMessage",
          throttle_rate: 50
        }));

        // Subscribe to /odom for low-latency, smooth odometry
        liveRosWs.send(JSON.stringify({
          op: "subscribe",
          topic: "/odom",
          type: "nav_msgs/msg/Odometry",
          throttle_rate: 50
        }));

        // Subscribe to /scan_filtered for laser scan overlay
        liveRosWs.send(JSON.stringify({
          op: "subscribe",
          topic: "/scan_filtered",
          type: "sensor_msgs/msg/LaserScan",
          throttle_rate: 100
        }));
      };

      liveRosWs.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.op !== "publish" || !payload.msg) return;

          if (payload.topic === "/tf") {
            const transforms = payload.msg.transforms || [];
            for (const t of transforms) {
              const parent = (t.header?.frame_id || "").replace(/\//g, "");
              const child = (t.child_frame_id || "").replace(/\//g, "");
              if (parent === "map" && child === "odom") {
                const tr = t.transform;
                liveMapOdomTf = {
                  x: tr.translation.x,
                  y: tr.translation.y,
                  theta: quatToEulerYaw(tr.rotation)
                };
                break;
              }
            }
          } else if (payload.topic === "/odom") {
            const pos = payload.msg.pose?.pose?.position;
            const orient = payload.msg.pose?.pose?.orientation;
            if (pos && orient) {
              const ox = pos.x;
              const oy = pos.y;
              const odomYaw = quatToEulerYaw(orient);

              let mx = ox;
              let my = oy;
              let myaw = odomYaw;

              if (liveMapOdomTf) {
                const c = Math.cos(liveMapOdomTf.theta);
                const s = Math.sin(liveMapOdomTf.theta);
                mx = liveMapOdomTf.x + c * ox - s * oy;
                my = liveMapOdomTf.y + s * ox + c * oy;
                myaw = liveMapOdomTf.theta + odomYaw;
              }

              targetRobotPose = { x: mx, y: my, yaw: myaw };

              if (!firstFrameLoaded) {
                smoothRobotPose.x = mx;
                smoothRobotPose.y = my;
                smoothRobotPose.yaw = myaw;
              }

              // Update dock heading and standoff once robot moves >= 0.20m from starting dock position
              const distFromDock = Math.hypot(targetRobotPose.x - liveDockPose.x, targetRobotPose.y - liveDockPose.y);
              if (!liveHasMovedAway && distFromDock >= 0.20) {
                const depAngle = Math.atan2(targetRobotPose.y - liveDockPose.y, targetRobotPose.x - liveDockPose.x);
                liveDockPose.theta = depAngle;
                liveStandoffPose = {
                  x: liveDockPose.x + 0.70 * Math.cos(depAngle),
                  y: liveDockPose.y + 0.70 * Math.sin(depAngle),
                  theta: depAngle
                };
                liveHasMovedAway = true;
              }

              // Record trajectory point
              const lastPt = liveTrajectory[liveTrajectory.length - 1];
              if (!lastPt || Math.hypot(targetRobotPose.x - lastPt.x, targetRobotPose.y - lastPt.y) >= 0.06) {
                liveTrajectory.push({ x: targetRobotPose.x, y: targetRobotPose.y });
              }
            }
          } else if (payload.topic === "/scan_filtered" || payload.topic === "/scan") {
            if (payload.msg && payload.msg.ranges) {
              liveLaserScan = payload.msg;
            }
          }
        } catch (_) {}
      };

      liveRosWs.onerror = () => {
        try { liveRosWs.close(); } catch (_) {}
      };

      liveRosWs.onclose = () => {
        liveRosWs = null;
        clearTimeout(liveRosWsReconnectTimer);
        liveRosWsReconnectTimer = setTimeout(() => {
          if (document.getElementById("screen-mapping-live")?.style.display === "flex") {
            connectRosBridge();
          }
        }, 2000);
      };
    } catch (_) {}
  };

  // 3. Fallback HTTP telemetry poller (only used if WebSocket is not yet connected)
  const fetchRobotTelemetry = async () => {
    if (liveRosWs && liveRosWs.readyState === WebSocket.OPEN) return;
    try {
      const stateRes = await fetch(`${API_BASE}/api/v1/state`);
      if (stateRes.ok) {
        const s = await stateRes.json();
        if (s.localization && s.localization.x !== undefined) {
          targetRobotPose = {
            x: s.localization.x,
            y: s.localization.y,
            yaw: s.localization.yaw || 0
          };
          if (!firstFrameLoaded) {
            smoothRobotPose.x = targetRobotPose.x;
            smoothRobotPose.y = targetRobotPose.y;
            smoothRobotPose.yaw = targetRobotPose.yaw;
          }
        }
      }
    } catch (_) {}
  };

  fetchMapData();
  connectRosBridge();
  fetchRobotTelemetry();
  liveMapFetchInterval = setInterval(fetchMapData, 1200);
  liveMapFastPoller = setInterval(fetchRobotTelemetry, 1000);

  // 3. Silky-smooth 60 FPS Canvas Render Loop
  const renderFrameLoop = () => {
    liveMapAnimId = requestAnimationFrame(renderFrameLoop);

    // Adjust canvas resolution to display size
    const dWidth = window.innerWidth || 800;
    const dHeight = window.innerHeight || 1280;
    if (canvas.width !== dWidth || canvas.height !== dHeight) {
      canvas.width = dWidth;
      canvas.height = dHeight;
    }

    const ctx = canvas.getContext("2d");
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Smoothly lerp robot pose towards target pose
    smoothRobotPose.x += (targetRobotPose.x - smoothRobotPose.x) * 0.22;
    smoothRobotPose.y += (targetRobotPose.y - smoothRobotPose.y) * 0.22;
    let dyaw = targetRobotPose.yaw - smoothRobotPose.yaw;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    smoothRobotPose.yaw += dyaw * 0.22;

    // If auto-tracking enabled, smoothly follow robot
    if (!liveMapCamera.userControlled && firstFrameLoaded) {
      liveMapCamera.worldX += (smoothRobotPose.x - liveMapCamera.worldX) * 0.12;
      liveMapCamera.worldY += (smoothRobotPose.y - liveMapCamera.worldY) * 0.12;
    }

    // World to Canvas transform
    const res = (liveMapMetadata && liveMapMetadata.resolution) ? liveMapMetadata.resolution : 0.05;
    const pxPerMeter = liveMapCamera.scale / res;

    const worldToCanvas = (wx, wy) => {
      return {
        x: cx + (wx - liveMapCamera.worldX) * pxPerMeter,
        y: cy - (wy - liveMapCamera.worldY) * pxPerMeter
      };
    };

    // Background: deep radar slate
    ctx.fillStyle = "#0B0F19";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subgrid lines (anchored to world 1m grid)
    ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
    ctx.lineWidth = 1;
    const meterPx = pxPerMeter; // 1 meter in screen pixels
    if (meterPx >= 15) {
      const startX = ((cx - liveMapCamera.worldX * meterPx) % meterPx + meterPx) % meterPx;
      const startY = ((cy + liveMapCamera.worldY * meterPx) % meterPx + meterPx) % meterPx;
      for (let x = startX; x < canvas.width; x += meterPx) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = startY; y < canvas.height; y += meterPx) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    // Draw Occupancy Grid Map Image (Anchored in world space: zero jumps!)
    if (latestMapImage && liveMapMetadata) {
      const originX = liveMapMetadata.origin.x;
      const originY = liveMapMetadata.origin.y;
      const mapW = liveMapMetadata.width * res;
      const mapH = liveMapMetadata.height * res;

      // Top-left of map in world: (originX, originY + mapH)
      const pTL = worldToCanvas(originX, originY + mapH);
      const drawW = mapW * pxPerMeter;
      const drawH = mapH * pxPerMeter;

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(latestMapImage, pTL.x, pTL.y, drawW, drawH);
      ctx.restore();
    }

    // Draw Trajectory Trail
    if (liveTrajectory.length > 1) {
      ctx.save();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.65)";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      const p0 = worldToCanvas(liveTrajectory[0].x, liveTrajectory[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < liveTrajectory.length; i++) {
        const pi = worldToCanvas(liveTrajectory[i].x, liveTrajectory[i].y);
        ctx.lineTo(pi.x, pi.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw Live Lidar Laser Scan Markings
    if (liveLaserScan && liveLaserScan.ranges) {
      ctx.save();
      ctx.fillStyle = "rgba(239, 68, 68, 0.85)"; // vibrant ruby lidar points
      const angleMin = liveLaserScan.angle_min;
      const angleInc = liveLaserScan.angle_increment;
      const rMin = liveLaserScan.range_min || 0.05;
      const rMax = liveLaserScan.range_max || 12.0;
      const ranges = liveLaserScan.ranges;
      const len = ranges.length;

      // Sample every 2nd beam for crisp performance
      for (let i = 0; i < len; i += 2) {
        const r = ranges[i];
        if (r === null || r < rMin || r > rMax) continue;
        const beamAngle = smoothRobotPose.yaw + angleMin + i * angleInc;
        const hitWx = smoothRobotPose.x + r * Math.cos(beamAngle);
        const hitWy = smoothRobotPose.y + r * Math.sin(beamAngle);
        const hp = worldToCanvas(hitWx, hitWy);

        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw Standoff Marker
    if (liveStandoffPose) {
      const sp = worldToCanvas(liveStandoffPose.x, liveStandoffPose.y);
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.fillStyle = "rgba(6, 182, 212, 0.85)";
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillStyle = "#A5F3FC";
      ctx.textAlign = "center";
      ctx.fillText("STANDOFF (0.7m)", 0, 22);
      ctx.restore();
    }

    // Draw Charging Dock Marker
    if (liveDockPose) {
      const dp = worldToCanvas(liveDockPose.x, liveDockPose.y);
      ctx.save();
      ctx.translate(dp.x, dp.y);
      ctx.rotate(-liveDockPose.theta);
      ctx.fillStyle = "#10B981";
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(8, -6);
      ctx.lineTo(8, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillStyle = "#6EE7B7";
      ctx.textAlign = "center";
      ctx.fillText("DOCK (ORIGIN)", dp.x, dp.y - 20);
      ctx.restore();
    }

    // Draw Smooth Live Robot Marker
    const rp = worldToCanvas(smoothRobotPose.x, smoothRobotPose.y);
    ctx.save();
    ctx.translate(rp.x, rp.y);

    // Glowing pulse ring around robot
    const pulse = (Date.now() % 1500) / 1500;
    ctx.strokeStyle = `rgba(249, 115, 22, ${1.0 - pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 18 + pulse * 14, 0, 2 * Math.PI);
    ctx.stroke();

    // Heading orientation
    ctx.rotate(-smoothRobotPose.yaw);

    // Chassis
    ctx.fillStyle = "#F97316";
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Dark core
    ctx.fillStyle = "#1E293B";
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, 2 * Math.PI);
    ctx.fill();

    // Direction arrow pointing forward
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(12, -7);
    ctx.lineTo(12, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Label
    ctx.save();
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillStyle = "#FDBA74";
    ctx.textAlign = "center";
    ctx.fillText("ROBOT", rp.x, rp.y + 30);
    ctx.restore();
  };

  renderFrameLoop();
}

function stopLiveMapRenderer() {
  if (liveMapAnimId) {
    cancelAnimationFrame(liveMapAnimId);
    liveMapAnimId = null;
  }
  if (liveRosWs) {
    try {
      liveRosWs.close();
    } catch (_) {}
    liveRosWs = null;
  }
  clearTimeout(liveRosWsReconnectTimer);
  liveRosWsReconnectTimer = null;
  liveMapOdomTf = null;
  clearInterval(liveMapFetchInterval);
  liveMapFetchInterval = null;
  clearInterval(liveMapFastPoller);
  liveMapFastPoller = null;
  latestMapImage = null;
  const loadingEl = document.getElementById("mapping-canvas-loading");
  if (loadingEl) loadingEl.style.display = "flex";
}

function initMappingControls() {
  // Cancel / Abort Mapping: Show stopping spinner, stop SLAM mode, wait until off, and return home
  document.getElementById("btn-abort-mapping")?.addEventListener("click", async () => {
    const stoppingModal = document.getElementById("modal-stopping-mapping");
    if (stoppingModal) stoppingModal.style.display = "flex";

    try {
      // 1. Immediately send stop to motion to ensure wheels halted
      try {
        await fetch(`${API_BASE}/api/v1/motion/stop`, { method: "POST" });
      } catch (_) {}

      // 2. Request switch to idle
      await fetch(`${API_BASE}/api/v1/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "idle" })
      });

      // Poll until mapping is confirmed stopped (up to 6s)
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const sRes = await fetch(`${API_BASE}/api/v1/mode`);
          if (sRes.ok) {
            const mData = await sRes.json();
            if (mData.mode !== "mapping") break;
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn("Error stopping mapping:", e);
    } finally {
      if (stoppingModal) stoppingModal.style.display = "none";
      stopMappingLive();
      showToast("Mapping session stopped.");
      if (typeof showDashboardView === "function") {
        showDashboardView();
      } else {
        setSwipeIndex(0); // Return to Dashboard
      }
    }
  });

  // Finish & Save Map
  document.getElementById("btn-save-finish-map")?.addEventListener("click", () => {
    openTouchKeyboard("Enter New Map Name:", async (mapName) => {
      if (!mapName || !mapName.trim()) return;
      const targetName = mapName.trim();
      const stoppingModal = document.getElementById("modal-stopping-mapping");
      if (stoppingModal) {
        const titleEl = stoppingModal.querySelector("h2");
        const descEl = stoppingModal.querySelector("p");
        if (titleEl) titleEl.textContent = "Saving Map & Dock";
        if (descEl) descEl.textContent = `Persisting dock pose & saving "${targetName}"...`;
        stoppingModal.style.display = "flex";
      }

      try {
        // 1. Save Dock Pose to /api/v1/dock/pose
        try {
          await fetch(`${API_BASE}/api/v1/dock/pose`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              x: liveDockPose.x,
              y: liveDockPose.y,
              theta: liveDockPose.theta
            })
          });
        } catch (err) {
          console.warn("Failed to set dock pose:", err);
        }

        // 2. Save 'Dock Standoff' Waypoint (0.7m staging point, back facing dock)
        try {
          await fetch(`${API_BASE}/api/v1/waypoints`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Dock Standoff",
              type: "dock",
              x: liveStandoffPose.x,
              y: liveStandoffPose.y,
              theta: liveStandoffPose.theta,
              map: targetName
            })
          });
        } catch (err) {
          console.warn("Failed to save Dock Standoff waypoint:", err);
        }

        // 3. Save 'Charging Dock' Waypoint
        try {
          await fetch(`${API_BASE}/api/v1/waypoints`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Charging Dock",
              type: "dock",
              x: liveDockPose.x,
              y: liveDockPose.y,
              theta: liveDockPose.theta,
              map: targetName
            })
          });
        } catch (err) {
          console.warn("Failed to save Charging Dock waypoint:", err);
        }

        // 4. Atomic FINISH_MAPPING call
        await fetch(`${API_BASE}/api/v1/mapping/finish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: targetName, overwrite: true })
        });

        // Wait for mode to finish mapping
        for (let i = 0; i < 18; i++) {
          await new Promise(r => setTimeout(r, 600));
          try {
            const mRes = await fetch(`${API_BASE}/api/v1/mode`);
            if (mRes.ok) {
              const mData = await mRes.json();
              if (mData.mode !== "mapping") break;
            }
          } catch (_) {}
        }

        stopMappingLive();
        showToast(`Map "${targetName}" and Dock poses saved!`);
        activeMapName = targetName;
        loadMaps();
        loadWaypoints();
        if (typeof showDashboardView === "function") {
          showDashboardView();
        } else {
          setSwipeIndex(0); // Return to Dashboard
        }
      } catch (e) {
        showToast(`Error saving map: ${e.message}`, true);
      } finally {
        if (stoppingModal) stoppingModal.style.display = "none";
      }
    });
  });
}

window.startSlamMapping = async function() {
  try {
    showToast("Initializing SLAM mapping mode...");

    // Mapping begins at the charging dock facing room. Map origin (0,0) defines dock position.
    liveDockPose = { x: 0, y: 0, theta: 0 };
    liveStandoffPose = { x: 0.70, y: 0, theta: 0 };
    liveTrajectory = [{ x: 0, y: 0 }];
    liveHasMovedAway = false;

    await fetch(`${API_BASE}/api/v1/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "mapping" })
    });

    const screen = document.getElementById("screen-mapping-live");
    if (screen) screen.style.display = "flex";

    liveMapPan = { x: 0, y: 0, scale: 1.0, userControlled: false };
    startLiveMapRenderer();

    mappingStartTime = Date.now();
    const timerEl = document.getElementById("mapping-timer");
    clearInterval(mappingTimerInterval);
    mappingTimerInterval = setInterval(() => {
      if (!mappingStartTime || !timerEl) return;
      const elapsed = Math.floor((Date.now() - mappingStartTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      timerEl.textContent = `${m}:${s}`;
    }, 1000);

    triggerFaceExpression("curios");
  } catch (e) {
    showToast("Failed to start mapping: " + e.message, true);
  }
};

function stopMappingLive() {
  const screen = document.getElementById("screen-mapping-live");
  if (screen) screen.style.display = "none";
  stopLiveMapRenderer();
  clearInterval(mappingTimerInterval);
  mappingStartTime = null;
}

