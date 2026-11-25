import {validateSession} from './presets.js';

// Stage the complete archive before touching the current project or sample library.
export async function prepareProjectImport(data,{decode,analyze}){
  const session=validateSession(structuredClone(data?.session));
  if(!Array.isArray(data.audio)||data.audio.length>128)throw Error('Invalid project audio.');
  const ids=new Map(),sources=[];
  for(const item of data.audio){
    if(!item||typeof item.id!=='string'||!item.id.length||item.id.length>100||ids.has(item.id)||typeof item.name!=='string'||item.name.length>100||typeof item.data!=='string'||item.data.length>36*1024*1024||item.type!==undefined&&typeof item.type!=='string')throw Error('Invalid or duplicate project sample.');
    const id=crypto.randomUUID();ids.set(item.id,id);sources.push({...item,id});
  }
  for(const pad of session.pads)if(pad.audioId!==null){if(!ids.has(pad.audioId))throw Error('Project is missing an audio sample.');pad.audioId=ids.get(pad.audioId);}
  const samples=[];
  for(const item of sources){
    let binary;try{binary=atob(item.data);}catch{throw Error('Invalid project audio encoding.');}
    if(!binary.length||binary.length>25*1024*1024)throw Error('Project samples must be under 25 MB.');
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:item.type||'audio/wav'}),buffer=await decode(bytes.buffer);
    if(!(buffer.duration>0)||buffer.duration>600)throw Error('Project samples must be under ten minutes.');
    const analysis=await analyze(buffer);
    samples.push({id:item.id,name:item.name.slice(0,80),blob,duration:buffer.duration,analysis});
  }
  return {session,samples};
}
