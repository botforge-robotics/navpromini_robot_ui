// NavPro Mini - Onboard Robot Kiosk UI Controller
// Connects to local navpromini_sdk server (port 8090)

const API_BASE = window.location.port === "8090" 
  ? window.location.origin 
  : "http://" + (window.location.hostname || "127.0.0.1") + ":8090";

// State
let currentSwipeIndex = 0; // 0 = Face, 1 = Dashboard
let activeMapName = "";
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

function openSubpage(subpageName) {
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

  // Charging Undock Button
  document.getElementById("btn-charging-undock")?.addEventListener("click", async () => {
    try {
      showToast("Undocking from charging station...");
      await fetch(`${API_BASE}/api/v1/undock`, { method: "POST" });
      dismissChargingScreen();
    } catch (e) {
      showToast("Undock failed: " + e.message, true);
    }
  });

  // Cancel Docking
  document.getElementById("btn-cancel-docking")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/dock/goal`, { method: "DELETE" });
      document.getElementById("screen-docking-progress").style.display = "none";
      showToast("Docking canceled.");
    } catch (e) {
      console.warn(e);
    }
  });

  // Cancel Navigation
  document.getElementById("btn-cancel-navigation")?.addEventListener("click", async () => {
    try {
      onScreenNavInitiated = false;
      await fetch(`${API_BASE}/api/v1/navigation/goal`, { method: "DELETE" });
      document.getElementById("screen-nav-progress").style.display = "none";
      showToast("Navigation canceled.");
    } catch (e) {
      console.warn(e);
    }
  });

  // Relocalization Buttons
  document.getElementById("btn-relocalize-dock")?.addEventListener("click", async () => {
    try {
      // Localize at dock position
      await fetch(`${API_BASE}/api/v1/navigation/localize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pose_name: "dock" })
      });
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

function updateNavigationState(navData) {
  if (!navData) return;
  try {
    const isNav = !!(navData.is_navigating || navData.status === "navigating" || navData.status === "executing");
    isNavigating = isNav;
    const navScreen = document.getElementById("screen-nav-progress");
    if (navScreen) {
      if (isNav && onScreenNavInitiated) {
        navScreen.style.display = "flex";
        const destEl = document.getElementById("nav-screen-destination");
        if (destEl && navData.target_waypoint) destEl.textContent = navData.target_waypoint;
        const distEl = document.getElementById("nav-screen-distance");
        if (distEl && navData.distance_remaining !== undefined) {
          distEl.textContent = `Approaching pose (${navData.distance_remaining.toFixed(1)}m remaining)...`;
        }
        const barEl = document.getElementById("nav-screen-bar");
        if (barEl && navData.progress_percent !== undefined) {
          barEl.style.width = `${Math.min(100, Math.max(0, navData.progress_percent))}%`;
        }
      } else {
        if (!isNav) onScreenNavInitiated = false;
        if (navScreen.style.display === "flex") {
          navScreen.style.display = "none";
        }
      }
    }
  } catch (err) {
    console.warn("Navigation state update error:", err);
  }
}

function updatePowerState(pState) {
  if (!pState) return;
  try {
    const b = pState.data || pState.battery || pState;
    const isCharging = !!(b.charging || b.is_charging || b.status === "charging" || b.status === "Charging" || b.power_supply_status === "Charging" || b.adapter_connected || (pState.detail && pState.detail.charger_connected));
    const rawPct = b.percentage !== undefined ? b.percentage : (b.soc_percent !== undefined ? b.soc_percent : (b.battery_level !== undefined ? b.battery_level : null));
    
    if (rawPct !== null && rawPct !== undefined && !isNaN(rawPct)) {
      const pct = Math.max(0, Math.min(100, Math.round(Number(rawPct))));

      // Update header battery chip
      const pctEl = document.getElementById("battery-pct");
      const boltEl = document.getElementById("charging-bolt");
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (boltEl) boltEl.style.display = isCharging ? "inline" : "none";

      // Update full-screen charging overlay if visible
      const chargingScreen = document.getElementById("screen-charging");
      const chargingPct = document.getElementById("charging-screen-pct");
      if (chargingPct) chargingPct.textContent = `${pct}%`;

      const isFull = pct >= 100 || b.status === "Full" || b.status === "full" || b.status === "completed";
      const chargingStateText = document.getElementById("charging-state-text");
      const chargingInfoDesc = document.getElementById("charging-info-desc");
      if (chargingStateText) {
        chargingStateText.textContent = isFull ? "CHARGING COMPLETED" : "FAST CHARGING";
      }
      if (chargingInfoDesc) {
        chargingInfoDesc.textContent = isFull
          ? "Battery is fully charged (100%). Robot is ready for operations."
          : "The robot is currently locked in dock position and recharging its battery.";
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
let liveMapRendererInterval = null;
let liveMapPan = { x: 0, y: 0, scale: 1.0, userControlled: false };
let liveMapMetadata = null; // { width, height, resolution, origin: { x, y } }
let liveRobotPose = null;   // { x, y, yaw }
let liveDockPose = { x: 0, y: 0, theta: 0 };
let liveStandoffPose = { x: 0.70, y: 0, theta: 0 };
let liveTrajectory = [];
let liveHasMovedAway = false;
let activeTouchPointers = new Map();
let initialPinchDistance = null;
let initialPinchScale = 1.0;

function initMappingViewportInteractivity() {
  const canvas = document.getElementById("mapping-live-canvas");
  if (!canvas || canvas._interactivityAttached) return;
  canvas._interactivityAttached = true;

  let isDragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeTouchPointers.size === 1) {
      isDragging = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    } else if (activeTouchPointers.size === 2) {
      isDragging = false;
      const pts = Array.from(activeTouchPointers.values());
      initialPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialPinchScale = liveMapPan.scale;
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!activeTouchPointers.has(e.pointerId)) return;
    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeTouchPointers.size === 2 && initialPinchDistance) {
      const pts = Array.from(activeTouchPointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const factor = dist / initialPinchDistance;
      liveMapPan.scale = Math.max(0.2, Math.min(6.0, initialPinchScale * factor));
      liveMapPan.userControlled = true;
    } else if (isDragging && activeTouchPointers.size === 1) {
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      liveMapPan.x += dx;
      liveMapPan.y += dy;
      liveMapPan.userControlled = true;
    }
  });

  const endDrag = (e) => {
    activeTouchPointers.delete(e.pointerId);
    if (activeTouchPointers.size === 1) {
      const remaining = Array.from(activeTouchPointers.values())[0];
      lastPointerX = remaining.x;
      lastPointerY = remaining.y;
      isDragging = true;
    } else if (activeTouchPointers.size === 0) {
      isDragging = false;
      initialPinchDistance = null;
    }
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // Mouse wheel zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    liveMapPan.scale = Math.max(0.2, Math.min(6.0, liveMapPan.scale * zoomFactor));
    liveMapPan.userControlled = true;
  }, { passive: false });

  // Floating button controls
  document.getElementById("btn-mapping-zoom-in")?.addEventListener("click", () => {
    liveMapPan.scale = Math.min(liveMapPan.scale * 1.25, 6.0);
    liveMapPan.userControlled = true;
  });
  document.getElementById("btn-mapping-zoom-out")?.addEventListener("click", () => {
    liveMapPan.scale = Math.max(liveMapPan.scale / 1.25, 0.2);
    liveMapPan.userControlled = true;
  });
  document.getElementById("btn-mapping-recenter")?.addEventListener("click", () => {
    liveMapPan.userControlled = false;
  });
}

function startLiveMapRenderer() {
  clearInterval(liveMapRendererInterval);
  const canvas = document.getElementById("mapping-live-canvas");
  const loadingEl = document.getElementById("mapping-canvas-loading");
  if (loadingEl) loadingEl.style.display = "flex";
  if (!canvas) return;

  initMappingViewportInteractivity();

  let firstFrameLoaded = false;

  const renderFrame = async () => {
    try {
      // 1. Fetch map image
      const imgRes = await fetch(`${API_BASE}/api/v1/maps/current/image?rotate=0&t=${Date.now()}`);
      if (!imgRes.ok) return;
      const blob = await imgRes.blob();
      const img = new Image();

      // 2. Concurrently fetch map metadata and robot state
      try {
        const [infoRes, stateRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/maps/current/info`),
          fetch(`${API_BASE}/api/v1/state`)
        ]);
        if (infoRes.ok) {
          const info = await infoRes.json();
          if (info.loaded) liveMapMetadata = info;
        }
        if (stateRes.ok) {
          const s = await stateRes.json();
          if (s.localization && s.localization.x !== undefined) {
            liveRobotPose = {
              x: s.localization.x,
              y: s.localization.y,
              yaw: s.localization.yaw || 0
            };

            // Track departure movement from dock for automatic standoff & orientation calculation
            const distFromDock = Math.hypot(liveRobotPose.x - liveDockPose.x, liveRobotPose.y - liveDockPose.y);
            if (!liveHasMovedAway && distFromDock >= 0.20) {
              const depAngle = Math.atan2(liveRobotPose.y - liveDockPose.y, liveRobotPose.x - liveDockPose.x);
              liveDockPose.theta = depAngle;
              liveStandoffPose = {
                x: liveDockPose.x + 0.70 * Math.cos(depAngle),
                y: liveDockPose.y + 0.70 * Math.sin(depAngle),
                theta: depAngle // Robot back faces dock, front faces towards room
              };
              liveHasMovedAway = true;
            }

            // Record trajectory point
            const lastPt = liveTrajectory[liveTrajectory.length - 1];
            if (!lastPt || Math.hypot(liveRobotPose.x - lastPt.x, liveRobotPose.y - lastPt.y) >= 0.08) {
              liveTrajectory.push({ x: liveRobotPose.x, y: liveRobotPose.y });
            }
          }
        }
      } catch (_) {}

      img.onload = () => {
        // Enforce full canvas resolution
        canvas.width = window.innerWidth || 800;
        canvas.height = window.innerHeight || 1280;
        const ctx = canvas.getContext("2d");

        // Background: deep slate radar
        ctx.fillStyle = "#0B0F19";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Subgrid background lines
        ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
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

        // Auto-center viewport on initial frame or upon recenter request
        if (!liveMapPan.userControlled || !firstFrameLoaded) {
          const fitScale = Math.min((canvas.width * 0.85) / img.width, (canvas.height * 0.75) / img.height);
          liveMapPan.scale = Math.max(0.6, fitScale);
          liveMapPan.x = (canvas.width - img.width * liveMapPan.scale) / 2;
          liveMapPan.y = (canvas.height - img.height * liveMapPan.scale) / 2;
          firstFrameLoaded = true;
        }

        // World to canvas coordinate transform helper
        const worldToCanvas = (wx, wy) => {
          if (!liveMapMetadata) {
            return {
              x: liveMapPan.x + (img.width / 2) * liveMapPan.scale,
              y: liveMapPan.y + (img.height / 2) * liveMapPan.scale
            };
          }
          const u = (wx - liveMapMetadata.origin.x) / liveMapMetadata.resolution;
          const v = liveMapMetadata.height - ((wy - liveMapMetadata.origin.y) / liveMapMetadata.resolution);
          return {
            x: liveMapPan.x + u * liveMapPan.scale,
            y: liveMapPan.y + v * liveMapPan.scale
          };
        };

        // Draw occupancy grid map
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, liveMapPan.x, liveMapPan.y, img.width * liveMapPan.scale, img.height * liveMapPan.scale);
        ctx.restore();

        // Draw Trajectory Trail
        if (liveTrajectory.length > 1) {
          ctx.save();
          ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
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

        // Draw Dock Standoff Marker (🎯)
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

        // Draw Charging Dock Marker (⚡)
        if (liveDockPose) {
          const dp = worldToCanvas(liveDockPose.x, liveDockPose.y);
          ctx.save();
          ctx.translate(dp.x, dp.y);
          // Orientation arrow pointing towards standoff
          ctx.rotate(-liveDockPose.theta);
          ctx.fillStyle = "#10B981";
          ctx.beginPath();
          ctx.arc(0, 0, 14, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 2.5;
          ctx.stroke();
          // Arrow indicator
          ctx.fillStyle = "#FFFFFF";
          ctx.beginPath();
          ctx.moveTo(18, 0);
          ctx.lineTo(8, -6);
          ctx.lineTo(8, 6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // Dock label
          ctx.save();
          ctx.font = "bold 12px system-ui, sans-serif";
          ctx.fillStyle = "#6EE7B7";
          ctx.textAlign = "center";
          ctx.fillText("DOCK (ORIGIN)", dp.x, dp.y - 20);
          ctx.restore();
        }

        // Draw Live Robot Marker (🤖)
        if (liveRobotPose) {
          const rp = worldToCanvas(liveRobotPose.x, liveRobotPose.y);
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
          ctx.rotate(-liveRobotPose.yaw);

          // Robot chassis
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
        }

        if (loadingEl) loadingEl.style.display = "none";
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(blob);
    } catch (_) {}
  };

  renderFrame();
  liveMapRendererInterval = setInterval(renderFrame, 800);
}

function stopLiveMapRenderer() {
  clearInterval(liveMapRendererInterval);
  liveMapRendererInterval = null;
  const loadingEl = document.getElementById("mapping-canvas-loading");
  if (loadingEl) loadingEl.style.display = "flex";
}

function initMappingControls() {
  // Cancel / Abort Mapping: Show stopping spinner, stop SLAM mode, wait until off, and return home
  document.getElementById("btn-abort-mapping")?.addEventListener("click", async () => {
    const stoppingModal = document.getElementById("modal-stopping-mapping");
    if (stoppingModal) stoppingModal.style.display = "flex";

    try {
      const target = (activeMapName && activeMapName !== "default")
        ? { mode: "navigation", map: activeMapName }
        : { mode: "idle" };

      await fetch(`${API_BASE}/api/v1/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target)
      });

      for (let i = 0; i < 14; i++) {
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

    // Record initial dock pose (at start of mapping robot is placed at dock facing room)
    try {
      const stRes = await fetch(`${API_BASE}/api/v1/state`);
      if (stRes.ok) {
        const st = await stRes.json();
        const ix = (st.localization && st.localization.x) || 0;
        const iy = (st.localization && st.localization.y) || 0;
        const iyaw = (st.localization && st.localization.yaw) || 0;
        liveDockPose = { x: ix, y: iy, theta: iyaw };
        liveStandoffPose = {
          x: ix + 0.70 * Math.cos(iyaw),
          y: iy + 0.70 * Math.sin(iyaw),
          theta: iyaw
        };
        liveTrajectory = [{ x: ix, y: iy }];
        liveHasMovedAway = false;
      }
    } catch (_) {
      liveDockPose = { x: 0, y: 0, theta: 0 };
      liveStandoffPose = { x: 0.70, y: 0, theta: 0 };
      liveTrajectory = [{ x: 0, y: 0 }];
      liveHasMovedAway = false;
    }

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
let viewerInitialScale = 1.0;

function initMapViewerInteractivity() {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas || canvas._viewerInteractivity) return;
  canvas._viewerInteractivity = true;

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let pointerStartPos = { x: 0, y: 0 };

  const toWorld = (sx, sy) => {
    if (!viewerMetadata) return { x: 0, y: 0 };
    const u = (sx - viewerPan.x) / viewerPan.scale;
    const v = (sy - viewerPan.y) / viewerPan.scale;
    const wx = viewerMetadata.origin.x + u * viewerMetadata.resolution;
    const wy = viewerMetadata.origin.y + (viewerMetadata.height - v) * viewerMetadata.resolution;
    return { x: wx, y: wy };
  };

  const getCanvasPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    viewerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointerStartPos = { x: e.clientX, y: e.clientY };

    const { sx, sy } = getCanvasPos(e);

    // 1. Check if user tapped on the heading handle of a placed draft location marker
    if (viewerEditorMode === "save_location" && viewerDraftPose) {
      const dp = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
      const hx = dp.x + 45 * Math.cos(-viewerDraftPose.theta);
      const hy = dp.y + 45 * Math.sin(-viewerDraftPose.theta);
      if (Math.hypot(sx - hx, sy - hy) < 32) {
        viewerDraggingHeading = true;
        return;
      }
    }

    // 2. In save_location mode: start long-press timer to place marker and rotate angle
    if (viewerEditorMode === "save_location" && viewerPointers.size === 1) {
      if (viewerLongPressTimer) clearTimeout(viewerLongPressTimer);
      viewerLongPressTimer = setTimeout(() => {
        const w = toWorld(sx, sy);
        viewerDraftPose = { x: w.x, y: w.y, theta: 0 };
        viewerIsAdjustingAngle = true;
        if (navigator.vibrate) navigator.vibrate(50);
        updateViewerEditorBarUI();
        renderViewerCanvas();
        showToast("Marker placed! Drag around to rotate angle.");
      }, 350);
    }

    if (viewerPointers.size === 1) {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    } else if (viewerPointers.size === 2) {
      if (viewerLongPressTimer) clearTimeout(viewerLongPressTimer);
      isDragging = false;
      const pts = Array.from(viewerPointers.values());
      viewerInitialPinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      viewerInitialScale = viewerPan.scale;
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!viewerPointers.has(e.pointerId)) return;
    viewerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const { sx, sy } = getCanvasPos(e);

    // Cancel long press if moved significantly
    if (viewerLongPressTimer && Math.hypot(e.clientX - pointerStartPos.x, e.clientY - pointerStartPos.y) > 10) {
      clearTimeout(viewerLongPressTimer);
      viewerLongPressTimer = null;
    }

    // Handle interactive heading adjustment for draft location
    if (viewerEditorMode === "save_location" && (viewerDraggingHeading || viewerIsAdjustingAngle) && viewerDraftPose) {
      const dp = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
      const dx = sx - dp.x;
      const dy = sy - dp.y;
      if (Math.hypot(dx, dy) > 12) {
        viewerDraftPose.theta = -Math.atan2(dy, dx);
        renderViewerCanvas();
      }
      return;
    }

    // Pinch-to-zoom
    if (viewerPointers.size === 2 && viewerInitialPinch) {
      const pts = Array.from(viewerPointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      viewerPan.scale = Math.max(0.2, Math.min(6.0, viewerInitialScale * (dist / viewerInitialPinch)));
      viewerPan.userControlled = true;
      renderViewerCanvas();
    } else if (isDragging && viewerPointers.size === 1) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      viewerPan.x += dx;
      viewerPan.y += dy;
      viewerPan.userControlled = true;
      renderViewerCanvas();
    }
  });

  const endDrag = (e) => {
    if (viewerLongPressTimer) {
      clearTimeout(viewerLongPressTimer);
      viewerLongPressTimer = null;
    }

    if (viewerDraggingHeading || viewerIsAdjustingAngle) {
      viewerDraggingHeading = false;
      viewerIsAdjustingAngle = false;
      updateViewerEditorBarUI();
      renderViewerCanvas();
      viewerPointers.delete(e.pointerId);
      isDragging = false;
      return;
    }

    // If it was a quick tap without significant dragging, handle editor tap
    const startPt = pointerStartPos;
    if (startPt && Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) < 8) {
      handleViewerCanvasTap(e.clientX, e.clientY);
    }

    viewerPointers.delete(e.pointerId);
    if (viewerPointers.size === 1) {
      const r = Array.from(viewerPointers.values())[0];
      lastX = r.x;
      lastY = r.y;
      isDragging = true;
    } else if (viewerPointers.size === 0) {
      isDragging = false;
      viewerInitialPinch = null;
    }
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    viewerPan.scale = Math.max(0.2, Math.min(6.0, viewerPan.scale * factor));
    viewerPan.userControlled = true;
    renderViewerCanvas();
  }, { passive: false });

  document.getElementById("btn-viewer-zoom-in")?.addEventListener("click", () => {
    viewerPan.scale = Math.min(viewerPan.scale * 1.25, 6.0);
    viewerPan.userControlled = true;
    renderViewerCanvas();
  });
  document.getElementById("btn-viewer-zoom-out")?.addEventListener("click", () => {
    viewerPan.scale = Math.max(viewerPan.scale / 1.25, 0.2);
    viewerPan.userControlled = true;
    renderViewerCanvas();
  });
  document.getElementById("btn-viewer-recenter")?.addEventListener("click", () => {
    viewerPan.userControlled = false;
    centerViewerMap();
    renderViewerCanvas();
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
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;

  // Inverse transform: screen pixel -> world coordinates
  const u = (sx - viewerPan.x) / viewerPan.scale;
  const v = (sy - viewerPan.y) / viewerPan.scale;
  const wx = viewerMetadata.origin.x + u * viewerMetadata.resolution;
  const wy = viewerMetadata.origin.y + (viewerMetadata.height - v) * viewerMetadata.resolution;

  if (viewerEditorMode === "edit_dock") {
    // Push previous state into undo stack
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
        // Recompute orientation between new dock and existing standoff
        const dx = viewerNewStandoff.x - viewerNewDock.x;
        const dy = viewerNewStandoff.y - viewerNewDock.y;
        const angle = Math.atan2(dy, dx);
        viewerNewDock.theta = angle;
        viewerNewStandoff.theta = angle;
      }
      viewerDockEditTarget = "standoff"; // Guide user to standoff next
    } else {
      if (!viewerNewDock) {
        viewerNewDock = { x: wx - 0.70, y: wy, theta: 0 };
      }
      viewerNewStandoff = { x: wx, y: wy };
      const dx = viewerNewStandoff.x - viewerNewDock.x;
      const dy = viewerNewStandoff.y - viewerNewDock.y;
      const angle = Math.atan2(dy, dx);
      viewerNewDock.theta = angle;
      viewerNewStandoff.theta = angle; // Robot faces away from dock (back towards dock)
    }
    updateViewerEditorBarUI();
    renderViewerCanvas();
  } else if (viewerEditorMode === "save_location") {
    // Tapping repositions the draft marker
    const prevTheta = viewerDraftPose ? viewerDraftPose.theta : 0;
    viewerDraftPose = { x: wx, y: wy, theta: prevTheta };
    updateViewerEditorBarUI();
    renderViewerCanvas();
  }
}

function centerViewerMap() {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas || !viewerMapImg) return;
  canvas.width = window.innerWidth || 800;
  canvas.height = window.innerHeight || 1280;
  const fitScale = Math.min((canvas.width * 0.85) / viewerMapImg.width, (canvas.height * 0.75) / viewerMapImg.height);
  viewerPan.scale = Math.max(0.5, fitScale);
  viewerPan.x = (canvas.width - viewerMapImg.width * viewerPan.scale) / 2;
  viewerPan.y = (canvas.height - viewerMapImg.height * viewerPan.scale) / 2;
}

function renderViewerCanvas() {
  const canvas = document.getElementById("map-viewer-canvas");
  if (!canvas || !viewerMapImg) return;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0B0F19";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Background radar grid
  ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
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

  // Draw Saved Waypoints (Stations)
  viewerWaypoints.forEach(wp => {
    if (wp.name === "Dock Standoff" || wp.name === "Charging Dock") return;
    const pt = toCanvasCoords(wp.x, wp.y);
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.fillStyle = "#3B82F6";
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillStyle = "#BFDBFE";
    ctx.textAlign = "center";
    ctx.fillText(wp.name, 0, 22);
    ctx.restore();
  });

  // Draw Dock & Standoff Poses
  const dock = viewerNewDock || viewerDockPose;
  const standoff = viewerNewStandoff || viewerStandoffPose;

  if (dock && standoff) {
    const dp = toCanvasCoords(dock.x, dock.y);
    const sp = toCanvasCoords(standoff.x, standoff.y);

    // Connecting dashed line
    ctx.save();
    ctx.strokeStyle = "rgba(16, 185, 129, 0.7)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(dp.x, dp.y);
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
    ctx.restore();

    // Distance Label on line
    const midX = (dp.x + sp.x) / 2;
    const midY = (dp.y + sp.y) / 2;
    const distMeters = Math.hypot(standoff.x - dock.x, standoff.y - dock.y);
    ctx.save();
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillStyle = "#6EE7B7";
    ctx.textAlign = "center";
    ctx.fillText(`${distMeters.toFixed(2)}m`, midX, midY - 8);
    ctx.restore();

    // Standoff Marker (🎯)
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.fillStyle = "#06B6D4";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillStyle = "#A5F3FC";
    ctx.textAlign = "center";
    ctx.fillText("Standoff", 0, 24);
    ctx.restore();

    // Dock Marker (⚡)
    ctx.save();
    ctx.translate(dp.x, dp.y);
    ctx.rotate(-dock.theta);
    ctx.fillStyle = "#10B981";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Heading arrow toward standoff
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
    ctx.fillText("⚡ Charging Dock", dp.x, dp.y - 20);
    ctx.restore();
  }

  // Draw Live Robot Marker if this map is active
  if (viewerMapName === activeMapName && liveRobotPose) {
    const rp = toCanvasCoords(liveRobotPose.x, liveRobotPose.y);
    ctx.save();
    ctx.translate(rp.x, rp.y);
    ctx.rotate(-liveRobotPose.yaw);
    ctx.fillStyle = "#F97316";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(10, -6);
    ctx.lineTo(10, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Draw Draft Pose Marker when in save_location mode
  if (viewerEditorMode === "save_location" && viewerDraftPose) {
    const dp = toCanvasCoords(viewerDraftPose.x, viewerDraftPose.y);
    ctx.save();
    ctx.translate(dp.x, dp.y);

    // Glowing outer ring
    ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, 2 * Math.PI);
    ctx.fill();

    // Center pin
    ctx.fillStyle = "#2563EB";
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Direction cone
    ctx.rotate(-viewerDraftPose.theta);
    ctx.fillStyle = "rgba(37, 99, 235, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 45, -Math.PI / 6, Math.PI / 6);
    ctx.closePath();
    ctx.fill();

    // Arrow pointer
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(12, -7);
    ctx.lineTo(12, 7);
    ctx.closePath();
    ctx.fill();

    // Draggable heading handle at 45px radius
    ctx.fillStyle = "#2563EB";
    ctx.beginPath();
    ctx.arc(45, 0, 9, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore();

    // Coordinate readout chip
    ctx.save();
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    const deg = Math.round(viewerDraftPose.theta * 180 / Math.PI);
    ctx.fillText(`📍 X: ${viewerDraftPose.x.toFixed(2)}m, Y: ${viewerDraftPose.y.toFixed(2)}m, θ: ${deg}°`, dp.x, dp.y - 32);
    ctx.restore();
  }
}

window.openMapViewer = async function(mapName, options = {}) {
  viewerMapName = mapName;
  viewerEditorMode = null;
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDraftPose = null;
  viewerDockUndoStack = [];
  viewerDockEditTarget = 'dock';

  const screen = document.getElementById("screen-map-viewer");
  const nameEl = document.getElementById("map-viewer-name");
  const badgeEl = document.getElementById("map-viewer-active-badge");
  const loadingEl = document.getElementById("map-viewer-loading");
  const editorBar = document.getElementById("map-viewer-editor-bar");
  const legendRobot = document.getElementById("legend-robot-item");

  if (screen) screen.style.display = "flex";
  if (nameEl) nameEl.textContent = mapName;
  if (badgeEl) badgeEl.style.display = (mapName === activeMapName) ? "inline-flex" : "none";
  if (legendRobot) legendRobot.style.display = (mapName === activeMapName) ? "flex" : "none";
  if (editorBar) editorBar.style.display = "none";
  if (loadingEl) loadingEl.style.display = "flex";

  initMapViewerInteractivity();

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

    // 2. Fetch metadata, waypoints, and dock pose
    const [infoRes, wpRes, dockRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/maps/current/info`),
      fetch(`${API_BASE}/api/v1/waypoints?map=${encodeURIComponent(mapName)}`),
      fetch(`${API_BASE}/api/v1/dock/pose`)
    ]);

    if (infoRes.ok) {
      const info = await infoRes.json();
      if (info.loaded) viewerMetadata = info;
    }

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
    renderViewerCanvas();

    if (options.mode === "save_location") {
      toggleViewerSaveLocation();
    }
  }
};

window.closeMapViewer = function() {
  const screen = document.getElementById("screen-map-viewer");
  if (screen) screen.style.display = "none";
  viewerEditorMode = null;
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDraftPose = null;
  viewerDockUndoStack = [];
};

function updateViewerEditorBarUI() {
  const editorBar = document.getElementById("map-viewer-editor-bar");
  const promptEl = document.getElementById("editor-bar-prompt");
  const actionsEl = document.getElementById("map-viewer-editor-bar")?.querySelector(".editor-bar-actions");
  if (!editorBar || !promptEl || !actionsEl) return;

  if (!viewerEditorMode) {
    editorBar.style.display = "none";
    return;
  }

  editorBar.style.display = "flex";

  if (viewerEditorMode === "save_location") {
    if (!viewerDraftPose) {
      promptEl.textContent = "Long-press on map to place marker & drag to set heading";
    } else {
      const deg = Math.round(viewerDraftPose.theta * 180 / Math.PI);
      promptEl.textContent = `Pose set (θ: ${deg}°)! Drag handle to rotate, then tap Save`;
    }
    actionsEl.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="confirmViewerSaveLocation()">✓ Save Waypoint</button>
    `;
  } else if (viewerEditorMode === "edit_dock") {
    if (viewerDockEditTarget === "dock") {
      promptEl.textContent = "⚡ Tap map to place Charging Dock position";
    } else {
      const dist = (viewerNewDock && viewerNewStandoff)
        ? ` (${Math.hypot(viewerNewStandoff.x - viewerNewDock.x, viewerNewStandoff.y - viewerNewDock.y).toFixed(2)}m)`
        : "";
      promptEl.textContent = `🎯 Tap map to place Standoff staging pose${dist}`;
    }

    const canUndo = viewerDockUndoStack.length > 0;
    actionsEl.innerHTML = `
      <div class="editor-segmented-group">
        <button type="button" class="editor-segmented-btn ${viewerDockEditTarget === 'dock' ? 'active' : ''}" onclick="setDockEditTarget('dock')">⚡ Dock</button>
        <button type="button" class="editor-segmented-btn ${viewerDockEditTarget === 'standoff' ? 'active' : ''}" onclick="setDockEditTarget('standoff')">🎯 Standoff</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" ${!canUndo ? 'disabled' : ''} onclick="undoViewerDock()" title="Undo last change">↩ Undo</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="cancelViewerEditMode()">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="saveViewerEditMode()">Save Changes</button>
    `;
  }
}

window.toggleViewerEditDock = function() {
  viewerEditorMode = "edit_dock";
  viewerDockEditTarget = "dock";
  viewerDockUndoStack = [];
  viewerNewDock = viewerDockPose ? { ...viewerDockPose } : null;
  viewerNewStandoff = viewerStandoffPose ? { ...viewerStandoffPose } : null;
  updateViewerEditorBarUI();
  renderViewerCanvas();
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
  viewerEditorMode = "save_location";
  viewerDraftPose = null;
  viewerIsAdjustingAngle = false;
  viewerDraggingHeading = false;
  updateViewerEditorBarUI();
  renderViewerCanvas();
};

window.promptViewerAddLocation = function() {
  toggleViewerSaveLocation();
};

window.confirmViewerSaveLocation = function() {
  if (!viewerDraftPose) {
    showToast("Long-press on map to place a location marker first", true);
    return;
  }
  openTouchKeyboard("Station Name:", async (name) => {
    if (!name || !name.trim()) return;
    const wpName = name.trim();
    try {
      showToast(`Saving station "${wpName}"...`);
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
      showToast(`Station "${wpName}" saved!`);
      cancelViewerEditMode();
      openMapViewer(viewerMapName);
      loadWaypoints();
    } catch (e) {
      showToast(`Failed to save station: ${e.message}`, true);
    }
  });
};

window.cancelViewerEditMode = function() {
  viewerEditorMode = null;
  viewerNewDock = null;
  viewerNewStandoff = null;
  viewerDraftPose = null;
  viewerDockUndoStack = [];
  const editorBar = document.getElementById("map-viewer-editor-bar");
  if (editorBar) editorBar.style.display = "none";
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
    let currentDx = 0;
    let isSwiping = false;
    let isScrolling = false;

    const resetOtherSwipes = () => {
      document.querySelectorAll(".swipeable-content.swiped-open").forEach(el => {
        if (el !== content) {
          el.style.transform = "translateX(0)";
          el.classList.remove("swiped-open");
        }
      });
    };

    content.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("a")) return;
      startX = e.clientX;
      startY = e.clientY;
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
        if (Math.abs(dx) > 8) {
          isSwiping = true;
          resetOtherSwipes();
        }
      }

      if (isSwiping) {
        const baseOffset = content.classList.contains("swiped-open") ? -90 : 0;
        currentDx = Math.min(20, Math.max(-120, baseOffset + dx));
        content.style.transform = `translateX(${currentDx}px)`;
      }
    });

    const finishSwipe = () => {
      if (!isSwiping) return;
      isSwiping = false;
      content.style.transition = "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
      if (currentDx < -45) {
        content.style.transform = "translateX(-90px)";
        content.classList.add("swiped-open");
      } else {
        content.style.transform = "translateX(0)";
        content.classList.remove("swiped-open");
      }
    };

    content.addEventListener("pointerup", finishSwipe);
    content.addEventListener("pointercancel", finishSwipe);
  });
}

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".swipeable-wrapper")) {
    document.querySelectorAll(".swipeable-content.swiped-open").forEach(el => {
      el.style.transform = "translateX(0)";
      el.classList.remove("swiped-open");
    });
  }
});

/* --------------------------------------------------------------------------
   11. Maps Subpage & Scoping
   -------------------------------------------------------------------------- */
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
    activeMapName = curData.name || curData.map_name || curData.current || data.current || (typeof maps[0] === 'string' ? maps[0] : maps[0]?.name) || "";

    // Update Hub Badge & Card Subtitle
    const hubMapDesc = document.getElementById("hub-active-map-name");
    if (hubMapDesc) hubMapDesc.textContent = activeMapName ? `Active: ${activeMapName}` : "No map loaded";

    const locSub = document.getElementById("locations-map-subtitle");
    if (locSub) locSub.textContent = `Showing stations on "${activeMapName || 'all'}"`;

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
                : `<button class="btn btn-primary btn-sm" onclick="activateMap('${escapeQuotes(mapName)}')">Load Map</button>`
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

window.activateMap = async function(mapName) {
  try {
    showToast(`Activating map "${mapName}"...`);
    await fetch(`${API_BASE}/api/v1/maps/${encodeURIComponent(mapName)}/activate`, {
      method: "POST"
    });
    activeMapName = mapName;
    showToast(`Map "${mapName}" activated!`);
    loadMaps();
    loadWaypoints();
    loadSchedules();
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
  list.innerHTML = `<div class="loading-spinner">Loading locations for "${activeMapName}"...</div>`;

  // Enable / disable Save Position button based on active map
  const addBtn = document.getElementById("btn-add-location");
  if (addBtn) {
    if (!activeMapName) {
      addBtn.disabled = true;
      addBtn.classList.add("disabled");
      addBtn.title = "No active map loaded";
    } else {
      addBtn.disabled = false;
      addBtn.classList.remove("disabled");
      addBtn.title = `Save position on ${activeMapName}`;
    }
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/waypoints`);
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
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No saved locations on "${activeMapName}". Tap "+ Save Position" to record a waypoint.</p>`;
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
    if (destEl) destEl.textContent = wpName;
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
  list.innerHTML = `<div class="loading-spinner">Loading missions...</div>`;

  try {
    const res = await fetch(`${API_BASE}/api/v1/missions`);
    const data = await res.json();
    const missions = data.missions || [];
    loadedMissionsCache = missions;

    const hubCount = document.getElementById("hub-missions-count");
    if (hubCount) hubCount.textContent = `${missions.length} Routines`;

    if (missions.length === 0) {
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No visual missions found. Create missions using the desktop or mobile mission planner.</p>`;
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
  list.innerHTML = `<div class="loading-spinner">Loading automated schedules...</div>`;

  try {
    const res = await fetch(`${API_BASE}/api/v1/schedules`);
    const data = await res.json();
    const schedules = data.schedules || [];

    const hubCount = document.getElementById("hub-schedules-count");
    if (hubCount) hubCount.textContent = `${schedules.length} Active`;

    if (schedules.length === 0) {
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No automated schedules configured. Tap "+ Add Schedule" to set automated dispatch.</p>`;
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
  const labelEl = document.getElementById("osk-prompt-label");
  const inputEl = document.getElementById("osk-input-display");

  if (labelEl) labelEl.textContent = promptLabel || "Enter Text";
  if (inputEl) {
    inputEl.type = isPassword ? "password" : "text";
    inputEl.value = defaultValue || "";
  }

  currentOskLayer = "lower";
  renderGnomeOsk();

  if (panel) {
    panel.classList.add("osk-visible");
    panel.setAttribute("aria-hidden", "false");
  }
};

window.closeTouchKeyboard = function(confirmed) {
  const panel = document.getElementById("gnome-osk");
  const inputEl = document.getElementById("osk-input-display");
  const val = inputEl ? inputEl.value : "";

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
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        const stateText = document.getElementById("state-text");
        if (stateText) stateText.textContent = (stateData.mode || stateData.state || "IDLE").toUpperCase();

        const robotIp = document.getElementById("robot-ip");
        if (robotIp) robotIp.textContent = stateData.ip || (window.location.hostname || "127.0.0.1");

        // Immediately update battery from state if present
        if (stateData.battery) {
          updatePowerState(stateData.battery);
        }

        // Check if relocalization popup is required or needs auto-dismissal
        checkRelocalizationRequired(stateData);

        // Navigation state
        if (stateData.mode === "navigation" || stateData.state === "navigating") {
          isNavigating = true;
        } else {
          isNavigating = false;
          const navScreen = document.getElementById("screen-nav-progress");
          if (navScreen && navScreen.style.display === "flex") {
            navScreen.style.display = "none";
          }
        }
      }

      // Parallelize status queries for maximum responsiveness and zero UI stutter
      const [navResult, batResult, misResult, uiResult] = await Promise.allSettled([
        fetch(`${API_BASE}/api/v1/navigation/status`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/state/battery`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/missions/status`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/v1/missions/active_ui_interaction`).then(r => r.ok ? r.json() : null)
      ]);

      // 1. Navigation
      if (navResult.status === "fulfilled" && navResult.value) {
        updateNavigationState(navResult.value);
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

      // 5. Wi-Fi & IP (debounced to every 10 seconds)
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

