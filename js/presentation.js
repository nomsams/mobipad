import {resolvePresentation,normalizePreferences,choosePadGrid} from './device.js';
export class Presentation {
  constructor({onResources,onStudio,onPads,notify}){
    this.onResources=onResources;this.onStudio=onStudio;this.onPads=onPads;this.notify=notify;this.moves=[];this.focused=false;
    try{this.preferences=normalizePreferences(JSON.parse(localStorage.getItem('mobipad-display')));}catch{this.preferences=normalizePreferences();}
    this.layoutControl=document.querySelector('#layout-mode');this.resourceControl=document.querySelector('#resource-mode');
    this.layoutControl.onchange=()=>this.set('layout',this.layoutControl.value);
    this.resourceControl.onchange=()=>this.set('resources',this.resourceControl.value);
    document.querySelector('#layout-toggle').onclick=()=>this.set('layout',this.current.layout==='compact'?'studio':'compact');
    document.querySelector('#resource-toggle').onclick=()=>this.set('resources',this.current.resources==='eco'?'full':'eco');
    document.querySelector('#stage-project-help').onclick=()=>document.querySelector('#help-dialog').showModal();
    document.querySelector('#stage-record-mix').onclick=()=>document.querySelector('#export-mix').click();
    for(const id of ['#fullscreen-btn','#screen-toggle','#focus-screen'])document.querySelector(id).onclick=()=>this.toggleFullscreen();
    document.querySelector('#focus-toggle').onclick=()=>this.setFocus(true);
    document.querySelector('#focus-exit').onclick=()=>this.setFocus(false);
    document.querySelector('#screen-focus').onclick=()=>{document.querySelector('#screen-dialog').close();this.setFocus(true);};
    document.querySelector('#focus-play').onclick=()=>document.querySelector('#play-btn').click();
    document.querySelector('#focus-stop').onclick=()=>document.querySelector('#stop-btn').click();
    document.querySelector('#focus-mode').onclick=()=>{document.querySelector(document.querySelector('#shot-mode').getAttribute('aria-pressed')==='true'?'#loop-mode':'#shot-mode').click();this.syncFocus();};
    document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)this.lastFullscreenExit=performance.now();this.apply();});
    this.resize=()=>{if(this.resizeFrame)return;this.resizeFrame=requestAnimationFrame(()=>{this.resizeFrame=null;this.apply();});};
    window.addEventListener('resize',this.resize);window.visualViewport?.addEventListener('resize',this.resize);
    this.coarse=matchMedia('(any-pointer: coarse)');this.coarse.addEventListener?.('change',this.resize);
    this.standalone=matchMedia('(display-mode: standalone), (display-mode: fullscreen)');this.standalone.addEventListener?.('change',this.resize);
    this.grid=document.querySelector('#pad-grid');this.gridObserver=new ResizeObserver(()=>this.fitPads());this.gridObserver.observe(this.grid);
    this.apply();
  }
  async toggleFullscreen(){
    document.querySelector('#settings-dialog').close();
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(document.fullscreenEnabled&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});
      else if(this.standalone.matches||navigator.standalone)this.notify('Already running in an app window. Use Focus for pads-only view.');
      else document.querySelector('#screen-dialog').showModal();
    }catch{document.querySelector('#screen-dialog').showModal();}
    this.apply();
  }
  setFocus(enabled){
    if(enabled&&this.current.layout!=='compact')this.set('layout','compact');
    this.focused=enabled;document.body.dataset.focus=String(enabled);document.querySelector('#focus-controls').hidden=!enabled;
    if(enabled)this.onPads?.();this.syncFocus();this.fitPads();
  }
  syncFocus(){
    const playing=document.querySelector('#play-btn').getAttribute('aria-label')==='Stop transport',shot=document.querySelector('#shot-mode').getAttribute('aria-pressed')==='true';
    const play=document.querySelector('#focus-play'),mode=document.querySelector('#focus-mode');play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',playing?'Stop transport':'Start transport');
    mode.textContent=shot?'ϟ':'↻';mode.setAttribute('aria-pressed',String(shot));mode.setAttribute('aria-label',shot?'Switch to loops':'Switch to one shots');
  }
  handleEscape(){
    if(this.focused){this.setFocus(false);return true;}
    if(document.fullscreenElement){document.exitFullscreen().catch(()=>{});return true;}
    return this.lastFullscreenExit>0&&performance.now()-this.lastFullscreenExit<250;
  }
  fitPads(){
    const {width,height}=this.grid.getBoundingClientRect();if(!width||!height)return;
    const shape=choosePadGrid(width,height,document.body.dataset.orientation==='landscape',parseFloat(getComputedStyle(this.grid).gap)||6);
    const columns=this.current?.layout==='compact'?shape.columns:4,rows=16/columns;
    if(this.grid.style.getPropertyValue('--pad-columns')!==String(columns)){this.grid.style.setProperty('--pad-columns',columns);this.grid.style.setProperty('--pad-rows',rows);}
  }
  set(key,value){this.preferences=normalizePreferences({...this.preferences,[key]:value});try{localStorage.setItem('mobipad-display',JSON.stringify(this.preferences));}catch{}this.apply();}
  move(element,target){if(!element||!target)return;this.moves.push({element,parent:element.parentNode,next:element.nextSibling});target.append(element);}
  compactControls(){if(this.moves.length)return;const timing=document.querySelector('#compact-timing');this.move(document.querySelector('#tap-btn'),timing);document.querySelectorAll('.transport-settings>.meter-setting').forEach(el=>this.move(el,timing));this.move(document.querySelector('#project-btn'),document.querySelector('#compact-project'));const dock=document.querySelector('.pad-inspector');this.move(document.querySelector('#mic-btn'),dock);this.move(document.querySelector('#quick-upload'),dock);}
  studioControls(){for(const item of this.moves.reverse())item.parent.insertBefore(item.element,item.next?.parentNode===item.parent?item.next:null);this.moves=[];}
  apply(){
    const environment={width:innerWidth,height:innerHeight,touchPoints:navigator.maxTouchPoints||0,platform:navigator.platform||'',userAgent:navigator.userAgent||'',coarse:this.coarse.matches,cores:navigator.hardwareConcurrency||0,memory:navigator.deviceMemory||0};
    const next=resolvePresentation(this.preferences,environment),old=this.current;this.current=next;
    document.body.dataset.layout=next.layout;document.body.dataset.device=next.device;document.body.dataset.resources=next.resources;
    document.body.dataset.orientation=environment.width>environment.height?'landscape':'portrait';
    document.documentElement.style.setProperty('--app-height',Math.round(window.visualViewport?.height||innerHeight)+'px');
    if(next.layout==='compact')this.compactControls();else {if(this.focused)this.setFocus(false);this.studioControls();if(old?.layout==='compact')this.onStudio();}
    this.layoutControl.value=this.preferences.layout;this.resourceControl.value=this.preferences.resources;
    const layoutButton=document.querySelector('#layout-toggle'),resourceButton=document.querySelector('#resource-toggle');
    layoutButton.textContent=next.layout==='compact'?'Studio':'Stage';layoutButton.setAttribute('aria-label',next.layout==='compact'?'Switch to full studio layout':'Switch to large pad performance layout');
    resourceButton.textContent=next.resources==='eco'?'Eco':'Full';resourceButton.setAttribute('aria-pressed',String(next.resources==='eco'));resourceButton.setAttribute('aria-label',next.resources==='eco'?'Eco resource mode enabled; switch to Full':'Full resource mode enabled; switch to Eco');
    const fullscreen=Boolean(document.fullscreenElement);document.body.dataset.fullscreen=String(fullscreen||this.standalone.matches||Boolean(navigator.standalone));
    for(const id of ['#screen-toggle','#focus-screen']){const button=document.querySelector(id);button.setAttribute('aria-label',fullscreen?'Exit full screen':'Enter full screen');button.setAttribute('aria-pressed',String(fullscreen));}
    document.querySelector('#fullscreen-btn').textContent=fullscreen?'Exit full screen':'Full-screen options';
    document.querySelector('#device-status').textContent=`${next.device==='tablet'?'Tablet / iPad':next.device==='phone'?'Phone':'Desktop'} · ${next.layout==='compact'?document.body.dataset.orientation+' Stage layout':'full studio'} · ${next.resources==='eco'?'Eco':'Full'} resources`;
    this.fitPads();
    if(old?.resources!==next.resources)this.onResources(next.resources);
  }
}
