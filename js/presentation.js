import {resolvePresentation,normalizePreferences} from './device.js';
export class Presentation {
  constructor({onResources,onStudio,notify}){
    this.onResources=onResources;this.onStudio=onStudio;this.notify=notify;this.moves=[];
    try{this.preferences=normalizePreferences(JSON.parse(localStorage.getItem('mobipad-display')));}catch{this.preferences=normalizePreferences();}
    this.layoutControl=document.querySelector('#layout-mode');this.resourceControl=document.querySelector('#resource-mode');
    this.layoutControl.onchange=()=>this.set('layout',this.layoutControl.value);
    this.resourceControl.onchange=()=>this.set('resources',this.resourceControl.value);
    document.querySelector('#layout-toggle').onclick=()=>this.set('layout',this.current.layout==='compact'?'studio':'compact');
    document.querySelector('#resource-toggle').onclick=()=>this.set('resources',this.current.resources==='eco'?'full':'eco');
    document.querySelector('#stage-project-help').onclick=()=>document.querySelector('#help-dialog').showModal();
    document.querySelector('#stage-record-mix').onclick=()=>document.querySelector('#export-mix').click();
    document.querySelector('#fullscreen-btn').hidden=!document.fullscreenEnabled;
    document.querySelector('#fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{this.notify('Use your browser’s full-screen option or add Mobipad to the home screen.');}};
    this.resize=()=>{if(this.resizeFrame)return;this.resizeFrame=requestAnimationFrame(()=>{this.resizeFrame=null;this.apply();});};
    window.addEventListener('resize',this.resize);window.visualViewport?.addEventListener('resize',this.resize);
    this.coarse=matchMedia('(any-pointer: coarse)');this.coarse.addEventListener?.('change',this.resize);
    this.apply();
  }
  set(key,value){this.preferences=normalizePreferences({...this.preferences,[key]:value});try{localStorage.setItem('mobipad-display',JSON.stringify(this.preferences));}catch{}this.apply();}
  move(element,target){if(!element||!target)return;this.moves.push({element,parent:element.parentNode,next:element.nextSibling});target.append(element);}
  compactControls(){if(this.moves.length)return;const timing=document.querySelector('#compact-timing');this.move(document.querySelector('#tap-btn'),timing);document.querySelectorAll('.transport-settings>.meter-setting').forEach(el=>this.move(el,timing));this.move(document.querySelector('#project-btn'),document.querySelector('#compact-project'));const dock=document.querySelector('.pad-inspector');this.move(document.querySelector('#mic-btn'),dock);this.move(document.querySelector('#quick-upload'),dock);}
  studioControls(){for(const item of this.moves.reverse())item.parent.insertBefore(item.element,item.next?.parentNode===item.parent?item.next:null);this.moves=[];}
  apply(){
    const environment={width:innerWidth,height:innerHeight,touchPoints:navigator.maxTouchPoints||0,platform:navigator.platform||'',userAgent:navigator.userAgent||'',coarse:this.coarse.matches,cores:navigator.hardwareConcurrency||0,memory:navigator.deviceMemory||0};
    const next=resolvePresentation(this.preferences,environment),old=this.current;this.current=next;
    document.body.dataset.layout=next.layout;document.body.dataset.device=next.device;document.body.dataset.resources=next.resources;
    document.documentElement.style.setProperty('--app-height',Math.round(window.visualViewport?.height||innerHeight)+'px');
    if(next.layout==='compact')this.compactControls();else {this.studioControls();if(old?.layout==='compact')this.onStudio();}
    this.layoutControl.value=this.preferences.layout;this.resourceControl.value=this.preferences.resources;
    const layoutButton=document.querySelector('#layout-toggle'),resourceButton=document.querySelector('#resource-toggle');
    layoutButton.textContent=next.layout==='compact'?'Studio':'Stage';layoutButton.setAttribute('aria-label',next.layout==='compact'?'Switch to full studio layout':'Switch to large pad performance layout');
    resourceButton.textContent=next.resources==='eco'?'Eco':'Full';resourceButton.setAttribute('aria-pressed',String(next.resources==='eco'));resourceButton.setAttribute('aria-label',next.resources==='eco'?'Eco resource mode enabled; switch to Full':'Full resource mode enabled; switch to Eco');
    document.querySelector('#device-status').textContent=`${next.device==='tablet'?'Tablet / iPad':next.device==='phone'?'Phone':'Desktop'} · ${next.layout==='compact'?'vertical performance layout':'full studio'} · ${next.resources==='eco'?'Eco':'Full'} resources`;
    if(old?.resources!==next.resources)this.onResources(next.resources);
  }
}
