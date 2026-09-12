// NavPro Mini - Onboard Robot Kiosk UI Controller
// Connects to local navpromini_sdk server (port 8090)

const API_BASE = window.location.port === "8090" 
  ? window.location.origin 
  : "http://" + (window.location.hostname || "127.0.0.1") + ":8090";

let currentTab = "dashboard";
let activeInteractionId = null;
let interactionTimerInterval = null;
let interactionRemaining = 0;
let interactionTotal = 0;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  initClock();
  initTabs();
  initHubTiles();
  initActionButtons();
  initModals();
  startPolling();
});

// Clock
function initClock() {
  const clockEl = document.getElementById("clock-display");
  function update() {
    const now = new Date();
    clockEl.textContent = now.toTimeString().split(" ")[0];
  }
  update();
  setInterval(update, 1000);
}

// Tab Switching
function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      switchTab(target);
    });
  });
}

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll(".nav-tab").forEach(t => {
    t.classList.toggle("active", t.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-page").forEach(page => {
    page.classList.toggle("active", page.id === "tab-" + tabId);
  });

  if (tabId === "locations") loadWaypoints();
  if (tabId === "missions") loadMissions();
}

// Hub Quick Navigation Tiles & Demo Dynamic Popup
function initHubTiles() {
  let lastClickTime = 0;
  const debounce = (fn) => (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    const now = Date.now();
    if (now - lastClickTime < 450) return;
    lastClickTime = now;
    fn();
  };

  document.getElementById("hub-tile-missions")?.addEventListener("click", debounce(() => {
    switchTab("missions");
  }));

  document.getElementById("hub-tile-locations")?.addEventListener("click", debounce(() => {
    switchTab("locations");
  }));

  document.getElementById("hub-tile-schedules")?.addEventListener("click", debounce(() => {
    showToast("Opening automated schedules routine...");
    switchTab("missions");
  }));

  const triggerTestPopup = () => {
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
  };

  document.getElementById("hub-tile-random")?.addEventListener("click", debounce(triggerTestPopup));
  document.getElementById("btn-trigger-test-popup")?.addEventListener("click", debounce(triggerTestPopup));
}

// Action Buttons
function initActionButtons() {
  // Keyboard Toggle
  document.getElementById("btn-keyboard-toggle")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/system/keyboard/toggle`, { method: "POST" });
    } catch (e) {
      console.warn("Keyboard toggle endpoint not reachable", e);
    }
  });

  // E-Stop
  document.getElementById("btn-estop")?.addEventListener("click", async () => {
    if (confirm("Trigger EMERGENCY STOP?")) {
      try {
        await fetch(`${API_BASE}/api/v1/robot/emergency_stop`, { method: "POST" });
        alert("EMERGENCY STOP TRIGGERED!");
      } catch (e) {
        console.error("Estop error:", e);
      }
    }
  });

  // Dock
  document.getElementById("btn-dock")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/robot/dock`, { method: "POST" });
      showToast("Auto-docking initiated...");
    } catch (e) {
      showToast("Docking failed: " + e.message, true);
    }
  });

  // Undock
  document.getElementById("btn-undock")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/robot/undock`, { method: "POST" });
      showToast("Undocking initiated...");
    } catch (e) {
      showToast("Undock failed: " + e.message, true);
    }
  });

  // Relocalize
  document.getElementById("btn-relocalize")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/navigation/relocalize`, { method: "POST" });
      showToast("Global relocalization triggered");
    } catch (e) {
      showToast("Relocalization failed: " + e.message, true);
    }
  });

  // Stop All / Halt
  document.getElementById("btn-stop-all")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/navigation/cancel`, { method: "POST" });
      showToast("Motion halted");
    } catch (e) {
      showToast("Halt failed: " + e.message, true);
    }
  });

  // Mission Pause/Abort
  document.getElementById("btn-mission-pause")?.addEventListener("click", async () => {
    try {
      await fetch(`${API_BASE}/api/v1/missions/pause`, { method: "POST" });
      showToast("Mission pause requested");
    } catch (e) {
      showToast("Pause failed: " + e.message, true);
    }
  });

  document.getElementById("btn-mission-cancel")?.addEventListener("click", async () => {
    if (confirm("Abort active mission?")) {
      try {
        await fetch(`${API_BASE}/api/v1/missions/cancel`, { method: "POST" });
        showToast("Mission cancelled");
      } catch (e) {
        showToast("Cancel failed: " + e.message, true);
      }
    }
  });
}

// Modal handling
function initModals() {
  const modal = document.getElementById("save-location-modal");
  const openBtns = [document.getElementById("btn-quick-save-location"), document.getElementById("btn-add-location")];
  const cancelBtn = document.getElementById("btn-cancel-save-location");
  const confirmBtn = document.getElementById("btn-confirm-save-location");
  const input = document.getElementById("new-wp-name");

  openBtns.forEach(btn => {
    btn?.addEventListener("click", () => {
      input.value = "";
      modal.style.display = "flex";
      input.focus();
    });
  });

  cancelBtn?.addEventListener("click", () => {
    modal.style.display = "none";
  });

  confirmBtn?.addEventListener("click", async () => {
    const name = input.value.trim();
    if (!name) {
      alert("Please enter a waypoint name");
      return;
    }
    confirmBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/v1/waypoints/save_current_location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name })
      });
      if (res.ok) {
        showToast(`Saved waypoint "${name}"`);
        modal.style.display = "none";
        loadWaypoints();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Error: ${err.detail || "Failed to save"}`, true);
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, true);
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

// WebSocket Real-time Event Subscription (Push-based, Instant Reactive UI)
let eventsWs = null;
let wsConnected = false;

function initEventsWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let host = window.location.host;
  if (!host || host === "") {
    host = "127.0.0.1:8090";
  }
  const wsUrl = `${protocol}//${host}/api/v1/events`;

  try {
    eventsWs = new WebSocket(wsUrl);

    eventsWs.onopen = () => {
      console.log("[WebSocket] Connected to NavPro Mini event stream at", wsUrl);
      wsConnected = true;
      eventsWs.send(JSON.stringify({
        action: "subscribe",
        streams: ["events", "battery", "dock_status"]
      }));
      checkActiveInteraction();
    };

    eventsWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.stream === "events" && msg.data) {
          const e = msg.data;
          if (e.event === "mission.ui_interaction" && e.data) {
            handleActiveInteraction(e.data);
          } else if (e.event === "mission.ui_interaction_dismissed") {
            dismissInteraction();
          } else if (e.event === "mission.status") {
            if (e.data && e.data.active_interaction) {
              handleActiveInteraction(e.data.active_interaction);
            } else if (e.data && !e.data.active_interaction) {
              dismissInteraction();
            }
          }
        }
      } catch (err) {
        console.warn("[WebSocket] Error handling event:", err);
      }
    };

    eventsWs.onclose = () => {
      wsConnected = false;
      setTimeout(initEventsWebSocket, 3000);
    };

    eventsWs.onerror = () => {
      wsConnected = false;
    };
  } catch (e) {
    wsConnected = false;
    setTimeout(initEventsWebSocket, 3000);
  }
}

async function checkActiveInteraction() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/missions/active_ui_interaction`);
    if (res.ok) {
      const data = await res.json();
      const inter = data && (data.interaction || data.active_interaction || (data.active && typeof data.active === "object" ? data.active : null));
      if (inter && (inter.interaction_id || inter.node_id || inter.id)) {
        handleActiveInteraction(inter);
      } else {
        dismissInteraction();
      }
    }
  } catch (e) {
    // ignore
  }
}

// Polling loop (State updates + fallback)
function startPolling() {
  initEventsWebSocket();
  pollStatus();
  setInterval(pollStatus, 2000);
  loadWaypoints();
  loadMissions();
}

async function pollStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/state`);
    if (res.ok) {
      const state = await res.json();
      updateHeader(state);
      updateDashboard(state);
    }
  } catch (e) {
    document.getElementById("robot-ip").textContent = "Offline / Connecting...";
  }

  // If WebSocket is not connected, use HTTP polling as fallback
  if (!wsConnected) {
    checkActiveInteraction();
  }
}

function updateHeader(state) {
  document.getElementById("robot-ip").textContent = window.location.hostname || "127.0.0.1";
  
  const stateText = document.getElementById("state-text");
  const statePill = document.getElementById("state-pill");
  const currentStatus = (state.status || state.navigation_status || "IDLE").toUpperCase();
  stateText.textContent = currentStatus;

  if (currentStatus.includes("ERROR") || currentStatus.includes("ESTOP")) {
    statePill.style.background = "rgba(239, 68, 68, 0.2)";
    statePill.style.borderColor = "#ef4444";
  } else if (currentStatus.includes("NAVIGATING") || currentStatus.includes("RUNNING")) {
    statePill.style.background = "rgba(16, 185, 129, 0.2)";
    statePill.style.borderColor = "#10b981";
  } else {
    statePill.style.background = "rgba(255, 255, 255, 0.06)";
    statePill.style.borderColor = "rgba(255, 255, 255, 0.12)";
  }

  // Battery
  const batt = state.battery || {};
  const pct = batt.percentage !== undefined ? Math.round(batt.percentage) : "--";
  const volt = batt.voltage !== undefined ? batt.voltage.toFixed(1) : "--.-";
  const charging = batt.charging || batt.is_charging || false;

  document.getElementById("battery-pct").textContent = `${pct}%`;
  document.getElementById("battery-volt").textContent = `${volt}V`;
  document.getElementById("charging-bolt").style.display = charging ? "inline" : "none";

  // Power Tab Stats
  const gaugePct = document.getElementById("gauge-battery-pct");
  if (gaugePct) gaugePct.textContent = `${pct}%`;
  const gaugeStatus = document.getElementById("gauge-battery-status");
  if (gaugeStatus) gaugeStatus.textContent = charging ? "Charging" : "Discharging";
  const statVolt = document.getElementById("stat-voltage");
  if (statVolt) statVolt.textContent = `${volt} V`;
  const statCharge = document.getElementById("stat-charging-state");
  if (statCharge) statCharge.textContent = charging ? "Connected to Charger" : "Operating on Battery";
}

function updateDashboard(state) {
  const mission = state.active_mission || state.mission || null;
  const banner = document.getElementById("mission-floating-banner");
  const title = document.getElementById("active-mission-title");
  const progressBar = document.getElementById("mission-progress-bar");
  const nodeLabel = document.getElementById("mission-node-label");

  const isRunning = mission && (mission.status === "running" || mission.status === "in_progress" || mission.status === "waiting_for_user" || mission.status === "paused" || state.status === "running");

  if (isRunning) {
    if (banner) banner.style.display = "flex";
    if (title) title.textContent = mission?.mission_name || mission?.name || "Active Mission";
    const progress = mission?.progress_pct || mission?.progress || 0;
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (nodeLabel) nodeLabel.textContent = `Node: ${mission?.current_node_title || mission?.current_node_id || mission?.active_step || "--"}`;
  } else {
    if (banner) banner.style.display = "none";
  }
}

// Waypoints
async function loadWaypoints() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/waypoints`);
    if (!res.ok) return;
    const data = await res.json();
    const wps = Array.isArray(data) ? data : (data.waypoints || []);
    renderQuickWaypoints(wps);
    renderFullWaypoints(wps);
  } catch (e) {
    console.error("Failed to load waypoints:", e);
  }
}

function renderQuickWaypoints(wps) {
  const grid = document.getElementById("locations-quick-grid");
  if (!grid) return;
  if (!wps || wps.length === 0) {
    grid.innerHTML = `<div class="empty-state">No saved waypoints found.</div>`;
    return;
  }
  grid.innerHTML = wps.map(wp => {
    const name = wp.name || wp.id;
    return `
      <div class="location-chip" onclick="navigateToWaypoint('${name}')">
        <span class="chip-pin">📍</span>
        <div class="chip-info">
          <div class="chip-name">${name}</div>
          <div class="chip-coords">x: ${(wp.x || 0).toFixed(2)}, y: ${(wp.y || 0).toFixed(2)}</div>
        </div>
        <button class="chip-go-btn" title="Navigate Here">GO</button>
      </div>
    `;
  }).join("");
}

function renderFullWaypoints(wps) {
  const list = document.getElementById("locations-full-list");
  if (!list) return;
  if (!wps || wps.length === 0) {
    list.innerHTML = `<div class="empty-state">No saved locations found.</div>`;
    return;
  }
  list.innerHTML = wps.map(wp => {
    const name = wp.name || wp.id;
    return `
      <div class="location-item-row">
        <div class="item-left">
          <span class="location-icon">📍</span>
          <div>
            <h4 class="location-item-name">${name}</h4>
            <span class="location-item-coords">X: ${(wp.x||0).toFixed(3)} | Y: ${(wp.y||0).toFixed(3)} | Yaw: ${(wp.yaw||wp.theta||0).toFixed(2)} rad</span>
          </div>
        </div>
        <button class="btn btn-primary" onclick="navigateToWaypoint('${name}')">Navigate Here</button>
      </div>
    `;
  }).join("");
}

window.navigateToWaypoint = async function(name) {
  if (confirm(`Navigate robot to waypoint "${name}"?`)) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/navigation/navigate_to_waypoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoint_name: name })
      });
      if (res.ok) {
        showToast(`Dispatched to ${name}`);
        switchTab("dashboard");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Failed: ${err.detail || "Error"}`, true);
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, true);
    }
  }
};

// Missions
async function loadMissions() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/missions`);
    if (!res.ok) return;
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.missions || []);
    renderMissions(list);
  } catch (e) {
    console.error("Failed to load missions:", e);
  }
}

function renderMissions(missions) {
  const container = document.getElementById("missions-list");
  if (!container) return;
  if (!missions || missions.length === 0) {
    container.innerHTML = `<div class="empty-state">No missions configured.</div>`;
    return;
  }
  container.innerHTML = missions.map(m => {
    const id = m.mission_id || m.id;
    const name = m.mission_name || m.name || id;
    const desc = m.description || (m.steps ? `${m.steps.length} steps` : "Mission Plan");
    return `
      <div class="mission-item-row">
        <div class="item-left">
          <span class="mission-icon">⚡</span>
          <div>
            <h4 class="mission-item-name">${name}</h4>
            <p class="mission-item-desc">${desc}</p>
          </div>
        </div>
        <div class="mission-item-actions" style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-outline-danger btn-sm" onclick="deleteMission('${id}', '${name.replace(/'/g, "\\'")}')" title="Delete Mission">🗑️ Delete</button>
          <button class="btn btn-primary" onclick="executeMission('${id}')">Run Mission</button>
        </div>
      </div>
    `;
  }).join("");
}

window.deleteMission = async function(id, name) {
  if (!confirm(`Are you sure you want to permanently delete mission "${name || id}"?\n\nThis action cannot be undone.`)) {
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/v1/missions/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    if (res.ok) {
      showToast(`Mission deleted.`);
      loadMissions();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(`Delete failed: ${err.message || err.detail || "Error"}`, true);
    }
  } catch (e) {
    showToast(`Delete error: ${e.message}`, true);
  }
};

window.executeMission = async function(id) {
  if (confirm(`Launch mission ${id}?`)) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/missions/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission_id: id })
      });
      if (res.ok) {
        showToast(`Mission started!`);
        switchTab("dashboard");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Failed: ${err.detail || "Error starting mission"}`, true);
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, true);
    }
  }
};

// =================================================================
// DYNAMIC INTERACTIVE UI KIOSK MODAL
// =================================================================
function handleActiveInteraction(interaction) {
  // Target filtering: If explicitly targeted ONLY at operator_app, do not show on robot screen
  const target = (interaction.target || "robot_screen").toLowerCase();
  if (target === "operator_app") {
    dismissInteraction();
    return;
  }

  const overlay = document.getElementById("interaction-overlay");
  const interId = interaction.interaction_id || interaction.id || interaction.node_id;

  if (activeInteractionId === interId) {
    return; // Already rendering this interaction
  }

  activeInteractionId = interId;
  overlay.style.display = "flex";

  // Set Title & Message
  document.getElementById("interaction-title").textContent = interaction.title || "Action Required";
  document.getElementById("interaction-message").textContent = interaction.message || "";

  // Image / Media Banner
  const mediaEl = document.getElementById("interaction-media");
  const imgEl = document.getElementById("interaction-img");
  const mediaUrl = interaction.media_url || interaction.image_url;
  if (mediaUrl && mediaEl && imgEl) {
    imgEl.src = mediaUrl;
    mediaEl.style.display = "block";
  } else if (mediaEl) {
    mediaEl.style.display = "none";
  }

  // Timer Setup
  clearInterval(interactionTimerInterval);
  const timeoutSec = Number(interaction.timeout_sec || interaction.timeout || 60);
  interactionTotal = timeoutSec;
  interactionRemaining = timeoutSec;

  const timerChip = document.getElementById("interaction-timer-sec");
  const progressFill = document.getElementById("timer-progress-fill");

  const timerChipWrap = document.getElementById("interaction-timer-chip");

  function applyTimerTheme(rem) {
    if (!timerChipWrap || !progressFill) return;
    if (rem > 15) {
      timerChip.style.color = "var(--success)";
      timerChipWrap.style.borderColor = "var(--success)";
      progressFill.style.background = "linear-gradient(90deg, var(--success), var(--accent))";
    } else if (rem > 5) {
      timerChip.style.color = "var(--warning)";
      timerChipWrap.style.borderColor = "var(--warning)";
      progressFill.style.background = "linear-gradient(90deg, var(--warning), #FBBF24)";
    } else {
      timerChip.style.color = "var(--danger)";
      timerChipWrap.style.borderColor = "var(--danger)";
      progressFill.style.background = "linear-gradient(90deg, var(--danger), #F87171)";
    }
  }

  if (timeoutSec > 0) {
    timerChip.textContent = `${timeoutSec.toFixed(1)}s`;
    progressFill.style.width = "100%";
    applyTimerTheme(timeoutSec);

    interactionTimerInterval = setInterval(() => {
      interactionRemaining -= 0.2;
      if (interactionRemaining <= 0) {
        clearInterval(interactionTimerInterval);
        dismissInteraction();
      } else {
        timerChip.textContent = `${interactionRemaining.toFixed(1)}s`;
        const pct = (interactionRemaining / interactionTotal) * 100;
        progressFill.style.width = `${pct}%`;
        applyTimerTheme(interactionRemaining);
      }
    }, 200);
  } else {
    timerChip.textContent = "No Limit";
    progressFill.style.width = "100%";
    applyTimerTheme(999);
  }

  // Render Mode Content
  const formEl = document.getElementById("kiosk-form");
  const choicesEl = document.getElementById("kiosk-choices");
  const destEl = document.getElementById("kiosk-destinations");

  formEl.style.display = "none";
  choicesEl.style.display = "none";
  destEl.style.display = "none";

  const type = (interaction.subtype || interaction.interaction_type || interaction.type || (Array.isArray(interaction.fields) && interaction.fields.length ? "form" : "choices")).toLowerCase();

  if (type === "form" || type === "dynamic_form" || (Array.isArray(interaction.fields) && interaction.fields.length > 0 && type !== "choice" && type !== "choices")) {
    renderInteractionForm(interaction);
    formEl.style.display = "block";
  } else if (type === "destination_picker" || type === "kiosk") {
    renderInteractionDestinations(interaction);
    destEl.style.display = "block";
  } else {
    // Default choices / buttons
    renderInteractionChoices(interaction);
    choicesEl.style.display = "block";
  }
}

function renderInteractionChoices(interaction) {
  const container = document.getElementById("choices-buttons-grid");
  const choices = interaction.options || interaction.choices || interaction.buttons || ["Confirm", "Cancel"];

  container.innerHTML = choices.map(choice => {
    const label = typeof choice === "string" ? choice : (choice.label || choice.text || "Option");
    const val = typeof choice === "string" ? choice : (choice.value || label);
    return `<button class="kiosk-choice-btn" onclick="submitInteractionChoice('${val}')">${label}</button>`;
  }).join("");
}

window.submitInteractionChoice = async function(choiceValue) {
  try {
    await fetch(`${API_BASE}/api/v1/missions/ui_response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interaction_id: activeInteractionId,
        action: "selected",
        selected: choiceValue
      })
    });
    showToast(`Submitted: ${choiceValue}`);
    dismissInteraction();
  } catch (e) {
    showToast(`Submission failed: ${e.message}`, true);
  }
};

function renderInteractionForm(interaction) {
  const container = document.getElementById("form-fields-container");
  const formEl = document.getElementById("kiosk-form");
  const fields = interaction.fields || [];

  container.innerHTML = fields.map(f => {
    const key = f.key || f.name;
    const label = f.label || key;
    const ftype = (f.type || "text").toLowerCase();
    const req = f.required ? "required" : "";

    if (ftype === "checkbox" || ftype === "boolean") {
      return `
        <div class="kiosk-field-group kiosk-checkbox-group">
          <label class="kiosk-checkbox-label">
            <input type="checkbox" name="${key}" ${f.default_value ? "checked" : ""}>
            <span>${label}</span>
          </label>
        </div>
      `;
    } else if (ftype === "select" && Array.isArray(f.options)) {
      const opts = f.options.map(opt => {
        const oval = typeof opt === "string" ? opt : opt.value;
        const olbl = typeof opt === "string" ? opt : opt.label;
        return `<option value="${oval}">${olbl}</option>`;
      }).join("");
      return `
        <div class="kiosk-field-group">
          <label>${label}</label>
          <div class="kiosk-select-wrap">
            <select name="${key}" class="kiosk-input kiosk-select" ${req}>${opts}</select>
            <div class="kiosk-select-arrow">▼</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="kiosk-field-group">
          <label>${label}</label>
          <input type="${ftype === "number" ? "number" : "text"}" name="${key}" class="kiosk-input" value="${f.default_value || ""}" ${req}>
        </div>
      `;
    }
  }).join("");

  formEl.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(formEl);
    const data = {};
    for (const [k, v] of formData.entries()) {
      data[k] = v;
    }
    // handle unchecked checkboxes
    fields.forEach(f => {
      if (f.type === "checkbox" || f.type === "boolean") {
        data[f.key] = formEl.elements[f.key]?.checked || false;
      }
    });

    try {
      await fetch(`${API_BASE}/api/v1/missions/ui_response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interaction_id: activeInteractionId,
          action: "submit",
          form_data: data
        })
      });
      showToast("Form submitted successfully");
      dismissInteraction();
    } catch (err) {
      showToast("Error submitting form: " + err.message, true);
    }
  };

  document.getElementById("btn-form-cancel").onclick = async () => {
    try {
      await fetch(`${API_BASE}/api/v1/missions/ui_response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interaction_id: activeInteractionId,
          action: "cancel"
        })
      });
    } catch (e) {
      // ignore
    }
    dismissInteraction();
  };
}

function renderInteractionDestinations(interaction) {
  const container = document.getElementById("destination-picker-grid");
  const destinations = interaction.destinations || interaction.waypoints || [];

  container.innerHTML = destinations.map(dest => {
    const name = typeof dest === "string" ? dest : (dest.name || dest.label);
    return `
      <button class="kiosk-dest-tile" onclick="submitInteractionChoice('${name}')">
        <span class="dest-icon">📍</span>
        <span class="dest-title">${name}</span>
      </button>
    `;
  }).join("");
}

function dismissInteraction() {
  const overlay = document.getElementById("interaction-overlay");
  if (overlay) overlay.style.display = "none";
  clearInterval(interactionTimerInterval);
  activeInteractionId = null;
}

// Toast Notifications
function showToast(msg, isError = false) {
  let toast = document.getElementById("kiosk-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "kiosk-toast";
    toast.className = "kiosk-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = isError ? "#ef4444" : "#10b981";
  toast.style.display = "block";
  toast.style.opacity = "1";
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.style.display = "none", 300);
  }, 3000);
}
