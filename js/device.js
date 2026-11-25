export function classifyDevice({width=1280,height=800,touchPoints=0,coarse=false,platform='',userAgent=''}={}){
  const ipad=/iPad/i.test(userAgent)||/Mac/i.test(platform)&&touchPoints>1;
  if(ipad)return 'tablet';
  if(/iPhone|iPod|Android.+Mobile/i.test(userAgent)||width<=700)return 'phone';
  if(/Android/i.test(userAgent)||((coarse||touchPoints>0)&&Math.min(width,height)<=1100&&Math.max(width,height)<=1600))return 'tablet';
  return 'desktop';
}
export function resolvePresentation(preferences={},environment={}){
  const device=classifyDevice(environment),layout=['compact','studio'].includes(preferences.layout)?preferences.layout:device==='desktop'?'studio':'compact';
  const constrained=(environment.cores>0&&environment.cores<=4)||(environment.memory>0&&environment.memory<=4);
  const resources=['eco','full'].includes(preferences.resources)?preferences.resources:device!=='desktop'||constrained?'eco':'full';
  return {device,layout,resources};
}
export function normalizePreferences(input){return {layout:['auto','compact','studio'].includes(input?.layout)?input.layout:'auto',resources:['auto','eco','full'].includes(input?.resources)?input.resources:'auto'};}
export function choosePadGrid(width,height,landscape=false,gap=6){
  if(!landscape||!(width>0&&height>0))return {columns:4,rows:4};
  let best={columns:4,rows:4},size=-Infinity;
  for(const columns of [4,8]){
    const rows=16/columns,side=Math.min((width-(columns-1)*gap)/columns,(height-(rows-1)*gap)/rows);
    if(side>size){best={columns,rows};size=side;}
  }
  return best;
}
const MiB=1024*1024;
export const resourceProfiles={eco:{fps:12,maxSources:160,rawBytes:32*MiB,stringBytes:8*MiB,processedBytes:12*MiB,stretchBytes:32*MiB,workerIdle:15000},full:{fps:30,maxSources:384,rawBytes:128*MiB,stringBytes:32*MiB,processedBytes:32*MiB,stretchBytes:128*MiB,workerIdle:60000}};
