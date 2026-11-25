export const reverbSpaces={room:{seconds:.75,damping:6200},plate:{seconds:1.5,damping:4800},hall:{seconds:2.8,damping:3500}};
const impulses=new WeakMap();
export function reverbImpulse(context,space='room'){
  space=reverbSpaces[space]?space:'room';let cache=impulses.get(context);if(!cache){cache=new Map();impulses.set(context,cache);}if(cache.has(space))return cache.get(space);
  const length=Math.ceil(context.sampleRate*reverbSpaces[space].seconds),buffer=context.createBuffer(2,length,context.sampleRate);let seed=731;
  for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);let previous=0;for(let i=0;i<length;i++){seed=(1664525*seed+1013904223)>>>0;const noise=seed/2147483648-1;previous=previous*.45+noise*.55;data[i]=previous*Math.exp(-6*i/length)*Math.min(1,i/(context.sampleRate*.012));}}
  cache.set(space,buffer);return buffer;
}
export function createReverb(context,input,output,amount,space='room'){
  space=reverbSpaces[space]?space:'room';const convolver=context.createConvolver(),filter=context.createBiquadFilter(),wet=context.createGain();
  convolver.buffer=reverbImpulse(context,space);filter.type='lowpass';filter.frequency.value=reverbSpaces[space].damping;wet.gain.value=amount*.65;
  input.connect(convolver);convolver.connect(filter);filter.connect(wet);wet.connect(output);
  const nodes=[convolver,filter,wet];return {space,wet,nodes,dispose(){try{input.disconnect(convolver);}catch{}nodes.forEach(n=>n.disconnect());}};
}
