import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDSP,setDSPResourceMode} from '../js/dsp-client.js';

test('DSP worker releases idle memory, fails all queued jobs on timeout, and recovers',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const previous=globalThis.Worker,instances=[];
  globalThis.Worker=class{
    constructor(){instances.push(this);this.messages=[];}
    postMessage(message){this.messages.push(message);}
    terminate(){this.terminated=true;}
    complete(){const {id}=this.messages.shift();this.onmessage({data:{id,result:'ok'}});}
  };
  t.after(()=>{if(previous)globalThis.Worker=previous;else delete globalThis.Worker;});
  const payload=()=>({samples:new Float32Array(4),sampleRate:11025});
  setDSPResourceMode('eco');
  const first=requestDSP('analyze',payload());instances[0].complete();assert.equal(await first,'ok');
  t.mock.timers.tick(15001);assert.equal(instances[0].terminated,true);
  const failed=Promise.allSettled([requestDSP('analyze',payload()),requestDSP('analyze',payload())]);
  t.mock.timers.tick(90001);assert.ok((await failed).every(r=>r.status==='rejected'));assert.equal(instances[1].terminated,true);
  const recovered=requestDSP('analyze',payload());instances[1].onerror(); // A stale worker must not kill the replacement.
  instances[2].complete();assert.equal(await recovered,'ok');
  t.mock.timers.tick(15001);assert.equal(instances[2].terminated,true);
});
