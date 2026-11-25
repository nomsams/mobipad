import { stretchAudio } from "./stretch.js";
import { analyzeTrack } from "./track-analysis.js";
import {transcribeMelody} from './melody.js';
self.onmessage = ({ data }) => {
  try {
    const result = data.type === "stretch" ? stretchAudio(data.channels, data.sampleRate, data.targetLength) : data.type==='melody'?transcribeMelody(data.samples,data.sampleRate):analyzeTrack(data.samples, data.sampleRate);
    const transfer = data.type === "stretch" ? result.map((c) => c.buffer) : [];
    self.postMessage({ id: data.id, result }, transfer);
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
