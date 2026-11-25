import { AudioEngine } from "./engine.js";
import { defaultSession, validateSession, makePads, packs, padKeys, drums, drumNames, pattern, resizePattern, colors } from "./presets.js";
import { clamp, nextBoundary, quantizeBeat, beatDuration } from "./timing.js";
import { loadSession, saveSession, getSamples, saveSample, deleteSample, download, exportProject } from "./storage.js";
import { JamRoom } from "./jam.js";
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
let session = defaultSession(), samples = [], view = "pads", mode = "loop", instrument = "piano", octave = 4, selected = 12, saveTimer, toastTimer, restoring = false, recording = null, mixRecorder = null, wakeLock = null, writing = false;
const audio = new AudioEngine(session), jam = new JamRoom();
const palette = { coral: "#eea08b", lime: "#caee91", teal: "#88c8be", purple: "#b3a1d6" };
function toast(message, error = false) {
  $("#toast").textContent = message;
  $("#toast").classList.toggle("error", error);
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").hidden = true, error ? 6500 : 3500);
}
function attempt(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(e);
      toast(e.message || "Something went wrong.", true);
    }
  };
}
function bind(id, event, fn) {
  $(id).addEventListener(event, attempt(fn));
}
function changed() {
  if (restoring) return;
  $("#save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveSession(session);
      $("#save-status").textContent = "Saved on this device";
    } catch {
      $("#save-status").textContent = "Storage unavailable — export a backup";
      toast("Could not save locally. Export your project to keep it.", true);
    }
  }, 350);
}
async function ready() {
  await audio.init();
  for (const s of samples) if (!audio.buffers.has(s.id)) await audio.decode(s.id, await s.blob.arrayBuffer());
  $("#audio-status").textContent = `Audio ready · ${Math.round((audio.ctx.outputLatency || audio.ctx.baseLatency || 0) * 1e3)} ms output`;
  $("#latency-info").textContent = `Sample rate: ${audio.ctx.sampleRate.toLocaleString()} Hz. Base latency: ${Math.round((audio.ctx.baseLatency || 0) * 1e3)} ms. Output estimate: ${Math.round((audio.ctx.outputLatency || 0) * 1e3)} ms. Hardware and Bluetooth can add more delay.`;
}
function switchView(name) {
  view = name;
  $$(".view").forEach((e) => e.hidden = e.id !== "view-" + name);
  $$("[data-view]").forEach((e) => e.classList.toggle("active", e.dataset.view === name));
}
$$("[data-view]").forEach((e) => e.onclick = () => switchView(e.dataset.view));
function make(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== void 0) e.textContent = text;
  return e;
}
function renderPads() {
  const grid = $("#pad-grid");
  grid.replaceChildren();
  session.pads.forEach((p, i) => {
    const b = make("button", "pad" + (p.kind === "empty" ? " empty" : ""));
    b.dataset.id = i;
    b.dataset.color = p.color;
    b.setAttribute("aria-label", p.name + ", pad " + (i + 1));
    b.setAttribute("aria-pressed", String(audio.active.has(i)));
    const top = make("span", "pad-top");
    top.append(make("span", "", p.kind === "empty" ? "+" : p.kind === "shot" ? "ϟ" : "↻"), make("span", "pad-key", padKeys[i].toUpperCase()));
    b.append(top);
    if (p.kind !== "empty") {
      const wave = make("div", "waveform");
      for (let n = 0; n < 26; n++) {
        const bar = make("i");
        bar.style.setProperty("--h", 3 + (n * 13 + i * 7) % 19 + "px");
        wave.append(bar);
      }
      b.append(wave);
    }
    const bottom = make("span", "");
    bottom.append(make("span", "pad-name", p.name));
    if (p.kind !== "empty") {
      const sub = make("span", "pad-bottom");
      sub.append(make("span", "", p.kind === "shot" ? "ONE SHOT" : `${p.bars} BARS`), make("span", "pad-state", "▷"));
      bottom.append(sub);
    }
    b.append(bottom);
    let down = 0;
    b.addEventListener("pointerdown", attempt(async (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      down = Date.now();
      selected = i;
      if (p.kind === "empty") {
        openPad(i);
        return;
      }
      await triggerPad(i);
      b.classList.add("flash");
      setTimeout(() => b.classList.remove("flash"), 110);
    }));
    b.addEventListener("pointerup", () => {
      if (Date.now() - down > 550 && p.kind !== "empty") openPad(i);
    });
    b.addEventListener("dblclick", (e) => {
      e.preventDefault();
      openPad(i);
    });
    b.addEventListener("keydown", attempt(async (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selected = i;
        p.kind === "empty" ? openPad(i) : await triggerPad(i);
      }
    }));
    grid.append(b);
  });
  renderPadStates();
}
function renderPadStates() {
  for (const b of $$(".pad")) {
    const id = Number(b.dataset.id);
    b.classList.toggle("is-playing", audio.active.has(id));
    b.classList.toggle("is-queued", audio.pending.has(id));
    b.setAttribute("aria-pressed", String(audio.active.has(id)));
    const state = b.querySelector(".pad-state");
    if (state) state.textContent = audio.pending.has(id) ? "◷" : audio.active.has(id) ? "Ⅱ" : "▷";
  }
  renderMixer();
}
function renderMixer() {
  const container = $("#mixer");
  const playing = [.../* @__PURE__ */ new Set([...audio.active.keys(), ...audio.pending.keys()])];
  $("#active-count").textContent = audio.active.size + " PLAYING";
  $("#empty-mix").hidden = playing.length > 0;
  const ids = playing.join(",");
  if (container.dataset.ids === ids) {
    return;
  }
  container.dataset.ids = ids;
  container.replaceChildren();
  for (const id of playing) {
    const p = session.pads[id];
    if (!p) continue;
    const row = make("div", "mix-track"), color = make("i", "track-color"), info = make("div"), name = make("strong", "", p.name), slider = make("input");
    color.style.background = palette[p.color];
    slider.type = "range";
    slider.min = 0;
    slider.max = 100;
    slider.value = p.volume * 100;
    slider.setAttribute("aria-label", p.name + " volume");
    slider.oninput = () => {
      p.volume = Number(slider.value) / 100;
      audio.setPadVolume(id, p.volume);
      changed();
    };
    info.append(name, slider);
    const mute = make("button", audio.muted.has(id) ? "muted" : "", "M");
    mute.setAttribute("aria-label", "Mute " + p.name);
    mute.setAttribute("aria-pressed", String(audio.muted.has(id)));
    mute.onclick = () => {
      audio.muted.has(id) ? audio.muted.delete(id) : audio.muted.add(id);
      if (audio.muted.has(id)) audio.cancelPad(id);
      mute.classList.toggle("muted", audio.muted.has(id));
      mute.setAttribute("aria-pressed", String(audio.muted.has(id)));
    };
    row.append(color, info, mute);
    container.append(row);
  }
}
function renderTiming() {
  $("#bpm").value = session.bpm;
  $("#beats").value = session.beats;
  $("#bars").value = session.bars;
  $("#master-volume").value = session.master * 100;
  $("#volume-value").value = Math.round(session.master * 100) + "%";
  $("#input-latency").value = session.inputLatency;
  $("#output-offset").value = session.outputOffset;
  $("#jam-buffer").value = session.jamBuffer;
  $("#swing").value = session.swing;
  $("#swing-value").value = session.swing + "%";
  $("#seq-enabled").checked = session.seqEnabled;
  $("#project-name").value = session.name;
  $("#project-btn").firstChild.textContent = session.name + " ";
  $("#beat-lights").replaceChildren(...Array.from({ length: session.beats }, () => make("i")));
  for (const id of ["#bpm", "#beats", "#bars", "#tap-btn"]) $(id).disabled = jam.role === "follower";
}
function renderSequencer() {
  const c = $("#sequencer");
  c.replaceChildren();
  c.style.setProperty("--steps", session.beats * 4);
  const numbers = make("div", "seq-row");
  numbers.append(make("span"));
  for (let i = 0; i < session.beats * 4; i++) numbers.append(make("div", "seq-numbers", i % 4 === 0 ? String(i / 4 + 1) : "·"));
  c.append(numbers);
  for (const voice of ["kick", "snare", "hat", "clap"]) {
    const row = make("div", "seq-row");
    row.append(make("span", "", drumNames[voice]));
    session.pattern[voice].forEach((on, i) => {
      const b = make("button", "seq-step" + (on ? " on" : ""));
      b.setAttribute("aria-label", `${drumNames[voice]}, step ${i + 1}`);
      b.setAttribute("aria-pressed", String(on));
      b.dataset.step = i;
      b.onclick = attempt(async () => {
        await ready();
        sendAction({ type: "step", voice, index: i, on: !session.pattern[voice][i] });
      });
      row.append(b);
    });
    c.append(row);
  }
}
function renderLibrary() {
  const c = $("#preset-library");
  c.replaceChildren();
  for (const p of packs) {
    const b = make("button", "preset-card");
    b.append(make("span", "preset-art", p.art), make("strong", "", p.name), make("small", "", `${p.bpm} BPM · ${p.key}`), make("small", "", p.description));
    b.onclick = attempt(async () => {
      if (jam.role === "follower") throw new Error("Ask the room leader to change the sound pack.");
      await ready();
      if (recording) throw new Error("Finish your recording first.");
      sendAction({ type: "pack", id: p.id });
      toast(p.name + " loaded. Your samples are still in the library.");
    });
    c.append(b);
  }
  const sc = $("#sample-library");
  sc.replaceChildren();
  if (!samples.length) sc.append(make("p", "muted", "Nothing here yet. Bring a sound from your world."));
  for (const s of samples) {
    const row = make("div", "sample-item"), name = make("span", "", s.name), info = make("small", "", s.duration.toFixed(1) + " s"), assign = make("button", "", "Add to pad"), del = make("button", "", "×");
    assign.onclick = attempt(async () => {
      await ready();
      selected = emptyPad();
      await assignSample(s, selected);
      toast("Added to pad " + (selected + 1));
      switchView("pads");
    });
    del.setAttribute("aria-label", "Delete " + s.name);
    del.onclick = attempt(async () => {
      if (session.pads.some((p) => p.audioId === s.id)) throw new Error("Clear the pads using this sample before deleting it.");
      await deleteSample(s.id);
      samples = samples.filter((x) => x.id !== s.id);
      audio.buffers.delete(s.id);
      renderLibrary();
    });
    row.append(name, info, assign, del);
    sc.append(row);
  }
}
function emptyPad() {
  const index = session.pads.findIndex((p) => p.kind === "empty");
  if (index < 0) throw new Error("All pads are full. Clear or select a pad first.");
  return index;
}
function renderKeyboard() {
  const c = $("#keyboard");
  c.replaceChildren();
  const whites = [0, 2, 4, 5, 7, 9, 11, 12], black = [{ n: 1, x: 1 }, { n: 3, x: 2 }, { n: 6, x: 4 }, { n: 8, x: 5 }, { n: 10, x: 6 }];
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const scales = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };
  const scale = scales[$("#scale").value];
  const add = (n, isBlack, x) => {
    const b = make("button", "piano-key" + (isBlack ? " black" : "") + (scale && !scale.includes(n % 12) ? " out-scale" : ""), names[n % 12] + (n % 12 === 0 ? octave + Math.floor(n / 12) : ""));
    b.dataset.note = octave * 12 + 12 + n;
    if (isBlack) b.style.left = x / 8 * 100 + "%";
    b.setAttribute("aria-label", names[n % 12] + " octave " + (octave + Math.floor(n / 12)));
    b.onpointerdown = attempt(async (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      if (scale && !scale.includes(n % 12)) return;
      await playInstrument(Number(b.dataset.note));
      b.classList.add("pressed");
    });
    const up = () => b.classList.remove("pressed");
    b.onpointerup = up;
    b.onpointercancel = up;
    b.onlostpointercapture = up;
    b.onkeydown = attempt(async (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) await playInstrument(Number(b.dataset.note));
      }
    });
    c.append(b);
  };
  whites.forEach((n) => add(n, false));
  black.forEach((x) => add(x.n, true, x.x));
  $("#octave").textContent = octave;
}
function renderDrums() {
  const c = $("#drum-kit");
  c.replaceChildren();
  drums.forEach((voice) => {
    const b = make("button", "drum-hit", drumNames[voice]);
    b.onpointerdown = attempt(async (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      await playInstrument(60, voice);
      b.classList.add("pressed");
    });
    b.onpointerup = b.onpointercancel = () => b.classList.remove("pressed");
    b.onkeydown = attempt(async (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        await playInstrument(60, voice);
      }
    });
    c.append(b);
  });
}
function renderAll() {
  audio.session = session;
  for (const p of session.pads) audio.setPadVolume(p.id, p.volume);
  if (audio.master) audio.master.gain.setTargetAtTime(session.master, audio.ctx.currentTime, 0.01);
  renderTiming();
  renderPads();
  renderSequencer();
  renderLibrary();
  renderKeyboard();
  renderDrums();
  $("#mixer").dataset.ids = "";
  renderMixer();
}
function openPad(id) {
  selected = id;
  const p = session.pads[id];
  $("#pad-name").value = p.kind === "empty" ? "" : p.name;
  $("#pad-level").value = p.volume * 100;
  $("#pad-bars").value = p.bars;
  $("#pad-detail").textContent = p.kind === "empty" ? "Import audio, record a sound, or capture an instrument to fill this pad." : p.audioId ? "Audio fits to this many bars by playback speed. Pitch changes with tempo." : `${p.events.length} notes · ${p.kind === "shot" ? "one shot" : "musical loop"}`;
  $("#pad-dialog").showModal();
}
async function triggerPad(id) {
  await ready();
  const p = session.pads[id];
  if (mode === "shot" || p.kind === "shot") {
    const e = { type: "shot", id, at: audio.now() + session.jamBuffer };
    if (jam.role) {
      sendAction(e);
      audio.oneShot(id);
      localShots.add(e.at + ":" + id);
    } else audio.oneShot(id);
    return;
  }
  if (!audio.running) {
    if (jam.role === "follower") throw new Error("The leader needs to start the transport first.");
    sendAction({ type: "start", epoch: audio.now() + 250 });
  }
  const q = $("#launch-grid").value === "off" ? 0.25 : $("#launch-grid").value === "beat" ? 1 : session.beats;
  const beat = nextBoundary(audio.position(), q);
  const on = !(audio.pending.get(id)?.on ?? audio.active.has(id));
  sendAction({ type: "pad", id, beat, on });
}
const localShots = /* @__PURE__ */ new Set();
function sendAction(action) {
  if (jam.role) jam.command(action);
  else applyAction(action);
}
function validateAction(a, remote = false) {
  if (!a || typeof a !== "object") return false;
  const id = Number.isInteger(a.id) && a.id >= 0 && a.id < 16;
  switch (a.type) {
    case "start":
      return !remote && Number.isFinite(a.epoch) && Math.abs(a.epoch - audio.now()) < 1e4;
    case "stop":
    case "stoploops":
      return !remote;
    case "timing":
      return !remote && a.bpm >= 40 && a.bpm <= 240 && [3, 4, 5, 6, 7].includes(a.beats) && [1, 2, 4, 8].includes(a.bars);
    case "pack":
      return !remote && packs.some((p) => p.id === a.id);
    case "pad":
      return id && typeof a.on === "boolean" && Number.isFinite(a.beat) && a.beat >= audio.position() - 1 && a.beat < audio.position() + 128;
    case "shot":
      return id && Number.isFinite(a.at) && Math.abs(a.at - audio.now()) < 5e3;
    case "note":
      return ["piano", "bass", "guitar", "synth", "bell", ...drums].includes(a.voice) && Number.isFinite(a.note) && a.note >= 0 && a.note <= 127 && Number.isFinite(a.at) && Math.abs(a.at - audio.now()) < 5e3;
    case "step":
      return ["kick", "snare", "hat", "clap"].includes(a.voice) && Number.isInteger(a.index) && a.index >= 0 && a.index < session.beats * 4 && typeof a.on === "boolean";
    case "pattern":
      return typeof a.enabled === "boolean" && Number.isFinite(a.swing) && a.swing >= 0 && a.swing <= 60;
    case "setpad":
      try {
        const copy = structuredClone(session);
        copy.pads[a.pad.id] = a.pad;
        validateSession(copy);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}
function applyAction(a) {
  if (!validateAction(a)) return;
  switch (a.type) {
    case "start":
      audio.start(a.epoch);
      requestWake();
      break;
    case "stop":
      audio.stop();
      break;
    case "stoploops":
      audio.active.clear();
      audio.pending.clear();
      for (let id = 0; id < 16; id++) audio.cancelPad(id);
      renderPadStates();
      break;
    case "timing": {
      if (recording) {
        toast("Finish recording before changing timing.", true);
        return;
      }
      const was = audio.running;
      audio.stop(false);
      session.bpm = a.bpm;
      session.beats = a.beats;
      session.bars = a.bars;
      session.pattern = resizePattern(session.pattern, a.beats);
      for (const entry of audio.active.values()) entry.start = 0;
      if (was) audio.start(a.epoch || audio.now() + 250);
      renderTiming();
      renderSequencer();
      break;
    }
    case "pack":
      audio.stop();
      session.pack = a.id;
      session.pads = makePads(a.id);
      session.bpm = packs.find((p) => p.id === a.id).bpm;
      session.beats = 4;
      session.bars = 2;
      session.pattern = pattern(a.id === "dusty" ? "half" : "house");
      session.seqEnabled = false;
      renderAll();
      break;
    case "pad":
      if (!audio.running) break;
      audio.queuePad(a.id, "bar", a.beat, a.on);
      renderPadStates();
      break;
    case "shot": {
      const key = a.at + ":" + a.id;
      if (localShots.has(key)) {
        localShots.delete(key);
        break;
      }
      audio.oneShot(a.id, Math.max(audio.ctx.currentTime + 3e-3, audio.ctx.currentTime + (a.at - audio.now()) / 1e3));
      break;
    }
    case "note": {
      const key = a.at + ":" + a.note + ":" + a.voice;
      if (localShots.has(key)) {
        localShots.delete(key);
        break;
      }
      audio.play({ voice: a.voice, note: a.note, duration: 0.45, velocity: 0.65 }, Math.max(audio.ctx.currentTime + 3e-3, audio.ctx.currentTime + (a.at - audio.now()) / 1e3));
      break;
    }
    case "step":
      session.pattern[a.voice][a.index] = a.on;
      renderSequencer();
      break;
    case "pattern":
      session.seqEnabled = a.enabled;
      session.swing = a.swing;
      renderTiming();
      break;
    case "setpad":
      audio.cancelPad(a.pad.id);
      audio.active.delete(a.pad.id);
      audio.pending.delete(a.pad.id);
      session.pads[a.pad.id] = structuredClone(a.pad);
      audio.setPadVolume(a.pad.id, a.pad.volume);
      renderPads();
      break;
  }
  changed();
}
async function playInstrument(note, voice = instrument) {
  await ready();
  audio.play({ voice, note, duration: voice === "bass" ? 0.45 : 0.65, velocity: 0.7 });
  if (recording?.kind === "notes" && audio.now() >= recording.start && audio.now() < recording.end) {
    const b = (audio.now() - recording.start) / 1e3 / beatDuration(session.bpm);
    recording.events.push({ beat: quantizeBeat(b) % (session.beats * session.bars), voice, note, duration: voice === "bass" ? 0.6 : 0.8, velocity: 0.7 });
  }
  if (jam.role) {
    const at = audio.now() + session.jamBuffer;
    localShots.add(at + ":" + note + ":" + voice);
    sendAction({ type: "note", voice, note, at });
  }
}
$$("[data-instrument]").forEach((b) => b.onclick = () => {
  instrument = b.dataset.instrument;
  $$("[data-instrument]").forEach((e) => e.classList.toggle("active", e === b));
  $("#keyboard").hidden = instrument === "drums";
  $("#drum-kit").hidden = instrument !== "drums";
});
bind("#oct-down", "click", () => {
  octave = clamp(octave - 1, 1, 7);
  renderKeyboard();
});
bind("#oct-up", "click", () => {
  octave = clamp(octave + 1, 1, 7);
  renderKeyboard();
});
bind("#scale", "change", renderKeyboard);
bind("#loop-mode", "click", () => {
  mode = "loop";
  $("#loop-mode").classList.add("active");
  $("#shot-mode").classList.remove("active");
  $("#loop-mode").setAttribute("aria-pressed", "true");
  $("#shot-mode").setAttribute("aria-pressed", "false");
});
bind("#shot-mode", "click", () => {
  mode = "shot";
  $("#shot-mode").classList.add("active");
  $("#loop-mode").classList.remove("active");
  $("#shot-mode").setAttribute("aria-pressed", "true");
  $("#loop-mode").setAttribute("aria-pressed", "false");
});
async function togglePlay() {
  await ready();
  if (jam.role === "follower") throw new Error("The room leader controls transport.");
  if (recording) await cancelRecording();
  sendAction(audio.running ? { type: "stop" } : { type: "start", epoch: audio.now() + 250 });
}
bind("#play-btn", "click", togglePlay);
bind("#stop-btn", "click", async () => {
  await cancelRecording();
  if (jam.role === "follower") {
    audio.stop();
    toast("Stopped on this phone. Resync to follow the leader again.");
  } else sendAction({ type: "stop" });
});
bind("#stop-loops", "click", () => {
  if (jam.role === "follower") throw new Error("The leader controls all loops. Tap a pad to stop that layer.");
  sendAction({ type: "stoploops" });
});
function changeTiming() {
  if (recording) throw new Error("Finish recording before changing timing.");
  sendAction({ type: "timing", bpm: clamp($("#bpm").value, 40, 240), beats: Number($("#beats").value), bars: Number($("#bars").value), epoch: audio.now() + 300 });
}
for (const id of ["#bpm", "#beats", "#bars"]) bind(id, "change", changeTiming);
let taps = [];
bind("#tap-btn", "click", () => {
  const now = performance.now();
  if (taps.length && now - taps.at(-1) > 2500) taps = [];
  taps.push(now);
  taps = taps.slice(-5);
  if (taps.length > 1) {
    $("#bpm").value = clamp(Math.round(6e4 / ((now - taps[0]) / (taps.length - 1))), 40, 240);
    changeTiming();
  }
});
bind("#metro-btn", "click", async () => {
  await ready();
  audio.metro = !audio.metro;
  $("#metro-btn").setAttribute("aria-pressed", String(audio.metro));
  if (audio.metro && !audio.running) {
    if (jam.role === "follower") toast("Click enabled. Waiting for the leader to play.");
    else sendAction({ type: "start", epoch: audio.now() + 250 });
  }
});
bind("#master-volume", "input", () => {
  session.master = Number($("#master-volume").value) / 100;
  if (audio.master) audio.master.gain.setTargetAtTime(session.master, audio.ctx.currentTime, 0.015);
  $("#volume-value").value = Math.round(session.master * 100) + "%";
  changed();
});
for (const [button, dialog] of [["#settings-btn", "#settings-dialog"], ["#project-btn", "#project-dialog"], ["#help-btn", "#help-dialog"], ["#jam-btn", "#jam-dialog"], ["#jam-tip", "#jam-dialog"]]) bind(button, "click", () => $(dialog).showModal());
for (const [id, key, min, max] of [["#input-latency", "inputLatency", 0, 500], ["#output-offset", "outputOffset", -500, 500], ["#jam-buffer", "jamBuffer", 40, 500]]) bind(id, "change", () => {
  session[key] = clamp($(id).value, min, max);
  $(id).value = session[key];
  changed();
});
bind("#seq-enabled", "change", async () => {
  await ready();
  sendAction({ type: "pattern", enabled: $("#seq-enabled").checked, swing: session.swing });
  if (session.seqEnabled && !audio.running && jam.role !== "follower") sendAction({ type: "start", epoch: audio.now() + 250 });
});
bind("#swing", "input", () => sendAction({ type: "pattern", enabled: session.seqEnabled, swing: Number($("#swing").value) }));
bind("#seq-clear", "click", () => {
  for (const [voice, steps] of Object.entries(session.pattern)) steps.forEach((on, index) => {
    if (on) sendAction({ type: "step", voice, index, on: false });
  });
});
bind("#drum-preset", "change", () => {
  const p = pattern($("#drum-preset").value, session.beats);
  for (const [voice, steps] of Object.entries(p)) steps.forEach((on, index) => sendAction({ type: "step", voice, index, on }));
});
bind("#seq-to-pad", "click", () => {
  const id = emptyPad(), events = [];
  for (const [voice, steps] of Object.entries(session.pattern)) steps.forEach((on, i) => {
    if (on) events.push({ voice, beat: i / 4, note: 60, duration: 0.15, velocity: 0.65 });
  });
  if (!events.length) throw new Error("Add some steps before saving a pattern.");
  sendAction({ type: "setpad", pad: { ...session.pads[id], kind: "loop", name: "My drum pattern", events, bars: 1 } });
  toast("Pattern saved to pad " + (id + 1));
});
bind("#pad-done", "click", () => {
  const p = { ...session.pads[selected], name: $("#pad-name").value.trim() || session.pads[selected].name, volume: Number($("#pad-level").value) / 100, bars: Number($("#pad-bars").value) };
  sendAction({ type: "setpad", pad: p });
  $("#pad-dialog").close();
});
bind("#pad-clear", "click", () => {
  sendAction({ type: "setpad", pad: { id: selected, name: "Add a sound", color: colors[selected % 4], events: [], audioId: null, volume: 0.75, bars: 2, kind: "empty" } });
  $("#pad-dialog").close();
});
let uploadTarget = null;
for (const id of ["#upload-btn", "#quick-upload"]) bind(id, "click", () => {
  uploadTarget = null;
  $("#audio-file").click();
});
bind("#pad-import", "click", () => {
  uploadTarget = selected;
  $("#audio-file").click();
  $("#pad-dialog").close();
});
async function addSample(name, blob, id = crypto.randomUUID()) {
  if (blob.size > 25 * 1024 * 1024) throw new Error("Use a sample under 25 MB to keep the studio snappy.");
  const buffer = await audio.decode(id, await blob.arrayBuffer());
  if (buffer.duration > 600) {
    audio.buffers.delete(id);
    throw new Error("Use an audio clip under 10 minutes.");
  }
  const sample = { id, name: name.slice(0, 80), blob, duration: buffer.duration };
  await saveSample(sample);
  for (const p of session.pads) if (p.audioId === id) audio.resumeAudioPad(p.id);
  samples = samples.filter((s) => s.id !== id);
  samples.push(sample);
  renderLibrary();
  return sample;
}
async function assignSample(s, id) {
  const length = s.duration / (beatDuration(session.bpm) * session.beats);
  const bars = [1, 2, 4, 8].reduce((a, b) => Math.abs(b - length) < Math.abs(a - length) ? b : a);
  if (jam.role) await shareSample(s);
  sendAction({ type: "setpad", pad: { ...session.pads[id], name: s.name.replace(/\.[^.]+$/, ""), kind: "audio", audioId: s.id, events: [], bars, volume: 0.75 } });
}
async function shareSample(s) {
  if (jam.role === "follower") await jam.sendAudio(s, jam.hostConnection());
  else if (jam.role === "leader") await jam.sendAudio(s);
}
bind("#audio-file", "change", async () => {
  await ready();
  const files = [...$("#audio-file").files];
  $("#audio-file").value = "";
  let count = 0;
  for (const file of files) {
    try {
      const id = uploadTarget ?? emptyPad();
      const s = await addSample(file.name, file);
      await assignSample(s, id);
      uploadTarget = null;
      count++;
    } catch (e) {
      toast(e.message, true);
      break;
    }
  }
  if (count) {
    renderPads();
    toast(`${count} ${count === 1 ? "sound" : "sounds"} added. Ready to play.`);
  }
});
async function beginRecording(kind, target = null) {
  await ready();
  if (recording) {
    await finishRecording();
    return;
  }
  const id = target ?? emptyPad();
  if (!audio.running) {
    if (jam.role === "follower") throw new Error("Ask the leader to start the transport first.");
    sendAction({ type: "start", epoch: audio.now() + 250 });
  }
  let mic = null;
  if (kind === "mic") mic = await audio.beginMic(0, 0);
  const startBeat = nextBoundary(audio.position(), session.beats) + session.beats;
  const start = audio.epoch + startBeat * beatDuration(session.bpm) * 1e3;
  const end = start + session.beats * session.bars * beatDuration(session.bpm) * 1e3;
  recording = { kind, id, startBeat, start, end, events: [], mic, countIn: true, bars: session.bars, beats: session.beats, startAudio: audio.ctx.currentTime + (start - audio.now()) / 1e3 };
  audio.capture = recording;
  $("#capture-btn").classList.add("recording");
  $("#mic-btn").classList.toggle("recording", kind === "mic");
  $("#capture-btn").innerHTML = '<span class="record-dot"></span> Cancel take';
  $("#mic-btn").innerHTML = '<span class="record-dot"></span> Cancel';
  toast("Count in… your loop starts on the next full bar.");
}
async function cancelRecording() {
  if (!recording) return;
  const r = recording;
  recording = null;
  audio.capture = null;
  if (r.mic) await r.mic.stop();
  resetRecordingUI();
  toast("Take cancelled.");
}
function resetRecordingUI() {
  $("#capture-btn").classList.remove("recording");
  $("#mic-btn").classList.remove("recording");
  $("#capture-btn").innerHTML = '<span class="record-dot"></span> Capture loop';
  $("#mic-btn").innerHTML = '<span class="record-dot"></span> Record';
  $("#capture-title").textContent = "Catch your next idea";
  $("#capture-hint").textContent = "One bar count-in, then record your loop.";
  $("#mic-status").textContent = "Record a sound, or drop in a track.";
}
async function finishRecording() {
  if (!recording || writing) return;
  writing = true;
  const r = recording;
  recording = null;
  audio.capture = null;
  try {
    let pad = { ...session.pads[r.id], name: r.kind === "mic" ? "Mic loop" : "My " + instrument, kind: r.kind === "mic" ? "audio" : "loop", events: r.events, audioId: null, bars: r.bars, volume: 0.75 };
    if (r.mic) {
      await r.mic.stop();
      const b = audio.micBuffer(r.mic, r.startAudio, r.startAudio + (r.end - r.start) / 1e3), wav = audio.bufferWav(b);
      const s = await addSample("Mic loop " + (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), new Blob([wav], { type: "audio/wav" }));
      pad.audioId = s.id;
      if (jam.role) await shareSample(s);
    } else if (!r.events.length) {
      toast("No notes in that take. Give it another go.");
      return;
    }
    sendAction({ type: "setpad", pad });
    if (audio.running) sendAction({ type: "pad", id: r.id, beat: nextBoundary(audio.position(), session.beats), on: true });
    toast("Loop captured. Layer something else.");
  } finally {
    writing = false;
    resetRecordingUI();
  }
}
bind("#capture-btn", "click", () => recording ? cancelRecording() : beginRecording("notes"));
bind("#mic-btn", "click", () => recording ? cancelRecording() : beginRecording("mic"));
bind("#pad-mic", "click", () => {
  $("#pad-dialog").close();
  return beginRecording("mic", selected);
});
audio.addEventListener("captureend", attempt(finishRecording));
audio.addEventListener("pads", renderPadStates);
audio.addEventListener("transport", () => {
  const b = $("#play-btn");
  b.classList.toggle("playing", audio.running);
  b.firstChild.textContent = audio.running ? "Ⅱ" : "▶";
  b.setAttribute("aria-label", audio.running ? "Stop transport" : "Start transport");
  $("#transport-status").textContent = audio.running ? "IN THE GROOVE" : "READY WHEN YOU ARE";
  renderPadStates();
  if (!audio.running) wakeLock?.release().catch(() => {
  });
});
async function requestWake() {
  if ($("#keep-awake").checked && navigator.wakeLock && document.visibilityState === "visible") {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch {
    }
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && audio.running) {
    requestWake();
    if (jam.role === "follower") jam.sync();
  }
});
bind("#project-name", "change", () => {
  session.name = $("#project-name").value.trim() || "Untitled session";
  renderTiming();
  changed();
});
bind("#project-export", "click", () => exportProject(session, samples));
bind("#project-import", "click", () => $("#project-file").click());
bind("#project-file", "change", async () => {
  if (jam.role) throw new Error("Leave the jam room before importing a project.");
  if (recording) throw new Error("Finish your recording first.");
  const file = $("#project-file").files[0];
  $("#project-file").value = "";
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) throw new Error("Project is too large (100 MB maximum).");
  const data = JSON.parse(await file.text()), valid = validateSession(data.session);
  if (!Array.isArray(data.audio) || data.audio.length > 128) throw new Error("Invalid project audio.");
  await ready();
  const imported = [];
  for (const s of data.audio) {
    if (typeof s.data !== "string" || s.data.length > 36 * 1024 * 1024 || typeof s.id !== "string" || typeof s.name !== "string") throw new Error("Invalid project sample.");
    const bytes = Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
    imported.push(await addSample(s.name, new Blob([bytes], { type: s.type || "audio/wav" }), s.id));
  }
  if (valid.pads.some((p) => p.audioId && !samples.some((s) => s.id === p.audioId))) throw new Error("Project is missing an audio sample.");
  audio.stop();
  session = valid;
  renderAll();
  changed();
  $("#project-dialog").close();
  toast("Project restored. Welcome back.");
});
bind("#project-new", "click", async () => {
  if (jam.role) throw new Error("Leave your jam room before starting a new session.");
  await cancelRecording();
  await exportProject(session, samples);
  audio.stop();
  session = defaultSession();
  renderAll();
  changed();
  $("#project-dialog").close();
  toast("Fresh session. Your previous project was downloaded.");
});
bind("#export-mix", "click", async () => {
  await ready();
  if (mixRecorder) {
    mixRecorder.stop();
    return;
  }
  if (!window.MediaRecorder) throw new Error("Mix recording is unavailable in this browser. Export your project instead.");
  const chunks = [];
  mixRecorder = new MediaRecorder(audio.destination.stream);
  mixRecorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  mixRecorder.onstop = () => {
    const type = mixRecorder.mimeType;
    download(new Blob(chunks, { type }), session.name + "-mix." + (type.includes("mp4") ? "m4a" : "webm"), type);
    mixRecorder = null;
    $("#export-mix").textContent = "◉ Record mix";
    toast("Mix downloaded.");
  };
  mixRecorder.start(1e3);
  $("#export-mix").textContent = "■ Finish mix";
  toast("Recording the mix. Tap Finish mix to download.");
});
document.addEventListener("keydown", attempt(async (e) => {
  if (e.target.matches("input,select,textarea") || $("dialog[open]")) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) await togglePlay();
    return;
  }
  if (e.key === "Escape") {
    await cancelRecording();
    audio.stop();
    return;
  }
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (view === "instruments") {
    const keys = { "a": 0, "w": 1, "s": 2, "e": 3, "d": 4, "f": 5, "t": 6, "g": 7, "y": 8, "h": 9, "u": 10, "j": 11, "k": 12 };
    if (key in keys) {
      if (instrument === "drums") await playInstrument(60, drums[keys[key] % drums.length]);
      else await playInstrument(octave * 12 + 12 + keys[key]);
    }
    return;
  }
  const id = padKeys.indexOf(key);
  if (id >= 0 && session.pads[id].kind !== "empty") await triggerPad(id);
}));
function tick() {
  if (audio.running) {
    const p = Math.max(0, audio.position());
    const beat = Math.floor(p) % session.beats;
    $("#position").innerHTML = `${Math.floor(p / session.beats) + 1} <span>. ${beat + 1} . ${Math.floor(p * 4) % 4 + 1}</span>`;
    $$("#beat-lights i").forEach((e, i) => e.classList.toggle("on", i === beat));
    for (const b of $$(".pad.is-playing")) {
      const a = audio.active.get(Number(b.dataset.id)), pad = session.pads[Number(b.dataset.id)];
      if (a) b.style.setProperty("--progress", (p - a.start) % (pad.bars * session.beats) / (pad.bars * session.beats) * 100 + "%");
    }
    if (view === "sequencer") $$(".seq-step").forEach((e) => e.classList.toggle("current", Number(e.dataset.step) === Math.floor(p * 4) % (session.beats * 4)));
  }
  if (recording) {
    const now = audio.now(), left = Math.max(0, (recording.end - now) / 1e3), count = Math.max(0, Math.ceil((recording.start - now) / 1e3 / beatDuration(session.bpm)));
    const status = now < recording.start ? "Count in · " + count : "Recording · " + left.toFixed(1) + "s left";
    $("#capture-title").textContent = status;
    $("#capture-hint").textContent = now < recording.start ? "Get ready. Your first beat is coming." : "Keep playing. We’ll close the loop for you.";
    $("#mic-status").textContent = status;
  }
  requestAnimationFrame(tick);
}
const audioImports = /* @__PURE__ */ new Map();
let incomingCommands = Promise.resolve();
function leaderCommand({ packet, remote, conn }) {
  if (!validateAction(packet.action, remote)) {
    if (conn) jam.send(conn, { type: "rejected" });
    return;
  }
  const perform = () => {
    applyAction(packet.action);
    if (jam.role === "leader") jam.accept(packet);
  };
  const pending = audioImports.get(packet.action.pad?.audioId);
  if (pending) pending.then(perform).catch((e) => toast(e.message, true));
  else perform();
}
jam.addEventListener("command", ({ detail }) => {
  try {
    leaderCommand(detail);
  } catch (e) {
    toast(e.message, true);
  }
});
jam.addEventListener("accepted", ({ detail }) => {
  incomingCommands = incomingCommands.then(async () => {
    if (!audio.ctx) await ready();
    const pending = audioImports.get(detail.action?.pad?.audioId);
    if (pending) await pending;
    if (["timing", "stop", "pack"].includes(detail.action?.type)) await cancelRecording();
    applyAction(detail.action);
  }).catch((e) => toast(e.message, true));
});
function snapshot() {
  return { type: "snapshot", session: structuredClone(session), running: audio.running, epoch: audio.epoch, active: [...audio.active], pending: [...audio.pending] };
}
jam.addEventListener("welcome", attempt(async ({ detail: { conn } }) => {
  jam.send(conn, snapshot());
  for (const s of samples.filter((s2) => session.pads.some((p) => p.audioId === s2.id))) await jam.sendAudio(s, conn);
}));
jam.addEventListener("snapshot", attempt(async ({ detail: s }) => {
  const valid = validateSession(s.session);
  await cancelRecording();
  await ready();
  const local = { master: session.master, inputLatency: session.inputLatency, outputOffset: session.outputOffset, jamBuffer: session.jamBuffer };
  session = { ...valid, ...local };
  audio.session = session;
  audio.stop();
  const entries = Array.isArray(s.active) ? s.active : [];
  audio.active = new Map(entries.filter((x) => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] < 16 && Number.isFinite(x[1]?.start)));
  if (s.running && Number.isFinite(s.epoch)) audio.start(s.epoch);
  if (Array.isArray(s.pending)) {
    for (const [id, p] of s.pending) if (Number.isInteger(id) && id >= 0 && id < 16 && Number.isFinite(p?.beat) && typeof p.on === "boolean") audio.pending.set(id, p);
  }
  renderAll();
  changed();
  toast("Joined the shared groove.");
}));
jam.addEventListener("clock", ({ detail }) => {
  audio.clockOffset = detail.offset;
  $("#jam-status").textContent = `Connected · ${Math.round(detail.rtt)} ms round trip · clock offset ${Math.round(detail.offset)} ms. Leader controls tempo and transport.`;
});
jam.addEventListener("audio", ({ detail: s }) => {
  const task = (async () => {
    const sample = await addSample(s.name, s.blob, s.id);
    if (jam.role === "leader") {
      for (const c of jam.connections.values()) if (c !== s.conn) await jam.sendAudio(sample, c);
    }
    renderPads();
  })();
  audioImports.set(s.id, task);
  task.catch((e) => toast(e.message, true)).finally(() => audioImports.delete(s.id));
});
jam.addEventListener("status", ({ detail }) => {
  $("#jam-status").textContent = detail.message;
  if (detail.error) toast(detail.message, true);
});
jam.addEventListener("peers", ({ detail }) => {
  const c = $("#jam-peers");
  c.replaceChildren();
  for (const p of detail) {
    const row = make("div", "peer-row");
    row.append(make("span", "", p.name), make("span", "", p.open ? "Connected" : "Reconnecting"));
    c.append(row);
  }
});
function roomLink() {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "jam=" + jam.room;
  return u.href;
}
jam.addEventListener("room", ({ detail }) => {
  $("#jam-room").hidden = false;
  $("#jam-role").textContent = detail.role === "leader" ? "ROOM LEADER" : "FOLLOWER";
  $("#room-label").textContent = detail.room;
  $("#host-btn").disabled = true;
  $("#join-btn").disabled = true;
  renderTiming();
  if (globalThis.QRCode) QRCode.toCanvas($("#qr-code"), roomLink(), { width: 180, margin: 2, color: { dark: "#14220f", light: "#f2f6ec" } }, (e) => {
    if (e) toast("QR unavailable. Copy the invite link.", true);
  });
});
bind("#host-btn", "click", async () => {
  await ready();
  await jam.create("leader");
});
function parseRoom(value) {
  let code = value.trim();
  if (code.includes("://")) {
    try {
      const u = new URL(code);
      code = new URLSearchParams(u.hash.slice(1)).get("jam") || u.searchParams.get("jam") || "";
    } catch {
      throw new Error("That invite link is invalid.");
    }
  }
  code = code.toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("Enter the six-character room code or an invite link.");
  return code;
}
bind("#join-btn", "click", async () => {
  const code = parseRoom($("#room-code").value);
  await ready();
  await jam.create("follower", code);
});
bind("#leave-btn", "click", async () => {
  await cancelRecording();
  jam.leave();
  audio.clockOffset = 0;
  audio.stop();
  $("#jam-room").hidden = true;
  $("#host-btn").disabled = false;
  $("#join-btn").disabled = false;
  renderTiming();
  toast("Left the room. Your sounds are saved.");
});
bind("#copy-invite", "click", async () => {
  try {
    await navigator.clipboard.writeText(roomLink());
    toast("Invite link copied.");
  } catch {
    const input = $("#room-code");
    input.value = roomLink();
    input.focus();
    input.select();
    toast("Select and copy the invite link from the room field.");
  }
});
bind("#sync-btn", "click", () => {
  if (jam.role === "follower") {
    jam.sync();
    jam.send(jam.hostConnection(), { type: "request-state" });
  } else {
    jam.broadcast(snapshot());
    toast("Session sent to your phones.");
  }
});
bind("#connection-save", "click", () => {
  jam.config = { host: $("#signal-host").value.trim(), port: clamp($("#signal-port").value, 1, 65535), path: $("#signal-path").value.trim() || "/", turn: $("#turn-url").value.trim(), user: $("#turn-user").value, password: $("#turn-pass").value };
  toast("Connection settings saved for this page session.");
});
let acoustic = null;
jam.addEventListener("calibrate", ({ detail }) => {
  if (jam.role === "leader") {
    const t = audio.ctx.currentTime + (detail.at - Date.now()) / 1e3;
    if (t > audio.ctx.currentTime) for (let i = 0; i < 3; i++) audio.chirp(t + i * 0.5);
  } else if (acoustic) acoustic.at = detail.at;
});
bind("#acoustic-btn", "click", async () => {
  if (jam.role !== "follower") throw new Error("Use Listen & align on a follower, near the leader’s speaker.");
  if (!jam.hostConnection()?.open) throw new Error("Reconnect to the leader before aligning.");
  if (recording) throw new Error("Finish your recording before aligning.");
  await ready();
  if (acoustic) throw new Error("Alignment is already listening.");
  toast("Listening for three tones from the leader. Keep this phone quiet.");
  const old = audio.master.gain.value;
  audio.master.gain.setValueAtTime(0, audio.ctx.currentTime);
  const hits = [];
  let last = -10;
  const at = audio.now() + 1800;
  acoustic = { at };
  let mic;
  try {
    mic = await audio.beginMic(0, 0, (chunk) => {
      const a = chunk.samples, rate = audio.ctx.sampleRate;
      let real = 0, imag = 0, energy = 0;
      for (let i = 0; i < a.length; i++) {
        const angle = 2 * Math.PI * 1800 * i / rate;
        real += a[i] * Math.cos(angle);
        imag += a[i] * Math.sin(angle);
        energy += a[i] * a[i];
      }
      const power = 2 * (real * real + imag * imag) / (a.length * a.length);
      if (power > 2e-5 && power > energy / a.length * 0.25 && chunk.time - last > 0.3) {
        const expected = audio.ctx.currentTime + (at - audio.now()) / 1e3;
        const delta = chunk.time - expected;
        if (delta > -0.2 && delta < 1.3) {
          hits.push(delta);
          last = chunk.time;
        }
      }
    });
    jam.send(jam.hostConnection(), { type: "calibrate", at });
    await new Promise((r) => setTimeout(r, 3700));
    await mic.stop();
    if (hits.length < 3) throw new Error("Could not hear all three tones. Move closer, raise the leader’s volume, and retry.");
    const offsets = hits.slice(0, 3).map((v, i) => (v - i * 0.5) * 1e3 - session.inputLatency - (audio.ctx.outputLatency || audio.ctx.baseLatency || 0) * 1e3);
    const spread = Math.max(...offsets) - Math.min(...offsets);
    if (spread > 65) throw new Error("Alignment was noisy. Try again in a quieter spot.");
    session.outputOffset = clamp(Math.round(offsets.sort((a, b) => a - b)[1]), -500, 500);
    renderTiming();
    changed();
    toast(`Speaker alignment set to ${session.outputOffset} ms. Fine-tune in audio settings.`);
  } finally {
    if (mic) mic.close();
    audio.master.gain.setValueAtTime(old, audio.ctx.currentTime);
    acoustic = null;
  }
});
async function boot() {
  try {
    const saved = await loadSession();
    if (saved) session = validateSession(saved);
    samples = await getSamples();
  } catch (e) {
    toast("Local storage is unavailable. Export your work before leaving.", true);
  }
  renderAll();
  tick();
  const hash = new URLSearchParams(location.hash.slice(1)).get("jam");
  if (hash) {
    try {
      $("#room-code").value = parseRoom(hash);
      $("#jam-dialog").showModal();
      toast("Tap Join to wake audio and enter the room.");
    } catch {
    }
  } else {
    try {
      const prev = JSON.parse(localStorage.getItem("mobipad-room"));
      if (prev?.room) {
        $("#room-code").value = prev.room;
        $("#jam-dialog").showModal();
        const b = make("button", "button subtle", "Rejoin previous room as " + prev.role);
        b.onclick = attempt(async () => {
          await ready();
          await jam.create(prev.role, parseRoom(prev.room));
          b.remove();
        });
        $(".jam-start").prepend(b);
      }
    } catch {
    }
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {
  });
}
boot();
