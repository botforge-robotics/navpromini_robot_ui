// NavPro Mini - Onboard Robot Kiosk UI Controller
// Connects to local navpromini_sdk server (port 8090)

// 1. Prevent browser-level pinch-to-zoom and gesture zooming across the entire kiosk
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => {
  window.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
});

window.addEventListener('touchstart', (e) => {
  if (e.touches.length > 1 && !e.target.closest('#map-viewer-canvas') && !e.target.closest('#mapping-live-canvas')) {
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !e.target.closest('#map-viewer-canvas') && !e.target.closest('#mapping-live-canvas')) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent double-tap zoom
let lastTouchEndTime = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEndTime <= 280) {
    if (!e.target.closest('input') && !e.target.closest('textarea')) {
      e.preventDefault();
    }
  }
  lastTouchEndTime = now;
}, { passive: false });

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
    e.preventDefault();
  }
  if (e.key === 'Escape') {
    if (typeof closeTouchKeyboard === 'function') closeTouchKeyboard(false);
  }
});

const API_BASE = window.location.port === "8090" 
  ? window.location.origin 
  : "http://" + (window.location.hostname || "127.0.0.1") + ":8090";

// State
let currentSwipeIndex = 0; // 0 = Face, 1 = Dashboard
let activeMapName = "";
let liveRobotPose = null; // { x, y, yaw }
let isLocalized = false;
let isRobotCharging = false;
let wasCharging = false;
let chargingScreenDismissed = false;
let isRobotDocking = false;
let isRobotUndocking = false;
let isNavigating = false;
let activeMissionId = null;
let activeMissionState = "idle";
let relocalizeDismissedUntil = 0;
let mappingStartTime = null;
let mappingTimerInterval = null;
let jogInterval = null;

// Rive Instance & Expression Inputs
let riveInstance = null;
let riveInputs = {};

// Touch Keyboard Callback
let touchKeyboardCallback = null;

// Dynamic Interaction State
let activeInteractionId = null;
let interactionTimerInterval = null;

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initRiveFace();
  initSwipeGestures();
  initHubTiles();
  initActionButtons();
  initSetupWizard();
  initMappingControls();
  initTouchKeyboard();
  initModals();
  startPolling();
  // Immediately fetch initial battery state
  fetch(`${API_BASE}/api/v1/state/battery`)
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) updatePowerState(d); })
    .catch(() => {});
});

/* --------------------------------------------------------------------------
   1. Real-Time Clock
   -------------------------------------------------------------------------- */
function initClock() {
  const clockEl = document.getElementById("clock-display");
  if (!clockEl) return;
  function update() {
    const now = new Date();
    clockEl.textContent = now.toTimeString().split(" ")[0];
  }
  update();
  setInterval(update, 1000);
}

/* --------------------------------------------------------------------------
   2. Rive Robot Face Animations (rio.riv)
   -------------------------------------------------------------------------- */
function initRiveFace() {
  const canvas = document.getElementById("rive-face-canvas");
  if (!canvas) return;

  // Enforce crisp 800x800 internal buffer dimensions matching device width
  canvas.width = 800;
  canvas.height = 800;

  try {
    if (typeof rive === "undefined" || !rive.Rive) {
      console.warn("Rive runtime not loaded, falling back to CSS face.");
      showFallbackFace();
      return;
    }

    riveInstance = new rive.Rive({
      src: "assets/rio.riv",
      canvas: canvas,
      autoplay: true,
      stateMachines: "expressions",
      onLoad: () => {
        console.log("Rive animation loaded successfully with crisp 1:1 aspect ratio!");
        window.riveInstance = riveInstance;
        try {
          const inputs = riveInstance.stateMachineInputs("expressions");
          if (inputs && inputs.length > 0) {
            inputs.forEach(input => {
              riveInputs[input.name] = input;
            });
            window.riveInputs = riveInputs;
            console.log("Registered Rive expression triggers:", Object.keys(riveInputs));
          }
          triggerFaceExpression("idle");
        } catch (err) {
          console.warn("Error enumerating Rive state machine inputs:", err);
        }
      },
      onError: (err) => {
        console.error("Rive canvas error:", err);
        showFallbackFace();
      }
    });

    window.riveInstance = riveInstance;

    // Touch / click on face gives random cute reaction
    canvas.addEventListener("click", () => {
      const reactions = ["happy", "curios", "blush", "surprise", "thinking"];
      const pick = reactions[Math.floor(Math.random() * reactions.length)];
      triggerFaceExpression(pick);
      showSpeechBubble(getRandomReactionQuote(pick));
    });

  } catch (e) {
    console.error("Failed to initialize Rive:", e);
    showFallbackFace();
  }
}

function showFallbackFace() {
  const fb = document.getElementById("fallback-face");
  const cv = document.getElementById("rive-face-canvas");
  if (fb) fb.style.display = "flex";
  if (cv) cv.style.display = "none";
}

window.triggerFaceExpression = function(name) {
  if (riveInputs[name]) {
    try {
      riveInputs[name].fire();
      console.log(`Triggered expression: ${name}`);
    } catch (e) {
      console.warn(`Failed to fire trigger ${name}:`, e);
    }
  } else {
    console.log(`Expression trigger '${name}' not found in Rive model.`);
  }
};

function showSpeechBubble(text, durationMs = 4000) {
  const bubble = document.getElementById("face-speech-bubble");
  const textEl = document.getElementById("face-speech-text");
  if (!bubble || !textEl) return;
  textEl.textContent = text;
  bubble.style.display = "flex";
  clearTimeout(bubble._timer);
  bubble._timer = setTimeout(() => {
    bubble.style.display = "none";
  }, durationMs);
}

function getRandomReactionQuote(type) {
  const quotes = {
    happy: ["Feeling great and ready to assist!", "Always happy to serve!", "Beep boop! Hello there!"],
    curios: ["Scanning local surroundings...", "What are we exploring next?", "Observing navigation obstacles."],
    blush: ["Thank you! You're very kind.", "Aww, glad to be working together!", "(＾▽＾)"],
    thinking: ["Computing optimal path trajectory...", "Processing environmental telemetry...", "Calculating next waypoint."],
    surprise: ["Oh! Something caught my lidar!", "Whoa, that was unexpected!", "Sensor alert!"]
  };
  const list = quotes[type] || ["Ready for missions!"];
  return list[Math.floor(Math.random() * list.length)];
}

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
      isSwiping = true;
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    if (!isSwiping || e.touches.length !== 1) return;
    touchDeltaX = e.touches[0].clientX - touchStartX;
  }, { passive: true });

  viewport.addEventListener("touchend", (e) => {
    if (!isSwiping) return;
    isSwiping = false;
    const touchDeltaY = (e.changedTouches && e.changedTouches[0]) ? (e.changedTouches[0].clientY - touchStartY) : 0;
    if (Math.abs(touchDeltaX) > 40 && Math.abs(touchDeltaX) > Math.abs(touchDeltaY)) {
      if (touchDeltaX < 0) {
        setSwipeIndex(1);
      } else {
        setSwipeIndex(0);
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
    if (deltaX < -40) setSwipeIndex(1);
    if (deltaX > 40) setSwipeIndex(0);
  });

  // Explicit click handlers for pill buttons
  document.getElementById("pill-btn-face")?.addEventListener("click", () => setSwipeIndex(0));
  document.getElementById("pill-btn-dashboard")?.addEventListener("click", () => setSwipeIndex(1));
  document.getElementById("face-swipe-to-dash")?.addEventListener("click", () => setSwipeIndex(1));
  document.getElementById("dash-swipe-to-face")?.addEventListener("click", () => setSwipeIndex(0));

  // Keyboard navigation shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "2" || e.key.toLowerCase() === "d") {
      setSwipeIndex(1);
    } else if (e.key === "ArrowLeft" || e.key === "1" || e.key.toLowerCase() === "f") {
      setSwipeIndex(0);
    } else if (e.key === "Escape") {
      closeSubpage();
    }
  });
}

window.setSwipeIndex = function(index) {
  currentSwipeIndex = index;
  const track = document.getElementById("swipe-track");
  const slideFace = document.getElementById("slide-face");
  const slideDash = document.getElementById("slide-dashboard");
  const pillFace = document.getElementById("pill-btn-face");
  const pillDash = document.getElementById("pill-btn-dashboard");

  if (track) {
    if (index === 1) {
      track.classList.add("show-dashboard");
      track.style.transform = "translateX(-100vw)";
      track.style.webkitTransform = "translateX(-100vw)";
    } else {
      track.classList.remove("show-dashboard");
      track.style.transform = "translateX(0vw)";
      track.style.webkitTransform = "translateX(0vw)";
    }
  }
  if (pillFace) pillFace.classList.toggle("active", index === 0);
  if (pillDash) pillDash.classList.toggle("active", index === 1);

  // If opening dashboard, make sure subpages are closed
  closeSubpage();
};

window.showDashboardView = function() {
  closeSubpage();
  setSwipeIndex(1);
};

/* --------------------------------------------------------------------------
   4. Hub 2x2 Grid & Subpage Management
   -------------------------------------------------------------------------- */
function initHubTiles() {
  let lastClickTime = 0;
  const debounce = (fn) => (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    const now = Date.now();
    if (now - lastClickTime < 400) return;
    lastClickTime = now;
    fn();
  };

  document.getElementById("hub-tile-missions")?.addEventListener("click", debounce(() => {
    openSubpage("missions");
  }));

  document.getElementById("hub-tile-locations")?.addEventListener("click", debounce(() => {
    openSubpage("locations");
  }));

  document.getElementById("hub-tile-schedules")?.addEventListener("click", debounce(() => {
    openSubpage("schedules");
  }));

  document.getElementById("hub-tile-maps")?.addEventListener("click", debounce(() => {
    openSubpage("maps");
  }));

  document.getElementById("btn-trigger-test-popup")?.addEventListener("click", debounce(() => {
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
  }));
}

let currentOpenSubpage = null;

function openSubpage(subpageName) {
  currentOpenSubpage = subpageName;
  const container = document.getElementById("subpages-viewport");
  if (!container) return;
  container.style.display = "flex";

  document.querySelectorAll(".tab-page").forEach(page => {
    page.classList.toggle("active", page.id === "tab-" + subpageName);
  });

  if (subpageName === "locations") loadWaypoints();
  if (subpageName === "missions") loadMissions();
  if (subpageName === "schedules") loadSchedules();
  if (subpageName === "maps") loadMaps();
  if (subpageName === "power") loadPowerHealth();
}

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
   8. Setup Wizard (Wi-Fi + Place Dock & Create Map)
   -------------------------------------------------------------------------- */
function initSetupWizard() {
  document.getElementById("btn-step2-continue")?.addEventListener("click", () => {
    advanceSetupToStep(2);
  });
  document.getElementById("btn-skip-mapping")?.addEventListener("click", () => {
    skipMappingSetup();
  });
  document.getElementById("btn-create-map-setup")?.addEventListener("click", () => {
    startMappingFromSetup();
  });
}

window.openSetupScreen = function() {
  const screen = document.getElementById("screen-setup");
  if (!screen) return;
  screen.style.display = "flex";
  advanceSetupToStep(1);
  fetchWifiStatus();
  scanWifiNetworks();
};

window.dismissSetupScreen = function() {
  const screen = document.getElementById("screen-setup");
  if (screen) screen.style.display = "none";
};

window.advanceSetupToStep = function(stepNum) {
  document.querySelectorAll(".setup-step-page").forEach(p => p.classList.remove("active"));
  const targetPage = document.getElementById(`setup-step-${stepNum}`);
  if (targetPage) targetPage.classList.add("active");

  const dot1 = document.getElementById("setup-dot-1");
  const dot2 = document.getElementById("setup-dot-2");
  const label = document.getElementById("setup-step-label");

  if (dot1) dot1.classList.toggle("active", stepNum === 1);
  if (dot2) dot2.classList.toggle("active", stepNum === 2);
  if (label) label.textContent = `Step ${stepNum} of 2`;
};

function sanitizeWifiSsid(ssid) {
  if (!ssid) return "";
  // Strip any netplan internal prefix like 'netplan-wlan0-' or 'netplan-'
  return String(ssid).replace(/^netplan-[a-zA-Z0-9_-]+-/, '').replace(/^netplan-/, '');
}

async function fetchWifiStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/system/wifi/status`);
    if (!res.ok) return;
    const data = await res.json();
    const nameEl = document.getElementById("wifi-current-name");
    const ipEl = document.getElementById("wifi-current-ip");
    const badgeEl = document.getElementById("wifi-connected-badge");
    const headerIp = document.getElementById("robot-ip");

    const cleanSsid = sanitizeWifiSsid(data.ssid);
    if (nameEl) {
      nameEl.textContent = cleanSsid || (data.connected ? "Connected Network" : "No Wi-Fi Connected");
    }
    const liveIp = data.ip || data.ip_address || "";
    if (ipEl) {
      ipEl.textContent = liveIp ? `IP Address: ${liveIp}` : (data.connected ? "Acquiring IP..." : "Offline");
    }
    if (badgeEl) {
      if (data.connected) {
        badgeEl.textContent = "Connected";
        badgeEl.className = "wifi-connected-pill connected";
      } else {
        badgeEl.textContent = "Disconnected";
        badgeEl.className = "wifi-connected-pill disconnected";
      }
    }
    if (headerIp && liveIp) {
      headerIp.textContent = liveIp;
    }
  } catch (e) {
    console.warn("Wi-Fi status error:", e);
  }
}

window.scanWifiNetworks = async function() {
  const list = document.getElementById("wifi-list-container");
  if (!list) return;
  list.innerHTML = `<div class="wifi-loading-box">Scanning nearby Wi-Fi networks...</div>`;

  try {
    const res = await fetch(`${API_BASE}/api/v1/system/wifi/scan`);
    const data = await res.json();
    const networks = data.networks || [];
    if (networks.length === 0) {
      list.innerHTML = `
        <div class="wifi-empty-box">
          <p>No Wi-Fi networks found.</p>
          <button class="btn btn-secondary btn-sm" onclick="scanWifiNetworks()">Scan Again</button>
        </div>`;
      return;
    }

    list.innerHTML = networks.map(net => {
      const rawSsid = net.raw_ssid || net.ssid;
      const displaySsid = sanitizeWifiSsid(net.ssid);
      const isSecured = net.protected !== false && (net.security && net.security !== "--");
      return `
        <div class="wifi-item" onclick="promptWifiConnect('${escapeQuotes(rawSsid)}', '${escapeQuotes(displaySsid)}')">
          <div class="wifi-item-left">
            <span class="wifi-signal-icon">${(net.signal || 50) >= 60 ? "📶" : "🛜"}</span>
            <div class="wifi-item-text">
              <span class="wifi-item-name">${escapeHtml(displaySsid)}</span>
              <span class="wifi-item-sec">${isSecured ? "Secured (" + (net.security || "WPA2") + ")" : "Open Network"}</span>
            </div>
          </div>
          <div class="wifi-item-meta">
            <span class="wifi-signal-pct">${net.signal || 50}%</span>
            <span class="wifi-lock-badge">${isSecured ? "🔒" : "🔓"}</span>
            <span class="wifi-connect-btn">Connect ➔</span>
          </div>
        </div>
      `;
    }).join("");
  } catch (e) {
    list.innerHTML = `<div class="wifi-empty-box"><p style="color: var(--danger);">Error scanning Wi-Fi: ${escapeHtml(e.message)}</p></div>`;
  }
};

window.promptWifiConnect = function(rawSsid, displaySsid) {
  const nameToShow = displaySsid || sanitizeWifiSsid(rawSsid);
  openTouchKeyboard(`Enter Password for "${nameToShow}":`, async (password) => {
    try {
      showToast(`Connecting to ${nameToShow}...`);
      const res = await fetch(`${API_BASE}/api/v1/system/wifi/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid: rawSsid, password: password })
      });
      const data = await res.json();
      if (data.status === "ok" || data.success) {
        showToast(`Connected to ${nameToShow}!`);
        fetchWifiStatus();
      } else {
        showToast(`Failed: ${data.message || "Connection error"}`, true);
      }
    } catch (e) {
      showToast(`Connect error: ${e.message}`, true);
    }
  });
};

window.openDockInstructionModal = function() {
  const modal = document.getElementById("modal-dock-instruction");
  if (modal) modal.style.display = "flex";
};

window.closeDockInstructionModal = function() {
  const modal = document.getElementById("modal-dock-instruction");
  if (modal) modal.style.display = "none";
};

window.skipMappingSetup = function() {
  dismissSetupScreen();
  showToast("Setup completed! Welcome to NavPro Mini.");
  setSwipeIndex(1); // Dashboard
};

window.startMappingFromSetup = function() {
  dismissSetupScreen();
  startSlamMapping();
};

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
      setSwipeIndex(1); // Return to Dashboard
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
        setSwipeIndex(1); // Return to Dashboard
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
let viewerEditorMode = null; // null, 'edit_dock', 'save_location'
let viewerDraftPose = null;  // { x, y, theta } for saving locations
let viewerIsAdjustingAngle = false;
let viewerDraggingHeading = false;
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

      // In save_location or localize mode: check rotation handle (56px from marker)
      if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraftPose) {
        const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
        const handleDist = 56;
        const hx = center.x + handleDist * Math.cos(-viewerDraftPose.theta);
        const hy = center.y + handleDist * Math.sin(-viewerDraftPose.theta);
        const distToHandle = Math.hypot(sx - hx, sy - hy);
        const distToCenter = Math.hypot(sx - center.x, sy - center.y);

        let isHandleTouch = distToHandle <= 48;
        if (!isHandleTouch && distToCenter >= 16 && distToCenter <= handleDist + 36) {
          const touchAngle = -Math.atan2(sy - center.y, sx - center.x);
          let diff = Math.abs(touchAngle - viewerDraftPose.theta);
          while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
          if (diff < 0.85) isHandleTouch = true;
        }

        if (isHandleTouch) {
          viewerDraggingHeading = true;
          isTouchPanning = false;
          return;
        }
      }
    } else if (e.touches.length === 2) {
      isTouchPanning = false;
      viewerDraggingHeading = false;

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

      // Rotating heading handle in save_location or localize mode
      if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraggingHeading && viewerDraftPose) {
        const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
        const dx = sx - center.x;
        const dy = sy - center.y;
        if (Math.hypot(dx, dy) > 8) {
          viewerDraftPose.theta = -Math.atan2(dy, dx);
          updateViewerEditorBarUI();
          requestViewerRender();
        }
        return;
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
    if (viewerDraggingHeading) {
      viewerDraggingHeading = false;
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
    if ((viewerEditorMode === "save_location" || viewerEditorMode === "localize") && viewerDraftPose) {
      const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
      const handleDist = 56;
      const hx = center.x + handleDist * Math.cos(-viewerDraftPose.theta);
      const hy = center.y + handleDist * Math.sin(-viewerDraftPose.theta);
      const distToHandle = Math.hypot(sx - hx, sy - hy);
      const distToCenter = Math.hypot(sx - center.x, sy - center.y);

      let isHandleTouch = distToHandle <= 48;
      if (!isHandleTouch && distToCenter >= 16 && distToCenter <= handleDist + 36) {
        const touchAngle = -Math.atan2(sy - center.y, sx - center.x);
        let diff = Math.abs(touchAngle - viewerDraftPose.theta);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
        if (diff < 0.85) isHandleTouch = true;
      }

      if (isHandleTouch) {
        viewerDraggingHeading = true;
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
    if (viewerDraggingHeading && viewerDraftPose) {
      const { sx, sy } = getCanvasPos(e);
      const center = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
      const dx = sx - center.x;
      const dy = sy - center.y;
      if (Math.hypot(dx, dy) > 8) {
        viewerDraftPose.theta = -Math.atan2(dy, dx);
        updateViewerEditorBarUI();
        requestViewerRender();
      }
      return;
    }
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
    if (viewerDraggingHeading) {
      viewerDraggingHeading = false;
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
  const promptEl = document.getElementById("editor-bar-prompt");
  const actionsEl = document.getElementById("map-viewer-editor-bar")?.querySelector(".editor-bar-actions");
  const btnAddLoc = document.getElementById("btn-viewer-add-location");
  const btnEditDock = document.getElementById("btn-viewer-edit-dock");
  const btnLocalize = document.getElementById("btn-viewer-localize");

  if (btnAddLoc) {
    const isSave = viewerEditorMode === "save_location";
    btnAddLoc.classList.toggle("active", isSave);
    if (isSave) {
      btnAddLoc.classList.remove("btn-secondary");
      btnAddLoc.classList.add("btn-primary");
    } else {
      btnAddLoc.classList.remove("btn-primary");
      btnAddLoc.classList.add("btn-secondary");
    }
  }

  if (btnEditDock) {
    const isDock = viewerEditorMode === "edit_dock";
    btnEditDock.classList.toggle("active", isDock);
    if (isDock) {
      btnEditDock.classList.remove("btn-secondary");
      btnEditDock.classList.add("btn-primary");
    } else {
      btnEditDock.classList.remove("btn-primary");
      btnEditDock.classList.add("btn-secondary");
    }
  }

  if (btnLocalize) {
    const isLocalize = viewerEditorMode === "localize";
    btnLocalize.classList.toggle("active", isLocalize);
    if (isLocalize) {
      btnLocalize.classList.remove("btn-secondary");
      btnLocalize.classList.add("btn-primary");
    } else {
      btnLocalize.classList.remove("btn-primary");
      btnLocalize.classList.add("btn-secondary");
    }
  }

  if (!editorBar || !promptEl || !actionsEl) return;

  if (!viewerEditorMode) {
    editorBar.style.display = "none";
    promptEl.innerHTML = "";
    actionsEl.innerHTML = "";
    return;
  }

  editorBar.style.display = "flex";

  if (viewerEditorMode === "save_location") {
    editorBar.className = "map-viewer-editor-bar mode-save-location";
    const snapBtn = liveRobotPose
      ? `<button type="button" class="btn btn-secondary btn-sm" onclick="snapDraftToRobot()" style="display:inline-flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/></svg>Snap to Robot</button>`
      : "";
    if (!viewerDraftPose) {
      promptEl.innerHTML = `📍 <strong>Save Location:</strong> Tap map to place location marker`;
    } else {
      const deg = Math.round((viewerDraftPose.theta || 0) * 180 / Math.PI);
      promptEl.innerHTML = `📍 <strong>Location Pose Set (${deg}°):</strong> Tap to move, drag ⟳ handle to rotate, then Save`;
    }
    actionsEl.innerHTML = `
      ${snapBtn}
      <button type="button" class="btn btn-secondary btn-sm" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="confirmViewerSaveLocation()">✓ Save Location</button>
    `;
  } else if (viewerEditorMode === "localize") {
    editorBar.className = "map-viewer-editor-bar mode-localize";
    const snapBtn = liveRobotPose
      ? `<button type="button" class="btn btn-secondary btn-sm" onclick="snapDraftToRobot()" style="display:inline-flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/></svg>Snap to Current</button>`
      : "";
    if (!viewerDraftPose) {
      promptEl.innerHTML = `🎯 <strong>Select on Map:</strong> Tap map to place estimated robot pose`;
    } else {
      const deg = Math.round((viewerDraftPose.theta || 0) * 180 / Math.PI);
      promptEl.innerHTML = `🎯 <strong>Estimate Set (${deg}°):</strong> Drag ⟳ handle to adjust heading, then Set Pose`;
    }
    actionsEl.innerHTML = `
      ${snapBtn}
      <button type="button" class="btn btn-secondary btn-sm" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="confirmViewerLocalize()">✓ Set Initial Pose</button>
    `;
  } else if (viewerEditorMode === "edit_dock") {
    editorBar.className = "map-viewer-editor-bar mode-edit-dock";
    if (viewerDockEditTarget === "dock") {
      promptEl.innerHTML = `⚡ <strong>Edit Dock:</strong> Tap map to place Charging Dock position`;
    } else {
      const dist = (viewerNewDock && viewerNewStandoff)
        ? ` (${Math.hypot(viewerNewStandoff.x - viewerNewDock.x, viewerNewStandoff.y - viewerNewDock.y).toFixed(2)}m)`
        : "";
      promptEl.innerHTML = `🎯 <strong>Edit Standoff:</strong> Tap map to place Standoff staging pose${dist}`;
    }

    const canUndo = viewerDockUndoStack.length > 0;
    actionsEl.innerHTML = `
      <div class="editor-segmented-group">
        <button type="button" class="editor-segmented-btn ${viewerDockEditTarget === 'dock' ? 'active' : ''}" onclick="setDockEditTarget('dock')">⚡ Dock</button>
        <button type="button" class="editor-segmented-btn ${viewerDockEditTarget === 'standoff' ? 'active' : ''}" onclick="setDockEditTarget('standoff')">🎯 Standoff</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" ${!canUndo ? 'disabled' : ''} onclick="undoViewerDock()">↩ Undo</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="saveViewerEditMode()">Save Changes</button>
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
   Danger & Action Confirmation Modal Helper
   -------------------------------------------------------------------------- */
let dangerConfirmCallback = null;

window.showDangerConfirmation = function({ title, message, confirmText = "Delete", isDanger = true, icon = "⚠️", onConfirm }) {
  const modal = document.getElementById("modal-danger-confirm");
  const tEl = document.getElementById("confirm-danger-title");
  const mEl = document.getElementById("confirm-danger-message");
  const bEl = document.getElementById("confirm-danger-badge");
  const cBtn = document.getElementById("btn-danger-confirm");
  if (!modal) return;

  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = message;
  if (bEl) bEl.textContent = icon;
  if (cBtn) {
    cBtn.textContent = confirmText;
    cBtn.className = isDanger ? "btn btn-danger btn-lg" : "btn btn-primary btn-lg";
  }
  dangerConfirmCallback = onConfirm;
  modal.style.display = "flex";
};

window.closeDangerConfirmation = function() {
  const modal = document.getElementById("modal-danger-confirm");
  if (modal) modal.style.display = "none";
  dangerConfirmCallback = null;
};

document.getElementById("btn-danger-confirm")?.addEventListener("click", () => {
  const cb = dangerConfirmCallback;
  closeDangerConfirmation();
  if (typeof cb === "function") cb();
});

/* --------------------------------------------------------------------------
   Touch-Friendly Slide-to-Delete Helper
   -------------------------------------------------------------------------- */
function makeSwipeable(containerEl) {
  if (!containerEl) return;
  const wrappers = containerEl.querySelectorAll(".swipeable-wrapper");

  wrappers.forEach(wrapper => {
    const content = wrapper.querySelector(".swipeable-content");
    if (!content || content._swipeInited) return;
    content._swipeInited = true;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let currentDx = 0;
    let isSwiping = false;
    let isScrolling = false;

    const resetOtherSwipes = () => {
      document.querySelectorAll(".swipeable-content.swiped-open").forEach(el => {
        if (el !== content) {
          el.style.transition = "transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)";
          el.style.transform = "translateX(0)";
          el.classList.remove("swiped-open");
          el.closest(".swipeable-wrapper")?.classList.remove("has-swipe-open", "is-swiping");
        }
      });
    };

    content.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("a")) return;
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
      currentDx = 0;
      isSwiping = false;
      isScrolling = false;
      content.style.transition = "none";
    });

    content.addEventListener("pointermove", (e) => {
      if (isScrolling) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!isSwiping && !isScrolling) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
          isScrolling = true;
          return;
        }
        if (Math.abs(dx) > 6) {
          isSwiping = true;
          wrapper.classList.add("is-swiping");
          resetOtherSwipes();
        }
      }

      if (isSwiping) {
        const baseOffset = content.classList.contains("swiped-open") ? -90 : 0;
        currentDx = Math.min(10, Math.max(-105, baseOffset + dx));
        content.style.transform = `translateX(${currentDx}px)`;
      }
    });

    const finishSwipe = (e) => {
      const elapsed = Math.max(1, Date.now() - startTime);
      const wasOpen = content.classList.contains("swiped-open");
      const totalDx = e.clientX - startX;
      const velocity = totalDx / elapsed;

      content.style.transition = "transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)";

      // Tap on open item snaps closed immediately
      if (!isSwiping && wasOpen && Math.hypot(totalDx, (e.clientY || startY) - startY) < 12) {
        content.style.transform = "translateX(0)";
        content.classList.remove("swiped-open");
        wrapper.classList.remove("has-swipe-open", "is-swiping");
        return;
      }

      if (!isSwiping) return;
      isSwiping = false;

      let shouldOpen = false;
      if (wasOpen) {
        // Drag right to close
        shouldOpen = !(totalDx > 20 || velocity > 0.2 || currentDx > -45);
      } else {
        // Drag left to open delete side
        shouldOpen = (totalDx < -25 || velocity < -0.22 || currentDx < -35);
      }

      if (shouldOpen) {
        content.style.transform = "translateX(-90px)";
        content.classList.add("swiped-open");
        wrapper.classList.add("has-swipe-open");
        wrapper.classList.remove("is-swiping");
      } else {
        content.style.transform = "translateX(0)";
        content.classList.remove("swiped-open");
        wrapper.classList.remove("has-swipe-open", "is-swiping");
      }
    };

    content.addEventListener("pointerup", finishSwipe);
    content.addEventListener("pointercancel", finishSwipe);
  });
}

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".swipeable-wrapper")) {
    document.querySelectorAll(".swipeable-content.swiped-open").forEach(el => {
      el.style.transition = "transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)";
      el.style.transform = "translateX(0)";
      el.classList.remove("swiped-open");
      el.closest(".swipeable-wrapper")?.classList.remove("has-swipe-open", "is-swiping");
    });
  }
});

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

/* --------------------------------------------------------------------------
   13. Missions Subpage & Execution Screen
   -------------------------------------------------------------------------- */
let loadedMissionsCache = [];

async function loadMissions() {
  const list = document.getElementById("missions-list");
  if (!list) return;
  list.innerHTML = `<div class="loading-spinner">Loading missions for "${activeMapName || 'active map'}"...</div>`;

  const misSub = document.getElementById("missions-map-subtitle");
  if (misSub) misSub.textContent = `Showing visual routines on "${activeMapName || 'all'}"`;

  try {
    const url = activeMapName
      ? `${API_BASE}/api/v1/missions?map=${encodeURIComponent(activeMapName)}`
      : `${API_BASE}/api/v1/missions`;
    const res = await fetch(url);
    const data = await res.json();
    let missions = data.missions || [];

    if (activeMapName) {
      missions = missions.filter(m => !m.map || m.map === activeMapName);
    }
    loadedMissionsCache = missions;

    const hubCount = document.getElementById("hub-missions-count");
    if (hubCount) hubCount.textContent = `${missions.length} Routines`;

    if (missions.length === 0) {
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No visual missions found for "${activeMapName || 'current map'}". Create missions using the desktop or mobile mission planner.</p>`;
      return;
    }

    list.innerHTML = missions.map(m => {
      const mId = m.id || m.name;
      const mName = m.name || m.id;
      return `
        <div class="swipeable-wrapper">
          <div class="swipe-delete-action">
            <button type="button" class="btn-swipe-delete" onclick="deleteMissionPrompt('${escapeQuotes(mId)}', '${escapeQuotes(mName)}')">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Delete</span>
            </button>
          </div>
          <div class="swipeable-content mission-item-card">
            <div class="mission-item-info" onclick="promptStartMission('${escapeQuotes(mId)}', '${escapeQuotes(mName)}')">
              <h3>${escapeHtml(mName)}</h3>
              <p>${escapeHtml(m.description || "Visual node workflow routine")}</p>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-primary btn-sm" onclick="promptStartMission('${escapeQuotes(mId)}', '${escapeQuotes(mName)}')">Launch Routine</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    makeSwipeable(list);
  } catch (e) {
    list.innerHTML = `<p style="color: var(--danger); padding: 16px;">Failed to load missions: ${escapeHtml(e.message)}</p>`;
  }
}

window.promptStartMission = function(missionId, missionName) {
  showDangerConfirmation({
    title: "Activate Mission",
    message: `Start autonomous execution for routine "${missionName}"? Ensure the surrounding workspace is clear.`,
    confirmText: "Start Mission",
    isDanger: false,
    icon: "🚀",
    onConfirm: () => startMission(missionId, missionName)
  });
};

window.startMission = async function(missionId, missionName) {
  try {
    showToast(`Starting mission "${missionName || missionId}"...`);
    const missionScreen = document.getElementById("screen-mission-progress");
    const titleEl = document.getElementById("mission-screen-title");
    const nodeEl = document.getElementById("mission-screen-node");
    if (titleEl) titleEl.textContent = missionName || missionId;
    if (nodeEl) nodeEl.textContent = "Initializing routine...";
    if (missionScreen) missionScreen.style.display = "flex";

    await fetch(`${API_BASE}/api/v1/missions/${encodeURIComponent(missionId)}/start`, { method: "POST" });
    activeMissionId = missionId;
    closeSubpage();
    triggerFaceExpression("happy");
  } catch (e) {
    const missionScreen = document.getElementById("screen-mission-progress");
    if (missionScreen) missionScreen.style.display = "none";
    showToast(`Failed to start mission: ${e.message}`, true);
  }
};

window.deleteMissionPrompt = function(missionId, missionName) {
  showDangerConfirmation({
    title: "Delete Mission",
    message: `Are you sure you want to permanently delete routine "${missionName}"? This action cannot be undone.`,
    confirmText: "Delete Mission",
    isDanger: true,
    icon: "🗑️",
    onConfirm: () => deleteMission(missionId, missionName)
  });
};

window.deleteMission = async function(missionId, missionName) {
  try {
    await fetch(`${API_BASE}/api/v1/missions/${encodeURIComponent(missionId)}`, { method: "DELETE" });
    showToast(`Routine "${missionName}" deleted.`);
    loadMissions();
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, true);
  }
};

function updateMissionExecutionScreen(mStatus) {
  const missionScreen = document.getElementById("screen-mission-progress");
  const floatingBanner = document.getElementById("mission-floating-banner");

  if (!mStatus || mStatus.state !== "running") {
    if (missionScreen) missionScreen.style.display = "none";
    if (floatingBanner) floatingBanner.style.display = "none";
    activeMissionState = "idle";
    return;
  }

  activeMissionState = "running";
  const title = mStatus.mission_name || mStatus.mission_id || "Active Mission";
  const activeNode = mStatus.active_node || mStatus.current_node || "In Progress";
  const progressPct = mStatus.progress_pct || 0;

  if (missionScreen && missionScreen.style.display !== "flex") {
    missionScreen.style.display = "flex";
  }

  const titleEl = document.getElementById("mission-screen-title");
  const nodeEl = document.getElementById("mission-screen-node");
  const fillEl = document.getElementById("mission-screen-fill");

  if (titleEl) titleEl.textContent = title;
  if (nodeEl) nodeEl.textContent = activeNode;
  if (fillEl) fillEl.style.width = `${progressPct}%`;
}

/* --------------------------------------------------------------------------
   14. Schedules Subpage & Editor Modal
   -------------------------------------------------------------------------- */
let editingScheduleId = null;
let scheduleSelectedDays = new Set([0, 1, 2, 3, 4]);

async function loadSchedules() {
  const list = document.getElementById("schedules-list");
  if (!list) return;
  list.innerHTML = `<div class="loading-spinner">Loading automated schedules for "${activeMapName || 'active map'}"...</div>`;

  const schedSub = document.getElementById("schedules-map-subtitle");
  if (schedSub) schedSub.textContent = `Showing automated timers on "${activeMapName || 'all'}"`;

  try {
    const url = activeMapName
      ? `${API_BASE}/api/v1/schedules?map=${encodeURIComponent(activeMapName)}`
      : `${API_BASE}/api/v1/schedules`;
    const res = await fetch(url);
    const data = await res.json();
    const schedules = data.schedules || [];

    const hubCount = document.getElementById("hub-schedules-count");
    if (hubCount) hubCount.textContent = `${schedules.length} Active`;

    if (schedules.length === 0) {
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No automated schedules configured for "${activeMapName || 'current map'}". Tap "+ Add Schedule" to set automated dispatch.</p>`;
      return;
    }

    list.innerHTML = schedules.map(s => {
      const timeStr = `${String(s.hour ?? 9).padStart(2, '0')}:${String(s.minute ?? 0).padStart(2, '0')}`;
      const repeatLabel = s.repeat === 'weekly' ? 'Weekly' : (s.repeat ? s.repeat.toUpperCase() : 'DAILY');
      const isEnabled = s.enabled !== false;
      const sName = s.name || s.mission_id || "Patrol Routine";
      const sJson = escapeQuotes(JSON.stringify(s));

      return `
        <div class="swipeable-wrapper">
          <div class="swipe-delete-action">
            <button type="button" class="btn-swipe-delete" onclick="deleteSchedulePrompt('${escapeQuotes(s.id)}', '${escapeQuotes(sName)}')">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Delete</span>
            </button>
          </div>
          <div class="swipeable-content schedule-item-card">
            <div class="schedule-item-info" onclick='openScheduleEditor(JSON.parse("${sJson}"))'>
              <h3>${escapeHtml(sName)}</h3>
              <p>⏰ ${timeStr} • ${repeatLabel} • Mission: <code>${escapeHtml(s.mission_id || '--')}</code></p>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="badge ${isEnabled ? 'badge-ok' : 'badge-warning'}">${isEnabled ? "ACTIVE" : "PAUSED"}</span>
              <button class="btn btn-secondary btn-sm" onclick='openScheduleEditor(JSON.parse("${sJson}"))'>Edit</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    makeSwipeable(list);
  } catch (e) {
    list.innerHTML = `<p style="color: var(--danger); padding: 16px;">Failed to load schedules: ${escapeHtml(e.message)}</p>`;
  }
}

window.openScheduleEditor = async function(existing = null) {
  editingScheduleId = existing ? existing.id : null;
  const modal = document.getElementById("modal-schedule-editor");
  const titleEl = document.getElementById("schedule-editor-title");
  const nameInput = document.getElementById("sched-name");
  const missionSel = document.getElementById("sched-mission");
  const timeInput = document.getElementById("sched-time");
  const repeatSel = document.getElementById("sched-repeat");
  const enabledCb = document.getElementById("sched-enabled");
  const dateInput = document.getElementById("sched-date");
  if (!modal) return;

  if (titleEl) titleEl.textContent = existing ? "Edit Schedule" : "New Schedule";

  // Ensure missions are loaded
  try {
    if (!loadedMissionsCache || loadedMissionsCache.length === 0) {
      const res = await fetch(`${API_BASE}/api/v1/missions`);
      const data = await res.json();
      loadedMissionsCache = data.missions || [];
    }
  } catch (e) {
    console.warn("Failed loading missions for schedule:", e);
  }

  if (missionSel) {
    missionSel.innerHTML = `
      <option value="">Select a mission...</option>
      ${loadedMissionsCache.map(m => `
        <option value="${escapeQuotes(m.id || m.name)}" ${existing && (existing.mission_id === (m.id || m.name)) ? 'selected' : ''}>
          ${escapeHtml(m.name || m.id)}
        </option>
      `).join("")}
    `;
  }

  if (existing) {
    if (nameInput) nameInput.value = existing.name || "";
    const h = String(existing.hour !== undefined ? existing.hour : 9).padStart(2, '0');
    const m = String(existing.minute !== undefined ? existing.minute : 0).padStart(2, '0');
    if (timeInput) timeInput.value = `${h}:${m}`;
    if (repeatSel) repeatSel.value = existing.repeat || "daily";
    if (enabledCb) enabledCb.checked = existing.enabled !== false;
    if (dateInput && existing.date) dateInput.value = existing.date;

    scheduleSelectedDays = new Set(Array.isArray(existing.weekdays) ? existing.weekdays : [0, 1, 2, 3, 4]);
  } else {
    if (nameInput) nameInput.value = "";
    if (timeInput) timeInput.value = "09:00";
    if (repeatSel) repeatSel.value = "daily";
    if (enabledCb) enabledCb.checked = true;
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    scheduleSelectedDays = new Set([0, 1, 2, 3, 4]);
  }

  initWeekdayChips();
  handleScheduleRepeatChange();
  updateWeekdayChipsUI();
  modal.style.display = "flex";
};

window.closeScheduleEditor = function() {
  const modal = document.getElementById("modal-schedule-editor");
  if (modal) modal.style.display = "none";
  editingScheduleId = null;
};

window.handleScheduleRepeatChange = function() {
  const repeatSel = document.getElementById("sched-repeat");
  const weekdaysGroup = document.getElementById("sched-weekdays-group");
  const dateGroup = document.getElementById("sched-date-group");
  if (!repeatSel) return;
  const val = repeatSel.value;
  if (weekdaysGroup) weekdaysGroup.style.display = (val === "weekly") ? "block" : "none";
  if (dateGroup) dateGroup.style.display = (val === "once") ? "block" : "none";
};

function updateWeekdayChipsUI() {
  const container = document.getElementById("sched-weekday-chips");
  if (!container) return;
  container.querySelectorAll(".weekday-chip").forEach(chip => {
    const day = parseInt(chip.getAttribute("data-day"), 10);
    if (scheduleSelectedDays.has(day)) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });
}

function initWeekdayChips() {
  const container = document.getElementById("sched-weekday-chips");
  if (!container || container._inited) return;
  container._inited = true;
  container.addEventListener("click", (e) => {
    const chip = e.target.closest(".weekday-chip");
    if (!chip) return;
    const day = parseInt(chip.getAttribute("data-day"), 10);
    if (scheduleSelectedDays.has(day)) {
      if (scheduleSelectedDays.size > 1) {
        scheduleSelectedDays.delete(day);
      } else {
        showToast("At least one active day is required", true);
      }
    } else {
      scheduleSelectedDays.add(day);
    }
    updateWeekdayChipsUI();
  });
}

window.saveScheduleForm = async function(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById("sched-name");
  const missionSel = document.getElementById("sched-mission");
  const timeInput = document.getElementById("sched-time");
  const repeatSel = document.getElementById("sched-repeat");
  const enabledCb = document.getElementById("sched-enabled");
  const dateInput = document.getElementById("sched-date");

  const name = nameInput ? nameInput.value.trim() : "";
  const missionId = missionSel ? missionSel.value : "";
  const timeVal = timeInput ? timeInput.value : "09:00";
  const repeat = repeatSel ? repeatSel.value : "daily";
  const enabled = enabledCb ? enabledCb.checked : true;
  const date = dateInput ? dateInput.value : null;

  if (!name) {
    showToast("Please enter a schedule name.", true);
    return;
  }
  if (!missionId) {
    showToast("Please select a routine/mission.", true);
    return;
  }

  const [hStr, mStr] = timeVal.split(":");
  const hour = parseInt(hStr, 10) || 0;
  const minute = parseInt(mStr, 10) || 0;

  const payload = {
    id: editingScheduleId || `sched_${Date.now()}`,
    name,
    mission_id: missionId,
    hour,
    minute,
    repeat,
    enabled,
    weekdays: repeat === 'weekly' ? Array.from(scheduleSelectedDays).sort() : [],
    date: repeat === 'once' ? date : null
  };

  try {
    showToast("Saving schedule...");
    const res = await fetch(`${API_BASE}/api/v1/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to save schedule");
    }
    showToast("Schedule saved successfully!");
    closeScheduleEditor();
    loadSchedules();
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
};

window.deleteSchedulePrompt = function(schedId, schedName) {
  showDangerConfirmation({
    title: "Delete Schedule",
    message: `Are you sure you want to delete automated schedule "${schedName}"?`,
    confirmText: "Delete Schedule",
    isDanger: true,
    icon: "⏰",
    onConfirm: () => deleteSchedule(schedId, schedName)
  });
};

window.deleteSchedule = async function(schedId, schedName) {
  try {
    await fetch(`${API_BASE}/api/v1/schedules/${encodeURIComponent(schedId)}`, { method: "DELETE" });
    showToast(`Schedule "${schedName}" deleted.`);
    loadSchedules();
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, true);
  }
};

/* --------------------------------------------------------------------------
   14. Power & Health Subpage
   -------------------------------------------------------------------------- */
async function loadPowerHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/system/health`);
    const data = await res.json();
    const list = document.getElementById("health-checklist");
    if (!list) return;
    const items = data.components || [
      { name: "Base Motion Controller", ok: true },
      { name: "RPLidar 360 Laser", ok: true },
      { name: "Nav2 Costmap Layers", ok: true },
      { name: "AMCL Localization", ok: isLocalized }
    ];
    list.innerHTML = items.map(c => `
      <div class="health-item">
        <span class="badge ${c.ok ? 'badge-ok' : 'badge-danger'}">${c.ok ? 'ONLINE' : 'OFFLINE'}</span>
        ${escapeHtml(c.name)}
      </div>
    `).join("");
  } catch (e) {
    console.warn("Health load error:", e);
  }
}

/* --------------------------------------------------------------------------
   15. Native GNOME-Style On-Screen Touch Keyboard (OSK)
   -------------------------------------------------------------------------- */
let currentOskLayer = "lower"; // 'lower', 'upper', 'symbols'
let oskActiveInput = null;
let oskBackspaceTimer = null;
let oskBackspaceInterval = null;

const OSK_LAYOUTS = {
  lower: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    [
      { key: "shift", label: "⇧", cls: "osk-key-mod osk-key-shift" },
      "z", "x", "c", "v", "b", "n", "m",
      { key: "backspace", label: "⌫", cls: "osk-key-mod osk-key-backspace" }
    ],
    [
      { key: "symbols", label: "?123", cls: "osk-key-mod osk-key-sym" },
      "_",
      { key: "space", label: "space", cls: "osk-key-space" },
      "-", ".",
      { key: "done", label: "Done ↵", cls: "osk-key-enter" }
    ]
  ],
  upper: [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    [
      { key: "shift", label: "⬆", cls: "osk-key-mod osk-key-shift shift-active" },
      "Z", "X", "C", "V", "B", "N", "M",
      { key: "backspace", label: "⌫", cls: "osk-key-mod osk-key-backspace" }
    ],
    [
      { key: "symbols", label: "?123", cls: "osk-key-mod osk-key-sym" },
      "_",
      { key: "space", label: "space", cls: "osk-key-space" },
      "-", ".",
      { key: "done", label: "Done ↵", cls: "osk-key-enter" }
    ]
  ],
  symbols: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["@", "#", "$", "%", "&", "*", "/", "(", ")", "="],
    [
      { key: "letters", label: "ABC", cls: "osk-key-mod osk-key-sym" },
      "!", "\"", "'", ":", ";", "?", "+", "\\",
      { key: "backspace", label: "⌫", cls: "osk-key-mod osk-key-backspace" }
    ],
    [
      { key: "letters", label: "ABC", cls: "osk-key-mod osk-key-sym" },
      "_",
      { key: "space", label: "space", cls: "osk-key-space" },
      ",", ".",
      { key: "done", label: "Done ↵", cls: "osk-key-enter" }
    ]
  ]
};

function renderGnomeOsk() {
  const container = document.getElementById("gnome-osk-grid");
  if (!container) return;

  const rows = OSK_LAYOUTS[currentOskLayer] || OSK_LAYOUTS.lower;
  container.innerHTML = rows.map(row => `
    <div class="osk-row">
      ${row.map(item => {
        if (typeof item === "string") {
          return `<button type="button" class="osk-key" data-char="${escapeHtml(item)}">${escapeHtml(item)}</button>`;
        } else {
          return `<button type="button" class="osk-key ${item.cls || ""}" data-action="${item.key}">${item.label}</button>`;
        }
      }).join("")}
    </div>
  `).join("");

  // Attach zero-latency pointer events
  container.querySelectorAll(".osk-key").forEach(btn => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add("active");

      const char = btn.getAttribute("data-char");
      const action = btn.getAttribute("data-action");

      if (char !== null) {
        handleOskKeyInput(char);
      } else if (action) {
        handleOskAction(action);
      }
    });

    const release = () => {
      btn.classList.remove("active");
      clearTimeout(oskBackspaceTimer);
      clearInterval(oskBackspaceInterval);
    };

    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
  });
}

function handleOskKeyInput(char) {
  const display = document.getElementById("osk-input-display");
  if (display) {
    display.value += char;
  }
  if (oskActiveInput) {
    oskActiveInput.value = display ? display.value : (oskActiveInput.value + char);
    oskActiveInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // If in upper layer, return to lower after single character input (natural OSK behavior)
  if (currentOskLayer === "upper") {
    currentOskLayer = "lower";
    renderGnomeOsk();
  }
}

function handleOskAction(action) {
  if (action === "shift") {
    currentOskLayer = currentOskLayer === "upper" ? "lower" : "upper";
    renderGnomeOsk();
  } else if (action === "symbols") {
    currentOskLayer = "symbols";
    renderGnomeOsk();
  } else if (action === "letters") {
    currentOskLayer = "lower";
    renderGnomeOsk();
  } else if (action === "space") {
    handleOskKeyInput(" ");
  } else if (action === "done") {
    closeTouchKeyboard(true);
  } else if (action === "backspace") {
    performOskBackspace();
    clearTimeout(oskBackspaceTimer);
    clearInterval(oskBackspaceInterval);
    oskBackspaceTimer = setTimeout(() => {
      oskBackspaceInterval = setInterval(performOskBackspace, 65);
    }, 350);
  }
}

function performOskBackspace() {
  const display = document.getElementById("osk-input-display");
  if (display && display.value.length > 0) {
    display.value = display.value.slice(0, -1);
  }
  if (oskActiveInput) {
    oskActiveInput.value = display ? display.value : (oskActiveInput.value.slice(0, -1));
    oskActiveInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function initTouchKeyboard() {
  renderGnomeOsk();

  // Clear button on preview display
  document.getElementById("osk-btn-clear")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const display = document.getElementById("osk-input-display");
    if (display) display.value = "";
    if (oskActiveInput) {
      oskActiveInput.value = "";
      oskActiveInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // Enable seamless automatic OSK pop-up for any editable input in the entire UI
  initUniversalInputKeyboard();
}

window.openTouchKeyboard = function(promptLabel, callback, defaultValue = "", isPassword = false) {
  touchKeyboardCallback = callback;
  oskActiveInput = null;

  const panel = document.getElementById("gnome-osk");
  const backdrop = document.getElementById("gnome-osk-backdrop");
  const labelEl = document.getElementById("osk-prompt-label");
  const inputEl = document.getElementById("osk-input-display");

  if (labelEl) labelEl.textContent = promptLabel || "Enter Text";
  if (inputEl) {
    inputEl.type = isPassword ? "password" : "text";
    inputEl.value = defaultValue || "";
  }

  currentOskLayer = "lower";
  renderGnomeOsk();

  if (backdrop) backdrop.classList.add("active");
  if (panel) {
    panel.classList.add("osk-visible");
    panel.setAttribute("aria-hidden", "false");
  }
};

window.closeTouchKeyboard = function(confirmed) {
  const panel = document.getElementById("gnome-osk");
  const backdrop = document.getElementById("gnome-osk-backdrop");
  const inputEl = document.getElementById("osk-input-display");
  const val = inputEl ? inputEl.value : "";

  if (backdrop) backdrop.classList.remove("active");
  if (panel) {
    panel.classList.remove("osk-visible");
    panel.setAttribute("aria-hidden", "true");
  }

  clearTimeout(oskBackspaceTimer);
  clearInterval(oskBackspaceInterval);

  if (confirmed && touchKeyboardCallback) {
    touchKeyboardCallback(val);
  }
  touchKeyboardCallback = null;
  oskActiveInput = null;
};

function initUniversalInputKeyboard() {
  document.addEventListener("pointerdown", (e) => {
    const target = e.target;
    if (target && target.tagName === "INPUT" && target.id !== "osk-input-display" && !target.readOnly) {
      const type = (target.type || "text").toLowerCase();
      if (type === "text" || type === "password" || type === "number" || type === "search") {
        e.preventDefault();
        oskActiveInput = target;
        const promptLabel = target.placeholder || target.getAttribute("name") || "Enter Text";
        const isPw = type === "password";

        openTouchKeyboard(promptLabel, (val) => {
          if (val !== null && val !== undefined) {
            target.value = val;
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, target.value, isPw);
      }
    }
  });
}

/* --------------------------------------------------------------------------
   16. Dynamic UI Kiosk Interactions (Human-In-The-Loop Missions)
   -------------------------------------------------------------------------- */
function handleActiveInteraction(interaction) {
  if (!interaction || !interaction.interaction_id) return;
  activeInteractionId = interaction.interaction_id;

  const overlay = document.getElementById("interaction-overlay");
  const titleEl = document.getElementById("interaction-title");
  const msgEl = document.getElementById("interaction-message");
  const formEl = document.getElementById("kiosk-form");
  const choicesEl = document.getElementById("kiosk-choices");

  if (!overlay) return;

  if (titleEl) titleEl.textContent = interaction.title || "Action Required";
  if (msgEl) msgEl.textContent = interaction.message || "";

  if (interaction.subtype === "form") {
    renderInteractionForm(interaction);
    if (formEl) formEl.style.display = "flex";
    if (choicesEl) choicesEl.style.display = "none";
  } else {
    renderInteractionChoices(interaction);
    if (formEl) formEl.style.display = "none";
    if (choicesEl) choicesEl.style.display = "flex";
  }

  overlay.style.display = "flex";
  triggerFaceExpression("thinking");
}

function renderInteractionForm(interaction) {
  const container = document.getElementById("form-fields-container");
  if (!container) return;
  const fields = interaction.fields || [];

  container.innerHTML = fields.map(f => {
    if (f.type === "select") {
      return `
        <div class="kiosk-field-group">
          <label>${escapeHtml(f.label)}</label>
          <select class="kiosk-input kiosk-select" name="${escapeHtml(f.key)}">
            ${(f.options || []).map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join("")}
          </select>
        </div>
      `;
    } else if (f.type === "checkbox") {
      return `
        <div class="kiosk-field-group kiosk-checkbox-group">
          <label class="kiosk-checkbox-label">
            <input type="checkbox" name="${escapeHtml(f.key)}" ${f.default_value ? "checked" : ""}>
            <span>${escapeHtml(f.label)}</span>
          </label>
        </div>
      `;
    } else {
      return `
        <div class="kiosk-field-group">
          <label>${escapeHtml(f.label)}</label>
          <input type="text" class="kiosk-input" name="${escapeHtml(f.key)}" value="${escapeHtml(f.default_value || "")}">
        </div>
      `;
    }
  }).join("");

  const form = document.getElementById("kiosk-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const result = {};
    fields.forEach(f => {
      if (f.type === "checkbox") {
        result[f.key] = formData.has(f.key);
      } else {
        result[f.key] = formData.get(f.key);
      }
    });
    await submitInteractionResponse({ status: "submitted", form_data: result });
  };

  document.getElementById("btn-form-cancel").onclick = async () => {
    await submitInteractionResponse({ status: "canceled" });
  };
}

function renderInteractionChoices(interaction) {
  const grid = document.getElementById("choices-buttons-grid");
  if (!grid) return;
  const choices = interaction.choices || ["Confirm", "Dismiss"];

  grid.innerHTML = choices.map(choice => `
    <button class="kiosk-choice-btn" onclick="submitChoiceResponse('${escapeQuotes(choice)}')">
      <span>${escapeHtml(choice)}</span>
    </button>
  `).join("");
}

window.submitChoiceResponse = async function(choiceText) {
  await submitInteractionResponse({ status: "selected", choice: choiceText });
};

async function submitInteractionResponse(data) {
  try {
    await fetch(`${API_BASE}/api/v1/missions/ui_response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interaction_id: activeInteractionId,
        response: data
      })
    });
  } catch (e) {
    console.warn("Failed to post UI interaction response:", e);
  }
  const overlay = document.getElementById("interaction-overlay");
  if (overlay) overlay.style.display = "none";
  activeInteractionId = null;
  triggerFaceExpression("happy");
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

function showToast(message, isError = false) {
  const toast = document.getElementById("kiosk-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.borderColor = isError ? "var(--danger)" : "var(--border-strong)";
  toast.style.display = "block";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeQuotes(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'");
}

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
        (misResult.status === "fulfilled" && misResult.value && (misResult.value.state === "running" || misResult.value.status === "running")) ||
        activeMissionState === "running"
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
        const uiData = uiResult.value;
        if (uiData && uiData.interaction_id && uiData.interaction_id !== activeInteractionId) {
          handleActiveInteraction(uiData);
        }
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

  poll();
  setInterval(poll, 2000);

  // Check for app software updates 5 seconds after boot
  setTimeout(() => checkAppUpdates(true), 5000);
}

/* --------------------------------------------------------------------------
   14. SOFTWARE UPDATE SYSTEM (GitHub Releases + SDK Updater)
   -------------------------------------------------------------------------- */
const APP_CURRENT_VERSION = "1.0.0";
let latestReleaseData = null;
let updatePollingTimer = null;

async function checkAppUpdates(silent = true) {
  try {
    let updateInfo = null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/system/app/update/check`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        updateInfo = await res.json();
      }
    } catch (e) {
      // Fallback directly to GitHub Releases API
    }

    // Direct GitHub API fallback
    if (!updateInfo) {
      try {
        const ghRes = await fetch("https://api.github.com/repos/botforge-robotics/navpromini_robot_ui/releases/latest", {
          headers: { "Accept": "application/vnd.github.v3+json" },
          signal: AbortSignal.timeout(5000)
        });
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          const tag = (ghData.tag_name || "").replace(/^v/, "");
          const isNewer = compareSemVer(tag, APP_CURRENT_VERSION) > 0;
          let assetUrl = null;
          let assetSize = 0;
          if (ghData.assets && ghData.assets.length > 0) {
            const asset = ghData.assets.find(a => a.name.includes("aarch64") || a.name.endsWith(".AppImage")) || ghData.assets[0];
            if (asset) {
              assetUrl = asset.browser_download_url;
              assetSize = asset.size;
            }
          }
          updateInfo = {
            current_version: APP_CURRENT_VERSION,
            latest_version: tag,
            update_available: isNewer,
            release_name: ghData.name || `v${tag}`,
            release_notes: ghData.body || "Performance and stability updates.",
            download_url: assetUrl,
            asset_size: assetSize
          };
        }
      } catch (err) {
        console.log("GitHub release check offline or unavailable:", err);
      }
    }

    if (!updateInfo) {
      if (!silent) showToast("No update info available right now.");
      return;
    }

    latestReleaseData = updateInfo;

    if (updateInfo.update_available) {
      showUpdateAvailableModal(updateInfo);
    } else if (!silent) {
      showToast(`NavPro Mini is up to date (v${APP_CURRENT_VERSION})`);
    }

  } catch (err) {
    console.error("Failed to check app updates:", err);
  }
}

function compareSemVer(v1, v2) {
  const p1 = (v1 || "0").split(".").map(n => parseInt(n) || 0);
  const p2 = (v2 || "0").split(".").map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

function showUpdateAvailableModal(info) {
  const modal = document.getElementById("modal-app-update");
  if (!modal) return;
  document.getElementById("update-modal-cur-ver").textContent = `v${info.current_version || APP_CURRENT_VERSION}`;
  document.getElementById("update-modal-new-ver").textContent = `v${info.latest_version || "1.0.1"}`;
  
  const notesEl = document.getElementById("update-modal-notes");
  if (notesEl) {
    notesEl.textContent = info.release_notes || "Performance enhancements, smoother animations, and navigation bug fixes.";
  }
  
  document.getElementById("update-progress-wrap").style.display = "none";
  document.getElementById("update-actions-row").style.display = "grid";
  modal.style.display = "flex";
}

window.dismissUpdateModal = function() {
  const modal = document.getElementById("modal-app-update");
  if (modal) modal.style.display = "none";
  if (updatePollingTimer) clearInterval(updatePollingTimer);
};

window.triggerAppUpdate = async function() {
  const progressWrap = document.getElementById("update-progress-wrap");
  const actionsRow = document.getElementById("update-actions-row");
  const progressBar = document.getElementById("update-progress-bar");
  const progressLabel = document.getElementById("update-progress-label");
  
  if (actionsRow) actionsRow.style.display = "none";
  if (progressWrap) progressWrap.style.display = "flex";
  
  if (progressBar) progressBar.style.width = "10%";
  if (progressLabel) progressLabel.textContent = "Initiating update download...";

  try {
    await fetch(`${API_BASE}/api/v1/system/app/update/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        download_url: latestReleaseData ? latestReleaseData.download_url : null,
        target_version: latestReleaseData ? latestReleaseData.latest_version : "latest"
      })
    });

    let elapsed = 0;
    updatePollingTimer = setInterval(async () => {
      elapsed += 1;
      try {
        const statRes = await fetch(`${API_BASE}/api/v1/system/app/update/status`);
        if (statRes.ok) {
          const status = await statRes.json();
          const pct = Math.max(10, Math.min(100, status.progress || 10));
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressLabel) progressLabel.textContent = `${status.message || "Downloading..."} (${pct}%)`;

          if (status.state === "restarting" || status.state === "completed") {
            clearInterval(updatePollingTimer);
            if (progressBar) progressBar.style.width = "100%";
            if (progressLabel) progressLabel.textContent = "Update complete! Restarting UI...";
            setTimeout(() => {
              window.location.reload();
            }, 2500);
          } else if (status.state === "failed") {
            clearInterval(updatePollingTimer);
            if (progressLabel) progressLabel.textContent = `Update failed: ${status.error || "Unknown error"}`;
            if (actionsRow) actionsRow.style.display = "grid";
          }
        }
      } catch (err) {
        if (elapsed > 10) {
          if (progressLabel) progressLabel.textContent = "Restarting UI...";
          setTimeout(() => window.location.reload(), 2500);
        }
      }
    }, 800);

  } catch (err) {
    if (progressLabel) progressLabel.textContent = "Connection error. Retrying...";
    setTimeout(() => {
      if (actionsRow) actionsRow.style.display = "grid";
    }, 2000);
  }
};

