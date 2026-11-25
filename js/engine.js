import { beatDuration, positionAt, nextBoundary, wavEncode } from "./timing.js";
import { drums } from "./presets.js";
import { getSound, defaultRack } from "./sounds.js";
import { pluckedString } from "./string-model.js";
import { Arpeggiator } from "./arpeggiator.js";
import { requestDSP } from "./dsp-client.js";
import {AudioCache} from './audio-cache.js';
import {resourceProfiles} from './device.js';
import {createReverb} from './effects.js';
class AudioEngine extends EventTarget {
  constructor(session) {
    super();
    this.session = session;
    this.active = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.buffers = new AudioCache(resourceProfiles.full.rawBytes,key=>this.isSamplePinned(key));
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
    this.arp = new Arpeggiator();
    this.stringBuffers = new AudioCache(resourceProfiles.full.stringBytes);
    this.processedBuffers = new AudioCache(resourceProfiles.full.processedBytes,key=>this.isSamplePinned(String(key).split(':')[0]));
    this.padEffects = /* @__PURE__ */ new Map();
    this.stretchedBuffers = new AudioCache(resourceProfiles.full.stretchBytes,key=>this.isSamplePinned(String(key).split(':')[0]));
    this.stretchTasks = /* @__PURE__ */ new Map();
    this.sampleVersions = new Map();
    this.resourceMode='full';this.maxSources=resourceProfiles.full.maxSources;
  }
  isSamplePinned(id){if(this.editingSample===id)return true;return this.session.pads.some(p=>p.audioId===id&&(this.active.has(p.id)||this.pending.get(p.id)?.on||this.running&&this.session.seqEnabled&&p.sequenceEnabled||[...this.nodes].some(n=>n.padId===p.id)));}
  setResourceMode(mode){this.resourceMode=mode==='eco'?'eco':'full';const profile=resourceProfiles[this.resourceMode];this.maxSources=profile.maxSources;this.buffers.setBudget?.(profile.rawBytes);this.stringBuffers.setBudget?.(profile.stringBytes);this.processedBuffers.setBudget?.(profile.processedBytes);this.stretchedBuffers.setBudget?.(profile.stretchBytes);}
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
      this.ctx.onstatechange = () => this.handleAudioState();
    }
    await this.ctx.resume();
    return this.ctx;
  }
  now() {
    return Date.now() + this.clockOffset;
  }
  handleAudioState() {
    if(this.ctx.state!=='running')this.interrupted=this.running;
    else if(this.interrupted&&this.running){
      this.interrupted=false;
      // AudioContext time can freeze while the shared musical clock keeps moving.
      // Discard old scheduled sources and resume loops at the current shared phase.
      for(const source of this.nodes){try{source.stop();}catch{}}
      this.nodes.clear();
      this.nextStep=Math.max(0,Math.ceil(this.position()*4));this.arp.nextBeat=null;
      for(const id of this.active.keys())this.resumeAudioPad(id);
      this.schedule();
    }
    this.dispatchEvent(new Event('audiostate'));
  }
  position() {
    return this.running ? positionAt(this.now(), this.epoch, this.session.bpm) : 0;
  }
  timeForBeat(beat) {
    return this.ctx.currentTime + (this.epoch + beat * beatDuration(this.session.bpm) * 1e3 - this.now() + this.session.outputOffset) / 1e3;
  }
  start(epoch = this.now() + 140) {
    if (!this.ctx) throw new Error("Audio is not initialized.");
    this.stop(false, false);
    this.epoch = epoch;
    this.running = true;
    this.interrupted=this.ctx.state!=='running';
    this.nextStep = Math.max(0, Math.ceil(this.position() * 4));
    this.arp.nextBeat = null;
    this.arp.index = 0;
    this.timer = setInterval(() => this.schedule(), 20);
    this.schedule();
    if(!this.interrupted)for (const id of this.active.keys()) this.resumeAudioPad(id);
    this.dispatchEvent(new Event("transport"));
  }
  stop(clear = true, notify = true) {
    this.previewCleanup?.();
    clearInterval(this.timer);
    this.running = false;
    this.interrupted=false;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
      }
    }
    this.nodes.clear();
    this.pending.clear();
    // Recreate delay lines so Stop also clears audio still circulating in feedback.
    for(const fx of this.padEffects.values()){fx.delay.disconnect();fx.wet.disconnect();fx.feedback.disconnect();fx.reverb?.dispose();}
    for(const bus of this.padBuses?.values()||[])bus.disconnect();
    this.padEffects.clear();this.padBuses?.clear();
    if (clear) {
      this.active.clear();
      this.arp.clear();
      for(const cache of [this.buffers,this.stringBuffers,this.processedBuffers,this.stretchedBuffers])cache.trim?.();
    }
    if(notify)this.dispatchEvent(new CustomEvent('transport',{detail:{cleared:clear}}));
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
    if (typeof id!=='number') return this.master;
    this.padBuses ??= /* @__PURE__ */ new Map();
    if (!this.padBuses.has(id)) {
      const gain = this.ctx.createGain();
      gain.gain.value = this.session.pads[id].volume;
      gain.connect(this.master);
      this.padBuses.set(id, gain);
      const delay = this.ctx.createDelay(1.1), wet = this.ctx.createGain(), feedback = this.ctx.createGain();
      gain.connect(delay);
      delay.connect(wet);
      wet.connect(this.master);
      delay.connect(feedback);
      feedback.connect(delay);
      this.padEffects.set(id, { delay, wet, feedback });
      this.setPadEffects(id);
    }
    return this.padBuses.get(id);
  }
  setPadVolume(id, value) {
    const bus = this.padBuses?.get(id);
    if (bus) bus.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }
  setPadEffects(id) {
    const fx = this.padEffects.get(id), p = this.session.pads[id];
    if (!fx || !p) return;
    fx.delay.delayTime.setTargetAtTime(p.echoTime || 0.25, this.ctx.currentTime, 0.02);
    fx.wet.gain.setTargetAtTime(p.echo || 0, this.ctx.currentTime, 0.015);
    fx.feedback.gain.setTargetAtTime((p.echo || 0) * 0.55, this.ctx.currentTime, 0.015);
    if(p.reverb>0){
      const space=p.reverbSpace||'room';
      if(fx.reverb?.space!==space){fx.reverb?.dispose();fx.reverb=createReverb(this.ctx,this.padBuses.get(id),this.master,p.reverb,space);}
      else fx.reverb.wet.gain.setTargetAtTime(p.reverb*.65,this.ctx.currentTime,.015);
    }else{fx.reverb?.dispose();fx.reverb=null;}
  }
  sampleBuffer(id) {
    const p = this.session.pads[id], original = this.buffers.get(p.audioId);
    if (!original) return null;
    const start = Math.min(original.duration - 1e-3, p.trimStart || 0), end = Math.min(original.duration, p.trimEnd || original.duration), a = p.alignment;
    const shift = (a?.enabled ? a.shift : 0) - (a?.manual || 0);
    if (start === 0 && end === original.duration && !shift) return original;
    const key = [p.audioId, start, end, shift].join(":");
    if (this.processedBuffers.has(key)) return this.processedBuffers.get(key);
    const from = Math.round(start * original.sampleRate), length = Math.max(1, Math.round((end - start) * original.sampleRate)), buffer = this.ctx.createBuffer(original.numberOfChannels, length, original.sampleRate), rotation = Math.round(shift / 1e3 * original.sampleRate);
    for (let ch = 0; ch < original.numberOfChannels; ch++) {
      const input = original.getChannelData(ch), output = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const offset = ((i + rotation) % length + length) % length;
        output[i] = input[from + offset] || 0;
      }
    }
    this.processedBuffers.set(key, buffer);
    return buffer;
  }
  stretchKey(id, bpm = this.session.bpm, beats = this.session.beats) {
    const p = this.session.pads[id], buffer = this.sampleBuffer(id);
    if (!buffer) return null;
    return [p.audioId, p.trimStart || 0, p.trimEnd || 0, p.alignment?.enabled ? p.alignment.shift : 0, p.alignment?.manual || 0, bpm, beats, p.bars,this.sampleVersions.get(p.audioId)||0].join(":");
  }
  async preparePad(id, bpm = this.session.bpm, beats = this.session.beats) {
    const original = this.sampleBuffer(id);
    if (!original) return null;
    const p = this.session.pads[id], targetLength = Math.round(p.bars * beats * 60 / bpm * original.sampleRate);
    if (targetLength > original.sampleRate * 600) throw new Error("Loop exceeds ten minutes at this tempo. Choose fewer bars.");
    if (Math.abs(targetLength - original.length) < 3) return original;
    const key = this.stretchKey(id, bpm, beats);
    if (this.stretchedBuffers.has(key)) return this.stretchedBuffers.get(key);
    if (this.stretchTasks.has(key)) return this.stretchTasks.get(key);
    const task = (async () => {
      const channels = Array.from({ length: Math.min(2, original.numberOfChannels) }, (_, i) => original.getChannelData(i).slice());
      const rendered = await requestDSP("stretch", { channels, sampleRate: original.sampleRate, targetLength });
      const buffer = this.ctx.createBuffer(rendered.length, targetLength, original.sampleRate);
      rendered.forEach((c, i) => buffer.copyToChannel(c, i));
      this.stretchedBuffers.set(key, buffer);
      return buffer;
    })();
    this.stretchTasks.set(key, task);
    try {
      return await task;
    } finally {
      this.stretchTasks.delete(key);
    }
  }
  async prepareTempo(bpm, beats = this.session.beats) {
    for (const p of this.session.pads) if (p.audioId && this.buffers.has(p.audioId) && (this.active.has(p.id) || this.pending.get(p.id)?.on)) await this.preparePad(p.id, bpm, beats);
  }
  resumeAudioPad(id) {
    const p = this.session.pads[id], active = this.active.get(id);
    if (!this.running || !active || !p?.audioId || !this.buffers.has(p.audioId) || [...this.nodes].some((n) => n.padId === id)) return;
    const pos = positionAt(this.now() + 30 - this.session.outputOffset - (p.preDelay || 0), this.epoch, this.session.bpm);
    const relative = pos - active.start;
    if (relative < 0) this.launchAudio(id, Math.max(this.ctx.currentTime + 3e-3, this.timeForBeat(active.start)), active.start);
    else this.launchAudio(id, this.ctx.currentTime + 0.03 - (p.preDelay || 0) / 1e3, pos, relative % (p.bars * this.session.beats));
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
    const arpConfig = this.session.rack?.arp;
    if (arpConfig) this.arp.schedule(pos, pos + 0.09 / beatDuration(this.session.bpm), arpConfig, (e) => {
      const time = Math.max(now + 3e-3, this.timeForBeat(e.beat));
      this.play({ ...e, duration: e.duration * beatDuration(this.session.bpm) }, time);
      this.dispatchEvent(new CustomEvent("arpnote", { detail: { event: e, time } }));
    });
    if (this.nextStep < pos * 4 - 2) this.nextStep = Math.max(0, Math.ceil(pos * 4));
    for (const [id, p] of this.pending) {
      const t = this.timeForBeat(p.beat);
      if (t < now + 0.09) {
        if (p.on) {
          this.active.set(id, { start: p.beat });
          if (t < now - 5e-3) this.resumeAudioPad(id);
          else this.launchAudio(id, Math.max(now + 2e-3, t), p.beat);
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
    if (this.capture && this.now() >= this.capture.end + (this.capture.mic ? Math.max(25, this.session.inputLatency + 10) : 10) && !this.capture.finishing) {
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
      for (const p of this.session.pads) if (p.audioId && p.sequenceEnabled && p.steps?.[step] && !this.muted.has(p.id)) {
        this.cancelPad(p.id, time);
        this.oneShot(p.id, time);
      }
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
      for (const e of p.events) {
        const delta = e.beat - local;
        if (delta >= -1e-3 && delta < 0.25 - 1e-3) this.play({ ...e, duration: e.duration * spb }, time + Math.max(0, delta) * spb, p.volume, id);
      }
    }
  }
  launchAudio(id, time, startBeat, phaseBeats = 0) {
    const p = this.session.pads[id], original = this.sampleBuffer(id);
    if (!original) return;
    const targetLength = Math.round(p.bars * this.session.beats * beatDuration(this.session.bpm) * original.sampleRate), key = this.stretchKey(id);
    const buffer = Math.abs(targetLength - original.length) < 3 ? original : this.stretchedBuffers.get(key);
    if (!buffer) {
      this.preparePad(id).then(() => this.resumeAudioPad(id)).catch((error) => this.dispatchEvent(new CustomEvent("audioerror", { detail: error.message })));
      return;
    }
    if (!buffer || this.muted.has(id)) return;
    time = Math.max(this.ctx.currentTime + 1e-3, time + (p.preDelay || 0) / 1e3);
    const total = p.bars * this.session.beats * beatDuration(this.session.bpm), length = total - phaseBeats * beatDuration(this.session.bpm);
    if (length < 0.012) return;
    const source = this.ctx.createBufferSource();
    source.loopVoice=true;
    source.buffer = buffer;
    source.playbackRate.value = 1;
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
    const t = (when ?? this.ctx.currentTime + 3e-3) + (p.preDelay || 0) / 1e3;
    if (p.audioId) {
      const buffer = this.sampleBuffer(id);
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
  previewSample(id, settings) {
    this.previewCleanup?.();
    const original = this.session.pads[id];
    let buffer;
    this.session.pads[id] = { ...original, ...settings };
    try {
      buffer = this.sampleBuffer(id);
    } finally {
      this.session.pads[id] = original;
    }
    if (!buffer) return;
    const c = this.ctx, source = c.createBufferSource(), gain = c.createGain(), nodes = [gain];
    source.buffer = buffer;
    gain.gain.value = original.volume;
    source.connect(gain);
    gain.connect(this.master);
    if (settings.echo) {
      const delay = c.createDelay(1.1), wet = c.createGain(), feedback = c.createGain();
      delay.delayTime.value = settings.echoTime || 0.25;
      wet.gain.value = settings.echo;
      feedback.gain.value = settings.echo * 0.55;
      gain.connect(delay);
      delay.connect(wet);
      wet.connect(this.master);
      delay.connect(feedback);
      feedback.connect(delay);
      nodes.push(delay, wet, feedback);
    }
    if(settings.reverb)nodes.push(...createReverb(c,gain,this.master,settings.reverb,settings.reverbSpace).nodes);
    const clean = () => {
      try {
        source.stop();
      } catch {
      }
      source.disconnect();
      nodes.forEach((n) => n.disconnect());
      if (this.previewCleanup === clean) this.previewCleanup = null;
    };
    this.previewCleanup = clean;
    this.track(source, null, "preview");
    source.addEventListener("ended", () => setTimeout(clean, Math.max(settings.reverb?3000:0,settings.echo ? Math.min(4e3, (settings.echoTime || 0.25) * 8e3) : 0)));
    source.start(c.currentTime + 5e-3 + (settings.preDelay || 0) / 1e3);
  }
  track(source, gain, id) {
    source.padId = id;
    this.nodes.add(source);
    source.onended = () => {
      source.disconnect();
      gain?.disconnect();
      this.nodes.delete(source);
    };
    while(this.nodes.size>this.maxSources){const oldest=[...this.nodes].find(n=>n!==source&&!n.loopVoice);if(!oldest)break;try{oldest.stop();}catch{}this.nodes.delete(oldest);}
  }
  play(e, time = this.ctx.currentTime + 3e-3, level = 1, id = null) {
    const c = this.ctx, t = Math.max(time, c.currentTime), v = Math.max(1e-3, (e.velocity ?? 0.7) * (id === null ? level : 1)), voice = e.voice;
    const freq = 440 * 2 ** ((e.note - 69) / 12);
    const rack = this.session.rack || defaultRack();
    const sound = getSound(voice, e.sound || rack.sounds[voice]);
    const tone = { ...rack.tone, ...e.tone };
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
      osc("sine", sound.start, sound.decay, v * 1.5, sound.end);
      if (sound.click) noise(0.018, 2400, "highpass", v * sound.click);
      if (sound.drive) osc("triangle", sound.start * 0.7, 0.15, v * 0.45, sound.end);
      return;
    }
    if (voice === "snare") {
      noise(sound.decay, 1400, "highpass", v * sound.noise);
      osc("triangle", sound.freq, 0.12, v * 0.4);
      return;
    }
    if (voice === "hat" || voice === "openhat") {
      noise(sound.decay, sound.cutoff, "highpass", v * 0.7);
      if ((e.sound || rack.sounds[voice]) === "909") [4100, 5710, 7990].forEach((f) => osc("square", f, sound.decay, v * 0.07));
      return;
    }
    if (voice === "clap") {
      noise(sound.decay, sound.cutoff, "bandpass", v * 1.5);
      return;
    }
    if (voice === "tom") {
      osc("sine", sound.freq, sound.decay, v, sound.freq * 0.42);
      return;
    }
    if (voice === "rim") {
      osc("square", sound.freq, 0.025, v * 0.6);
      osc("sine", sound.freq * 0.51, 0.04, v * 0.5);
      return;
    }
    if (voice === "triangle") {
      [1570, 2213, 3347, 5127].forEach((f2, i) => osc("sine", f2, sound.decay / (1 + i * 0.2), v / (i + 2)));
      return;
    }
    if (voice === "bell") {
      [1, 2.76, 5.4].forEach((h, i) => osc("sine", freq * h, Math.min(3, e.duration + 1) / (1 + i * 0.3), v / (i * 3 + 2)));
      return;
    }
    if (voice === "piano") {
      if (sound.id === "electric") {
        [1, 2.01, 3.98, 7].forEach((h, i) => osc("sine", freq * h, Math.max(0.15, e.duration) * sound.decay / (1 + i * 0.35), v / (1 + i * 4)));
      } else [1, 2, 3, 4, 6].forEach((h, i) => osc("sine", freq * h, Math.max(0.1, e.duration) * sound.decay / (1 + i * 0.22) + 0.15, v / (1 + i * (4 - sound.brightness * 2))));
      osc("triangle", freq, 0.07, v * 0.12);
      return;
    }
    if (voice === "bass" && sound.id === "sub") {
      osc("triangle", freq, e.duration + 0.08, v * 0.9);
      osc("sine", freq / 2, e.duration + 0.05, v * 0.6);
      return;
    }
    if (voice === "guitar" || voice === "bass") {
      this.playString(e, t, v, id, sound, tone);
      return;
    }
    this.playSynth(e, t, v, id, sound, tone);
  }
  playString(e, t, volume, id, sound, tone) {
    const c = this.ctx, key = e.voice + ":" + sound.id + ":" + e.note;
    let buffer = this.stringBuffers.get(key);
    if (!buffer) {
      const samples = pluckedString(e.note, c.sampleRate, sound, sound.id === "muted" ? 1.2 : 3);
      buffer = c.createBuffer(1, samples.length, c.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.stringBuffers.set(key, buffer);
    }
    const source = c.createBufferSource(), filter = c.createBiquadFilter(), body = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = Math.min(c.sampleRate * 0.45, 600 + tone.brightness * sound.brightness * 10500);
    filter.Q.value = 0.5;
    body.type = "peaking";
    body.frequency.value = sound.body;
    body.Q.value = 1.1;
    body.gain.value = 4;
    const life = Math.min(buffer.duration, Math.max(0.12, e.duration * (0.5 + tone.decay * 1.7) + tone.release));
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.7, t + 3e-3);
    gain.gain.exponentialRampToValueAtTime(1e-4, t + life);
    source.connect(filter);
    filter.connect(body);
    let last = body;
    const extras = [];
    const drive = (sound.drive || 0) + tone.drive * 3;
    if (drive > 0.05) {
      const shaper = c.createWaveShaper(), curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = i * 2 / (curve.length - 1) - 1;
        curve[i] = Math.tanh(x * (1 + drive * 5)) / Math.tanh(1 + drive * 5);
      }
      shaper.curve = curve;
      shaper.oversample = "2x";
      last.connect(shaper);
      last = shaper;
      extras.push(shaper);
    }
    last.connect(gain);
    gain.connect(this.bus(id));
    this.track(source, gain, id);
    source.addEventListener("ended", () => {
      filter.disconnect();
      body.disconnect();
      extras.forEach((n) => n.disconnect());
    });
    source.start(t);
    source.stop(t + life);
  }
  playSynth(e, t, volume, id, sound, tone) {
    const c = this.ctx, freq = 440 * 2 ** ((e.note - 69) / 12), filter = c.createBiquadFilter(), gain = c.createGain();
    const attack = Math.max(sound.attack || 0, tone.attack), life = Math.max(attack + 0.05, e.duration) + tone.release;
    filter.type = "lowpass";
    filter.Q.value = sound.resonance || tone.resonance;
    filter.frequency.setValueAtTime(Math.min(c.sampleRate * 0.45, tone.cutoff * (sound.cutoff / 3200)), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, tone.cutoff * 0.12), t + life);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.18, t + attack);
    gain.gain.setValueAtTime(volume * 0.13, t + Math.max(attack, e.duration));
    gain.gain.exponentialRampToValueAtTime(1e-4, t + life);
    filter.connect(gain);
    gain.connect(this.bus(id));
    const nodes = [];
    for (const offset of [-1, 1]) {
      const n = c.createOscillator();
      n.type = sound.wave;
      n.frequency.value = freq;
      n.detune.value = offset * (tone.detune + (sound.detune || 0)) * 0.5;
      n.connect(filter);
      nodes.push(n);
      if (sound.fm) {
        const mod = c.createOscillator(), depth = c.createGain();
        mod.frequency.value = freq * sound.fm;
        depth.gain.setValueAtTime(freq * 0.7, t);
        depth.gain.exponentialRampToValueAtTime(1e-3, t + life);
        mod.connect(depth);
        depth.connect(n.frequency);
        mod.start(t);
        mod.stop(t + life);
        this.track(mod, depth, id);
        n.addEventListener("ended", () => {
          mod.disconnect();
          depth.disconnect();
        });
      }
      n.start(t);
      n.stop(t + life + 0.01);
      this.track(n, null, id);
    }
    let ended = 0;
    for (const n of nodes) n.addEventListener("ended", () => {
      if (++ended === nodes.length) {
        filter.disconnect();
        gain.disconnect();
      }
    });
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
    this.sampleVersions.set(id,(this.sampleVersions.get(id)||0)+1);
    this.buffers.set(id, b);
    this.processedBuffers.clear();
    for(const key of this.stretchedBuffers.keys())if(String(key).startsWith(id+':'))this.stretchedBuffers.delete(key);
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
    let finish, stopPromise, stopTimer, closed=false;
    const done = new Promise((resolve) => finish = resolve);
    const close=()=>{if(closed)return;closed=true;clearTimeout(stopTimer);mic.node.port.onmessage=null;try{mic.close();}finally{finish();}};
    mic.node.port.onmessage = ({ data }) => {
      if (data.type === "samples") {
        chunks.push(data);
        onChunk?.(data);
      }
      if (data.type === "stopped") finish();
    };
    mic.node.port.postMessage({ type: "start" });
    return { ...mic, close, chunks, start, end, stop: () => {
      if(!stopPromise)stopPromise=(async()=>{
        if(closed)return;
        try{
          // An interrupted context may never acknowledge the worklet's final flush.
          stopTimer=setTimeout(finish,1200);
          mic.node.port.postMessage({type:'stop'});
          await done;
        }finally{close();}
      })();
      return stopPromise;
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
