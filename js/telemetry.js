// NavPro Mini - Telemetry, Navigation/Docking Watcher & Polling

/* --------------------------------------------------------------------------
   6. Navigation Progress & Auto-Charging Watcher
   -------------------------------------------------------------------------- */
let onScreenNavInitiated = false;
let previousDockOperation = "idle";
let cachedWaypoints = [];
window.cachedWaypoints = cachedWaypoints;

async function refreshCachedWaypoints() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/waypoints`);
    if (res.ok) {
      const data = await res.json();
      cachedWaypoints = data.waypoints || [];
      window.cachedWaypoints = cachedWaypoints;
    }
  } catch (e) {
    // ignore
  }
}
window.refreshCachedWaypoints = refreshCachedWaypoints;
refreshCachedWaypoints();

function updateNavigationState(navData, isMissionActive = false) {
  if (!navData) return;
  try {
    const isNav = !!(navData.state === "active" || navData.is_navigating || navData.status === "navigating" || navData.status === "executing");
    const wasNav = isNavigating;
    isNavigating = isNav;

    if (isNav) {
      const cs = document.getElementById("screen-charging");
      if (cs && cs.style.display !== "none") {
        cs.style.display = "none";
        chargingScreenDismissed = true;
      }
      wasCharging = false;
      isRobotCharging = false;
      const bolt = document.getElementById("charging-bolt");
      if (bolt) bolt.style.display = "none";
    }

    const navScreen = document.getElementById("screen-nav-progress");
    if (!navScreen) return;

    // DND Screen guard: if media player / DND screen is active, NEVER show navigation popup!
    if (window.isDndActive) {
      if (navScreen.style.display === "flex") {
        navScreen.style.display = "none";
      }
      return;
    }

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
        if (typeof navData.target === "string" && navData.target.trim()) {
          targetName = navData.target.trim();
        } else if (navData.target_waypoint) {
          targetName = navData.target_waypoint;
        } else if (navData.target && typeof navData.target === "object") {
          if (navData.target.waypoint) {
            targetName = navData.target.waypoint;
          } else if (navData.target.name) {
            targetName = navData.target.name;
          } else if (navData.target.x !== undefined && navData.target.y !== undefined) {
            const tx = Number(navData.target.x);
            const ty = Number(navData.target.y);
            const matchedWp = (cachedWaypoints || []).find(w => Math.hypot(w.x - tx, w.y - ty) < 0.5);
            targetName = matchedWp && matchedWp.name ? matchedWp.name : `Location (${tx.toFixed(1)}, ${ty.toFixed(1)})`;
          }
        }
        if (!targetName) targetName = "Target Location";
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
  const cameraImg = document.getElementById("dock-camera-preview-img");
  if (!cameraImg) return;

  // Use persistent MJPEG stream for high frame rate, zero JS loop overhead
  cameraImg.src = `${API_BASE}/api/v1/dock/stream.mjpg`;
  cameraImg.onerror = () => {
    if (!dockCamPollActive) return;
    cameraImg.onerror = null;
    pollNextDockFrame();
  };
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
    const delay = Math.max(10, 40 - elapsed);
    dockCamPollTimer = setTimeout(pollNextDockFrame, delay);
  };
  img.onerror = () => {
    if (!dockCamPollActive) return;
    dockCamPollTimer = setTimeout(pollNextDockFrame, 250);
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
  if (cameraImg) {
    cameraImg.onerror = null;
    cameraImg.src = "";
  }
}

function updateDockingScreen(dockData, stateData, isMissionActive = false) {
  const dockScreen = document.getElementById("screen-docking-progress");
  if (!dockScreen) return;

  const dockOp = (dockData && dockData.operation) ||
                 (stateData && stateData.dock && stateData.dock.operation) ||
                 "idle";

  // Mission mode guard: during mission execution, mission progress screen displays the dock node
  if (isMissionActive) {
    if (dockScreen.style.display !== "none") {
      dockScreen.style.display = "none";
    }
    stopDockCamStream();
    previousDockOperation = dockOp;
    return;
  }

  const isCharging = !!(
    (dockData && dockData.charging) ||
    (stateData && (
      (stateData.dock && stateData.dock.charging) ||
      (stateData.battery && stateData.battery.charging)
    ))
  );

  const isDockComplete = dockOp === "docked" || dockOp === "succeeded";
  const isDockActive = (dockOp === "docking" || dockOp === "searching" || dockOp === "servo" || dockOp === "staging" || dockOp === "navigating" || dockOp === "approaching" || dockOp === "aligning") && !isDockComplete;
  const isUndockActive = (dockOp === "undocking") && !isDockComplete;

  const titleEl = document.getElementById("dock-progress-title");
  const subEl = document.getElementById("dock-progress-subtitle");
  const markerEl = document.getElementById("dock-marker-icon");
  const cancelBtn = document.getElementById("btn-cancel-docking");
  const cameraCard = document.getElementById("dock-camera-card");
  const tagStatusEl = document.getElementById("dock-camera-tag-status");
  const radarAnim = document.getElementById("docking-target-animation");
  const isVoiceAssistantActive = Boolean(
    (typeof currentSwipeIndex !== "undefined" && currentSwipeIndex === 3) ||
    document.getElementById("subpage-voice")?.classList.contains("active")
  );

  if (isDockActive) {
    if (!isVoiceAssistantActive && dockScreen.style.display !== "flex") dockScreen.style.display = "flex";
    if (isVoiceAssistantActive && dockScreen.style.display !== "none") dockScreen.style.display = "none";
    if (cameraCard) cameraCard.style.display = "none";
    if (radarAnim) radarAnim.style.display = "flex";

    // Camera preview disabled on UI per user request
    stopDockCamStream();

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
  } else if (isUndockActive) {
    if (!isVoiceAssistantActive && dockScreen.style.display !== "flex") dockScreen.style.display = "flex";
    if (isVoiceAssistantActive && dockScreen.style.display !== "none") dockScreen.style.display = "none";
    if (cameraCard) cameraCard.style.display = "none";
    if (radarAnim) radarAnim.style.display = "flex";
    stopDockCamStream();

    if (titleEl) titleEl.textContent = "Disengaging from Charger";
    if (subEl) subEl.textContent = "Backing away smoothly from charging dock to staging area...";
    if (markerEl) markerEl.textContent = "⚡";
    if (cancelBtn) cancelBtn.textContent = "Cancel Undock";
  } else {
    // Docking/undocking idle, completed, or failed -> disconnect camera and auto-hide
    stopDockCamStream();
    if (dockScreen.style.display !== "none") {
      dockScreen.style.display = "none";
      if (previousDockOperation === "docking") {
        if (isDockComplete) {
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

let lastSeenChargingTs = 0;
let lastSeenDockedTs = 0;
let wasDockedOrCharging = false;

function updatePowerState(pState) {
  if (!pState) return;
  try {
    const isMovingOrNav = Boolean(isNavigating || (typeof liveLinearSpeed !== "undefined" && Math.abs(liveLinearSpeed) > 0.02));
    if (isMovingOrNav) {
      const cs = document.getElementById("screen-charging");
      if (cs && cs.style.display !== "none") cs.style.display = "none";
      const bolt = document.getElementById("charging-bolt");
      if (bolt) bolt.style.display = "none";
      isRobotCharging = false;
      wasCharging = false;
      wasDockedOrCharging = false;
      lastSeenChargingTs = 0;
      lastSeenDockedTs = 0;
      sessionStorage.removeItem("navpro_charging_dismissed");
      chargingScreenDismissed = false;
      return;
    }

    if (pState.age_sec !== undefined && pState.age_sec > 10.0) {
      return;
    }

    const b = pState.data || pState.battery || pState;
    const notCharging = b.status === "discharging" || b.power_supply_status === 2;
    const isActivelyCharging = !notCharging && Boolean(
      (b.charging && b.charging !== "false") ||
      b.status === "charging" ||
      b.status === "Charging" ||
      b.power_supply_status === 1 ||
      (pState.detail && pState.detail.charger_connected && pState.detail.charge_state !== "discharging")
    );

    const rawPct = b.percentage !== undefined ? b.percentage : (b.soc_percent !== undefined ? b.soc_percent : (b.battery_level !== undefined ? b.battery_level : null));
    let val = 0;
    if (rawPct !== null && rawPct !== undefined && !isNaN(rawPct)) {
      val = Number(rawPct);
      if (val <= 1.0 && val > 0.0) val *= 100.0;
      val = Math.max(0, Math.min(100, val));
    }

    // Battery full / topped off at charging dock
    const isFullAtDock = (val >= 99.0 || b.status === "full" || b.status === "Full" || b.status === "completed" || b.power_supply_status === 4) && !notCharging;

    const now = Date.now();
    if (isActivelyCharging || isFullAtDock) {
      lastSeenChargingTs = now;
      lastSeenDockedTs = now;
    }

    // Debounce: Stay "docked/charging" through float charging cutoffs (up to 8s) unless robot moved
    const isDockedOrCharging = (now - lastSeenDockedTs < 8000) && !isMovingOrNav;

    if (rawPct !== null && rawPct !== undefined && !isNaN(rawPct)) {
      // Up to 2 decimal places without trailing zeros (e.g. 99.8%, 100%, 85%)
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
      if (boltEl) boltEl.style.display = isDockedOrCharging ? "inline" : "none";

      // Update Power Subpage gauge and stats if present
      const gaugePctEl = document.getElementById("gauge-battery-pct");
      if (gaugePctEl) gaugePctEl.textContent = `${displayPct}%`;

      const circProgressEl = document.getElementById("circular-progress");
      if (circProgressEl) {
        circProgressEl.style.setProperty("--pct", val);
        const colorVar = val < 20 ? 'var(--danger, #ef4444)' : (val < 40 ? 'var(--warning, #f59e0b)' : 'var(--success, #10b981)');
        circProgressEl.style.background = `conic-gradient(${colorVar} ${val}%, var(--surface-sunken) 0)`;
      }

      // Update full-screen charging overlay if visible
      const chargingScreen = document.getElementById("screen-charging");
      const chargingPct = document.getElementById("charging-screen-pct");
      if (chargingPct) chargingPct.textContent = `${displayPct}%`;

      const isFull = isDockedOrCharging && (val >= 99.0 || b.status === "Full" || b.status === "full" || b.power_supply_status === 4);

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

      const setupScreen = document.getElementById("screen-setup");
      const isSetupActive = setupScreen && setupScreen.style.display === "flex";
      const isVoiceAssistantActive = Boolean(
        (typeof currentSwipeIndex !== "undefined" && currentSwipeIndex === 3) ||
        document.getElementById("subpage-voice")?.classList.contains("active")
      );

      // Auto-display charging screen ONLY when transitioning into docked charging (and not in setup or voice assistant)
      if (isSetupActive || isVoiceAssistantActive) {
        if (chargingScreen && chargingScreen.style.display !== "none") {
          chargingScreen.style.display = "none";
        }
      } else if (isDockedOrCharging && !wasDockedOrCharging) {
        wasDockedOrCharging = true;
        wasCharging = true;
        const isDismissed = chargingScreenDismissed || (sessionStorage.getItem("navpro_charging_dismissed") === "true");
        if (!isDismissed) {
          if (chargingScreen) chargingScreen.style.display = "flex";
          triggerFaceExpression("sleep");
        }
      } else if (!isDockedOrCharging && wasDockedOrCharging) {
        // Robot truly undocked and disconnected from dock
        wasDockedOrCharging = false;
        wasCharging = false;
        chargingScreenDismissed = false;
        sessionStorage.removeItem("navpro_charging_dismissed");
        if (chargingScreen) chargingScreen.style.display = "none";
        triggerFaceExpression("wakeup");
      }

      // If user dismissed it or setup is active, ensure it stays hidden
      if (isSetupActive || chargingScreenDismissed || sessionStorage.getItem("navpro_charging_dismissed") === "true") {
        if (chargingScreen && chargingScreen.style.display !== "none") {
          chargingScreen.style.display = "none";
        }
      }

      // Keep static text Dock and Undock on dashboard bottom bar
      const quickDockBtn = document.getElementById("btn-quick-dock");
      if (quickDockBtn) {
        if (isDockedOrCharging) {
          quickDockBtn.classList.add("is-charging");
        } else {
          quickDockBtn.classList.remove("is-charging");
        }
      }

      isRobotCharging = isDockedOrCharging;
    }
  } catch (err) {
    console.warn("Power state update error:", err);
  }
}

window.dismissChargingScreen = function() {
  const chargingScreen = document.getElementById("screen-charging");
  if (chargingScreen) chargingScreen.style.display = "none";
  chargingScreenDismissed = true;
  sessionStorage.setItem("navpro_charging_dismissed", "true");
  if (typeof showDashboardView === "function") {
    showDashboardView();
  } else {
    setSwipeIndex(0); // Go to Dashboard
  }
};

/* --------------------------------------------------------------------------
   7. Relocalization Prompt & Auto-Dismissal
   -------------------------------------------------------------------------- */
let wasPreviouslyLocalized = false;

function checkRelocalizationRequired(stateData) {
  const modal = document.getElementById("modal-relocalization");
  if (!modal) return;

  const isLoc = !!(stateData && (stateData.is_localized || (stateData.localization && (stateData.localization.status === "LOCALIZED" || stateData.localization.status === "OK"))));
  const currentLoadedMap = (stateData && (stateData.map || stateData.current_map)) || activeMapName;
  const isNavActive = !!(stateData && stateData.mode === "navigation" && currentLoadedMap && currentLoadedMap !== "default");

  // If robot was previously localized and now loses localization (wheel drift, kidnapping, slip),
  // immediately clear the dismissal timer so the relocalization popup triggers again without delay!
  if (wasPreviouslyLocalized && !isLoc && isNavActive) {
    console.warn("[Telemetry] Robot mislocalization detected! Resetting dismissal to trigger prompt.");
    relocalizeDismissedUntil = 0;
  }
  wasPreviouslyLocalized = isLoc;

  // Do not prompt relocalization modal over the charging screen while actively charging
  if (isRobotCharging) {
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
  relocalizeDismissedUntil = Date.now() + 60 * 1000; // Dismiss for 1 minute (or until mislocalization detected)
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
        if (robotIp) {
          if (stateData.ip && !stateData.ip.startsWith("127.")) {
            robotIp.textContent = stateData.ip;
          } else if (window.cachedRobotIp) {
            robotIp.textContent = window.cachedRobotIp;
          }
        }

        // Battery update is handled once per loop from full state/battery call below

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

        // 1. Sync SLAM Mapping live screen with robot mode
        const mappingScreen = document.getElementById("screen-mapping-live");
        const setupLoadingOverlay = document.getElementById("setup-loading-overlay");
        if (stateData.mode === "mapping") {
          if (setupLoadingOverlay) setupLoadingOverlay.style.display = "none";
          if (!mappingScreen || mappingScreen.style.display !== "flex") {
            window.enterMappingLiveScreen?.();
          }
        } else {
          if (mappingScreen && mappingScreen.style.display === "flex") {
            window.exitMappingLiveScreen?.();
          }
        }

        // 2. Sync Setup Wizard screen with backend setup state
        const setupScreen = document.getElementById("screen-setup");
        if (setupScreen && setupScreen.style.display === "flex") {
          // If mapping is starting/transitioning from mobile app or externally, show loading overlay immediately
          if (stateData.target_mode === "mapping" || (stateData.mode_busy && (stateData.target_mode === "mapping" || stateData.mode === "idle"))) {
            if (setupLoadingOverlay && setupLoadingOverlay.style.display !== "flex") {
              const title = document.getElementById("setup-loading-title");
              const sub = document.getElementById("setup-loading-sub");
              if (title) title.textContent = "Starting SLAM Mapping...";
              if (sub) {
                sub.textContent = "";
                sub.style.display = "none";
              }
              setupLoadingOverlay.style.display = "flex";
            }
          }

          // If Wi-Fi is actively connecting, show connecting banner immediately
          const banner = document.getElementById("wifi-connection-banner");
          const bannerTitle = document.getElementById("wifi-banner-title");
          const bannerSub = document.getElementById("wifi-banner-sub");
          if (stateData.lifecycle === "WIFI_CONNECTING" || stateData.wifi_connecting) {
            if (banner && banner.style.display !== "flex") {
              banner.style.display = "flex";
              banner.className = "wifi-connection-banner connecting";
              if (bannerTitle) bannerTitle.textContent = "Connecting to Wi-Fi...";
              if (bannerSub) bannerSub.textContent = "Associating with network and obtaining IP address...";
            }
          }

          const isHotspot = Boolean(stateData.hotspot_active || (stateData.ip && stateData.ip.startsWith("10.42.")));
          if (!isHotspot && stateData.setup) {
            const dismissedAtMs = (stateData.setup.dismissed_at || 0) * 1000;
            const startTime = window.setupSessionStartTime || 0;
            if ((stateData.setup.dismissed || stateData.setup.completed) && dismissedAtMs > startTime) {
              window.isSetupManuallyOpen = false;
              window.dismissSetupScreen?.(false);
              window.showDashboardView?.();
            } else if (stateData.setup.step === 2) {
              const step1 = document.getElementById("setup-step-1");
              if (step1 && step1.classList.contains("active")) {
                window.advanceSetupToStep?.(2);
              }
            }
          }
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

      // 2. Battery & Power (single authoritative update per loop)
      if (batResult.status === "fulfilled" && batResult.value) {
        updatePowerState(batResult.value);
      } else if (stateData && stateData.battery) {
        updatePowerState(stateData.battery);
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
        } else if (activeInteractionId && (!window.isMediaFullscreenActive || !window.isMediaFullscreenActive()) && (!window.isBrowserActive || !window.isBrowserActive())) {
          dismissActiveInteraction();
        }
      } else if (activeInteractionId && (!window.isMediaFullscreenActive || !window.isMediaFullscreenActive()) && (!window.isBrowserActive || !window.isBrowserActive())) {
        dismissActiveInteraction();
      }

      // 5. Docking / Undocking Progress Screen (dynamically appears and auto-hides when done/canceled)
      const dockData = dockResult.status === "fulfilled" ? dockResult.value : null;
      updateDockingScreen(dockData, stateData, isMissionActive);

      // 6. Wi-Fi & Setup (polled every 1.5s during setup wizard, 10s otherwise)
      const isSetupVisible = document.getElementById("screen-setup")?.style.display === "flex";
      const wifiInterval = isSetupVisible ? 1500 : 10000;
      if (!window._lastWifiCheck || Date.now() - window._lastWifiCheck > wifiInterval) {
        window._lastWifiCheck = Date.now();
        fetchWifiStatus();
        window.checkAutoSetupScreen?.();
      }

      // 7. Cached Waypoints (debounced to every 20 seconds)
      if (!window._lastWpCheck || Date.now() - window._lastWpCheck > 20000) {
        window._lastWpCheck = Date.now();
        refreshCachedWaypoints();
      }

    } catch (e) {
      // Offline / connecting
    }
  };

  window.triggerFastTelemetryPoll = () => {
    poll();
  };

  poll();
  // Relaxed background poll interval (2000ms) with instant event-driven reactivity via WebSocket
  setInterval(poll, 2000);

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
              if (window.updateMissionExecutionScreen && data) {
                window.updateMissionExecutionScreen({
                  mission_id: data.mission_id,
                  mission_name: data.mission_name,
                  active_node_label: "Initializing routine...",
                  progress_pct: 0,
                  state: "running"
                });
              }
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mission.node_started" || ev === "mission.node_completed") {
              activeMissionState = "running";
              if (window.updateMissionExecutionScreen && data) {
                window.updateMissionExecutionScreen({
                  mission_id: data.mission_id,
                  mission_name: data.mission_name,
                  active_node_label: data.label,
                  active_node_type: data.node_type,
                  active_node: data.label || data.node_id,
                  progress_pct: data.progress_pct,
                  state: "running"
                });
              }
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mission.ui_interaction" && data) {
              handleActiveInteraction(data);
            } else if (ev === "mission.ui_interaction_dismissed") {
              dismissActiveInteraction();
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mission.paused") {
              activeMissionState = "paused";
              if (window.updateMissionExecutionScreen) {
                window.updateMissionExecutionScreen({
                  mission_id: data?.mission_id,
                  state: "paused"
                });
              }
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mission.resumed") {
              activeMissionState = "running";
              if (window.updateMissionExecutionScreen) {
                window.updateMissionExecutionScreen({
                  mission_id: data?.mission_id,
                  state: "running"
                });
              }
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mission.completed" || ev === "mission.canceled" || ev === "mission.failed") {
              activeMissionState = "idle";
              if (window.updateMissionExecutionScreen) {
                window.updateMissionExecutionScreen({
                  mission_id: data?.mission_id,
                  progress_pct: ev === "mission.completed" ? 100 : 0,
                  state: ev === "mission.completed" ? "completed" : "idle"
                });
              }
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mode.transitioning") {
              if (data?.target === "mapping") {
                const setupLoadingOverlay = document.getElementById("setup-loading-overlay");
                if (setupLoadingOverlay) {
                  const title = document.getElementById("setup-loading-title");
                  const sub = document.getElementById("setup-loading-sub");
                  if (title) title.textContent = "Starting SLAM Mapping...";
                  if (sub) {
                    sub.textContent = "";
                    sub.style.display = "none";
                  }
                  setupLoadingOverlay.style.display = "flex";
                }
              }
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mapping.started" || (ev === "mode.changed" && data?.mode === "mapping")) {
              const setupLoadingOverlay = document.getElementById("setup-loading-overlay");
              if (setupLoadingOverlay) setupLoadingOverlay.style.display = "none";
              window.enterMappingLiveScreen?.();
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "mode.changed" && data?.mode !== "mapping") {
              const setupLoadingOverlay = document.getElementById("setup-loading-overlay");
              if (setupLoadingOverlay) setupLoadingOverlay.style.display = "none";
              window.exitMappingLiveScreen?.();
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "wifi.connecting") {
              const setupLoadingOverlay = document.getElementById("setup-loading-overlay");
              if (setupLoadingOverlay) {
                const title = document.getElementById("setup-loading-title");
                const sub = document.getElementById("setup-loading-sub");
                if (title) title.textContent = "Connecting to Wi-Fi...";
                if (sub) sub.textContent = data?.ssid ? `Connecting robot to "${data.ssid}"...` : "Associating with network...";
                setupLoadingOverlay.style.display = "flex";
              }
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "wifi.connected") {
              const setupLoadingOverlay = document.getElementById("setup-loading-overlay");
              if (setupLoadingOverlay) {
                const title = document.getElementById("setup-loading-title");
                const sub = document.getElementById("setup-loading-sub");
                if (title) title.textContent = "Wi-Fi Connected!";
                if (sub) sub.textContent = data?.ssid ? `Successfully joined "${data.ssid}"` : "Joined network successfully";
                setTimeout(() => {
                  if (setupLoadingOverlay && setupLoadingOverlay.style.display === "flex") {
                    setupLoadingOverlay.style.display = "none";
                  }
                }, 1600);
              }
              window.fetchWifiStatus?.();
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "setup.dismissed") {
              window.isSetupManuallyOpen = false;
              window.dismissSetupScreen?.(false);
              window.showDashboardView?.();
              window.triggerFastTelemetryPoll?.();
            } else if (ev === "setup.updated" && data) {
              if (data.dismissed || data.completed) {
                window.isSetupManuallyOpen = false;
                window.dismissSetupScreen?.(false);
                window.showDashboardView?.();
              }
              window.fetchWifiStatus?.();
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


