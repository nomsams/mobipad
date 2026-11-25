import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSession} from '../js/presets.js';
import {prepareProjectImport} from '../js/project-import.js';
function archive(){const session=defaultSession();Object.assign(session.pads[12],{kind:'audio',audioId:'original'});return {session,audio:[{id:'original',name:'Take',type:'audio/wav',data:btoa('audio')}]};}
const dependencies={decode:async()=>({duration:2}),analyze:async()=>({bpm:120})};
test('project import creates fresh sample identities without changing the archive or existing project',async()=>{
  const data=archive(),copy=structuredClone(data),prepared=await prepareProjectImport(data,dependencies);
  assert.deepEqual(data,copy);assert.notEqual(prepared.samples[0].id,'original');assert.equal(prepared.session.pads[12].audioId,prepared.samples[0].id);assert.equal(prepared.samples[0].analysis.bpm,120);
});
test('duplicate and missing samples fail before decoding any archive audio',async()=>{
  let decoded=0;const deps={...dependencies,decode:async()=>{decoded++;return {duration:2};}};
  const duplicate=archive();duplicate.audio.push({...duplicate.audio[0]});await assert.rejects(prepareProjectImport(duplicate,deps),/duplicate/);
  const missing=archive();missing.audio=[];await assert.rejects(prepareProjectImport(missing,deps),/missing/);assert.equal(decoded,0);
});
test('a corrupt later sample rejects the entire staged import without returning a partial project',async()=>{
  const data=archive();data.audio.push({id:'second',name:'Bad',data:btoa('broken')});let decoded=0;
  await assert.rejects(prepareProjectImport(data,{...dependencies,decode:async()=>{if(++decoded===2)throw Error('Invalid audio');return {duration:2};}}),/Invalid audio/);
  assert.equal(decoded,2);assert.equal(data.session.pads[12].audioId,'original');
});
