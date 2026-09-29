"use strict";
// Frame loop, controls and page navigation.
// The site is one page with hash addresses (#/analysis, #/device …) rather than separate HTML
// files, so a Bluetooth or USB connection and the loaded session survive moving between pages.

// ---------------------------------------------------------------- loop
let lastFrame=performance.now(),lastStats=0;
const shown=cv=>cv.getClientRects().length>0;   // skip canvases on hidden pages and tabs
function frame(now){
  const dt=(now-lastFrame)/1000;lastFrame=now;
  if(playing&&S&&S.n){const tn=S.t.a[cursor]+dt*(+$("speed").value);
    if(tn>=S.t.a[S.n-1]){cursor=S.n-1;playing=false;$("playBtn").textContent="Play"}else cursor=S.idxAt(tn);dirty=true}
  if(dirty&&S){
    readColors();
    const D=(id,fn)=>{const cv=$(id);if(shown(cv))fn(cv)};
    if(S instanceof BoatSession){
      D("c3dB",()=>drawBoat3D());
      D("cProf",cv=>drawProfile(cv,"slp","m/s²"));D("cProfV",cv=>drawProfile(cv,"vel","m/s"));
      D("cProf3",cv=>drawProfile(cv,"slp","m/s²"));
      D("cSurge",cv=>drawPlot(cv,S.slp,C.accent,{markers:true,drives:true,unit:"m/s²",minPad:0.2}));
      D("cVel",cv=>drawPlot(cv,S.vel,C.blade,{drives:true,unit:"m/s",minPad:0.02}));
      D("cSet",cv=>drawPlot(cv,S.set,C.ink,{unit:"°",minPad:0.5}));
      D("ctlB",cv=>drawTimeline(cv));
      if(now-lastStats>150||!playing){updateBoatStats();lastStats=now}
    }else{
      D("c3d",()=>draw3D());
      D("cSweep",cv=>drawPlot(cv,S.abs,C.accent,{markers:true,drives:true,cals:true}));
      D("cVert",cv=>drawPlot(cv,S.vert,C.blade,{drives:true}));
      D("cFeather",cv=>drawPlot(cv,S.feather,C.ink,{range:[0,90]}));
      D("ctl",cv=>drawTimeline(cv));D("cbp",cv=>drawBladePath(cv));D("cbp3",cv=>drawBladePath(cv));
      if(now-lastStats>150||!playing){updateStats();lastStats=now}
    }
    const tEnd=S.n?S.t.a[S.n-1]:0;$("timeTxt").textContent=fmtT(S.n?S.t.a[cursor]:0)+" / "+fmtT(tEnd);
    $("scrub").value=tEnd?Math.round(S.t.a[cursor]/tEnd*1000):0;
    dirty=false;
  }
  soundTick();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- pages
const PAGES=["home","analysis","device","examples","settings","help","more"];
const TABS=["overview","3d","plots"];
let lastTab="overview";
function go(h){if(location.hash!==h)location.hash=h;else route()}
function route(){
  const parts=location.hash.replace(/^#\/?/,"").split("/");
  const page=PAGES.includes(parts[0])?parts[0]:"home";
  const body=document.body,prev=body.dataset.page;
  body.dataset.page=page;
  for(const s of document.querySelectorAll(".page"))s.hidden=s.dataset.page!==page;
  const more=["settings","help","more"].includes(page);
  for(const a of document.querySelectorAll("[data-nav]")){
    const on=a.dataset.nav===page||(a.dataset.nav==="more"&&more);
    if(on)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");
  }
  if(page==="analysis"){
    const tab=TABS.includes(parts[1])?parts[1]:"overview";lastTab=tab;body.dataset.tab=tab;
    for(const p of document.querySelectorAll(".tabpane"))p.hidden=p.dataset.tab!==tab;
    for(const a of document.querySelectorAll("[role=tab]")){const on=a.dataset.tab===tab;a.setAttribute("aria-selected",String(on));a.tabIndex=on?0:-1}
  }
  if(page==="home")sessionUi();
  if(page==="analysis")showChip();
  // the Analysis entries in the menus go back to the view that was open last
  for(const a of document.querySelectorAll('[data-nav="analysis"]'))a.href=lastTab==="overview"?"#/analysis":"#/analysis/"+lastTab;
  const sect=page==="help"&&parts[1]&&$("h-"+parts[1]);
  if(sect)sect.scrollIntoView({block:"start"});
  else if(prev!==page)scrollTo(0,0);
  const h1=document.querySelector(`.page[data-page="${page}"] h1`);
  document.title=(page==="home"?"":(h1?h1.textContent+" · ":""))+"RowLog Viewer";
  dirty=true;
}
addEventListener("hashchange",route);

// what's loaded: the header chip, the Analysis bar and the card on Home
function sessionUi(){
  if(!$("hsName"))return;
  const kind=effMode()==="boat"?"Boat sensor":"Oar sensor",name=$("chipTxt").textContent;
  $("anKind").textContent=$("hsKind").textContent=kind;
  $("anName").textContent=$("hsName").textContent=name;
  $("hsInfo").textContent=$("srcInfo").textContent;
  const box=$("hsStats");box.replaceChildren();
  if(!S)return;
  const V=S.strokes?S.strokes.filter(s=>s.valid):[],avg=f=>V.length?V.reduce((a,s)=>a+f(s),0)/V.length:NaN;
  const items=[["Strokes",V.length,""]];
  if(isFinite(avg(s=>s.rate)))items.push(["Avg rate",avg(s=>s.rate).toFixed(1),"spm"]);
  if(S instanceof BoatSession){if(isFinite(avg(s=>s.check)))items.push(["Avg check",avg(s=>s.check).toFixed(1),"m/s²"])}
  else if(isFinite(avg(s=>s.arc)))items.push(["Avg arc",avg(s=>s.arc).toFixed(0),"°"]);
  for(const [l,v,u] of items){const d=document.createElement("div");d.className="mini";
    d.innerHTML=`<span></span><b></b>`;d.firstChild.textContent=l;d.lastChild.textContent=v;
    if(u){const s=document.createElement("small");s.textContent=u;d.lastChild.append(s)}box.append(d)}
}

// ---------------------------------------------------------------- examples page
let exKey="oar";
const EXAMPLE_LIST=[["oar","Oar",{name:"Oar · single sculler",
  rates:[20,28,34],note:"A sculling oar with the sensor on the shaft, zeroed with three taps at the start: sweep, blade height and feather through every stroke."}]]
  .concat(Object.entries(BOAT_EXAMPLES).map(([k,v])=>[k,"Boat",v]));
function loadExample(k){
  if(!k)return;exKey=k;disconnect();
  if(k==="oar")loadColumns(makeDemo(),"Oar · single sculler","demo");
  else{loadColumns(makeBoatDemo(k),BOAT_EXAMPLES[k].name,"demo");refForExample(k)}
  markExample(k);
}
function markExample(k){
  for(const c of document.querySelectorAll(".excard"))c.classList.toggle("on",c.dataset.ex===k);
  for(const b of document.querySelectorAll("#exChips button")){const on=b.dataset.ex===k;b.setAttribute("aria-checked",String(on));b.tabIndex=on?0:-1}
  $("exSwitch").hidden=!k;
  showChip();
}
function showChip(){   // keep the selected example in view in the scrolling row (phones)
  const box=$("exChips"),b=box.querySelector('[aria-checked="true"]');
  if(b&&box.clientWidth)box.scrollTo({left:b.offsetLeft-(box.clientWidth-b.offsetWidth)/2});
}
// Switch to another example from the Analysis page: stay on the same view, at the same moment
// of the session, and keep playing if it was playing, so techniques can be compared directly.
function switchExample(k){
  if(!k||(k===exKey&&mode==="demo"))return;
  const wasPlaying=playing,tc=S&&S.n?S.t.a[cursor]:null;
  loadExample(k);
  if(tc!=null&&S.n)cursor=S.idxAt(Math.min(tc,S.t.a[S.n-1]));
  if(wasPlaying){playing=true;$("playBtn").textContent="Pause"}
  dirty=true;
}
function stepExample(d){
  const keys=EXAMPLE_LIST.map(x=>x[0]),i=keys.indexOf(exKey);
  switchExample(keys[(i+d+keys.length)%keys.length]);
}
// short names for the switcher
const EX_SHORT={oar:"Oar",front:"Front-loaded",late:"Late peak",hump:"Mid-drive hump",amateur:"Amateur"};
function buildExamples(){
  for(const [k,kind,ex] of EXAMPLE_LIST){
    const c=document.createElement("article");c.className="card excard";c.dataset.ex=k;
    const [lvl,title]=ex.name.split(" · ");
    c.innerHTML=`<div class="cardhead"><span class="badge"></span></div><h2></h2><p class="muted"></p>
      <div class="row"><button class="primary" data-open="overview">Open</button><button data-open="3d">Watch in 3D</button></div>`;
    c.querySelector(".badge").textContent=title&&lvl!==kind?lvl:kind;
    const h=title||ex.name;c.querySelector("h2").textContent=h[0].toUpperCase()+h.slice(1);c.querySelector("p").textContent=ex.note;
    if(ex.rates)c.querySelector("p").append(" Rates "+ex.rates.join(", ")+" spm.");
    for(const b of c.querySelectorAll("[data-open]"))b.onclick=()=>{loadExample(k);go(b.dataset.open==="3d"?"#/analysis/3d":"#/analysis")};
    $(kind==="Oar"?"exCardsOar":"exCardsBoat").append(c);
  }
  const ul=$("exSources");
  for(const [txt,url] of EX_SOURCES){const li=document.createElement("li"),a=document.createElement("a");
    a.href=url;a.target="_blank";a.rel="noopener";a.textContent=txt;li.append(a);ul.append(li)}
}
buildExamples();
{ const box=$("exChips");
  for(const [k,kind,ex] of EXAMPLE_LIST){
    const b=document.createElement("button");b.dataset.ex=k;b.setAttribute("role","radio");b.setAttribute("aria-checked","false");
    const lvl=kind==="Oar"?"Oar sensor":ex.name.split(" · ")[0];
    b.innerHTML="<small></small><span></span>";b.firstChild.textContent=lvl;b.lastChild.textContent=EX_SHORT[k]||ex.name;
    b.title=ex.name;b.onclick=()=>switchExample(k);
    b.addEventListener("keydown",e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();
      stepExample(e.key==="ArrowRight"?1:-1);const n=box.querySelector('[aria-checked="true"]');if(n)n.focus()});
    box.append(b);
  }
  $("exPrev").onclick=()=>stepExample(-1);$("exNext").onclick=()=>stepExample(1);
}

// ---------------------------------------------------------------- theme
function setTheme(t){
  if(t==="auto")document.documentElement.removeAttribute("data-theme");else document.documentElement.dataset.theme=t;
  for(const b of document.querySelectorAll("[data-theme-set]"))b.setAttribute("aria-pressed",String(b.dataset.themeSet===t));
  try{localStorage.setItem("rowlog-theme",t)}catch(_){}
}
for(const b of document.querySelectorAll("[data-theme-set]"))b.onclick=()=>setTheme(b.dataset.themeSet);
try{const t=localStorage.getItem("rowlog-theme");if(t==="light"||t==="dark")setTheme(t)}catch(_){}

// ---------------------------------------------------------------- controls
$("fileIn").addEventListener("change",e=>{if(e.target.files[0])openFile(e.target.files[0]);e.target.value=""});
$("refSel").onchange=e=>refShow(e.target.value);
$("exNote").addEventListener("click",e=>{if(e.target.tagName!=="A")e.currentTarget.classList.toggle("open")});
refInit();
$("sndBtn").onclick=soundToggle;$("sndQuick").onclick=soundToggle;
for(const id of Object.keys(SND_DEF))$(id).addEventListener("input",sndEdited);
$("sndResetBtn").onclick=()=>{for(const [k,v] of Object.entries(SND_DEF))$(k).value=v;sndEdited()};
$("sndTestBtn").onclick=()=>sendCmd("PT","PT\n");
$("devSndBtn").onclick=()=>{if(devSnd.known)sndSend(devSnd.on?0:1);else sendCmd("S","s")};
sndLabels();sndDevUi();
$("modeOarBtn").onclick=()=>setDevMode("OAR");$("modeBoatBtn").onclick=()=>setDevMode("BOAT");
for(const id of ["viewMode","boatAxis"])$(id).onchange=()=>{
  if(src){const tc=S&&S.n?S.t.a[cursor]:0;buildFromColumns(src);cursor=S.idxAt(tc)}
  else if(mode==="live"&&liveRaw)rebuildLive();
  applyLayout()};
$("bleBtn").onclick=connectBLE;$("serBtn").onclick=connectSerial;
$("discBtn").onclick=disconnect;$("logBtn").onclick=toggleLog;
$("playBtn").onclick=()=>{if(!S||mode==="live"&&conn)return;if(!playing&&cursor>=S.n-1)cursor=0;playing=!playing;$("playBtn").textContent=playing?"Pause":"Play";dirty=true};
$("scrub").oninput=e=>{if(!S||!S.n)return;follow=false;cursor=S.idxAt(e.target.value/1000*S.t.a[S.n-1]);dirty=true};
for(const id of ["speed","win"])$(id).onchange=()=>dirty=true;
for(const id of ["mountMode","mountSide","axShaft","axUp","driftWin","hyst"])$(id).onchange=()=>{
  if(id==="axShaft"||id==="axUp")$("mountMode").value="manual";
  if(src){const tc=S&&S.n?S.t.a[cursor]:0;buildFromColumns(src);cursor=S.idxAt(tc)}
  else if(mode==="live"&&liveRaw){
    if($("mountMode").value==="auto"){liveDetected=applyMounting(liveCols())}else applyMounting(null);
    rebuildLive()}
  dirty=true};
// analysis tabs: arrow keys move between them
{ const tabs=[...document.querySelectorAll("[role=tab]")];
  tabs.forEach((a,i)=>a.addEventListener("keydown",e=>{
    if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();
    const b=tabs[(i+(e.key==="ArrowRight"?1:tabs.length-1))%tabs.length];b.focus();b.click()}));
}
// stroke-profile charts: click or drag to move through the stroke, arrow keys step 1 %
for(const id of ["cProf","cProfV","cProf3"]){
  const cv=$(id);let down=false;
  cv.tabIndex=0;cv.style.cursor="ew-resize";cv.style.touchAction="none";
  const toFrac=fr=>{const m=cv._pmap;if(!m||!S)return;const t=S.t.a,f=Math.max(-m.pre,Math.min(0.999,fr));   // before 0: end of the previous stroke
    follow=false;playing=false;$("playBtn").textContent="Play";cursor=S.idxAt(t[m.c]+f*(t[m.n]-t[m.c]));dirty=true};
  const seek=e=>{const m=cv._pmap;if(!m)return;const r=cv.getBoundingClientRect();toFrac((e.clientX-r.left-m.L)/(m.Rr-m.L)*(1+m.pre)-m.pre)};
  // hold the stroke under the pointer for the whole drag, so moving into the lead-in (the end of
  // the previous stroke) doesn't hand the chart to that stroke and keep sliding backwards
  const release=()=>{if(!down)return;down=false;profPin=null;dirty=true};
  cv.addEventListener("pointerdown",e=>{const m=cv._pmap;if(!m)return;down=true;profPin=m.idx>=0?m.idx:null;cv.setPointerCapture(e.pointerId);seek(e)});
  cv.addEventListener("pointermove",e=>{if(down)seek(e)});
  cv.addEventListener("pointerup",release);cv.addEventListener("pointercancel",release);cv.addEventListener("lostpointercapture",release);
  cv.addEventListener("keydown",e=>{const m=cv._pmap;if(!m||!S||(e.key!=="ArrowLeft"&&e.key!=="ArrowRight"))return;e.preventDefault();
    const t=S.t.a,cur=(t[cursor]-t[m.c])/(t[m.n]-t[m.c]);toFrac(cur+(e.key==="ArrowRight"?0.01:-0.01))});
}
for(const id of ["ctl","cSweep","cVert","cFeather","ctlB","cSurge","cVel","cSet"]){
  const cv=$(id);let down=false;
  const seek=e=>{const m=cv._map;if(!m||!S)return;const r=cv.getBoundingClientRect();
    const tt=m.t0+(e.clientX-r.left-m.L)/m.PW*(m.t1-m.t0);follow=conn&&S.n&&tt>=S.t.a[S.n-1];cursor=S.idxAt(tt);dirty=true};
  cv.addEventListener("pointerdown",e=>{down=true;cv.setPointerCapture(e.pointerId);seek(e)});
  cv.addEventListener("pointermove",e=>{if(down)seek(e)});
  cv.addEventListener("pointerup",()=>down=false);cv.addEventListener("pointercancel",()=>down=false);
}
// 3D views: drag to turn, wheel or pinch to zoom
function orbit(cv,cam,minD,maxD){
  const pts=new Map();let drag=null,pinch=null;
  cv.addEventListener("pointerdown",e=>{pts.set(e.pointerId,[e.clientX,e.clientY]);cv.setPointerCapture(e.pointerId);
    if(pts.size===1){drag=[e.clientX,e.clientY,cam.yaw,cam.pitch];cv.style.cursor="grabbing"}
    else if(pts.size===2){const [a,b]=[...pts.values()];pinch=[Math.hypot(a[0]-b[0],a[1]-b[1]),cam.dist];drag=null}});
  cv.addEventListener("pointermove",e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pinch&&pts.size===2){const [a,b]=[...pts.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);
      cam.dist=Math.max(minD,Math.min(maxD,pinch[1]*pinch[0]/Math.max(20,d)));dirty=true}
    else if(drag){cam.yaw=drag[2]-(e.clientX-drag[0])*0.4;cam.pitch=Math.max(2,Math.min(89,drag[3]+(e.clientY-drag[1])*0.3));dirty=true}});
  const up=e=>{pts.delete(e.pointerId);if(pts.size<2)pinch=null;if(!pts.size){drag=null;cv.style.cursor="grab"}};
  cv.addEventListener("pointerup",up);cv.addEventListener("pointercancel",up);
  cv.addEventListener("wheel",e=>{e.preventDefault();cam.dist=Math.max(minD,Math.min(maxD,cam.dist*Math.exp(e.deltaY*0.001)));dirty=true},{passive:false});
}
orbit($("c3d"),cam,2,12);orbit($("c3dB"),camB,4,20);
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{Object.assign(cam,VIEWS[b.dataset.view]);dirty=true});
document.querySelectorAll("[data-bview]").forEach(b=>b.onclick=()=>{Object.assign(camB,BVIEWS[b.dataset.bview]);dirty=true});
$("boatExag").onchange=()=>boatMotionUi();
$("bmRel").onclick=()=>{boatAbs=false;boatMotionUi()};$("bmAbs").onclick=()=>{boatAbs=true;boatMotionUi()};
$("bAvgSpd").addEventListener("input",()=>dirty=true);
$("catchDelay").addEventListener("input",()=>{$("catchDelayOut").textContent=$("catchDelay").value+" ms";dirty=true});
boatMotionUi();

let dragN=0;
addEventListener("dragenter",e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes("Files")){dragN++;$("drop").hidden=false}});
addEventListener("dragleave",()=>{if(--dragN<=0){dragN=0;$("drop").hidden=true}});
addEventListener("dragover",e=>e.preventDefault());
addEventListener("drop",e=>{e.preventDefault();dragN=0;$("drop").hidden=true;const f=e.dataTransfer.files[0];if(f)openFile(f)});
addEventListener("keydown",e=>{
  if(document.body.dataset.page!=="analysis"||e.target.closest("input,select,textarea"))return;
  if((e.key==="["||e.key==="]")&&mode==="demo"){e.preventDefault();stepExample(e.key==="]"?1:-1)}
  else if(e.code==="Space"&&!e.target.closest("button,a,[role=tab]")){e.preventDefault();$("playBtn").click()}});
addEventListener("resize",()=>dirty=true);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>dirty=true);
new MutationObserver(()=>dirty=true).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
if(!navigator.bluetooth)$("bleBtn").title="Needs Chrome or Edge";
if(!navigator.serial)$("serBtn").title="Needs Chrome or Edge on a computer";

loadExample("oar");
route();
requestAnimationFrame(frame);
