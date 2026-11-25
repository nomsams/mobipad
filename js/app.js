import { analyzeBuffer, setDSPResourceMode } from "./dsp-client.js";
import {Presentation} from './presentation.js';
import {ScreenWakeLock} from './wake-lock.js';
import {prepareProjectImport} from './project-import.js';
import {resourceProfiles} from './device.js';
import {AutoSynth} from './auto-synth.js';
import {PerformanceTools} from './performance-tools.js';
import {validPattern,normalizeScenes} from './performance.js';
import { bindStepEditing } from "./sequence-input.js";
import { AudioEngine } from "./engine.js";
import { defaultSession, validateSession, makePads, packs, padKeys, drums, drumNames, pattern, resizePattern, colors } from "./presets.js";
import { clamp, nextBoundary, quantizeBeat, beatDuration } from "./timing.js";
import { loadSession, saveSession, getSamples, saveSample, saveProject, deleteSample, download, exportProject } from "./storage.js";
import { JamRoom } from "./jam.js";
import { InstrumentRack } from "./instrument-rack.js";
import { soundBank, drumKits, validSound, validTone } from "./sounds.js";
import { analyzeRecording, trimSilence, planRecording, validSampleSettings } from "./sample-analysis.js";
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
let seqErase = false;
let tempoTimer = null, tempoPreparing = false;
let operationVersion=0, startingRecording=null, warmTimer=null, warmIdle=false,padEditorRequest=0,projectImporting=false,importCommitting=false;
let session = defaultSession(), samples = [], view = "pads", mode = "loop", instrument = "piano", octave = 4, selected = 12, saveTimer, toastTimer, restoring = false, recording = null, mixRecorder = null, writing = false;
const screenWake=new ScreenWakeLock(()=>navigator.wakeLock.request('screen'));
const audio = new AudioEngine(session), jam = new JamRoom();
const rack = new InstrumentRack({ audio, getSession: () => session, ready:readyInstrument, perform: performNote, changed, notify: toast, onVoice: (v) => {instrument=v;queueInstrumentWarm();}, changeSound: (voice, id) => sendAction({ type: "sound", voice, id }), changeKit: (id) => sendAction({ type: "kit", id }), startTransport: () => {
  if (jam.role === "follower") throw new Error("The leader needs to start the transport for the arpeggiator.");
  sendAction({ type: "start", epoch: audio.now() + 180 });
} });
const presentation = new Presentation({onResources:mode=>{audio.setResourceMode(mode);setDSPResourceMode(mode);},onPads:()=>switchView('pads'),onStudio:()=>{if(view==='mixer')switchView('pads');},notify:toast});
const autoSynth=new AutoSynth({audio,getSession:()=>session,ready,notify:toast,commit:async({source,events,config,replace})=>{
  const original=session.pads[source.id],id=replace?source.id:emptyPad();
  const pad={...session.pads[id],kind:'loop',name:(original.name+' · synth').slice(0,80),audioId:null,events,bars:original.bars,volume:.75,trimStart:undefined,trimEnd:undefined,alignment:undefined,trackAnalysis:undefined,sequenceEnabled:false,steps:[],preDelay:0,reverb:config.reverb,reverbSpace:config.reverbSpace,echo:config.echo,echoTime:config.echoTime};
  sendAction({type:'setpad',pad});selected=id;renderQuickPad();
  if(audio.running){const beat=source.startBeat!==null&&source.startBeat>=audio.position()-120?source.startBeat:nextBoundary(audio.position(),session.beats);sendAction({type:'pad',id,beat,on:true,catchUp:true});}
  switchView('pads');
}});
const sampleLoads = new Map();
const performanceTools=new PerformanceTools({audio,getSession:()=>session,getRole:()=>jam.role,ready,send:sendAction,notify:toast,commitCapture:async take=>{
  const version=operationVersion;await readyInstrument();if(version!==operationVersion)throw new Error('Catch cancelled because the transport changed.');
  const id=emptyPad();sendAction({type:'setpad',pad:{...session.pads[id],kind:'loop',name:'Caught idea',audioId:null,events:take.events,bars:take.bars,volume:.75}});selected=id;renderQuickPad();
  if(!audio.running&&jam.role!=='follower')sendAction({type:'start',epoch:audio.now()+250});
  if(audio.running){const originalBeat=take.epoch===audio.epoch?(take.start-audio.epoch)/1000/beatDuration(session.bpm):null;const beat=originalBeat!==null&&originalBeat>=audio.position()-120?originalBeat:nextBoundary(audio.position()+.16/beatDuration(session.bpm),session.beats);sendAction({type:'pad',id,beat,on:true,catchUp:true});}
  switchView('pads');
}});
async function ensureSample(id) {
  if (!id || audio.buffers.has(id)) return;
  if (!sampleLoads.has(id)) {
    const sample = samples.find(s=>s.id===id);
    if (!sample) return; // A shared sample may still be arriving over the room connection.
    sampleLoads.set(id, sample.blob.arrayBuffer().then(data=>audio.decode(id,data)).finally(()=>sampleLoads.delete(id)));
  }
  await sampleLoads.get(id);
}
async function prepareSamples(id) {
  const ids=new Set([...session.pads.filter(p=>audio.active.has(p.id)||audio.pending.get(p.id)?.on||session.seqEnabled&&p.sequenceEnabled).map(p=>p.audioId),id]);
  for(const sampleId of ids)await ensureSample(sampleId);
}
const palette = { coral: "#eea08b", lime: "#caee91", teal: "#88c8be", purple: "#b3a1d6" };
function toast(message, error = false) {
  $("#toast").textContent = message;
  $("#toast").classList.toggle("error", error);
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").hidden = true, error ? 6500 : 3500);
}
function attempt(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(e);
      toast(e.message || "Something went wrong.", true);
    }
  };
}
function bind(id, event, fn) {
  $(id).addEventListener(event, attempt(fn));
}
function changed() {
  if (restoring) return;
  $("#save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveSession(session);
      $("#save-status").textContent = "Saved on this device";
    } catch {
      $("#save-status").textContent = "Storage unavailable — export a backup";
      toast("Could not save locally. Export your project to keep it.", true);
    }
  }, 350);
}
async function ready(sampleId) {
  await audio.init();
  await prepareSamples(sampleId);
  updateAudioInfo();
}
function queueInstrumentWarm(){
  if(warmTimer!==null){if(warmIdle)cancelIdleCallback(warmTimer);else clearTimeout(warmTimer);}
  const run=()=>{warmTimer=null;if(view==='instruments'&&!document.hidden&&audio.ctx?.state==='running')audio.warmVoice(instrument);};
  warmIdle=typeof requestIdleCallback==='function';warmTimer=warmIdle?requestIdleCallback(run,{timeout:300}):setTimeout(run,16);
}
async function readyInstrument(){
  if(audio.ctx?.state!=='running'){await audio.init();updateAudioInfo();}
  queueInstrumentWarm();
}
function updateAudioInfo(){
  $("#audio-status").textContent = `Audio ready · ${Math.round((audio.ctx.outputLatency || audio.ctx.baseLatency || 0) * 1e3)} ms output`;
  $("#latency-info").textContent = `Sample rate: ${audio.ctx.sampleRate.toLocaleString()} Hz. Base latency: ${Math.round((audio.ctx.baseLatency || 0) * 1e3)} ms. Output estimate: ${Math.round((audio.ctx.outputLatency || 0) * 1e3)} ms. Hardware and Bluetooth can add more delay.`;
  $('#live-latency').textContent=audio.ctx.outputLatency>0?`Reported audio output: about ${Math.round(((audio.ctx.baseLatency||0)+audio.ctx.outputLatency)*1000)} ms. Device buffering may add more.`:`Browser buffer: ${Math.round((audio.ctx.baseLatency||0)*1000)} ms. Extra device delay is not reported.`;
}
function switchView(name) {
  if(name!=='pads'&&presentation.focused)presentation.setFocus(false);
  if (view === "instruments" && name !== view) rack.releaseAll();
  view = name;
  document.body.dataset.view=name;
  if(name==='instruments')attempt(readyInstrument)();
  $$(".view").forEach((e) => e.hidden = e.id !== "view-" + name);
  $$(".view-tabs [data-view]").forEach((e) => e.classList.toggle("active", e.dataset.view === name));
}
$$(".view-tabs [data-view]").forEach((e) => e.onclick = () => switchView(e.dataset.view));
function make(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== void 0) e.textContent = text;
  return e;
}
function renderPads() {
  const grid = $("#pad-grid");
  grid.replaceChildren();
  session.pads.forEach((p, i) => {
    const b = make("button", "pad" + (p.kind === "empty" ? " empty" : ""));
    b.dataset.id = i;
    b.dataset.color = p.color;
    b.setAttribute("aria-label", p.name + ", pad " + (i + 1));
    b.setAttribute("aria-pressed", String(audio.active.has(i)));
    const top = make("span", "pad-top");
    top.append(make("span", "", p.kind === "empty" ? "+" : p.kind === "shot" ? "ϟ" : "↻"), make("span", "pad-key", padKeys[i].toUpperCase()));
    b.append(top);
    if (p.kind !== "empty") {
      const wave = make("div", "waveform");
      for (let n = 0; n < 26; n++) {
        const bar = make("i");
        bar.style.setProperty("--h", 3 + (n * 13 + i * 7) % 19 + "px");
        wave.append(bar);
      }
      b.append(wave);
    }
    const bottom = make("span", "");
    bottom.append(make("span", "pad-name", p.name));
    if (p.kind !== "empty") {
      const sub = make("span", "pad-bottom");
      sub.append(make("span", "", p.kind === "shot" ? "ONE SHOT" : `${p.bars} BARS`), make("span", "pad-state", "▷"));
      bottom.append(sub);
    }
    b.append(bottom);
    let down = 0;
    b.addEventListener("pointerdown", attempt(async (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      down = Date.now();
      selected = i;
      renderQuickPad();
      if (p.kind === "empty") {
        openPad(i);
        return;
      }
      await triggerPad(i);
      b.classList.add("flash");
      setTimeout(() => b.classList.remove("flash"), 110);
    }));
    b.addEventListener("pointerup", () => {
      if (Date.now() - down > 550 && p.kind !== "empty") openPad(i);
    });
    b.addEventListener("dblclick", (e) => {
      e.preventDefault();
      openPad(i);
    });
    b.addEventListener("keydown", attempt(async (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if(e.repeat)return;
        selected = i;
        p.kind === "empty" ? openPad(i) : await triggerPad(i);
      }
    }));
    grid.append(b);
  });
  renderPadStates();
}
function renderPadStates() {
  renderQuickPad();
  for (const b of $$(".pad")) {
    const id = Number(b.dataset.id);
    b.classList.toggle("is-playing", audio.active.has(id));
    b.classList.toggle("is-queued", audio.pending.has(id));
    b.setAttribute("aria-pressed", String(audio.active.has(id)));
    const state = b.querySelector(".pad-state");
    if (state) state.textContent = audio.pending.has(id) ? "◷" : audio.active.has(id) ? "Ⅱ" : "▷";
  }
  renderMixer();
  const kickLayers=[...audio.active.keys()].filter(id=>session.pads[id].events.some(e=>e.voice==='kick'));
  $('#seq-kick-layers').hidden=!kickLayers.length;
  $('#seq-kick-layer-names').textContent=kickLayers.map(id=>session.pads[id].name).join(', ');
}
function renderMixer() {
  const container = $("#mixer");
  const playing = [.../* @__PURE__ */ new Set([...audio.active.keys(), ...audio.pending.keys()])];
  $("#active-count").textContent = audio.active.size + " PLAYING";
  $("#empty-mix").hidden = playing.length > 0;
  const ids = playing.join(",");
  if (container.dataset.ids === ids) {
    return;
  }
  container.dataset.ids = ids;
  container.replaceChildren();
  for (const id of playing) {
    const p = session.pads[id];
    if (!p) continue;
    const row = make("div", "mix-track"), color = make("i", "track-color"), info = make("div"), name = make("strong", "", p.name), slider = make("input");
    color.style.background = palette[p.color];
    slider.type = "range";
    slider.min = 0;
    slider.max = 100;
    slider.value = p.volume * 100;
    slider.setAttribute("aria-label", p.name + " volume");
    slider.dataset.padId = id;
    slider.oninput = () => {
      p.volume = Number(slider.value) / 100;
      audio.setPadVolume(id, p.volume);
      changed();
    };
    info.append(name, slider);
    const mute = make("button", audio.muted.has(id) ? "muted" : "", "M");
    mute.setAttribute("aria-label", "Mute " + p.name);
    mute.setAttribute("aria-pressed", String(audio.muted.has(id)));
    mute.onclick = () => {
      audio.muted.has(id) ? audio.muted.delete(id) : audio.muted.add(id);
      if (audio.muted.has(id)) audio.cancelPad(id);
      mute.classList.toggle("muted", audio.muted.has(id));
      mute.setAttribute("aria-pressed", String(audio.muted.has(id)));
    };
    row.append(color, info, mute);
    container.append(row);
  }
}
function renderTiming() {
  $("#bpm").value = session.bpm;
  $("#beats").value = session.beats;
  $("#bars").value = session.bars;
  $("#master-volume").value = session.master * 100;
  $("#volume-value").value = Math.round(session.master * 100) + "%";
  $("#input-latency").value = session.inputLatency;
  $("#output-offset").value = session.outputOffset;
  $("#jam-buffer").value = session.jamBuffer;
  $("#swing").value = session.swing;
  $("#swing-value").value = session.swing + "%";
  $("#seq-enabled").checked = session.seqEnabled;
  $("#project-name").value = session.name;
  $("#project-btn").firstChild.textContent = session.name + " ";
  $("#beat-lights").replaceChildren(...Array.from({ length: session.beats }, () => make("i")));
  for (const id of ["#bpm", "#beats", "#bars", "#tap-btn"]) $(id).disabled = jam.role === "follower";
}
function renderSequencer() {
  const c = $("#sequencer");
  c.replaceChildren();
  c.style.setProperty("--steps", session.beats * 4);
  const numbers = make("div", "seq-row");
  numbers.append(make("span"));
  for (let i = 0; i < session.beats * 4; i++) numbers.append(make("div", "seq-numbers", i % 4 === 0 ? String(i / 4 + 1) : "·"));
  c.append(numbers);
  for (const voice of ["kick", "snare", "hat", "clap"]) {
    const row = make("div", "seq-row");
    row.append(make("span", "", drumNames[voice]));
    session.pattern[voice].forEach((on, i) => {
      const b = make("button", "seq-step" + (on ? " on" : ""));
      b.setAttribute("aria-label", `${drumNames[voice]}, step ${i + 1}`);
      b.setAttribute("aria-pressed", String(on));
      b.dataset.step = i;
      bindStepEditing(b, (on2) => sendAction({ type: "step", voice, index: i, on: on2 }), () => seqErase);
      row.append(b);
    });
    c.append(row);
  }
  renderSampleSequencer();
}
function renderLibrary() {
  const c = $("#preset-library");
  c.replaceChildren();
  for (const p of packs) {
    const b = make("button", "preset-card");
    b.append(make("span", "preset-art", p.art), make("strong", "", p.name), make("small", "", `${p.bpm} BPM · ${p.key}`), make("small", "", p.description));
    b.onclick = attempt(async () => {
      if (jam.role === "follower") throw new Error("Ask the room leader to change the sound pack.");
      await ready();
      if (recording) throw new Error("Finish your recording first.");
      sendAction({ type: "pack", id: p.id });
      toast(p.name + " loaded. Your samples are still in the library.");
    });
    c.append(b);
  }
  const sc = $("#sample-library");
  sc.replaceChildren();
  if (!samples.length) sc.append(make("p", "muted", "Nothing here yet. Bring a sound from your world."));
  for (const s of samples) {
    const row = make("div", "sample-item"), name = make("span", "", s.name), info = make("small", "", s.duration.toFixed(1) + " s"), assign = make("button", "", "Add to pad"), del = make("button", "", "×");
    assign.onclick = attempt(async () => {
      await ready(s.id);
      selected = emptyPad();
      await assignSample(s, selected);
      toast("Added to pad " + (selected + 1));
      switchView("pads");
    });
    del.setAttribute("aria-label", "Delete " + s.name);
    del.onclick = attempt(async () => {
      if (session.pads.some((p) => p.audioId === s.id)) throw new Error("Clear the pads using this sample before deleting it.");
      await deleteSample(s.id);
      samples = samples.filter((x) => x.id !== s.id);
      audio.buffers.delete(s.id);
      renderLibrary();
    });
    const detected = make("button", "", s.analysis?.bpm ? Math.round(s.analysis.bpm) + " BPM" : "Analyze");
    detected.onclick = attempt(() => openTempoSuggestion(s.id));
    if (s.analysis?.key && s.analysis.keyConfidence > 0.15) info.textContent += " · " + s.analysis.key;
    row.append(name, info, detected, assign, del);
    sc.append(row);
  }
}
function emptyPad() {
  const index = session.pads.findIndex((p) => p.kind === "empty");
  if (index < 0) throw new Error("All pads are full. Clear or select a pad first.");
  return index;
}
function renderKeyboard() {
  rack.renderKeyboard();
}
function renderDrums() {
  rack.renderDrums();
}
function renderAll() {
  audio.session = session;
  for (const p of session.pads) audio.setPadVolume(p.id, p.volume);
  if (audio.master) audio.master.gain.setTargetAtTime(session.master, audio.ctx.currentTime, 0.01);
  renderTiming();
  renderPads();
  renderSequencer();
  renderLibrary();
  rack.render();
  $("#mixer").dataset.ids = "";
  renderMixer();
  performanceTools.refresh();
}
function renderQuickPad() {
  for (const input of $$("#mixer input[data-pad-id]")) if (input !== document.activeElement) input.value = session.pads[Number(input.dataset.padId)].volume * 100;
  const p = session.pads[selected];
  if (!p) return;
  $("#selected-pad-name").textContent = `Pad ${selected + 1} · ${p.name}`;
  $("#quick-pad-volume").value = Math.round(p.volume * 100);
  $("#quick-pad-clear").disabled = p.kind === "empty";
  const detected = samples.find((s) => s.id === p.audioId)?.analysis || p.trackAnalysis;
  $("#quick-sample-bpm").hidden = !p.audioId;
  $("#quick-sample-bpm").textContent = detected?.bpm ? Math.round(detected.bpm) + " BPM" : "Analyze BPM";
  for (const b of $$(".pad")) b.classList.toggle("selected", Number(b.dataset.id) === selected);
}
function clearSelectedPad() {
  sendAction({ type: "setpad", pad: { id: selected, name: "Add a sound", color: colors[selected % 4], events: [], audioId: null, volume: 0.75, bars: session.bars, kind: "empty" } });
}
bind("#quick-pad-volume", "input", () => {
  const volume = Number($("#quick-pad-volume").value) / 100;
  session.pads[selected].volume = volume;
  audio.setPadVolume(selected, volume);
  changed();
});
bind("#quick-pad-volume", "change", () => sendAction({ type: "padlevel", id: selected, volume: Number($("#quick-pad-volume").value) / 100 }));
bind("#quick-sample-bpm", "click", () => openTempoSuggestion(session.pads[selected].audioId));
bind("#quick-pad-edit", "click", () => openPad(selected));
bind("#quick-pad-clear", "click", clearSelectedPad);
function renderDetection(p) {
  const sample = samples.find((s) => s.id === p.audioId), a = sample?.analysis || p.trackAnalysis;
  $("#sample-bpm").textContent = a?.bpm ? `${Math.round(a.bpm)} BPM · ${a.bpmConfidence < 0.35 ? "tentative" : "detected"}` : "Analyze BPM & key";
  $("#sample-key").textContent = a?.key && a.keyConfidence > 0.15 ? `${a.key} · ${Math.round(a.keyConfidence * 100)}%` : "KEY · UNCERTAIN";
}
async function openTempoSuggestion(audioId) {
  if (jam.role === "follower") throw new Error("The room leader controls the session tempo.");
  const sample = samples.find((s) => s.id === audioId);
  if (!sample) throw new Error("No sample selected.");
  await ready(audioId);
  if (!sample.analysis) {
    toast("Analyzing BPM and key…");
    sample.analysis = await analyzeBuffer(audio.buffers.get(audioId));
    await saveSample(sample);
    renderLibrary();
  }
  const a = sample.analysis;
  $("#tempo-suggestion").textContent = `${sample.name}: ${a.bpm ? Math.round(a.bpm) + " BPM estimated" : "no stable BPM detected"}${a.key && a.keyConfidence > 0.15 ? " · " + a.key : " · key uncertain"}. Current session: ${session.bpm} BPM. Half-time and double-time interpretations are common; choose what fits.`;
  $("#suggested-bpm").value = a.bpm || session.bpm;
  const choices = $("#bpm-candidates");
  choices.replaceChildren();
  for (const candidate of a.candidates || []) {
    const button = make("button", "button subtle", candidate.bpm + " BPM");
    button.onclick = () => $("#suggested-bpm").value = candidate.bpm;
    choices.append(button);
  }
  $("#tempo-dialog").showModal();
}
bind("#sample-bpm", "click", () => openTempoSuggestion(session.pads[selected].audioId));
bind("#apply-sample-tempo", "click", async () => {
  $("#bpm").value = clamp($("#suggested-bpm").value, 40, 240);
  toast("Preparing loops. Original pitch stays locked.");
  await changeTiming();
  $("#tempo-dialog").close();
});
function openSampleEditor(p) {
  const buffer = audio.buffers.get(p.audioId);
  $("#sample-editor").hidden = !p.audioId;
  renderDetection(p);
  $('#sample-echo').value=(p.echo||0)*100;$('#sample-echo-time').value=(p.echoTime||.25)*1000;$('#sample-reverb').value=(p.reverb||0)*100;$('#sample-space').value=p.reverbSpace||'room';
  if (!p.audioId) return;
  $("#sample-trim-start").value = (p.trimStart || 0).toFixed(3);
  $("#sample-trim-end").value = (p.trimEnd || buffer?.duration || 0).toFixed(3);
  $("#sample-predelay").value = p.preDelay || 0;
  $("#sample-echo").value = (p.echo || 0) * 100;
  $("#sample-echo-time").value = (p.echoTime || 0.25) * 1e3;
  $('#sample-reverb').value=(p.reverb||0)*100;
  $('#sample-space').value=p.reverbSpace||'room';
  $("#sample-nudge").value = p.alignment?.manual || 0;
  $("#sample-smart-align").checked = Boolean(p.alignment?.enabled);
  const a = p.alignment;
  $("#alignment-report").textContent = a?.onsets?.length ? `${a.onsets.length} attacks detected · ${Math.round(a.confidence * 100)}% grid consistency. ${a.shift ? `${a.shift > 0 ? "Advance" : "Delay"} ${Math.abs(a.shift)} ms to align.` : a.reason || "No automatic shift needed."} Positive manual nudge delays playback.` : "No timing analysis for this sound. Manual nudge shifts the loop; positive values play later.";
  drawSampleWaveform();
}
function readPadEffects(){
  const effects={echo:Number($('#sample-echo').value)/100,echoTime:Number($('#sample-echo-time').value)/1000,reverb:Number($('#sample-reverb').value)/100,reverbSpace:$('#sample-space').value};
  if(!validSampleSettings(effects))throw new Error('Choose effect settings within the displayed limits.');return effects;
}
function readSampleEditor() {
  const p = session.pads[selected], buffer = audio.buffers.get(p.audioId), end = Number($("#sample-trim-end").value);
  const edit = { trimStart: Number($("#sample-trim-start").value), trimEnd: end, preDelay: Number($("#sample-predelay").value), echo: Number($("#sample-echo").value) / 100, echoTime: Number($("#sample-echo-time").value) / 1e3, alignment: { ...p.alignment || { shift: 0, confidence: 0 }, enabled: $("#sample-smart-align").checked, manual: Number($("#sample-nudge").value) } };
  edit.reverb=Number($('#sample-reverb').value)/100;edit.reverbSpace=$('#sample-space').value;
  if (!validSampleSettings(edit) || !buffer || end > buffer.duration + 2e-3 || end - edit.trimStart < 0.015) throw new Error("Choose a valid audio region of at least 15 ms and timing values within the displayed limits.");
  return edit;
}
function drawSampleWaveform() {
  const p = session.pads[selected], buffer = audio.buffers.get(p.audioId), canvas = $("#sample-waveform"), ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!buffer) return;
  const data = buffer.getChannelData(0), w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#88c8be";
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x / w * data.length), end = Math.max(start + 1, Math.floor((x + 1) / w * data.length));
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
    ctx.fillRect(x, h / 2 - peak * h * 0.45, 1, Math.max(1, peak * h * 0.9));
  }
  const trimStart = Number($("#sample-trim-start").value) || 0, trimEnd = Number($("#sample-trim-end").value) || buffer.duration;
  ctx.fillStyle = "#080d0caa";
  ctx.fillRect(0, 0, trimStart / buffer.duration * w, h);
  ctx.fillRect(trimEnd / buffer.duration * w, 0, w, h);
  if (p.alignment?.onsets) {
    ctx.strokeStyle = "#eea08b88";
    for (const hit of p.alignment.onsets.slice(0, 256)) {
      if (!Number.isFinite(hit.time)) continue;
      const x = hit.time / buffer.duration * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    const grid = 60 / (p.alignment.bpm || session.bpm) / 4;
    ctx.strokeStyle = "#caee9144";
    for (let t = 0; t < buffer.duration; t += grid) {
      const x = t / buffer.duration * w;
      ctx.beginPath();
      ctx.moveTo(x, h - 20);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
}
for (const id of ["#sample-trim-start", "#sample-trim-end"]) bind(id, "input", drawSampleWaveform);
bind("#sample-autotrim", "click", () => {
  const p = session.pads[selected], buffer = audio.buffers.get(p.audioId);
  if (!buffer) throw new Error("Load audio before trimming.");
  const region = trimSilence(buffer.getChannelData(0), buffer.sampleRate);
  $("#sample-trim-start").value = region.start.toFixed(3);
  $("#sample-trim-end").value = region.end.toFixed(3);
  drawSampleWaveform();
});
bind("#sample-preview", "click", async () => {
  await ready(session.pads[selected].audioId);
  audio.previewSample(selected, readSampleEditor());
});
bind('#sample-autosynth','click',async()=>{
  const id=selected,pad={...session.pads[id],...readSampleEditor()};sendAction({type:'setpad',pad});$('#pad-dialog').close();await autoSynth.open(id);
});
function renderSampleSequencer() {
  const container = $("#sample-sequencer");
  if (!container) return;
  container.replaceChildren();
  const pads = session.pads.filter((p) => p.audioId);
  if (!pads.length) return;
  container.append(make("h3", "sample-seq-heading", "YOUR SAMPLES · retrigger, move, and edit"));
  container.append(make("p", "view-note", "Enable Play pattern above. Each lit step starts the trimmed sample; a new trigger cuts its previous hit."));
  for (const p of pads) {
    const wrap = make("div", "sample-seq-row"), title = make("div", "sample-seq-title"), label = make("label"), check = make("input");
    check.type = "checkbox";
    check.checked = Boolean(p.sequenceEnabled);
    check.setAttribute("aria-label", p.name + " sequencer enabled");
    check.onchange = attempt(async () => {await ready(p.audioId);sendAction({ type: "sampleseq", id: p.id, on: check.checked });});
    label.append(check, document.createTextNode(p.name));
    const edit = make("button", "text-button", "Edit / trim / delay");
    edit.onclick = () => openPad(p.id);
    title.append(label, edit);
    const scroll = make("div", "sequencer-scroll"), row = make("div", "seq-row");
    row.style.setProperty("--steps", session.beats * 4);
    row.append(make("span", "", "Sample"));
    for (let i = 0; i < session.beats * 4; i++) {
      const b = make("button", "seq-step" + (p.steps?.[i] ? " on" : ""));
      b.dataset.step = i;
      b.setAttribute("aria-label", `${p.name}, step ${i + 1}`);
      b.setAttribute("aria-pressed", String(Boolean(p.steps?.[i])));
      bindStepEditing(b, (on) => sendAction({ type: "samplestep", id: p.id, index: i, on }), () => seqErase);
      row.append(b);
    }
    scroll.append(row);
    wrap.append(title, scroll);
    container.append(wrap);
  }
}
async function openPad(id) {
  const request=++padEditorRequest,openedSession=session;
  selected = id;
  renderQuickPad();
  const p = session.pads[id];
  audio.editingSample=p.audioId;
  if (p.audioId) {
    try {
      await ready(p.audioId);
    } catch (error) {
      if(request===padEditorRequest){audio.editingSample=null;toast(error.message, true);}
      return;
    }
  }
  if(request!==padEditorRequest||session!==openedSession||session.pads[id]!==p||selected!==id)return;
  $("#pad-name").value = p.kind === "empty" ? "" : p.name;
  $("#pad-level").value = p.volume * 100;
  $("#pad-bars").value = p.bars;
  $("#pad-detail").textContent = p.kind === "empty" ? "Import audio, record a sound, or capture an instrument to fill this pad." : p.audioId ? "Audio fits to this many bars using pitch-preserving time stretching." : `${p.events.length} notes · ${p.kind === "shot" ? "one shot" : "musical loop"}`;
  openSampleEditor(p);
  $("#pad-dialog").showModal();
}
$('#pad-dialog').addEventListener('close',()=>{padEditorRequest++;audio.editingSample=null;audio.previewCleanup?.();});
async function triggerPad(id) {
  const version=operationVersion,p=session.pads[id],shot=mode==='shot'||p.kind==='shot';
  if(audio.ctx?.state!=='running'){await audio.init();updateAudioInfo();}
  if(p.audioId)await ensureSample(p.audioId);
  if(version!==operationVersion||session.pads[id]!==p)return;
  if(p.audioId&&!shot)await audio.preparePad(id);
  if(!audio.running&&!shot)await prepareSamples(p.audioId);
  if(version!==operationVersion||session.pads[id]!==p)return;
  if (p.kind === "empty") return;
  if (shot) {
    const e = { type: "shot", id, at: audio.now() + session.jamBuffer };
    if (jam.role) {
      rememberLocalShot(e.at + ":" + id);
      audio.oneShot(id);
      sendAction(e);
    } else audio.oneShot(id);
    return;
  }
  if (!audio.running) {
    if (jam.role === "follower") throw new Error("The leader needs to start the transport first.");
    sendAction({ type: "start", epoch: audio.now() + 250 });
  }
  const q = $("#launch-grid").value === "off" ? 0.25 : $("#launch-grid").value === "beat" ? 1 : session.beats;
  const beat = nextBoundary(audio.position(), q);
  const on = !(audio.pending.get(id)?.on ?? audio.active.has(id));
  sendAction({ type: "pad", id, beat, on });
}
const localShots = /* @__PURE__ */ new Set();
function rememberLocalShot(key){localShots.add(key);if(localShots.size>2048)localShots.delete(localShots.values().next().value);}
function sendAction(action) {
  if (jam.role) jam.command(action);
  else applyAction(action);
}
function validateAction(a, remote = false) {
  if (!a || typeof a !== "object") return false;
  const id = Number.isInteger(a.id) && a.id >= 0 && a.id < 16;
  switch (a.type) {
    case 'scenes':
      try{return !remote&&Array.isArray(a.scenes)&&!!normalizeScenes(a.scenes);}catch{return false;}
    case 'scene':
      try{return !remote&&!!normalizeScenes([a.scene])&&Number.isFinite(a.beat)&&a.beat>=audio.position()-128&&a.beat<audio.position()+128;}catch{return false;}
    case 'scenecancel':return !remote;
    case 'groove':return a.beats===session.beats&&validPattern(a.pattern,a.beats)&&typeof a.enabled==='boolean';
    case "start":
      return !remote && Number.isFinite(a.epoch) && Math.abs(a.epoch - audio.now()) < 1e4;
    case "stop":
    case "stoploops":
      return !remote;
    case "timing":
      return !remote && a.bpm >= 40 && a.bpm <= 240 && [3, 4, 5, 6, 7].includes(a.beats) && [1, 2, 4, 8].includes(a.bars);
    case "pack":
      return !remote && packs.some((p) => p.id === a.id);
    case "pad":
      return id && typeof a.on === "boolean" && Number.isFinite(a.beat) && a.beat >= audio.position() - (a.catchUp === true ? 128 : 1) && a.beat < audio.position() + 128;
    case "shot":
      return id && Number.isFinite(a.at) && Math.abs(a.at - audio.now()) < 5e3;
    case "note":
      return validSound(a.voice, a.sound) && validTone(a.tone) && (a.duration === void 0 || Number.isFinite(a.duration) && a.duration > 0 && a.duration <= 30) && (a.velocity === void 0 || Number.isFinite(a.velocity) && a.velocity >= 0 && a.velocity <= 1) && ["piano", "bass", "guitar", "synth", "bell", ...drums].includes(a.voice) && Number.isFinite(a.note) && a.note >= 0 && a.note <= 127 && Number.isFinite(a.at) && Math.abs(a.at - audio.now()) < 5e3;
    case "sound":
      return Boolean(soundBank[a.voice]?.some((p) => p.id === a.id));
    case "kit":
      return drumKits.some((p) => p.id === a.id);
    case "step":
      return ["kick", "snare", "hat", "clap"].includes(a.voice) && Number.isInteger(a.index) && a.index >= 0 && a.index < session.beats * 4 && typeof a.on === "boolean";
    case "pattern":
      return typeof a.enabled === "boolean" && Number.isFinite(a.swing) && a.swing >= 0 && a.swing <= 60;
    case "padlevel":
      return id && Number.isFinite(a.volume) && a.volume >= 0 && a.volume <= 1;
    case "samplestep":
      return id && Number.isInteger(a.index) && a.index >= 0 && a.index < session.beats * 4 && typeof a.on === "boolean";
    case "sampleseq":
      return id && typeof a.on === "boolean";
    case "setpad":
      try {
        if(!Number.isInteger(a.pad?.id)||a.pad.id<0||a.pad.id>=16)return false;
        const copy = structuredClone(session);
        copy.pads[a.pad.id] = a.pad;
        validateSession(copy);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}
function applyAction(a) {
  if (!validateAction(a)) return;
  switch (a.type) {
    case 'scenes':
      session.scenes=normalizeScenes(a.scenes);if(audio.pendingScene&&!session.scenes.some(s=>s.id===audio.pendingScene.scene.id))audio.pendingScene=null;performanceTools.refresh();break;
    case 'scene':
      if(audio.running)audio.queueScene(a.scene,a.beat);performanceTools.refresh();break;
    case 'scenecancel':audio.pendingScene=null;performanceTools.refresh();break;
    case 'groove':
      audio.pendingScene=null;audio.lastScene=null;session.pattern=structuredClone(a.pattern);session.seqEnabled=a.enabled;renderSequencer();renderTiming();performanceTools.refresh();break;
    case "start":
      audio.start(a.epoch);
      requestWake();
      break;
    case "stop":
      audio.stop();
      break;
    case "stoploops":
      audio.pendingScene=null;audio.lastScene=null;performanceTools.refresh();
      audio.active.clear();
      audio.pending.clear();
      for (let id = 0; id < 16; id++) audio.cancelPad(id);
      renderPadStates();
      break;
    case "timing": {
      if (a.switchAt > audio.now() + 5) {
        clearTimeout(tempoTimer);
        tempoTimer = setTimeout(() => {
          tempoTimer = null;
          applyAction({ ...a, switchAt: 0 });
        }, a.switchAt - audio.now());
        return;
      }
      if (recording) {
        toast("Finish recording before changing timing.", true);
        return;
      }
      const was = audio.running;
      performanceTools.resetMemory();
      audio.stop(false);
      session.bpm = a.bpm;
      session.beats = a.beats;
      session.bars = a.bars;
      session.pattern = resizePattern(session.pattern, a.beats);
      if (was) audio.start(a.epoch || audio.now() + 250);
      renderTiming();
      renderSequencer();
      break;
    }
    case "pack":
      performanceTools.resetMemory();
      audio.stop();
      session.pack = a.id;
      session.pads = makePads(a.id);
      session.bpm = packs.find((p) => p.id === a.id).bpm;
      session.beats = 4;
      session.bars = 2;
      session.pattern = pattern(a.id === "dusty" ? "half" : "house");
      session.seqEnabled = false;
      renderAll();
      break;
    case "pad":
      if (!audio.running) break;
      audio.queuePad(a.id, "bar", a.beat, a.on);
      renderPadStates();
      break;
    case "shot": {
      const key = a.at + ":" + a.id;
      if (localShots.has(key)) {
        localShots.delete(key);
        break;
      }
      audio.oneShot(a.id, Math.max(audio.ctx.currentTime + 3e-3, audio.ctx.currentTime + (a.at - audio.now()) / 1e3));
      break;
    }
    case "note": {
      const key = a.at + ":" + a.note + ":" + a.voice;
      if (localShots.has(key)) {
        localShots.delete(key);
        break;
      }
      audio.play({ voice: a.voice, note: a.note, sound: a.sound, tone: a.tone, duration: a.duration ?? 0.45, velocity: a.velocity ?? 0.65 }, Math.max(audio.ctx.currentTime + 3e-3, audio.ctx.currentTime + (a.at - audio.now()) / 1e3));
      break;
    }
    case "sound":
      session.rack.sounds[a.voice] = a.id;
      queueInstrumentWarm();
      rack.renderControls();
      rack.renderDrums();
      break;
    case "kit":
      session.rack.kit = a.id;
      queueInstrumentWarm();
      for (const v of ["kick", "snare", "hat", "openhat", "clap", "tom", "rim"]) session.rack.sounds[v] = a.id;
      rack.renderControls();
      rack.renderDrums();
      break;
    case "step":
      audio.pendingScene=null;audio.lastScene=null;
      session.pattern[a.voice][a.index] = a.on;
      renderSequencer();
      break;
    case "pattern":
      session.seqEnabled = a.enabled;
      session.swing = a.swing;
      prepareSamples().catch(e=>toast(e.message,true));
      renderTiming();
      break;
    case "padlevel":
      session.pads[a.id].volume = a.volume;
      audio.setPadVolume(a.id, a.volume);
      renderQuickPad();
      break;
    case "samplestep": {
      const p = session.pads[a.id];
      p.steps = Array.from({ length: session.beats * 4 }, (_, i) => p.steps?.[i] || false);
      p.steps[a.index] = a.on;
      p.sequenceEnabled = true;
      ensureSample(p.audioId).catch(e=>toast(e.message,true));
      renderSampleSequencer();
      break;
    }
    case "sampleseq":
      session.pads[a.id].sequenceEnabled = a.on;
      if(a.on)ensureSample(session.pads[a.id].audioId).catch(e=>toast(e.message,true));
      session.pads[a.id].steps ??= Array.from({ length: session.beats * 4 }, (_, i) => i === 0);
      renderSampleSequencer();
      break;
    case "setpad": {
      const previous=session.pads[a.pad.id],duration=audio.buffers.get(previous.audioId)?.duration||0;
      const shift=p=>(p.alignment?.enabled?p.alignment.shift:0)-(p.alignment?.manual||0);
      const sameContent=a.pad.kind!=='empty'&&previous.kind===a.pad.kind&&previous.audioId===a.pad.audioId&&previous.bars===a.pad.bars&&(previous.trimStart||0)===(a.pad.trimStart||0)&&(previous.trimEnd||duration)===(a.pad.trimEnd||duration)&&(previous.preDelay||0)===(a.pad.preDelay||0)&&shift(previous)===shift(a.pad)&&JSON.stringify(previous.events)===JSON.stringify(a.pad.events);
      if(!sameContent){audio.cancelPad(a.pad.id);audio.active.delete(a.pad.id);audio.pending.delete(a.pad.id);}
      session.pads[a.pad.id] = structuredClone(a.pad);
      audio.setPadVolume(a.pad.id, a.pad.volume);
      audio.setPadEffects(a.pad.id);
      renderSampleSequencer();
      renderPads();
      break;
    }
  }
  changed();
}
function performNote(event, time = audio.ctx.currentTime + 3e-3, alreadyPlayed = false) {
  const spb = beatDuration(session.bpm), duration = alreadyPlayed ? event.duration * spb : event.duration;
  const e = { ...event, duration };
  if (!alreadyPlayed) audio.play(e, time);
  const at = audio.now() + (time - audio.ctx.currentTime) * 1e3;
  performanceTools.remember(e,alreadyPlayed?audio.epoch+event.beat*spb*1000:at,audio.running?audio.epoch:null);
  if (recording?.kind === "notes") {
    const beat = alreadyPlayed ? event.beat - recording.startBeat : (time - recording.startAudio) / spb;
    if (beat >= 0 && beat < session.beats * session.bars) recording.events.push({ ...e, beat: (alreadyPlayed ? Math.round(beat * 1e6) / 1e6 : quantizeBeat(beat)) % (session.beats * session.bars), duration: duration / spb });
  }
  if (jam.role) {
    const target = at + session.jamBuffer;
    rememberLocalShot(target + ":" + e.note + ":" + e.voice);
    sendAction({ type: "note", ...e, at: target });
  }
}
bind("#loop-mode", "click", () => {
  mode = "loop";
  $("#loop-mode").classList.add("active");
  $("#shot-mode").classList.remove("active");
  $("#loop-mode").setAttribute("aria-pressed", "true");
  $("#shot-mode").setAttribute("aria-pressed", "false");
});
bind("#shot-mode", "click", () => {
  mode = "shot";
  $("#shot-mode").classList.add("active");
  $("#loop-mode").classList.remove("active");
  $("#shot-mode").setAttribute("aria-pressed", "true");
  $("#loop-mode").setAttribute("aria-pressed", "false");
});
async function togglePlay() {
  if (jam.role === "follower") throw new Error("The room leader controls transport.");
  if(audio.running){const cancelling=cancelRecording();sendAction({type:'stop'});await cancelling;return;}
  const version=operationVersion;await ready();
  if(version!==operationVersion)return;
  sendAction({ type: "start", epoch: audio.now() + 250 });
}
bind("#play-btn", "click", togglePlay);
bind("#stop-btn", "click", async () => {
  const cancelling=cancelRecording();
  if (jam.role === "follower") {
    audio.stop();
    toast("Stopped on this phone. Resync to follow the leader again.");
  } else sendAction({ type: "stop" });
  await cancelling;
});
bind("#stop-loops", "click", () => {
  if (jam.role === "follower") throw new Error("The leader controls all loops. Tap a pad to stop that layer.");
  sendAction({ type: "stoploops" });
});
bind('#seq-stop-kicks','click',()=>{
  const beat=nextBoundary(audio.position(),session.beats);
  for(const id of audio.active.keys())if(session.pads[id].events.some(e=>e.voice==='kick'))sendAction({type:'pad',id,beat,on:false});
});
audio.addEventListener('scene',()=>{renderTiming();renderSequencer();performanceTools.refresh();changed();});
async function changeTiming() {
  if (recording||startingRecording||writing) throw new Error("Finish recording before changing timing.");
  if (tempoPreparing) throw new Error("Preparing the previous tempo change.");
  const bpm = clamp($("#bpm").value, 40, 240), beats = Number($("#beats").value), bars = Number($("#bars").value);
  tempoPreparing = true;
  const version=operationVersion;
  try {
    await ready();
    await audio.prepareTempo(bpm, beats);
    if(version!==operationVersion)return;
    const switchAt = audio.now() + 220, phase = audio.running ? Math.max(0, audio.position() + 0.22 / beatDuration(session.bpm)) : 0;
    sendAction({ type: "timing", bpm, beats, bars, switchAt, epoch: switchAt - phase * beatDuration(bpm) * 1e3 });
  } finally {
    if(version===operationVersion)tempoPreparing = false;
  }
}
for (const id of ["#bpm", "#beats", "#bars"]) bind(id, "change", changeTiming);
let taps = [];
bind("#tap-btn", "click", async () => {
  const now = performance.now();
  if (taps.length && now - taps.at(-1) > 2500) taps = [];
  taps.push(now);
  taps = taps.slice(-5);
  if (taps.length > 1) {
    $("#bpm").value = clamp(Math.round(6e4 / ((now - taps[0]) / (taps.length - 1))), 40, 240);
    await changeTiming();
  }
});
bind("#metro-btn", "click", async () => {
  await ready();
  audio.metro = !audio.metro;
  $("#metro-btn").setAttribute("aria-pressed", String(audio.metro));
  if (audio.metro && !audio.running) {
    if (jam.role === "follower") toast("Click enabled. Waiting for the leader to play.");
    else sendAction({ type: "start", epoch: audio.now() + 250 });
  }
});
bind("#master-volume", "input", () => {
  session.master = Number($("#master-volume").value) / 100;
  if (audio.master) audio.master.gain.setTargetAtTime(session.master, audio.ctx.currentTime, 0.015);
  $("#volume-value").value = Math.round(session.master * 100) + "%";
  changed();
});
for (const [button, dialog] of [["#settings-btn", "#settings-dialog"], ["#project-btn", "#project-dialog"], ["#help-btn", "#help-dialog"], ["#jam-btn", "#jam-dialog"], ["#jam-tip", "#jam-dialog"]]) bind(button, "click", () => $(dialog).showModal());
for (const [id, key, min, max] of [["#input-latency", "inputLatency", 0, 500], ["#output-offset", "outputOffset", -500, 500], ["#jam-buffer", "jamBuffer", 40, 500]]) bind(id, "change", () => {
  session[key] = clamp($(id).value, min, max);
  $(id).value = session[key];
  changed();
});
bind("#seq-enabled", "change", async () => {
  await ready();
  sendAction({ type: "pattern", enabled: $("#seq-enabled").checked, swing: session.swing });
  if (session.seqEnabled && !audio.running && jam.role !== "follower") sendAction({ type: "start", epoch: audio.now() + 250 });
});
bind("#swing", "input", () => sendAction({ type: "pattern", enabled: session.seqEnabled, swing: Number($("#swing").value) }));
bind("#seq-erase", "click", () => {
  seqErase = !seqErase;
  $("#seq-erase").setAttribute("aria-pressed", String(seqErase));
  $("#seq-erase").textContent = seqErase ? "Erase: on" : "Erase: off";
});
bind("#seq-clear", "click", () => {
  sendAction({type:'groove',beats:session.beats,enabled:session.seqEnabled,pattern:Object.fromEntries(Object.keys(session.pattern).map(voice=>[voice,Array(session.beats*4).fill(false)]))});
});
bind("#drum-preset", "change", () => {
  const p = pattern($("#drum-preset").value, session.beats);
  sendAction({type:'groove',beats:session.beats,enabled:session.seqEnabled,pattern:p});
});
bind("#seq-to-pad", "click", () => {
  const id = emptyPad(), events = [];
  for (const [voice, steps] of Object.entries(session.pattern)) steps.forEach((on, i) => {
    if (on) events.push({ voice, sound: session.rack.sounds[voice], beat: i / 4, note: 60, duration: 0.15, velocity: 0.65 });
  });
  if (!events.length) throw new Error("Add some steps before saving a pattern.");
  sendAction({ type: "setpad", pad: { ...session.pads[id], kind: "loop", name: "My drum pattern", events, bars: 1 } });
  toast("Pattern saved to pad " + (id + 1));
});
bind("#pad-done", "click", () => {
  const p = { ...session.pads[selected], ...readPadEffects(), ...session.pads[selected].audioId ? readSampleEditor() : {}, name: $("#pad-name").value.trim() || session.pads[selected].name, volume: Number($("#pad-level").value) / 100, bars: Number($("#pad-bars").value) };
  sendAction({ type: "setpad", pad: p });
  $("#pad-dialog").close();
});
bind("#pad-clear", "click", () => {
  sendAction({ type: "setpad", pad: { id: selected, name: "Add a sound", color: colors[selected % 4], events: [], audioId: null, volume: 0.75, bars: 2, kind: "empty" } });
  $("#pad-dialog").close();
});
let uploadTarget = null;
for (const id of ["#upload-btn", "#quick-upload"]) bind(id, "click", () => {
  uploadTarget = null;
  $("#audio-file").click();
});
bind("#pad-import", "click", () => {
  uploadTarget = selected;
  $("#audio-file").click();
  $("#pad-dialog").close();
});
async function addSample(name, blob, id = crypto.randomUUID(), knownBuffer = null) {
  if (blob.size > 25 * 1024 * 1024) throw new Error("Use a sample under 25 MB to keep the studio snappy.");
  const buffer = knownBuffer || await audio.decode(id, await blob.arrayBuffer());
  if (knownBuffer) audio.buffers.set(id, knownBuffer);
  if (buffer.duration > 600) {
    audio.buffers.delete(id);
    throw new Error("Use an audio clip under 10 minutes.");
  }
  const analysis = knownBuffer ? { bpm: session.bpm, bpmConfidence: 1, key: null, keyConfidence: 0, candidates: [], source: "recording" } : await analyzeBuffer(buffer);
  const sample = { id, name: name.slice(0, 80), blob, duration: buffer.duration, analysis };
  if (knownBuffer) saveSample(sample).catch(() => toast("Could not save this take. Export a backup.", true));
  else await saveSample(sample);
  for (const p of session.pads) if (p.audioId === id) audio.resumeAudioPad(p.id);
  samples = samples.filter((s) => s.id !== id);
  samples.push(sample);
  renderLibrary();
  return sample;
}
async function assignSample(s, id) {
  const sourceBpm = s.analysis?.bpm || session.bpm;
  const bars = clamp(Math.round(s.duration / (60 / sourceBpm * session.beats)), 1, 512);
  if (jam.role) await shareSample(s);
  sendAction({ type: "setpad", pad: { ...session.pads[id], name: s.name.replace(/\.[^.]+$/, ""), trackAnalysis: s.analysis, kind: "audio", audioId: s.id, events: [], bars, volume: 0.75 } });
  selected = id;
  renderQuickPad();
}
async function shareSample(s) {
  if (jam.role === "follower") await jam.sendAudio(s, jam.hostConnection());
  else if (jam.role === "leader") await jam.sendAudio(s);
}
bind("#audio-file", "change", async () => {
  await ready();
  const files = [...$("#audio-file").files];
  $("#audio-file").value = "";
  let count = 0;
  for (const file of files) {
    try {
      const id = uploadTarget ?? emptyPad();
      const s = await addSample(file.name, file);
      await assignSample(s, id);
      uploadTarget = null;
      count++;
    } catch (e) {
      toast(e.message, true);
      break;
    }
  }
  if (count) {
    renderPads();
    toast(`${count} ${count === 1 ? "sound" : "sounds"} added. Ready to play.`);
  }
});
async function beginRecording(kind, target = null, asSynth = $('#recording-mode').value==='autosynth') {
  if(startingRecording||writing)throw new Error('A take is already being prepared. Please wait.');
  if (tempoPreparing || tempoTimer) throw new Error("Wait for the tempo change before recording.");
  const token={},version=operationVersion;startingRecording=token;
  try{
  await ready();
  if(version!==operationVersion)return;
  if (recording) {
    await finishRecording();
    return;
  }
  const id = target ?? (session.pads[selected]?.kind === "empty" ? selected : emptyPad());
  if (!audio.running) {
    if (jam.role === "follower") throw new Error("Ask the leader to start the transport first.");
    sendAction({ type: "start", epoch: audio.now() + 250 });
  }
  let mic = null;
  if (kind === "mic") mic = await audio.beginMic(0, 0);
  if(version!==operationVersion){mic?.close();return;}
  const countIn = $("#record-countin").value === "bar" ? session.beats : Number($("#record-countin").value);
  const { startBeat } = planRecording(audio.position(), session.bpm, session.beats, session.bars, countIn);
  const start = audio.epoch + startBeat * beatDuration(session.bpm) * 1e3;
  const end = start + session.beats * session.bars * beatDuration(session.bpm) * 1e3;
  recording = { kind, id, startBeat, start, end, events: [], mic, autoSynth:kind==='mic'&&asSynth, countIn: countIn > 0, bars: session.bars, beats: session.beats, startAudio: audio.timeForBeat(startBeat) };
  audio.capture = recording;
  $("#capture-btn").classList.add("recording");
  $("#mic-btn").classList.toggle("recording", kind === "mic");
  $("#capture-btn").innerHTML = '<span class="record-dot"></span> Cancel take';
  $("#mic-btn").innerHTML = '<span class="record-dot"></span> Cancel';
  toast(countIn ? "Count in… then your loop starts on the beat." : "Armed. Recording begins on the next beat.");
  }finally{if(startingRecording===token)startingRecording=null;}
}
async function cancelRecording() {
  if (!recording) return;
  const r = recording;
  recording = null;
  audio.capture = null;
  if (r.mic) await r.mic.stop();
  resetRecordingUI();
  toast("Take cancelled.");
}
function resetRecordingUI() {
  $("#capture-btn").classList.remove("recording");
  $("#mic-btn").classList.remove("recording");
  $("#capture-btn").innerHTML = '<span class="record-dot"></span> Capture loop';
  $("#mic-btn").innerHTML = '<span class="record-dot"></span> Record';
  $("#capture-title").textContent = "Catch your next idea";
  $("#capture-hint").textContent = "Starts on the next beat. The take loops as soon as it is ready.";
  $("#mic-status").textContent = "Record a sound, or drop in a track.";
}
async function finishRecording() {
  if (!recording || writing) return;
  writing = true;
  const r = recording;
  const recordedSession=session,recordedPad=session.pads[r.id],version=operationVersion;
  recording = null;
  audio.capture = null;
  try {
    let pad = { ...session.pads[r.id], name: r.kind === "mic" ? "Mic loop" : "My " + instrument, kind: r.kind === "mic" ? "audio" : "loop", events: r.events, audioId: null, bars: r.bars, volume: 0.75 };
    if (r.mic) {
      await r.mic.stop();
      if(version!==operationVersion||session!==recordedSession||session.pads[r.id]!==recordedPad)return;
      const b = audio.micBuffer(r.mic, r.startAudio, r.startAudio + (r.end - r.start) / 1e3), wav = audio.bufferWav(b);
      const s = await addSample("Mic loop " + (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), new Blob([wav], { type: "audio/wav" }), crypto.randomUUID(), b);
      pad.audioId = s.id;
      pad.alignment = analyzeRecording(b.getChannelData(0), b.sampleRate, session.bpm);
      pad.alignment.enabled = $("#smart-record").checked;
      if (jam.role) shareSample(s).catch((e) => toast(e.message, true));
    } else if (!r.events.length) {
      toast("No notes in that take. Give it another go.");
      return;
    }
    if(version!==operationVersion||session!==recordedSession||session.pads[r.id]!==recordedPad)return;
    sendAction({ type: "setpad", pad });
    selected = r.id;
    renderQuickPad();
    if(r.autoSynth){await autoSynth.open(r.id,{automatic:true,startBeat:r.startBeat});return;}
    if (audio.running) sendAction({ type: "pad", id: r.id, beat: r.startBeat + r.beats * r.bars, catchUp: true, on: true });
    toast(pad.alignment?.enabled && pad.alignment.shift ? `Loop captured · timing corrected by ${Math.abs(pad.alignment.shift)} ms.` : "Loop captured. Already in time.");
  } finally {
    writing = false;
    resetRecordingUI();
  }
}
bind("#capture-btn", "click", () => recording ? cancelRecording() : beginRecording("notes"));
bind("#mic-btn", "click", () => recording ? cancelRecording() : beginRecording("mic"));
bind('#autosynth-record','click',()=>recording?cancelRecording():beginRecording('mic',null,true));
bind("#pad-mic", "click", () => {
  $("#pad-dialog").close();
  return beginRecording("mic", selected);
});
audio.addEventListener("captureend", attempt(finishRecording));
audio.addEventListener("pads", renderPadStates);
audio.addEventListener("audioerror", ({ detail }) => toast(detail, true));
audio.addEventListener('audiostate',()=>{
  const paused=audio.running&&audio.ctx.state!=='running';
  $('#resume-audio').hidden=!paused;
  if(paused&&(recording||startingRecording)){
    startingRecording=null;operationVersion++;
    attempt(cancelRecording)();
    toast('Audio was interrupted. The take was cancelled; tap Resume audio to continue.',true);
  }
});
bind('#resume-audio','click',async()=>{await ready();$('#resume-audio').hidden=audio.ctx.state==='running';});
audio.addEventListener("transport", ({detail}) => {
  if(!audio.running&&detail?.cleared){operationVersion++;startingRecording=null;padEditorRequest++;clearTimeout(tempoTimer);tempoTimer=null;tempoPreparing=false;attempt(cancelRecording)();renderTiming();}
  $('#resume-audio').hidden=!audio.running||audio.ctx?.state==='running';
  const b = $("#play-btn");
  b.classList.toggle("playing", audio.running);
  b.firstChild.textContent = audio.running ? "Ⅱ" : "▶";
  b.setAttribute("aria-label", audio.running ? "Stop transport" : "Start transport");
  presentation.syncFocus();
  $("#transport-status").textContent = audio.running ? "IN THE GROOVE" : "READY WHEN YOU ARE";
  renderPadStates();
  requestWake();
});
function requestWake(){return screenWake.set(Boolean(audio.running&&$('#keep-awake').checked&&navigator.wakeLock&&document.visibilityState==='visible'));}
bind('#keep-awake','change',requestWake);
document.addEventListener("visibilitychange", () => {
  requestWake();
  if (document.visibilityState === "visible" && audio.running) {
    if (jam.role === "follower") jam.sync();
  }
});
bind("#project-name", "change", () => {
  session.name = $("#project-name").value.trim() || "Untitled session";
  renderTiming();
  changed();
});
bind("#project-export", "click", () => exportProject(session, samples));
bind("#project-import", "click", () => $("#project-file").click());
bind("#project-file", "change", async () => {
  const file = $("#project-file").files[0];
  $("#project-file").value = "";
  if(!file)return;
  if(projectImporting)throw Error('A project is already being prepared.');
  if (jam.role) throw new Error("Leave the jam room before importing a project.");
  if (recording||startingRecording||writing) throw new Error("Finish your recording first.");
  if (file.size > 100 * 1024 * 1024) throw new Error("Project is too large (100 MB maximum).");
  const version=operationVersion,previousSession=session,dialog=$('#project-dialog');projectImporting=true;
  $('#project-import').disabled=true;$('#project-new').disabled=true;toast('Checking the whole project before restoring…');
  try{
  const data=JSON.parse(await file.text());await readyInstrument();
  const prepared=await prepareProjectImport(data,{decode:bytes=>audio.ctx.decodeAudioData(bytes),analyze:analyzeBuffer});
  if(version!==operationVersion||session!==previousSession||jam.role||recording||startingRecording||writing)throw Error('The session changed during import. Try again when it is ready.');
  importCommitting=true;clearTimeout(saveTimer);if(!dialog.open)dialog.showModal();dialog.inert=true;$('.app-shell').inert=true;
  await saveProject(prepared.session,prepared.samples);
  audio.stop();
  session = prepared.session;samples.push(...prepared.samples);
  performanceTools.resetMemory();
  renderAll();
  changed();
  $("#project-dialog").close();
  toast("Project restored. Welcome back.");
  }finally{projectImporting=false;importCommitting=false;dialog.inert=false;$('.app-shell').inert=false;$('#project-import').disabled=false;$('#project-new').disabled=false;if(session===previousSession)changed();}
});
$('#project-dialog').addEventListener('cancel',event=>{if(importCommitting)event.preventDefault();});
bind("#project-new", "click", async () => {
  if (jam.role) throw new Error("Leave your jam room before starting a new session.");
  await cancelRecording();
  await exportProject(session, samples);
  audio.stop();
  session = defaultSession();
  performanceTools.resetMemory();
  renderAll();
  changed();
  $("#project-dialog").close();
  toast("Fresh session. Your previous project was downloaded.");
});
bind("#export-mix", "click", async () => {
  await ready();
  if (mixRecorder) {
    if(mixRecorder.state!=='inactive')mixRecorder.stop();
    return;
  }
  if (!window.MediaRecorder) throw new Error("Mix recording is unavailable in this browser. Export your project instead.");
  const chunks = [];
  mixRecorder = new MediaRecorder(audio.destination.stream);
  mixRecorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  mixRecorder.onstop = () => {
    const type = mixRecorder.mimeType;
    download(new Blob(chunks, { type }), session.name + "-mix." + (type.includes("mp4") ? "m4a" : "webm"), type);
    mixRecorder = null;
    $("#export-mix").textContent = "◉ Record mix";
    $('#stage-record-mix').textContent='Record mix';
    toast("Mix downloaded.");
  };
  mixRecorder.start(1e3);
  $("#export-mix").textContent = "■ Finish mix";
  $('#stage-record-mix').textContent='Finish mix & download';
  toast("Recording the mix. Tap Finish mix to download.");
});
document.addEventListener("keydown", attempt(async (e) => {
  if(importCommitting)return;
  if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
  if (e.target.matches("input,select,textarea") || $("dialog[open]")) return;
  if (e.code === "Space") {
    if(e.target.closest('button,[role=button]'))return;
    e.preventDefault();
    if (!e.repeat) await togglePlay();
    return;
  }
  if (e.key === "Escape") {
    if(presentation.handleEscape())return;
    const cancelling=cancelRecording();
    audio.stop();
    await cancelling;
    return;
  }
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (view === "instruments") {
    await rack.keyDown(e);
    return;
  }
  const id = padKeys.indexOf(key);
  if (id >= 0 && session.pads[id].kind !== "empty") await triggerPad(id);
}));
document.addEventListener("keyup", (e) => rack.keyUp(e));
let drawTimer, lastQuarter = '', lastBeat = -1;
function tick() {
  clearTimeout(drawTimer);
  if (!document.hidden) {
    if (audio.running) {
      const p = Math.max(0, audio.audiblePosition()), beat = Math.floor(p) % session.beats;
      const quarter = Math.floor(p * 4), stamp = session.beats + ':' + quarter;
      if (stamp !== lastQuarter) {
        lastQuarter = stamp;
        $('#position').innerHTML = Math.floor(p / session.beats) + 1 + ' <span>. ' + (beat + 1) + ' . ' + (quarter % 4 + 1) + '</span>';
        if (view === 'sequencer') $$('.seq-step').forEach(e=>e.classList.toggle('current', Number(e.dataset.step)===quarter%(session.beats*4)));
      }
      if (beat !== lastBeat) {lastBeat=beat; $$('#beat-lights i').forEach((e,i)=>e.classList.toggle('on', i===beat));}
      if (view === 'pads') for (const b of $$('.pad.is-playing')) {
        const id=Number(b.dataset.id),a=audio.active.get(id),pad=session.pads[id];
        if(a)b.style.setProperty('--progress',(p-a.start)%(pad.bars*session.beats)/(pad.bars*session.beats)*100+'%');
      }
    } else {lastQuarter='';lastBeat=-1;}
    $('#stage-recording-status').hidden=!recording&&!mixRecorder;
    if(mixRecorder&&!recording)$('#stage-recording-status').textContent='Mix recording · finish in Settings';
    if (recording) {
      const now=audio.now(),left=Math.max(0,(recording.end-now)/1000),count=Math.max(0,Math.ceil((recording.start-now)/1000/beatDuration(session.bpm)));
      const status=now<recording.start?'Count in · '+count:'Recording · '+left.toFixed(1)+'s left';
      $('#capture-title').textContent=status;
      $('#capture-hint').textContent=now<recording.start?'Get ready. Your first beat is coming.':'Keep playing. We’ll close the loop for you.';
      $('#mic-status').textContent=status;
      $('#stage-recording-status').textContent=status;
    }
  }
  drawTimer=setTimeout(tick, document.hidden?1000:1000/resourceProfiles[audio.resourceMode].fps);
}
document.addEventListener('visibilitychange',tick);
const audioImports = /* @__PURE__ */ new Map();
function actionSample(a){return a?.pad?.audioId||(['pad','shot','samplestep','sampleseq'].includes(a?.type)?session.pads[a.id]?.audioId:null);}
let incomingCommands = Promise.resolve();
function queueRoomUpdate(work){
  const peer=jam.peer,isCurrent=()=>jam.peer===peer&&jam.role==='follower';
  incomingCommands=incomingCommands.then(()=>{if(isCurrent())return work(isCurrent);}).catch(e=>{if(isCurrent())toast(e.message,true);});
}
function leaderCommand({ packet, remote, conn }) {
  if (!validateAction(packet.action, remote)) {
    if (conn) jam.send(conn, { type: "rejected" });
    return;
  }
  const peer=jam.peer,commandSession=session;
  const perform = () => {
    if(jam.peer!==peer||jam.role!=='leader'||session!==commandSession)return;
    applyAction(packet.action);
    if (jam.role === "leader") jam.accept(packet);
  };
  const id=actionSample(packet.action),pending=audioImports.get(id);
  if (pending||id&&!audio.buffers.has(id)) Promise.resolve(pending).then(()=>ensureSample(id)).then(perform).catch((e) => toast(e.message, true));
  else perform();
}
jam.addEventListener("command", ({ detail }) => {
  try {
    leaderCommand(detail);
  } catch (e) {
    toast(e.message, true);
  }
});
jam.addEventListener("accepted", ({ detail }) => {
  queueRoomUpdate(async isCurrent => {
    if (!audio.ctx) await ready();
    if (detail.action?.type === "timing") await audio.prepareTempo(detail.action.bpm, detail.action.beats);
    const pending = audioImports.get(detail.action?.pad?.audioId);
    if (pending) await pending;
    await prepareSamples(actionSample(detail.action));
    if(detail.action?.type==='scene')for(const id of detail.action.scene.padIds){await ensureSample(session.pads[id]?.audioId);if(session.pads[id]?.audioId)await audio.preparePad(id);}
    if (["timing", "stop", "pack"].includes(detail.action?.type)) await cancelRecording();
    if(isCurrent())applyAction(detail.action);
  });
});
function snapshot() {
  return { type: "snapshot", session: structuredClone(session), running: audio.running, epoch: audio.epoch, active: [...audio.active], pending: [...audio.pending],scenePending:audio.pendingScene||null };
}
jam.addEventListener("welcome", attempt(async ({ detail: { conn } }) => {
  jam.send(conn, snapshot());
  for (const s of samples.filter((s2) => session.pads.some((p) => p.audioId === s2.id))) await jam.sendAudio(s, conn);
}));
jam.addEventListener("snapshot", ({ detail: s }) => queueRoomUpdate(async isCurrent => {
  const valid = validateSession(s.session);
  await cancelRecording();
  await ready();
  if(!isCurrent())return;
  const local = { master: session.master, inputLatency: session.inputLatency, outputOffset: session.outputOffset, jamBuffer: session.jamBuffer };
  session = { ...valid, ...local };
  audio.session = session;
  performanceTools.resetMemory();
  audio.stop();
  const version=operationVersion;
  const entries = Array.isArray(s.active) ? s.active : [];
  audio.active = new Map(entries.filter((x) => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] < 16 && Number.isFinite(x[1]?.start)));
  await prepareSamples();
  if(!isCurrent()||version!==operationVersion)return;
  if (s.running && Number.isFinite(s.epoch)) audio.start(s.epoch);
  if (Array.isArray(s.pending)) {
    for (const [id, p] of s.pending) if (Number.isInteger(id) && id >= 0 && id < 16 && Number.isFinite(p?.beat) && typeof p.on === "boolean") audio.pending.set(id, p);
  }
  if(s.scenePending&&Number.isFinite(s.scenePending.beat)&&s.scenePending.beat>=audio.position()-128&&s.scenePending.beat<audio.position()+128&&audio.running){try{audio.queueScene(s.scenePending.scene,s.scenePending.beat);}catch{}}
  renderAll();
  changed();
  toast("Joined the shared groove.");
}));
jam.addEventListener("clock", ({ detail }) => {
  audio.clockOffset = detail.offset;
  $("#jam-status").textContent = `Connected · ${Math.round(detail.rtt)} ms round trip · clock offset ${Math.round(detail.offset)} ms. Leader controls tempo and transport.`;
});
jam.addEventListener("audio", ({ detail: s }) => {
  const peer=jam.peer;
  const task = (async () => {
    const sample = await addSample(s.name, s.blob, s.id);
    if (jam.peer!==peer)return;
    if (jam.role === "leader") {
      for (const c of jam.connections.values()) if (c !== s.conn) await jam.sendAudio(sample, c);
    }
    renderPads();
  })();
  audioImports.set(s.id, task);
  task.catch((e) => {if(jam.peer===peer)toast(e.message, true);}).finally(() => {if(audioImports.get(s.id)===task)audioImports.delete(s.id);});
});
jam.addEventListener("status", ({ detail }) => {
  $("#jam-status").textContent = detail.message;
  if (detail.error) toast(detail.message, true);
});
jam.addEventListener("peers", ({ detail }) => {
  const c = $("#jam-peers");
  c.replaceChildren();
  for (const p of detail) {
    const row = make("div", "peer-row");
    row.append(make("span", "", p.name), make("span", "", p.open ? "Connected" : "Reconnecting"));
    c.append(row);
  }
});
function roomLink() {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "jam=" + jam.room;
  return u.href;
}
jam.addEventListener("room", ({ detail }) => {
  localShots.clear();
  incomingCommands=Promise.resolve();
  $("#jam-room").hidden = false;
  $("#jam-role").textContent = detail.role === "leader" ? "ROOM LEADER" : "FOLLOWER";
  $("#room-label").textContent = detail.room;
  $("#host-btn").disabled = true;
  $("#join-btn").disabled = true;
  renderTiming();
  if (globalThis.QRCode) QRCode.toCanvas($("#qr-code"), roomLink(), { width: 180, margin: 2, color: { dark: "#14220f", light: "#f2f6ec" } }, (e) => {
    if (e) toast("QR unavailable. Copy the invite link.", true);
  });
});
bind("#host-btn", "click", async () => {
  await ready();
  await jam.create("leader");
});
function parseRoom(value) {
  let code = value.trim();
  if (code.includes("://")) {
    try {
      const u = new URL(code);
      code = new URLSearchParams(u.hash.slice(1)).get("jam") || u.searchParams.get("jam") || "";
    } catch {
      throw new Error("That invite link is invalid.");
    }
  }
  code = code.toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error("Enter the six-character room code or an invite link.");
  return code;
}
bind("#join-btn", "click", async () => {
  const code = parseRoom($("#room-code").value);
  await ready();
  await jam.create("follower", code);
});
bind("#leave-btn", "click", async () => {
  await cancelRecording();
  jam.leave();
  localShots.clear();
  audio.clockOffset = 0;
  audio.stop();
  $("#jam-room").hidden = true;
  $("#host-btn").disabled = false;
  $("#join-btn").disabled = false;
  renderTiming();
  toast("Left the room. Your sounds are saved.");
});
bind("#copy-invite", "click", async () => {
  try {
    await navigator.clipboard.writeText(roomLink());
    toast("Invite link copied.");
  } catch {
    const input = $("#room-code");
    input.value = roomLink();
    input.focus();
    input.select();
    toast("Select and copy the invite link from the room field.");
  }
});
bind("#sync-btn", "click", () => {
  if (jam.role === "follower") {
    jam.sync();
    jam.send(jam.hostConnection(), { type: "request-state" });
  } else {
    jam.broadcast(snapshot());
    toast("Session sent to your phones.");
  }
});
bind("#connection-save", "click", () => {
  jam.config = { host: $("#signal-host").value.trim(), port: clamp($("#signal-port").value, 1, 65535), path: $("#signal-path").value.trim() || "/", turn: $("#turn-url").value.trim(), user: $("#turn-user").value, password: $("#turn-pass").value };
  toast("Connection settings saved for this page session.");
});
let acoustic = null;
jam.addEventListener("calibrate", ({ detail }) => {
  if (jam.role === "leader") {
    const t = audio.ctx.currentTime + (detail.at - Date.now()) / 1e3;
    if (t > audio.ctx.currentTime) for (let i = 0; i < 3; i++) audio.chirp(t + i * 0.5);
  } else if (acoustic) acoustic.at = detail.at;
});
bind("#acoustic-btn", "click", async () => {
  if (jam.role !== "follower") throw new Error("Use Listen & align on a follower, near the leader’s speaker.");
  if (!jam.hostConnection()?.open) throw new Error("Reconnect to the leader before aligning.");
  if (recording) throw new Error("Finish your recording before aligning.");
  await ready();
  if (acoustic) throw new Error("Alignment is already listening.");
  toast("Listening for three tones from the leader. Keep this phone quiet.");
  const old = audio.master.gain.value;
  audio.master.gain.setValueAtTime(0, audio.ctx.currentTime);
  const hits = [];
  let last = -10;
  const at = audio.now() + 1800;
  acoustic = { at };
  let mic;
  try {
    mic = await audio.beginMic(0, 0, (chunk) => {
      const a = chunk.samples, rate = audio.ctx.sampleRate;
      let real = 0, imag = 0, energy = 0;
      for (let i = 0; i < a.length; i++) {
        const angle = 2 * Math.PI * 1800 * i / rate;
        real += a[i] * Math.cos(angle);
        imag += a[i] * Math.sin(angle);
        energy += a[i] * a[i];
      }
      const power = 2 * (real * real + imag * imag) / (a.length * a.length);
      if (power > 2e-5 && power > energy / a.length * 0.25 && chunk.time - last > 0.3) {
        const expected = audio.ctx.currentTime + (at - audio.now()) / 1e3;
        const delta = chunk.time - expected;
        if (delta > -0.2 && delta < 1.3) {
          hits.push(delta);
          last = chunk.time;
        }
      }
    });
    jam.send(jam.hostConnection(), { type: "calibrate", at });
    await new Promise((r) => setTimeout(r, 3700));
    await mic.stop();
    if (hits.length < 3) throw new Error("Could not hear all three tones. Move closer, raise the leader’s volume, and retry.");
    const offsets = hits.slice(0, 3).map((v, i) => (v - i * 0.5) * 1e3 - session.inputLatency - (audio.ctx.outputLatency || audio.ctx.baseLatency || 0) * 1e3);
    const spread = Math.max(...offsets) - Math.min(...offsets);
    if (spread > 65) throw new Error("Alignment was noisy. Try again in a quieter spot.");
    session.outputOffset = clamp(Math.round(offsets.sort((a, b) => a - b)[1]), -500, 500);
    renderTiming();
    changed();
    toast(`Speaker alignment set to ${session.outputOffset} ms. Fine-tune in audio settings.`);
  } finally {
    if (mic) mic.close();
    audio.master.gain.setValueAtTime(old, audio.ctx.currentTime);
    acoustic = null;
  }
});
async function boot() {
  try {
    const saved = await loadSession();
    if (saved) session = validateSession(saved);
    samples = await getSamples();
  } catch (e) {
    toast("Local storage is unavailable. Export your work before leaving.", true);
  }
  renderAll();
  tick();
  const hash = new URLSearchParams(location.hash.slice(1)).get("jam");
  if (hash) {
    try {
      $("#room-code").value = parseRoom(hash);
      $("#jam-dialog").showModal();
      toast("Tap Join to wake audio and enter the room.");
    } catch {
    }
  } else {
    try {
      const prev = JSON.parse(localStorage.getItem("mobipad-room"));
      if (prev?.room) {
        $("#room-code").value = prev.room;
        $("#jam-dialog").showModal();
        const b = make("button", "button subtle", "Rejoin previous room as " + prev.role);
        b.onclick = attempt(async () => {
          await ready();
          await jam.create(prev.role, parseRoom(prev.room));
          b.remove();
        });
        $(".jam-start").prepend(b);
      }
    } catch {
    }
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {
  });
}
boot();
