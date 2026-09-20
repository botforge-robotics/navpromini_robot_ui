// NavPro Mini - Mission Shortcuts Module
// Provides a 4x4 scrollable grid of quick-trigger mission cards linked to the active map

(function() {
  let activeMapName = "default";
  let shortcutsData = [];
  let availableMissions = [];
  let longPressTimer = null;
  let isLongPress = false;

  // Initialize on DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    initShortcuts();
  });

  async function initShortcuts() {
    await fetchActiveMap();
    loadShortcuts();
    setInterval(fetchActiveMap, 4000);
  }

  async function fetchActiveMap() {
    try {
      const res = await fetch("/api/v1/maps/current");
      if (res.ok) {
        const data = await res.json();
        const newMapName = data.current || (data.map && data.map.name) || "default";
        if (newMapName !== activeMapName) {
          activeMapName = newMapName;
          updateMapBadge();
          loadShortcuts();
        }
      }
    } catch (err) {
      // fallback if offline
    }
  }

  function updateMapBadge() {
    const badge = document.getElementById("shortcuts-map-name");
    if (badge) {
      badge.textContent = activeMapName;
    }
  }

  function getStorageKey() {
    return "navpromini_shortcuts_" + activeMapName.toLowerCase();
  }

  function loadShortcuts() {
    updateMapBadge();
    try {
      const raw = localStorage.getItem(getStorageKey());
      shortcutsData = raw ? JSON.parse(raw) : [];
    } catch (e) {
      shortcutsData = [];
    }
    renderShortcutsGrid();
  }

  function saveShortcuts() {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(shortcutsData));
    } catch (e) {
      console.warn("Failed to persist shortcuts:", e);
    }
  }

  function renderShortcutsGrid() {
    const grid = document.getElementById("shortcuts-grid");
    if (!grid) return;

    grid.innerHTML = "";

    // Render active shortcuts for this map
    shortcutsData.forEach((shortcut) => {
      const card = document.createElement("div");
      card.className = "shortcut-card";
      card.dataset.id = shortcut.id;

      card.innerHTML = `
        <div class="shortcut-card-top">
          <div class="shortcut-icon-wrapper" style="background: ${shortcut.color || '#3B82F6'}20; color: ${shortcut.color || '#3B82F6'}">
            <span class="shortcut-icon">${shortcut.icon || '▶'}</span>
          </div>
          <div class="shortcut-play-indicator">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="shortcut-title">${escapeHtml(shortcut.title)}</div>
      `;

      // Long press detection for deletion
      const startPress = (e) => {
        isLongPress = false;
        longPressTimer = setTimeout(() => {
          isLongPress = true;
          confirmDeleteShortcut(shortcut);
        }, 550);
      };

      const cancelPress = () => {
        clearTimeout(longPressTimer);
      };

      card.addEventListener("pointerdown", startPress);
      card.addEventListener("pointerup", cancelPress);
      card.addEventListener("pointercancel", cancelPress);
      card.addEventListener("pointerleave", cancelPress);

      card.addEventListener("click", (e) => {
        if (isLongPress) {
          isLongPress = false;
          return;
        }
        executeShortcut(shortcut);
      });

      grid.appendChild(card);
    });

    // Always last: Add Shortcut Card (dotted border with center + icon)
    const addCard = document.createElement("div");
    addCard.className = "shortcut-card shortcut-add-card";
    addCard.id = "btn-add-shortcut";
    addCard.innerHTML = `
      <div class="shortcut-add-icon">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </div>
      <span class="shortcut-add-label">Add Shortcut</span>
    `;
    addCard.onclick = () => openAddShortcutModal();
    grid.appendChild(addCard);
  }

  async function executeShortcut(shortcut) {
    if (!shortcut || !shortcut.missionId) return;

    try {
      showToast(`Starting: ${shortcut.title}...`, 2500);
      
      const res = await fetch(`/api/v1/missions/${encodeURIComponent(shortcut.missionId)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (res.ok) {
        showToast(`Mission "${shortcut.title}" started!`, 3000);
        // Switch to face or dashboard to watch execution
        if (window.setSwipeIndex) {
          window.setSwipeIndex(0); // Switch to robot face
        }
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Error: ${err.message || "Failed to start mission"}`, 4000);
      }
    } catch (e) {
      showToast("Network error starting mission", 3000);
    }
  }

  function confirmDeleteShortcut(shortcut) {
    if (confirm(`Delete shortcut "${shortcut.title}"?`)) {
      shortcutsData = shortcutsData.filter(s => s.id !== shortcut.id);
      saveShortcuts();
      renderShortcutsGrid();
      showToast(`Shortcut "${shortcut.title}" removed`, 2000);
    }
  }

  let selectedIcon = "▶";
  let selectedColor = "#2563EB";

  window.openAddShortcutModal = async function() {
    const modal = document.getElementById("modal-add-shortcut");
    if (!modal) return;

    const heading = document.getElementById("shortcut-modal-heading");
    const sub = document.getElementById("shortcut-modal-subheading");
    if (heading) heading.textContent = "Add Mission Shortcut";
    if (sub) sub.textContent = "Select a mission to add as a quick-launch tile";

    const step1 = document.getElementById("shortcut-step-select");
    const step2 = document.getElementById("shortcut-step-config");
    if (step1) step1.style.display = "block";
    if (step2) step2.style.display = "none";

    const listEl = document.getElementById("shortcut-modal-mission-list");
    if (listEl) {
      listEl.innerHTML = '<div class="modal-loading" style="padding: 24px; text-align: center; color: var(--text-secondary);">Loading available missions...</div>';
    }

    modal.style.display = "flex";

    try {
      const res = await fetch("/api/v1/missions");
      if (res.ok) {
        const data = await res.json();
        availableMissions = data.missions || [];
        renderMissionSelectionList(availableMissions);
      } else {
        if (listEl) listEl.innerHTML = '<div class="modal-empty" style="padding: 24px; text-align: center; color: var(--text-secondary);">Failed to load missions.</div>';
      }
    } catch (e) {
      if (listEl) listEl.innerHTML = '<div class="modal-empty" style="padding: 24px; text-align: center; color: var(--text-secondary);">Error connecting to robot.</div>';
    }
  };

  function renderMissionSelectionList(missions) {
    const listEl = document.getElementById("shortcut-modal-mission-list");
    if (!listEl) return;

    if (!missions || missions.length === 0) {
      listEl.innerHTML = '<div class="modal-empty" style="padding: 28px 16px; text-align: center; color: var(--text-secondary); font-size: 14px;">No missions found on robot. Create a mission first in Mission Planner.</div>';
      return;
    }

    // Sort active map missions first
    const sorted = [...missions].sort((a, b) => {
      const aCur = (!a.map || a.map.toLowerCase() === activeMapName.toLowerCase()) ? 1 : 0;
      const bCur = (!b.map || b.map.toLowerCase() === activeMapName.toLowerCase()) ? 1 : 0;
      return bCur - aCur;
    });

    listEl.innerHTML = "";
    sorted.forEach(m => {
      const item = document.createElement("div");
      item.className = "shortcut-modal-item";
      const isCurrentMap = !m.map || m.map.toLowerCase() === activeMapName.toLowerCase();
      const stepCount = (m.nodes ? m.nodes.length : (m.steps ? m.steps.length : null));
      const stepText = stepCount ? `${stepCount} steps` : (m.type || 'Mission');

      item.innerHTML = `
        <div class="modal-item-icon">⚡</div>
        <div class="modal-item-info">
          <div class="modal-item-title">${escapeHtml(m.name || m.id)}</div>
          <div class="modal-item-sub">Map: ${escapeHtml(m.map || "Universal")} • ${stepText}</div>
        </div>
        ${isCurrentMap ? '<span class="modal-item-badge">Active Map</span>' : ''}
        <div style="color: var(--text-secondary); font-size: 16px; font-weight: 700; margin-left: 6px;">➔</div>
      `;

      item.onclick = () => {
        selectMissionForShortcut(m);
      };

      listEl.appendChild(item);
    });
  }

  window.backToMissionSelect = function() {
    const step1 = document.getElementById("shortcut-step-select");
    const step2 = document.getElementById("shortcut-step-config");
    const heading = document.getElementById("shortcut-modal-heading");
    const sub = document.getElementById("shortcut-modal-subheading");
    if (heading) heading.textContent = "Add Mission Shortcut";
    if (sub) sub.textContent = "Select a mission to add as a quick-launch tile";
    if (step1) step1.style.display = "block";
    if (step2) step2.style.display = "none";
  };

  function selectMissionForShortcut(mission) {
    const titleInput = document.getElementById("shortcut-input-title");
    const heading = document.getElementById("shortcut-modal-heading");
    const sub = document.getElementById("shortcut-modal-subheading");

    if (heading) heading.textContent = "Customize Shortcut";
    if (sub) sub.textContent = "Set label, icon, and color for this tile";

    if (titleInput) {
      titleInput.value = mission.name || mission.id;
    }

    selectedIcon = "▶";
    selectedColor = "#2563EB";
    pickShortcutIcon("▶");
    pickShortcutColor("#2563EB");

    // Step 2: Show configuration form
    const step1 = document.getElementById("shortcut-step-select");
    const step2 = document.getElementById("shortcut-step-config");
    if (step1) step1.style.display = "none";
    if (step2) {
      step2.style.display = "block";
      step2.dataset.missionId = mission.id;
      step2.dataset.missionName = mission.name || mission.id;
    }

    updateShortcutLivePreview();
  }

  window.pickShortcutIcon = function(icon) {
    selectedIcon = icon;
    document.querySelectorAll("#shortcut-icon-picker .picker-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.icon === icon);
    });
    updateShortcutLivePreview();
  };

  window.pickShortcutColor = function(color) {
    selectedColor = color;
    document.querySelectorAll("#shortcut-color-picker .color-swatch-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.color === color);
    });
    updateShortcutLivePreview();
  };

  window.updateShortcutLivePreview = function() {
    const titleInput = document.getElementById("shortcut-input-title");
    const previewTitle = document.getElementById("preview-title");
    const previewIcon = document.getElementById("preview-icon");
    const previewWrapper = document.getElementById("preview-icon-wrapper");
    const previewSub = document.getElementById("preview-mission-sub");
    const step2 = document.getElementById("shortcut-step-config");

    const titleVal = titleInput ? titleInput.value.trim() : "";
    const fallbackName = step2 ? (step2.dataset.missionName || "Mission") : "Mission";

    if (previewTitle) {
      previewTitle.textContent = titleVal || fallbackName;
    }
    if (previewIcon) {
      previewIcon.textContent = selectedIcon;
    }
    if (previewWrapper) {
      previewWrapper.style.background = `${selectedColor}20`;
      previewWrapper.style.color = selectedColor;
    }
  };

  window.saveNewShortcut = function() {
    const step2 = document.getElementById("shortcut-step-config");
    const titleInput = document.getElementById("shortcut-input-title");

    if (!step2 || !titleInput) return;

    const missionId = step2.dataset.missionId;
    const missionName = step2.dataset.missionName;
    const title = titleInput.value.trim() || missionName;
    const icon = selectedIcon || "▶";
    const color = selectedColor || "#2563EB";

    const newShortcut = {
      id: "sc_" + Date.now(),
      missionId,
      missionName,
      title,
      icon,
      color,
      mapName: activeMapName
    };

    shortcutsData.push(newShortcut);
    saveShortcuts();
    closeAddShortcutModal();
    renderShortcutsGrid();
    showToast(`Added shortcut "${title}"!`, 2500);
  };

  window.closeAddShortcutModal = function() {
    const modal = document.getElementById("modal-add-shortcut");
    if (modal) modal.style.display = "none";

    // Reset steps
    const step1 = document.getElementById("shortcut-step-select");
    const step2 = document.getElementById("shortcut-step-config");
    if (step1) step1.style.display = "block";
    if (step2) step2.style.display = "none";
  };

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function showToast(msg, duration = 3000) {
    if (window.showToast) {
      window.showToast(msg, duration);
      return;
    }
    const toast = document.createElement("div");
    toast.className = "toast-message";
    toast.textContent = msg;
    toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1E293B;color:#FFF;padding:12px 24px;border-radius:24px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.3);";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  // Export
  window.refreshShortcuts = loadShortcuts;
})();
