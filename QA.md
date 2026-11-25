# Validation record

## Automated checks

`npm run check` verifies JavaScript syntax and runtime assets. All 46 tests pass, covering timing, presets, worklet capture, audio scheduling, peer packet handling, recording compensation, circular grid alignment, arpeggios, project migration, click/erase behavior, key/BPM detection, stereo time stretching, pitch retention, and 44.1/48 kHz buffering. `node scripts/privacy-check.mjs` checks public files for configured or previous private author emails, local home paths, and GitHub token patterns without displaying those values.

## Browser checks completed

Tested in the desktop app's Chromium-based browser on November 25, 2026:

- App boots, renders the dark studio and 16 pads, and initializes Web Audio on interaction.
- Drum and piano loops layer, show playing states, and appear in the mixer.
- Metronome toggles, transport starts and stops, Instruments and Sequencer views open.
- Instrument capture records piano touches, creates a new loop pad, and automatically launches it.
- Sequencer enabled and individual steps edited.
- Public PeerJS signaling creates a six-character room and renders an invite QR.
- Second browser tab joins, receives a snapshot, and reports measured clock offset / round trip.
- Follower tempo/meter controls are disabled.
- A follower launch produces the same active loop on both peers, verified through both pads' pressed states.
- No browser error/warning entries were reported during those checks.
- Responsive layout reached the mobile breakpoint without overlapping transport controls in the observed preview. Exact 390/360/320px checks remain below.

The initial browser session later timed out. The expanded version was subsequently checked in a fresh browser session, as recorded below. Physical microphone/hardware latency still requires real-device testing.

## Instruments and synthesis update

- Guitar fretboard, standard tuning, preset selection and open-string strumming checked in the browser.
- Latched synth arpeggio captured into a new pad and played as a loop.
- All 57 sound/preset combinations rendered finite, non-silent output in an OfflineAudioContext.
- Production AudioWorklet captured a generated 440 Hz signal, trimmed an exact 400 ms take and round-tripped it through WAV without opening the physical microphone.

## Recording and pad editing update

- Next-beat capture and signed onset-grid correction covered with PCM fixtures and timing tests.
- Original sample rotation preserves exact loop duration and source data.
- Sample waveform editor loads decoded audio after refresh; trim, predelay and quick volume were exercised in the browser.
- Quick clear removes the selected sample pad and its sequencer lane while retaining the source in the library.

## Sequencer editing update

- Browser verified left click sets a hit and right click clears it.
- Desktop context menu suppression and phone Erase mode covered by event tests.
- Imported samples appear as editable step-trigger lanes with trim/delay controls.

## BPM, key and pitch preservation update

- Fixture tests detect 120 BPM with a 60 BPM alternative, identify C major, and leave silence or one unchanging pitch without an invented key.
- WSOLA keeps the 440 Hz spectral fundamental when shortening/lengthening a clip; stereo separation and real-device sample rates are tested.
- Browser detected 120 BPM in an imported sample and the Use this tempo flow changed the session from 110 to 120.
- A generated C-major/120 BPM sample was automatically labeled C major and 120 BPM on import. Browser-worker time stretching retained the 440 Hz fundamental in the capture integration test.
- Extreme stretches may produce audible artifacts. BPM/key ambiguity and hardware recording latency are not eliminated by these tests.

## Mobile layout update

- Embedded the production UI in 390, 360 and 320 CSS-pixel phone frames.
- Guitar, strumming and arpeggiator controls were visually inspected. A narrow transport overflow was fixed; at the final 320/360 frame sizes, document scroll width equals its client width.

## Reproducible browser integration checks

Run `npm start`, then open:

- `/tests/audio-preview.html`: click **Run browser audio checks**. Renders all synthesized voices offline, feeds a generated oscillator through the production capture AudioWorklet, verifies exact clip length and WAV decode, and schedules a tempo-fitted sample silently. It never opens the physical microphone.
- `/tests/mobile-preview.html`: embeds the actual app at 390px, with 360px and 320px toggles. Verify no horizontal page scrolling, usable controls, pad visibility, dialogs and keys. Sequencer horizontal scrolling is intentional.

These harness files are excluded from the production Pages artifact.

## Real-device acceptance checklist

The following remain to be tested on actual phones; they are not claimed as verified:

- Safari on iPhone and Chrome on Android: multitouch, audio unlock, permissions, microphone capture, input compensation, uploads, MediaRecorder format, wake lock, and install/offline behavior.
- Three or more phones over the same Wi-Fi, then separate networks: loop starts, tempo/meter changes, sample transfer, guest notes, clock drift and screen sleep recovery.
- Disconnect a follower briefly and verify auto-rejoin restores state and audio. Refresh a follower and use Rejoin; refresh the leader and reclaim the same room.
- TURN-backed connection through restrictive NAT.
- Microphone-assisted alignment with three leader tones in a quiet room; check against manual speaker alignment.
- Very slow sample transfers, permission denial, unavailable signaling, full IndexedDB/quota denial and malformed project imports.
- GitHub Pages deployment and a repository-subpath URL, including HTTPS recording and invite URLs.

Deployment target: `nomsams/mobipad`, with site URL `https://nomsams.github.io/mobipad/`. New commits use a GitHub noreply identity. Existing repository history is preserved.

## Stage, Eco and Auto synth update

- Automated tests cover device detection (including desktop-identifying iPads with a connected mouse), layout/resource overrides, byte-based LRU caches, protected sample loops, DSP timeout recovery, interrupted audio, bounded microphone shutdown, storage denial, signaling failure, and stale instrument presses.
- Exact CSS viewport checks at 320 × 568, 390 × 844, 768 × 1024 and 1024 × 768 show all 16 pads above the dock/navigation and no horizontal document overflow. Tablet geometry was checked in Stage; iPad identification is covered by unit fixtures rather than a physical iPad.
- Browser UI checks covered compact navigation, Settings timing/project access, Studio/Stage control restoration, Eco/Full switching, sequencer left-add/right-remove, note capture back to a pad, generated-melody import, Auto synth key review, preview, synth-pad creation and editable persistent effects. Changing effects retains the playing loop.
- The audio harness renders all 58 sounds, captures a generated signal through the worklet, verifies exact WAV length and pitch-preserving stretching, and resumes a sample after suspend/resume. It also recovers four deliberately detuned melody notes in the background worker, tunes against a selected key, exercises automatic take conversion with default pure tone/natural rhythm, and renders a native stereo hall reverb tail.
- Auto synth is monophonic and intentionally rejects silence/noise; transcription and key estimates need listening checks on real sung vocals. Real-device microphone latency, iOS interruption behavior, multitouch and multi-phone acoustics remain hardware acceptance items.

## Smart performance and timing update

- Catch recovers original note presets/timbres, optional triplet timing, bar alignment, sustained-note clipping and bounded history. UI testing recovered a three-note piano idea into a playing pad without arming recording.
- Scenes validate, persist, adapt drum rows to meter, prepare sample caches, and switch loops and patterns together at one audio boundary. Tests cover Stop cancellation and a slow older request losing to the latest scene tap. Browser checks saved two combinations and recalled the single-loop scene on the next bar.
- Smart grooves cover all supported meters/styles, seeded reproducibility, row locks and zero density. Browser checks preserved the locked kick row and restored the previous variation with Undo.
- Warm instrument presses execute the sound scheduling path synchronously, bypassing sample loading/resume/network waits. In this desktop browser, repeated production pointer-handler presses scheduled in roughly 1–3 ms, with a 3 ms audio lead. A cold first press took about 49 ms; these measurements exclude audio output hardware/Bluetooth delay.
- `/tests/timing-preview.html` captures generated sequencer output through the production worklet: eight quarter-note kicks at 120 BPM / swing 0 with 35 ms main-thread stalls every 170 ms. At 48 kHz the measured worst interval error was 0.000 ms (rounded to three decimals). It does not request a physical microphone. Separate tests cover a single first-step kick per bar, monotonic audio anchoring, and gradual shared-clock corrections.
- The browser audio suite still covers all 58 sounds, exact WAV capture, pitch-preserving stretching, audio interruption recovery, Auto synth and reverb. Bluetooth hardware, physical phone latency and multi-phone room acceptance remain real-device checks.

## Landscape, Focus and instrument preparation

- All 80 automated tests pass, including geometry selection and bounded silent warm-up that cannot steal live voices. JavaScript and entry-point asset checks pass.
- Browser viewport checks: 844×390 selects 8×2 pads in a 668×266 grid; 667×320 selects 8×2; 568×320 selects 4×4 in a 392×196 grid; 1024×768 selects 4×4 in an 848×644 grid. All retain 16 pads and show no horizontal document overflow. Rotation retains a playing pad.
- At 320×568, portrait Stage fits a 304×321 grid; Focus expands it to 312×516 with a separate 44 px bottom control strip and no page overflow. At 844×390, Focus expands the pad grid to 792×382 beside its left control strip.
- Native full-screen entry/exit succeeded in the desktop browser; Focus mode, loop/one-shot switching, Play/Stop and restore controls work. Escape restores controls without stopping a playing loop. Browser-specific iPhone/iPad full screen and Home Screen behavior still need physical-device checks.
- The updated audio suite passes in both Eco and Full, including an actual offline render proving that preparation produces exact silence and uses separate source tracking.
- With preparation enabled, the first measured kick press scheduled in 2.40 ms with a 3 ms audio lead. Under 35 ms UI stalls every 170 ms, eight generated quarter-note kicks at 120 BPM / swing 0 had a worst spacing error of 0.104 ms at 48 kHz. These are desktop browser measurements, not physical output or Bluetooth latency.
