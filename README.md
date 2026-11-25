# MOBIPAD · Pocket studio

A mobile-first launchpad and loop station, written in HTML, CSS and JavaScript. Runs entirely in the browser. No app server, account, build step, paid sound packs, or API keys required.

**App:** [nomsams.github.io/mobipad](https://nomsams.github.io/mobipad/) · **Repository:** [nomsams/mobipad](https://github.com/nomsams/mobipad)

## Run

Requires Node 22+ for the development server and checks. Runtime has no Node dependency.

```sh
npm start
```

Open **http://localhost:5173**. Audio starts on the first interaction. Microphone capture requires HTTPS or localhost. To use real phones, deploy to GitHub Pages; an ordinary HTTP LAN address will not grant microphone access on most browsers.

## Play

- **Stage view:** phones and tablets, including iPads using desktop-style Safari identification, automatically open a performance layout. Portrait uses a 4×4 pad grid above the compact edit/record dock and navigation. Landscape puts transport on the left and navigation on the right; the grid chooses 4×4 or 8×2 to maximize its smallest touch dimension. All 16 pads remain visible. Browser height changes and rotation resize the grid without restarting music. Stage/Studio switches layouts; Settings offers Auto and remembers your choice locally. On narrow phones, layout and resource selectors are in Settings. Meter, loop length, tap tempo, projects and mix recording remain accessible there.
- **Focus and full screen:** tap **▣** to maximize pads with a small Play/Stop/mode/full-screen/restore strip. Tap **⛶** for native full screen where supported. If the browser cannot enter full screen, the app offers Focus and installation instructions. On iPhone/iPad, Safari **Share → Add to Home Screen → Open as Web App** removes normal browser chrome. Full screen and Focus work separately; exiting either keeps music playing. Orientation stays unlocked so you can rotate freely.
- **Eco mode:** automatic on phones/tablets and devices reporting limited CPU/memory; switch Eco/Full at the top or select Auto in Settings. Eco reduces visual refresh to 12 fps, removes decorative animation, uses smaller byte-based audio caches, releases idle processing workers and limits extreme polyphony. All instruments, recording, effects, pitch-preserving tempo changes and jams remain available. The audio scheduler checks every 20 ms with a 90 ms scheduling horizon. Active loops remain cached even when they exceed the soft memory budget; dense performances may lose the oldest voice tails. Saved samples decode when needed instead of all at startup.
- **Launchpad:** 16 color-coded pads. Loops toggle at the next bar or beat. One shots respond immediately. The instant launch option uses the nearest upcoming sixteenth. Double-tap or hold a populated pad to rename it, change its level or audio length, import, record, or clear it. Tap an empty pad to add a sound.
- **Instruments:** synthesized piano, bass, guitar, and synth with octave changes and chromatic/major/minor/pentatonic keyboards. Eight finger drums, including a triangle. Capture starts on the next beat, with optional one-beat or one-bar count-ins. The chosen number of bars closes automatically. Guitar and bass have playable string fretboards, strum direction/spread and chord pads, with physically modeled plucked strings.
- **Catch last idea:** play instruments freely and tap **Catch last idea**, or open **✦** for 1/2/4/8-bar recovery and optional sixteenth snapping. Keeps up to 90 seconds / 4,096 local instrument events, with original sounds and timbres; includes arpeggios, rests and sustained notes. The phrase is aligned to its last played bar and saved to an empty pad. This is note history, not microphone recording; it is cleared on tempo, meter or project changes and page reload.
- **Scenes:** open **✦**, save a name for the audible/queued loop combination and sequencer pattern, then launch it on the next bar. Up to eight scenes travel with project exports and room snapshots. Scenes recall loop references, drum rows, swing and pattern enable state using current pad sounds/levels and current tempo/meter. All selected loops restart together; cleared pads are skipped. The room leader manages scenes. Samples prepare before launch; Stop or a newer launch cancels an older request.
- **Smart drums:** expand **Smart drums** in Sequencer for house, syncopated break, half-time and evenly spaced Euclidean grooves. Density controls activity; lock individual drum rows to preserve them. **Undo variation** restores the last generated pattern while it still matches the current pattern. Sample lanes are preserved.
- **Sequencer:** drum and imported-sample lanes, odd meters, swing, and save-to-pad. Left-click adds a hit; right-click removes it. Erase mode supports touchscreens. Sample lanes expose trim and delay editing.
- **Microphone:** unprocessed mono PCM capture through an AudioWorklet; no live monitoring, to avoid feedback. Recording is beat-aligned and trimmed to exact bar length; completed takes rejoin at their current loop phase instead of waiting another bar. Smart alignment detects consistent attack offsets against sixteenths, applies small reversible corrections only at high confidence, and shows the result in the waveform editor. Configurable input compensation accounts for microphone delay. Use headphones while capturing over an existing groove.
- **Auto synth:** choose **Sing → synth** in Instruments, or select **Auto synth** as the microphone mode in Settings. A finished take becomes a tuned instrument loop automatically; regular voice recording remains the default recording mode. For imported/recorded audio, open its pad editor and choose **Auto synth** to review notes, key, instrument, natural/sixteenth timing and effects, then add a new pad or replace its source pad. The default synth is a clean sine melody with natural timing and no arpeggiation. The original vocal stays in the sample library. YIN pitch tracking, smoothing and note segmentation run in the background worker; session melodic notes and confident imported-sample keys suggest the backing key, with manual chromatic/24-key overrides. Resynthesis follows the session tempo without transposing when tempo changes. Best for one voice/hummed line at a time, 65–1100 Hz, up to 60 seconds / 224 beats. Noise, chords, backing bleed, vibrato and ambiguous harmony can produce wrong notes; review by ear. This creates instrument notes from the vocal melody rather than preserving the singer’s vocal timbre.
- **Import:** browser-decodable audio up to 25 MB / 10 minutes per sample. BPM, alternative tempo interpretations, and musical key are analyzed in a background worker. Click a detected BPM to propose it for the whole session. Loop length is estimated from the detected tempo and can be edited. SoundTouch WSOLA time stretching fits loops to tempo **without transposing pitch**. Playing loops are prepared before a shared tempo switch; dormant loops prepare when launched. Detected BPM/key are estimates, particularly on short, percussive, expressive or harmonically ambiguous clips. Large tempo changes may introduce stretching artifacts.
- **Sounds:** 58 voice/preset combinations: nylon, steel, clean, muted and driven guitar; finger, pick, slap, muted and sub bass; six synth voices; piano variations; and 808, 909, acoustic, tape and club drum kits. Individual drums can be changed independently. Synth filter, resonance, attack, release and detune controls are captured with notes.
- **Arpeggiator:** up/down/as-played/seeded-random patterns, quarter to thirty-second notes, triplets, 1–3 octaves, gate, latch, and five ready-made recipes. Arpeggios can be captured into loops while preserving triplet timing.
- **Sample editing:** quick selected-pad volume and clear controls, waveform trimming, silence trim, manual timing nudge, start predelay, echo amount and echo time, plus stereo room/plate/hall reverb. Effects also work on generated instrument pads and survive project export and shared jams. Original source audio is preserved.
- **Presets:** four original synthesized packs: After hours, Dusty corners, Neon current, and Sunset club. No licensed music or fetched sound assets.
- **Mix:** mute and level controls, master limiter, and downloadable live mix recording in the browser's MediaRecorder format (usually WebM or M4A).
- **Projects:** IndexedDB autosave, JSON export including audio, and import. Imports check the entire archive before changing the project, use fresh sample IDs to preserve existing library entries, and save the project and samples in one transaction. A corrupt sample or failed save leaves the previous project intact. A new session first downloads a backup. Samples remain in the local library. Browser storage may be cleared or evicted; export backups.
- **Offline:** after the first successful online load, a service worker caches runtime files. Jamming still requires signaling connectivity. The remote font is optional; system fonts work offline.

Live instrument presses schedule directly on pointer-down before visual updates when audio is awake. Opening Instruments wakes audio and silently prepares the selected synthesis path during idle time; changing instruments or presets prepares the new path too. This preparation stays outside live polyphony and never records notes. Warm taps bypass sample preparation, repeated context-resume calls and network waits; arpeggios intentionally follow their selected grid. Browser/device output estimates appear above the instruments. Bluetooth still adds output buffering the web app cannot remove; use the phone speaker or wired audio for responsive finger drumming.

**Desktop shortcuts:** Space toggles transport; Escape restores Focus/full-screen controls first, otherwise stops locally; 1–4, Q–R, A–F, Z–V trigger pads. In Instruments, A–K play the keyboard. Multitouch is supported on pads, drums, and keys.

## Jam with multiple phones

1. Open the same deployed HTTPS URL on each phone. Pick **Jam together → Create a room** on the leader.
2. Scan its QR code with the other phones' cameras, or paste its link / six-character room code. Tap **Join** to authorize audio playback.
3. The leader controls tempo, meter, sound pack, and transport. All phones can trigger pads, play instruments, edit the drum pattern, and contribute audio clips. Room members receive shared audio. Room codes are invitation secrets, not authentication; share with people you want in the jam.
4. Every peer runs audio locally. Reliable WebRTC data channels carry musical events, the clock, state, and sample chunks in a star topology through the leader. Live touches preview immediately on the source phone and use a configurable **120 ms** default buffer on other phones. This supports beat-synced jamming, not zero-delay remote monitoring.
5. Clock probes estimate leader offset using the median of the five lowest round-trip samples. Loop launches use the shared musical position and precise AudioContext scheduling. **Listen & align** on a follower records three 1800 Hz leader tones, checks spacing, estimates speaker phase from arrival timing, and applies input/output latency estimates. This is approximate; tune Speaker alignment by ear for your hardware. It needs a quiet environment and an audible leader speaker.
6. If a connection drops, peers try to reconnect every two seconds. The leader sends a fresh session snapshot and sample files to rejoining peers. On page reload, choose **Rejoin previous room**; an audio gesture is required. The leader must return to the same room. There is no automatic leader election.

The default public [PeerJS Cloud](https://peerjs.com/client/faq) performs signaling; established data uses WebRTC. Some carriers, corporate networks, VPNs, or symmetric NATs require TURN. Connection settings support a custom HTTPS PeerServer and TURN URL/credentials. TURN credentials remain in page memory. Do not embed permanent relay secrets in a public repository.

Keep all pages in the foreground. Screen Wake Lock is requested while playing when supported. Background throttling, Bluetooth, device input latency, network jitter, and physical distance prevent perfect synchronization on arbitrary phones. Reconnect and acoustic calibration need testing on your actual devices and network.

If the operating system interrupts audio, Mobipad offers **Resume audio** and rebuilds loops at the current shared phase when playback returns. An interrupted take is cancelled rather than saving an incomplete recording. Stop clears pending launches, stale tempo changes and delay feedback. Processing failures/timeouts reset the worker so a later attempt can recover.

Stop silences playback immediately while any microphone flush finishes in the background. Cancelled takes and Auto synth analysis cannot commit after Stop. Instrument keys and chord pads track fingers independently, including releases during audio unlock. Count-in clicks end at the first recording beat unless the metronome is enabled. The keep-awake switch releases the screen lock immediately when disabled; late requests are released after Stop. Jam snapshots and edits apply in connection order, and callbacks from a retired room cannot change the current room.

## Publish on GitHub Pages

The deployment target is [nomsams.github.io/mobipad](https://nomsams.github.io/mobipad/). Push to `nomsams/mobipad` on `main` or `master`, then in **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**. The included [Pages workflow](.github/workflows/pages.yml) validates, tests, and uploads only static runtime files. Relative asset paths support a repository subpath.

Alternatively, serve the repository root from a Pages branch: it has `index.html` and `.nojekyll`. No npm install is needed in production.

```sh
git remote add origin https://github.com/nomsams/mobipad.git
git push -u origin main
```

The deployment workflow accepts `main` and `master`.

Commit with a GitHub noreply identity; do not use a personal email address. Local project recordings, environment files, and credentials must not be committed.

## Checks and dependencies

```sh
npm run check
npm test
```

Tests cover timeline math, launch boundaries, quantization, clock estimation, WAV encoding, preset validation, odd meters, microphone trimming, muted scheduling, command deduplication, and transfer limits. Browser/device checks: [QA.md](QA.md).

PeerJS 1.5.5 and QRCode 1.5.4 are pinned and vendored with MIT licenses. SoundTouchJS core 2.1.1 is vendored under MPL-2.0 with its license. Its unmodified upstream source is available from [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) and the pinned npm package. Development-only esbuild bundles QRCode and the SoundTouch stretch stage. Rebuild with:

```sh
npm ci
npm run vendor
```

## Implementation

- `js/engine.js`: shared audio graph, synthesized instruments, 20 ms scheduler with 90 ms look-ahead, sample playback, microphone capture and WAV encoding.
- `js/capture-worklet.js`: timestamped mono render-thread capture. No ScriptProcessor fallback.
- `js/jam.js`: PeerJS, bounded transfers, clock probes, reconnect and state events.
- `js/app.js`: touch UI, recording, library, projects, room coordination and acoustic calibration.
- `js/storage.js`: IndexedDB and portable projects.
- `js/timing.js` and `js/presets.js`: pure timing, validation and preset data.

Research and design decisions: [RESEARCH.md](RESEARCH.md).
