const rows=['kick','snare','hat','clap'];
export function validPattern(pattern,beats){return Boolean(pattern&&[3,4,5,6,7].includes(beats)&&rows.every(v=>Array.isArray(pattern[v])&&pattern[v].length===beats*4&&pattern[v].every(x=>typeof x==='boolean')));}
export function normalizeScenes(input){
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>8)throw new Error('A project can contain up to eight scenes.');
  const ids=new Set();
  return input.map(s=>{
    if(!s||typeof s.id!=='string'||!s.id.length||s.id.length>80||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>40||!Array.isArray(s.padIds)||s.padIds.length>16||new Set(s.padIds).size!==s.padIds.length||s.padIds.some(id=>!Number.isInteger(id)||id<0||id>15)||typeof s.seqEnabled!=='boolean'||!Number.isFinite(s.swing)||s.swing<0||s.swing>60||!validPattern(s.pattern,s.beats))throw new Error('Invalid performance scene.');
    ids.add(s.id);return {id:s.id,name:s.name,beats:s.beats,padIds:[...s.padIds],seqEnabled:s.seqEnabled,swing:s.swing,pattern:structuredClone(s.pattern)};
  });
}
export function captureScene(session,active,pending,muted,name,id){
  const playing=new Set(active.keys());for(const [pad,change] of pending)change.on?playing.add(pad):playing.delete(pad);
  const padIds=[...playing].filter(i=>!muted.has(i)&&['loop','audio'].includes(session.pads[i]?.kind)).sort((a,b)=>a-b);
  return normalizeScenes([{id,name:name.trim(),beats:session.beats,padIds,seqEnabled:session.seqEnabled,swing:session.swing,pattern:session.pattern}])[0];
}
function euclidean(steps,pulses,rotate=0){return Array.from({length:steps},(_,i)=>((i-rotate+steps)*pulses)%steps<pulses);}
export function smartGroove({beats=4,density=.5,style='house',seed=1,previous={},locked=[]}={}){
  if(![3,4,5,6,7].includes(beats)||!Number.isFinite(density)||density<0||density>1||!['house','break','half','euclidean'].includes(style))throw new Error('Invalid groove settings.');
  let state=(seed>>>0)||1;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const steps=beats*4,result=Object.fromEntries(rows.map(v=>[v,Array(steps).fill(false)]));
  if(density>0){
    if(style==='euclidean'){
      const amounts=[.3,.16,.75,.12];rows.forEach((v,i)=>result[v]=euclidean(steps,Math.max(1,Math.round(steps*amounts[i]*density)),Math.floor(random()*4)));
    }else{
      result.kick[0]=true;
      for(let i=1;i<steps;i++){
        result.kick[i]=style==='house'?i%4===0&&random()<.3+.7*density:(i%2===0&&random()<density*.32);
        const backbeat=style==='half'?i===Math.floor(beats/2)*4:i%8===4;
        result.snare[i]=backbeat||density>.7&&i%4===3&&random()<(density-.7)*.6;
        result.hat[i]=(i%2===0&&random()<.25+.75*density)||(i%2===1&&random()<density*density*.35);
        result.clap[i]=backbeat&&random()<density*.7;
      }
    }
  }
  for(const v of rows)if(locked.includes(v)&&Array.isArray(previous[v]))result[v]=Array.from({length:steps},(_,i)=>Boolean(previous[v][i]));
  return result;
}
export class NoteMemory {
  constructor(){this.entries=[];}
  clear(){this.entries=[];}
  remember(event,at,epoch=null){
    if(!Number.isFinite(at)||!Number.isFinite(event.duration)||event.duration<=0)return;
    this.entries.push({event:structuredClone(event),at,epoch});this.prune(at);
  }
  prune(now){this.entries=this.entries.filter(n=>n.at>=now-90000).slice(-4096);}
  capture({now,bpm,beats,bars,quantize=true}){
    if(!Number.isFinite(now)||!Number.isFinite(bpm)||bpm<40||bpm>240||![3,4,5,6,7].includes(beats)||![1,2,4,8].includes(bars))throw new Error('Invalid capture timing.');
    this.prune(now);const entries=this.entries.filter(n=>n.at<=now+100).sort((a,b)=>a.at-b.at),last=entries.at(-1);
    if(!last)throw new Error('Play a few instrument notes first. Catch keeps your last 90 seconds on this phone.');
    const spb=60000/bpm,span=beats*bars,origin=last.epoch??entries[0].at;
    const end=origin+(Math.floor((last.at-origin)/spb/beats)+1)*beats*spb,start=end-span*spb,events=[];
    for(const n of entries){
      if(n.epoch!==last.epoch)continue;
      const endAt=Math.min(end,n.at+n.event.duration*1000);if(endAt<=start||n.at>=end)continue;
      let beat=Math.max(0,(n.at-start)/spb),duration=(endAt-Math.max(start,n.at))/spb;
      if(quantize){const snapped=Math.round(beat*4)/4;duration=Math.max(.0625,duration+beat-snapped);beat=snapped;}
      if(beat>=span)continue;duration=Math.min(duration,span-beat);
      for(let offset=0;offset<duration-.001;offset+=30)events.push({...structuredClone(n.event),beat:beat+offset,duration:Math.min(30,duration-offset)});
    }
    if(!events.length)throw new Error('No notes in those bars. Try a longer capture window.');
    if(events.length>4096)throw new Error('That idea has too many notes. Choose a shorter capture window.');
    return {events:events.sort((a,b)=>a.beat-b.beat),bars,start,epoch:last.epoch};
  }
}
