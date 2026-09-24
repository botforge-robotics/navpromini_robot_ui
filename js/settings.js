// NavPro Mini - Settings, Setup Wizard, Wi-Fi, Health & Updates

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
  sessionStorage.setItem("navpro_setup_dismissed", "true");
};

window.checkAutoSetupScreen = async function() {
  if (sessionStorage.getItem("navpro_setup_dismissed") === "true") {
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/v1/system/wifi/status`);
    if (!res.ok) return;
    const data = await res.json();
    const isSiteConnected = !!(data.connected && data.ip && !data.ip.startsWith("10.42."));
    if (data.hotspot_active || !isSiteConnected) {
      const setupScreen = document.getElementById("screen-setup");
      if (setupScreen && setupScreen.style.display !== "flex") {
        console.log("[AutoSetup] Robot is unconfigured or in hotspot mode. Launching Setup Screen.");
        openSetupScreen();
      }
    }
  } catch (e) {
    // Backend offline or booting
  }
};

window.advanceSetupToStep = function(stepNum) {
  if (stepNum === 2) {
    const btnContinue = document.getElementById("btn-step2-continue");
    if (btnContinue && btnContinue.hasAttribute("disabled")) {
      showToast("Please connect to Wi-Fi before proceeding to Dock setup.", true);
      return;
    }
  }
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

    // 1. Hotspot credentials & state (Top Card: Option 1)
    const hsSsidEl = document.getElementById("setup-hotspot-ssid");
    const hsPassEl = document.getElementById("setup-hotspot-pass");
    const hsIpEl = document.getElementById("setup-hotspot-ip");
    const hsBadgeEl = document.getElementById("hotspot-live-badge");

    if (hsSsidEl && data.hotspot_ssid) hsSsidEl.textContent = data.hotspot_ssid;
    if (hsPassEl && data.hotspot_password) hsPassEl.textContent = data.hotspot_password;
    if (hsIpEl && data.hotspot_ip) hsIpEl.textContent = data.hotspot_ip;
    if (hsBadgeEl) {
      if (data.hotspot_active) {
        hsBadgeEl.textContent = "HOTSPOT ACTIVE";
        hsBadgeEl.style.display = "inline-flex";
      } else {
        hsBadgeEl.textContent = "HOTSPOT READY";
      }
    }

    // 2. Connected Site Wi-Fi status (Bottom Card: Option 2)
    const nameEl = document.getElementById("wifi-current-name");
    const ipEl = document.getElementById("wifi-current-ip");
    const badgeEl = document.getElementById("wifi-connected-badge");
    const headerIp = document.getElementById("robot-ip");
    const btnContinue = document.getElementById("btn-step2-continue");
    const gateMsg = document.getElementById("setup-gate-msg");

    const cleanSsid = sanitizeWifiSsid(data.ssid);
    const liveIp = (data.ip && !data.ip.startsWith("10.42.")) ? data.ip : "";
    const isConnected = !!(data.connected && cleanSsid && liveIp);

    if (nameEl) {
      nameEl.textContent = isConnected ? cleanSsid : "No Wi-Fi Connected";
    }
    if (ipEl) {
      ipEl.textContent = isConnected ? `IP: ${liveIp}` : (data.connected ? "Acquiring IP..." : "Offline");
    }

    if (badgeEl) {
      if (isConnected) {
        badgeEl.textContent = `Connected (${cleanSsid})`;
        badgeEl.className = "wifi-connected-pill connected";
      } else if (data.connected && !liveIp) {
        badgeEl.textContent = "Obtaining IP...";
        badgeEl.className = "wifi-connected-pill";
      } else {
        badgeEl.textContent = "Not Connected";
        badgeEl.className = "wifi-connected-pill disconnected";
      }
    }

    // Gate Step 2 Continue Button: strictly enabled only when connected to site Wi-Fi
    if (btnContinue) {
      if (isConnected) {
        btnContinue.removeAttribute("disabled");
        if (gateMsg) gateMsg.style.display = "none";
      } else {
        btnContinue.setAttribute("disabled", "true");
        if (gateMsg) gateMsg.style.display = "flex";
      }
    }

    // Top status bar robot IP
    if (headerIp) {
      if (liveIp) {
        headerIp.textContent = liveIp;
      } else if (data.hotspot_active) {
        headerIp.textContent = "10.42.0.1 (AP)";
      } else {
        headerIp.textContent = "Offline";
      }
    }

    return data;
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
        <div class="wifi-item" onclick="promptWifiConnect('${escapeQuotes(rawSsid)}', '${escapeQuotes(displaySsid)}', ${isSecured})">
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

window.promptWifiConnect = function(rawSsid, displaySsid, isSecured = true) {
  const nameToShow = displaySsid || sanitizeWifiSsid(rawSsid);
  const banner = document.getElementById("wifi-connection-banner");
  const bannerTitle = document.getElementById("wifi-banner-title");
  const bannerSub = document.getElementById("wifi-banner-sub");
  const btnContinue = document.getElementById("btn-step2-continue");
  const gateMsg = document.getElementById("setup-gate-msg");

  const executeConnect = async (password = "") => {
    // Show connecting progress banner with spinner
    if (banner) {
      banner.style.display = "flex";
      banner.className = "wifi-connection-banner connecting";
    }
    if (bannerTitle) bannerTitle.textContent = `Connecting to ${nameToShow}...`;
    if (bannerSub) bannerSub.textContent = "Associating with network and obtaining IP address...";
    if (btnContinue) btnContinue.setAttribute("disabled", "true");
    if (gateMsg) gateMsg.style.display = "flex";

    showToast(`Connecting to ${nameToShow}...`);

    try {
      const res = await fetch(`${API_BASE}/api/v1/system/wifi/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid: rawSsid, password: password })
      });
      const data = await res.json();
      if (data.status === "ok" || data.success) {
        // Poll for assigned IP up to 6 times (6 seconds)
        let acquired = false;
        let finalIp = "";
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const st = await fetchWifiStatus();
          if (st && st.connected && st.ip && !st.ip.startsWith("10.42.")) {
            acquired = true;
            finalIp = st.ip;
            break;
          }
        }

        if (banner) {
          banner.className = "wifi-connection-banner success";
        }
        if (bannerTitle) bannerTitle.textContent = `Connected to ${nameToShow}!`;
        if (bannerSub) bannerSub.textContent = finalIp ? `IP Address: ${finalIp} • Ready to continue` : "Network joined successfully";

        if (btnContinue) btnContinue.removeAttribute("disabled");
        if (gateMsg) gateMsg.style.display = "none";
        showToast(`Connected to ${nameToShow}!`);
        triggerFaceExpression?.("happy");

        setTimeout(() => {
          if (banner && banner.classList.contains("success")) {
            banner.style.display = "none";
          }
        }, 6000);
      } else {
        const errMsg = data.message || "Failed to join network. Please check password.";
        if (banner) {
          banner.className = "wifi-connection-banner error";
        }
        if (bannerTitle) bannerTitle.textContent = "Connection Failed";
        if (bannerSub) bannerSub.textContent = errMsg;
        if (btnContinue) btnContinue.setAttribute("disabled", "true");
        if (gateMsg) gateMsg.style.display = "flex";
        showToast(`Failed: ${errMsg}`, true);
        triggerFaceExpression?.("confused");
      }
    } catch (e) {
      if (banner) {
        banner.className = "wifi-connection-banner error";
      }
      if (bannerTitle) bannerTitle.textContent = "Connection Error";
      if (bannerSub) bannerSub.textContent = e.message || "Network request failed";
      if (btnContinue) btnContinue.setAttribute("disabled", "true");
      if (gateMsg) gateMsg.style.display = "flex";
      showToast(`Connect error: ${e.message}`, true);
    }
  };

  if (isSecured) {
    openTouchKeyboard(`Enter Password for "${nameToShow}":`, (enteredPassword) => {
      executeConnect(enteredPassword);
    });
  } else {
    executeConnect("");
  }
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
   14. SOFTWARE UPDATE SYSTEM (GitHub Releases + SDK Updater)
   -------------------------------------------------------------------------- */
const APP_CURRENT_VERSION = "1.0.0";
let updateChannel = localStorage.getItem("navpro_ui_update_channel") || "main";
let latestReleaseData = null;
let updatePollingTimer = null;

async function checkAppUpdates(silent = true, branchOverride = null) {
  // Session dismissal check: if user dismissed during THIS session, do not prompt on silent boot checks.
  // On next reboot / kiosk restart, sessionStorage is fresh, so it will prompt again.
  if (silent && sessionStorage.getItem("navpro_ui_update_dismissed") === "true") {
    return;
  }

  const branch = branchOverride || updateChannel;
  try {
    let updateInfo = null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/system/app/update/check?branch=${encodeURIComponent(branch)}`, {
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        updateInfo = await res.json();
      }
    } catch (e) {
      console.warn("Backend update check unreachable:", e);
    }

    // Direct GitHub fallback if backend check failed
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
            asset_size: assetSize,
            branch: branch
          };
        }
      } catch (err) {
        console.log("GitHub release check offline or unavailable:", err);
      }
    }

    if (!updateInfo) {
      if (!silent) showToast("No update information available right now.");
      return;
    }

    latestReleaseData = updateInfo;

    if (updateInfo.update_available) {
      showUpdateAvailableModal(updateInfo);
    } else if (!silent) {
      showToast(`NavPro Mini Robot UI is up to date (${branch})`);
    }

  } catch (err) {
    console.error("Failed to check app updates:", err);
    if (!silent) showToast("Failed to check updates: " + err.message, true);
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

  const curBranch = info.branch || updateChannel || "main";

  // Synchronize channel selection chips
  const mainChip = document.getElementById("channel-chip-main");
  const devChip = document.getElementById("channel-chip-dev");
  if (mainChip && devChip) {
    if (curBranch === "dev") {
      devChip.classList.add("active");
      mainChip.classList.remove("active");
    } else {
      mainChip.classList.add("active");
      devChip.classList.remove("active");
    }
  }

  // Current and target version chips
  const curEl = document.getElementById("update-modal-cur-ver");
  const newEl = document.getElementById("update-modal-new-ver");
  if (curEl) {
    const curShort = info.current_commit_short || (info.current_version ? `v${info.current_version}` : "current");
    curEl.textContent = `${info.current_branch || curBranch}: ${curShort}`;
  }
  if (newEl) {
    const behind = info.commits_behind;
    if (behind && behind > 0) {
      newEl.textContent = `${behind} new commit${behind > 1 ? "s" : ""}`;
    } else if (info.latest_commit_short) {
      newEl.textContent = `${curBranch}: ${info.latest_commit_short}`;
    } else {
      newEl.textContent = `v${info.latest_version || "1.0.1"}`;
    }
  }

  // Changelog & notes
  const notesEl = document.getElementById("update-modal-notes");
  if (notesEl) {
    if (info.changelog && info.changelog.length > 0) {
      notesEl.innerHTML = info.changelog.map(line => `• ${escapeHtml(line)}`).join("<br>");
    } else if (info.release_notes) {
      notesEl.textContent = info.release_notes;
    } else {
      notesEl.textContent = "Autonomous navigation, touchscreen responsiveness, and system optimizations.";
    }
  }

  const progressWrap = document.getElementById("update-progress-wrap");
  const actionsRow = document.getElementById("update-actions-row");
  if (progressWrap) progressWrap.style.display = "none";
  if (actionsRow) actionsRow.style.display = "grid";

  modal.style.display = "flex";
}

window.switchUpdateBranch = function(branch) {
  updateChannel = branch;
  localStorage.setItem("navpro_ui_update_channel", branch);

  const mainChip = document.getElementById("channel-chip-main");
  const devChip = document.getElementById("channel-chip-dev");
  if (mainChip && devChip) {
    if (branch === "dev") {
      devChip.classList.add("active");
      mainChip.classList.remove("active");
    } else {
      mainChip.classList.add("active");
      devChip.classList.remove("active");
    }
  }

  showToast(`Checking ${branch} channel for updates...`);
  checkAppUpdates(false, branch);
};

window.dismissUpdateModal = function() {
  const modal = document.getElementById("modal-app-update");
  if (modal) modal.style.display = "none";
  if (updatePollingTimer) clearInterval(updatePollingTimer);
  // Dismiss for this session only — will prompt again after robot or kiosk restart
  sessionStorage.setItem("navpro_ui_update_dismissed", "true");
};

window.triggerAppUpdate = async function() {
  const progressWrap = document.getElementById("update-progress-wrap");
  const actionsRow = document.getElementById("update-actions-row");
  const progressBar = document.getElementById("update-progress-bar");
  const progressLabel = document.getElementById("update-progress-label");

  if (actionsRow) actionsRow.style.display = "none";
  if (progressWrap) progressWrap.style.display = "flex";

  if (progressBar) progressBar.style.width = "15%";
  if (progressLabel) progressLabel.textContent = "Initiating update...";

  try {
    const targetBranch = updateChannel || "main";
    const res = await fetch(`${API_BASE}/api/v1/system/app/update/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch: targetBranch,
        update_type: latestReleaseData ? latestReleaseData.update_type : "git",
        download_url: latestReleaseData ? latestReleaseData.download_url : null,
        target_version: latestReleaseData ? latestReleaseData.latest_version : "latest"
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to initiate update");
    }

    let elapsed = 0;
    updatePollingTimer = setInterval(async () => {
      elapsed += 1;
      try {
        const statRes = await fetch(`${API_BASE}/api/v1/system/app/update/status`);
        if (statRes.ok) {
          const status = await statRes.json();
          const pct = Math.max(15, Math.min(100, status.progress || 15));
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressLabel) progressLabel.textContent = `${status.message || "Updating..."} (${pct}%)`;

          if (status.state === "completed" || status.state === "restarting") {
            clearInterval(updatePollingTimer);
            if (progressBar) progressBar.style.width = "100%";
            if (progressLabel) progressLabel.textContent = "Update complete! Reloading UI...";
            try {
              if (window.speakText) speakText("Robot UI updated successfully!");
            } catch (_) {}
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          } else if (status.state === "failed") {
            clearInterval(updatePollingTimer);
            if (progressLabel) progressLabel.textContent = `Update failed: ${status.error || "Unknown error"}`;
            if (actionsRow) actionsRow.style.display = "grid";
          }
        }
      } catch (err) {
        if (elapsed > 12) {
          clearInterval(updatePollingTimer);
          if (progressLabel) progressLabel.textContent = "Reloading UI...";
          setTimeout(() => window.location.reload(), 2000);
        }
      }
    }, 1000);

  } catch (err) {
    if (progressLabel) progressLabel.textContent = `Update error: ${err.message}`;
    setTimeout(() => {
      if (actionsRow) actionsRow.style.display = "grid";
    }, 2500);
  }
};


