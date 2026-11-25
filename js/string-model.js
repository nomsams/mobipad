function pluckedString(note, sampleRate, preset, duration = 3) {
  const frequency = 440 * 2 ** ((note - 69) / 12), delay = Math.max(2, sampleRate / frequency - 0.5), size = Math.ceil(delay) + 2;
  const ring = new Float32Array(size), output = new Float32Array(Math.ceil(sampleRate * duration));
  let seed = note * 65537 + Math.round((preset.pick || 0.2) * 1e3) | 0;
  const noise = () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 2147483648 - 1;
  };
  const excitation = Float32Array.from({ length: size }, noise), pick = Math.max(1, Math.floor(size * (preset.pick || 0.2)));
  for (let i = 0; i < size; i++) ring[i] = (excitation[i] - excitation[(i + pick) % size]) * 0.45;
  let write = 0, previous = 0, mean = 0, peak = 1e-3;
  for (let i = 0; i < output.length; i++) {
    let read = write - delay;
    if (read < 0) read += size;
    const base = Math.floor(read), frac = read - base;
    const delayed = ring[base] * (1 - frac) + ring[(base + 1) % size] * frac;
    ring[write] = 0.5 * (delayed + previous) * (preset.damping || 0.996);
    previous = delayed;
    write = (write + 1) % size;
    mean += 2e-3 * (delayed - mean);
    output[i] = delayed - mean;
    peak = Math.max(peak, Math.abs(output[i]));
  }
  const norm = 0.8 / peak, fade = Math.min(200, output.length);
  for (let i = 0; i < output.length; i++) {
    output[i] *= norm * Math.min(1, i / 30, (output.length - 1 - i) / fade);
  }
  return output;
}
export {
  pluckedString
};
