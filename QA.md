# Validation record

## Automated checks

`npm run check` verifies JavaScript syntax and runtime assets. All 22 tests pass, covering timing, presets, worklet capture, audio scheduling, peer packet handling and recording compensation. `node scripts/privacy-check.mjs` checks public files for configured or previous private author emails, local home paths, and GitHub token patterns without displaying those values.

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

The browser automation service subsequently timed out repeatedly. Final viewport, generated-audio and microphone checks could not be completed through it. Code fixes after these browser checks are covered by the command-line suite; they have not all been rechecked in the browser.

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
