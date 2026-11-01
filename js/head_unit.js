/**
 * NavPro Mini - Aria Sense (Top Mic & Camera) Controller
 * 
 * Provides:
 * - Top header bar indicator button & live status polling
 * - Sliding Bottom Sheet modal for 1-tap BLE Wi-Fi provisioning
 * - Network scanner & editable Wi-Fi password with show/hide toggle
 * - Live camera preview & microphone VU activity meter
 */

(function () {
  let isSheetOpen = false;
  let selectedDeviceMac = null;
  let discoveredDevices = [];
  let isConnected = false;
  let manualPairingMode = false;
  let savedRobotPassword = "";
  let robotSsid = "";

  // DOM Elements
  let btnOpenSheet = null;
  let statusDot = null;
  let backdrop = null;
  let sheet = null;
  let unpairedView = null;
  let connectedView = null;
  let scanMsg = null;
  let deviceListEl = null;
  let wifiSelectEl = null;
  let wifiPassEl = null;
  let btnTogglePass = null;
  let wifiHintEl = null;
  let btnPair = null;
  let camImg = null;
  let meterFill = null;

  function init() {
    btnOpenSheet = document.getElementById("btn-open-head-unit");
    statusDot = document.getElementById("head-unit-status-dot");
    backdrop = document.getElementById("head-unit-backdrop");
    sheet = document.getElementById("head-unit-sheet");
    unpairedView = document.getElementById("head-unit-view-unpaired");
    connectedView = document.getElementById("head-unit-view-connected");
    scanMsg = document.getElementById("head-unit-scan-msg");
    deviceListEl = document.getElementById("head-unit-device-list");
    wifiSelectEl = document.getElementById("head-unit-wifi-select");
    wifiPassEl = document.getElementById("head-unit-wifi-pass");
    btnTogglePass = document.getElementById("btn-toggle-wifi-pass");
    wifiHintEl = document.getElementById("head-unit-wifi-hint");
    btnPair = document.getElementById("btn-pair-head-unit");
    camImg = document.getElementById("head-unit-cam-img");
    meterFill = document.getElementById("head-unit-meter-fill");

    // Start background status polling
    pollHeadUnitStatus();
    setInterval(pollHeadUnitStatus, 2500);
  }

  async function pollHeadUnitStatus() {
    try {
      const res = await fetch("/api/v1/head_unit/status");
      if (!res.ok) return;
      const data = await res.json();

      isConnected = !!data.connected;

      // Update header button status dot
      if (statusDot) {
        if (isConnected) {
          statusDot.className = "head-unit-status-dot is-connected";
        } else {
          statusDot.className = "head-unit-status-dot";
        }
      }

      // If sheet is open and status changed, update view (unless user manually entered pairing mode)
      if (isSheetOpen && !manualPairingMode) {
        if (isConnected) {
          showConnectedView(data);
        } else if (connectedView && connectedView.style.display !== "none") {
          showUnpairedView();
        }
      }
    } catch (e) {
      console.warn("pollHeadUnitStatus error:", e);
    }
  }

  window.openHeadUnitSheet = async function () {
    isSheetOpen = true;
    if (backdrop) backdrop.style.display = "block";
    if (sheet) sheet.classList.add("is-open");

    // Check status
    const res = await fetch("/api/v1/head_unit/status").catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      if (data.connected) {
        showConnectedView(data);
        return;
      }
    }

    showUnpairedView();
    loadAvailableWifi();
    startDeviceScan();
  };

  window.closeHeadUnitSheet = function () {
    manualPairingMode = false;
    isSheetOpen = false;
    if (sheet) sheet.classList.remove("is-open");
    if (backdrop) backdrop.style.display = "none";
  };

  window.toggleHeadUnitPassVisibility = function () {
    if (!wifiPassEl) return;
    if (wifiPassEl.type === "password") {
      wifiPassEl.type = "text";
      if (btnTogglePass) btnTogglePass.textContent = "🙈";
    } else {
      wifiPassEl.type = "password";
      if (btnTogglePass) btnTogglePass.textContent = "👁️";
    }
  };

  window.onWifiSelectChange = function () {
    if (!wifiSelectEl || !wifiPassEl) return;
    const selectedSsid = wifiSelectEl.value;

    // Check if the selected SSID matches robot's SSID
    if (robotSsid && (selectedSsid === robotSsid || selectedSsid.startsWith(robotSsid.replace(/[-_]5GH?Z?$/i, "")))) {
      if (savedRobotPassword) {
        wifiPassEl.value = savedRobotPassword;
        if (wifiHintEl) wifiHintEl.textContent = "Auto-detected password from robot Wi-Fi.";
      }
    } else {
      // Different network selected: clear password so user enters the correct password
      if (selectedSsid) {
        wifiPassEl.value = "";
        wifiPassEl.placeholder = `Enter password for ${selectedSsid}`;
        if (wifiHintEl) wifiHintEl.textContent = `Enter password for "${selectedSsid}".`;
      }
    }
  };

  window.loadAvailableWifi = async function (forceRefresh = false) {
    if (!wifiSelectEl) return;

    if (forceRefresh) {
      wifiSelectEl.innerHTML = '<option value="">Scanning Wi-Fi networks...</option>';
      if (wifiHintEl) wifiHintEl.textContent = "Scanning nearby networks...";
    }

    try {
      // 1. Fetch current robot credentials
      const infoRes = await fetch("/api/v1/head_unit/wifi_info").catch(() => null);
      let targetSsid24 = "";
      if (infoRes && infoRes.ok) {
        const info = await infoRes.json();
        robotSsid = info.current_ssid || "";
        targetSsid24 = info.target_ssid_24ghz || robotSsid;
        savedRobotPassword = info.saved_password || "";
      }

      // 2. Fetch scanned Wi-Fi networks
      const scanRes = await fetch("/api/v1/head_unit/wifi_scan").catch(() => null);
      let networks = [];
      if (scanRes && scanRes.ok) {
        const scanData = await scanRes.json();
        networks = scanData.networks || [];
      }

      wifiSelectEl.innerHTML = "";

      if (networks.length === 0) {
        // Fallback to active SSID if scan is empty
        const opt = document.createElement("option");
        opt.value = targetSsid24 || robotSsid || "Robot-Network";
        opt.textContent = `${opt.value} (Robot Network)`;
        wifiSelectEl.appendChild(opt);
      } else {
        let selected = false;
        networks.forEach((net) => {
          const opt = document.createElement("option");
          opt.value = net.ssid;
          const bandLabel = net.is_24ghz ? "2.4 GHz" : "5 GHz";
          opt.textContent = `${net.ssid} (${bandLabel} • ${net.signal}%)`;

          // Auto-select target 2.4 GHz or matching robot SSID
          if (!selected && net.is_24ghz && (net.ssid === targetSsid24 || net.ssid.toLowerCase().includes(robotSsid.toLowerCase().replace(/[-_]5gh?z?$/i, "")))) {
            opt.selected = true;
            selected = true;
          }
          wifiSelectEl.appendChild(opt);
        });

        // If none selected yet, select first 2.4GHz option
        if (!selected && wifiSelectEl.options.length > 0) {
          wifiSelectEl.selectedIndex = 0;
        }
      }

      // Pre-fill password if available
      if (savedRobotPassword && wifiPassEl) {
        wifiPassEl.value = savedRobotPassword;
        if (wifiHintEl) wifiHintEl.textContent = "Auto-detected password from robot Wi-Fi.";
      }
    } catch (e) {
      console.warn("loadAvailableWifi error:", e);
      if (wifiHintEl) wifiHintEl.textContent = "Could not scan networks. Enter SSID manually.";
    }
  };

  function showUnpairedView() {
    if (unpairedView) unpairedView.style.display = "block";
    if (connectedView) connectedView.style.display = "none";
    if (camImg) camImg.src = "";
  }

  function showConnectedView(data) {
    if (unpairedView) unpairedView.style.display = "none";
    if (connectedView) connectedView.style.display = "block";

    if (camImg && data.camera_url && camImg.src !== data.camera_url) {
      camImg.src = data.camera_url;
    }

    if (meterFill && typeof data.audio_rms === "number") {
      const pct = Math.min(100, Math.max(0, (data.audio_rms / 6000) * 100));
      meterFill.style.width = pct + "%";
    }
  }

  async function startDeviceScan() {
    if (scanMsg) scanMsg.textContent = "Scanning for nearby Aria Sense units via BLE...";
    if (deviceListEl) deviceListEl.innerHTML = '<div class="head-unit-scanning-loader">Scanning for nearby Aria Sense units...</div>';
    if (btnPair) btnPair.disabled = true;

    try {
      const res = await fetch("/api/v1/head_unit/scan");
      const data = await res.json();
      const rawDevices = data.devices || [];

      // Clean device names to ensure no raw hardware branding is shown
      discoveredDevices = rawDevices.map((dev) => {
        let name = dev.name || "Aria Sense";
        if (name.includes("Aria-Head")) {
          name = name.replace("Aria-Head", "Aria-Sense");
        } else if (name.includes("XIAO") || name.includes("Seeed") || name === "Head") {
          name = `Aria-Sense-${(dev.mac || "").replace(/:/g, "").slice(-4).toUpperCase()}`;
        }
        return { ...dev, name };
      });

      if (discoveredDevices.length === 0) {
        if (scanMsg) scanMsg.textContent = "Power on your Aria Sense unit to discover.";
        if (deviceListEl) {
          deviceListEl.innerHTML = `
            <div class="head-unit-card is-placeholder">
              <div class="card-icon">📡</div>
              <div class="card-info">
                <div class="card-name">Aria Sense Unit</div>
                <div class="card-mac">Waiting for device advertising...</div>
              </div>
              <button class="btn btn-sm btn-secondary" onclick="startDeviceScan()">Retry Scan</button>
            </div>
          `;
        }
        return;
      }

      if (scanMsg) scanMsg.textContent = `Found ${discoveredDevices.length} nearby Aria Sense unit(s). Select to pair:`;
      renderDeviceList();
    } catch (e) {
      if (scanMsg) scanMsg.textContent = "Scan error. Please try again.";
    }
  }

  function renderDeviceList() {
    if (!deviceListEl) return;
    deviceListEl.innerHTML = "";

    discoveredDevices.forEach((dev, idx) => {
      const card = document.createElement("div");
      card.className = `head-unit-card ${selectedDeviceMac === dev.mac ? "is-selected" : ""}`;
      card.onclick = () => selectDevice(dev.mac);

      card.innerHTML = `
        <div class="card-icon">🎙️</div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(dev.name || "Aria Sense")}</div>
          <div class="card-mac">${escapeHtml(dev.mac)} • Signal: ${dev.rssi || -55} dBm</div>
        </div>
        <div class="card-select-radio">${selectedDeviceMac === dev.mac ? "●" : "○"}</div>
      `;
      deviceListEl.appendChild(card);

      // Auto-select first item
      if (idx === 0 && !selectedDeviceMac) {
        selectDevice(dev.mac);
      }
    });
  }

  function selectDevice(mac) {
    selectedDeviceMac = mac;
    renderDeviceList();
    if (btnPair) btnPair.disabled = false;
  }

  window.pairSelectedHeadUnit = async function () {
    if (!selectedDeviceMac) {
      showToast("⚠️ Please select an Aria Sense unit to pair.");
      return;
    }

    const chosenSsid = (wifiSelectEl ? wifiSelectEl.value : "") || robotSsid;
    const chosenPass = wifiPassEl ? wifiPassEl.value : "";

    if (!chosenSsid) {
      showToast("⚠️ Please select or enter a Wi-Fi network.");
      return;
    }

    if (btnPair) {
      btnPair.disabled = true;
      btnPair.innerHTML = `<span class="spinner-inline"></span> Connecting Aria Sense to ${escapeHtml(chosenSsid)}...`;
    }

    try {
      const res = await fetch("/api/v1/head_unit/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mac: selectedDeviceMac,
          ssid: chosenSsid,
          password: chosenPass
        })
      });
      const data = await res.json();

      if (res.ok) {
        if (scanMsg) scanMsg.textContent = `✅ Transmitted Wi-Fi credentials! Connecting to ${chosenSsid}...`;
        
        // Fast polling for connection confirmation
        let checks = 0;
        const checkConn = setInterval(async () => {
          checks++;
          const stRes = await fetch("/api/v1/head_unit/status").catch(() => null);
          if (stRes && stRes.ok) {
            const stData = await stRes.json();
            if (stData.connected) {
              clearInterval(checkConn);
              manualPairingMode = false;
              showToast("✨ Aria Sense Connected! High-fidelity mic and camera active.");
              showConnectedView(stData);
              return;
            }
          }
          if (checks > 15) {
            clearInterval(checkConn);
            if (btnPair) {
              btnPair.disabled = false;
              btnPair.textContent = "Connect & Pair Aria Sense";
            }
            if (scanMsg) scanMsg.textContent = "Pairing timed out. Verify Wi-Fi password and try again.";
          }
        }, 1500);

      } else {
        showToast("⚠️ " + (data.message || "Pairing failed"));
        if (btnPair) {
          btnPair.disabled = false;
          btnPair.textContent = "Connect & Pair Aria Sense";
        }
      }
    } catch (err) {
      showToast("⚠️ Pairing error: " + err.message);
      if (btnPair) {
        btnPair.disabled = false;
        btnPair.textContent = "Connect & Pair Aria Sense";
      }
    }
  };

  window.disconnectHeadUnit = function () {
    manualPairingMode = true;
    selectedDeviceMac = null;
    showUnpairedView();
    loadAvailableWifi();
    startDeviceScan();
  };

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showToast(msg) {
    if (window.showToast) window.showToast(msg);
    else console.log("[Toast]", msg);
  }

  window.startDeviceScan = startDeviceScan;
  window.selectDevice = selectDevice;

  // Auto-init on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
