import { soundBank, drumKits, arpRecipes, chordShapes, tunings, noteName } from "./sounds.js";
import { drums, drumNames } from "./presets.js";
const $ = (s) => document.querySelector(s);
const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== void 0) e.textContent = text;
  return e;
};
const scales = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9] };
class InstrumentRack {
  constructor(options) {
    Object.assign(this, options);
    this.voice = "piano";
    this.octave = 4;
    this.pointers = /* @__PURE__ */ new Map();
    this.keyNotes = /* @__PURE__ */ new Map();
    this.slideNotes = /* @__PURE__ */ new Map();
    this.bind();
  }
  safely(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        this.notify(e.message, true);
      }
    };
  }
  bind() {
    document.querySelectorAll("[data-instrument]").forEach((b) => b.onclick = () => this.select(b.dataset.instrument));
    $("#oct-down").onclick = () => {
      this.octave = Math.max(1, this.octave - 1);
      this.renderKeyboard();
    };
    $("#oct-up").onclick = () => {
      this.octave = Math.min(7, this.octave + 1);
      this.renderKeyboard();
    };
    $("#scale").onchange = () => this.renderKeyboard();
    $("#fret-position").onchange = () => this.renderStrings();
    $("#sound-preset").onchange = () => this.changeSound(this.voice, $("#sound-preset").value);
    $("#kit-preset").onchange = () => this.changeKit($("#kit-preset").value);
    $("#audition-sound").onclick = this.safely(async () => {
      await this.ready();
      if (this.voice === "drums") {
        for (const [i, v] of ["kick", "hat", "snare", "hat"].entries()) this.perform(this.event(60, v), this.audio.ctx.currentTime + 0.01 + i * 0.22);
      } else {
        const base = this.voice === "bass" ? 40 : 60;
        for (const [i, offset] of [0, 4, 7, 12].entries()) this.perform(this.event(base + offset), this.audio.ctx.currentTime + 0.01 + i * 0.15);
      }
    });
    $("#open-strum").onclick = this.safely(() => this.strum([...tunings[this.voice]].reverse()));
    $("#arp-enabled").onchange = this.safely(async () => {
      await this.ready();
      this.state().arp.enabled = $("#arp-enabled").checked;
      this.audio.arp.clear();
      this.changed();
      this.renderControls();
    });
    $("#arp-latch").onchange = () => {
      this.state().arp.latch = $("#arp-latch").checked;
      this.audio.arp.clear();
      this.changed();
      this.renderArpStatus();
    };
    for (const id of ["direction", "rate", "octaves", "gate"]) $("#arp-" + id).oninput = () => {
      const config = this.state().arp;
      config[id] = id === "direction" ? $("#arp-" + id).value : Number($("#arp-" + id).value) / (id === "gate" ? 100 : 1);
      this.audio.arp.nextBeat = null;
      $("#arp-recipe").value = "custom";
      this.changed();
    };
    $("#arp-recipe").replaceChildren(...arpRecipes.map((p) => new Option(p.name, p.id)));
    $("#arp-recipe").onchange = () => {
      const p = arpRecipes.find((p2) => p2.id === $("#arp-recipe").value);
      if (p && p.id !== "custom") {
        Object.assign(this.state().arp, { direction: p.direction, rate: p.rate, octaves: p.octaves, gate: p.gate });
        this.audio.arp.nextBeat = null;
        this.changed();
        this.renderControls();
      }
    };
    $("#arp-clear").onclick = () => {
      this.releaseAll();
      this.renderArpStatus();
    };
    window.addEventListener("blur", () => this.releaseAll());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });
    this.audio.addEventListener("transport", () => {
      if (!this.audio.running) {
        this.pointers.clear();
        this.keyNotes.clear();
        this.renderArpStatus();
      }
    });
    this.audio.addEventListener("arpnote", ({ detail }) => {
      this.perform(detail.event, detail.time, true);
      this.renderArpStatus(detail.event.note);
    });
  }
  state() {
    return this.getSession().rack;
  }
  event(note, voice = this.voice) {
    return { voice, note, sound: this.state().sounds[voice], tone: { ...this.state().tone }, duration: voice === "bass" ? 0.55 : voice === "guitar" ? 1.1 : 0.65, velocity: 0.7 };
  }
  select(voice) {
    this.releaseAll();
    this.voice = voice;
    this.onVoice(voice);
    this.render();
  }
  render() {
    document.querySelectorAll("[data-instrument]").forEach((b) => {
      b.classList.toggle("active", b.dataset.instrument === this.voice);
      b.setAttribute("aria-pressed", String(b.dataset.instrument === this.voice));
    });
    const strings = ["bass", "guitar"].includes(this.voice);
    $("#keyboard").hidden = strings || this.voice === "drums";
    $(".keyboard-toolbar").hidden = strings || this.voice === "drums";
    $("#drum-kit").hidden = this.voice !== "drums";
    $("#strings-panel").hidden = !strings;
    $("#arp-panel").hidden = this.voice === "drums";
    this.renderControls();
    this.renderKeyboard();
    this.renderDrums();
    if (strings) this.renderStrings();
  }
  renderControls() {
    const s = this.state(), isDrums = this.voice === "drums";
    $("#sound-label").hidden = isDrums;
    $("#kit-label").hidden = !isDrums;
    $("#sound-preset").replaceChildren(...(soundBank[this.voice] || []).map((p) => new Option(p.name, p.id)));
    $("#sound-preset").value = s.sounds[this.voice] || "";
    $("#kit-preset").replaceChildren(...drumKits.map((p) => new Option(p.name, p.id)));
    $("#kit-preset").value = s.kit;
    $("#sound-description").textContent = isDrums ? "Choose a kit, then customize each drum." : soundBank[this.voice].find((p) => p.id === s.sounds[this.voice])?.description || "";
    const controls = $("#tone-controls");
    controls.replaceChildren();
    const items = this.voice === "synth" ? [["cutoff", "Cutoff", 150, 12e3, 50, "Hz"], ["resonance", "Resonance", 0.1, 10, 0.1, ""], ["attack", "Attack", 2e-3, 0.5, 2e-3, "s"], ["release", "Release", 0.05, 2, 0.05, "s"], ["detune", "Detune", 0, 30, 1, "¢"]] : isDrums ? [] : [["brightness", "Tone", 0, 1, 0.01, "%"], ["decay", "Sustain", 0.1, 1, 0.01, "%"], ["drive", "Drive", 0, 1, 0.01, "%"]];
    for (const [key, label, min, max, step, unit] of items) {
      const wrapper = node("label", "tone-control"), caption = node("span", "", label), output = node("output"), range = node("input");
      range.type = "range";
      range.min = min;
      range.max = max;
      range.step = step;
      range.value = s.tone[key];
      range.setAttribute("aria-label", label);
      const display = () => {
        output.value = unit === "%" ? Math.round(range.value * 100) + "%" : Number(range.value).toFixed(unit === "s" ? 2 : key === "resonance" ? 1 : 0) + (unit ? " " + unit : "");
      };
      display();
      range.oninput = () => {
        s.tone[key] = Number(range.value);
        this.audio.arp.tone = { ...s.tone };
        display();
        this.changed();
      };
      caption.append(output);
      wrapper.append(caption, range);
      controls.append(wrapper);
    }
    const arp = s.arp;
    $("#arp-enabled").checked = arp.enabled;
    $("#arp-latch").checked = arp.latch;
    $("#arp-direction").value = arp.direction;
    $("#arp-rate").value = String(arp.rate);
    $("#arp-octaves").value = String(arp.octaves);
    $("#arp-gate").value = arp.gate * 100;
    $("#arp-panel").classList.toggle("enabled", arp.enabled);
    this.audio.arp.voice = this.voice;
    this.audio.arp.sound = s.sounds[this.voice];
    this.audio.arp.tone = { ...s.tone };
    this.renderArpStatus();
  }
  async press(note, key, voice = this.voice) {
    this.pendingNotes ??= /* @__PURE__ */ new Map();
    const token = {};
    this.pendingNotes.set(key, token);
    await this.ready();
    const event = this.event(note, voice);
    if (this.state().arp.enabled && voice !== "drums" && !drums.includes(voice)) {
      if (this.pendingNotes.get(key) !== token && !this.state().arp.latch) return;
      if (!this.audio.running) await this.startTransport();
      if (this.pendingNotes.get(key) !== token && !this.state().arp.latch) return;
      this.audio.arp.voice = voice;
      this.audio.arp.sound = event.sound;
      this.audio.arp.tone = event.tone;
      this.audio.arp.press(note, key, this.state().arp.latch);
      if (this.pendingNotes.get(key) !== token) this.audio.arp.release(key);
      else this.pointers.set(key, note);
      this.renderArpStatus();
    } else this.perform(event);
  }
  release(key) {
    this.pendingNotes?.delete(key);
    this.audio.arp.release(key);
    this.pointers.delete(key);
    this.renderArpStatus();
  }
  releaseAll() {
    this.pendingNotes?.clear();
    this.audio.arp.clear();
    this.pointers.clear();
    this.keyNotes.clear();
    this.slideNotes.clear();
    document.querySelectorAll(".pressed").forEach((e) => e.classList.remove("pressed"));
    this.renderArpStatus();
  }
  renderArpStatus(note = null) {
    const notes = this.audio.arp.notes(this.state().arp);
    $("#arp-notes").textContent = notes.length ? (note !== null ? "Playing " + noteName(note) + " · " : "") + [...new Set(notes)].map(noteName).join(" · ") : "Waiting for a few notes.";
  }
  bindPlayable(button, note, voice = this.voice) {
    let released = false;
    button.onpointerdown = this.safely(async (e) => {
      e.preventDefault();
      released = false;
      button.setPointerCapture(e.pointerId);
      const key = "pointer:" + e.pointerId;
      await this.press(note, key, voice);
      if (released) this.release(key);
      else button.classList.add("pressed");
    });
    const up = (e) => {
      released = true;
      this.release("pointer:" + e.pointerId);
      button.classList.remove("pressed");
    };
    button.onpointerup = up;
    button.onpointercancel = up;
    button.onlostpointercapture = up;
    button.onkeydown = this.safely(async (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        await this.press(note, "button:" + note, voice);
      }
    });
    button.onkeyup = (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.stopPropagation();
        this.release("button:" + note);
      }
    };
  }
  renderKeyboard() {
    const keyboard = $("#keyboard");
    keyboard.replaceChildren();
    const whites = [0, 2, 4, 5, 7, 9, 11, 12], blacks = [{ n: 1, x: 1 }, { n: 3, x: 2 }, { n: 6, x: 4 }, { n: 8, x: 5 }, { n: 10, x: 6 }], scale = scales[$("#scale").value];
    const add = (n, black, x) => {
      const midi = this.octave * 12 + 12 + n, b = node("button", "piano-key" + (black ? " black" : "") + (scale && !scale.includes(n % 12) ? " out-scale" : ""), noteName(midi));
      b.dataset.note = midi;
      b.setAttribute("aria-label", noteName(midi) + " piano key");
      if (black) b.style.left = x / 8 * 100 + "%";
      this.bindPlayable(b, midi);
      if (scale && !scale.includes(n % 12)) b.disabled = true;
      keyboard.append(b);
    };
    whites.forEach((n) => add(n, false));
    blacks.forEach(({ n, x }) => add(n, true, x));
    $("#octave").textContent = this.octave;
  }
  renderDrums() {
    const grid = $("#drum-kit");
    grid.replaceChildren();
    for (const voice of drums) {
      const card = node("div", "drum-card"), b = node("button", "drum-hit", drumNames[voice]), select = node("select");
      b.dataset.drum = voice;
      this.bindPlayable(b, 60, voice);
      select.setAttribute("aria-label", drumNames[voice] + " sound");
      select.replaceChildren(...soundBank[voice].map((p) => new Option(p.name, p.id)));
      select.value = this.state().sounds[voice];
      select.onchange = () => this.changeSound(voice, select.value);
      card.append(b, select);
      grid.append(card);
    }
  }
  renderStrings() {
    const tuning = tunings[this.voice], start = Number($("#fret-position").value), frets = Array.from({ length: 5 }, (_, i) => start + i + 1), numbers = $("#fret-numbers"), board = $("#fretboard");
    numbers.replaceChildren(node("span", "", "OPEN"), ...frets.map((f) => node("span", "", String(f))));
    board.replaceChildren();
    board.classList.toggle("bass-neck", this.voice === "bass");
    $("#string-instrument-name").textContent = this.voice === "bass" ? "4-STRING ELECTRIC BASS" : "6-STRING GUITAR";
    tuning.forEach((open, string) => {
      const row = node("div", "string-row");
      row.style.setProperty("--gauge", 1 + string * 0.45 + "px");
      for (const fret of [0, ...frets]) {
        const midi = open + fret, b = node("button", "fret" + (fret === 0 ? " open-string" : "") + ([3, 5, 7, 9, 12, 15].includes(fret) ? " inlay" : ""));
        b.append(node("span", "fret-note", noteName(midi)));
        b.dataset.string = string;
        b.dataset.fret = fret;
        b.setAttribute("aria-label", `${this.voice} string ${string + 1}, fret ${fret}, ${noteName(midi)}`);
        this.bindPlayable(b, midi);
        b.onpointermove = this.safely(async (e) => {
          if (!(e.buttons & 1) || e.pointerType === "mouse" && e.buttons !== 1) return;
          const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".fret");
          if (!target || target.dataset.string !== b.dataset.string || target === b) return;
          const key = "pointer:" + e.pointerId, moved = tuning[string] + Number(target.dataset.fret);
          if (this.slideNotes.get(key) === moved) return;
          this.slideNotes.set(key, moved);
          this.release(key);
          await this.press(moved, key);
          row.querySelectorAll(".pressed").forEach((e2) => e2.classList.remove("pressed"));
          target.classList.add("pressed");
        });
        row.append(b);
      }
      board.append(row);
    });
    const chords = $("#chord-pads");
    chords.replaceChildren();
    for (const chord of chordShapes) {
      const b = node("button", "chord-pad"), name = node("strong", "", chord.name), shape = node("span", "", this.voice === "guitar" ? chord.guitar.slice().reverse().map((f) => f < 0 ? "×" : f).join(" ") : "Root · fifth · octave");
      b.append(name, shape);
      const notes = this.voice === "guitar" ? chord.guitar.flatMap((f, i) => f < 0 ? [] : [tuning[i] + f]).reverse() : [chord.notes[0] - 12, chord.notes[0] - 5, chord.notes[0]];
      let keys = [];
      b.onpointerdown = this.safely(async (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add("pressed");
        if (this.state().arp.enabled) {
          keys = notes.map((n, i) => "chord:" + e.pointerId + ":" + i);
          await Promise.all(notes.map((n, i) => this.press(n, keys[i])));
        } else await this.strum(notes);
      });
      const release = () => {
        keys.forEach((k) => this.release(k));
        keys = [];
        b.classList.remove("pressed");
      };
      b.onpointerup = release;
      b.onpointercancel = release;
      b.onlostpointercapture = release;
      b.onkeydown = this.safely(async (e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          if (this.state().arp.enabled) {
            keys = notes.map((n, i) => "chord-key:" + chord.name + i);
            await Promise.all(notes.map((n, i) => this.press(n, keys[i])));
          } else await this.strum(notes);
        }
      });
      b.onkeyup = release;
      chords.append(b);
    }
  }
  async strum(notes) {
    await this.ready();
    const order = $("#strum-direction").value === "up" ? [...notes].reverse() : notes, spread = Number($("#strum-spread").value) / 1e3;
    for (const [i, note] of order.entries()) this.perform({ ...this.event(note), velocity: 0.6 + i * 0.025 }, this.audio.ctx.currentTime + 5e-3 + i * spread);
  }
  async keyDown(e) {
    const keys = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12 }, offset = keys[e.key.toLowerCase()];
    if (offset === void 0) return;
    const scale = scales[$("#scale").value];
    if (this.voice !== "drums" && scale && !scale.includes(offset % 12)) return;
    const note = this.voice === "bass" ? 40 + offset : this.octave * 12 + 12 + offset;
    this.keyNotes.set(e.code, note);
    await this.press(note, "key:" + e.code, this.voice === "drums" ? drums[offset % drums.length] : this.voice);
  }
  keyUp(e) {
    if (this.keyNotes.has(e.code)) {
      this.release("key:" + e.code);
      this.keyNotes.delete(e.code);
    }
  }
}
export {
  InstrumentRack
};
