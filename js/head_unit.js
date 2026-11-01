/**
 * NavPro Mini - Aria Head Unit (Top Mic & Camera) Controller
 * 
 * Provides:
 * - Top header bar indicator button & live status polling
 * - Sliding Bottom Sheet modal for 1-tap BLE Wi-Fi provisioning
 * - Automatic 2.4GHz network sync from robot's active credentials
 * - Live camera preview & microphone VU activity meter
 */

(function () {
  let isSheetOpen = false;
  let pollInterval = null;
  let selectedDeviceMac = null;
  let discoveredDevices = [];
  let isConnected = false;
  let targetSsid = "";

  // DOM Elements
  let btnOpenSheet = null;
  let statusDot = null;
  let backdrop = null;
  let sheet = null;
  let unpairedView = null;
  let connectedView = null;
  let scanMsg = null;
  let deviceListEl = null;
  let targetWifiEl = null;
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
    targetWifiEl = document.getElementById("head-unit-target-wifi");
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

      // If sheet is open and status changed, update view
      if (isSheetOpen) {
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

    // Fetch robot Wi-Fi info
    fetchWifiInfo();

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
    startDeviceScan();
  };

  window.closeHeadUnitSheet = function () {
    isSheetOpen = false;
    if (sheet) sheet.classList.remove("is-open");
    if (backdrop) backdrop.style.display = "none";
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  async function fetchWifiInfo() {
    try {
      const res = await fetch("/api/v1/head_unit/wifi_info");
      if (res.ok) {
        const info = await res.json();
        targetSsid = info.target_ssid_24ghz || info.current_ssid || "Unknown";
        if (targetWifiEl) {
          targetWifiEl.textContent = targetSsid + (info.has_password ? " 🔒 (Password auto-synced)" : "");
        }
      }
    } catch (e) {
      if (targetWifiEl) targetWifiEl.textContent = "Unable to read robot Wi-Fi";
    }
  }

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
    if (scanMsg) scanMsg.textContent = "Scanning for nearby Aria Head Units via BLE...";
    if (deviceListEl) deviceListEl.innerHTML = '<div class="head-unit-scanning-loader">Looking for XIAO ESP32-S3 Sense...</div>';
    if (btnPair) btnPair.disabled = true;

    try {
      const res = await fetch("/api/v1/head_unit/scan");
      const data = await res.json();
      discoveredDevices = data.devices || [];

      if (discoveredDevices.length === 0) {
        // Show demo item or ready prompt if BLE didn't catch in 2s
        if (scanMsg) scanMsg.textContent = "Turn on XIAO ESP32-S3 Sense to auto-discover.";
        if (deviceListEl) {
          deviceListEl.innerHTML = `
            <div class="head-unit-card is-placeholder">
              <div class="card-icon">📡</div>
              <div class="card-info">
                <div class="card-name">Aria-Head-Auto</div>
                <div class="card-mac">Waiting for device advertising...</div>
              </div>
              <button class="btn btn-sm btn-secondary" onclick="startDeviceScan()">Retry Scan</button>
            </div>
          `;
        }
        return;
      }

      if (scanMsg) scanMsg.textContent = `Found ${discoveredDevices.length} nearby unit(s). Select to pair:`;
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
          <div class="card-name">${escapeHtml(dev.name || "Aria Head Unit")}</div>
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
    if (!selectedDeviceMac) return;

    if (btnPair) {
      btnPair.disabled = true;
      btnPair.innerHTML = `<span class="spinner-inline"></span> Transmitting Wi-Fi to Head Unit...`;
    }

    try {
      const res = await fetch("/api/v1/head_unit/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: selectedDeviceMac, ssid: targetSsid })
      });
      const data = await res.json();

      if (res.ok) {
        if (scanMsg) scanMsg.textContent = `✅ Sent credentials! Connecting ${selectedDeviceMac} to ${targetSsid}...`;
        
        // Poll quickly for connection confirmation
        let checks = 0;
        const checkConn = setInterval(async () => {
          checks++;
          const stRes = await fetch("/api/v1/head_unit/status").catch(() => null);
          if (stRes && stRes.ok) {
            const stData = await stRes.json();
            if (stData.connected) {
              clearInterval(checkConn);
              showToast("✨ Head Unit Paired! Live audio & camera stream active.");
              showConnectedView(stData);
              return;
            }
          }
          if (checks > 12) {
            clearInterval(checkConn);
            if (btnPair) {
              btnPair.disabled = false;
              btnPair.textContent = "Retry Pairing";
            }
          }
        }, 1500);

      } else {
        showToast("⚠️ " + (data.message || "Pairing failed"));
        if (btnPair) {
          btnPair.disabled = false;
          btnPair.textContent = "Pair & Sync Wi-Fi";
        }
      }
    } catch (err) {
      showToast("⚠️ Pairing error: " + err.message);
      if (btnPair) {
        btnPair.disabled = false;
        btnPair.textContent = "Pair & Sync Wi-Fi";
      }
    }
  };

  window.disconnectHeadUnit = function () {
    selectedDeviceMac = null;
    showUnpairedView();
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

  // Auto-init on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
