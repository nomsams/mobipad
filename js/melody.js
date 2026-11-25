import {keyFromChroma} from './track-analysis.js';
const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const musicalKeys=names.flatMap(n=>[n+' major',n+' minor']);
export function scaleNotes(key){
  const index=musicalKeys.indexOf(key);if(index<0)return null;
  const root=Math.floor(index/2),scale=index%2?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11];
  return scale.map(n=>(n+root)%12);
}
export function tuneNote(midi,key){
  const scale=scaleNotes(key);let best=Math.round(midi),distance=Infinity;
  for(let n=Math.floor(midi)-2;n<=Math.ceil(midi)+2;n++)if(n>=0&&n<=127&&(!scale||scale.includes(n%12))&&Math.abs(midi-n)<distance){best=n;distance=Math.abs(midi-n);}
  return best;
}
// YIN cumulative mean-normalized difference, with parabolic lag refinement.
export function pitchFrame(samples,offset,rate){
  const window=256,min=Math.max(2,Math.floor(rate/1100)),max=Math.min(160,Math.ceil(rate/65));
  if(offset+window+max>=samples.length)return null;
  let energy=0,mean=0;for(let i=0;i<window;i++){const v=samples[offset+i];energy+=v*v;mean+=v;}
  const rms=Math.sqrt(Math.max(0,energy/window-(mean/window)**2));if(rms<.004)return null;
  const diff=new Float64Array(max+1);let sum=0;
  for(let lag=1;lag<=max;lag++){
    let d=0;for(let i=0;i<window;i++){const x=samples[offset+i]-samples[offset+i+lag];d+=x*x;}
    sum+=d;diff[lag]=sum?d*lag/sum:1;
  }
  let best=-1;
  for(let lag=min;lag<max;lag++)if(diff[lag]<.15){while(lag+1<=max&&diff[lag+1]<diff[lag])lag++;best=lag;break;}
  if(best<0)return null;
  const a=diff[best-1]??diff[best],b=diff[best],c=diff[best+1]??b,denom=a-2*b+c;
  const lag=best+(Math.abs(denom)>1e-9?.5*(a-c)/denom:0),frequency=rate/lag;
  if(frequency<65||frequency>1100)return null;
  return {midi:69+12*Math.log2(frequency/440),confidence:Math.max(0,1-b),rms};
}
export function transcribeMelody(samples,rate){
  if(rate!==8000||samples.length>rate*60)throw new Error('Auto synth needs an 8 kHz clip of at most 60 seconds.');
  const hop=80,frames=[];let maxRms=0;
  for(let offset=0;offset+420<samples.length;offset+=hop){const pitch=pitchFrame(samples,offset,rate);if(pitch)maxRms=Math.max(maxRms,pitch.rms);frames.push({time:(offset+192)/rate,...pitch});}
  const filtered=frames.map((f,i)=>{
    if(!Number.isFinite(f.midi)||f.rms<maxRms*.045||f.confidence<.82)return {...f,midi:null};
    const local=frames.slice(Math.max(0,i-2),i+3).filter(v=>Number.isFinite(v.midi)&&v.confidence>=.82).map(v=>v.midi).sort((a,b)=>a-b);
    return {...f,midi:local[Math.floor(local.length/2)]};
  });
  const notes=[];let current=null;
  const flush=()=>{if(current&&current.end-current.start>=.06)notes.push({...current,midi:current.total/current.count});current=null;};
  for(const f of filtered){
    const rounded=f.midi===null?null:Math.round(f.midi);
    if(rounded===null){flush();continue;}
    if(!current||current.note!==rounded){flush();current={note:rounded,start:Math.max(0,f.time-.005),end:f.time+.005,total:0,count:0,confidence:0,level:0};}
    current.end=f.time+.005;current.total+=f.midi;current.count++;current.confidence+=f.confidence;current.level+=f.rms;
  }
  flush();const chroma=new Array(12).fill(0);
  for(const n of notes){n.confidence/=n.count;n.level/=n.count;chroma[((n.note%12)+12)%12]+=n.end-n.start;delete n.total;delete n.count;}
  return {notes,...keyFromChroma(chroma),duration:samples.length/rate,voicedSeconds:notes.reduce((s,n)=>s+n.end-n.start,0)};
}
export function sessionKey(pads,excluded,active=[]){
  const tonal=pads.filter(p=>p.id!==excluded&&(p.audioId||p.events?.some(e=>['piano','synth','guitar','bass','bell'].includes(e.voice))));
  const playing=tonal.filter(p=>active.includes(p.id)),used=playing.length?playing:tonal,chroma=new Array(12).fill(0),votes=new Map();
  for(const p of used){
    for(const e of p.events||[])if(['piano','synth','guitar','bass','bell'].includes(e.voice))chroma[Math.round(e.note)%12]+=Math.min(4,e.duration)*(e.velocity||.5)*(p.volume||.75);
    const a=p.trackAnalysis;if(musicalKeys.includes(a?.key)&&a.keyConfidence>=.25)votes.set(a.key,(votes.get(a.key)||0)+a.keyConfidence*2);
  }
  const detected=keyFromChroma(chroma);if(detected.key&&detected.keyConfidence>.15)votes.set(detected.key,(votes.get(detected.key)||0)+detected.keyConfidence*3);
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]);return {key:ranked[0]?.[0]||null,source:playing.length?'playing layers':'session layers',conflicting:ranked.length>1&&ranked[1][1]>ranked[0][1]*.7};
}
export function melodyEvents(result,{beats,key='chromatic',voice='synth',sound='pure',tone={},timing='natural'}={}){
  if(!Number.isFinite(beats)||beats<=0||beats>224||!result.duration)throw new Error('Choose a clip length of 224 beats or less for Auto synth.');
  const scale=beats/result.duration,events=[];
  for(const n of result.notes){
    let start=n.start*scale,end=Math.min(beats,n.end*scale);
    if(timing==='grid'){start=Math.round(start*4)/4;end=Math.max(start+.125,Math.round(end*4)/4);}
    end=Math.min(beats,end);if(start>=beats||end-start<.02)continue;
    for(let beat=start;beat<end-.01;beat+=30)events.push({voice,sound,tone:{...tone},note:tuneNote(n.midi,key),beat,duration:Math.min(30,end-beat),velocity:.7});
  }
  if(!events.length)throw new Error('No clear melody found. Sing one note at a time, use headphones, and reduce background sound.');
  return events;
}
