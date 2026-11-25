# Research before implementation

Reviewed November 25, 2026. Interaction ideas come from existing tools; Mobipad uses original synthesized sounds and its own interface.

| Source | Useful idea | Implementation |
| --- | --- | --- |
| [BandLab: Using the Looper](https://help.bandlab.com/hc/en-us/articles/115004496573-Using-the-Looper) | Colored pads and sound packs make layering approachable. | 4×4 grid, separate one-shot/loop modes, four coherent starter packs. |
| [Ableton: Capture in Note](https://help.ableton.com/hc/en-us/articles/5953167728796-Capture-in-Note) | Clips are building blocks; capturing an idea should be quick. | Count-in and fixed-length instrument capture directly to a pad. Forward recording, not retrospective capture. |
| [MDN: Creating and sequencing audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques) | Timers should enqueue AudioContext events rather than directly time the beat. | Recurring look-ahead scheduler; visuals refresh separately and pause in hidden documents. |
| [MDN: outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency) | Device output delay varies and estimates depend on browser support. | Interactive latency hint, reported estimates, manual compensation, approximate acoustic alignment. |
| [MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Microphones need permissions and a secure context. | Explicit recording gesture, HTTPS/permission errors, requested noise processing disabled, prompt microphone release. |
| [MDN: AudioWorkletProcessor.process](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) | Render-thread audio blocks provide precise sample data; do not assume block size. | Actual input lengths copied into timestamped chunks, then trimmed to exact loop lengths. |
| [PeerJS FAQ](https://peerjs.com/client/faq), [Peer API](https://peerjs.com/client/api/peer), [DataConnection](https://peerjs.com/client/api/data-connection) | Signaling is necessary; NAT may require TURN; reconnect alone does not restore state. | Configurable server/relay, leader snapshots, sample retransfer, heartbeat checks, stable room IDs, gesture-based return after reload. |

## Synchronization decisions

Local touch latency and distributed timing are different problems. A touch previews immediately on its originating phone; its replicated event is scheduled slightly later elsewhere. Loops and patterns can be scheduled ahead and share a stable beat with less network jitter. Audio files are transferred and decoded, then played locally. Live microphone audio is not streamed.

Clock offset uses request/response midpoint measurements and low-round-trip samples. Asymmetric paths can bias this. Acoustic calibration detects a known three-tone sequence to estimate the remaining phase; input processing, latency estimates, reverberation and distance introduce uncertainty. Manual alignment remains available.

The expanded engine detects tempo from onset-envelope autocorrelation with half/double-time candidates, and estimates key from FFT chroma and major/minor profile correlation. These are confidence-labeled estimates. SoundTouchJS core 2.1.1 supplies WSOLA stretching in a background worker, retaining pitch while fitting exact loop durations. Active clips prepare before a shared tempo switch; phase is preserved through the transition.

The string engine uses fractional-delay Karplus–Strong synthesis with pluck-position excitation, damping, pickup/body filtering and optional saturation. This follows the family of physical models described by [Tone.js PluckSynth](https://tonejs.github.io/docs/15.1.22/classes/PluckSynth.html), implemented here without Tone.js. [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) provides the stretch algorithm.

Smart recording alignment measures attack phases on a sixteenth-note circle and uses weighted circular mean/coherence to estimate a consistent small offset. It requires at least three attacks and 82% phase coherence, caps correction at 75 ms or 42% of a sixteenth, and leaves ambiguous/sustained material unchanged. A non-destructive circular shift preserves loop duration, with a manual override. It cannot infer arbitrary musical intent or resolve every Bluetooth/input delay.

Additional workflow features include tap tempo, odd meters, swing, scale highlighting, autosave, self-contained backups, mix recording, offline caching, a limiter, and a screen wake lock.

## Mobile presentation and resource use

The default layout considers viewport size, touch capability, mobile user-agent hints, and iPads reporting a Mac platform with multitouch. [MDN pointer media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-pointer) describe input capabilities rather than device identity, so a coarse pointer is one hint; a connected mouse does not override the iPad hint. Layout follows available space without locking physical orientation, and users can override detection.

[hardwareConcurrency](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency) and [deviceMemory](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory) provide optional, approximate resource hints. They select a default profile only. Eco reduces drawing frequency, idle worker lifetime, cache budgets and extreme polyphony while retaining the same audio scheduler and synthesis algorithms. Cache budgets are soft for the active working set so an ongoing loop is not evicted mid-performance.

## Voice to instrument conversion

Auto synth uses the cumulative mean-normalized difference and parabolic lag refinement described in [de Cheveigné and Kawahara’s YIN paper](https://www.ee.columbia.edu/~dpwe/e6820/papers/deChevK02-yin.pdf). Mono audio is downsampled to 8 kHz, analyzed every 10 ms, gated by energy/periodicity, median-smoothed and segmented into sustained notes. Estimated notes snap to the nearest semitone in a selected major/minor key. The backing-key suggestion compares duration-weighted melodic pitch classes from other layers with imported-sample key estimates; conflicts and uncertainty remain visible. This is monophonic transcription and instrument resynthesis, not a vocal timbre-preserving pitch shifter.

Reverb uses native [Web Audio convolution](https://www.w3.org/TR/webaudio/#ConvolverNode) with original deterministic stereo decaying-noise room/plate/hall impulses, cached per audio context. Wet paths are created only when enabled, run alongside the dry signal and delay, and disconnect on Stop. No external recordings or audio services are used.

## Performance recovery, scenes and timing

[Ableton Capture MIDI](https://help.ableton.com/hc/en-us/articles/360000776450-Capture-MIDI) and [Session View scenes](https://www.ableton.com/en/manual/session-view/) inspired recovering an unrecorded phrase and launching loop combinations together. Mobipad implements its own bounded local note history and a project-validated eight-scene bank. Smart drums use seeded rhythm generation, row locks, and evenly distributed Euclidean pulses; these are musical heuristics rather than a learned model.

The sequencer now anchors beat times once to AudioContext time, following the [Web Audio scheduling clock](https://www.w3.org/TR/webaudio/#dom-baseaudiocontext-currenttime), rather than recalculating each beat from a wall-clock reading. Peer clock updates slew gradually; interruptions rebuild the anchor. Visuals use [getOutputTimestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp) when available and reported latency otherwise. Kick pitch envelopes fall rapidly independently of their longer amplitude decay.

[Ableton’s Bluetooth latency guidance](https://help.ableton.com/hc/en-us/articles/6130134332188-Bluetooth-Headphones-and-Latency-in-Note) explains why immediate live playing still suffers from wireless buffering. Mobipad removes software waits from warm pointer presses, but does not claim to remove device or Bluetooth delay.
