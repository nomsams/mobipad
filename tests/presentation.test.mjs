import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDevice,resolvePresentation,normalizePreferences,resourceProfiles,choosePadGrid} from '../js/device.js';
import {AudioCache,audioBytes} from '../js/audio-cache.js';
import {AudioEngine} from '../js/engine.js';
import {defaultSession} from '../js/presets.js';

test('iPads using desktop Safari identification default to vertical Stage even with a mouse',()=>{
  for(const coarse of [true,false])assert.deepEqual(resolvePresentation({}, {width:1366,height:1024,platform:'MacIntel',touchPoints:5,coarse}),{device:'tablet',layout:'compact',resources:'eco'});
  assert.equal(classifyDevice({userAgent:'Mozilla iPad',width:1024}),'tablet');
});
test('landscape chooses the pad arrangement with the largest minimum touch dimension',()=>{
  assert.deepEqual(choosePadGrid(668,270,true,4),{columns:8,rows:2});
  assert.deepEqual(choosePadGrid(392,196,true,4),{columns:4,rows:4});
  assert.deepEqual(choosePadGrid(1200,900,true),{columns:4,rows:4});
  assert.deepEqual(choosePadGrid(390,650,false),{columns:4,rows:4});
  assert.deepEqual(choosePadGrid(0,0,true),{columns:4,rows:4});
  for(const [width,height] of [[668,270],[392,196],[1200,900],[792,382]]){
    const grid=choosePadGrid(width,height,true,4),size=(columns)=>Math.min((width-(columns-1)*4)/columns,(height-(16/columns-1)*4)/(16/columns));
    assert.equal(grid.columns*grid.rows,16);assert.ok(size(grid.columns)>=size(grid.columns===4?8:4));
  }
});
test('phones, Android tablets and touch tablets use Stage in both orientations',()=>{
  for(const [width,height] of [[390,844],[844,390]])assert.equal(resolvePresentation({}, {width,height,userAgent:'Android Mobile',touchPoints:5}).layout,'compact');
  assert.equal(classifyDevice({width:1280,height:800,userAgent:'Android'}),'tablet');
  assert.equal(classifyDevice({width:1024,height:768,coarse:true}),'tablet');
  assert.equal(resolvePresentation({}, {width:320,height:568}).layout,'compact');
});
test('desktop defaults and explicit layout/resource overrides survive device detection',()=>{
  assert.deepEqual(resolvePresentation(),{device:'desktop',layout:'studio',resources:'full'});
  assert.equal(resolvePresentation({}, {cores:4}).resources,'eco');
  assert.deepEqual(resolvePresentation({layout:'studio',resources:'full'},{width:390}),{device:'phone',layout:'studio',resources:'full'});
  assert.deepEqual(normalizePreferences({layout:'broken',resources:null}),{layout:'auto',resources:'auto'});
  assert.deepEqual(normalizePreferences(null),{layout:'auto',resources:'auto'});
});
test('audio caches evict least recently used data by bytes, preserving active sounds',()=>{
  const c=new AudioCache(12,k=>k==='playing');
  c.set('playing',new Float32Array(1)).set('a',new Float32Array(1)).set('b',new Float32Array(1));
  c.get('a');c.set('c',new Float32Array(1));assert.equal(c.has('b'),false);assert.equal(c.has('playing'),true);assert.equal(c.bytes,12);
  c.setBudget(4);assert.deepEqual([...c.keys()],['playing']);
  c.set('oversized',new Float32Array(10));assert.equal(c.has('oversized'),true);assert.equal(c.bytes,44);
  c.trim();assert.equal(c.bytes,4);c.set('playing',new Float32Array(2));assert.equal(c.bytes,8);
  c.delete('playing');assert.equal(c.bytes,0);c.set('a',new Float32Array(1));c.clear();assert.equal(c.bytes,0);
  assert.equal(audioBytes({numberOfChannels:2,length:100}),800);
});
test('Eco keeps active and sequenced audio cached and leaves scheduler timing unchanged',()=>{
  const e=new AudioEngine(defaultSession());e.ctx={currentTime:0};e.running=true;e.session.seqEnabled=true;
  Object.assign(e.session.pads[12],{audioId:'loop',sequenceEnabled:true});
  e.buffers.set('loop',{numberOfChannels:2,length:5e6}); // Larger than Eco's soft budget.
  e.setResourceMode('eco');assert.equal(e.buffers.has('loop'),true);assert.equal(e.maxSources,resourceProfiles.eco.maxSources);
  e.running=false;e.session.pads[12].sequenceEnabled=false;e.buffers.trim();assert.equal(e.buffers.has('loop'),false);
  assert.ok(resourceProfiles.eco.fps<resourceProfiles.full.fps);
});
test('polyphony limiting shortens an old note tail instead of cutting a continuous sample loop',()=>{
  const e=new AudioEngine(defaultSession());e.maxSources=2;const stopped=[];
  const source=(name,loopVoice=false)=>({loopVoice,stop(){stopped.push(name);},disconnect(){}});
  const loop=source('loop',true),old=source('old'),fresh=source('fresh');e.track(loop,null,12);e.track(old);e.track(fresh);
  assert.deepEqual(stopped,['old']);assert.equal(e.nodes.has(loop),true);assert.equal(e.nodes.size,2);
});
