// NavPro Mini - Missions, Schedules & Human-In-The-Loop Interactions

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

let lastObservedMissionState = "idle";

function updateMissionExecutionScreen(mStatus) {
  const missionScreen = document.getElementById("screen-mission-progress");
  const floatingBanner = document.getElementById("mission-floating-banner");

  const isMissionActive = mStatus && ["running", "waiting_for_user", "paused", "charging_paused"].includes(mStatus.state);

  if (!isMissionActive) {
    if (missionScreen) missionScreen.style.display = "none";
    if (floatingBanner) floatingBanner.style.display = "none";
    if (lastObservedMissionState === "running" && mStatus && mStatus.state === "completed") {
      if (window.playSuccessChime) window.playSuccessChime();
    }
    lastObservedMissionState = (mStatus && mStatus.state) || "idle";
    activeMissionState = "idle";
    return;
  }

  lastObservedMissionState = mStatus.state;
  activeMissionState = mStatus.state;
  if (mStatus.mission_id) {
    activeMissionId = mStatus.mission_id;
  }
  const title = mStatus.mission_name || mStatus.mission_id || "Active Mission";
  let activeNode = mStatus.active_node || mStatus.current_node || "In Progress";
  if (mStatus.state === "waiting_for_user") {
    activeNode = "Waiting for User Input...";
  }
  const progressPct = mStatus.progress_pct || 0;

  if (missionScreen && missionScreen.style.display !== "flex") {
    missionScreen.style.display = "flex";
  }

  const titleEl = document.getElementById("mission-screen-title");
  const nodeEl = document.getElementById("mission-screen-node");
  const fillEl = document.getElementById("mission-screen-fill");
  const pauseBtn = document.getElementById("btn-mission-pause-screen");

  if (titleEl) titleEl.textContent = title;
  if (nodeEl) nodeEl.textContent = activeNode;
  if (fillEl) fillEl.style.width = `${progressPct}%`;
  if (pauseBtn) {
    pauseBtn.textContent = (mStatus.state === "paused") ? "Resume Routine" : "Pause Routine";
  }
}

function initMissionExecutionControls() {
  const pauseBtn = document.getElementById("btn-mission-pause-screen");
  const abortBtn = document.getElementById("btn-mission-abort-screen");

  if (pauseBtn) {
    pauseBtn.onclick = async () => {
      if (window.playTapBeep) window.playTapBeep();
      if (!activeMissionId) {
        try {
          const res = await fetch(`${API_BASE}/api/v1/missions/status`);
          const data = await res.json();
          if (data && data.mission_id) activeMissionId = data.mission_id;
        } catch (_) {}
      }
      if (!activeMissionId) return;

      const isPaused = activeMissionState === "paused";
      const action = isPaused ? "resume" : "pause";
      try {
        await fetch(`${API_BASE}/api/v1/missions/${encodeURIComponent(activeMissionId)}/${action}`, { method: "POST" });
        showToast(isPaused ? "Routine resumed." : "Routine paused.");
        if (window.triggerFastTelemetryPoll) window.triggerFastTelemetryPoll();
      } catch (e) {
        showToast(`Action failed: ${e.message}`, true);
      }
    };
  }

  if (abortBtn) {
    abortBtn.onclick = () => {
      if (window.playTapBeep) window.playTapBeep();
      showDangerConfirmation({
        title: "Stop Routine",
        message: "Are you sure you want to stop and cancel the active routine?",
        confirmText: "Stop Routine",
        isDanger: true,
        icon: "🛑",
        onConfirm: async () => {
          if (!activeMissionId) {
            try {
              const res = await fetch(`${API_BASE}/api/v1/missions/status`);
              const data = await res.json();
              if (data && data.mission_id) activeMissionId = data.mission_id;
            } catch (_) {}
          }
          if (!activeMissionId) return;
          try {
            await fetch(`${API_BASE}/api/v1/missions/${encodeURIComponent(activeMissionId)}/cancel`, { method: "POST" });
            dismissActiveInteraction();
            showToast("Routine cancelled.");
            if (window.triggerFastTelemetryPoll) window.triggerFastTelemetryPoll();
          } catch (e) {
            showToast(`Failed to stop: ${e.message}`, true);
          }
        }
      });
    };
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMissionExecutionControls);
} else {
  initMissionExecutionControls();
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

  const isForm = interaction.subtype === "form" ||
                 interaction.subtype === "dynamic_form" ||
                 interaction.type === "form" ||
                 (Array.isArray(interaction.fields) && interaction.fields.length > 0);

  if (isForm) {
    renderInteractionForm(interaction);
    if (formEl) formEl.style.display = "flex";
    if (choicesEl) choicesEl.style.display = "none";
  } else {
    renderInteractionChoices(interaction);
    if (formEl) formEl.style.display = "none";
    if (choicesEl) choicesEl.style.display = "flex";
  }

  // Handle countdown timer and progress bar
  const timeoutSec = Number(interaction.timeout_sec) || 60;
  const startedAt = interaction.started_at ? (Number(interaction.started_at) * 1000) : Date.now();
  const timerSecEl = document.getElementById("interaction-timer-sec");
  const progressFillEl = document.getElementById("timer-progress-fill");

  if (window._interactionTimerInterval) {
    clearInterval(window._interactionTimerInterval);
    window._interactionTimerInterval = null;
  }

  const updateTimer = () => {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const remainingSec = Math.max(0, timeoutSec - elapsedSec);
    if (timerSecEl) timerSecEl.textContent = remainingSec.toFixed(1) + "s";
    if (progressFillEl) {
      const pct = Math.max(0, Math.min(100, (remainingSec / timeoutSec) * 100));
      progressFillEl.style.width = pct + "%";
    }
    if (remainingSec <= 0 && window._interactionTimerInterval) {
      clearInterval(window._interactionTimerInterval);
      window._interactionTimerInterval = null;
    }
  };
  updateTimer();
  window._interactionTimerInterval = setInterval(updateTimer, 100);

  overlay.style.display = "flex";
  triggerFaceExpression("thinking");
  if (interaction.sound_alert !== false && window.playAlertTone) {
    window.playAlertTone();
  }
  if (interaction.speech_text && window.speakText) {
    window.speakText(interaction.speech_text);
  }
}

function dismissActiveInteraction() {
  if (window._interactionTimerInterval) {
    clearInterval(window._interactionTimerInterval);
    window._interactionTimerInterval = null;
  }
  const overlay = document.getElementById("interaction-overlay");
  if (overlay) overlay.style.display = "none";
  activeInteractionId = null;
  triggerFaceExpression("happy");
}

function renderInteractionForm(interaction) {
  const container = document.getElementById("form-fields-container");
  if (!container) return;
  const fields = interaction.fields || [];

  container.innerHTML = fields.map(f => {
    if (f.type === "select") {
      const options = f.options || [];
      const defaultVal = f.default_value || (options.length > 0 ? options[0] : "");

      if (options.length <= 4) {
        // High-touch segmented chips (min 56px height, single-tap select)
        return `
          <div class="kiosk-field-group">
            <label>${escapeHtml(f.label)}</label>
            <div class="kiosk-touch-options-grid" id="touch-chips-${escapeHtml(f.key)}">
              ${options.map(opt => {
                const isSel = (opt === defaultVal);
                return `
                  <button type="button" class="touch-option-chip ${isSel ? 'selected' : ''}"
                          onclick="selectTouchChip('${escapeQuotes(f.key)}', '${escapeQuotes(opt)}', this)">
                    <span class="chip-check">✓</span>
                    <span>${escapeHtml(opt)}</span>
                  </button>
                `;
              }).join("")}
            </div>
            <input type="hidden" name="${escapeHtml(f.key)}" id="hidden-input-${escapeHtml(f.key)}" value="${escapeHtml(defaultVal)}">
          </div>
        `;
      } else {
        // High-touch select box that opens a dedicated touch picker sheet
        return `
          <div class="kiosk-field-group">
            <label>${escapeHtml(f.label)}</label>
            <div class="touch-select-box" onclick="openTouchSelectPicker('${escapeQuotes(f.key)}', '${escapeQuotes(f.label)}', ${escapeQuotes(JSON.stringify(options))})">
              <span id="touch-select-label-${escapeHtml(f.key)}">${escapeHtml(defaultVal || "Tap to Select Option")}</span>
              <span class="touch-select-box-arrow">▼</span>
            </div>
            <input type="hidden" name="${escapeHtml(f.key)}" id="hidden-input-${escapeHtml(f.key)}" value="${escapeHtml(defaultVal)}">
          </div>
        `;
      }
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

window.selectTouchChip = function(key, val, el) {
  if (window.playTapBeep) window.playTapBeep();
  const container = document.getElementById(`touch-chips-${key}`);
  if (container) {
    container.querySelectorAll('.touch-option-chip').forEach(chip => chip.classList.remove('selected'));
  }
  if (el) el.classList.add('selected');
  const input = document.getElementById(`hidden-input-${key}`);
  if (input) input.value = val;
};

window.openTouchSelectPicker = function(key, label, options) {
  if (window.playTapBeep) window.playTapBeep();
  const currentVal = document.getElementById(`hidden-input-${key}`) ? document.getElementById(`hidden-input-${key}`).value : "";

  let modal = document.getElementById("modal-touch-picker");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-touch-picker";
    modal.className = "touch-picker-overlay";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="touch-picker-sheet">
      <div class="touch-picker-header">
        <div class="touch-picker-title">${escapeHtml(label || "Select Option")}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeTouchSelectPicker()">✕</button>
      </div>
      <div class="touch-picker-list">
        ${options.map(opt => `
          <div class="touch-picker-item ${opt === currentVal ? 'active' : ''}"
               onclick="confirmTouchSelectOption('${escapeQuotes(key)}', '${escapeQuotes(opt)}')">
            <span>${escapeHtml(opt)}</span>
            ${opt === currentVal ? '<span style="font-size:20px; font-weight:bold;">✓</span>' : ''}
          </div>
        `).join("")}
      </div>
      <button type="button" class="btn btn-secondary btn-lg" style="width: 100%; min-height: 56px; margin-top: 8px;" onclick="closeTouchSelectPicker()">Cancel</button>
    </div>
  `;
  modal.style.display = "flex";
};

window.confirmTouchSelectOption = function(key, val) {
  if (window.playTapBeep) window.playTapBeep();
  const labelEl = document.getElementById(`touch-select-label-${key}`);
  const inputEl = document.getElementById(`hidden-input-${key}`);
  if (labelEl) labelEl.textContent = val;
  if (inputEl) inputEl.value = val;
  closeTouchSelectPicker();
};

window.closeTouchSelectPicker = function() {
  const modal = document.getElementById("modal-touch-picker");
  if (modal) modal.style.display = "none";
};

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
  if (window.playTapBeep) window.playTapBeep();
  try {
    const payload = {
      interaction_id: activeInteractionId,
      action: data.action || data.status || "submit",
      status: data.status || "submitted",
      selected: data.selected || data.choice || "",
      choice: data.choice || "",
      form_data: data.form_data || {},
      data: data.form_data || {},
      response: data
    };
    await fetch(`${API_BASE}/api/v1/missions/ui_response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn("Failed to post UI interaction response:", e);
  }
  dismissActiveInteraction();
  if (window.triggerFastTelemetryPoll) {
    window.triggerFastTelemetryPoll();
  }
}

