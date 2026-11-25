const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = -2 * Math.PI / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(angle * k), sin = Math.sin(angle * k), a = start + k, b = a + size / 2, tr = real[b] * cos - imag[b] * sin, ti = real[b] * sin + imag[b] * cos;
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
      }
    }
  }
}
function correlation(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  return dot / Math.sqrt(aa * bb || 1);
}
function detectTempo(samples, rate) {
  const hop = Math.max(1, Math.round(rate / 200)), envelope = [];
  for (let p = 0; p + hop < samples.length; p += hop) {
    let power = 0;
    for (let i = 0; i < hop; i++) power += samples[p + i] ** 2;
    envelope.push(Math.sqrt(power / hop));
  }
  const flux = envelope.map((v, i) => Math.max(0, v - (envelope[i - 2] || 0)));
  let total = flux.reduce((s, v) => s + v * v, 0);
  if (total < 1e-5 || samples.length / rate < 1.5) return { bpm: null, bpmConfidence: 0, candidates: [] };
  const envRate = rate / hop, candidates = [];
  for (let bpm2 = 55; bpm2 <= 200; bpm2++) {
    const lag = envRate * 60 / bpm2;
    let score = 0;
    for (let mult = 1; mult <= 3; mult++) {
      let dot = 0, count = 0;
      const delay = Math.round(lag * mult);
      for (let i = delay; i < flux.length; i++) {
        dot += flux[i] * flux[i - delay];
        count++;
      }
      score += dot / (Math.max(1, count) * (mult === 1 ? 1 : mult * 2));
    }
    score *= 0.8 + 0.2 * Math.exp(-0.5 * (Math.log2(bpm2 / 110) / 0.7) ** 2);
    candidates.push({ bpm: bpm2, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const picks = [];
  for (const c of candidates) if (!picks.some((p) => Math.abs(p.bpm - c.bpm) < 4) && picks.length < 4) picks.push(c);
  const best = picks[0], bpm = best?.bpm || null;
  const average = candidates.reduce((s, c) => s + c.score, 0) / candidates.length;
  const confidence = Math.min(1, Math.max(0, (best.score / Math.max(average, 1e-12) - 1) / 8));
  return { bpm: confidence > 0.08 ? bpm : null, bpmConfidence: confidence, candidates: picks.map((c) => ({ bpm: c.bpm, confidence: Math.min(1, c.score / Math.max(best.score, 1e-12)) })) };
}
function detectKey(samples, rate) {
  const size = 4096, chroma = new Array(12).fill(0), frames = Math.min(64, Math.floor(samples.length / size));
  if (frames < 1) return { key: null, keyConfidence: 0 };
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.floor(frame / Math.max(1, frames - 1) * Math.max(0, samples.length - size)), real = new Float64Array(size), imag = new Float64Array(size);
    for (let i = 0; i < size; i++) real[i] = samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    fft(real, imag);
    const magnitudes = Array.from({ length: size / 2 }, (_, i) => Math.hypot(real[i], imag[i]));
    const peaks = [];
    for (let bin = Math.ceil(65 * size / rate); bin < Math.min(size / 2 - 1, 1800 * size / rate); bin++) if (magnitudes[bin] > magnitudes[bin - 1] && magnitudes[bin] >= magnitudes[bin + 1]) peaks.push({ bin, amp: magnitudes[bin] });
    peaks.sort((a, b) => b.amp - a.amp);
    for (const { bin, amp } of peaks.slice(0, 20)) {
      const frequency = bin * rate / size, note = Math.round(69 + 12 * Math.log2(frequency / 440));
      chroma[(note % 12 + 12) % 12] += Math.sqrt(amp);
    }
  }
  if (chroma.reduce((s, v) => s + v, 0) < 0.1 || chroma.filter((v) => v > Math.max(...chroma) * 0.2).length < 3) return { key: null, keyConfidence: 0 };
  const ranked = [];
  for (let root = 0; root < 12; root++) for (const [mode, profile] of [["major", major], ["minor", minor]]) {
    const shifted = Array.from({ length: 12 }, (_, i) => profile[(i - root + 12) % 12]);
    ranked.push({ root, mode, score: correlation(chroma, shifted) });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0], gap = best.score - ranked[1].score, confidence = Math.min(1, Math.max(0, best.score) * Math.min(1, gap / 0.12));
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  return { key: best.score > 0.45 ? names[best.root] + " " + best.mode : null, keyConfidence: confidence, chroma };
}
function analyzeTrack(samples, rate) {
  return { ...detectTempo(samples, rate), ...detectKey(samples, rate), analyzedSeconds: samples.length / rate };
}
export {
  analyzeTrack,
  detectKey,
  detectTempo
};
