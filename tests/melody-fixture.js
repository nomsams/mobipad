export function sungFixture(){
  const rate=8000,notes=[60.25,61.82,64.15,66.75],samples=new Float32Array(rate*2.2);let seed=31;
  notes.forEach((note,n)=>{const start=.12+n*.5,duration=.38,frequency=440*2**((note-69)/12);for(let i=0;i<duration*rate;i++){const t=i/rate,envelope=Math.min(1,t/.02,(duration-t)/.02);seed=(1664525*seed+1013904223)>>>0;samples[Math.floor(start*rate)+i]=envelope*(.4*Math.sin(2*Math.PI*frequency*t)+.13*Math.sin(4*Math.PI*frequency*t))+(seed/4294967296-.5)*.002;}});
  return {samples,rate};
}
