// NavPro Mini - Onboard Robot Kiosk UI Controller (Main Shell)
// Modularized Architecture:
// - js/state.js       : Global State, Constants & Gesture Protections
// - js/clock.js       : Real-Time Clock
// - js/rive_face.js   : Rive Robot Face & Expressions
// - js/telemetry.js   : Telemetry, Navigation/Docking Watcher & Polling
// - js/keyboard.js    : GNOME Touch Keyboard & Swipeable Lists
// - js/map_viewer.js  : Map Viewer, Dock/Location Editor (Bidirectional Scrubber) & Waypoints
// - js/mapping.js     : SLAM Live Mapping & Scanning
// - js/missions.js    : Missions, Schedules & Dynamic UI Interactions
// - js/settings.js    : Setup Wizard, Wi-Fi, Updates & Health
// - app.js            : App Shell, Hub Navigation, Action Buttons & Bootstrap

/* --------------------------------------------------------------------------
   3. Horizontal Swiping Viewport & Navigation
   -------------------------------------------------------------------------- */
function initSwipeGestures() {
  const viewport = document.getElementById("swipe-viewport");
  const track = document.getElementById("swipe-track");
  if (!viewport || !track) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchDeltaX = 0;
  let isSwiping = false;

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchDeltaX = 0;
      isSwiping = false;
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy)) {
      isSwiping = true;
      touchDeltaX = dx;
    }
  }, { passive: true });

  viewport.addEventListener("touchend", (e) => {
    if (!isSwiping) return;
    isSwiping = false;
    const touchDeltaY = (e.changedTouches && e.changedTouches[0]) ? (e.changedTouches[0].clientY - touchStartY) : 0;
    if (Math.abs(touchDeltaX) > 40 && Math.abs(touchDeltaX) > Math.abs(touchDeltaY)) {
      if (touchDeltaX < 0) {
        setSwipeIndex(Math.min(2, currentSwipeIndex + 1));
      } else {
        setSwipeIndex(Math.max(0, currentSwipeIndex - 1));
      }
    }
  });

  // Mouse drag support
  let mouseStartX = 0;
  let isMouseDown = false;
  viewport.addEventListener("mousedown", (e) => {
    mouseStartX = e.clientX;
    isMouseDown = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (!isMouseDown) return;
    isMouseDown = false;
    const deltaX = e.clientX - mouseStartX;
    if (deltaX < -40) setSwipeIndex(Math.min(2, currentSwipeIndex + 1));
    if (deltaX > 40) setSwipeIndex(Math.max(0, currentSwipeIndex - 1));
  });

  // Explicit click handlers for navigation buttons
  document.getElementById("dash-swipe-to-shortcuts")?.addEventListener("click", () => setSwipeIndex(1));
  document.getElementById("dash-swipe-to-media")?.addEventListener("click", () => setSwipeIndex(2));

  // Keyboard navigation shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      setSwipeIndex(Math.min(2, currentSwipeIndex + 1));
    } else if (e.key === "ArrowLeft") {
      setSwipeIndex(Math.max(0, currentSwipeIndex - 1));
    } else if (e.key === "3" || e.key.toLowerCase() === "m") {
      setSwipeIndex(2);
    } else if (e.key === "2" || e.key.toLowerCase() === "s") {
      setSwipeIndex(1);
    } else if (e.key === "1" || e.key.toLowerCase() === "d") {
      setSwipeIndex(0);
    } else if (e.key === "Escape") {
      closeSubpage();
    }
  });
}

window.setSwipeIndex = function(index) {
  currentSwipeIndex = Math.max(0, Math.min(2, index));
  const track = document.getElementById("swipe-track");

  if (track) {
    track.classList.remove("show-dashboard");
    const offset = -(currentSwipeIndex * 100);
    track.style.transform = `translateX(${offset}vw)`;
    track.style.webkitTransform = `translateX(${offset}vw)`;
  }

  // Update header slide indicator pills
  for (let i = 0; i <= 2; i++) {
    const pill = document.getElementById(`pill-slide-${i}`);
    if (pill) pill.classList.toggle("active", i === currentSwipeIndex);
  }

  const dndPill = document.getElementById("dnd-indicator-pill");

  // DND Mode Management on Slide 2
  if (currentSwipeIndex === 2) {
    window.isDndActive = true;
    if (dndPill) dndPill.style.display = "inline-flex";

    // Mute/suppress any navigation popups, mission progress screens, and banners
    const navScreen = document.getElementById("screen-nav-progress");
    if (navScreen) navScreen.style.display = "none";
    const missionScreen = document.getElementById("screen-mission-progress");
    if (missionScreen) missionScreen.style.display = "none";
    const floatingBanner = document.getElementById("mission-floating-banner");
    if (floatingBanner) floatingBanner.style.display = "none";

    // Initialize/refresh media player
    if (window.initMediaPlayer) {
      window.initMediaPlayer();
    }
  } else {
    window.isDndActive = false;
    if (dndPill) dndPill.style.display = "none";

    // Close fullscreen preview and pause video playback when leaving media slide
    if (typeof window.closeFullscreenMedia === "function") {
      window.closeFullscreenMedia();
    }
  }

  if (currentSwipeIndex === 1 && window.refreshShortcuts) {
    window.refreshShortcuts();
  }

  // If switching slides, make sure subpages are closed
  closeSubpage();
};

window.showDashboardView = function() {
  closeSubpage();
  setSwipeIndex(0);
};

/* --------------------------------------------------------------------------
   4. Hub 2x2 Grid & Subpage Management
   -------------------------------------------------------------------------- */
function initHubTiles() {
  const bindTileAction = (tileId, subpageName) => {
    const tile = document.getElementById(tileId);
    if (!tile) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let hasMoved = false;

    tile.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
      hasMoved = false;
    });

    tile.addEventListener("pointermove", (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 20) {
        hasMoved = true;
      }
    });

    tile.addEventListener("pointerup", (e) => {
      const elapsed = Date.now() - startTime;
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (!hasMoved && dist < 25 && elapsed < 800) {
        openSubpage(subpageName);
      }
    });

    tile.addEventListener("click", (e) => {
      e?.preventDefault();
      openSubpage(subpageName);
    });
  };

  bindTileAction("hub-tile-missions", "missions");
  bindTileAction("hub-tile-locations", "locations");
  bindTileAction("hub-tile-schedules", "schedules");
  bindTileAction("hub-tile-maps", "maps");

  document.getElementById("btn-trigger-test-popup")?.addEventListener("click", () => {
    showToast("Triggering interactive UI popup on robot screen...");
    handleActiveInteraction({
      interaction_id: "test_dynamic_" + Date.now(),
      target: "robot_screen",
      subtype: "form",
      title: "Patient Intake & Delivery Verification",
      message: "Please select department and review instructions before dispatch:",
      fields: [
        { key: "department", label: "Destination Department", type: "select", options: ["ICU - Room 402", "Emergency Ward B", "Cardiology Clinic", "Central Pharmacy"], required: true },
        { key: "notes", label: "Nurse / Attendant Notes", type: "text", default_value: "" },
        { key: "verified", label: "Medication Checked by Staff", type: "checkbox", default_value: true }
      ],
      timeout_sec: 60
    });
  });
}

let currentOpenSubpage = null;
let lastSubpageOpenTime = 0;

window.openSubpage = function(subpageName) {
  const now = Date.now();
  if (currentOpenSubpage === subpageName && now - lastSubpageOpenTime < 350) return;
  lastSubpageOpenTime = now;
  currentOpenSubpage = subpageName;

  const container = document.getElementById("subpages-viewport");
  if (!container) return;
  container.style.display = "flex";

  document.querySelectorAll(".tab-page").forEach(page => {
    page.classList.toggle("active", page.id === "tab-" + subpageName);
  });

  if (subpageName === "locations" && typeof loadWaypoints === "function") loadWaypoints();
  if (subpageName === "missions" && typeof loadMissions === "function") loadMissions();
  if (subpageName === "schedules" && typeof loadSchedules === "function") loadSchedules();
  if (subpageName === "maps" && typeof loadMaps === "function") loadMaps();
  if (subpageName === "power" && typeof loadPowerHealth === "function") loadPowerHealth();
};

window.closeSubpage = function() {
  currentOpenSubpage = null;
  const container = document.getElementById("subpages-viewport");
  if (container) container.style.display = "none";
};

window.switchTab = function(tabName) {
  openSubpage(tabName);
};

/* --------------------------------------------------------------------------
   5. Action Buttons & Header Controls
   -------------------------------------------------------------------------- */
function initActionButtons() {
  // Emergency Stop Button
  document.getElementById("btn-estop")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/motion/stop`, { method: "POST" });
      showToast("EMERGENCY STOP TRIGGERED!", true);
      triggerFaceExpression("afraid");
    } catch (e) {
      console.error("Estop error:", e);
    }
  });

  // Setup Button in Header
  document.getElementById("btn-open-setup")?.addEventListener("click", () => {
    openSetupScreen();
  });

  // Manual Docking Trigger on Power Subpage
  document.getElementById("btn-manual-dock-trigger")?.addEventListener("click", async () => {
    try {
      showToast("Starting auto-docking to charger...");
      await fetch(`${API_BASE}/api/v1/dock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ navigate_to_staging: true })
      });
    } catch (e) {
      showToast("Docking failed to start: " + e.message, true);
    }
  });

  // Charging Undock Button
  document.getElementById("btn-charging-undock")?.addEventListener("click", async () => {
    try {
      showToast("Undocking from charging station...");
      dismissChargingScreen();
      await fetch(`${API_BASE}/api/v1/undock`, { method: "POST" });
    } catch (e) {
      showToast("Undock failed: " + e.message, true);
    }
  });

  // Cancel Docking
  document.getElementById("btn-cancel-docking")?.addEventListener("click", async () => {
    try {
      showToast("Canceling dock operation...");
      stopDockCamStream();
      await fetch(`${API_BASE}/api/v1/dock/goal`, { method: "DELETE" });
      const dockScreen = document.getElementById("screen-docking-progress");
      if (dockScreen) dockScreen.style.display = "none";
      showToast("Dock operation canceled.");
    } catch (e) {
      console.warn("Cancel dock error:", e);
    }
  });

  // Cancel Navigation
  document.getElementById("btn-cancel-navigation")?.addEventListener("click", async () => {
    try {
      showToast("Canceling navigation goal...");
      await fetch(`${API_BASE}/api/v1/navigation/goal`, { method: "DELETE" });
      const navScreen = document.getElementById("screen-nav-progress");
      if (navScreen) navScreen.style.display = "none";
      showToast("Navigation canceled.");
    } catch (e) {
      console.warn("Cancel nav error:", e);
    }
  });

  // Shared Localize at Dock Helper (matches Desktop Mission Planner localizeAtDock)
  async function localizeAtDock() {
    let dock = null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/dock/pose`);
      if (res.ok) {
        const d = await res.json();
        if (d && d.data && typeof d.data.x === "number") {
          dock = d.data;
        }
      }
    } catch (e) {
      console.warn("Error fetching dock pose:", e);
    }

    if (!dock && (typeof viewerDockPose !== "undefined" && viewerDockPose)) {
      dock = viewerDockPose;
    }
    if (!dock && (typeof viewerNewDock !== "undefined" && viewerNewDock)) {
      dock = viewerNewDock;
    }

    if (!dock || typeof dock.x !== "number" || typeof dock.y !== "number") {
      throw new Error("No saved dock position found for this map");
    }

    const res = await fetch(`${API_BASE}/api/v1/navigation/localize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x: Number(dock.x),
        y: Number(dock.y),
        theta: Number(dock.theta || 0)
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || (err.error && err.error.message) || "Failed to set dock pose");
    }
    return dock;
  }
  window.localizeAtDock = localizeAtDock;

  // Relocalization Buttons
  document.getElementById("btn-relocalize-dock")?.addEventListener("click", async () => {
    try {
      showToast("Setting robot pose to charging dock...");
      await localizeAtDock();
      dismissRelocalizationModal();
      showToast("Initial pose set to charging dock.");
      triggerFaceExpression("happy");
    } catch (e) {
      showToast("Localization failed: " + e.message, true);
    }
  });

  document.getElementById("btn-relocalize-map")?.addEventListener("click", () => {
    dismissRelocalizationModal();
    const mapName = activeMapName || document.getElementById("relocalize-map-name")?.textContent;
    if (mapName && mapName !== "--") {
      openMapViewer(mapName);
      setTimeout(() => {
        if (window.startViewerLocalizeOnMap) {
          window.startViewerLocalizeOnMap();
        }
      }, 300);
    } else {
      showToast("Please load a map first from Maps.", true);
    }
  });

  document.getElementById("btn-relocalize-global")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/navigation/relocalize/global`, { method: "POST" });
      dismissRelocalizationModal();
      showToast("360° global lidar relocalization initiated...");
      triggerFaceExpression("curios");
    } catch (e) {
      showToast("Global relocalization failed: " + e.message, true);
    }
  });

  // Start Mapping from Maps Subpage (Shows Dock Instruction Modal)
  document.getElementById("btn-start-mapping")?.addEventListener("click", () => {
    openDockInstructionModal();
  });

  document.getElementById("btn-confirm-start-mapping")?.addEventListener("click", () => {
    closeDockInstructionModal();
    startSlamMapping();
  });

  // Save Location Button in Locations Subpage
  document.getElementById("btn-add-location")?.addEventListener("click", () => {
    if (!activeMapName) {
      showToast("No active map loaded. Load a map first to save locations.", true);
      return;
    }
    closeSubpage();
    openMapViewer(activeMapName, { mode: "save_location" });
  });
}


/* --------------------------------------------------------------------------
   17. General Modals & Toasts
   -------------------------------------------------------------------------- */
function initModals() {
  // Modal background dismiss click
  document.querySelectorAll(".modal-dialog").forEach(modal => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal && modal.id !== "modal-touch-keyboard") {
        modal.style.display = "none";
      }
    });
  });
}



// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initSwipeGestures();
  initHubTiles();
  initActionButtons();
  initSetupWizard();
  initMappingControls();
  initTouchKeyboard();
  initModals();
  startPolling();

  // Pre-load data lists immediately in background so subpages and counts are ready instantly
  if (typeof loadWaypoints === "function") loadWaypoints();
  if (typeof loadMissions === "function") loadMissions();
  if (typeof loadMaps === "function") loadMaps();
  if (typeof loadSchedules === "function") loadSchedules();

  // Auto-launch Setup Wizard if robot is unconfigured or in hotspot mode
  if (window.checkAutoSetupScreen) {
    window.checkAutoSetupScreen();
  }
  // Immediately fetch initial battery state
  fetch(`${API_BASE}/api/v1/state/battery`)
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) updatePowerState(d); })
    .catch(() => {});
});
