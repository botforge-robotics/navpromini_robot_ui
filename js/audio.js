// ==============================================================================
// NavPro Mini - Onboard Audio & Speech Synthesis Engine (Web Audio & Web Speech)
// ==============================================================================

window.playAudioTone = function(freq = 587, type = 'sine', duration = 0.2) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!window._navproAudioCtx) {
      window._navproAudioCtx = new AudioCtx();
    }
    const ctx = window._navproAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.85, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn("AudioContext tone playback error:", e);
  }
};

window.playSuccessChime = function() {
  window.playAudioTone(587.33, 'sine', 0.20); // D5
  setTimeout(() => window.playAudioTone(880.00, 'sine', 0.35), 180); // A5
};

window.playAlertTone = function() {
  window.playAudioTone(493.88, 'triangle', 0.18); // B4
  setTimeout(() => window.playAudioTone(659.25, 'triangle', 0.28), 200); // E5
};

window.playTapBeep = function() {
  window.playAudioTone(880.0, 'sine', 0.05);
};

window.speakText = function(text) {
  if (!text) return;

  // Primary: Trigger Piper cute neural voice on robot companion hardware speaker
  fetch(`${API_BASE}/api/v1/system/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text })
  }).catch((err) => {
    // Fallback: Browser Web Speech API with cute pitch
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.pitch = 1.45; // Cute robotic pitch
        u.rate = 0.88; // Reduced speed for clear, cute robot pronunciation
        window.speechSynthesis.speak(u);
      }
    } catch (e) {
      console.warn("speechSynthesis error:", e);
    }
  });
};
