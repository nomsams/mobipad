import test from 'node:test';
import assert from 'node:assert/strict';
import {InstrumentRack} from '../js/instrument-rack.js';
import {defaultSession} from '../js/presets.js';
test('a warm drum press schedules its sound synchronously without waiting for setup or sample loading',async()=>{
  const r=Object.create(InstrumentRack.prototype),session=defaultSession();let played=0,ready=0;
  Object.assign(r,{generation:0,voice:'drums',audio:{ctx:{state:'running'}},getSession:()=>session,ready:()=>{ready++;return new Promise(()=>{});},perform:e=>{assert.equal(e.voice,'kick');played++;}});
  const result=r.press(60,'finger','kick');assert.equal(played,1);assert.equal(ready,0);await result;
});
