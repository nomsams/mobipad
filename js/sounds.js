const soundBank = {
  piano: [
    { id: "felt", name: "Felt room", description: "Soft hammers · warm and intimate", brightness: 0.5, decay: 1.2 },
    { id: "bright", name: "Studio grand", description: "Bright attack · clear upper harmonics", brightness: 0.95, decay: 1.7 },
    { id: "electric", name: "Electric tine", description: "Bell-like keys · rounded body", brightness: 0.7, decay: 1.5 }
  ],
  guitar: [
    { id: "nylon", name: "Nylon acoustic", description: "Round pluck · wooden resonance", damping: 0.992, pick: 0.28, brightness: 0.55, body: 190 },
    { id: "steel", name: "Steel acoustic", description: "Bright strings · ringing overtones", damping: 0.996, pick: 0.16, brightness: 0.92, body: 240 },
    { id: "clean", name: "Clean electric", description: "Focused pickup · gentle sustain", damping: 0.997, pick: 0.12, brightness: 0.74, body: 750 },
    { id: "muted", name: "Palm muted", description: "Short, percussive · tight rhythm", damping: 0.977, pick: 0.2, brightness: 0.4, body: 170 },
    { id: "drive", name: "Driven electric", description: "Saturated strings · a little bite", damping: 0.996, pick: 0.13, brightness: 0.8, body: 650, drive: 2.5 }
  ],
  bass: [
    { id: "finger", name: "Fingerstyle", description: "Warm electric bass · rounded pluck", damping: 0.997, pick: 0.3, brightness: 0.55, body: 110 },
    { id: "pick", name: "Picked bass", description: "Defined attack · bright edge", damping: 0.997, pick: 0.13, brightness: 0.83, body: 160 },
    { id: "slap", name: "Slap & pop", description: "Snappy transient · metallic string", damping: 0.995, pick: 0.09, brightness: 1, body: 200 },
    { id: "muted", name: "Vintage mute", description: "Short, woody · old-school pocket", damping: 0.986, pick: 0.32, brightness: 0.36, body: 95 },
    { id: "sub", name: "Analog sub", description: "Deep sine · smooth electronic low end", brightness: 0.25 }
  ],
  synth: [
    { id: "warm", name: "Warm analog", description: "Detuned saws · a mellow filter", wave: "sawtooth", cutoff: 2600, detune: 9 },
    { id: "acid", name: "Acid pulse", description: "Square oscillator · resonant sweep", wave: "square", cutoff: 1700, detune: 2, resonance: 7 },
    { id: "glass", name: "Glass pluck", description: "FM bell · crisp and weightless", wave: "sine", cutoff: 7e3, detune: 3, fm: 2.7 },
    { id: "cloud", name: "Cloud pad", description: "Slow bloom · wide, soft harmonics", wave: "triangle", cutoff: 3600, detune: 18, attack: 0.18 },
    { id: "chip", name: "Pocket chip", description: "Square lead · playful and bright", wave: "square", cutoff: 6800, detune: 0 },
    {id:'pure',name:'Pure tone',description:'Clean sine melody · no modulation',wave:'sine',cutoff:5000,detune:0}
  ],
  kick: [
    { id: "808", name: "808 sub", start: 125, end: 42, decay: 0.65, click: 0.05 },
    { id: "909", name: "909 punch", start: 190, end: 48, decay: 0.29, click: 0.35 },
    { id: "acoustic", name: "Acoustic kick", start: 110, end: 55, decay: 0.2, click: 0.65 },
    { id: "dust", name: "Dusty thump", start: 100, end: 46, decay: 0.25, click: 0.12 },
    { id: "hard", name: "Hard club", start: 230, end: 39, decay: 0.4, click: 0.5, drive: 2 }
  ],
  snare: [{ id: "808", name: "808 snap", freq: 180, decay: 0.17, noise: 1 }, { id: "909", name: "909 crack", freq: 205, decay: 0.21, noise: 1.2 }, { id: "acoustic", name: "Studio snare", freq: 230, decay: 0.2, noise: 1.4 }, { id: "dust", name: "Dusty snare", freq: 155, decay: 0.12, noise: 0.65 }, { id: "hard", name: "Big room", freq: 190, decay: 0.28, noise: 1.5 }],
  hat: [{ id: "808", name: "808 closed", cutoff: 8e3, decay: 0.045 }, { id: "909", name: "909 metallic", cutoff: 6400, decay: 0.075 }, { id: "acoustic", name: "Studio hat", cutoff: 9500, decay: 0.09 }, { id: "dust", name: "Dusty hat", cutoff: 4200, decay: 0.055 }, { id: "hard", name: "Club hat", cutoff: 7200, decay: 0.065 }],
  openhat: [{ id: "808", name: "808 open", cutoff: 7800, decay: 0.28 }, { id: "909", name: "909 open", cutoff: 6100, decay: 0.48 }, { id: "acoustic", name: "Loose hat", cutoff: 9200, decay: 0.42 }, { id: "dust", name: "Dusty open", cutoff: 4400, decay: 0.22 }, { id: "hard", name: "Club open", cutoff: 7300, decay: 0.55 }],
  clap: [{ id: "808", name: "808 clap", cutoff: 1600, decay: 0.16 }, { id: "909", name: "909 clap", cutoff: 2100, decay: 0.2 }, { id: "acoustic", name: "Hand clap", cutoff: 1300, decay: 0.12 }, { id: "dust", name: "Tape clap", cutoff: 950, decay: 0.11 }, { id: "hard", name: "Wide clap", cutoff: 2400, decay: 0.28 }],
  tom: [{ id: "808", name: "808 tom", freq: 160, decay: 0.4 }, { id: "909", name: "909 tom", freq: 220, decay: 0.32 }, { id: "acoustic", name: "Floor tom", freq: 135, decay: 0.38 }, { id: "dust", name: "Tape tom", freq: 145, decay: 0.22 }, { id: "hard", name: "Club tom", freq: 200, decay: 0.45 }],
  rim: [{ id: "808", name: "808 rim", freq: 840 }, { id: "909", name: "909 rim", freq: 980 }, { id: "acoustic", name: "Wood rim", freq: 620 }, { id: "dust", name: "Tape rim", freq: 530 }, { id: "hard", name: "Metal rim", freq: 1200 }],
  triangle: [{ id: "silver", name: "Silver triangle", decay: 1.5 }, { id: "soft", name: "Muted triangle", decay: 0.42 }, { id: "bright", name: "Bright triangle", decay: 2.6 }]
};
const drumKits = [{ id: "808", name: "808 · Deep machine" }, { id: "909", name: "909 · House punch" }, { id: "acoustic", name: "Studio · Acoustic" }, { id: "dust", name: "Dust · Tape room" }, { id: "hard", name: "Club · Heavy hitter" }];
const arpRecipes = [{ id: "custom", name: "Custom", direction: "up", rate: 0.25, octaves: 1, gate: 0.65 }, { id: "rolling", name: "Rolling sixteenths", direction: "up", rate: 0.25, octaves: 2, gate: 0.55 }, { id: "cascade", name: "Glass cascade", direction: "down", rate: 0.5, octaves: 2, gate: 0.8 }, { id: "bounce", name: "Octave bounce", direction: "updown", rate: 0.25, octaves: 3, gate: 0.4 }, { id: "triplet", name: "Triplet ripple", direction: "up", rate: 1 / 3, octaves: 2, gate: 0.6 }, { id: "wander", name: "Seeded wander", direction: "random", rate: 0.5, octaves: 2, gate: 0.85 }];
const toneLimits = { brightness: [0, 1], decay: [0.1, 1], attack: [2e-3, 0.5], release: [0.05, 2], cutoff: [150, 12e3], resonance: [0.1, 10], detune: [0, 30], drive: [0, 1] };
function defaultRack() {
  return { sounds: Object.fromEntries(Object.entries(soundBank).map(([v, p]) => [v, p[0].id])), kit: "808", tone: { brightness: 0.7, decay: 0.65, attack: 8e-3, release: 0.6, cutoff: 3200, resonance: 0.8, detune: 8, drive: 0 }, arp: { enabled: false, latch: false, direction: "up", rate: 0.25, octaves: 1, gate: 0.65 } };
}
function getSound(voice, id) {
  const presets = soundBank[voice] || [];
  return presets.find((p) => p.id === id) || presets[0] || {};
}
function validTone(t) {
  return t === void 0 || t && typeof t === "object" && !Array.isArray(t) && Object.entries(t).every(([k, v]) => toneLimits[k] && Number.isFinite(v) && v >= toneLimits[k][0] && v <= toneLimits[k][1]);
}
function validSound(voice, sound) {
  return sound === void 0 || typeof sound === "string" && soundBank[voice]?.some((p) => p.id === sound);
}
function normalizeRack(input) {
  const result = defaultRack();
  if (input === void 0) return result;
  if (!input || typeof input !== "object") throw new Error("Invalid instrument settings.");
  if (input.sounds) {
    for (const [voice, id] of Object.entries(input.sounds)) {
      if (!soundBank[voice] || !validSound(voice, id)) throw new Error("Unknown sound preset.");
      result.sounds[voice] = id;
    }
  }
  if (input.tone) {
    if (!validTone(input.tone)) throw new Error("Invalid sound controls.");
    Object.assign(result.tone, input.tone);
  }
  if (input.kit !== void 0) {
    if (!drumKits.some((k) => k.id === input.kit)) throw new Error("Unknown drum kit.");
    result.kit = input.kit;
  }
  if (input.arp) {
    const a = input.arp;
    if (typeof a.enabled !== "boolean" || typeof a.latch !== "boolean" || !["up", "down", "updown", "random", "order"].includes(a.direction) || ![1, 0.5, 0.25, 0.125, 1 / 3].includes(a.rate) || ![1, 2, 3].includes(a.octaves) || !Number.isFinite(a.gate) || a.gate < 0.1 || a.gate > 1) throw new Error("Invalid arpeggiator settings.");
    result.arp = { enabled: a.enabled, latch: a.latch, direction: a.direction, rate: a.rate, octaves: a.octaves, gate: a.gate };
  }
  return result;
}
const tunings = { guitar: [64, 59, 55, 50, 45, 40], bass: [43, 38, 33, 28] };
function noteName(note) {
  return ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][(note % 12 + 12) % 12] + (Math.floor(note / 12) - 1);
}
const chordShapes = [{ name: "C", guitar: [0, 1, 0, 2, 3, -1], notes: [48, 52, 55, 60] }, { name: "Am", guitar: [0, 1, 2, 2, 0, -1], notes: [45, 48, 52, 57] }, { name: "F", guitar: [1, 1, 2, 3, 3, 1], notes: [41, 45, 48, 53] }, { name: "G", guitar: [3, 0, 0, 0, 2, 3], notes: [43, 47, 50, 55] }, { name: "Dm", guitar: [1, 3, 2, 0, -1, -1], notes: [50, 53, 57, 62] }, { name: "Em", guitar: [0, 0, 0, 2, 2, 0], notes: [40, 43, 47, 52] }];
export {
  arpRecipes,
  chordShapes,
  defaultRack,
  drumKits,
  getSound,
  normalizeRack,
  noteName,
  soundBank,
  toneLimits,
  tunings,
  validSound,
  validTone
};
