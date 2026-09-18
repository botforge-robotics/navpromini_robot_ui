// NavPro Mini - Native GNOME-Style On-Screen Touch Keyboard (OSK) & Swipeable List Items

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
    let startTime = 0;
    let currentDx = 0;
    let isSwiping = false;
    let isScrolling = false;

    const resetOtherSwipes = () => {
      document.querySelectorAll(".swipeable-content.swiped-open").forEach(el => {
        if (el !== content) {
          el.style.transition = "transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)";
          el.style.transform = "translateX(0)";
          el.classList.remove("swiped-open");
          el.closest(".swipeable-wrapper")?.classList.remove("has-swipe-open", "is-swiping");
        }
      });
    };

    content.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("a")) return;
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
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
        if (Math.abs(dx) > 6) {
          isSwiping = true;
          wrapper.classList.add("is-swiping");
          resetOtherSwipes();
        }
      }

      if (isSwiping) {
        const baseOffset = content.classList.contains("swiped-open") ? -90 : 0;
        currentDx = Math.min(10, Math.max(-105, baseOffset + dx));
        content.style.transform = `translateX(${currentDx}px)`;
      }
    });

    const finishSwipe = (e) => {
      const elapsed = Math.max(1, Date.now() - startTime);
      const wasOpen = content.classList.contains("swiped-open");
      const totalDx = e.clientX - startX;
      const velocity = totalDx / elapsed;

      content.style.transition = "transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)";

      // Tap on open item snaps closed immediately
      if (!isSwiping && wasOpen && Math.hypot(totalDx, (e.clientY || startY) - startY) < 12) {
        content.style.transform = "translateX(0)";
        content.classList.remove("swiped-open");
        wrapper.classList.remove("has-swipe-open", "is-swiping");
        return;
      }

      if (!isSwiping) return;
      isSwiping = false;

      let shouldOpen = false;
      if (wasOpen) {
        // Drag right to close
        shouldOpen = !(totalDx > 20 || velocity > 0.2 || currentDx > -45);
      } else {
        // Drag left to open delete side
        shouldOpen = (totalDx < -25 || velocity < -0.22 || currentDx < -35);
      }

      if (shouldOpen) {
        content.style.transform = "translateX(-90px)";
        content.classList.add("swiped-open");
        wrapper.classList.add("has-swipe-open");
        wrapper.classList.remove("is-swiping");
      } else {
        content.style.transform = "translateX(0)";
        content.classList.remove("swiped-open");
        wrapper.classList.remove("has-swipe-open", "is-swiping");
      }
    };

    content.addEventListener("pointerup", finishSwipe);
    content.addEventListener("pointercancel", finishSwipe);
  });
}

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".swipeable-wrapper")) {
    document.querySelectorAll(".swipeable-content.swiped-open").forEach(el => {
      el.style.transition = "transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)";
      el.style.transform = "translateX(0)";
      el.classList.remove("swiped-open");
      el.closest(".swipeable-wrapper")?.classList.remove("has-swipe-open", "is-swiping");
    });
  }
});

/* --------------------------------------------------------------------------
   Native GNOME-Style On-Screen Touch Keyboard (OSK)
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

let lastOskInputTimestamp = 0;
const OSK_DEBOUNCE_MS = 130;

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

  // Attach zero-latency debounced pointer events
  container.querySelectorAll(".osk-key").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("touchstart", (e) => {
      e.preventDefault();
    }, { passive: false });

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add("active");

      const now = Date.now();
      if (now - lastOskInputTimestamp < OSK_DEBOUNCE_MS) {
        return;
      }
      lastOskInputTimestamp = now;

      const char = btn.getAttribute("data-char");
      const action = btn.getAttribute("data-action");

      if (char !== null) {
        handleOskKeyInput(char);
      } else if (action) {
        handleOskAction(action);
      }
    });

    const release = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
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

  // If in upper layer, return to lower after single character input
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
  const backdrop = document.getElementById("gnome-osk-backdrop");
  const labelEl = document.getElementById("osk-prompt-label");
  const inputEl = document.getElementById("osk-input-display");

  if (labelEl) labelEl.textContent = promptLabel || "Enter Text";
  if (inputEl) {
    inputEl.type = isPassword ? "password" : "text";
    inputEl.value = defaultValue || "";
  }

  currentOskLayer = "lower";
  renderGnomeOsk();

  if (backdrop) backdrop.classList.add("active");
  if (panel) {
    panel.classList.add("osk-visible");
    panel.setAttribute("aria-hidden", "false");
  }
};

window.closeTouchKeyboard = function(confirmed) {
  const panel = document.getElementById("gnome-osk");
  const backdrop = document.getElementById("gnome-osk-backdrop");
  const inputEl = document.getElementById("osk-input-display");
  const val = inputEl ? inputEl.value : "";

  if (backdrop) backdrop.classList.remove("active");
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
