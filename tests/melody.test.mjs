import test from 'node:test';
import assert from 'node:assert/strict';
import {pitchFrame,transcribeMelody,melodyEvents,sessionKey,tuneNote} from '../js/melody.js';
import {defaultSession,validateSession} from '../js/presets.js';
import {reverbImpulse} from '../js/effects.js';
import {sungFixture} from './melody-fixture.js';
test('YIN transcription follows a detuned hummed melody and preserves rests',()=>{
  const {samples,rate}=sungFixture(),result=transcribeMelody(samples,rate);
  assert.deepEqual(result.notes.map(n=>n.note),[60,62,64,67]);
  assert.ok(Math.abs(result.notes[0].midi-60.25)<.15);assert.ok(Math.abs(result.notes[0].start-.12)<.06);
  assert.ok(result.notes[1].start-result.notes[0].end>.05);assert.ok(result.notes.every(n=>n.confidence>.9));
});
test('silent and unpitched noise takes do not invent a melody',()=>{
  assert.equal(transcribeMelody(new Float32Array(16000),8000).notes.length,0);
  let seed=17;const noise=Float32Array.from({length:16000},()=>{seed=(1664525*seed+1013904223)>>>0;return(seed/4294967296-.5)*.2;});
  assert.equal(transcribeMelody(noise,8000).notes.length,0);assert.equal(pitchFrame(new Float32Array(20),0,8000),null);
});
test('tuning uses the backing key, keeps natural timing by default, and makes valid loop notes',()=>{
  const {samples,rate}=sungFixture(),result=transcribeMelody(samples,rate),events=melodyEvents(result,{beats:8,key:'C minor'});
  assert.deepEqual(events.map(e=>e.note),[60,62,65,67]);assert.ok(events.every(e=>e.sound==='pure'));
  assert.notEqual(events[0].beat*4,Math.round(events[0].beat*4));
  const grid=melodyEvents(result,{beats:8,key:'C minor',timing:'grid'});assert.ok(grid.every(e=>e.beat*4===Math.round(e.beat*4)));
  const session=defaultSession();Object.assign(session.pads[12],{kind:'loop',events,bars:2,reverb:.4,reverbSpace:'plate',echo:.2,echoTime:.25});assert.doesNotThrow(()=>validateSession(session));
  assert.equal(tuneNote(61.7,'D major'),62);assert.equal(tuneNote(61.7,'chromatic'),62);
  session.pads[12].reverb=1;assert.throws(()=>validateSession(session),/sample settings/);session.pads[12].reverb=.2;session.pads[12].reverbSpace='unknown';assert.throws(()=>validateSession(session),/sample settings/);
});
test('session key evidence uses other melodic layers and excludes the source voice',()=>{
  const pads=[{id:0,volume:.8,events:[{voice:'piano',note:62,duration:3,velocity:.8},{voice:'piano',note:66,duration:2,velocity:.8},{voice:'piano',note:69,duration:2,velocity:.8}]},{id:1,events:[],audioId:'voice',trackAnalysis:{key:'C minor',keyConfidence:1}}];
  assert.equal(sessionKey(pads,1,[0]).key,'D major');assert.equal(sessionKey(pads,1,[0]).source,'playing layers');
});
test('reverb impulses are stereo, bounded, decaying and reused per space',()=>{
  const context={sampleRate:8000,createBuffer:(channels,length)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return{length,numberOfChannels:channels,getChannelData:i=>data[i]};}};
  const impulse=reverbImpulse(context,'hall'),a=impulse.getChannelData(0),b=impulse.getChannelData(1);
  assert.equal(impulse.numberOfChannels,2);assert.ok(a.every(Number.isFinite));assert.notDeepEqual(a,b);assert.ok(a.slice(0,8000).reduce((s,v)=>s+v*v,0)>a.slice(-8000).reduce((s,v)=>s+v*v,0)*20);
  assert.equal(reverbImpulse(context,'hall'),impulse);assert.notEqual(reverbImpulse(context,'room'),impulse);
});
