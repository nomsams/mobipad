import {AudioEngine} from '../js/engine.js';
import {JamRoom} from '../js/jam.js';
import {defaultSession} from '../js/presets.js';
import {saveSession,getSamples,loadSession} from '../js/storage.js';
const $=selector=>document.querySelector(selector),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const deadline=performance.now()+4000;while(!check()){if(performance.now()>deadline)throw Error(label+' timed out');await pause(10);}}
function assert(value,message){if(!value)throw Error(message);}
await saveSession(defaultSession());localStorage.setItem('mobipad-display',JSON.stringify({layout:'compact',resources:'eco'}));localStorage.removeItem('mobipad-room');
let engine,flush,room;
const init=AudioEngine.prototype.init;
AudioEngine.prototype.init=function(...args){engine=this;return init.apply(this,args);};
AudioEngine.prototype.beginMic=async function(){return {chunks:[],close(){},stop:()=>new Promise(resolve=>flush=resolve)};};
JamRoom.prototype.create=async function(){room=this;this.role='follower';this.room='QATEST';this.peer={destroy(){}};this.emit('room',{role:this.role,room:this.room});return this.room;};
await import('../js/app.js');
const panel=document.createElement('section');panel.style.cssText='position:fixed;inset:0 auto auto 0;z-index:10000;background:#19201a;color:#caee91;padding:12px;width:min(620px,100vw);box-sizing:border-box;font:14px system-ui';
panel.innerHTML='<button id="qa-run" style="padding:12px">Run app recovery checks</button><pre id="qa-results" role="status" style="white-space:pre-wrap;line-height:1.6">Uses generated data and simulated mic flush; no microphone access.</pre>';
document.body.append(panel);const output=$('#qa-results'),report=message=>output.textContent+=message+'\n';
$('#qa-run').onclick=async()=>{
  $('#qa-run').disabled=true;output.textContent='';
  try{
    $('[data-view="instruments"]').click();await until(()=>engine?.ctx?.state==='running','Audio wake');engine.master.gain.value=0;
    $('[data-view="pads"]').click();const pad=$('.pad');
    pad.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));
    await until(()=>engine.running&&(engine.pending.has(0)||engine.active.has(0)),'Keyboard pad start');
    pad.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',repeat:true,bubbles:true,cancelable:true}));await pause(30);
    assert(engine.running&&(engine.pending.get(0)?.on??engine.active.has(0)),'Space toggled transport or repeated a held pad');
    report('PASS · Space on a pad triggers once and keeps the transport running.');
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'q',code:'KeyQ',ctrlKey:true,bubbles:true}));await pause(30);
    assert(!engine.pending.has(4)&&!engine.active.has(4),'Modified shortcut triggered a pad');report('PASS · Ctrl shortcuts do not play samples.');
    const space=new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true});$('#metro-btn').dispatchEvent(space);
    assert(!space.defaultPrevented&&engine.running,'A focused control hijacked Space transport');report('PASS · Focused controls retain native Space behavior.');
    $('#stop-btn').click();await until(()=>!engine.running,'Stop');$('#shot-mode').click();
    let scheduled=0,setup=0;const oneShot=engine.oneShot,originalInit=engine.init;
    engine.oneShot=()=>scheduled++;engine.init=async()=>{setup++;};
    document.querySelectorAll('.pad')[8].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    assert(scheduled===1&&setup===0,'Warm one shot waited for setup');engine.oneShot=oneShot;engine.init=originalInit;
    report('PASS · Warm one-shot scheduling is synchronous and skips setup.');$('#loop-mode').click();
    $('#mic-btn').click();await until(()=>engine.capture?.kind==='mic','Recording arm');const target=engine.capture.id;
    engine.capture.end=engine.now()-100;engine.schedule();await until(()=>Boolean(flush),'Take finalization');
    $('#stop-btn').click();assert(!engine.running,'Stop waited for microphone flush');flush();await pause(150);
    assert(engine.session.pads[target].kind==='empty','A stopped take overwrote its pad');report('PASS · Stop is immediate and cancels a pending take commit.');
    $('#room-code').value='QATEST';$('#join-btn').click();await until(()=>Boolean(room),'Simulated room');
    const snapshot=defaultSession();snapshot.name='Ordered room';snapshot.pattern.kick.fill(false);
    room.emit('snapshot',{session:snapshot,running:false,epoch:0,active:[],pending:[]});
    room.emit('accepted',{action:{type:'step',voice:'kick',index:0,on:true}});
    await until(()=>engine.session.name==='Ordered room'&&engine.session.pattern.kick[0],'Snapshot ordering');
    report('PASS · A snapshot and its following edit apply in connection order.');
    $('#leave-btn').click();await until(()=>room.role===null,'Room leave');
    const state=JSON.stringify(engine.session.pattern);room.emit('accepted',{action:{type:'step',voice:'kick',index:2,on:true}});await pause(40);
    assert(JSON.stringify(engine.session.pattern)===state,'A retired room edit changed the session');
    report('PASS · Retired room updates cannot change the local project.');
    const libraryBefore=await getSamples(),previousName=engine.session.name,archiveSession=defaultSession();archiveSession.name='Restored archive';Object.assign(archiveSession.pads[12],{kind:'audio',audioId:'fixture-source'});
    const buffer=engine.ctx.createBuffer(1,4800,48000);for(let i=0;i<buffer.length;i++)buffer.getChannelData(0)[i]=Math.sin(2*Math.PI*440*i/48000)*.2;
    const encoded=btoa(String.fromCharCode(...new Uint8Array(engine.bufferWav(buffer)))),sample={id:'fixture-source',name:'Fixture',type:'audio/wav',data:encoded};
    async function importArchive(archive){
      const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(archive)],'fixture.mobipad.json',{type:'application/json'}));$('#project-file').files=transfer.files;
      $('#project-file').dispatchEvent(new Event('change'));await until(()=>!$('#project-import').disabled,'Project import');
    }
    await importArchive({session:archiveSession,audio:[sample,{id:'broken',name:'Broken',data:btoa('invalid audio')}]});
    assert(engine.session.name===previousName&&(await getSamples()).length===libraryBefore.length,'Failed import changed the project or library');
    report('PASS · A corrupt later sample leaves the project and library unchanged.');
    await importArchive({session:archiveSession,audio:[sample]});
    assert(engine.session.name==='Restored archive'&&engine.session.pads[12].audioId!=='fixture-source','Import did not remap sample IDs');
    assert((await loadSession()).name==='Restored archive'&&(await getSamples()).length===libraryBefore.length+1,'Project and sample were not saved together');
    report('PASS · A valid archive restores with fresh IDs and an atomic project save.');
    report('ALL APP RECOVERY CHECKS PASSED');
  }catch(error){report('FAIL · '+error.message);console.error(error);}finally{flush?.();engine?.stop();$('#qa-run').disabled=false;}
};
