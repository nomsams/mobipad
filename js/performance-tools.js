import {NoteMemory,captureScene,smartGroove} from './performance.js';
import {nextBoundary,beatDuration} from './timing.js';
const $=s=>document.querySelector(s);
export class PerformanceTools {
  constructor({audio,getSession,getRole,ready,send,commitCapture,notify}){
    Object.assign(this,{audio,getSession,getRole,ready,send,commitCapture,notify});this.memory=new NoteMemory();this.generation=0;this.launchToken=0;
    $('#performance-btn').onclick=()=>{this.refresh();$('#performance-dialog').showModal();};
    $('#catch-save').onclick=()=>this.attempt(()=>this.catchIdea());$('#catch-quick').onclick=()=>this.attempt(()=>this.catchIdea());
    $('#catch-clear').onclick=()=>{this.resetMemory();this.refresh();this.notify('Instrument note history cleared.');};
    $('#scene-save').onclick=()=>this.attempt(()=>this.saveScene());
    $('#scene-cancel').onclick=()=>this.attempt(()=>{this.leader();this.launchToken++;this.loadingScene=null;this.audio.scenePreparing=null;this.send({type:'scenecancel'});this.refresh();});
    $('#groove-generate').onclick=()=>this.attempt(()=>this.generate());
    $('#groove-undo').onclick=()=>this.attempt(()=>this.undoGroove());
    $('#groove-density').oninput=()=>$('#groove-density-value').textContent=$('#groove-density').value+'%';
    audio.addEventListener('transport',()=>{if(!audio.running){this.generation++;this.launchToken++;this.loadingScene=null;this.audio.scenePreparing=null;}this.refresh();});
    audio.addEventListener('scenequeued',()=>this.refresh());
  }
  async attempt(fn){try{await fn();}catch(e){this.notify(e.message,true);}}
  leader(){if(this.getRole()==='follower')throw new Error('The room leader controls scenes.');}
  remember(event,at,epoch){this.memory.remember(event,at,epoch);$('#catch-quick').disabled=false;}
  resetMemory(){this.memory.clear();$('#catch-quick').disabled=true;}
  async catchIdea(){
    const s=this.getSession(),take=this.memory.capture({now:this.audio.now(),bpm:s.bpm,beats:s.beats,bars:Number($('#catch-bars').value),quantize:$('#catch-quantize').checked});
    await this.commitCapture(take);if($('#performance-dialog').open)$('#performance-dialog').close();
    this.notify(`Caught ${take.events.length} notes into a ${take.bars}-bar loop.`);
  }
  saveScene(){
    this.leader();const s=this.getSession();if(s.scenes.length>=8)throw new Error('Eight scenes are saved. Remove one before saving another.');
    const scene=captureScene(s,this.audio.active,this.audio.pending,this.audio.muted,$('#scene-name').value||'Scene '+(s.scenes.length+1),crypto.randomUUID());
    this.send({type:'scenes',scenes:[...s.scenes,scene]});$('#scene-name').value='';this.notify('Scene saved. Launch it on the next bar.');
  }
  async launch(scene){
    this.leader();const generation=this.generation,s=this.getSession(),token=++this.launchToken;
    this.loadingScene=scene.name;this.audio.scenePreparing=new Set(scene.padIds);this.refresh();
    try{
      await this.ready();
      for(const id of scene.padIds){const p=s.pads[id];if(p.audioId){await this.ready(p.audioId);await this.audio.preparePad(id);}}
      if(generation!==this.generation||s!==this.getSession()||token!==this.launchToken)return;
      if(!this.audio.running)this.send({type:'start',epoch:this.audio.now()+250});
      const beat=nextBoundary(this.audio.position()+Math.max(160,s.jamBuffer)/(beatDuration(s.bpm)*1000),s.beats);
      this.send({type:'scene',scene,beat});this.notify(scene.name+' queued for the next bar.');
    }finally{if(token===this.launchToken){this.audio.scenePreparing=null;this.loadingScene=null;this.refresh();}}
  }
  async generate(){
    await this.ready();const s=this.getSession(),previous=structuredClone(s.pattern),enabled=s.seqEnabled;
    const pattern=smartGroove({beats:s.beats,density:Number($('#groove-density').value)/100,style:$('#groove-style').value,seed:crypto.getRandomValues(new Uint32Array(1))[0],previous,locked:[...document.querySelectorAll('[data-groove-lock]:checked')].map(e=>e.dataset.grooveLock)});
    this.grooveUndo={previous,enabled,expected:JSON.stringify(pattern),beats:s.beats};
    this.send({type:'groove',pattern,enabled:true,beats:s.beats});
    if(!this.audio.running&&this.getRole()!=='follower')this.send({type:'start',epoch:this.audio.now()+250});
    this.notify('New groove ready. Locked rows stayed in place.');this.refresh();
  }
  undoGroove(){
    const s=this.getSession(),u=this.grooveUndo;
    if(!u||u.beats!==s.beats||JSON.stringify(s.pattern)!==u.expected)throw new Error('The pattern changed after that variation. Undo is no longer available.');
    this.grooveUndo=null;this.send({type:'groove',pattern:u.previous,enabled:u.enabled,beats:s.beats});this.refresh();
  }
  refresh(){
    const s=this.getSession(),pending=this.audio.pendingScene,container=$('#scene-list');container.replaceChildren();
    $('#scene-status').textContent=this.loadingScene?'Preparing '+this.loadingScene+'…':pending?pending.scene.name+' · queued on bar '+(Math.floor(pending.beat/s.beats)+1):this.audio.lastScene?'Scene playing':'Save your current loop combination, then launch it with one tap.';
    $('#scene-cancel').hidden=!pending&&!this.loadingScene;
    if(!s.scenes.length){const p=document.createElement('p');p.className='view-note';p.textContent='No scenes yet. Start a few loops and save your first scene.';container.append(p);}
    for(const scene of s.scenes){
      const row=document.createElement('div'),launch=document.createElement('button'),remove=document.createElement('button');row.className='scene-row';launch.className='button subtle scene-launch';
      launch.textContent=scene.name+(pending?.scene.id===scene.id?' · queued':this.audio.lastScene===scene.id?' · playing':'');launch.setAttribute('aria-label','Launch scene '+scene.name);
      launch.disabled=this.getRole()==='follower';launch.onclick=()=>this.attempt(()=>this.launch(scene));
      const info=document.createElement('small');info.textContent=scene.padIds.length+' loops'+(scene.seqEnabled?' + drums':'');
      remove.className='button danger';remove.textContent='×';remove.setAttribute('aria-label','Remove scene '+scene.name);remove.onclick=()=>this.attempt(()=>{this.leader();this.send({type:'scenes',scenes:s.scenes.filter(x=>x.id!==scene.id)});});
      row.append(launch,info,remove);container.append(row);
    }
    this.memory.prune(this.audio.now());$('#catch-status').textContent=this.memory.entries.length?this.memory.entries.length+' recent instrument notes on this phone.':'Play instruments freely, then catch the idea you just played.';
    $('#catch-save').disabled=!this.memory.entries.length;
    $('#groove-undo').disabled=!this.grooveUndo||this.grooveUndo.beats!==s.beats||JSON.stringify(s.pattern)!==this.grooveUndo.expected;
  }
}
