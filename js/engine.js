import { beatDuration, positionAt, nextBoundary, wavEncode } from "./timing.js";
import { drums } from "./presets.js";
class AudioEngine extends EventTarget {
  constructor(session) {
    super();
    this.session = session;
    this.active = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.buffers = /* @__PURE__ */ new Map();
    this.nodes = /* @__PURE__ */ new Set();
    this.running = false;
    this.epoch = 0;
    this.clockOffset = 0;
    this.nextStep = 0;
    this.metro = false;
    this.muted = /* @__PURE__ */ new Set();
    this.capture = null;
    this.timer = null;
    this.noise = null;
    this.readyPromise = null;
  }
  async init() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) throw new Error("Web Audio is unavailable in this browser.");
      this.ctx = new C({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.session.master;
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
      this.destination = this.ctx.createMediaStreamDestination();
      this.limiter.connect(this.destination);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const a = this.noise.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
      this.ctx.onstatechange = () => this.dispatchEvent(new Event("audiostate"));
    }
    await this.ctx.resume();
    return this.ctx;
  }
  now() {
    return Date.now() + this.clockOffset;
  }
  position() {
    return this.running ? positionAt(this.now(), this.epoch, this.session.bpm) : 0;
  }
  timeForBeat(beat) {
    return this.ctx.currentTime + (this.epoch + beat * beatDuration(this.session.bpm) * 1e3 - this.now() + this.session.outputOffset) / 1e3;
  }
  start(epoch = this.now() + 140) {
    if (!this.ctx) throw new Error("Audio is not initialized.");
    this.stop(false);
    this.epoch = epoch;
    this.running = true;
    this.nextStep = Math.max(0, Math.ceil(this.position() * 4));
    this.timer = setInterval(() => this.schedule(), 20);
    this.schedule();
    for (const id of this.active.keys()) this.resumeAudioPad(id);
    this.dispatchEvent(new Event("transport"));
  }
  stop(clear = true) {
    clearInterval(this.timer);
    this.running = false;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
      }
    }
    this.nodes.clear();
    this.pending.clear();
    if (clear) this.active.clear();
    this.dispatchEvent(new Event("transport"));
  }
  cancelPad(id, when = this.ctx?.currentTime) {
    for (const n of this.nodes) if (n.padId === id) {
      try {
        n.stop(when);
      } catch {
      }
    }
  }
  bus(id) {
    if (id === null || id === void 0) return this.master;
    this.padBuses ??= /* @__PURE__ */ new Map();
    if (!this.padBuses.has(id)) {
      const gain = this.ctx.createGain();
      gain.gain.value = this.session.pads[id].volume;
      gain.connect(this.master);
      this.padBuses.set(id, gain);
    }
    return this.padBuses.get(id);
  }
  setPadVolume(id, value) {
    const bus = this.padBuses?.get(id);
    if (bus) bus.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }
  resumeAudioPad(id) {
    const p = this.session.pads[id], active = this.active.get(id);
    if (!this.running || !active || !p?.audioId || !this.buffers.has(p.audioId) || [...this.nodes].some((n) => n.padId === id)) return;
    const pos = positionAt(this.now() + 30 - this.session.outputOffset, this.epoch, this.session.bpm);
    const relative = pos - active.start;
    if (relative < 0) this.launchAudio(id, Math.max(this.ctx.currentTime + 3e-3, this.timeForBeat(active.start)), active.start);
    else this.launchAudio(id, this.ctx.currentTime + 0.03, pos, relative % (p.bars * this.session.beats));
  }
  queuePad(id, grid = "bar", atBeat = null, desired = null) {
    const on = desired ?? !(this.pending.get(id)?.on ?? this.active.has(id));
    if (!this.running) this.start();
    const q = grid === "off" ? 0 : grid === "beat" ? 1 : this.session.beats;
    const beat = atBeat ?? (q ? nextBoundary(this.position(), q) : Math.max(0, this.position()));
    if (q === 0 && atBeat === null) {
      if (on) {
        this.active.set(id, { start: beat });
        this.launchAudio(id, this.ctx.currentTime + 5e-3, beat);
      } else {
        this.active.delete(id);
        this.cancelPad(id);
      }
      this.dispatchEvent(new Event("pads"));
    } else this.pending.set(id, { beat, on });
    return { id, beat, on };
  }
  schedule() {
    if (!this.running || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const pos = this.position();
    if (this.nextStep < pos * 4 - 2) this.nextStep = Math.max(0, Math.ceil(pos * 4));
    for (const [id, p] of this.pending) {
      const t = this.timeForBeat(p.beat);
      if (t < now + 0.09) {
        if (p.on) {
          this.active.set(id, { start: p.beat });
          this.launchAudio(id, Math.max(now + 2e-3, t), p.beat);
        } else {
          this.active.delete(id);
          this.cancelPad(id, Math.max(now + 1e-3, t));
        }
        this.pending.delete(id);
        this.dispatchEvent(new Event("pads"));
      }
    }
    let guard = 0;
    while (this.timeForBeat(this.nextStep / 4) < now + 0.09 && guard++ < 128) {
      const beat = this.nextStep / 4;
      let time = this.timeForBeat(beat);
      if (this.nextStep % 2) time += this.session.swing / 100 * beatDuration(this.session.bpm) * 0.25;
      if (time >= now - 0.015) {
        time = Math.max(now + 1e-3, time);
        this.scheduleStep(beat, time);
      }
      this.nextStep++;
    }
    if (this.capture && this.now() >= this.capture.end + 100 && !this.capture.finishing) {
      this.capture.finishing = true;
      this.dispatchEvent(new CustomEvent("captureend", { detail: this.capture }));
    }
  }
  scheduleStep(beat, time) {
    const spb = beatDuration(this.session.bpm);
    if (Number.isInteger(beat)) {
      const accent = beat % this.session.beats === 0;
      if (this.metro || this.capture && this.capture.countIn && this.now() < this.capture.start) this.click(time, accent);
    }
    if (this.session.seqEnabled) {
      const step = Math.round(beat * 4) % (this.session.beats * 4);
      for (const [voice, steps] of Object.entries(this.session.pattern)) if (steps[step]) this.play({ voice, note: 60, duration: 0.1, velocity: voice === "hat" ? 0.3 : 0.7 }, time);
    }
    for (const [id, a] of this.active) {
      const p = this.session.pads[id];
      if (!p || this.muted.has(id)) continue;
      const length = p.bars * this.session.beats;
      const relative = beat - a.start;
      if (relative < -1e-3) continue;
      if (p.audioId) {
        if (relative > 0.01 && Math.abs(relative / length - Math.round(relative / length)) < 1e-3) this.launchAudio(id, time, beat);
        continue;
      }
      const local = (relative % length + length) % length;
      for (const e of p.events) if (Math.abs(e.beat - local) < 0.01) this.play({ ...e, duration: e.duration * spb }, time, p.volume, id);
    }
  }
  launchAudio(id, time, startBeat, phaseBeats = 0) {
    const p = this.session.pads[id], buffer = this.buffers.get(p.audioId);
    if (!buffer || this.muted.has(id)) return;
    const total = p.bars * this.session.beats * beatDuration(this.session.bpm), length = total - phaseBeats * beatDuration(this.session.bpm);
    if (length < 0.012) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = buffer.duration / total;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1, time + 5e-3);
    gain.gain.setValueAtTime(1, time + Math.max(6e-3, length - 8e-3));
    gain.gain.linearRampToValueAtTime(0, time + length);
    source.connect(gain);
    gain.connect(this.bus(id));
    this.track(source, gain, id);
    source.start(time, buffer.duration * (phaseBeats / (p.bars * this.session.beats)));
    source.stop(time + length);
  }
  oneShot(id, when = null) {
    const p = this.session.pads[id];
    const t = when ?? this.ctx.currentTime + 3e-3;
    if (p.audioId) {
      const buffer = this.buffers.get(p.audioId);
      if (!buffer) return;
      const n = this.ctx.createBufferSource(), g = this.ctx.createGain();
      n.buffer = buffer;
      g.gain.value = 1;
      n.connect(g);
      g.connect(this.bus(id));
      this.track(n, g, id);
      n.start(t);
    } else for (const e of p.events) this.play({ ...e, duration: e.duration * beatDuration(this.session.bpm) }, t + e.beat * beatDuration(this.session.bpm), p.volume, id);
  }
  track(source, gain, id) {
    source.padId = id;
    this.nodes.add(source);
    source.onended = () => {
      source.disconnect();
      gain?.disconnect();
      this.nodes.delete(source);
    };
  }
  play(e, time = this.ctx.currentTime + 3e-3, level = 1, id = null) {
    const c = this.ctx, t = Math.max(time, c.currentTime), v = Math.max(1e-3, (e.velocity ?? 0.7) * (id === null ? level : 1)), voice = e.voice;
    const freq = 440 * 2 ** ((e.note - 69) / 12);
    const osc = (type, f2, decay, amp = v, slide = null) => {
      const n2 = c.createOscillator(), g2 = c.createGain();
      n2.type = type;
      n2.frequency.setValueAtTime(f2, t);
      if (slide) n2.frequency.exponentialRampToValueAtTime(slide, t + decay * 0.8);
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(amp * 0.4, t + 3e-3);
      g2.gain.exponentialRampToValueAtTime(1e-4, t + decay);
      n2.connect(g2);
      g2.connect(this.bus(id));
      this.track(n2, g2, id);
      n2.start(t);
      n2.stop(t + decay + 0.015);
      return n2;
    };
    const noise = (decay, cutoff, type = "highpass", amp = v) => {
      const n2 = c.createBufferSource(), f2 = c.createBiquadFilter(), g2 = c.createGain();
      n2.buffer = this.noise;
      f2.type = type;
      f2.frequency.value = cutoff;
      g2.gain.setValueAtTime(amp * 0.28, t);
      g2.gain.exponentialRampToValueAtTime(1e-4, t + decay);
      n2.connect(f2);
      f2.connect(g2);
      g2.connect(this.bus(id));
      this.track(n2, g2, id);
      n2.start(t);
      n2.stop(t + decay + 0.01);
      n2.addEventListener("ended", () => f2.disconnect());
    };
    if (voice === "kick") {
      osc("sine", 145, 0.35, v * 1.5, 42);
      return;
    }
    if (voice === "snare") {
      noise(0.16, 1400, "highpass", v);
      osc("triangle", 185, 0.12, v * 0.4);
      return;
    }
    if (voice === "hat" || voice === "openhat") {
      noise(voice === "hat" ? 0.055 : 0.3, 7200, "highpass", v * 0.7);
      return;
    }
    if (voice === "clap") {
      noise(0.12, 1700, "bandpass", v * 1.5);
      return;
    }
    if (voice === "tom") {
      osc("sine", 210, 0.3, v, 75);
      return;
    }
    if (voice === "rim") {
      osc("square", 840, 0.025, v * 0.6);
      osc("sine", 430, 0.04, v * 0.5);
      return;
    }
    if (voice === "triangle") {
      [1570, 2213, 3347, 5127].forEach((f2, i) => osc("sine", f2, 1.5 - i * 0.2, v / (i + 2)));
      return;
    }
    if (voice === "bell") {
      [1, 2.76, 5.4].forEach((h, i) => osc("sine", freq * h, Math.min(3, e.duration + 1) / (1 + i * 0.3), v / (i * 3 + 2)));
      return;
    }
    if (voice === "piano") {
      [1, 2, 3, 4].forEach((h, i) => osc("sine", freq * h, Math.max(0.1, e.duration) * (0.9 - i * 0.14) + 0.18, v / (1 + i * 3)));
      osc("triangle", freq, 0.07, v * 0.12);
      return;
    }
    if (voice === "bass") {
      osc("triangle", freq, e.duration + 0.08, v * 0.9);
      osc("sine", freq / 2, e.duration + 0.05, v * 0.6);
      return;
    }
    if (voice === "guitar") {
      [1, 2, 3, 4, 5, 6].forEach((h, i) => osc("sine", freq * h, Math.max(0.12, e.duration) / (1 + i * 0.35) + 0.15, v / (1 + i * 2)));
      return;
    }
    const n = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    n.type = "sawtooth";
    n.frequency.value = freq;
    f.type = "lowpass";
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(250, t + Math.max(0.1, e.duration));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.18, t + 8e-3);
    g.gain.exponentialRampToValueAtTime(1e-4, t + e.duration + 0.12);
    n.connect(f);
    f.connect(g);
    g.connect(this.bus(id));
    this.track(n, g, id);
    n.start(t);
    n.stop(t + e.duration + 0.15);
    n.addEventListener("ended", () => f.disconnect());
  }
  click(time, accent = false) {
    const n = this.ctx.createOscillator(), g = this.ctx.createGain();
    n.frequency.value = accent ? 1600 : 1050;
    g.gain.setValueAtTime(0.13, time);
    g.gain.exponentialRampToValueAtTime(1e-4, time + 0.035);
    n.connect(g);
    g.connect(this.master);
    this.track(n, g);
    n.start(time);
    n.stop(time + 0.04);
  }
  chirp(time) {
    const n = this.ctx.createOscillator(), g = this.ctx.createGain();
    n.frequency.value = 1800;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.22, time + 3e-3);
    g.gain.setValueAtTime(0.22, time + 0.025);
    g.gain.linearRampToValueAtTime(0, time + 0.035);
    n.connect(g);
    g.connect(this.ctx.destination);
    this.track(n, g);
    n.start(time);
    n.stop(time + 0.04);
  }
  async decode(id, array) {
    await this.init();
    const b = await this.ctx.decodeAudioData(array.slice(0));
    this.buffers.set(id, b);
    return b;
  }
  async openMic() {
    await this.init();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone needs HTTPS or localhost and a supported browser.");
    if (!this.ctx.audioWorklet) throw new Error("This browser needs AudioWorklet support to record.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    try {
      if (!this.readyPromise) this.readyPromise = this.ctx.audioWorklet.addModule(new URL("./capture-worklet.js", import.meta.url)).catch((e) => {
        this.readyPromise = null;
        throw e;
      });
      await this.readyPromise;
      const source = this.ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(this.ctx, "mobipad-capture");
      source.connect(node);
      node.connect(this.ctx.destination);
      return { stream, source, node, close() {
        node.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
      } };
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }
  async beginMic(start, end, onChunk = null) {
    const mic = await this.openMic();
    const chunks = [];
    let finish;
    const done = new Promise((resolve) => finish = resolve);
    mic.node.port.onmessage = ({ data }) => {
      if (data.type === "samples") {
        chunks.push(data);
        onChunk?.(data);
      }
      if (data.type === "stopped") finish();
    };
    mic.node.port.postMessage({ type: "start" });
    return { ...mic, chunks, start, end, stop: async () => {
      mic.node.port.postMessage({ type: "stop" });
      await done;
      mic.close();
    } };
  }
  micBuffer(recording, start, end) {
    const rate = this.ctx.sampleRate, length = Math.max(1, Math.round((end - start) * rate)), b = this.ctx.createBuffer(1, length, rate), out = b.getChannelData(0);
    for (const chunk of recording.chunks) {
      const offset = Math.round((chunk.time - start - this.session.inputLatency / 1e3) * rate);
      const from = Math.max(0, -offset), to = Math.min(chunk.samples.length, length - offset);
      if (to > from) out.set(chunk.samples.subarray(from, to), Math.max(0, offset));
    }
    const fade = Math.min(128, Math.floor(length / 2));
    for (let i = 0; i < fade; i++) {
      out[i] *= i / fade;
      out[length - 1 - i] *= i / fade;
    }
    return b;
  }
  bufferWav(buffer) {
    return wavEncode(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), buffer.sampleRate);
  }
}
export {
  AudioEngine
};
