// NavPro Mini - Rive Robot Face Animations & Expressions (rio.riv)

function initRiveFace() {
  const canvas = document.getElementById("rive-face-canvas");
  if (!canvas) return;

  // Enforce crisp 800x800 internal buffer dimensions matching device width
  canvas.width = 800;
  canvas.height = 800;

  try {
    if (typeof rive === "undefined" || !rive.Rive) {
      console.warn("Rive runtime not loaded, falling back to CSS face.");
      showFallbackFace();
      return;
    }

    riveInstance = new rive.Rive({
      src: "assets/rio.riv",
      canvas: canvas,
      autoplay: true,
      stateMachines: "expressions",
      onLoad: () => {
        console.log("Rive animation loaded successfully with crisp 1:1 aspect ratio!");
        window.riveInstance = riveInstance;
        try {
          const inputs = riveInstance.stateMachineInputs("expressions");
          if (inputs && inputs.length > 0) {
            inputs.forEach(input => {
              riveInputs[input.name] = input;
            });
            window.riveInputs = riveInputs;
            console.log("Registered Rive expression triggers:", Object.keys(riveInputs));
          }
          triggerFaceExpression("idle");
        } catch (err) {
          console.warn("Error enumerating Rive state machine inputs:", err);
        }
      },
      onError: (err) => {
        console.error("Rive canvas error:", err);
        showFallbackFace();
      }
    });

    window.riveInstance = riveInstance;

    // Touch / click on face gives random cute reaction
    canvas.addEventListener("click", () => {
      const reactions = ["happy", "curios", "blush", "surprise", "thinking"];
      const pick = reactions[Math.floor(Math.random() * reactions.length)];
      triggerFaceExpression(pick);
      showSpeechBubble(getRandomReactionQuote(pick));
    });

  } catch (e) {
    console.error("Failed to initialize Rive:", e);
    showFallbackFace();
  }
}

function showFallbackFace() {
  const fb = document.getElementById("fallback-face");
  const cv = document.getElementById("rive-face-canvas");
  if (fb) fb.style.display = "flex";
  if (cv) cv.style.display = "none";
}

window.triggerFaceExpression = function(name) {
  if (riveInputs[name]) {
    try {
      riveInputs[name].fire();
      console.log(`Triggered expression: ${name}`);
    } catch (e) {
      console.warn(`Failed to fire trigger ${name}:`, e);
    }
  } else {
    console.log(`Expression trigger '${name}' not found in Rive model.`);
  }
};

function showSpeechBubble(text, durationMs = 4000) {
  const bubble = document.getElementById("face-speech-bubble");
  const textEl = document.getElementById("face-speech-text");
  if (!bubble || !textEl) return;
  textEl.textContent = text;
  bubble.style.display = "flex";
  clearTimeout(bubble._timer);
  bubble._timer = setTimeout(() => {
    bubble.style.display = "none";
  }, durationMs);
}

function getRandomReactionQuote(type) {
  const quotes = {
    happy: ["Feeling great and ready to assist!", "Always happy to serve!", "Beep boop! Hello there!"],
    curios: ["Scanning local surroundings...", "What are we exploring next?", "Observing navigation obstacles."],
    blush: ["Thank you! You're very kind.", "Aww, glad to be working together!", "(＾▽＾)"],
    thinking: ["Computing optimal path trajectory...", "Processing environmental telemetry...", "Calculating next waypoint."],
    surprise: ["Oh! Something caught my lidar!", "Whoa, that was unexpected!", "Sensor alert!"]
  };
  const list = quotes[type] || ["Ready for missions!"];
  return list[Math.floor(Math.random() * list.length)];
}
