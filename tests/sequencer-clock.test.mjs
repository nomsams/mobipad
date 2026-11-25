import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine} from '../js/engine.js';
import {defaultSession} from '../js/presets.js';
function sequence(hits){
  const e=new AudioEngine(defaultSession());e.session.bpm=120;e.session.swing=0;e.session.seqEnabled=true;
  e.session.pattern=Object.fromEntries(['kick','snare','hat','clap'].map(v=>[v,Array.from({length:16},(_,i)=>v==='kick'&&hits.includes(i))]));
  e.ctx={currentTime:10,state:'running'};let wall=10000;e.now=()=>wall;e.epoch=10200;e.running=true;e.metro=true;e.anchorAudioClock();
  const kicks=[],clicks=[];e.play=(event,time)=>{if(event.voice==='kick')kicks.push(time);};e.click=time=>clicks.push(time);
  const delays=[17,24,39,11,33,26,19];let elapsed=0,index=0;
  while(elapsed<8200){elapsed+=delays[index++%delays.length];e.ctx.currentTime=10+elapsed/1000;wall=10000+elapsed+([12,-9,4,-15][index%4]);e.schedule();}
  return {e,kicks,clicks};
}
test('quarter-note kicks retain exact spacing despite scheduler wake-up and wall-clock jitter',()=>{
  const {kicks,clicks}=sequence([0,4,8,12]);assert.ok(kicks.length>=16);
  kicks.forEach((time,i)=>{assert.ok(Math.abs(time-(10.2+i*.5))<1e-9);assert.ok(Math.abs(time-clicks[i])<1e-9);});
});
test('one kick on the first step repeats exactly on the bar with swing disabled',()=>{
  const {kicks}=sequence([0]);assert.ok(kicks.length>=4);kicks.forEach((time,i)=>assert.ok(Math.abs(time-(10.2+i*2))<1e-9));
});
test('shared clock corrections slew rather than moving the next kick by the full offset',()=>{
  const e=new AudioEngine(defaultSession());e.ctx={currentTime:10};e.epoch=10000;e.now=()=>10000;e.anchorAudioClock();const before=e.timeForBeat(4);
  e.clockOffset=100;e.ctx.currentTime+=.02;e.correctAudioClock();assert.ok(Math.abs(e.timeForBeat(4)-before)<.000201);assert.ok(e.clockCorrection<-.09);
});
test('visual beat position accounts for the output delay separately from audio scheduling',()=>{
  const e=new AudioEngine(defaultSession());e.session.bpm=120;e.session.outputOffset=20;e.running=true;e.audioEpoch=10;e.ctx={currentTime:11,baseLatency:.01,outputLatency:.03};
  assert.equal(e.position(),2);assert.ok(Math.abs(e.audiblePosition()-1.88)<1e-9);assert.equal(e.timeForBeat(4),12.02);
});
