// ==============================================================================
// NavPro Mini - Gemini 2.0 Flash Multimodal Live Virtual Avatar Assistant
// ==============================================================================
// Features:
// - Screen-gated lifecycle (Strictly active only when #tab-avatar is open)
// - Gemini 2.0 Flash Live WebSocket (16kHz PCM In / 24kHz PCM Out)
// - Manual Bottom-Left Mic Button [🎙️ Tap to Chat]
// - Continuous Live Talking with Barge-in Interruption
// - Auto-Silence Watchdog on Inactivity (8s silence -> standby, 0 tokens)
// - Real-time Viseme & Audio FFT Lip-Sync
// - Autonomous MCP / Robot Tool Calling (navigate_to_place, show_media, dock)
// ==============================================================================

(function() {
  'use strict';

  let ws = null;
  let audioContext = null;
  let micMediaStream = null;
  let scriptProcessor = null;
  let micGainNode = null;
  let playbackAnalyser = null;
  let activeAudioSources = [];
  let nextPlaybackTime = 0;

  // Session & State variables
  let aiConfig = null;
  let isScreenActive = false;
  let isLiveTalking = false;
  let isSpeaking = false;
  let silenceTimer = null;
  let visemeAnimId = null;
  let blinkTimer = null;
  let currentScenario = 'real_estate';

  const SILENCE_TIMEOUT_MS = 8000;
  const VAD_THRESHOLD = 0.025; // Energy threshold to detect user speech

  // ----------------------------------------------------------------------------
  // 1. Fetch AI Configuration from Robot SDK
  // ----------------------------------------------------------------------------
  async function loadAiConfig() {
    try {
      const resp = await fetch(`${API_BASE}/api/v1/ai/avatar/config`);
      if (resp.ok) {
        aiConfig = await resp.json();
        currentScenario = aiConfig.scenario || 'real_estate';
        updateScenarioUI();
      }
    } catch (e) {
      console.warn("[GeminiLive] Failed to load AI config from SDK:", e);
    }
  }

  function updateScenarioUI() {
    const titleEl = document.getElementById("avatar-scenario-title");
    const badgeEl = document.getElementById("ai-banner-scenario-badge");
    const chipsContainer = document.getElementById("avatar-suggestion-chips");

    let scenarioName = "AI Voice Assistant";
    let chips = [
      { label: "🍳 Kitchen Tour", action: "Tell me about the kitchen and guide me there" },
      { label: "🛏️ Master Suite", action: "Tell me about the master bedroom and guide me there" },
      { label: "🌅 Balcony View", action: "Tell me about the balcony and guide me there" },
      { label: "📐 Floor Plan", action: "Show me the floor plan" },
      { label: "⚡ Base Station", action: "Please return to your charging base" }
    ];

    if (currentScenario === 'shopping_mall') {
      scenarioName = "AI Voice Assistant";
      chips = [
        { label: "🛍️ Apple Store", action: "Where is the Apple Store? Please guide me" },
        { label: "☕ Starbucks", action: "Where is Starbucks?" },
        { label: "🍔 Food Court", action: "Where is the food court and what options are there?" },
        { label: "🚻 Restrooms", action: "Where are the nearest restrooms?" },
        { label: "⚡ Base Station", action: "Please return to your charging base" }
      ];
    } else if (currentScenario === 'custom') {
      scenarioName = "AI Voice Assistant";
    }

    if (titleEl) titleEl.textContent = scenarioName;
    if (badgeEl) badgeEl.textContent = scenarioName;

    if (chipsContainer) {
      chipsContainer.innerHTML = '';
      chips.forEach(chip => {
        const btn = document.createElement("button");
        btn.className = "avatar-chip";
        btn.textContent = chip.label;
        btn.onclick = () => {
          sendTextQuery(chip.action);
        };
        chipsContainer.appendChild(btn);
      });
    }
  }

  // ----------------------------------------------------------------------------
  // 2. Audio Pipeline Setup (16kHz PCM In, 24kHz PCM Out)
  // ----------------------------------------------------------------------------
  async function initAudioPipeline() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx({ sampleRate: 24000 });
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (!playbackAnalyser) {
      playbackAnalyser = audioContext.createAnalyser();
      playbackAnalyser.fftSize = 256;
      playbackAnalyser.connect(audioContext.destination);
    }
  }

  async function startMicrophoneCapture() {
    try {
      if (!audioContext) await initAudioPipeline();

      micMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const micSource = audioContext.createMediaStreamSource(micMediaStream);
      micGainNode = audioContext.createGain();
      micGainNode.gain.value = 1.0;

      // 4096-sample buffer for robust real-time PCM encoding
      scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      scriptProcessor.onaudioprocess = (e) => {
        if (!isLiveTalking || !ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // VAD (Voice Activity Detection) check
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        if (rms > VAD_THRESHOLD) {
          // User is actively speaking: reset silence countdown
          resetSilenceTimer();

          // Interruption: If robot is speaking and user talks, interrupt immediately!
          if (isSpeaking) {
            console.log("[GeminiLive] User interrupted while robot was speaking!");
            handleInterruption();
          }
        }

        // Convert Float32 (-1.0 to 1.0) to Int16 PCM Little-Endian
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert Int16 buffer to binary string -> base64
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        const pcmPayload = {
          realtime_input: {
            media_chunks: [
              {
                mime_type: "audio/pcm",
                data: base64Data
              }
            ]
          }
        };

        try {
          ws.send(JSON.stringify(pcmPayload));
        } catch (err) {
          console.warn("[GeminiLive] Failed to send audio chunk:", err);
        }
      };

      micSource.connect(micGainNode);
      micGainNode.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      console.log("[GeminiLive] Microphone audio capture active");
    } catch (err) {
      console.error("[GeminiLive] Failed to open microphone:", err);
      updateStatusBadge("Mic Error (Check Device)", false);
    }
  }

  function stopMicrophoneCapture() {
    if (scriptProcessor) {
      try { scriptProcessor.disconnect(); } catch (e) {}
      scriptProcessor = null;
    }
    if (micGainNode) {
      try { micGainNode.disconnect(); } catch (e) {}
      micGainNode = null;
    }
    if (micMediaStream) {
      try {
        micMediaStream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      micMediaStream = null;
    }
    console.log("[GeminiLive] Microphone audio capture stopped");
  }

  // ----------------------------------------------------------------------------
  // 3. WebSocket Connection to Gemini 2.0 Flash Live API
  // ----------------------------------------------------------------------------
  function connectGeminiLive() {
    if (!aiConfig || !aiConfig.apiKey) {
      updateStatusBadge("Setup Required", false);
      showAssistantMessage("AI Voice Assistant setup is required. Please set up the voice assistant in Settings.");
      return;
    }

    const host = "generativelanguage.googleapis.com";
    const path = "/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";
    const url = `wss://${host}${path}?key=${aiConfig.apiKey}`;

    console.log("[GeminiLive] Connecting to Gemini 2.0 Flash Live WebSocket...");
    updateStatusBadge("Connecting...", false);

    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.error("[GeminiLive] WebSocket creation failed:", e);
      updateStatusBadge("Connection Failed", false);
      return;
    }

    ws.onopen = () => {
      console.log("[GeminiLive] WebSocket connected! Sending handshake setup...");
      sendHandshakeSetup();
      updateStatusBadge("Ready to listen", false);
    };

    ws.onmessage = async (event) => {
      let data = event.data;
      if (data instanceof Blob) {
        data = await data.text();
      }
      try {
        const msg = JSON.parse(data);
        handleServerMessage(msg);
      } catch (err) {
        console.warn("[GeminiLive] Non-JSON message from Gemini Live:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("[GeminiLive] WebSocket error:", err);
      updateStatusBadge("Live Disconnected", false);
    };

    ws.onclose = () => {
      console.log("[GeminiLive] WebSocket closed");
      if (isScreenActive) {
        updateStatusBadge("Standby (Tap Mic)", false);
      }
    };
  }

  function sendHandshakeSetup() {
    const model = aiConfig?.model || "models/gemini-2.0-flash-exp";
    const voiceName = aiConfig?.voice || "Aoede";

    let defaultPrompt = aiConfig?.systemInstruction || "You are NavPro Assistant, an interactive commercial robot guide.";
    if (aiConfig?.waypointsKnowledge) {
      defaultPrompt += "\n\nAvailable Location Knowledge:\n" + JSON.stringify(aiConfig.waypointsKnowledge, null, 2);
    }

    const setupPayload = {
      setup: {
        model: model,
        generation_config: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: voiceName
              }
            }
          }
        },
        system_instruction: {
          parts: [{ text: defaultPrompt }]
        },
        tools: [
          {
            function_declarations: [
              {
                name: "navigate_to_place",
                description: "Commands the robot to autonomously navigate to a specific room or store waypoint.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    place_name: {
                      type: "STRING",
                      description: "Name of room or store (e.g. 'kitchen', 'master_bedroom', 'balcony', 'apple_store', 'starbucks')."
                    }
                  },
                  required: ["place_name"]
                }
              },
              {
                name: "get_current_location",
                description: "Returns the robot's current location or room in the building.",
                parameters: { type: "OBJECT", properties: {} }
              },
              {
                name: "show_media",
                description: "Displays a floor plan, brochure, or room specs card on the robot screen.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    media_id: { type: "STRING", description: "Identifier of the media or room (e.g. 'floor_plan', 'kitchen_specs')." },
                    title: { type: "STRING", description: "Title of the card to show" },
                    description: { type: "STRING", description: "Details or dimensions to display" }
                  },
                  required: ["media_id"]
                }
              },
              {
                name: "stop_robot_now",
                description: "Immediately stops robot motion if visitor asks to stop or wait.",
                parameters: { type: "OBJECT", properties: {} }
              },
              {
                name: "dock_at_station",
                description: "Commands the robot to return and dock at its charging station.",
                parameters: { type: "OBJECT", properties: {} }
              }
            ]
          }
        ]
      }
    };

    ws.send(JSON.stringify(setupPayload));
  }

  // ----------------------------------------------------------------------------
  // 4. Server Message Handling (Audio Output, Visemes & MCP Tool Execution)
  // ----------------------------------------------------------------------------
  function handleServerMessage(msg) {
    if (!msg.serverContent) return;

    // Check for Interruption event sent by Gemini
    if (msg.serverContent.interrupted) {
      console.log("[GeminiLive] Server acknowledged interruption");
      handleInterruption();
      return;
    }

    const modelTurn = msg.serverContent.modelTurn;
    if (modelTurn && modelTurn.parts) {
      for (const part of modelTurn.parts) {
        // Audio output PCM chunk (24kHz 16-bit mono)
        if (part.inlineData && part.inlineData.data) {
          queueAudioPlayback(part.inlineData.data);
        }

        // Subtitle / Text transcript
        if (part.text) {
          showAssistantMessage(part.text);
        }

        // Tool calling / Function calling
        if (part.functionCall) {
          executeToolCall(part.functionCall);
        }
      }
    }

    // Turn complete
    if (msg.serverContent.turnComplete) {
      isSpeaking = false;
      // Start 8s silence countdown
      startSilenceTimer();
    }
  }

  // ----------------------------------------------------------------------------
  // 5. Audio Playback Queue & Viseme Lip-Sync
  // ----------------------------------------------------------------------------
  function queueAudioPlayback(base64Pcm) {
    if (!audioContext || !playbackAnalyser) return;

    try {
      isSpeaking = true;
      clearSilenceTimer();

      // Decode base64 to binary Int16 PCM
      const binaryString = atob(base64Pcm);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const int16View = new Int16Array(bytes.buffer);

      // Convert Int16 to Float32
      const float32 = new Float32Array(int16View.length);
      for (let i = 0; i < int16View.length; i++) {
        float32[i] = int16View[i] / 32768.0;
      }

      // Create AudioBuffer at 24000 Hz
      const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(playbackAnalyser);

      const now = audioContext.currentTime;
      const startTime = Math.max(now, nextPlaybackTime);
      sourceNode.start(startTime);
      nextPlaybackTime = startTime + audioBuffer.duration;

      activeAudioSources.push(sourceNode);
      sourceNode.onended = () => {
        const idx = activeAudioSources.indexOf(sourceNode);
        if (idx !== -1) activeAudioSources.splice(idx, 1);
        if (activeAudioSources.length === 0) {
          isSpeaking = false;
          setMouthExpression("neutral");
        }
      };
    } catch (err) {
      console.warn("[GeminiLive] Audio decode/playback error:", err);
    }
  }

  function handleInterruption() {
    // 1. Immediately abort active audio playback
    activeAudioSources.forEach(src => {
      try { src.stop(); } catch (e) {}
    });
    activeAudioSources = [];
    nextPlaybackTime = audioContext ? audioContext.currentTime : 0;
    isSpeaking = false;

    // 2. Halt mouth visemes
    setMouthExpression("neutral");

    // 3. Reset silence timer
    resetSilenceTimer();
  }

  // ----------------------------------------------------------------------------
  // 6. Real-Time Viseme Animation Loop (Driven by FFT Analyser)
  // ----------------------------------------------------------------------------
  function startVisemeLoop() {
    if (visemeAnimId) cancelAnimationFrame(visemeAnimId);

    const freqData = new Uint8Array(playbackAnalyser ? playbackAnalyser.frequencyBinCount : 128);

    function frame() {
      if (!isScreenActive) return;

      if (isSpeaking && playbackAnalyser) {
        playbackAnalyser.getByteFrequencyData(freqData);

        // Calculate low-frequency (jaw drop: O, U), mid-frequency (width: A, E), and energy
        let lowSum = 0;
        let midSum = 0;
        let totalSum = 0;

        for (let i = 2; i < 14; i++) lowSum += freqData[i]; // ~200 - 800 Hz
        for (let i = 14; i < 35; i++) midSum += freqData[i]; // ~800 - 2200 Hz
        for (let i = 0; i < freqData.length; i++) totalSum += freqData[i];

        const lowAvg = lowSum / 12;
        const midAvg = midSum / 21;
        const totalAvg = totalSum / freqData.length;

        // Animate mouth SVG path
        updateAvatarMouth(lowAvg, midAvg, totalAvg);

        // Animate glowing aura ring
        updateAvatarAura(totalAvg);
      } else {
        setMouthExpression("neutral");
        updateAvatarAura(0);
      }

      visemeAnimId = requestAnimationFrame(frame);
    }

    visemeAnimId = requestAnimationFrame(frame);
  }

  function updateAvatarMouth(low, mid, total) {
    const mouthPath = document.getElementById("avatar-mouth-path");
    if (!mouthPath) return;

    if (total < 10) {
      // Gentle smile
      mouthPath.setAttribute("d", "M 70 140 Q 100 156 130 140");
      return;
    }

    // Dynamic viseme mouth opening based on energy
    const openH = Math.min(32, Math.max(6, (low / 255) * 40));
    const widthW = Math.min(75, Math.max(45, (mid / 255) * 80));

    const leftX = 100 - (widthW / 2);
    const rightX = 100 + (widthW / 2);
    const topY = 138 - (openH / 3);
    const bottomY = 142 + openH;

    // Rounded mouth cavity
    const d = `M ${leftX} ${topY} Q 100 ${topY - 4} ${rightX} ${topY} Q ${rightX + 4} ${140} ${rightX} ${bottomY} Q 100 ${bottomY + 8} ${leftX} ${bottomY} Q ${leftX - 4} ${140} ${leftX} ${topY} Z`;
    mouthPath.setAttribute("d", d);
  }

  function setMouthExpression(expr) {
    const mouthPath = document.getElementById("avatar-mouth-path");
    if (!mouthPath) return;
    if (expr === "neutral") {
      mouthPath.setAttribute("d", "M 70 140 Q 100 155 130 140");
    } else if (expr === "happy") {
      mouthPath.setAttribute("d", "M 65 136 Q 100 168 135 136 Q 100 148 65 136 Z");
    }
  }

  function updateAvatarAura(energy) {
    const aura = document.getElementById("avatar-aura-ring");
    if (!aura) return;
    const scale = 1.0 + Math.min(0.28, (energy / 255) * 0.4);
    const opacity = isLiveTalking ? Math.min(0.85, 0.35 + (energy / 255) * 0.6) : 0.15;
    aura.style.transform = `scale(${scale})`;
    aura.style.opacity = opacity.toString();
  }

  // ----------------------------------------------------------------------------
  // 7. Random Eye Blinking Engine
  // ----------------------------------------------------------------------------
  function startBlinking() {
    function scheduleNextBlink() {
      if (!isScreenActive) return;
      const delay = 2500 + Math.random() * 3000;
      blinkTimer = setTimeout(() => {
        triggerBlink();
        scheduleNextBlink();
      }, delay);
    }
    scheduleNextBlink();
  }

  function triggerBlink() {
    const eyes = document.querySelectorAll(".avatar-eye");
    eyes.forEach(eye => eye.classList.add("blinking"));
    setTimeout(() => {
      eyes.forEach(eye => eye.classList.remove("blinking"));
    }, 180);
  }

  // ----------------------------------------------------------------------------
  // 8. Auto-Silence Watchdog (Inactivity Mute)
  // ----------------------------------------------------------------------------
  function startSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      console.log("[GeminiLive] Silence timeout reached (8s) - entering Silent Standby");
      muteAvatarMic();
      updateStatusBadge("Ready to listen", false);
      showAssistantMessage("I'm here whenever you need me. Tap the microphone below to speak.");
    }, SILENCE_TIMEOUT_MS);
  }

  function resetSilenceTimer() {
    clearSilenceTimer();
  }

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  // ----------------------------------------------------------------------------
  // 9. Manual Mic Button & State Control (Bottom-Left)
  // ----------------------------------------------------------------------------
  window.toggleAvatarMic = async function() {
    if (isLiveTalking) {
      // User tapped while active -> Mute & go to standby
      muteAvatarMic();
    } else {
      // User tapped in standby -> Wake up into continuous live chat
      await wakeAvatarLiveChat();
    }
  };

  async function wakeAvatarLiveChat() {
    isLiveTalking = true;
    updateMicButtonUI(true);
    updateStatusBadge("Listening...", true);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectGeminiLive();
    }

    await startMicrophoneCapture();
    resetSilenceTimer();
  }

  function muteAvatarMic() {
    isLiveTalking = false;
    clearSilenceTimer();
    stopMicrophoneCapture();
    updateMicButtonUI(false);
    updateStatusBadge("Ready to listen", false);
  }

  function updateMicButtonUI(active) {
    const btn = document.getElementById("btn-avatar-mic");
    const label = document.getElementById("avatar-mic-label");
    if (!btn) return;

    if (active) {
      btn.classList.add("active-live");
      if (label) label.textContent = "Listening...";
    } else {
      btn.classList.remove("active-live");
      if (label) label.textContent = "Tap to Speak";
    }
  }

  function updateStatusBadge(text, isLive) {
    const pill = document.getElementById("avatar-live-pill");
    const textEl = document.getElementById("avatar-live-text");
    const stateText = document.getElementById("avatar-state-text");

    if (textEl) textEl.textContent = text;
    if (stateText) stateText.textContent = text;
    if (pill) {
      pill.classList.toggle("live-pulsing", isLive);
    }
  }

  function showAssistantMessage(text) {
    const el = document.getElementById("robot-transcript");
    if (el) el.textContent = text;
  }

  function showUserMessage(text) {
    const el = document.getElementById("user-transcript");
    if (el) el.textContent = `You: "${text}"`;
  }

  function sendTextQuery(text) {
    showUserMessage(text);
    if (!isLiveTalking) {
      wakeAvatarLiveChat();
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      const clientContent = {
        client_content: {
          turns: [
            {
              role: "user",
              parts: [{ text: text }]
            }
          ],
          turn_complete: true
        }
      };
      ws.send(JSON.stringify(clientContent));
    }
  }

  // ----------------------------------------------------------------------------
  // 10. Autonomous MCP Robot Tool Execution
  // ----------------------------------------------------------------------------
  async function executeToolCall(call) {
    const name = call.name;
    const args = call.args || {};
    const callId = call.id;

    console.log(`[GeminiLive] Executing tool: ${name}`, args);
    updateStatusBadge(`Action: ${name}...`, true);

    let output = { status: "success" };

    try {
      if (name === "navigate_to_place") {
        const place = (args.place_name || '').toLowerCase().trim();
        output = await handleNavigateToPlace(place);
      } else if (name === "get_current_location") {
        output = { location: "foyer", note: "Robot is currently at the entrance foyer." };
      } else if (name === "show_media") {
        showMediaCard(args.media_id, args.title, args.description);
        output = { status: "displayed", media_id: args.media_id };
      } else if (name === "stop_robot_now") {
        await fetch(`${API_BASE}/api/v1/navigation/goal`, { method: "DELETE" });
        output = { status: "stopped", message: "Robot motion halted immediately." };
      } else if (name === "dock_at_station") {
        await fetch(`${API_BASE}/api/v1/dock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ navigate_to_staging: true })
        });
        output = { status: "docking", message: "Returning to charging dock station." };
      }
    } catch (e) {
      output = { status: "error", message: e.message };
    }

    // Send Tool Response back to Gemini Live
    if (ws && ws.readyState === WebSocket.OPEN) {
      const toolResponse = {
        tool_response: {
          function_responses: [
            {
              response: { output: output },
              id: callId
            }
          ]
        }
      };
      ws.send(JSON.stringify(toolResponse));
    }
  }

  async function handleNavigateToPlace(place) {
    showToast(`Navigating to ${place}...`);
    try {
      // 1. Check if waypoint exists in robot map
      const resp = await fetch(`${API_BASE}/api/v1/waypoints`);
      if (resp.ok) {
        const wpData = await resp.json();
        const waypoints = wpData.waypoints || [];
        const match = waypoints.find(w => w.name.toLowerCase() === place || w.name.toLowerCase().includes(place));

        if (match) {
          // Trigger Nav2 navigation to this waypoint
          await fetch(`${API_BASE}/api/v1/navigation/goto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ waypoint_name: match.name })
          });
          return { status: "navigating", destination: match.name, estimated_sec: 12 };
        }
      }

      // Fallback: try direct navigation endpoint
      await fetch(`${API_BASE}/api/v1/navigation/goto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waypoint_name: place })
      });
      return { status: "navigating", destination: place };
    } catch (err) {
      return { status: "navigation_failed", error: err.message };
    }
  }

  function showMediaCard(id, title, desc) {
    const card = document.getElementById("avatar-media-card");
    const titleEl = document.getElementById("avatar-media-title");
    const descEl = document.getElementById("avatar-media-desc");
    const imgEl = document.getElementById("avatar-media-img");

    if (titleEl) titleEl.textContent = title || id.replace('_', ' ').toUpperCase();
    if (descEl) descEl.textContent = desc || "Floor plan & dimensions overview";

    if (imgEl) {
      imgEl.src = `media/${id}.jpg`;
      imgEl.onerror = () => {
        imgEl.src = "assets/logo.png";
      };
    }

    if (card) {
      card.style.display = "flex";
      setTimeout(() => card.classList.add("visible"), 50);
    }
  }

  window.closeAvatarMediaCard = function() {
    const card = document.getElementById("avatar-media-card");
    if (card) {
      card.classList.remove("visible");
      setTimeout(() => card.style.display = "none", 300);
    }
  };

  window.stopRobotAction = async function() {
    try {
      await fetch(`${API_BASE}/api/v1/navigation/goal`, { method: "DELETE" });
      showToast("Robot motion cancelled.");
    } catch (e) {}
  };

  window.dockRobotAction = async function() {
    try {
      showToast("Returning to charging dock...");
      await fetch(`${API_BASE}/api/v1/dock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ navigate_to_staging: true })
      });
    } catch (e) {}
  };

  // ----------------------------------------------------------------------------
  // 11. Screen-Gated Lifecycle (Strict Activation Gate)
  // ----------------------------------------------------------------------------
  window.initGeminiAvatarScreen = async function() {
    console.log("[GeminiLive] Mount: Initializing Virtual Avatar Screen...");
    isScreenActive = true;

    await loadAiConfig();
    await initAudioPipeline();
    startVisemeLoop();
    startBlinking();

    // Connect WebSocket in standby mode (waiting for user to tap mic)
    connectGeminiLive();
  };

  window.teardownGeminiAvatarScreen = function() {
    console.log("[GeminiLive] Unmount: Hard-muting mic and disconnecting Gemini Live...");
    isScreenActive = false;
    isLiveTalking = false;

    // 1. Hard mute all microphone tracks
    stopMicrophoneCapture();

    // 2. Stop audio playback and flush queues
    handleInterruption();

    // 3. Clear timers
    clearSilenceTimer();
    if (blinkTimer) clearTimeout(blinkTimer);
    if (visemeAnimId) cancelAnimationFrame(visemeAnimId);

    // 4. Close WebSocket
    if (ws) {
      try {
        ws.close();
      } catch (e) {}
      ws = null;
    }

    // 5. Reset UI elements
    updateMicButtonUI(false);
    setMouthExpression("neutral");
    window.closeAvatarMediaCard();
  };

})();
