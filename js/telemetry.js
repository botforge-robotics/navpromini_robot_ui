// NavPro Mini - Telemetry, Navigation/Docking Watcher & Polling

/* --------------------------------------------------------------------------
   6. Navigation Progress & Auto-Charging Watcher
   -------------------------------------------------------------------------- */
let onScreenNavInitiated = false;
let previousDockOperation = "idle";

function updateNavigationState(navData, isMissionActive = false) {
  if (!navData) return;
  try {
    const isNav = !!(navData.state === "active" || navData.is_navigating || navData.status === "navigating" || navData.status === "executing");
    const wasNav = isNavigating;
    isNavigating = isNav;

    const navScreen = document.getElementById("screen-nav-progress");
    if (!navScreen) return;

    // Mission mode guard: if a mission workflow is executing, the mission progress screen is active.
    // Navigation progress screen MUST NOT collide with mission goto steps!
    if (isMissionActive) {
      if (navScreen.style.display === "flex") {
        navScreen.style.display = "none";
      }
      return;
    }

    if (isNav) {
      if (navScreen.style.display !== "flex") {
        navScreen.style.display = "flex";
      }

      // Update Destination title
      const destEl = document.getElementById("nav-screen-destination");
      if (destEl) {
        let targetName = "";
        if (navData.target_waypoint) {
          targetName = navData.target_waypoint;
        } else if (navData.target && typeof navData.target === "object") {
          if (navData.target.name) {
            targetName = navData.target.name;
          } else if (navData.target.x !== undefined && navData.target.y !== undefined) {
            const tx = Number(navData.target.x);
            const ty = Number(navData.target.y);
            const matchedWp = (cachedWaypoints || []).find(w => Math.hypot(w.x - tx, w.y - ty) < 0.4);
            targetName = matchedWp && matchedWp.name ? matchedWp.name : "Designated Station";
          } else {
            targetName = "Designated Station";
          }
        } else {
          targetName = "Designated Station";
        }
        destEl.innerHTML = `Navigating to <span class="nav-target-highlight">${escapeHtml(targetName)}</span>`;
      }

      // Update Distance Remaining with clean user typography
      const distEl = document.getElementById("nav-screen-distance");
      if (distEl) {
        if (navData.distance_remaining !== undefined && navData.distance_remaining !== null) {
          distEl.textContent = `${navData.distance_remaining.toFixed(1)}m remaining • Moving safely to destination`;
        } else {
          distEl.textContent = "Guiding robot smoothly to target location...";
        }
      }

      // Update Progress Bar
      const barEl = document.getElementById("nav-screen-bar");
      if (barEl) {
        if (navData.progress_percent !== undefined && navData.progress_percent !== null) {
          barEl.style.width = `${Math.min(100, Math.max(5, navData.progress_percent))}%`;
        } else {
          barEl.style.width = "70%";
        }
      }
    } else {
      if (navScreen.style.display === "flex") {
        navScreen.style.display = "none";
        if (wasNav && (navData.state === "succeeded" || navData.status === "succeeded")) {
          showToast("Reached destination successfully!");
          triggerFaceExpression("happy");
        }
      }
    }
  } catch (err) {
    console.warn("Navigation state update error:", err);
  }
}

let dockCamPollActive = false;
let dockCamPollTimer = null;

function startDockCamStream() {
  if (dockCamPollActive) return;
  dockCamPollActive = true;
  pollNextDockFrame();
}

function pollNextDockFrame() {
  if (!dockCamPollActive) return;
  const cameraImg = document.getElementById("dock-camera-preview-img");
  if (!cameraImg) return;

  const img = new Image();
  const startTime = Date.now();
  img.onload = () => {
    if (!dockCamPollActive) return;
    cameraImg.src = img.src;
    const elapsed = Date.now() - startTime;
    const delay = Math.max(10, 35 - elapsed);
    dockCamPollTimer = setTimeout(pollNextDockFrame, delay);
  };
  img.onerror = () => {
    if (!dockCamPollActive) return;
    dockCamPollTimer = setTimeout(pollNextDockFrame, 200);
  };
  img.src = `${API_BASE}/api/v1/dock/debug_image?t=${Date.now()}`;
}

function stopDockCamStream() {
  dockCamPollActive = false;
  if (dockCamPollTimer) {
    clearTimeout(dockCamPollTimer);
    dockCamPollTimer = null;
  }
  const cameraImg = document.getElementById("dock-camera-preview-img");
  if (cameraImg) cameraImg.src = "";
}

function updateDockingScreen(dockData, stateData, isMissionActive = false) {
  const dockScreen = document.getElementById("screen-docking-progress");
  if (!dockScreen) return;

  const dockOp = (dockData && dockData.operation) ||
                 (stateData && stateData.dock && stateData.dock.operation) ||
                 "idle";

  // Mission mode guard: during mission execution, mission progress screen displays the dock node
  if (isMissionActive) {
    if (dockScreen.style.display === "flex") {
      dockScreen.style.display = "none";
    }
    stopDockCamStream();
    previousDockOperation = dockOp;
    return;
  }

  const titleEl = document.getElementById("dock-progress-title");
  const subEl = document.getElementById("dock-progress-subtitle");
  const markerEl = document.getElementById("dock-marker-icon");
  const cancelBtn = document.getElementById("btn-cancel-docking");
  const cameraCard = document.getElementById("dock-camera-card");
  const cameraImg = document.getElementById("dock-camera-preview-img");
  const tagStatusEl = document.getElementById("dock-camera-tag-status");
  const radarAnim = document.getElementById("docking-target-animation");

  if (dockOp === "docking") {
    dockScreen.style.display = "flex";
    if (cameraCard) cameraCard.style.display = "flex";
    if (radarAnim) radarAnim.style.display = "none";

    // Start zero-latency double-buffered camera preview
    startDockCamStream();

    const tagVisible = !!((dockData && dockData.tag_visible) || (stateData && stateData.dock && stateData.dock.tag_visible));
    if (tagStatusEl) {
      if (tagVisible) {
        tagStatusEl.textContent = "Charger Tag Locked";
        tagStatusEl.className = "dock-camera-tag-status status-locked";
      } else {
        tagStatusEl.textContent = "Searching for Charger...";
        tagStatusEl.className = "dock-camera-tag-status status-searching";
      }
    }

    if (titleEl) titleEl.textContent = "Connecting to Charging Station";
    if (subEl) subEl.textContent = tagVisible
      ? "Locked onto dock marker — visual-servoing into charging contact pins..."
      : "Aligning robot heading and searching for charging station marker...";
    if (cancelBtn) cancelBtn.textContent = "Cancel Docking";
  } else if (dockOp === "undocking") {
    dockScreen.style.display = "flex";
    if (cameraCard) cameraCard.style.display = "none";
    if (radarAnim) radarAnim.style.display = "flex";
    stopDockCamStream();

    if (titleEl) titleEl.textContent = "Disengaging from Charger";
    if (subEl) subEl.textContent = "Backing away smoothly from charging dock to staging area...";
    if (markerEl) markerEl.textContent = "⚡";
    if (cancelBtn) cancelBtn.textContent = "Cancel Undock";
  } else {
    // Docking/undocking idle or finished -> disconnect camera and auto-hide
    stopDockCamStream();
    if (dockScreen.style.display === "flex") {
      dockScreen.style.display = "none";
      if (previousDockOperation === "docking") {
        const isCharging = !!(stateData && (
          (stateData.dock && (stateData.dock.status === "charging" || stateData.dock.status === "full")) ||
          (stateData.battery && stateData.battery.charging)
        ));
        if (dockOp === "docked" || isCharging) {
          showToast("Robot successfully docked & charging!");
          triggerFaceExpression("happy");
        } else if (dockOp === "failed") {
          showToast("Docking could not be completed.", true);
        }
      } else if (previousDockOperation === "undocking") {
        if (dockOp === "undocked" || dockOp === "idle") {
          showToast("Robot disengaged from dock successfully!");
          triggerFaceExpression("happy");
        } else if (dockOp === "failed") {
          showToast("Undock operation canceled or interrupted.", true);
        }
      }
    }
  }

  previousDockOperation = dockOp;
}

function updatePowerState(pState) {
  if (!pState) return;
  try {
    const b = pState.data || pState.battery || pState;
    const isCharging = !!(b.charging || b.is_charging || b.status === "charging" || b.status === "Charging" || b.power_supply_status === "Charging" || b.adapter_connected || (pState.detail && pState.detail.charger_connected));
    const rawPct = b.percentage !== undefined ? b.percentage : (b.soc_percent !== undefined ? b.soc_percent : (b.battery_level !== undefined ? b.battery_level : null));
    
    if (rawPct !== null && rawPct !== undefined && !isNaN(rawPct)) {
      let val = Number(rawPct);
      if (val <= 1.0 && val > 0.0) val *= 100.0;
      val = Math.max(0, Math.min(100, val));

      // Up to 2 decimal places without trailing zeros (e.g. 99.8%, 99.85%, 100%, 85%)
      let displayPct;
      if (val >= 99.95) {
        displayPct = "100";
      } else if (Number.isInteger(val)) {
        displayPct = val.toString();
      } else {
        const d2 = val.toFixed(2);
        displayPct = d2.endsWith('0') ? val.toFixed(1) : d2;
      }

      // Update header battery chip
      const pctEl = document.getElementById("battery-pct");
      const boltEl = document.getElementById("charging-bolt");
      if (pctEl) pctEl.textContent = `${displayPct}%`;
      if (boltEl) boltEl.style.display = isCharging ? "inline" : "none";

      // Update full-screen charging overlay if visible
      const chargingScreen = document.getElementById("screen-charging");
      const chargingPct = document.getElementById("charging-screen-pct");
      if (chargingPct) chargingPct.textContent = `${displayPct}%`;

      // Truly full only when >= 99.95% or hardware reports full and not charging current
      const isFull = (val >= 99.95 && (!isCharging || (b.current !== undefined && b.current < 0.1))) ||
                     b.status === "Full" || b.status === "full" || b.status === "completed" ||
                     b.power_supply_status === "Full" || b.power_supply_status === 4;

      const chargingStateText = document.getElementById("charging-state-text");
      const chargingInfoDesc = document.getElementById("charging-info-desc");
      if (chargingStateText) {
        chargingStateText.textContent = isFull ? "CHARGING COMPLETED" : (val > 80 ? "BALANCING / TOP-UP" : "FAST CHARGING");
      }
      if (chargingInfoDesc) {
        chargingInfoDesc.textContent = isFull
          ? "Battery is fully charged (100%). Robot is ready for operations."
          : `Robot is locked on dock and actively charging (${displayPct}%).`;
      }

      // Auto-display charging screen when docked and charging
      if (isCharging && !wasCharging) {
        wasCharging = true;
        chargingScreenDismissed = false;
        if (chargingScreen) chargingScreen.style.display = "flex";
        triggerFaceExpression("sleep");
      } else if (!isCharging && wasCharging) {
        // Robot undocked / disconnected
        wasCharging = false;
        chargingScreenDismissed = false;
        if (chargingScreen) chargingScreen.style.display = "none";
        triggerFaceExpression("wakeup");
      }

      // Update quick dock / undock buttons on dashboard bottom bar
      const quickDockBtn = document.getElementById("btn-quick-dock");
      const quickUndockBtn = document.getElementById("btn-quick-undock");
      if (quickDockBtn) {
        const isChargingOrFull = isCharging || isFull;
        if (isChargingOrFull) {
          quickDockBtn.classList.add("is-charging");
          const label = quickDockBtn.querySelector(".dock-quick-label");
          if (label) label.textContent = isFull ? "Docked (Full)" : "Docked";
          if (quickUndockBtn) quickUndockBtn.style.opacity = "1";
        } else {
          quickDockBtn.classList.remove("is-charging");
          const label = quickDockBtn.querySelector(".dock-quick-label");
          if (label) label.textContent = "Auto-Dock";
          if (quickUndockBtn) quickUndockBtn.style.opacity = "0.75";
        }
      }

      isRobotCharging = isCharging;
    }
  } catch (err) {
    console.warn("Power state update error:", err);
  }
}

window.dismissChargingScreen = function() {
  const chargingScreen = document.getElementById("screen-charging");
  if (chargingScreen) chargingScreen.style.display = "none";
  chargingScreenDismissed = true;
  setSwipeIndex(1); // Go to Dashboard
};

/* --------------------------------------------------------------------------
   7. Relocalization Prompt & Auto-Dismissal
   -------------------------------------------------------------------------- */
function checkRelocalizationRequired(stateData) {
  const modal = document.getElementById("modal-relocalization");
  if (!modal) return;

  const isLoc = !!(stateData && (stateData.is_localized || (stateData.localization && (stateData.localization.status === "LOCALIZED" || stateData.localization.status === "OK"))));
  const currentLoadedMap = (stateData && (stateData.map || stateData.current_map)) || activeMapName;
  const isNavActive = !!(stateData && stateData.mode === "navigation" && currentLoadedMap && currentLoadedMap !== "default");

  // Do not prompt relocalization modal over the charging screen while docked
  if (isRobotCharging || wasCharging) {
    if (modal.style.display === "flex") {
      modal.style.display = "none";
    }
    return;
  }

  // Auto-dismiss or keep hidden if robot is localized OR if Nav2 navigation mode is not active
  if (isLoc || !isNavActive) {
    if (modal.style.display === "flex") {
      modal.style.display = "none";
      if (isLoc && !isLocalized) {
        showToast("Robot successfully localized!");
        triggerFaceExpression("happy");
      }
    }
    isLocalized = isLoc;
    return;
  }

  isLocalized = false;

  // Only prompt when Nav2 navigation is active, a real map is loaded, robot is not yet localized, and not recently dismissed
  if (Date.now() < relocalizeDismissedUntil) return;

  const mapNameEl = document.getElementById("relocalize-map-name");
  if (mapNameEl) mapNameEl.textContent = currentLoadedMap;
  if (modal.style.display !== "flex") {
    modal.style.display = "flex";
  }
}

window.dismissRelocalizationModal = function() {
  const modal = document.getElementById("modal-relocalization");
  if (modal) modal.style.display = "none";
  relocalizeDismissedUntil = Date.now() + 60000; // Dismiss for 1 minute
};


/* --------------------------------------------------------------------------
   18. Telemetry Polling Loop
   -------------------------------------------------------------------------- */
function startPolling() {
  const poll = async () => {
    try {
      // 1. Robot state
      const stateRes = await fetch(`${API_BASE}/api/v1/state`);
      let stateData = null;
      if (stateRes.ok) {
        stateData = await stateRes.json();
        const stateText = document.getElementById("state-text");
        if (stateText) stateText.textContent = (stateData.mode || stateData.state || "IDLE").toUpperCase();

        const robotIp = document.getElementById("robot-ip");
        if (robotIp) robotIp.textContent = stateData.ip || (window.location.hostname || "127.0.0.1");

        // Immediately update battery from state if present
        if (stateData.battery) {
          updatePowerState(stateData.battery);
        }

        // Keep liveRobotPose synchronized for map viewer & lidar rendering
        if (stateData.localization && stateData.localization.x != null && stateData.localization.y != null) {
          liveRobotPose = {
            x: stateData.localization.x,
            y: stateData.localization.y,
            yaw: stateData.localization.yaw != null ? stateData.localization.yaw : 0
          };
          isLocalized = stateData.localization.status === "LOCALIZED";
          const viewerScreen = document.getElementById("screen-map-viewer");
          if (viewerScreen && viewerScreen.style.display !== "none") {
            requestViewerRender();
          }
        }

        // Check if relocalization popup is required or needs auto-dismissal
        checkRelocalizationRequired(stateData);

        // Auto-sync active map when changed from ANY API or screen
        const serverMapName = getActiveMapFromState(stateData);
        if (serverMapName && serverMapName !== activeMapName) {
          handleActiveMapChanged(serverMapName);
        }
      }

      // Parallelize status queries for maximum responsiveness and zero UI stutter
      const [navResult, batResult, misResult, uiResult, dockResult] = await Promise.allSettled([
        fetch(`${API_BASE}/api/v1/navigation/status`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/state/battery`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/missions/status`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/missions/active_ui_interaction`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/dock/status`).then(r => r.ok ? r.json() : null)
      ]);

      // Determine if a mission workflow is actively running
      const isMissionActive = !!(
        (misResult.status === "fulfilled" && misResult.value && 
         ["running", "waiting_for_user", "paused", "charging_paused"].includes(misResult.value.state)) ||
        ["running", "waiting_for_user"].includes(activeMissionState)
      );

      // 1. Navigation Progress Screen (auto-appears for any nav goal, guarded against mission mode collision)
      if (navResult.status === "fulfilled" && navResult.value) {
        updateNavigationState(navResult.value, isMissionActive);
      } else if (stateData && stateData.navigation) {
        const isStateNav = stateData.navigation.status === "active";
        updateNavigationState({ is_navigating: isStateNav }, isMissionActive);
      }

      // 2. Battery & Power
      if (batResult.status === "fulfilled" && batResult.value) {
        updatePowerState(batResult.value);
      }

      // 3. Missions Status
      if (misResult.status === "fulfilled" && misResult.value) {
        updateMissionExecutionScreen(misResult.value);
      }

      // 4. Interactive UI Node
      if (uiResult.status === "fulfilled" && uiResult.value) {
        const rawUi = uiResult.value;
        const interaction = rawUi.interaction || rawUi.active_interaction || (rawUi.interaction_id ? rawUi : null);
        if (interaction && interaction.interaction_id) {
          if (interaction.interaction_id !== activeInteractionId) {
            handleActiveInteraction(interaction);
          }
        } else if (activeInteractionId) {
          dismissActiveInteraction();
        }
      } else if (activeInteractionId) {
        dismissActiveInteraction();
      }

      // 5. Docking / Undocking Progress Screen (dynamically appears and auto-hides when done/canceled)
      const dockData = dockResult.status === "fulfilled" ? dockResult.value : null;
      updateDockingScreen(dockData, stateData, isMissionActive);

      // 6. Wi-Fi & IP (debounced to every 10 seconds)
      if (!window._lastWifiCheck || Date.now() - window._lastWifiCheck > 10000) {
        window._lastWifiCheck = Date.now();
        fetchWifiStatus();
      }

    } catch (e) {
      // Offline / connecting
    }
  };

  window.triggerFastTelemetryPoll = () => {
    poll();
  };

  poll();
  // Poll faster (800ms) for snappy UI updates
  setInterval(poll, 800);

  // Connect WebSocket for instant zero-latency event reactivity
  initSdkEventsWebSocket();

  // Check for app software updates 5 seconds after boot
  setTimeout(() => checkAppUpdates(true), 5000);
}

function initSdkEventsWebSocket() {
  let ws = null;
  let reconnectTimer = null;

  const connect = () => {
    try {
      const host = window.location.hostname || "127.0.0.1";
      ws = new WebSocket(`ws://${host}:8090/api/v1/events`);

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({
            action: "subscribe",
            streams: ["events"]
          }));
        } catch (e) {}
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.stream === "events" && msg.data) {
            const ev = msg.data.event;
            const data = msg.data.data;

            if (ev === "mission.started") {
              const missionScreen = document.getElementById("screen-mission-progress");
              if (missionScreen) missionScreen.style.display = "flex";
              activeMissionState = "running";
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mission.ui_interaction" && data) {
              handleActiveInteraction(data);
            } else if (ev === "mission.ui_interaction_dismissed") {
              dismissActiveInteraction();
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mission.completed" || ev === "mission.canceled" || ev === "mission.failed") {
              activeMissionState = "idle";
              window.triggerFastTelemetryPoll?.();
            } else if (ev && (ev.startsWith("dock.") || ev.startsWith("navigation."))) {
              window.triggerFastTelemetryPoll?.();
            }
          }
        } catch (err) {}
      };

      ws.onclose = () => {
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 3000);
        }
      };

      ws.onerror = () => {
        try { ws.close(); } catch (e) {}
      };
    } catch (err) {
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 3000);
      }
    }
  };

  connect();
}


