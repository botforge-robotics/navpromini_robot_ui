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
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
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
  window.playAudioTone(587.33, 'sine', 0.18); // D5
  setTimeout(() => window.playAudioTone(880.00, 'sine', 0.3), 180); // A5
};

window.playAlertTone = function() {
  window.playAudioTone(440.0, 'triangle', 0.15);
  setTimeout(() => window.playAudioTone(440.0, 'triangle', 0.25), 180);
};

window.playTapBeep = function() {
  window.playAudioTone(800.0, 'sine', 0.04);
};

window.speakText = function(text) {
  if (!text) return;
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 1.05;
      window.speechSynthesis.speak(u);
    }
  } catch (e) {
    console.warn("speechSynthesis error:", e);
  }
};
