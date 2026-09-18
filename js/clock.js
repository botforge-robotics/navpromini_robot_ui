// NavPro Mini - Real-Time Clock Module

function initClock() {
  const clockEl = document.getElementById("clock-display");
  if (!clockEl) return;
  function update() {
    const now = new Date();
    clockEl.textContent = now.toTimeString().split(" ")[0];
  }
  update();
  setInterval(update, 1000);
}
