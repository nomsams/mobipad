import test from 'node:test';
import assert from 'node:assert/strict';
import {database,saveSession,saveProject} from '../js/storage.js';

test('a failed storage open can recover, and a version change releases the old database',async t=>{
  let attempts=0,closes=0,writes=0;const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  const db={close(){closes++;},transaction(){const tx={objectStore:()=>({put(value){writes++;queueMicrotask(()=>tx.oncomplete());return {result:value};}})};return tx;}};
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){const request={};attempts++;queueMicrotask(()=>{if(attempts===1){request.error=Error('Temporarily unavailable');request.onerror();}else{request.result=db;request.onsuccess();}});return request;}}});
  t.after(()=>{db.onclose?.();if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete globalThis.indexedDB;});
  await assert.rejects(database(),/Temporarily unavailable/);assert.equal(await database(),db);await saveSession({name:'Recovered'});assert.equal(writes,1);assert.equal(attempts,2);
  db.onversionchange();assert.equal(closes,1);await database();assert.equal(attempts,3);
});

test('project and samples use one transaction and a quota abort rejects the restore',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');let db,transaction,scopes,writes=[];
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){const request={};queueMicrotask(()=>{request.result=db={transaction(stores,mode){scopes=stores;assert.equal(mode,'readwrite');transaction={objectStore:store=>({put(value,key){writes.push({store,value,key});}})};return transaction;}};request.onsuccess();});return request;}}});
  t.after(()=>{db.onclose();if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete globalThis.indexedDB;});
  const pending=saveProject({name:'Restored'},[{id:'new-a'},{id:'new-b'}]);await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.deepEqual(scopes,['projects','samples']);assert.equal(writes.length,3);assert.equal(writes[2].store,'projects');
  transaction.error=Error('Quota exceeded');transaction.onabort();await assert.rejects(pending,/Quota exceeded/);
});
