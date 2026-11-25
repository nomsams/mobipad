# Research before implementation

Reviewed November 25, 2026. Interaction ideas come from existing tools; Mobipad uses original synthesized sounds and its own interface.

| Source | Useful idea | Implementation |
| --- | --- | --- |
| [BandLab: Using the Looper](https://help.bandlab.com/hc/en-us/articles/115004496573-Using-the-Looper) | Colored pads and sound packs make layering approachable. | 4×4 grid, separate one-shot/loop modes, four coherent starter packs. |
| [Ableton: Capture in Note](https://help.ableton.com/hc/en-us/articles/5953167728796-Capture-in-Note) | Clips are building blocks; capturing an idea should be quick. | Count-in and fixed-length instrument capture directly to a pad. Forward recording, not retrospective capture. |
| [MDN: Creating and sequencing audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques) | Timers should enqueue AudioContext events rather than directly time the beat. | Recurring look-ahead scheduler; visuals use requestAnimationFrame separately. |
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
