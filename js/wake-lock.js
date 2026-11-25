// A request may finish after Stop, a tab switch, or the preference being disabled.
export class ScreenWakeLock {
  constructor(request){this.request=request;this.generation=0;this.desired=false;this.pending=null;this.sentinel=null;}
  async set(enabled){
    this.desired=enabled;
    if(!enabled){this.generation++;const held=this.sentinel;this.sentinel=null;try{await held?.release();}catch{}return;}
    if(this.sentinel&&!this.sentinel.released||this.pending)return this.pending;
    const generation=this.generation;
    const task=(async()=>{
      try{
        const held=await this.request();
        if(!this.desired||generation!==this.generation){await held.release();return;}
        this.sentinel=held;held.addEventListener('release',()=>{if(this.sentinel===held)this.sentinel=null;},{once:true});
      }catch{} // Playback still works if the browser denies keeping the screen awake.
    })();
    this.pending=task;
    try{await task;}finally{if(this.pending===task){this.pending=null;if(this.desired&&generation!==this.generation)this.set(true);}}
  }
}
