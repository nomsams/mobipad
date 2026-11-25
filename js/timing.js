const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const beatDuration = (bpm) => 60 / bpm;
const loopBeats = (s) => s.beats * s.bars;
function positionAt(time, epoch, bpm) {
  return (time - epoch) / 1e3 * bpm / 60;
}
function nextBoundary(position, quantum) {
  return Math.max(0, Math.ceil((position + 0.02) / quantum) * quantum);
}
function quantizeBeat(beat, grid = 0.25) {
  return Math.round(beat / grid) * grid;
}
function clockEstimate(samples) {
  if (!samples.length) return { offset: 0, rtt: 0 };
  const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5);
  const offsets = best.map((x) => x.offset).sort((a, b) => a - b);
  return { offset: offsets[Math.floor(offsets.length / 2)], rtt: best[0].rtt };
}
function wavEncode(channels, sampleRate) {
  const length = channels[0]?.length || 0, count = channels.length;
  const data = new ArrayBuffer(44 + length * count * 2), view = new DataView(data);
  const str = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, data.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, length * count * 2, true);
  for (let i = 0; i < length; i++) for (let c = 0; c < count; c++) {
    const v = Math.max(-1, Math.min(1, channels[c][i]));
    view.setInt16(44 + (i * count + c) * 2, v * (v < 0 ? 32768 : 32767), true);
  }
  return data;
}
export {
  beatDuration,
  clamp,
  clockEstimate,
  loopBeats,
  nextBoundary,
  positionAt,
  quantizeBeat,
  wavEncode
};
