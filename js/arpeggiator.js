function arpPattern(notes, octaves = 1, direction = "up") {
  const unique = [...new Set(notes)].filter((n) => Number.isInteger(n) && n >= 0 && n <= 127);
  if (direction !== "order") unique.sort((a, b) => a - b);
  let pattern = [];
  for (let octave = 0; octave < octaves; octave++) pattern.push(...unique.map((n) => n + octave * 12).filter((n) => n <= 127));
  if (direction === "down") pattern.reverse();
  if (direction === "updown" && pattern.length > 1) pattern.push(...pattern.slice(1, -1).reverse());
  return pattern;
}
function arpNote(pattern, index, direction = "up") {
  if (!pattern.length) return null;
  const step = direction === "random" ? (Math.imul(index + 1, 1103515245) >>> 0) % pattern.length : index % pattern.length;
  return pattern[step];
}
class Arpeggiator {
  constructor() {
    this.held = /* @__PURE__ */ new Map();
    this.latched = [];
    this.nextBeat = null;
    this.index = 0;
    this.voice = "synth";
    this.sound = "warm";
    this.tone = {};
  }
  press(note, key, latch = false) {
    if (!this.held.size && !latch) this.latched = [];
    if (!this.held.size && latch) this.latched = [];
    this.held.set(key, note);
    this.latched = [.../* @__PURE__ */ new Set([...this.latched, note])];
  }
  release(key) {
    this.held.delete(key);
  }
  clear() {
    this.held.clear();
    this.latched = [];
    this.nextBeat = null;
    this.index = 0;
  }
  notes(config) {
    return config.latch ? this.latched : [...this.held.values()];
  }
  schedule(position, horizon, config, emit) {
    const pattern = arpPattern(this.notes(config), config.octaves, config.direction);
    if (!config.enabled || !pattern.length) {
      this.nextBeat = null;
      return;
    }
    if (this.nextBeat === null || this.nextBeat < position - config.rate) this.nextBeat = Math.max(0, Math.ceil((position - 1e-5) / config.rate) * config.rate);
    let guard = 0;
    while (this.nextBeat < horizon && guard++ < 64) {
      const beat = this.nextBeat;
      emit({ note: arpNote(pattern, this.index++, config.direction), beat, duration: config.rate * config.gate, voice: this.voice, sound: this.sound, tone: { ...this.tone }, velocity: 0.68 });
      this.nextBeat += config.rate;
    }
  }
}
export {
  Arpeggiator,
  arpNote,
  arpPattern
};
