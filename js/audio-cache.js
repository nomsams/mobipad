export function audioBytes(value){return value?.numberOfChannels&&Number.isFinite(value.length)?value.numberOfChannels*value.length*4:value?.byteLength||0;}
export class AudioCache extends Map {
  constructor(budget,pinned=()=>false){super();this.budget=budget;this.pinned=pinned;this.bytes=0;}
  get(key){const value=super.get(key);if(value!==undefined){super.delete(key);super.set(key,value);}return value;}
  set(key,value){if(super.has(key)){this.bytes-=audioBytes(super.get(key));super.delete(key);}super.set(key,value);this.bytes+=audioBytes(value);this.trim(key);return this;}
  delete(key){if(super.has(key))this.bytes-=audioBytes(super.get(key));return super.delete(key);}
  clear(){super.clear();this.bytes=0;}
  setBudget(budget){this.budget=budget;this.trim();}
  trim(keep){for(const key of super.keys()){if(this.bytes<=this.budget)break;if(key!==keep&&!this.pinned(key))this.delete(key);}}
}
