let worker, serial = 0;
const pending = /* @__PURE__ */ new Map();
function requestDSP(type, payload) {
  if (!worker) {
    worker = new Worker(new URL("./audio-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id);
      clearTimeout(task.timer);
      data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
    };
    worker.onerror = () => {
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error("Audio processing failed. Refresh and try again."));
      }
      pending.clear();
      worker.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Audio processing took too long. Try a shorter sample."));
    }, 9e4);
    pending.set(id, { resolve, reject, timer });
    const transfer = type === "stretch" ? payload.channels.map((c) => c.buffer) : [payload.samples.buffer];
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}
async function analyzeBuffer(buffer) {
  const rate = 11025, length = Math.min(Math.floor(buffer.duration * rate), rate * 90), samples = new Float32Array(length), channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < length; i++) {
    const index = Math.floor(i * buffer.sampleRate / rate);
    for (const channel of channels) samples[i] += channel[index] / channels.length;
  }
  return requestDSP("analyze", { samples, sampleRate: rate });
}
export {
  analyzeBuffer,
  requestDSP
};
