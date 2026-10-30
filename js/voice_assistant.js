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
  let audioLevel = 0.0;
  let waveformAnimId = null;
  let pollInterval = null;

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

    // Event listeners
    btnMuteToggle?.addEventListener("click", toggleMute);
    btnTapToTalk?.addEventListener("click", triggerMicListen);
    document.getElementById("btn-voice-send-text")?.addEventListener("click", sendTextMessage);
    document.getElementById("btn-voice-clear-chat")?.addEventListener("click", clearChatDialog);

    textInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        sendTextMessage();
      }
    });

    // Start waveform animation loop
    startWaveformAnimation();

    // Fetch initial dialog history
    fetchDialog();
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
      wavePhase += isListening ? 0.08 : (isSpeaking ? 0.06 : 0.025);

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
      } else if (isListening) {
        baseAmp = 34 + Math.random() * 18;
        strokeColor1 = "rgba(16, 185, 129, 0.95)";
        strokeColor2 = "rgba(52, 211, 153, 0.55)";
        strokeColor3 = "rgba(110, 231, 183, 0.35)";
        glowColor = "rgba(16, 185, 129, 0.35)";
      } else if (isSpeaking) {
        baseAmp = 28 + Math.sin(wavePhase * 2.2) * 14;
        strokeColor1 = "rgba(99, 102, 241, 0.95)";
        strokeColor2 = "rgba(129, 140, 248, 0.55)";
        strokeColor3 = "rgba(165, 180, 252, 0.35)";
        glowColor = "rgba(99, 102, 241, 0.35)";
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
        updateMuteButtonUI();
        if (Array.isArray(data.messages)) {
          renderMessages(data.messages);
        }
      }
    } catch (e) {
      console.warn("fetchDialog note:", e);
    }
  }

  function renderMessages(messages) {
    if (!chatContainer) return;
    chatContainer.innerHTML = "";

    messages.forEach((msg) => {
      const isRobot = msg.sender === "robot";
      const row = document.createElement("div");
      row.className = `voice-chat-row ${isRobot ? "row-robot" : "row-user"}`;

      if (isRobot) {
        row.innerHTML = `
          <div class="chat-avatar avatar-robot" title="NavPro Mini">
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
    });

    // Auto-scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  async function triggerMicListen() {
    if (isMuted) {
      showToast("Microphone is currently muted. Unmute to listen.");
      return;
    }

    // Instant Barge-In: immediately interrupt any currently playing audio on touch
    try {
      fetch("/api/v1/voice/interrupt", { method: "POST" });
    } catch (e) {}
    isSpeaking = false;

    if (isListening) return;

    isListening = true;
    updateStatus("Listening to your voice...", "listening");
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
        updateStatus("Heard speech successfully", "success");
        if (data.reply) {
          isSpeaking = true;
          setTimeout(() => { isSpeaking = false; }, 3500);
        }
      } else if (data.status === "silence") {
        updateStatus("No clear speech detected. Try speaking closer to robot.", "idle");
      } else if (data.status === "ignored") {
        updateStatus("Filtered out background noise / chatter.", "idle");
      } else {
        updateStatus("Microphone listening finished.", "idle");
      }

      fetchDialog();
    } catch (err) {
      isListening = false;
      updateStatus("Audio capture error: " + err.message, "error");
    } finally {
      if (btnTapToTalk) {
        btnTapToTalk.classList.remove("recording");
        btnTapToTalk.innerHTML = `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span id="btn-voice-talk-label">Tap to Speak</span>
        `;
      }
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
    fetchDialog();
    resizeCanvas();
    if (!pollInterval) {
      pollInterval = setInterval(fetchDialog, 4000);
    }
  };

  window.toggleVoiceListening = triggerMicListen;
  window.toggleVoiceMute = toggleMute;

  // Auto-init on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
