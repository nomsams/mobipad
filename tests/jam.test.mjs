import test from 'node:test';
import assert from 'node:assert/strict';
import {JamRoom} from '../js/jam.js';
function room(){const r=Object.create(JamRoom.prototype);r.role='leader';r.connections=new Map();r.transfers=new Map();r.seen=new Set();return r;}
test('leader acceptance packet retains accepted type',()=>{const r=room();let packet;r.broadcast=x=>packet=x;r.accept({type:'command',id:'x',action:{type:'stop'}});assert.equal(packet.type,'accepted');assert.equal(packet.id,'x');});
test('duplicate remote commands are applied at most once',()=>{const r=room();let count=0;r.emit=()=>count++;const p={type:'command',id:'unique',action:{type:'pad'}};r.receive(p,{});r.receive(p,{});assert.equal(count,1);});
test('oversized and incomplete audio transfers are rejected',()=>{const r=room(),c={peer:'p'};r.receive({type:'audio-start',id:'a',size:26*1024*1024,name:'bad'},c);assert.equal(r.transfers.size,0);r.receive({type:'audio-start',id:'b',size:4,name:'ok'},c);r.receive({type:'audio-chunk',id:'b',chunk:new ArrayBuffer(8)},c);assert.equal(r.transfers.size,0);});

test('failed signaling destroys its peer and late open events cannot reopen the room',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const previous=globalThis.Peer;let peer;
  globalThis.Peer=class{constructor(){peer=this;this.handlers={};}on(name,fn){this.handlers[name]=fn;}destroy(){this.destroyed=true;}};
  t.after(()=>{if(previous)globalThis.Peer=previous;else delete globalThis.Peer;});
  const r=new JamRoom();clearInterval(r.syncTimer);const creating=r.create('leader');const failure=assert.rejects(creating,/Signaling took too long/);
  t.mock.timers.tick(18001);await failure;assert.equal(peer.destroyed,true);assert.equal(r.peer,null);assert.equal(r.role,null);
  peer.handlers.open();assert.equal(r.role,null);
});
