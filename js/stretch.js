import { Stretch, CircularSampleBuffer, createCircularStretchInputBufferAdapter } from "../vendor/soundtouch.js";
function stretchAudio(channels, sampleRate, targetLength) {
  const length = channels[0].length;
  targetLength = Math.max(1, Math.round(targetLength));
  if (Math.abs(targetLength - length) < 2) return channels.map((c) => c.slice());
  const tempo = length / targetLength, stretch = new Stretch({ sampleRate, createBuffers: true, inputBufferAdapterFactory: createCircularStretchInputBufferAdapter, sampleBufferFactory: () => new CircularSampleBuffer() });
  stretch.tempo = tempo;
  stretch.setStretchParameters({ sequenceMs: 55, seekWindowMs: 18, overlapMs: 10, quickSeek: true });
  const result = Array.from({ length: Math.min(2, channels.length) }, () => new Float32Array(targetLength));
  const block = 4096, input = new Float32Array(block * 2), output = new Float32Array(16384 * 2);
  let sourcePos = 0, dest = 0;
  const padding = Math.ceil(sampleRate * 0.6 * Math.max(1, tempo));
  while (sourcePos < length + padding && dest < targetLength) {
    const count = Math.min(block, length + padding - sourcePos);
    input.fill(0);
    for (let i = 0; i < count && sourcePos + i < length; i++) {
      input[i * 2] = channels[0][sourcePos + i];
      input[i * 2 + 1] = (channels[1] || channels[0])[sourcePos + i];
    }
    stretch.inputBuffer.putSamples(input, 0, count);
    stretch.process();
    while (stretch.outputBuffer.frameCount && dest < targetLength) {
      const n = Math.min(16384, stretch.outputBuffer.frameCount, targetLength - dest);
      stretch.outputBuffer.extract(output, 0, n, true);
      for (let i = 0; i < n; i++) for (let ch = 0; ch < result.length; ch++) result[ch][dest + i] = output[i * 2 + ch];
      dest += n;
    }
    sourcePos += count;
  }
  if (dest < targetLength) throw new Error("Time stretch could not render the requested clip length.");
  const fade = Math.min(100, Math.floor(targetLength / 2));
  for (const channel of result) for (let i = 0; i < fade; i++) {
    channel[i] *= i / fade;
    channel[targetLength - 1 - i] *= i / fade;
  }
  return result;
}
export {
  stretchAudio
};
