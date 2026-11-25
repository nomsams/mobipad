function detectOnsets(samples, sampleRate) {
  const hop = Math.max(32, Math.round(sampleRate * 3e-3)), window = hop * 2, frames = [];
  for (let start = 0; start + window <= samples.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < window; i++) energy += samples[start + i] ** 2;
    frames.push(Math.sqrt(energy / window));
  }
  if (!frames.length) return [];
  const peak = Math.max(...frames.slice(0, 2e4)), floor = Math.max(3e-3, peak * 0.045), novelty = frames.map((v, i) => Math.max(0, v - (frames[i - 2] || 0)));
  const sorted = [...novelty].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)], threshold = Math.max(peak * 0.045, median * 4, 2e-3);
  const onsets = [];
  let last = -1;
  for (let i = 2; i < frames.length - 2; i++) {
    if (novelty[i] < threshold || novelty[i] < novelty[i - 1] || novelty[i] <= novelty[i + 1] || frames[i] < floor) continue;
    let onset = i;
    while (onset > Math.max(0, i - 5) && frames[onset - 1] > frames[i] * 0.18) onset--;
    const time = Math.max(0, onset * hop / sampleRate);
    if (time - last < 0.065) continue;
    onsets.push({ time, strength: Math.min(1, novelty[i] / Math.max(1e-3, peak)) });
    last = time;
    if (onsets.length >= 256) break;
  }
  return onsets;
}
function estimateAlignment(onsets, bpm) {
  const grid = 60 / bpm / 4;
  if (onsets.length < 3) return { shift: 0, confidence: 0, reason: "Not enough distinct attacks", grid };
  let x = 0, y = 0, weight = 0;
  for (const hit of onsets) {
    const w = Math.max(0.05, hit.strength), phase2 = hit.time / grid * 2 * Math.PI;
    x += Math.cos(phase2) * w;
    y += Math.sin(phase2) * w;
    weight += w;
  }
  const confidence = Math.min(1, Math.hypot(x, y) / weight), phase = Math.atan2(y, x) / (2 * Math.PI) * grid, maxShift = Math.min(0.075, grid * 0.42);
  const meaningful = Math.abs(phase) >= 4e-3, credible = confidence >= 0.82 && Math.abs(phase) <= maxShift;
  return { shift: credible && meaningful ? Math.round(phase * 1e3) : 0, confidence, reason: !credible ? "Timing is expressive or ambiguous" : !meaningful ? "Already on the grid" : "Consistent timing offset", grid };
}
function analyzeRecording(samples, sampleRate, bpm) {
  const onsets = detectOnsets(samples, sampleRate);
  return { ...estimateAlignment(onsets, bpm), onsets, bpm, enabled: true, manual: 0 };
}
function trimSilence(samples, sampleRate) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak < 3e-3) return { start: 0, end: samples.length / sampleRate };
  const threshold = Math.max(2e-3, peak * 0.025);
  let first = 0, last = samples.length - 1;
  while (first < last && Math.abs(samples[first]) < threshold) first++;
  while (last > first && Math.abs(samples[last]) < threshold) last--;
  return { start: Math.max(0, first / sampleRate - 8e-3), end: Math.min(samples.length / sampleRate, last / sampleRate + 0.015) };
}
function planRecording(position, bpm, beats, bars, countIn = 0) {
  const margin = 0.12 / (60 / bpm);
  const countStart = Math.max(0, Math.ceil(position + margin - 1e-6));
  const startBeat = countStart + countIn;
  return { countStart, startBeat, endBeat: startBeat + beats * bars };
}
function validSampleSettings(p, beats = 4) {
  if (p.trackAnalysis && (typeof p.trackAnalysis !== "object" || p.trackAnalysis.bpm !== null && (!Number.isFinite(p.trackAnalysis.bpm) || p.trackAnalysis.bpm < 40 || p.trackAnalysis.bpm > 240) || !Number.isFinite(p.trackAnalysis.bpmConfidence) || p.trackAnalysis.bpmConfidence < 0 || p.trackAnalysis.bpmConfidence > 1 || p.trackAnalysis.key !== null && (typeof p.trackAnalysis.key !== "string" || p.trackAnalysis.key.length > 30))) return false;
  if (p.trimStart !== void 0 && (!Number.isFinite(p.trimStart) || p.trimStart < 0 || p.trimStart > 600)) return false;
  if (p.trimEnd !== void 0 && (!Number.isFinite(p.trimEnd) || p.trimEnd <= 0 || p.trimEnd > 600 || p.trimEnd <= (p.trimStart || 0))) return false;
  if (p.preDelay !== void 0 && (!Number.isFinite(p.preDelay) || p.preDelay < 0 || p.preDelay > 1e3)) return false;
  if (p.echo !== void 0 && (!Number.isFinite(p.echo) || p.echo < 0 || p.echo > 0.7)) return false;
  if (p.echoTime !== void 0 && (!Number.isFinite(p.echoTime) || p.echoTime < 0.05 || p.echoTime > 1)) return false;
  if(p.reverb!==undefined&&(!Number.isFinite(p.reverb)||p.reverb<0||p.reverb>.8))return false;
  if(p.reverbSpace!==undefined&&!['room','plate','hall'].includes(p.reverbSpace))return false;
  if (p.sequenceEnabled !== void 0 && typeof p.sequenceEnabled !== "boolean") return false;
  if (p.steps !== void 0 && (!Array.isArray(p.steps) || p.steps.length > 28 || p.steps.some((s) => typeof s !== "boolean"))) return false;
  const a = p.alignment;
  if (a !== void 0 && (!a || !Number.isFinite(a.shift) || Math.abs(a.shift) > 100 || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1 || typeof a.enabled !== "boolean" || !Number.isFinite(a.manual) || Math.abs(a.manual) > 250)) return false;
  return true;
}
export {
  analyzeRecording,
  detectOnsets,
  estimateAlignment,
  planRecording,
  trimSilence,
  validSampleSettings
};
