import test from 'node:test';
import assert from 'node:assert/strict';
import {ScreenWakeLock} from '../js/wake-lock.js';
function sentinel(){const held=new EventTarget();held.released=false;held.release=async()=>{held.released=true;held.dispatchEvent(new Event('release'));};return held;}
test('Stop releases a wake lock that arrives after its request was cancelled',async()=>{
  let finish,requests=0;const held=sentinel(),wake=new ScreenWakeLock(()=>{requests++;return new Promise(resolve=>finish=resolve);});
  const pending=wake.set(true);wake.set(true);assert.equal(requests,1);await wake.set(false);finish(held);await pending;
  assert.equal(held.released,true);assert.equal(wake.sentinel,null);
});
test('turning the preference off releases immediately and a later start can acquire again',async()=>{
  const locks=[],wake=new ScreenWakeLock(async()=>{const held=sentinel();locks.push(held);return held;});
  await wake.set(true);await wake.set(true);assert.equal(locks.length,1);await wake.set(false);assert.equal(locks[0].released,true);
  await wake.set(true);assert.equal(locks.length,2);await locks[1].release();assert.equal(wake.sentinel,null);
});
