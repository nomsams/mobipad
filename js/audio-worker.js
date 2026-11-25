import { stretchAudio } from "./stretch.js";
import { analyzeTrack } from "./track-analysis.js";
self.onmessage = ({ data }) => {
  try {
    const result = data.type === "stretch" ? stretchAudio(data.channels, data.sampleRate, data.targetLength) : analyzeTrack(data.samples, data.sampleRate);
    const transfer = data.type === "stretch" ? result.map((c) => c.buffer) : [];
    self.postMessage({ id: data.id, result }, transfer);
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
