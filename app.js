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
    promptSaveCurrentLocation();
  });
}

/* --------------------------------------------------------------------------
/* --------------------------------------------------------------------------
   6. Navigation Progress & Auto-Charging Watcher
   -------------------------------------------------------------------------- */
function updateNavigationState(navData) {
  if (!navData) return;
  try {
    const isNav = !!(navData.is_navigating || navData.status === "navigating" || navData.status === "executing");
    isNavigating = isNav;
    const navScreen = document.getElementById("screen-nav-progress");
    if (navScreen) {
      if (isNav) {
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
      } else if (navScreen.style.display === "flex") {
        navScreen.style.display = "none";
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

function startLiveMapRenderer() {
  clearInterval(liveMapRendererInterval);
  const canvas = document.getElementById("mapping-live-canvas");
  const loadingEl = document.getElementById("mapping-canvas-loading");
  if (loadingEl) loadingEl.style.display = "flex";
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const renderFrame = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/maps/current/image?rotate=0&t=${Date.now()}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const img = new Image();
      img.onload = () => {
        canvas.width = 640;
        canvas.height = 640;

        // Dark slate radar background
        ctx.fillStyle = "#0F172A";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid lines
        ctx.strokeStyle = "rgba(51, 65, 85, 0.4)";
        ctx.lineWidth = 1;
        const step = 32;
        for (let x = 0; x < canvas.width; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }

        // Maintain aspect ratio and scale sharp
        const scale = Math.min((canvas.width - 20) / img.width, (canvas.height - 20) / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (canvas.width - dw) / 2;
        const dy = (canvas.height - dh) / 2;

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, dx, dy, dw, dh);

        // Center crosshair / robot marker
        ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
        ctx.lineWidth = 1.5;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
        ctx.stroke();

        if (loadingEl) loadingEl.style.display = "none";
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(blob);
    } catch (_) {
      // Map not yet published by SLAM, keep placeholder
    }
  };

  renderFrame();
  liveMapRendererInterval = setInterval(renderFrame, 1000);
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
      // Determine target mode: restore previously active map if valid, else switch to idle
      const target = (activeMapName && activeMapName !== "default")
        ? { mode: "navigation", map: activeMapName }
        : { mode: "idle" };

      await fetch(`${API_BASE}/api/v1/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target)
      });

      // Poll mode until mode !== 'mapping' (up to 14 attempts = 7 seconds)
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
      try {
        showToast(`Saving map "${mapName}"...`);
        const res = await fetch(`${API_BASE}/api/v1/mapping/finish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: mapName.trim() })
        });
        const data = await res.json();
        stopMappingLive();
        showToast(`Map "${mapName}" saved & activated! Setup completed.`);
        loadMaps();
        setSwipeIndex(1); // Dashboard
      } catch (e) {
        showToast(`Error saving map: ${e.message}`, true);
      }
    });
  });
}

window.startSlamMapping = async function() {
  try {
    showToast("Initializing SLAM mapping mode...");
    await fetch(`${API_BASE}/api/v1/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "mapping" })
    });

    const screen = document.getElementById("screen-mapping-live");
    if (screen) screen.style.display = "flex";

    // Start live SLAM occupancy grid renderer
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
   10. Maps Subpage & Scoping
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
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No saved maps available. Click "+ Create New Map" to start SLAM.</p>`;
      return;
    }

    list.innerHTML = maps.map(m => {
      const mapName = typeof m === 'string' ? m : (m.name || m.id);
      const isCur = mapName === activeMapName;
      const resText = typeof m === 'object' && m.resolution ? `${m.resolution}m/px` : "2D Grid Map";
      const dateText = typeof m === 'object' && m.created_at ? new Date(m.created_at).toLocaleDateString() : "Ready";
      return `
        <div class="map-item-card ${isCur ? 'is-active-map' : ''}">
          <div class="map-item-info">
            <h3>${escapeHtml(mapName)}</h3>
            <p>${resText} • ${dateText}</p>
          </div>
          <div>
            ${isCur 
              ? `<span class="badge badge-ok">CURRENT ACTIVE MAP</span>`
              : `<button class="btn btn-secondary btn-sm" onclick="activateMap('${escapeQuotes(mapName)}')">Switch to this Map</button>`
            }
          </div>
        </div>
      `;
    }).join("");
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

/* --------------------------------------------------------------------------
   11. Locations Subpage (Current Map Scoped)
   -------------------------------------------------------------------------- */
async function loadWaypoints() {
  const list = document.getElementById("locations-full-list");
  if (!list) return;
  list.innerHTML = `<div class="loading-spinner">Loading locations for "${activeMapName}"...</div>`;

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
      <div class="location-item">
        <div class="location-item-info">
          <h3>${escapeHtml(wp.name)}</h3>
          <p>X: ${(wp.x || 0).toFixed(2)}m • Y: ${(wp.y || 0).toFixed(2)}m</p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" onclick="navigateToLocation('${escapeQuotes(wp.name)}')">Dispatch Here</button>
          <button class="btn btn-secondary btn-sm" onclick="deleteWaypoint('${escapeQuotes(wp.name)}')">✕</button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    list.innerHTML = `<p style="color: var(--danger); padding: 16px;">Failed to load locations: ${escapeHtml(e.message)}</p>`;
  }
}

window.navigateToLocation = async function(wpName) {
  try {
    showToast(`Navigating to "${wpName}"...`);
    await fetch(`${API_BASE}/api/v1/navigation/goto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoint: wpName })
    });

    // Show navigation progress screen
    const navScreen = document.getElementById("screen-nav-progress");
    const destEl = document.getElementById("nav-screen-destination");
    if (destEl) destEl.textContent = wpName;
    if (navScreen) navScreen.style.display = "flex";

    triggerFaceExpression("thinking");
  } catch (e) {
    showToast(`Navigation failed: ${e.message}`, true);
  }
};

window.deleteWaypoint = async function(wpName) {
  if (confirm(`Delete waypoint "${wpName}"?`)) {
    try {
      await fetch(`${API_BASE}/api/v1/waypoints/${encodeURIComponent(wpName)}`, { method: "DELETE" });
      showToast(`Deleted "${wpName}".`);
      loadWaypoints();
    } catch (e) {
      showToast(`Delete failed: ${e.message}`, true);
    }
  }
};

function promptSaveCurrentLocation() {
  openTouchKeyboard("Enter Station Name:", async (wpName) => {
    if (!wpName || !wpName.trim()) return;
    try {
      showToast(`Saving position "${wpName}"...`);
      await fetch(`${API_BASE}/api/v1/waypoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wpName.trim(), map: activeMapName })
      });
      showToast(`Saved location "${wpName}"!`);
      loadWaypoints();
    } catch (e) {
      showToast(`Failed to save location: ${e.message}`, true);
    }
  });
}

/* --------------------------------------------------------------------------
   12. Missions Subpage & Execution Screen
   -------------------------------------------------------------------------- */
async function loadMissions() {
  const list = document.getElementById("missions-list");
  if (!list) return;
  list.innerHTML = `<div class="loading-spinner">Loading missions...</div>`;

  try {
    const res = await fetch(`${API_BASE}/api/v1/missions`);
    const data = await res.json();
    const missions = data.missions || [];

    const hubCount = document.getElementById("hub-missions-count");
    if (hubCount) hubCount.textContent = `${missions.length} Routines`;

    if (missions.length === 0) {
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No visual missions found. Create missions using the desktop or mobile mission planner.</p>`;
      return;
    }

    list.innerHTML = missions.map(m => `
      <div class="mission-item-card">
        <div class="mission-item-info">
          <h3>${escapeHtml(m.name)}</h3>
          <p>${escapeHtml(m.description || "Visual node workflow routine")}</p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" onclick="startMission('${escapeQuotes(m.id || m.name)}')">Launch Routine</button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    list.innerHTML = `<p style="color: var(--danger); padding: 16px;">Failed to load missions: ${escapeHtml(e.message)}</p>`;
  }
}

window.startMission = async function(missionId) {
  try {
    showToast(`Starting mission...`);
    await fetch(`${API_BASE}/api/v1/missions/${encodeURIComponent(missionId)}/start`, { method: "POST" });
    activeMissionId = missionId;
    closeSubpage();
    triggerFaceExpression("happy");
  } catch (e) {
    showToast(`Failed to start mission: ${e.message}`, true);
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

  // Show mission progress screen if not already visible
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
   13. Schedules Subpage
   -------------------------------------------------------------------------- */
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
      list.innerHTML = `<p style="color: var(--text-secondary); padding: 16px;">No automated schedules configured for this robot.</p>`;
      return;
    }

    list.innerHTML = schedules.map(s => `
      <div class="schedule-item-card">
        <div class="schedule-item-info">
          <h3>${escapeHtml(s.name || s.mission_id || "Patrol Routine")}</h3>
          <p>Cron: <code>${escapeHtml(s.cron || s.expression || "Daily")}</code> • Next: ${s.next_run || "Scheduled"}</p>
        </div>
        <div>
          <span class="badge badge-ok">${s.enabled !== false ? "ENABLED" : "PAUSED"}</span>
        </div>
      </div>
    `).join("");
  } catch (e) {
    list.innerHTML = `<p style="color: var(--danger); padding: 16px;">Failed to load schedules: ${escapeHtml(e.message)}</p>`;
  }
}

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
   15. Fast Built-In On-Screen Touch Keyboard
   -------------------------------------------------------------------------- */
function initTouchKeyboard() {
  const grid = document.getElementById("touch-keyboard-grid");
  if (!grid) return;

  const rows = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "_"],
    ["z", "x", "c", "v", "b", "n", "m", "-", "."]
  ];

  let html = rows.map(row => `
    <div class="keyboard-row">
      ${row.map(k => `<button type="button" class="keyboard-key" onclick="appendKeyChar('${k}')">${k}</button>`).join("")}
    </div>
  `).join("");

  html += `
    <div class="keyboard-row">
      <button type="button" class="keyboard-key keyboard-key-wide" onclick="backspaceKey()">⌫ Del</button>
      <button type="button" class="keyboard-key keyboard-key-space" onclick="appendKeyChar(' ')">Space</button>
      <button type="button" class="keyboard-key keyboard-key-wide" onclick="clearKeyInput()">Clear</button>
    </div>
  `;

  grid.innerHTML = html;
}

window.openTouchKeyboard = function(promptLabel, callback) {
  touchKeyboardCallback = callback;
  const modal = document.getElementById("modal-touch-keyboard");
  const label = document.getElementById("keyboard-prompt-label");
  const input = document.getElementById("keyboard-input-display");
  if (label) label.textContent = promptLabel;
  if (input) {
    input.value = "";
    input.focus();
  }
  if (modal) modal.style.display = "flex";
};

window.closeTouchKeyboard = function(confirmed) {
  const modal = document.getElementById("modal-touch-keyboard");
  const input = document.getElementById("keyboard-input-display");
  const val = input ? input.value : "";
  if (modal) modal.style.display = "none";
  if (confirmed && touchKeyboardCallback) {
    touchKeyboardCallback(val);
  }
  touchKeyboardCallback = null;
};

window.appendKeyChar = function(char) {
  const input = document.getElementById("keyboard-input-display");
  if (input) input.value += char;
};

window.backspaceKey = function() {
  const input = document.getElementById("keyboard-input-display");
  if (input && input.value.length > 0) {
    input.value = input.value.slice(0, -1);
  }
};

window.clearKeyInput = function() {
  const input = document.getElementById("keyboard-input-display");
  if (input) input.value = "";
};

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

