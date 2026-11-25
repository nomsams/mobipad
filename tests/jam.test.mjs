import test from 'node:test';
import assert from 'node:assert/strict';
import {JamRoom} from '../js/jam.js';
function room(){const r=Object.create(JamRoom.prototype);r.role='leader';r.connections=new Map();r.transfers=new Map();r.seen=new Set();return r;}
test('leader acceptance packet retains accepted type',()=>{const r=room();let packet;r.broadcast=x=>packet=x;r.accept({type:'command',id:'x',action:{type:'stop'}});assert.equal(packet.type,'accepted');assert.equal(packet.id,'x');});
test('duplicate remote commands are applied at most once',()=>{const r=room();let count=0;r.emit=()=>count++;const p={type:'command',id:'unique',action:{type:'pad'}};r.receive(p,{});r.receive(p,{});assert.equal(count,1);});
test('oversized and incomplete audio transfers are rejected',()=>{const r=room(),c={peer:'p'};r.receive({type:'audio-start',id:'a',size:26*1024*1024,name:'bad'},c);assert.equal(r.transfers.size,0);r.receive({type:'audio-start',id:'b',size:4,name:'ok'},c);r.receive({type:'audio-chunk',id:'b',chunk:new ArrayBuffer(8)},c);assert.equal(r.transfers.size,0);});
