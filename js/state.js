// NavPro Mini - Core UI State, Constants & Gesture Protections

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

// Global Robot State
let currentSwipeIndex = 0; // 0 = Dashboard, 1 = Shortcuts
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

// Rive / Face Expression Stubs (No-Op for performance)
window.triggerFaceExpression = function() {};
window.pauseRiveFace = function() {};
window.resumeRiveFace = function() {};

// Touch Keyboard Callback
let touchKeyboardCallback = null;

// Dynamic Interaction State
let activeInteractionId = null;
let interactionTimerInterval = null;

// Toast Notifications Helper
window.showToast = function(message, isError = false, duration = 3000) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast" + (isError ? " toast-error" : "");
  toast.textContent = message;

  container.appendChild(toast);

  // Trigger CSS entry animation
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
};

// Modal Helpers
window.dismissRelocalizationModal = function() {
  const modal = document.getElementById("modal-relocalize");
  if (modal) modal.style.display = "none";
  relocalizeDismissedUntil = Date.now() + 60000;
};

window.openDockInstructionModal = function() {
  const modal = document.getElementById("modal-dock-instruction");
  if (modal) modal.style.display = "flex";
};

window.closeDockInstructionModal = function() {
  const modal = document.getElementById("modal-dock-instruction");
  if (modal) modal.style.display = "none";
};

window.escapeHtml = function(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

window.escapeQuotes = function(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'");
};

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

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-danger-confirm")?.addEventListener("click", () => {
    const cb = dangerConfirmCallback;
    closeDangerConfirmation();
    if (typeof cb === "function") cb();
  });
});
