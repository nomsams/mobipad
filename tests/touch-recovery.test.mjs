import test from 'node:test';
import assert from 'node:assert/strict';
import {InstrumentRack} from '../js/instrument-rack.js';
import {Arpeggiator} from '../js/arpeggiator.js';
import {defaultSession} from '../js/presets.js';

function rack(){
  const r=Object.create(InstrumentRack.prototype),session=defaultSession();session.rack.arp.enabled=true;
  Object.assign(r,{generation:0,voice:'piano',audio:{ctx:{state:'running'},running:true,arp:new Arpeggiator()},getSession:()=>session,pointers:new Map(),keyNotes:new Map(),slideNotes:new Map(),renderArpStatus(){},notify(message){throw Error(message);}});
  return r;
}
function button(){const classes=new Set();return {classes,classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},remove(name){classes.delete(name);}},setPointerCapture(){}};}
const pointer=id=>({pointerId:id,button:0,preventDefault(){}});

test('two fingers on one key remain independent while audio wakes',async()=>{
  const r=rack(),b=button(),waiting=[];r.audio.ctx.state='suspended';r.ready=()=>new Promise(resolve=>waiting.push(resolve));r.bindPlayable(b,60);
  const first=b.onpointerdown(pointer(1)),second=b.onpointerdown(pointer(2));b.onpointerup(pointer(1));
  waiting.forEach(resolve=>resolve());await Promise.all([first,second]);
  assert.deepEqual([...r.audio.arp.held.keys()],['pointer:2']);assert.equal(b.classes.has('pressed'),true);
  b.onlostpointercapture(pointer(2));assert.equal(r.audio.arp.held.size,0);assert.equal(b.classes.has('pressed'),false);
});
test('two fingers on a chord release only their own arpeggio notes',async()=>{
  const r=rack(),b=button();r.bindChord(b,[60,64,67],'C');
  await b.onpointerdown(pointer(1));await b.onpointerdown(pointer(2));assert.equal(r.audio.arp.held.size,6);
  b.onpointerup(pointer(1));assert.equal(r.audio.arp.held.size,3);assert.equal(b.classes.has('pressed'),true);
  b.onpointercancel(pointer(2));assert.equal(r.audio.arp.held.size,0);assert.equal(b.classes.has('pressed'),false);
});
test('releasing the rack during asynchronous arp startup cancels even a latched chord',async()=>{
  const r=rack();r.state().arp.latch=true;r.audio.running=false;let finish;
  r.startTransport=()=>new Promise(resolve=>finish=resolve);
  const press=r.press(60,'finger');r.generation++;r.pendingNotes.clear();finish();await press;
  assert.equal(r.audio.arp.held.size,0);assert.equal(r.audio.arp.latched.length,0);
});
test('a failed pointer capture still permits the sound and a clean release',async()=>{
  const r=rack(),b=button();b.setPointerCapture=()=>{throw Error('Pointer already released');};r.bindPlayable(b,60);
  await b.onpointerdown(pointer(3));assert.equal(r.audio.arp.held.size,1);
  b.onpointerup(pointer(3));assert.equal(r.audio.arp.held.size,0);
});
test('sliding a string cleans up its note marker and per-pointer state on release',()=>{
  const r=rack(),b=button();b.classes.add('pressed');r.slideNotes.set('finger',64);r.slideTargets=new Map([['finger',b]]);
  r.release('finger');assert.equal(r.slideNotes.size,0);assert.equal(r.slideTargets.size,0);assert.equal(b.classes.has('pressed'),false);
});
