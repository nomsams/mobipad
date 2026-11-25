import {analyzeMelodyBuffer} from './dsp-client.js';
import {musicalKeys,sessionKey,melodyEvents} from './melody.js';
import {noteName} from './sounds.js';
const $=s=>document.querySelector(s);
const voices={pure:['synth','pure'],piano:['piano','felt'],warm:['synth','warm'],glass:['synth','glass'],bass:['bass','finger'],guitar:['guitar','nylon']};
export class AutoSynth {
  constructor({audio,getSession,ready,commit,notify}){
    Object.assign(this,{audio,getSession,ready,commit,notify});this.serial=0;
    for(const key of musicalKeys)$('#auto-key').append(new Option(key,key));
    for(const id of ['#auto-key','#auto-voice','#auto-timing'])$(id).onchange=()=>this.attempt(()=>{this.stopPreview();this.describe();});
    $('#auto-preview').onclick=()=>this.attempt(()=>this.preview());
    $('#auto-create').onclick=()=>this.attempt(()=>this.create($('#auto-replace').checked));
    $('#auto-stop').onclick=()=>this.stopPreview();
    $('#auto-dialog').addEventListener('close',()=>{this.serial++;this.stopPreview();});
    audio.addEventListener('transport',()=>{if(!audio.running)this.stopPreview();});
    audio.addEventListener('audiostate',()=>{if(audio.ctx.state!=='running')this.stopPreview();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stopPreview();});
  }
  async attempt(fn){try{await fn();}catch(e){this.notify(e.message,true);}}
  async open(id,{automatic=false,startBeat=null}={}){
    this.stopPreview();this.audio.previewCleanup?.();const serial=++this.serial,session=this.getSession(),source=session.pads[id];
    this.result=null;this.source={id,session,audioId:source.audioId,startBeat};
    if(!automatic){$('#auto-reverb').value=(source.reverb||0)*100;$('#auto-space').value=source.reverbSpace||'room';$('#auto-echo').value=(source.echo||0)*100;$('#auto-dialog').showModal();$('#auto-report').textContent='Listening for the melody…';$('#auto-notes').textContent='';$('#auto-create').disabled=true;$('#auto-preview').disabled=true;}
    else this.notify('Auto synth is finding and tuning your melody…');
    try{
    await this.ready(source.audioId);
    const buffer=this.audio.sampleBuffer(id);if(!buffer)throw new Error('Record or import a melody first.');
    const result=await analyzeMelodyBuffer(buffer);
    if(serial!==this.serial||session!==this.getSession()||session.pads[id].audioId!==source.audioId)return;
    if(!result.notes.length)throw new Error('No clear melody found. Sing one note at a time and use headphones to keep backing sounds out of the microphone.');
    this.result=result;this.context=sessionKey(session.pads,id,[...this.audio.active.keys()]);
    if(automatic){$('#auto-key').value='auto';$('#auto-voice').value='pure';$('#auto-timing').value='natural';$('#auto-reverb').value=0;$('#auto-echo').value=0;await this.create(true);}
    else {this.describe();$('#auto-create').disabled=false;$('#auto-preview').disabled=false;}
    }catch(error){if(serial===this.serial&&!automatic)$('#auto-report').textContent=error.message;throw error;}
  }
  config(){
    const choice=$('#auto-key').value,key=choice==='auto'?(this.context.key||(this.result.keyConfidence>.15?this.result.key:null)||'chromatic'):choice;
    const [voice,sound]=voices[$('#auto-voice').value]||voices.pure;
    return {key,voice,sound,timing:$('#auto-timing').value,tone:{...this.getSession().rack.tone,attack:.006,release:.12,detune:0,cutoff:5000,resonance:.8},reverb:Number($('#auto-reverb').value)/100,reverbSpace:$('#auto-space').value,echo:Number($('#auto-echo').value)/100,echoTime:.25};
  }
  events(){
    if(!this.result)throw new Error('Wait for melody analysis to finish.');
    if(this.source.session!==this.getSession()||this.getSession().pads[this.source.id]?.audioId!==this.source.audioId)throw new Error('The source changed. Open Auto synth on that sample again.');
    const p=this.getSession().pads[this.source.id];return melodyEvents(this.result,{...this.config(),beats:p.bars*this.getSession().beats});
  }
  describe(){
    if(!this.result)return;const config=this.config(),events=this.events();
    $('#auto-report').textContent=`${events.length} notes · ${this.result.voicedSeconds.toFixed(1)}s voiced. Melody key: ${this.result.key||'uncertain'}. Backing: ${this.context.key||'uncertain'} from ${this.context.source}${this.context.conflicting?' (mixed evidence — check by ear)':''}. Tuning to ${config.key==='chromatic'?'nearest semitone':config.key}.`;
    $('#auto-notes').textContent=events.slice(0,24).map(e=>noteName(e.note)).join(' · ')+(events.length>24?' …':'');
  }
  stopPreview(){clearInterval(this.previewTimer);this.audio.cancelPad('autosynth-preview');this.previewTimer=null;}
  async preview(){
    const serial=this.serial;await this.ready();if(serial!==this.serial)return;this.stopPreview();const events=this.events(),spb=60/this.getSession().bpm,origin=this.audio.ctx.currentTime+.08;let index=0;
    const schedule=()=>{
      const horizon=this.audio.ctx.currentTime+.09;
      while(index<events.length&&origin+events[index].beat*spb<horizon){const e=events[index++];this.audio.play({...e,duration:e.duration*spb},origin+e.beat*spb,1,'autosynth-preview');}
      if(index===events.length){clearInterval(this.previewTimer);this.previewTimer=null;}
    };
    this.previewTimer=setInterval(schedule,20);schedule();
  }
  async create(replace){
    const events=this.events(),config=this.config();this.stopPreview();
    await this.commit({source:this.source,events,config,replace});
    if($('#auto-dialog').open)$('#auto-dialog').close();
    this.notify(`Auto synth created · ${config.key==='chromatic'?'chromatic tuning':config.key} · original audio kept in your library.`);
  }
}
