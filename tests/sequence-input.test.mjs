import test from 'node:test';
import assert from 'node:assert/strict';
import {bindStepEditing} from '../js/sequence-input.js';
test('left click adds, right click removes and suppresses the browser context menu',()=>{const button=new EventTarget(),edits=[];bindStepEditing(button,on=>edits.push(on));button.dispatchEvent(new Event('click'));const right=new Event('contextmenu',{cancelable:true});button.dispatchEvent(right);assert.deepEqual(edits,[true,false]);assert.equal(right.defaultPrevented,true);button.dispatchEvent(new Event('click'));assert.deepEqual(edits,[true,false,true]);});
test('mobile erase mode removes using a normal tap',()=>{const button=new EventTarget(),edits=[];let erase=true;bindStepEditing(button,on=>edits.push(on),()=>erase);button.dispatchEvent(new Event('click'));erase=false;button.dispatchEvent(new Event('click'));assert.deepEqual(edits,[false,true]);});
