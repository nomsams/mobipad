import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine} from '../js/engine.js';
import {InstrumentRack} from '../js/instrument-rack.js';
import {defaultSession} from '../js/presets.js';
import {JamRoom} from '../js/jam.js';

test('microphone Stop releases resources when an interrupted worklet never replies',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const engine=new AudioEngine(defaultSession());let closes=0;
  engine.openMic=async()=>({node:{port:{postMessage(){}}},close(){closes++;}});
  const take=await engine.beginMic(0,1),stop=take.stop();assert.equal(take.stop(),stop);
  t.mock.timers.tick(1201);await stop;take.close();assert.equal(closes,1);assert.equal(take.node.port.onmessage,null);
});
test('microphone Stop waits for the final chunk before closing normally',async()=>{
  const engine=new AudioEngine(defaultSession());let port,closed=false;
  engine.openMic=async()=>({node:{port:port={postMessage(message){if(message.type==='stop')queueMicrotask(()=>{port.onmessage({data:{type:'samples',samples:new Float32Array([1]),time:0}});port.onmessage({data:{type:'stopped'}});});}}},close(){closed=true;}});
  const take=await engine.beginMic(0,1);await take.stop();assert.equal(take.chunks.length,1);assert.equal(closed,true);
});
test('audio interruption discards old sources and resumes at the current shared phase',()=>{
  const e=new AudioEngine(defaultSession());e.ctx={state:'suspended'};e.running=true;e.epoch=123;e.position=()=>20.3;e.active.set(12,{start:0});
  let stopped=0,scheduled=0,resumed=[];e.nodes.add({stop(){stopped++;}});e.resumeAudioPad=id=>resumed.push(id);e.schedule=()=>scheduled++;
  e.handleAudioState();e.ctx.state='running';e.handleAudioState();
  assert.equal(stopped,1);assert.equal(e.nodes.size,0);assert.equal(e.nextStep,82);assert.equal(e.epoch,123);assert.deepEqual(resumed,[12]);assert.equal(scheduled,1);
});
test('Stop disconnects feedback delay lines and the old pad buses',()=>{
  const e=new AudioEngine(defaultSession());let disconnected=0;const node=()=>({disconnect(){disconnected++;}});
  e.padEffects.set(0,{delay:node(),wet:node(),feedback:node()});e.padBuses=new Map([[0,node()]]);e.stop();
  assert.equal(disconnected,4);assert.equal(e.padEffects.size,0);assert.equal(e.padBuses.size,0);
});
test('a pending instrument press cannot sound after the rack is released',async()=>{
  const r=Object.create(InstrumentRack.prototype);let finish,played=0;
  Object.assign(r,{generation:1,voice:'piano',ready:()=>new Promise(resolve=>finish=resolve),perform:()=>played++});
  const pending=r.press(60,'key');r.generation++;finish();await pending;assert.equal(played,0);
});
test('jam startup, remembering and leaving work when browser storage is denied',t=>{
  for(const name of ['sessionStorage','localStorage']){
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,get(){throw new Error('Storage denied');}});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  }
  const r=new JamRoom();clearInterval(r.syncTimer);assert.ok(r.device);r.remember();r.leave();assert.equal(r.role,null);
});
test('replacing a sample invalidates the fitted audio cache',async()=>{
  const e=new AudioEngine(defaultSession());const b={duration:1,length:1000,sampleRate:1000,numberOfChannels:1};e.init=async()=>{};e.ctx={decodeAudioData:async()=>b};
  e.buffers.set('sample',b);e.session.pads[12].audioId='sample';const before=e.stretchKey(12);e.stretchedBuffers.set(before,b);
  await e.decode('sample',new ArrayBuffer(4));assert.notEqual(e.stretchKey(12),before);assert.equal(e.stretchedBuffers.has(before),false);
});
