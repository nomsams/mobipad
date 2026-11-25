import test from 'node:test';
import assert from 'node:assert/strict';
import {InstrumentRack} from '../js/instrument-rack.js';
import {defaultSession} from '../js/presets.js';
import {AudioEngine} from '../js/engine.js';
test('a warm drum press schedules its sound synchronously without waiting for setup or sample loading',async()=>{
  const r=Object.create(InstrumentRack.prototype),session=defaultSession();let played=0,ready=0;
  Object.assign(r,{generation:0,voice:'drums',audio:{ctx:{state:'running'}},getSession:()=>session,ready:()=>{ready++;return new Promise(()=>{});},perform:e=>{assert.equal(e.voice,'kick');played++;}});
  const result=r.press(60,'finger','kick');assert.equal(played,1);assert.equal(ready,0);await result;
});
test('instrument warm-up is bounded, uses a silent route and never steals a live voice',()=>{
  const e=new AudioEngine(defaultSession()),played=[];e.ctx={state:'running',currentTime:1};e.play=(event,time,level,id)=>played.push({event,id});
  assert.equal(e.warmVoice('drums'),true);assert.equal(e.warmVoice('drums'),false);assert.deepEqual(played.map(p=>p.event.voice),['kick','hat']);assert.ok(played.every(p=>p.id==='warmup'));
  e.maxSources=1;let stopped=false;const live={stop(){stopped=true;},disconnect(){}};e.track(live,null,0);
  const warm={stop(){},disconnect(){}};e.track(warm,null,'warmup');assert.equal(stopped,false);assert.equal(e.nodes.size,1);assert.equal(e.warmNodes.size,1);warm.onended();assert.equal(e.warmNodes.size,0);
});
