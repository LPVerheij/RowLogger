"use strict";
// Loaded session, mounting detection and layout.
// ---------------------------------------------------------------- app state
let S=null, src=null, srcName="", mode="none", cursor=0, playing=false, follow=false, dirty=true;
let conn=null; // {type:'ble'|'serial', ...}
let liveOff=0, liveLastT=-1;

function cfg(){return{shaft:$("axShaft").value,up:$("axUp").value,
  driftWin:Math.max(4,+$("driftWin").value||15),hyst:Math.max(5,+$("hyst").value||15)}}
function setMsg(t){$("msg").textContent=t||""}
function setChip(txt,cls){$("chipTxt").textContent=txt;$("chip").className="chip "+(cls||"");if(typeof sessionUi==="function")sessionUi()}

// Work out how the sensor sits on the oar from the recording itself:
//  - the shaft stays near horizontal, so the shaft axis is the one carrying the least gravity;
//  - which end is the blade: the sensor feels centripetal acceleration toward the pin as the
//    oar swings, so the sign of (shaft acceleration vs. rotation rate squared) plus the
//    "outboard/inboard" setting says which way the blade is;
//  - the up axis is the other axis that carries gravity during the drive (blade squared)
//    but not during the recovery (blade feathered).
function detectMounting(cols){
  const n=cols.n,A=[cols.ax,cols.ay,cols.az],G=[cols.gx,cols.gy,cols.gz],XYZ="XYZ";
  const m=[0,0,0];let c=0;
  for(let i=0;i<n;i+=2){const an=Math.hypot(A[0][i],A[1][i],A[2][i]);if(Math.abs(an-1)>0.25)continue;
    for(let k=0;k<3;k++)m[k]+=Math.abs(A[k][i]);c++}
  if(c<500)return null;
  for(let k=0;k<3;k++)m[k]/=c;
  const srt=[...m].sort((a,b)=>a-b),si=m.indexOf(srt[0]);
  if(srt[0]>0.45||srt[1]-srt[0]<0.15)return null;
  let sw=0,sa=0,sww=0,swa=0;
  for(let i=0;i<n;i++){let w2=0;for(let k=0;k<3;k++)if(k!==si)w2+=(G[k][i]*D2R)**2;
    const a=A[si][i]*9.80665;sw+=w2;sa+=a;sww+=w2*w2;swa+=w2*a}
  const slope=(n*swa-sw*sa)/((n*sww-sw*sw)||1); // = minus the sensor's distance from the pin along +axis (m)
  let sign;
  if(Math.abs(slope)>0.04)sign=((slope<0)===($("mountSide").value==="out"))?1:-1;
  else{const cur=$("axShaft").value;sign=XYZ.indexOf(cur[1])===si&&cur[0]==="-"?-1:1}
  const shaft=(sign>0?"+":"-")+XYZ[si],others=[0,1,2].filter(k=>k!==si),cf=cfg();
  const tmp=new Session({shaft,up:"+"+XYZ[others[0]],driftWin:cf.driftWin,hyst:cf.hyst},false);
  for(let i=0;i<n;i++)tmp.append(cols.t[i],A[0][i],A[1][i],A[2][i],G[0][i],G[1][i],G[2][i]);
  tmp.finalize();
  const V=tmp.strokes.filter(s=>s.valid);let up;
  if(V.length>=5){
    const sc=others.map(k=>{let d=0,dc=0,r=0,rc=0;
      for(const s of V){for(let i=s.c;i<s.f;i++){d+=A[k][i];dc++}for(let i=s.f;i<s.n;i++){r+=A[k][i];rc++}}
      const md=d/dc,mr=r/rc;return {k,score:Math.abs(md)-Math.abs(mr),sgn:md>=0?1:-1}});
    sc.sort((a,b)=>b.score-a.score);up=(sc[0].sgn>0?"+":"-")+XYZ[sc[0].k];
  }else{
    const k=m[others[0]]>=m[others[1]]?others[0]:others[1];let mean=0;for(let i=0;i<n;i+=4)mean+=A[k][i];
    up=(mean>=0?"+":"-")+XYZ[k];
  }
  return {shaft,up,dist:Math.abs(slope),signFromData:Math.abs(slope)>0.04,strokes:V.length};
}
function applyMounting(cols){
  const info=$("mountInfo");
  $("axShaft").disabled=$("axUp").disabled=$("mountMode").value==="auto";
  if($("mountMode").value!=="auto"){info.textContent="Using the axes set by hand.";return true}
  const d=detectMounting(cols);
  if(!d){info.textContent="Couldn't detect the mounting yet (needs some rowing). Using: shaft "+$("axShaft").value+", up "+$("axUp").value+".";return false}
  $("axShaft").value=d.shaft;$("axUp").value=d.up;
  info.textContent=`Detected: shaft toward blade = ${d.shaft}, up (blade squared) = ${d.up}`+
    (d.signFromData?` · sensor ≈ ${d.dist.toFixed(2)} m ${$("mountSide").value==="out"?"outboard":"inboard"} of the pin`:" · blade direction not measurable, kept the current sign")+
    (d.strokes>=5?` · from ${d.strokes} strokes`:" · up axis is a guess until there are strokes");
  return d.strokes>=5;
}
let dataMode="oar";
function effMode(){const v=$("viewMode").value;return v==="auto"?dataMode:v}
function cfgBoat(cols){const v=$("boatAxis").value;
  if(v==="auto"&&cols&&cols.axis)return {boatAxis:cols.axis,known:true};
  if(v==="auto"&&cols&&cols.axisVec)return {boatAxis:cols.axisVec,known:true,fromTrigger:true};
  return {boatAxis:v}}
function applyLayout(){
  const b=effMode()==="boat";
  if(typeof boatMotionUi==="function"&&$("bmRel"))boatMotionUi();
  $("refPanel").hidden=!(b&&$("refPanel").dataset.has);
  document.body.dataset.kind=b?"boat":"oar";   // shows the .boat-only or .oar-only parts
  if(typeof sessionUi==="function")sessionUi();
  dirty=true;
}
function buildFromColumns(cols){
  applyLayout();
  if(effMode()==="boat"){
    S=new BoatSession(cfgBoat(cols),false);
    for(let i=0;i<cols.n;i++)S.append(cols.t[i],cols.ax[i],cols.ay[i],cols.az[i],cols.gx[i],cols.gy[i],cols.gz[i]);
    S.finalize();
    // strokes that span a pause in a stroke-window log have no real data there: leave them out
    if(cols.gaps)for(const st of S.strokes){const a=S.t.a[st.c],b=S.t.a[st.n];if(cols.gaps.some(([g0,g1])=>g1>a&&g0<b))st.valid=false}
    cursor=0;playing=false;$("playBtn").textContent="Play";dirty=true;return;
  }
  applyMounting(cols);
  const c=cfg(); if(axisVec(c.shaft).some((v,k)=>v&&axisVec(c.up)[k])){setMsg("Shaft and up axes must be different.");return}
  S=new Session(c,false);
  for(let i=0;i<cols.n;i++)S.append(cols.t[i],cols.ax[i],cols.ay[i],cols.az[i],cols.gx[i],cols.gy[i],cols.gz[i]);
  S.cals=(cols.cal||[]).filter(v=>v>=0&&v<=cols.t[cols.n-1]);
  S.finalize();
  cursor=0;playing=false;$("playBtn").textContent="Play";dirty=true;
}
function loadColumns(cols,name,m){
  src=cols;srcName=name;mode=m;follow=false;dataMode=guessMode(cols);
  buildFromColumns(cols);
  const dur=cols.n?cols.t[cols.n-1]:0;
  $("srcInfo").textContent=`${cols.n.toLocaleString()} samples · ${fmtT(dur)} · ${Math.round(cols.n/Math.max(dur,1e-3))} Hz`;
  setChip(m==="demo"?"Example: "+name+" (synthetic)":name,"");
  const ex=m==="demo"?(BOAT_EXAMPLES[exKey]||null):null;
  $("exNote").hidden=!ex;$("exNote").textContent=ex?ex.note:"";
  if(ex){const p=document.createElement("span");p.className="exsrc";p.append(" Kleshnev's measured curves: ");
    EX_SOURCES.forEach(([txt,url],i)=>{const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener";a.textContent=txt;if(i)p.append(" · ");p.append(a)});
    $("exNote").append(p)}
  if(m!=="demo")markExample("");
  const i=S.strokes.find(s=>s.valid);cursor=i?Math.min(S.n-1,i.n+ Math.round(S.n*0.1)):0;
  if(m==="demo")cursor=S.idxAt(dataMode==="boat"?60:40);
}
async function openFile(file){
  try{setMsg("Reading "+file.name+" …");const txt=await file.text();
    const cols=parseCSV(txt);if(cols.n<50)throw new Error("File has too few samples.");
    disconnect();loadColumns(cols,file.name,"file");setMsg("");
    if(cols.note)$("srcInfo").textContent+=" · "+cols.note;
    sessionUi();go("#/analysis");
  }catch(e){setMsg(e.message)}
}

