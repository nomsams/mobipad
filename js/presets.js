import { validSampleSettings } from "./sample-analysis.js";
import { defaultRack, normalizeRack, validSound, validTone } from "./sounds.js";
const padKeys = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"];
const drums = ["kick", "snare", "hat", "openhat", "clap", "tom", "rim", "triangle"];
const drumNames = { kick: "Kick", snare: "Snare", hat: "Hi-hat", openhat: "Open hat", clap: "Clap", tom: "Tom", rim: "Rim", triangle: "Triangle" };
const colors = ["coral", "lime", "teal", "purple"];
function resizePattern(rows, beats) {
  return Object.fromEntries(["kick", "snare", "hat", "clap"].map((voice) => [voice, Array.from({ length: beats * 4 }, (_, i) => Boolean(rows[voice]?.[i]))]));
}
const ev = (beat, voice, note = 60, duration = 0.22, velocity = 0.7) => ({ beat, voice, note, duration, velocity });
function pattern(kind = "house", beats = 4) {
  const rows = Object.fromEntries(["kick", "snare", "hat", "clap"].map((k) => [k, Array(beats * 4).fill(false)]));
  for (let i = 0; i < beats * 4; i++) {
    rows.kick[i] = kind === "house" ? i % 4 === 0 : kind === "half" ? [0, 10].includes(i) : [0, 6, 10].includes(i);
    rows.snare[i] = kind === "half" ? i === 8 : i % 8 === 4;
    rows.hat[i] = kind === "house" ? i % 4 === 2 : i % 2 === 0;
    rows.clap[i] = kind === "house" ? i % 8 === 4 : i === beats * 4 - 2;
  }
  return rows;
}
const packs = [
  { id: "afterhours", name: "After hours", bpm: 110, description: "Warm house · mellow keys · a little air", art: "▂ ▅ ▃ ▇", key: "C minor" },
  { id: "dusty", name: "Dusty corners", bpm: 82, description: "Lo-fi drums · soft piano · slow mornings", art: "◒ ◓ ◒", key: "C minor" },
  { id: "neon", name: "Neon current", bpm: 128, description: "Driving kicks · bright synth · late nights", art: "╱╲╱╲", key: "C minor" },
  { id: "sunset", name: "Sunset club", bpm: 98, description: "Broken beats · plucked strings · golden light", art: "◡ ◡ ◡", key: "C major" }
];
function makePads(packId = "afterhours") {
  const p = packs.find((p2) => p2.id === packId) || packs[0];
  const pads = Array.from({ length: 16 }, (_, i) => ({ id: i, name: "Add a sound", color: colors[i % 4], events: [], audioId: null, volume: 0.75, bars: 2, kind: "empty" }));
  const set = (i, name, events, kind = "loop") => Object.assign(pads[i], { name, events, kind });
  const rhythm = pattern(p.id === "dusty" ? "half" : p.id === "sunset" ? "break" : "house");
  const d = [];
  for (let bar = 0; bar < 2; bar++) for (const [voice, steps] of Object.entries(rhythm)) steps.forEach((on, i) => {
    if (on) d.push(ev(bar * 4 + i / 4, voice, 60, 0.1, voice === "hat" ? 0.3 : 0.75));
  });
  set(0, p.id === "dusty" ? "Dusty drums" : "Pocket drums", d);
  set(4, "Broken beat", Array.from({ length: 16 }, (_, i) => ev(i * 0.5, i % 4 === 2 ? "snare" : i % 4 === 0 ? "kick" : "hat", 60, 0.1, 0.65)));
  const bass = [36, 36, 43, 39, 36, 46, 43, 39];
  set(1, p.id === "neon" ? "Night drive" : "Sub motion", bass.map((n, i) => ev(i, p.id === "neon" ? "synth" : "bass", n, 0.65, 0.6)));
  set(5, "Offbeat bass", [0, 1.5, 2.5, 4, 5.5, 7].map((b, i) => ev(b, "bass", [36, 43, 46][i % 3], 0.4, 0.65)));
  const chords = p.id === "sunset" ? [[60, 64, 67], [57, 60, 64], [65, 69, 72], [55, 59, 62]] : [[60, 63, 67], [56, 60, 63], [58, 62, 65], [55, 58, 62]];
  set(2, p.id === "sunset" ? "Golden strings" : "Velvet keys", chords.flatMap((ns, i) => ns.map((n) => ev(i * 2, p.id === "sunset" ? "guitar" : "piano", n, 1.6, 0.45))));
  set(6, "Little arp", Array.from({ length: 16 }, (_, i) => ev(i * 0.5, p.id === "neon" ? "synth" : "piano", [72, 75, 79, 82, 79, 75, 70, 67][i % 8], 0.3, 0.4)));
  set(3, "Glass garden", [0, 1.5, 3, 4.5, 6.5].map((b, i) => ev(b, "bell", [84, 79, 87, 82, 91][i], 1.8, 0.22)));
  set(7, "Soft triangles", [0.5, 2.5, 4.5, 6.5].map((b) => ev(b, "triangle", 60, 0.5, 0.25)));
  set(8, "Deep kick", [ev(0, "kick", 60, 0.1, 0.9)], "shot");
  set(9, "Low C", [ev(0, "bass", 36, 0.65, 0.8)], "shot");
  set(10, "Felt C", [ev(0, "piano", 60, 1, 0.7)], "shot");
  set(11, "Triangle", [ev(0, "triangle", 60, 1, 0.5)], "shot");
  return pads;
}
function defaultSession() {
  return { rack: defaultRack(), version: 1, name: "Untitled session", bpm: 110, beats: 4, bars: 2, pack: "afterhours", swing: 0, pads: makePads(), pattern: pattern(), seqEnabled: false, master: 0.8, inputLatency: 20, outputOffset: 0, jamBuffer: 120 };
}
function validateSession(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.pads) || s.pads.length !== 16) throw new Error("This is not a Mobipad project.");
  if (!(s.bpm >= 40 && s.bpm <= 240) || ![3, 4, 5, 6, 7].includes(s.beats) || ![1, 2, 4, 8].includes(s.bars)) throw new Error("Invalid project timing.");
  for (const [i, p] of s.pads.entries()) {
    if (!validSampleSettings(p, s.beats)) throw new Error("Invalid sample settings.");
    if (!p || p.id !== i || typeof p.name !== "string" || p.name.length > 80 || !colors.includes(p.color) || !["empty", "shot", "loop", "audio"].includes(p.kind) || !Number.isFinite(p.volume) || p.volume < 0 || p.volume > 1 || (!Number.isInteger(p.bars) || p.bars < 1 || p.bars > 512) || !Array.isArray(p.events) || p.events.length > 4096 || p.audioId !== null && (typeof p.audioId !== "string" || p.audioId.length > 100)) throw new Error("Invalid pad data.");
    for (const e of p.events) if (!e || !["piano", "bass", "guitar", "synth", "bell", ...drums].includes(e.voice) || !Number.isFinite(e.beat) || e.beat < 0 || e.beat > 224 || !Number.isFinite(e.note) || e.note < 0 || e.note > 127 || !Number.isFinite(e.duration) || e.duration <= 0 || e.duration > 30 || !Number.isFinite(e.velocity) || e.velocity < 0 || e.velocity > 1) throw new Error("Invalid note data.");
  }
  for (const p of s.pads) for (const e of p.events) if (!validSound(e.voice, e.sound) || !validTone(e.tone)) throw new Error("Invalid note sound.");
  if (!s.pattern || !["kick", "snare", "hat", "clap"].every((k) => Array.isArray(s.pattern[k]) && s.pattern[k].length === s.beats * 4 && s.pattern[k].every((x) => typeof x === "boolean"))) throw new Error("Invalid drum pattern.");
  if (typeof s.name !== "string" || s.name.length > 100) throw new Error("Invalid session name.");
  return { ...defaultSession(), ...s, rack: normalizeRack(s.rack), master: Math.min(1, Math.max(0, Number(s.master) || 0)), swing: Math.min(60, Math.max(0, Number(s.swing) || 0)), inputLatency: Math.min(500, Math.max(0, Number(s.inputLatency) || 0)), outputOffset: Math.min(500, Math.max(-500, Number(s.outputOffset) || 0)), jamBuffer: Math.min(500, Math.max(40, Number(s.jamBuffer) || 120)) };
}
export {
  colors,
  defaultSession,
  drumNames,
  drums,
  makePads,
  packs,
  padKeys,
  pattern,
  resizePattern,
  validateSession
};
