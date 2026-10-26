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

let setupSessionStartTime = 0;
window.setupSessionStartTime = setupSessionStartTime;

window.openSetupScreen = function() {
  const screen = document.getElementById("screen-setup");
  if (!screen) return;
  setupSessionStartTime = Date.now();
  window.setupSessionStartTime = setupSessionStartTime;
  sessionStorage.removeItem("navpro_setup_dismissed");
  screen.style.display = "flex";
  advanceSetupToStep(1);

  // Immediately lock continue button until verified by fetchWifiStatus()
  const btnContinue = document.getElementById("btn-step2-continue");
  const gateMsg = document.getElementById("setup-gate-msg");
  if (btnContinue) btnContinue.setAttribute("disabled", "true");
  if (gateMsg) gateMsg.style.display = "flex";

  fetchWifiStatus();
  scanWifiNetworks();
};

window.dismissSetupScreen = function() {
  const screen = document.getElementById("screen-setup");
  if (screen) screen.style.display = "none";
  sessionStorage.setItem("navpro_setup_dismissed", "true");
  fetch(`${API_BASE}/api/v1/system/setup/dismiss`, { method: "POST" }).catch(() => {});
};

window.checkAutoSetupScreen = async function() {
  try {
    const [wifiRes, setupRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/system/wifi/status`).catch(() => null),
      fetch(`${API_BASE}/api/v1/system/setup`).catch(() => null)
    ]);

    if (!wifiRes || !wifiRes.ok) return;
    const data = await wifiRes.json();
    const sData = (setupRes && setupRes.ok) ? await setupRes.json() : null;

    const isHotspot = Boolean(data.hotspot_active || (data.ip && data.ip.startsWith("10.42.")));
    const isSiteConnected = !data.hotspot_active && !!(data.connected && data.ip && !data.ip.startsWith("10.42."));

    const setupScreen = document.getElementById("screen-setup");

    // Case A: Setup was completed or dismissed remotely (e.g. user clicked "Skip" or completed in Mission Planner app)
    if (sData && (sData.dismissed || sData.completed)) {
      sessionStorage.setItem("navpro_setup_dismissed", "true");
      if (setupScreen && setupScreen.style.display !== "none") {
        console.log("[AutoSetup] Setup was dismissed/completed remotely. Advancing robot UI to dashboard.");
        setupScreen.style.display = "none";
        if (typeof showDashboardView === "function") {
          showDashboardView();
        } else {
          setSwipeIndex(0);
        }
      }
      return;
    }

    // Case B: User already dismissed locally in this session
    if (sessionStorage.getItem("navpro_setup_dismissed") === "true") {
      if (setupScreen && setupScreen.style.display !== "none") {
        setupScreen.style.display = "none";
      }
      return;
    }

    // Case C: Hotspot active or not connected to site Wi-Fi -> MUST launch and stay on Setup Step 1
    if (isHotspot || !isSiteConnected) {
      sessionStorage.removeItem("navpro_setup_dismissed");
      if (setupScreen && setupScreen.style.display !== "flex") {
        console.log("[AutoSetup] Robot is unconfigured or in hotspot mode. Launching Setup Screen Step 1.");
        openSetupScreen();
      }
      advanceSetupToStep(1);
      return;
    }

    // Case D: Site Wi-Fi is connected: determine step from remote state (step 1 or step 2)
    const targetStep = (sData && sData.step) ? sData.step : 2;
    if (setupScreen && setupScreen.style.display !== "flex") {
      console.log(`[AutoSetup] Wi-Fi connected but setup incomplete. Showing Step ${targetStep}.`);
      openSetupScreen();
    }
    advanceSetupToStep(targetStep);
  } catch (e) {
    // Backend offline or booting
  }
};

window.advanceSetupToStep = function(stepNum) {
  if (stepNum === 2) {
    const btnContinue = document.getElementById("btn-step2-continue");
    if (btnContinue && btnContinue.hasAttribute("disabled")) {
      showToast("Please connect robot to Wi-Fi before proceeding to Dock setup.", true);
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

    const isHotspot = !!data.hotspot_active;
    const cleanSsid = sanitizeWifiSsid(data.ssid);
    const liveIp = (data.ip && !data.ip.startsWith("10.42.")) ? data.ip : "";
    // STRICT RULE: Can only be considered connected if NOT in hotspot mode, data.connected is true, and real non-AP IP is assigned
    const isConnected = !isHotspot && !!(data.connected && cleanSsid && liveIp);

    // 1. Hotspot credentials & state (Top Card: Option 1)
    const hsTitleEl = document.getElementById("setup-hotspot-title");
    const hsDescEl = document.getElementById("setup-hotspot-desc");
    const hsBadgeEl = document.getElementById("hotspot-live-badge");
    const credLabel1 = document.getElementById("setup-cred-label-1");
    const hsSsidEl = document.getElementById("setup-hotspot-ssid");
    const credLabel2 = document.getElementById("setup-cred-label-2");
    const hsPassEl = document.getElementById("setup-hotspot-pass");
    const credLabel3 = document.getElementById("setup-cred-label-3");
    const hsIpEl = document.getElementById("setup-hotspot-ip");

    if (isHotspot) {
      if (hsBadgeEl) {
        hsBadgeEl.textContent = "HOTSPOT ACTIVE";
        hsBadgeEl.className = "hotspot-live-pill active";
      }
      if (hsTitleEl) hsTitleEl.textContent = "Pair via Mobile / Desktop App";
      if (hsDescEl) hsDescEl.innerHTML = "Connect your phone or PC to this robot's Wi-Fi hotspot, then open the <strong>NavPro Mission Planner</strong> app to set up the robot wirelessly.";
      if (credLabel1) credLabel1.textContent = "ROBOT HOTSPOT";
      if (hsSsidEl) hsSsidEl.textContent = data.hotspot_ssid || "NavPro-Setup";
      if (credLabel2) credLabel2.textContent = "PASSWORD";
      if (hsPassEl) hsPassEl.textContent = data.hotspot_password || "navprosetup";
      if (credLabel3) credLabel3.textContent = "PORTAL IP";
      if (hsIpEl) hsIpEl.textContent = data.hotspot_ip || "10.42.0.1";
    } else if (isConnected) {
      if (hsBadgeEl) {
        hsBadgeEl.textContent = "WI-FI CONNECTED";
        hsBadgeEl.className = "hotspot-live-pill connected";
      }
      if (hsTitleEl) hsTitleEl.textContent = "Connected to Site Wi-Fi";
      if (hsDescEl) hsDescEl.innerHTML = `Robot is online on <strong>${escapeHtml(cleanSsid)}</strong>. To manage this robot, connect your phone or PC to the same Wi-Fi network and open <strong>NavPro Mission Planner</strong>.`;
      if (credLabel1) credLabel1.textContent = "CONNECTED NETWORK";
      if (hsSsidEl) hsSsidEl.textContent = cleanSsid;
      if (credLabel2) credLabel2.textContent = "ROBOT IP ADDRESS";
      if (hsPassEl) hsPassEl.textContent = liveIp;
      if (credLabel3) credLabel3.textContent = "HOTSPOT STATUS";
      if (hsIpEl) hsIpEl.textContent = "Inactive (Site Wi-Fi Connected)";
    } else {
      if (hsBadgeEl) {
        hsBadgeEl.textContent = "HOTSPOT STANDBY";
        hsBadgeEl.className = "hotspot-live-pill inactive";
      }
      if (hsTitleEl) hsTitleEl.textContent = "Pair via Mobile / Desktop App";
      if (hsDescEl) hsDescEl.innerHTML = "Connect your phone or PC to this robot's hotspot or connect direct from this screen below.";
      if (credLabel1) credLabel1.textContent = "HOTSPOT SSID";
      if (hsSsidEl) hsSsidEl.textContent = data.hotspot_ssid || "NavPro-Setup";
      if (credLabel2) credLabel2.textContent = "PASSWORD";
      if (hsPassEl) hsPassEl.textContent = data.hotspot_password || "navprosetup";
      if (credLabel3) credLabel3.textContent = "PORTAL IP";
      if (hsIpEl) hsIpEl.textContent = "10.42.0.1";
    }

    const browserPortalEl = document.getElementById("setup-browser-portal-url");
    if (browserPortalEl) {
      browserPortalEl.textContent = isConnected ? `http://${liveIp}:8090/ui/` : "http://10.42.0.1:8090/ui/";
    }

    // 2. Connected Site Wi-Fi status (Bottom Card: Option 2)
    const nameEl = document.getElementById("wifi-current-name");
    const ipEl = document.getElementById("wifi-current-ip");
    const badgeEl = document.getElementById("wifi-connected-badge");
    const headerIp = document.getElementById("robot-ip");
    const btnContinue = document.getElementById("btn-step2-continue");
    const gateMsg = document.getElementById("setup-gate-msg");

    if (nameEl) {
      nameEl.textContent = isConnected ? cleanSsid : "No Wi-Fi Connected";
    }
    if (ipEl) {
      ipEl.textContent = isConnected ? `IP: ${liveIp}` : (isHotspot ? "Hotspot Mode (10.42.0.1)" : "Offline");
    }

    if (badgeEl) {
      if (isConnected) {
        badgeEl.textContent = `Connected (${cleanSsid})`;
        badgeEl.className = "wifi-connected-pill connected";
      } else if (isHotspot) {
        badgeEl.textContent = "Hotspot Mode";
        badgeEl.className = "wifi-connected-pill disconnected";
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

    // Auto-advance from Step 1 to Step 2 if Wi-Fi is connected and user is on Step 1
    if (isConnected) {
      const setupScreen = document.getElementById("screen-setup");
      const step1 = document.getElementById("setup-step-1");
      if (setupScreen && setupScreen.style.display === "flex" && step1 && step1.classList.contains("active")) {
        console.log("[Setup] Robot is connected to site Wi-Fi. Auto-advancing to Step 2 (Dock Setup).");
        advanceSetupToStep(2);
      }
    }

    // Top status bar robot IP
    if (headerIp) {
      if (isConnected && liveIp) {
        headerIp.textContent = liveIp;
      } else if (isHotspot) {
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
  if (typeof showDashboardView === "function") {
    showDashboardView();
  } else {
    setSwipeIndex(0); // Dashboard
  }
};

window.startMappingFromSetup = function() {
  const overlay = document.getElementById("setup-loading-overlay");
  const title = document.getElementById("setup-loading-title");
  const sub = document.getElementById("setup-loading-sub");
  if (overlay) {
    if (title) title.textContent = "Starting SLAM Mapping...";
    if (sub) sub.textContent = "Initializing LiDAR, SLAM Toolbox, and Nav2 navigation stack...";
    overlay.style.display = "flex";
  }
  startSlamMapping();
};


/* --------------------------------------------------------------------------
   14. Power & Health Subpage
   -------------------------------------------------------------------------- */
let powerHealthPollTimer = null;

async function loadPowerHealth() {
  try {
    const [healthRes, batRes, stateRes] = await Promise.allSettled([
      fetch(`${API_BASE}/api/v1/system/health`),
      fetch(`${API_BASE}/api/v1/state/battery`),
      fetch(`${API_BASE}/api/v1/state`),
    ]);

    const healthData = healthRes.status === "fulfilled" && healthRes.value.ok ? await healthRes.value.json() : null;
    const batData = batRes.status === "fulfilled" && batRes.value.ok ? await batRes.value.json() : null;
    const stateData = stateRes.status === "fulfilled" && stateRes.value.ok ? await stateRes.value.json() : null;

    // 1. Update Power Gauge & Battery Metrics
    const b = batData?.data || stateData?.battery || {};
    const detail = batData?.detail || {};

    const rawPct = b.percentage !== undefined ? b.percentage : (detail.soc_percent !== undefined ? detail.soc_percent : 100);
    let pctVal = Number(rawPct);
    if (pctVal <= 1.0 && pctVal > 0.0) pctVal *= 100.0;
    pctVal = Math.max(0, Math.min(100, pctVal));
    const displayPct = Number.isInteger(pctVal) ? pctVal.toString() : pctVal.toFixed(1);

    const isCharging = Boolean(
      (b.charging && b.charging !== "false") ||
      b.status === "charging" ||
      (detail.charger_connected && detail.charge_state !== "discharging")
    );
    const isFull = isCharging && (pctVal >= 99.5 || b.status === "Full" || b.status === "full");

    const gaugePct = document.getElementById("gauge-battery-pct");
    if (gaugePct) gaugePct.textContent = `${displayPct}%`;

    const gaugeStatus = document.getElementById("gauge-battery-status");
    if (gaugeStatus) {
      gaugeStatus.textContent = isFull ? "Fully Charged" : (isCharging ? "Charging" : "Discharging");
    }

    const circProgress = document.getElementById("circular-progress");
    if (circProgress) {
      circProgress.style.setProperty("--pct", pctVal);
      const colorVar = pctVal < 20 ? 'var(--danger, #ef4444)' : (pctVal < 40 ? 'var(--warning, #f59e0b)' : 'var(--success, #10b981)');
      circProgress.style.background = `conic-gradient(${colorVar} ${pctVal}%, var(--surface-sunken) 0)`;
    }

    // Stats Table
    const statCharging = document.getElementById("stat-charging-state");
    if (statCharging) statCharging.textContent = isFull ? "Full (Topped Off)" : (isCharging ? "Active Recharging" : "Not Charging");

    const statAdapter = document.getElementById("stat-adapter-state");
    if (statAdapter) statAdapter.textContent = isCharging ? "Connected (Dock/Adapter)" : "Disconnected";

    const statVoltage = document.getElementById("stat-pack-voltage");
    const vVal = b.voltage !== undefined ? b.voltage : detail.pack_voltage_v;
    if (statVoltage) statVoltage.textContent = vVal != null ? `${Number(vVal).toFixed(2)} V` : "-- V";

    const statCurrent = document.getElementById("stat-pack-current");
    const cVal = b.current !== undefined ? b.current : detail.pack_current_a;
    if (statCurrent) statCurrent.textContent = cVal != null ? `${Number(cVal).toFixed(2)} A` : "-- A";

    const statBattTemp = document.getElementById("stat-battery-temp");
    const btVal = b.temperature !== undefined ? b.temperature : (detail.max_temp_c !== undefined ? detail.max_temp_c : stateData?.system?.battery_temperature_c);
    if (statBattTemp) statBattTemp.textContent = btVal != null ? `${Number(btVal).toFixed(1)} °C` : "-- °C";

    const statCpuTemp = document.getElementById("stat-cpu-health");
    const cpuTempVal = healthData?.cpu_temperature_c !== undefined ? healthData.cpu_temperature_c : stateData?.system?.cpu_temperature_c;
    const cpuLoadVal = stateData?.system?.cpu_load_pct;
    if (statCpuTemp) {
      if (cpuTempVal != null && cpuLoadVal != null) {
        statCpuTemp.textContent = `${Number(cpuTempVal).toFixed(1)} °C (${Math.round(cpuLoadVal)}% load)`;
      } else if (cpuTempVal != null) {
        statCpuTemp.textContent = `${Number(cpuTempVal).toFixed(1)} °C`;
      } else {
        statCpuTemp.textContent = "-- °C";
      }
    }

    const statDisk = document.getElementById("stat-disk-usage");
    if (statDisk && healthData?.disk) {
      const freeGb = healthData.disk.free_gb ?? (healthData.disk.free ? (healthData.disk.free / 1073741824).toFixed(1) : null);
      const usedPct = healthData.disk.used_percent;
      statDisk.textContent = freeGb != null ? `${freeGb} GB Free (${usedPct ?? '?'}% used)` : "--";
    }

    // 2. Hardware Diagnostics List
    const list = document.getElementById("health-checklist");
    if (list) {
      const sources = healthData?.sources || {};
      const hw = stateData?.hardware || {};

      const isLocalized = stateData?.is_localized || (stateData?.localization?.status === "LOCALIZED");
      const navStatus = stateData?.navigation?.status || "idle";

      const items = [
        {
          name: "Base Odometry Motors",
          ok: sources.odom?.ok ?? (hw.odom === "OK"),
          detail: sources.odom?.age_sec != null ? `${sources.odom.age_sec.toFixed(2)}s age` : ""
        },
        {
          name: "RPLidar 360° Laser",
          ok: sources.lidar?.ok ?? (hw.lidar === "OK"),
          detail: sources.lidar?.age_sec != null ? `${sources.lidar.age_sec.toFixed(2)}s age` : ""
        },
        {
          name: "IMU Motion Sensor",
          ok: sources.imu?.ok ?? (hw.imu === "OK"),
          detail: sources.imu?.age_sec != null ? `${sources.imu.age_sec.toFixed(2)}s age` : ""
        },
        {
          name: "BMS Battery Telemetry",
          ok: sources.battery?.ok ?? (hw.battery === "OK"),
          detail: sources.battery?.age_sec != null ? `${sources.battery.age_sec.toFixed(2)}s age` : ""
        },
        {
          name: "AMCL Map Localization",
          ok: isLocalized,
          label: isLocalized ? "LOCALIZED" : "SEARCHING",
          detail: stateData?.localization?.cov_x != null ? `cov: ${Number(stateData.localization.cov_x).toFixed(2)}m²` : ""
        },
        {
          name: "Nav2 Navigation Planner",
          ok: navStatus !== "failed" && navStatus !== "error",
          label: navStatus === "running" ? "NAVIGATING" : (navStatus === "succeeded" ? "READY" : navStatus.toUpperCase()),
          detail: ""
        },
        {
          name: "CPU Thermal Health",
          ok: sources.cpu_temperature?.ok ?? (healthData?.cpu_temperature_c != null && healthData.cpu_temperature_c < 85.0),
          detail: cpuTempVal != null ? `${Number(cpuTempVal).toFixed(1)}°C` : ""
        }
      ];

      list.innerHTML = items.map(c => {
        const badgeClass = c.ok ? "badge-ok" : "badge-danger";
        const badgeText = c.label || (c.ok ? "ONLINE" : "OFFLINE");
        return `
          <div class="health-item">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <span>${escapeHtml(c.name)}</span>
            ${c.detail ? `<span style="margin-left:auto; font-size:12px; font-weight:500; color:var(--text-secondary);">${escapeHtml(c.detail)}</span>` : ""}
          </div>
        `;
      }).join("");
    }
  } catch (e) {
    console.warn("Health load error:", e);
  }
}

function startPowerHealthPolling() {
  stopPowerHealthPolling();
  powerHealthPollTimer = setInterval(loadPowerHealth, 2000);
}

function stopPowerHealthPolling() {
  if (powerHealthPollTimer) {
    clearInterval(powerHealthPollTimer);
    powerHealthPollTimer = null;
  }
}

window.loadPowerHealth = loadPowerHealth;
window.startPowerHealthPolling = startPowerHealthPolling;
window.stopPowerHealthPolling = stopPowerHealthPolling;


/* --------------------------------------------------------------------------
   14. SOFTWARE UPDATE SYSTEM (GitHub Releases + SDK Updater)
   -------------------------------------------------------------------------- */
const APP_CURRENT_VERSION = "2.1.0";
const updateChannel = "main";
let latestReleaseData = null;
let updatePollingTimer = null;

async function checkAppUpdates(silent = true) {
  // Session dismissal check: if user dismissed during THIS session, do not prompt on silent boot checks.
  // On next reboot / kiosk restart, sessionStorage is fresh, so it will prompt again.
  if (silent && sessionStorage.getItem("navpro_ui_update_dismissed") === "true") {
    return;
  }

  const branch = "main";
  try {
    let updateInfo = null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/system/app/update/check?branch=main`, {
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

  // Never block onboarding setup or active live mapping with update prompts
  const setupScreen = document.getElementById("screen-setup");
  const mappingScreen = document.getElementById("screen-mapping-live");
  if ((setupScreen && setupScreen.style.display === "flex") || (mappingScreen && mappingScreen.style.display === "flex")) {
    return;
  }

  // Do not prompt if commits are identical and commits_behind is 0
  if (info.current_commit && info.latest_commit && info.current_commit === info.latest_commit && (!info.commits_behind || info.commits_behind === 0)) {
    return;
  }

  // Current and target version chips
  const curEl = document.getElementById("update-modal-cur-ver");
  const newEl = document.getElementById("update-modal-new-ver");
  if (curEl) {
    curEl.textContent = `v${info.current_version || APP_CURRENT_VERSION}`;
  }
  if (newEl) {
    const behind = info.commits_behind;
    if (behind && behind > 0) {
      newEl.textContent = `${behind} new commit${behind > 1 ? "s" : ""}`;
    } else if (info.latest_version && info.latest_version !== info.current_version) {
      newEl.textContent = `v${info.latest_version}`;
    } else if (info.latest_commit_short) {
      newEl.textContent = `${info.latest_commit_short}`;
    } else {
      newEl.textContent = `v${info.latest_version || "2.0.0"}`;
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
  // Production only tracks main branch
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


