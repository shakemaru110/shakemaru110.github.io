"use strict";

(() => {
  const storageKey = "shakemaru.metronome.v1";
  const settings = { tempo: 120, beats: 4, subdivision: 1, sound: "click", accent: true,
    onbeat: 80, offbeat: 40, master: 70 };
  const byId = id => document.getElementById(id);
  const toggle = byId("toggle");
  const tempo = byId("tempo");
  const tempoRange = byId("tempo-range");
  const beatDisplay = byId("beat-display");
  const playState = byId("play-state");
  const error = byId("error");
  let starting = false;
  let tapTimes = [];

  function valid(key, value) {
    if (key === "tempo") return Number.isFinite(value) && value >= 20 && value <= 300;
    if (key === "beats") return Number.isInteger(value) && value >= 1 && value <= 16;
    if (key === "subdivision") return [1, 2, 3, 4, 5, 6, 8].includes(value);
    if (key === "sound") return ["click", "wood", "beep"].includes(value);
    if (key === "accent") return typeof value === "boolean";
    return Number.isFinite(value) && value >= 0 && value <= 100;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const key of Object.keys(settings)) {
      if (saved && valid(key, saved[key])) settings[key] = saved[key];
    }
  } catch { /* Defaults also work when browser storage is unavailable. */ }

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Storage is optional. */ }
  }

  function drawBeats() {
    beatDisplay.replaceChildren();
    for (let i = 0; i < settings.beats; i++) {
      const beat = document.createElement("span");
      beat.className = "beat" + (i === 0 && settings.accent ? " first" : "");
      beat.textContent = i + 1;
      beatDisplay.append(beat);
    }
    byId("position").textContent = "—";
  }

  function resetTransport() {
    toggle.textContent = "再生";
    toggle.setAttribute("aria-pressed", "false");
    playState.textContent = "停止中";
    drawBeats();
  }

  const engine = new window.MetronomeAudio.Engine(settings, tick => {
    [...beatDisplay.children].forEach((beat, i) => {
      beat.classList.toggle("active", i === tick.beat);
      beat.classList.toggle("off", i === tick.beat && !tick.onbeat);
    });
    byId("position").textContent = `${tick.beat + 1}拍目 · ${tick.part + 1} / ${settings.subdivision}`;
  }, () => {
    resetTransport();
    playState.textContent = "音声が中断されました。再生で再開できます。";
  });

  async function start() {
    if (starting) return;
    starting = true;
    toggle.disabled = true;
    error.hidden = true;
    try {
      if (await engine.start()) {
        toggle.textContent = "停止";
        toggle.setAttribute("aria-pressed", "true");
        playState.textContent = "再生中";
      }
    } catch (failure) {
      engine.stop();
      resetTransport();
      error.textContent = failure.message || "音声を開始できませんでした。";
      error.hidden = false;
    } finally {
      starting = false;
      toggle.disabled = false;
    }
  }

  toggle.addEventListener("click", () => {
    if (engine.playing) { engine.stop(); resetTransport(); }
    else start();
  });

  function setTempo(value) {
    if (!Number.isFinite(value)) value = settings.tempo;
    engine.setTempo(Math.round(Math.max(20, Math.min(300, value)) * 10) / 10);
    tempo.value = settings.tempo;
    tempoRange.value = settings.tempo;
    save();
  }
  tempo.value = tempoRange.value = settings.tempo;
  tempo.addEventListener("input", () => {
    if (tempo.value !== "" && tempo.validity.valid) {
      engine.setTempo(tempo.valueAsNumber);
      tempoRange.value = settings.tempo;
      save();
    }
  });
  tempo.addEventListener("change", () => setTempo(tempo.valueAsNumber));
  tempo.addEventListener("blur", () => setTempo(tempo.value === "" ? settings.tempo : tempo.valueAsNumber));
  tempoRange.addEventListener("input", () => setTempo(Number(tempoRange.value)));
  byId("tempo-down").addEventListener("click", () => setTempo(settings.tempo - 1));
  byId("tempo-up").addEventListener("click", () => setTempo(settings.tempo + 1));

  function updateOffbeatHint() {
    byId("offbeat-hint").textContent = settings.subdivision === 1
      ? "4分音符ではオフビートは鳴りません。8分音符以上の細分化を選んでください。"
      : `1拍につきオンビート1音、オフビート${settings.subdivision - 1}音を鳴らします。`;
  }
  for (const key of ["beats", "subdivision", "sound", "accent"]) {
    const control = byId(key);
    if (key === "accent") control.checked = settings[key];
    else control.value = settings[key];
    control.addEventListener("change", () => {
      const restart = engine.playing && ["beats", "subdivision"].includes(key);
      if (restart) engine.stop();
      settings[key] = key === "accent" ? control.checked : key === "sound" ? control.value : Number(control.value);
      drawBeats();
      updateOffbeatHint();
      save();
      if (restart) { resetTransport(); start(); }
    });
  }

  for (const key of ["onbeat", "offbeat", "master"]) {
    const slider = byId(key + "-volume");
    const output = byId(key + "-value");
    slider.value = settings[key];
    output.value = settings[key] + "%";
    slider.addEventListener("input", () => {
      settings[key] = Number(slider.value);
      output.value = slider.value + "%";
      engine.updateVolumes();
      save();
    });
  }

  byId("tap").addEventListener("click", () => {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 3000) tapTimes = [];
    tapTimes.push(now);
    tapTimes = tapTimes.slice(-6);
    if (tapTimes.length < 2) byId("tap-status").textContent = "同じ間隔でもう一度タップしてください。";
    else {
      setTempo(60000 * (tapTimes.length - 1) / (now - tapTimes[0]));
      byId("tap-status").textContent = `${settings.tempo} BPMに設定しました。`;
    }
  });

  document.addEventListener("keydown", event => {
    if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest("input, select, textarea, button, a, [contenteditable]")) return;
    event.preventDefault();
    toggle.click();
  });
  window.addEventListener("pagehide", () => { engine.stop(); resetTransport(); });
  drawBeats();
  updateOffbeatHint();
})();
