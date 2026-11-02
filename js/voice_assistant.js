/**
 * NavPro Mini Live Voice Assistant & Dialog Controller
 * 
 * Features:
 * - Real-time animated audio waveform visualizer (Canvas-based)
 * - Conversational dialog history (Left: Robot with avatar, Right: User)
 * - One-tap Header Listen/Mute toggle button
 * - Live microphone audio capture + Speech-to-Text via SDK
 * - Neural voice talkback with cute Piper TTS
 * - Robot action execution (Dock, Undock, Road Route, Battery, Stop)
 */

(function () {
  let isListening = false;
  let isMuted = false;
  let isSpeaking = false;
  let isUserSpeaking = false;
  let userAudioLevel = 0.0;
  let audioLevel = 0.0;
  let waveformAnimId = null;
  let pollInterval = null;
  let fastPollInterval = null;

  // DOM Elements
  let canvas = null;
  let ctx = null;
  let chatContainer = null;
  let btnMuteToggle = null;
  let btnTapToTalk = null;
  let textInput = null;
  let statusBadge = null;

  function init() {
    canvas = document.getElementById("voice-waveform-canvas");
    if (canvas) {
      ctx = canvas.getContext("2d");
      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);
    }

    chatContainer = document.getElementById("voice-chat-messages");
    btnMuteToggle = document.getElementById("btn-voice-mute-toggle");
    btnTapToTalk = document.getElementById("btn-voice-tap-to-talk");
    textInput = document.getElementById("voice-text-input");
    statusBadge = document.getElementById("voice-status-badge");

    // Event listeners: inline onclick on button handles clicks with debounce
    btnMuteToggle?.addEventListener("click", toggleMute);

    document.getElementById("btn-voice-send-text")?.addEventListener("click", sendTextMessage);
    document.getElementById("btn-voice-clear-chat")?.addEventListener("click", clearChatDialog);

    textInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        sendTextMessage();
      }
    });

    // Start waveform animation loop
    startWaveformAnimation();

    // Fetch initial dialog history & live stream state
    fetchDialog();
    checkLiveStatus();
    if (!fastPollInterval) {
      fastPollInterval = setInterval(() => {
        checkLiveStatus();
      }, 350);
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) {
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = rect.height * (window.devicePixelRatio || 1);
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Audio Waveform Visualizer
  // ---------------------------------------------------------------------------
  let wavePhase = 0;

  function startWaveformAnimation() {
    if (waveformAnimId) cancelAnimationFrame(waveformAnimId);

    function draw() {
      if (!canvas || !ctx) return;
      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      ctx.clearRect(0, 0, width, height);

      const centerY = height / 2;
      wavePhase += isSpeaking ? 0.09 : (isUserSpeaking ? 0.08 : (isListening ? 0.035 : 0.02));

      // Determine colors and amplitude based on active state
      let baseAmp = 6;
      let strokeColor1 = "rgba(100, 116, 139, 0.4)";
      let strokeColor2 = "rgba(148, 163, 184, 0.25)";
      let strokeColor3 = "rgba(203, 213, 225, 0.2)";
      let glowColor = "transparent";

      if (isMuted) {
        baseAmp = 2;
        strokeColor1 = "rgba(239, 68, 68, 0.45)";
        strokeColor2 = "rgba(220, 38, 38, 0.2)";
        strokeColor3 = "transparent";
      } else if (isSpeaking) {
        // Robot Speaking: Vibrant Orange waves (scaled to keep waves untrimmed at top & bottom)
        baseAmp = 25 + Math.sin(wavePhase * 2.5) * 8;
        strokeColor1 = "rgba(249, 115, 22, 0.95)";
        strokeColor2 = "rgba(251, 146, 60, 0.65)";
        strokeColor3 = "rgba(253, 186, 116, 0.40)";
        glowColor = "rgba(249, 115, 22, 0.55)";
      } else if (isListening || (liveActive && !liveMuted)) {
        // Listening / User Speaking: Vibrant Green waves (scaled with headroom)
        if (isUserSpeaking) {
          // User is actively speaking: dynamic responsive emerald green waves
          const boost = Math.min(18, Math.max(8, userAudioLevel * 35));
          baseAmp = 18 + boost + Math.sin(wavePhase * 3.1) * 6;
          strokeColor1 = "rgba(16, 185, 129, 0.95)";
          strokeColor2 = "rgba(52, 211, 153, 0.70)";
          strokeColor3 = "rgba(110, 231, 183, 0.45)";
          glowColor = "rgba(16, 185, 129, 0.60)";
        } else {
          // Gentle resting breathing green wave
          baseAmp = 10 + Math.sin(wavePhase * 1.6) * 3;
          strokeColor1 = "rgba(16, 185, 129, 0.70)";
          strokeColor2 = "rgba(52, 211, 153, 0.40)";
          strokeColor3 = "rgba(110, 231, 183, 0.25)";
          glowColor = "rgba(16, 185, 129, 0.25)";
        }
      }

      // Draw tertiary harmonic wave
      if (strokeColor3 !== "transparent") {
        ctx.beginPath();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = strokeColor3;
        for (let x = 0; x < width; x += 3) {
          const norm = (x / width) * Math.PI * 4;
          const env = Math.sin((x / width) * Math.PI);
          const y = centerY + Math.sin(norm + wavePhase * 0.7) * (baseAmp * 0.4) * env;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Draw secondary background wave
      ctx.beginPath();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = strokeColor2;
      for (let x = 0; x < width; x += 3) {
        const norm = (x / width) * Math.PI * 3.5;
        const env = Math.sin((x / width) * Math.PI);
        const y = centerY + Math.sin(norm - wavePhase * 1.1) * (baseAmp * 0.65) * env;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Draw primary main wave
      ctx.beginPath();
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = strokeColor1;
      if (glowColor !== "transparent") {
        ctx.shadowBlur = 14;
        ctx.shadowColor = glowColor;
      } else {
        ctx.shadowBlur = 0;
      }

      for (let x = 0; x < width; x += 2) {
        const norm = (x / width) * Math.PI * 3;
        const env = Math.sin((x / width) * Math.PI);
        const y = centerY + Math.sin(norm + wavePhase) * baseAmp * env;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      waveformAnimId = requestAnimationFrame(draw);
    }

    draw();
  }

  // ---------------------------------------------------------------------------
  // API Integration: Listen, Chat, Mute, Dialog
  // ---------------------------------------------------------------------------

  async function fetchDialog() {
    try {
      const res = await fetch("/api/v1/voice/dialog");
      if (res.ok) {
        const data = await res.json();
        isMuted = !!data.muted;
        isListening = !!data.listening;
        if (data.speaking !== undefined) {
          isSpeaking = !!data.speaking;
        }
        if (data.user_speaking !== undefined) {
          isUserSpeaking = !!data.user_speaking;
        }
        updateMuteButtonUI();
        updateMicSourceBadge(data);
        if (Array.isArray(data.messages)) {
          renderMessages(data.messages);
        }
      }
    } catch (e) {
      console.warn("fetchDialog note:", e);
    }
  }

  let lastMessagesSignature = "";
  let sessionOpenedTimestamp = 0;

  function renderMessages(messages) {
    if (!chatContainer || !Array.isArray(messages)) return;

    const sessionMessages = messages;

    // If no messages yet in this session, show a welcoming greeting from Aria
    if (sessionMessages.length === 0) {
      chatContainer.innerHTML = `
        <div class="voice-chat-row row-robot" data-msg-id="aria-welcome">
          <div class="chat-avatar avatar-robot" title="Aria">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="10" rx="2"></rect>
              <circle cx="12" cy="5" r="2"></circle>
              <path d="M12 7v4"></path>
              <line x1="8" y1="16" x2="8" y2="16"></line>
              <line x1="16" y1="16" x2="16" y2="16"></line>
            </svg>
          </div>
          <div class="chat-bubble bubble-robot">
            <div class="bubble-text">Hi! I'm Aria. How can I help you?</div>
          </div>
        </div>
      `;
      lastMessagesSignature = "aria-welcome";
      return;
    }

    // Remove welcome placeholder if actual messages exist
    const welcomeEl = chatContainer.querySelector('[data-msg-id="aria-welcome"]');
    if (welcomeEl) {
      welcomeEl.remove();
    }

    // Fast fingerprint comparison to eliminate flickering when messages have not changed
    const currentSignature = sessionMessages.map(m => `${m.id || ""}_${m.text || ""}_${m.action || ""}`).join("|");
    if (currentSignature === lastMessagesSignature) {
      // Zero change: DO NOT touch DOM, preventing periodic re-render flicker
      return;
    }
    lastMessagesSignature = currentSignature;

    // Smart reconciliation: find existing message rows by data-msg-id
    const existingRows = chatContainer.querySelectorAll(".voice-chat-row");
    const existingIds = new Set();
    existingRows.forEach(row => {
      if (row.dataset.msgId) existingIds.add(row.dataset.msgId);
    });

    // If chat was cleared or reset, wipe and rebuild
    if (sessionMessages.length < existingIds.size) {
      chatContainer.innerHTML = "";
      existingIds.clear();
    }

    let appendedNew = false;
    sessionMessages.forEach((msg) => {
      const msgId = String(msg.id || "");
      if (msgId && existingIds.has(msgId)) {
        const existingRow = chatContainer.querySelector(`[data-msg-id="${msgId}"]`);
        if (existingRow) {
          const bubbleText = existingRow.querySelector(".bubble-text");
          if (bubbleText && bubbleText.textContent !== msg.text) {
            bubbleText.textContent = msg.text;
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
        }
        return;
      }

      const isRobot = msg.sender === "robot";
      const row = document.createElement("div");
      row.className = `voice-chat-row ${isRobot ? "row-robot" : "row-user"}`;
      if (msgId) row.dataset.msgId = msgId;

      if (isRobot) {
        row.innerHTML = `
          <div class="chat-avatar avatar-robot" title="Aria">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="10" rx="2"></rect>
              <circle cx="12" cy="5" r="2"></circle>
              <path d="M12 7v4"></path>
              <line x1="8" y1="16" x2="8" y2="16"></line>
              <line x1="16" y1="16" x2="16" y2="16"></line>
            </svg>
          </div>
          <div class="chat-bubble bubble-robot">
            <div class="bubble-text">${escapeHtml(msg.text)}</div>
            ${msg.action ? `<span class="bubble-action-tag">⚡ ${escapeHtml(msg.action)}</span>` : ""}
          </div>
        `;
      } else {
        row.innerHTML = `
          <div class="chat-bubble bubble-user">
            <div class="bubble-text">${escapeHtml(msg.text)}</div>
          </div>
          <div class="chat-avatar avatar-user" title="You">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
        `;
      }

      chatContainer.appendChild(row);
      if (msgId) existingIds.add(msgId);
      appendedNew = true;
    });

    // Auto-scroll only when new messages were actually appended
    if (appendedNew) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  let liveActive = false;
  let liveMuted = false;
  let liveConnecting = false;
  let hasGeminiKey = false;
  let isTogglingLive = false;

  let currentMicSource = "aria_sense";

  function updateMicSourceBadge(data) {
    const micBadge = document.getElementById("voice-mic-source-label");
    if (!micBadge || !data) return;
    const isAriaSense = data.aria_sense_active || data.audio_source === "aria_sense";
    currentMicSource = isAriaSense ? "aria_sense" : "chassis_mic";
    if (isAriaSense) {
      micBadge.textContent = "🎙️ Aria Sense Mic";
      micBadge.className = "voice-mic-badge is-aria-sense";
      micBadge.title = "Aria Sense Top Microphone (Active 16kHz Studio Audio)";
    } else {
      micBadge.textContent = "🎙️ Chassis Mic";
      micBadge.className = "voice-mic-badge is-chassis";
      micBadge.title = "Chassis Microphone (Aria Sense Offline)";
    }
  }

  window.onVoiceMicBadgeClick = function (e) {
    if (e) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
    if (currentMicSource === "aria_sense") {
      showToast("🎙️ Using Aria Sense Top Microphone (16kHz Studio Audio)");
    } else {
      showToast("ℹ️ Chassis Mic active. Tap Aria Sense icon in top bar to connect.");
    }
  };

  function appendOrUpdateMessage(msg) {
    if (!chatContainer || !msg || !msg.text) return;
    const welcomeEl = chatContainer.querySelector('[data-msg-id="aria-welcome"]');
    if (welcomeEl) {
      welcomeEl.remove();
    }
    const msgId = String(msg.id || "");
    const isRobot = msg.sender === "robot";

    if (msgId) {
      const existingRow = chatContainer.querySelector(`[data-msg-id="${msgId}"]`);
      if (existingRow) {
        const bubbleText = existingRow.querySelector(".bubble-text");
        if (bubbleText && bubbleText.textContent !== msg.text) {
          bubbleText.textContent = msg.text;
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        if (msg.action && !existingRow.querySelector(".bubble-action-tag")) {
          const bubble = existingRow.querySelector(".chat-bubble");
          if (bubble) {
            const tag = document.createElement("span");
            tag.className = "bubble-action-tag";
            tag.textContent = `⚡ ${msg.action}`;
            bubble.appendChild(tag);
          }
        }
        return;
      }
    }

    const row = document.createElement("div");
    row.className = `voice-chat-row ${isRobot ? "row-robot" : "row-user"}`;
    if (msgId) row.dataset.msgId = msgId;

    if (isRobot) {
      row.innerHTML = `
        <div class="chat-avatar avatar-robot" title="Aria">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="10" rx="2"></rect>
            <circle cx="12" cy="5" r="2"></circle>
            <path d="M12 7v4"></path>
            <line x1="8" y1="16" x2="8" y2="16"></line>
            <line x1="16" y1="16" x2="16" y2="16"></line>
          </svg>
        </div>
        <div class="chat-bubble bubble-robot">
          <div class="bubble-text">${escapeHtml(msg.text)}</div>
          ${msg.action ? `<span class="bubble-action-tag">⚡ ${escapeHtml(msg.action)}</span>` : ""}
        </div>
      `;
    } else {
      row.innerHTML = `
        <div class="chat-bubble bubble-user">
          <div class="bubble-text">${escapeHtml(msg.text)}</div>
        </div>
        <div class="chat-avatar avatar-user" title="You">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
      `;
    }

    chatContainer.appendChild(row);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  window.handleVoiceEvent = function (ev, data) {
    if (ev === "voice.speaking") {
      isSpeaking = !!(data && data.speaking);
      if (isSpeaking) {
        isUserSpeaking = false;
        userAudioLevel = 0.0;
      }
      updateLiveButtonUI();
    } else if (ev === "voice.user_speaking") {
      isUserSpeaking = !!(data && data.speaking);
      if (data && typeof data.level === "number") {
        userAudioLevel = isUserSpeaking ? data.level : 0.0;
      } else if (!isUserSpeaking) {
        userAudioLevel = 0.0;
      }
      if (liveActive && !liveMuted) {
        isListening = true;
      }
      updateLiveButtonUI();
    } else if (ev === "voice.transcript") {
      if (data && data.sender && data.text) {
        appendOrUpdateMessage(data);
      }
      fetchDialog();
    }
  };

  async function checkLiveStatus() {
    if (isTogglingLive) return; // Do not overwrite user tap state while toggle is in flight
    try {
      const res = await fetch("/api/v1/voice/live/status");
      const data = await res.json();
      if (isTogglingLive) return;
      liveActive = !!data.active;
      liveMuted = !!data.muted;
      liveConnecting = !!data.connecting;
      hasGeminiKey = !!data.has_gemini_key;
      if (liveActive && !liveMuted) {
        isListening = true;
        isMuted = false;
      } else if (liveMuted) {
        isMuted = true;
        isListening = false;
      }
      if (data.speaking !== undefined) {
        isSpeaking = !!data.speaking;
        if (isSpeaking) {
          isUserSpeaking = false;
          userAudioLevel = 0.0;
        }
      }
      if (data.user_speaking !== undefined) {
        isUserSpeaking = !isSpeaking && !!data.user_speaking;
        if (!isUserSpeaking) {
          userAudioLevel = 0.0;
        }
      }
      updateLiveButtonUI();
      updateMicSourceBadge(data);
    } catch (e) {
      console.warn("checkLiveStatus error:", e);
    }
  }

  function updateLiveButtonUI() {
    // Synchronize avatar status dot
    const dot = document.querySelector(".voice-avatar-status-dot");
    if (dot) {
      if (isSpeaking) {
        dot.classList.add("is-speaking");
      } else {
        dot.classList.remove("is-speaking");
      }
    }

    if (!btnTapToTalk) return;
    if (liveConnecting) {
      btnTapToTalk.className = "btn-clean-tap-to-talk is-connecting";
      btnTapToTalk.innerHTML = `
        <span class="talk-mic-anim"></span>
        <span id="btn-voice-talk-label">Connecting Live...</span>
      `;
      isListening = true;
      return;
    }
    if (liveActive && !liveMuted) {
      isListening = true;
      isMuted = false;

      if (isSpeaking) {
        // Robot Speaking: Orange button with pulse
        btnTapToTalk.className = "btn-clean-tap-to-talk is-speaking-orange";
        btnTapToTalk.innerHTML = `
          <span class="live-indicator-dot" style="background:#f97316;box-shadow:0 0 10px #f97316;"></span>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
          <span id="btn-voice-talk-label">Aria Speaking • Tap to Barge In</span>
        `;
      } else if (isUserSpeaking) {
        // User Speaking: Emerald green button with speech indicator
        btnTapToTalk.className = "btn-clean-tap-to-talk is-user-speaking-green";
        btnTapToTalk.innerHTML = `
          <span class="live-indicator-dot" style="background:#10b981;box-shadow:0 0 12px #10b981;"></span>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span id="btn-voice-talk-label">Listening...</span>
        `;
      } else {
        // Ambient Listening: Calm green button
        btnTapToTalk.className = "btn-clean-tap-to-talk is-live-streaming";
        btnTapToTalk.innerHTML = `
          <span class="live-indicator-dot"></span>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span id="btn-voice-talk-label">Aria Ready • Tap to Mute</span>
        `;
      }
    } else if (liveActive && liveMuted) {
      btnTapToTalk.className = "btn-clean-tap-to-talk is-live-muted";
      btnTapToTalk.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span id="btn-voice-talk-label">Tap to Unmute</span>
      `;
      isListening = false;
      isMuted = true;
    } else {
      btnTapToTalk.className = "btn-clean-tap-to-talk";
      btnTapToTalk.innerHTML = `
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span id="btn-voice-talk-label">Tap to Speak</span>
      `;
      isListening = false;
      isMuted = false;
    }
  }

  let lastLiveTapTs = 0;
  async function handleLiveButtonTap(e) {
    if (e) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
    const now = Date.now();
    if (now - lastLiveTapTs < 350 || isTogglingLive) return;
    lastLiveTapTs = now;

    if (liveConnecting) return;

    // Instant Barge-In: immediately interrupt any playing speech so Aria listens
    try {
      fetch("/api/v1/voice/interrupt", { method: "POST" });
    } catch (e) {}

    isTogglingLive = true;

    // If not active, start the live session
    if (!liveActive && !liveConnecting) {
      liveConnecting = true;
      updateLiveButtonUI();
      try {
        const res = await fetch("/api/v1/voice/live/start", { method: "POST" });
        const data = await res.json();
        if (res.ok) {
          liveActive = true;
          liveMuted = false;
          liveConnecting = false;
          updateLiveButtonUI();
          showToast("✨ Aria is listening! Speak naturally in full-duplex.");
        } else {
          liveConnecting = false;
          showToast("⚠️ " + (data.message || data.error || "Could not start Live assistant"));
        }
      } catch (err) {
        liveConnecting = false;
        console.warn("live start error:", err);
      } finally {
        isTogglingLive = false;
      }
      return;
    }

    // In Full-Duplex mode: tapping the button toggles mute/unmute
    if (liveActive && !liveMuted) {
      // Currently listening → mute
      liveMuted = true;
      updateLiveButtonUI();
      showToast("🔇 Aria muted. Tap again to unmute.");
    } else {
      // Currently muted → unmute and barge-in
      liveMuted = false;
      updateLiveButtonUI();
      showToast("🎤 Aria is listening to you...");
    }

    try {
      const res = await fetch("/api/v1/voice/live/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ muted: liveMuted })
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 400 && data.code === "gemini_key_missing") {
          showToast("⚠️ Google Gemini API key required for Live voice stream.");
        }
        await checkLiveStatus();
        return;
      }

      if (data.active !== undefined) {
        liveActive = !!data.active;
        liveMuted = !!data.muted;
        updateLiveButtonUI();
      }
    } catch (err) {
      console.warn("handleLiveButtonTap error:", err);
      await checkLiveStatus();
    } finally {
      setTimeout(() => {
        isTogglingLive = false;
      }, 300);
    }
  }

  async function triggerMicListenFallback() {
    if (isMuted) {
      showToast("Microphone is currently muted.");
      return;
    }

    if (isListening) return;

    isListening = true;
    updateStatus("Listening...", "listening");
    if (btnTapToTalk) {
      btnTapToTalk.classList.add("recording");
      btnTapToTalk.innerHTML = `
        <span class="talk-mic-anim"></span>
        <span>Listening...</span>
      `;
    }

    try {
      const res = await fetch("/api/v1/voice/listen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_sec: 4.0, auto_reply: true })
      });

      const data = await res.json();
      isListening = false;

      if (data.status === "success") {
        updateStatus("Speech processed", "success");
        if (data.reply) {
          isSpeaking = true;
          setTimeout(() => { isSpeaking = false; }, 3500);
        }
      } else if (data.status === "silence") {
        updateStatus("No speech detected.", "idle");
      } else if (data.status === "ignored") {
        updateStatus("Filtered ambient chatter.", "idle");
      }

      fetchDialog();
    } catch (err) {
      isListening = false;
      updateStatus("Audio capture error: " + err.message, "error");
    } finally {
      updateLiveButtonUI();
    }
  }

  async function sendTextMessage() {
    const text = textInput ? textInput.value.trim() : "";
    if (!text) return;
    if (textInput) textInput.value = "";

    updateStatus("Sending message to agent...", "thinking");
    try {
      const res = await fetch("/api/v1/voice/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, speak: true })
      });
      const data = await res.json();
      updateStatus("Agent replied", "success");
      isSpeaking = true;
      setTimeout(() => { isSpeaking = false; }, 3000);
      fetchDialog();
    } catch (err) {
      updateStatus("Error: " + err.message, "error");
    }
  }

  window.sendVoiceQuickPrompt = function(promptText) {
    if (textInput) textInput.value = promptText;
    sendTextMessage();
  };

  async function toggleMute() {
    try {
      const res = await fetch("/api/v1/voice/mute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      isMuted = !!data.muted;
      updateMuteButtonUI();
      updateStatus(data.message || (isMuted ? "Muted" : "Listening"), isMuted ? "muted" : "idle");
    } catch (e) {
      console.warn("toggleMute error:", e);
    }
  }

  function updateMuteButtonUI() {
    if (!btnMuteToggle) return;
    if (isMuted) {
      btnMuteToggle.className = "btn btn-voice-header btn-voice-muted";
      btnMuteToggle.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span>Agent Muted</span>
      `;
    } else {
      btnMuteToggle.className = "btn btn-voice-header btn-voice-active";
      btnMuteToggle.innerHTML = `
        <span class="voice-pulse-indicator"></span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span>Listening</span>
      `;
    }
  }

  async function clearChatDialog() {
    try {
      await fetch("/api/v1/voice/dialog", { method: "DELETE" });
      fetchDialog();
    } catch (e) {
      console.warn("clearChatDialog error:", e);
    }
  }

  function updateStatus(text, mode) {
    if (!statusBadge) return;
    statusBadge.textContent = text;
    statusBadge.className = `voice-status-badge mode-${mode}`;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(msg) {
    if (window.showToast) {
      window.showToast(msg);
    } else {
      console.log("[Toast]", msg);
    }
  }

  // Public hooks
  window.initVoiceAssistant = function () {
    // Whenever assistant is opened, clear previous chat bubbles so view starts fresh
    sessionOpenedTimestamp = (Date.now() / 1000) - 20.0;
    if (chatContainer) {
      chatContainer.innerHTML = "";
    }
    lastMessagesSignature = "";
    fetchDialog();
    checkLiveStatus();
    resizeCanvas();
    if (!pollInterval) {
      pollInterval = setInterval(() => {
        fetchDialog();
      }, 1500);
    }
    if (!fastPollInterval) {
      fastPollInterval = setInterval(() => {
        checkLiveStatus();
      }, 350);
    }
  };

  window.toggleVoiceListening = handleLiveButtonTap;
  window.toggleVoiceMute = toggleMute;

  // Auto-init on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
