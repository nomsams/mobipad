class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.start = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "start") {
        this.active = true;
        this.used = 0;
      }
      if (data.type === "stop") {
        this.flush();
        this.active = false;
        this.port.postMessage({ type: "stopped" });
      }
    };
  }
  flush() {
    if (this.used) {
      const samples = this.buffer.slice(0, this.used);
      this.port.postMessage({ type: "samples", time: this.start, samples }, [samples.buffer]);
      this.used = 0;
    }
  }
  process(inputs) {
    const channels = inputs[0];
    if (!this.active || !channels?.length) return true;
    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      if (!this.used) this.start = currentTime + i / sampleRate;
      let v = 0;
      for (const ch of channels) v += ch[i] / channels.length;
      this.buffer[this.used++] = v;
      if (this.used === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor("mobipad-capture", CaptureProcessor);
