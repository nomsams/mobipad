import {resourceProfiles} from './device.js';
let worker, serial = 0, idleTimer;
let idleDelay=resourceProfiles.full.workerIdle;
const pending = new Map();
function scheduleIdle(){
  clearTimeout(idleTimer);
  if(worker && !pending.size)idleTimer=setTimeout(()=>{worker?.terminate();worker=null;},idleDelay);
}
export function setDSPResourceMode(mode){idleDelay=resourceProfiles[mode==='eco'?'eco':'full'].workerIdle;scheduleIdle();}
function requestDSP(type,payload){
  clearTimeout(idleTimer);
  if(!worker){
    worker=new Worker(new URL('./audio-worker.js',import.meta.url),{type:'module'});
    const current=worker;
    current.onmessage=({data})=>{
      if(current!==worker)return;
      const task=pending.get(data.id);if(!task)return;
      pending.delete(data.id);clearTimeout(task.timer);
      data.error?task.reject(new Error(data.error)):task.resolve(data.result);
      scheduleIdle();
    };
    current.onerror=()=>{if(current===worker)failWorker(new Error('Audio processing failed. Try again.'));};
  }
  return new Promise((resolve,reject)=>{
    const id=++serial,timer=setTimeout(()=>failWorker(new Error('Audio processing took too long. Try a shorter sample.')),90000);
    pending.set(id,{resolve,reject,timer});
    const transfer=type==='stretch'?payload.channels.map(c=>c.buffer):[payload.samples.buffer];
    try{worker.postMessage({id,type,...payload},transfer);}catch(error){failWorker(error);}
  });
}
function failWorker(error){
  clearTimeout(idleTimer);worker?.terminate();worker=null;
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}
  pending.clear();
}
async function analyzeBuffer(buffer) {
  const rate = 11025, length = Math.min(Math.floor(buffer.duration * rate), rate * 90), samples = new Float32Array(length), channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < length; i++) {
    const index = Math.floor(i * buffer.sampleRate / rate);
    for (const channel of channels) samples[i] += channel[index] / channels.length;
  }
  return requestDSP("analyze", { samples, sampleRate: rate });
}
export function analyzeMelodyBuffer(buffer){
  if(buffer.duration>60)throw new Error('Trim the melody to 60 seconds or less for Auto synth.');
  const rate=8000,length=Math.floor(buffer.duration*rate),samples=new Float32Array(length),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  for(let i=0;i<length;i++){
    const start=Math.floor(i*buffer.sampleRate/rate),end=Math.min(buffer.length,Math.max(start+1,Math.floor((i+1)*buffer.sampleRate/rate)));
    for(const channel of channels)for(let j=start;j<end;j++)samples[i]+=channel[j]/(channels.length*(end-start));
  }
  return requestDSP('melody',{samples,sampleRate:rate});
}
export {
  analyzeBuffer,
  requestDSP
};
