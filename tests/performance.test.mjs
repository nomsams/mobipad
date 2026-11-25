import test from 'node:test';
import assert from 'node:assert/strict';
import {NoteMemory,smartGroove,captureScene,normalizeScenes,validPattern} from '../js/performance.js';
import {defaultSession,validateSession} from '../js/presets.js';
import {AudioEngine} from '../js/engine.js';
import {PerformanceTools} from '../js/performance-tools.js';
test('Catch recovers a bar-aligned phrase with its original preset, tone and triplets',()=>{
  const memory=new NoteMemory(),event={voice:'synth',sound:'glass',note:60,duration:.3,velocity:.6,tone:{cutoff:1000}};
  memory.remember(event,10000,10000);event.tone.cutoff=9000;memory.remember({...event,note:64},11666.6666667,10000);
  const take=memory.capture({now:11800,bpm:120,beats:4,bars:2,quantize:false});assert.equal(take.start,8000);assert.equal(take.events[0].beat,4);assert.equal(take.events[0].tone.cutoff,1000);assert.ok(Math.abs(take.events[1].beat-(4+10/3))<1e-6);
  const s=defaultSession();Object.assign(s.pads[12],{kind:'loop',events:take.events,bars:take.bars});assert.doesNotThrow(()=>validateSession(s));
});
test('Catch clips sustained notes at loop edges, isolates transport epochs and expires old history',()=>{
  const m=new NoteMemory(),e={voice:'piano',note:60,duration:5,velocity:.7};m.remember(e,5000,0);m.remember({...e,note:62},9000,8000);
  const take=m.capture({now:9100,bpm:120,beats:4,bars:1});assert.equal(take.events.length,1);assert.equal(take.events[0].note,62);assert.ok(take.events[0].beat+take.events[0].duration<=4);
  assert.throws(()=>m.capture({now:100000,bpm:120,beats:4,bars:1}),/Play a few/);
});
test('Smart drums are reproducible, follow odd meters, honor locks, and support a silent density',()=>{
  for(const beats of [3,4,5,6,7])for(const style of ['house','break','half','euclidean']){
    const previous=defaultSession().pattern,result=smartGroove({beats,style,density:.8,seed:13,previous,locked:['kick']});assert.equal(validPattern(result,beats),true);
    assert.deepEqual(result.kick,Array.from({length:beats*4},(_,i)=>Boolean(previous.kick[i])));assert.deepEqual(result,smartGroove({beats,style,density:.8,seed:13,previous,locked:['kick']}));
  }
  assert.ok(Object.values(smartGroove({density:0})).every(row=>row.every(x=>!x)));
  assert.notDeepEqual(smartGroove({density:.8,seed:5}),smartGroove({density:.8,seed:8}));
});
test('scenes capture audible pending combinations, migrate old projects and reject malformed references',()=>{
  const s=defaultSession();s.seqEnabled=true;const scene=captureScene(s,new Map([[0,{}],[1,{}],[8,{}]]),new Map([[0,{on:false}],[2,{on:true}]]),new Set([1]),'Chorus','one');
  assert.deepEqual(scene.padIds,[2]);s.scenes=[scene];const restored=validateSession(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored.scenes,[scene]);
  delete s.scenes;assert.deepEqual(validateSession(s).scenes,[]);assert.throws(()=>normalizeScenes([{...scene,padIds:[16]}]));assert.throws(()=>normalizeScenes([scene,scene]));
});
test('scene loops and drum pattern switch together at the audio boundary, never on the previous step',()=>{
  const s=defaultSession(),e=new AudioEngine(s),played=[],launched=[],stops=[];e.ctx={currentTime:11.8,state:'running'};e.running=true;s.bpm=120;s.seqEnabled=true;s.pattern.kick.fill(false);e.active.set(0,{start:0});
  s.pads[12]={...s.pads[12],kind:'audio',audioId:'clip'};e.play=(event,time)=>played.push({event,time});e.launchAudio=(...args)=>launched.push(args);e.cancelPad=(id,time)=>stops.push({id,time});
  const scene=captureScene(s,new Map([[1,{}],[12,{}]]),new Map(),new Set(),'Chorus','two');scene.pattern.kick[0]=true;e.queueScene(scene,4);
  e.scheduleStep(3.75,11.875);assert.ok(e.active.has(0));assert.equal(s.pattern.kick[0],false);assert.equal(launched.length,0);
  e.scheduleStep(4,12);assert.deepEqual([...e.active.keys()],[1,12]);assert.equal(s.pattern.kick[0],true);assert.deepEqual(launched,[[12,12,4,0]]);assert.ok(stops.every(s=>s.time===12));assert.ok(played.some(p=>p.event.voice==='kick'&&p.time===12));assert.equal(e.pendingScene,null);
});
test('Stop cancels a queued scene and frees its sample cache pin',()=>{
  const s=defaultSession(),e=new AudioEngine(s);e.running=true;e.ctx={currentTime:1};Object.assign(s.pads[12],{kind:'audio',audioId:'clip'});
  const scene=captureScene(s,new Map([[12,{}]]),new Map(),new Set(),'Next','pin');e.queueScene(scene,4);assert.equal(e.isSamplePinned('clip'),true);e.stop();assert.equal(e.pendingScene,null);assert.equal(e.isSamplePinned('clip'),false);
});
test('the latest scene tap wins when earlier sample preparation finishes late',async()=>{
  const s=defaultSession(),p=Object.create(PerformanceTools.prototype),resolves=[],sent=[];
  Object.assign(p,{generation:0,launchToken:0,audio:{running:true,position:()=>1},getSession:()=>s,leader(){},refresh(){},notify(){},ready:()=>new Promise(resolve=>resolves.push(resolve)),send:a=>sent.push(a)});
  const first=captureScene(s,new Map(),new Map(),new Set(),'Verse','first'),last={...first,id:'last',name:'Chorus'};
  const old=p.launch(first),latest=p.launch(last);resolves[1]();await latest;resolves[0]();await old;
  assert.deepEqual(sent.map(a=>a.scene.name),['Chorus']);assert.equal(p.audio.scenePreparing,null);
});
