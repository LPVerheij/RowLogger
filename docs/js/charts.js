"use strict";
// 2D charts and the stroke statistics.
// ---------------------------------------------------------------- drawing helpers
let C={};
function readColors(){const cs=getComputedStyle(document.documentElement);
  for(const k of ["ink","muted","line","grid","accent","blade","water","hull","panel","ok"])C[k]=cs.getPropertyValue("--"+k).trim()}
function fit(cv){const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;
  const w=Math.max(1,Math.round(r.width*d)),h=Math.max(1,Math.round(r.height*d));
  if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}
  const g=cv.getContext("2d");g.setTransform(d,0,0,d,0,0);return {g,w:r.width,h:r.height}}
const fmtT=s=>{s=Math.max(0,s);const m=Math.floor(s/60);return m+":"+(s-m*60).toFixed(1).padStart(4,"0")};
const fmtA=v=>(v>0?"+":"")+v.toFixed(0)+"°";
function niceStep(span,target){const r=span/target,p=Math.pow(10,Math.floor(Math.log10(r))),m=r/p;return (m<1.5?1:m<3?2:m<7?5:10)*p}

function viewRange(){
  if(!S||!S.n)return [0,1];
  const tEnd=S.t.a[S.n-1],tc=S.t.a[cursor],W=+$("win").value;
  if(!W)return [0,Math.max(tEnd,1)];
  if(follow)return [tc-W,tc];
  let a=tc-W/2,b=tc+W/2;if(a<0){b-=a;a=0}if(b>tEnd&&tEnd>W){a-=b-tEnd;b=tEnd}
  return [a,b];
}

function drawPlot(cv,arr,color,opts={}){
  const {g,w,h}=fit(cv);g.clearRect(0,0,w,h);
  if(!S||S.n<2)return;
  const [t0,t1]=viewRange(),t=S.t.a,L=40,R=w-8,T=8,B=h-20,PW=R-L;
  let i0=Math.max(0,S.idxAt(t0)-1),i1=Math.min(S.n-1,S.idxAt(t1)+1);
  let mn=Infinity,mx=-Infinity;
  for(let i=i0;i<=i1;i++){const v=arr.a[i];if(v<mn)mn=v;if(v>mx)mx=v}
  if(opts.range){mn=Math.min(mn,opts.range[0]);mx=Math.max(mx,opts.range[1])}
  const pad=(mx-mn)*0.08+(opts.minPad??1);mn-=pad;mx+=pad;
  const X=tt=>L+(tt-t0)/(t1-t0)*PW,Y=v=>B-(v-mn)/(mx-mn)*(B-T);
  g.font="11px "+getComputedStyle(document.body).fontFamily;g.lineWidth=1;
  const ys=niceStep(mx-mn,4);
  g.fillStyle=C.muted;g.textAlign="right";g.textBaseline="middle";
  const unit=opts.unit??"°",ydec=ys<0.1?2:ys<1?1:0;
  for(let v=Math.ceil(mn/ys)*ys;v<=mx;v+=ys){const y=Y(v);g.strokeStyle=Math.abs(v)<ys/2?C.line:C.grid;g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();g.fillText(v.toFixed(ydec)+(unit==="°"?"°":""),L-5,y)}
  if(unit!=="°"){g.save();g.textAlign="left";g.textBaseline="top";g.fillText(unit,L+4,T+2);g.restore()}
  const xs=niceStep(t1-t0,Math.max(2,PW/90));
  g.textAlign="center";g.textBaseline="top";
  for(let v=Math.ceil(t0/xs)*xs;v<=t1;v+=xs){const x=X(v);g.strokeStyle=C.grid;g.beginPath();g.moveTo(x,T);g.lineTo(x,B);g.stroke();g.fillText(fmtT(v).replace(/\.0$/,""),x,B+5)}
  // strokes shading (drive)
  if(opts.drives){g.fillStyle=C.water;g.globalAlpha=0.35;
    for(const s of S.strokes){if(!s.valid||t[s.f]<t0||t[s.c]>t1)continue;const a=Math.max(L,X(t[s.c])),b=Math.min(R,X(t[s.f]));g.fillRect(a,T,b-a,B-T)}
    g.globalAlpha=1}
  g.save();g.beginPath();g.rect(L,T,PW,B-T);g.clip();
  g.strokeStyle=color;g.lineWidth=1.6;g.lineJoin="round";g.beginPath();
  if(i1-i0<PW*2){for(let i=i0;i<=i1;i++){const x=X(t[i]),y=Y(arr.a[i]);i===i0||t[i]-t[i-1]>0.5?g.moveTo(x,y):g.lineTo(x,y)}}   // break the line at gaps
  else{let col=-1,lo=0,hi=0,first=true;
    const flush=()=>{if(col<0)return;const x=L+col;if(first){g.moveTo(x,Y(lo));first=false}else g.lineTo(x,Y(lo));g.lineTo(x,Y(hi))};
    for(let i=i0;i<=i1;i++){const c=Math.floor(X(t[i])-L),v=arr.a[i];
      if(c!==col){flush();col=c;lo=hi=v}else{if(v<lo)lo=v;if(v>hi)hi=v}}
    flush()}
  g.stroke();
  if(opts.markers){
    for(const s of S.strokes){if(!s.valid)continue;
      for(const [idx,up] of [[s.c,true],[s.f,false]]){const tt=t[idx];if(tt<t0||tt>t1)continue;
        const x=X(tt),y=Y(arr.a[idx]);g.fillStyle=up?C.blade:C.accent;g.beginPath();
        if(up){g.moveTo(x,y-9);g.lineTo(x-5,y-1);g.lineTo(x+5,y-1)}else{g.moveTo(x,y+9);g.lineTo(x-5,y+1);g.lineTo(x+5,y+1)}g.fill()}}
  }
  if(opts.cals){g.setLineDash([4,3]);g.strokeStyle=C.ok;g.fillStyle=C.ok;g.textAlign="left";g.textBaseline="top";
    for(const tc of S.cals){if(tc<t0||tc>t1)continue;const x=X(tc);g.beginPath();g.moveTo(x,T);g.lineTo(x,B);g.stroke();g.fillText("zeroed",x+4,T+2)}
    g.setLineDash([])}
  g.restore();
  const xc=X(t[cursor]);g.strokeStyle=C.ink;g.lineWidth=1;g.beginPath();g.moveTo(xc,T);g.lineTo(xc,B);g.stroke();
  g.fillStyle=C.ink;g.beginPath();g.arc(xc,Y(arr.a[cursor]),3.5,0,7);g.fill();
  cv._map={t0,t1,L,PW};
}

function drawTimeline(cv=$("ctl")){
  const {g,w,h}=fit(cv);g.clearRect(0,0,w,h);
  if(!S||S.n<2)return;
  const t=S.t.a,tEnd=Math.max(t[S.n-1],1),L=40,R=w-8,PW=R-L,T=6,B=h-6;
  const X=tt=>L+tt/tEnd*PW,Y=r=>B-(Math.min(50,Math.max(10,r))-10)/40*(B-T);
  g.font="11px "+getComputedStyle(document.body).fontFamily;g.fillStyle=C.muted;g.textAlign="right";g.textBaseline="middle";
  for(const r of [20,30,40]){const y=Y(r);g.strokeStyle=C.grid;g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();g.fillText(r,L-5,y)}
  const [a,b]=viewRange();g.fillStyle=C.water;g.globalAlpha=0.45;g.fillRect(X(a),T,Math.max(2,X(b)-X(a)),B-T);g.globalAlpha=1;
  g.fillStyle=C.accent;
  for(const s of S.strokes){if(!s.valid)continue;g.beginPath();g.arc(X(t[s.c]),Y(s.rate),1.8,0,7);g.fill()}
  const xc=X(t[cursor]);g.strokeStyle=C.ink;g.beginPath();g.moveTo(xc,T);g.lineTo(xc,B);g.stroke();
  cv._map={t0:0,t1:tEnd,L,PW};
}

function drawBladePath(cv=$("cbp")){
  const {g,w,h}=fit(cv);g.clearRect(0,0,w,h);
  if(!S||S.n<2)return;
  const k=S.strokeAt(cursor);
  const ids=[];for(let j=k;j>=0&&ids.length<3;j--)if(S.strokes[j].valid)ids.unshift(j);
  const det=S.abs.a,vert=S.vert.a;
  let x0=-60,x1=40,y0=-10,y1=8;
  const segs=ids.map(j=>{const s=S.strokes[j];return [s.c,Math.min(s.n,j===k?Math.max(cursor,s.c):s.n)]});
  if(k>=0&&S.strokes[k]&&cursor>S.strokes[k].n)segs.push([S.strokes[k].n,cursor]);
  for(const [a,b] of segs)for(let i=a;i<=b;i++){x0=Math.min(x0,det[i]);x1=Math.max(x1,det[i]);y0=Math.min(y0,vert[i]);y1=Math.max(y1,vert[i])}
  const flip=S.catchSign>0; // put the catch on the left
  const L=34,R=w-10,T=8,B=h-22;
  const X=v=>{const f=(v-x0)/(x1-x0);return L+(flip?1-f:f)*(R-L)},Y=v=>B-(v-y0)/(y1-y0)*(B-T);
  g.font="11px "+getComputedStyle(document.body).fontFamily;g.fillStyle=C.muted;
  g.textAlign="right";g.textBaseline="middle";
  const ys=niceStep(y1-y0,4);for(let v=Math.ceil(y0/ys)*ys;v<=y1;v+=ys){g.strokeStyle=Math.abs(v)<1e-9?C.line:C.grid;g.beginPath();g.moveTo(L,Y(v));g.lineTo(R,Y(v));g.stroke();g.fillText(v.toFixed(0)+"°",L-4,Y(v))}
  g.textAlign="center";g.textBaseline="top";
  const xs=niceStep(x1-x0,5);for(let v=Math.ceil(x0/xs)*xs;v<=x1;v+=xs){g.strokeStyle=C.grid;g.beginPath();g.moveTo(X(v),T);g.lineTo(X(v),B);g.stroke();g.fillText(v.toFixed(0)+"°",X(v),B+5)}
  g.textAlign="left";g.fillText("catch",L+2,T);g.textAlign="right";g.fillText("finish",R-2,T);
  segs.forEach(([a,b],n)=>{g.globalAlpha=0.3+0.7*(n+1)/segs.length;g.strokeStyle=n===segs.length-1?C.accent:C.hull;g.lineWidth=n===segs.length-1?2:1.4;
    g.beginPath();for(let i=a;i<=b;i++){const x=X(det[i]),y=Y(vert[i]);i===a?g.moveTo(x,y):g.lineTo(x,y)}g.stroke()});
  g.globalAlpha=1;g.fillStyle=C.blade;g.beginPath();g.arc(X(det[cursor]),Y(vert[cursor]),4,0,7);g.fill();
}

// ---------------------------------------------------------------- boat drawing
const PROF_PRE=0.15;   // the stroke profile starts this share of a stroke before the catch
let profPin=null;      // stroke index held in place while the profile cursor is being dragged
function drawProfile(cv,key,unit){
  const {g,w,h}=fit(cv);g.clearRect(0,0,w,h);
  if(!S||!S.strokes)return;
  const pinned=profPin!==null&&S.strokes[profPin]?profPin:null;
  const k=pinned!==null?pinned:S.strokeAt(cursor),list=[];for(let j=k;j>=0&&list.length<10;j--)if(S.strokes[j].valid)list.unshift(S.strokes[j]);
  if(!list.length){g.fillStyle=C.muted;g.font="13px "+getComputedStyle(document.body).fontFamily;g.fillText("No strokes yet",12,24);return}
  const P=PROF_PRE,N=121,arr=S[key].a,t=S.t.a,U=q=>-P+(1+P)*q/(N-1);   // q index -> stroke fraction
  const curves=list.map(s=>{const out=new Float32Array(N),T=t[s.n]-t[s.c];let i=S.idxAt(t[s.c]-P*T);
    for(let q=0;q<N;q++){const tt=t[s.c]+T*U(q);while(i<s.n&&t[i+1]<=tt)i++;out[q]=arr[i]}return out});
  const mean=new Float32Array(N);for(const c of curves)for(let q=0;q<N;q++)mean[q]+=c[q]/curves.length;
  let mn=Infinity,mx=-Infinity;for(const c of curves)for(const v of c){if(v<mn)mn=v;if(v>mx)mx=v}
  const pad=(mx-mn)*0.08||0.1;mn-=pad;mx+=pad;
  const meanT=list.reduce((a,s)=>a+t[s.n]-t[s.c],0)/list.length;
  const L=44,Rr=w-20,T=8,B=h-36,X=u=>L+(u+P)/(1+P)*(Rr-L),Y=v=>B-(v-mn)/(mx-mn)*(B-T);
  const font=getComputedStyle(document.body).fontFamily;
  // end of the previous recovery, lightly shaded
  g.fillStyle=C.grid;g.globalAlpha=0.55;g.fillRect(L,T,X(0)-L,B-T);g.globalAlpha=1;
  g.font="11px "+font;g.fillStyle=C.muted;g.textAlign="right";g.textBaseline="middle";
  const ys=niceStep(mx-mn,5),dec=ys<0.1?2:ys<1?1:0;
  for(let v=Math.ceil(mn/ys)*ys;v<=mx;v+=ys){const y=Y(v);g.strokeStyle=Math.abs(v)<ys/2?C.line:C.grid;g.beginPath();g.moveTo(L,y);g.lineTo(Rr,y);g.stroke();g.fillText(v.toFixed(dec),L-5,y)}
  g.textAlign="center";g.textBaseline="top";
  for(let q=0;q<=100;q+=25){const x=X(q/100);g.strokeStyle=C.grid;g.beginPath();g.moveTo(x,T);g.lineTo(x,B);g.stroke();
    g.fillStyle=C.muted;g.fillText(q+"%",x,B+5);g.fillText((q/100*meanT).toFixed(2)+" s",x,B+19)}
  g.textAlign="left";g.textBaseline="top";g.fillText(unit,L+4,T+2);
  // catch (solid) and mean finish (dashed)
  const xc=X(0);g.strokeStyle=C.muted;g.beginPath();g.moveTo(xc,T);g.lineTo(xc,B);g.stroke();
  const fin=list.reduce((a,s)=>a+(t[s.f]-t[s.c])/(t[s.n]-t[s.c]),0)/list.length;
  const xf=X(fin);g.setLineDash([4,3]);g.beginPath();g.moveTo(xf,T);g.lineTo(xf,B);g.stroke();g.setLineDash([]);
  g.fillStyle=C.muted;g.fillText("finish",xf+4,B-16);g.fillText("catch",xc+4,B-16);
  const line=(c,col,wd,al)=>{g.strokeStyle=col;g.lineWidth=wd;g.globalAlpha=al;g.beginPath();for(let q=0;q<N;q++){const x=X(U(q)),y=Y(c[q]);q?g.lineTo(x,y):g.moveTo(x,y)}g.stroke();g.globalAlpha=1};
  curves.forEach((c,j)=>{if(j<curves.length-1)line(c,C.hull,1,0.45)});
  line(mean,C.accent,2.6,1);
  line(curves[curves.length-1],C.blade,1.6,1);
  // time indicator: where the current moment falls in its stroke
  let frac=null;
  const sk=k>=0?S.strokes[k]:null;
  if(pinned!==null)frac=Math.max(-P,Math.min(1,(t[cursor]-t[sk.c])/Math.max(1e-3,t[sk.n]-t[sk.c])));   // dragging: lead-in included
  else if(sk&&cursor>=sk.c&&cursor<sk.n)frac=(t[cursor]-t[sk.c])/Math.max(1e-3,t[sk.n]-t[sk.c]);
  else if(S.catches&&S.catches.length){const lc=S.catches[S.catches.length-1];if(cursor>=lc){const e=(t[cursor]-t[lc])/meanT;if(e<=1)frac=e}}
  // what a click or drag on this chart moves through: the stroke the cursor is in (or the latest)
  const tgt=pinned!==null||(sk&&cursor>=sk.c&&cursor<sk.n)?sk:list[list.length-1];
  cv._pmap={L,Rr,c:tgt.c,n:tgt.n,pre:P,idx:S.strokes.indexOf(tgt)};
  if(frac!==null){
    const mark=(u,al)=>{const x=X(u),y=Y(Math.max(mn,Math.min(mx,arr[cursor])));
      g.globalAlpha=al;g.strokeStyle=C.ink;g.lineWidth=1;g.beginPath();g.moveTo(x,T);g.lineTo(x,B);g.stroke();
      g.fillStyle=C.ink;g.beginPath();g.arc(x,y,4,0,7);g.fill();g.globalAlpha=1;return x};
    // late in the recovery the moment also shows in the lead-in, just before the next catch
    if(pinned===null&&frac>1-P)mark(frac-1,0.35);
    const x=mark(frac,1);
    const lab=(frac*meanT).toFixed(2)+" s · "+Math.round(frac*100)+"%";
    g.font="600 11px "+font;g.textBaseline="top";
    const tw=g.measureText(lab).width,right=x+6+tw<Rr;g.textAlign=right?"left":"right";
    g.fillStyle=C.panel;g.fillRect(right?x+3:x-tw-7,T+1,tw+4,14);g.fillStyle=C.ink;g.fillText(lab,right?x+5:x-5,T+2);
  }
  g.lineWidth=1;
}

function updateBoatStats(){
  const V=S.strokes.filter(s=>s.valid),avg=f=>V.length?V.reduce((a,s)=>a+f(s),0)/V.length:NaN;
  const put=(id,v,u,dec)=>{$(id).innerHTML=isFinite(v)?(v>0&&(id.endsWith("Peak"))?"+":"")+v.toFixed(dec)+"<small class=u>"+u+"</small>":"–"};
  const k=S.strokeAt(cursor);let s=null;for(let j=k;j>=0;j--)if(S.strokes[j].valid){s=S.strokes[j];break}
  const recent=s&&S.t.a[cursor]-S.t.a[s.n]<5;
  const rows=[["Rate",x=>x.rate,"spm",1],["Check",x=>x.check,"m/s²",1],["Peak",x=>x.peak,"m/s²",1],["Tpk",x=>x.tPeak,"ms",0],
              ["Dv",x=>x.dv,"m/s",2],["Ratio",x=>x.ratio,"",2],["Set",x=>x.set,"°",1]];
  for(const [n,f,u,d] of rows){put("ba"+n,avg(f),u,d);if(recent)put("bs"+n,f(s),u,d);else $("bs"+n).textContent="–"}
  $("boatCount").textContent=V.length+" strokes detected"+(S.axisInfo?" · "+S.axisInfo:"");
  $("boatInfo").textContent=S.axisInfo||"";
}

// ---------------------------------------------------------------- stats
function updateStats(){
  if(!S)return;
  const V=S.strokes.filter(s=>s.valid);
  const avg=f=>V.length?V.reduce((a,s)=>a+f(s),0)/V.length:NaN;
  const put=(id,v,u,dec=0)=>{$(id).innerHTML=isFinite(v)?(u==="°"?fmtA(v):v.toFixed(dec))+(u&&u!=="°"?"<small>"+u+"</small>":""):"–"};
  put("aRate",avg(s=>s.rate),"spm",1);put("aArc",avg(s=>s.arc),"",0);$("aArc").innerHTML+=isFinite(avg(s=>s.arc))?"<small>°</small>":"";
  put("aCatch",avg(s=>s.catchA),"°");put("aFin",avg(s=>s.finA),"°");put("aRatio",avg(s=>s.ratio),"",2);
  const k=S.strokeAt(cursor);let s=null;for(let j=k;j>=0;j--)if(S.strokes[j].valid){s=S.strokes[j];break}
  if(s&&S.t.a[cursor]-S.t.a[s.n]<5){put("sRate",s.rate,"spm",1);put("sArc",s.arc,"",0);$("sArc").innerHTML+="<small>°</small>";put("sCatch",s.catchA,"°");put("sFin",s.finA,"°");put("sRatio",s.ratio,"",2)}
  else for(const id of ["sRate","sArc","sCatch","sFin","sRatio"])$(id).textContent="–";
  $("strokeCount").textContent=V.length+" strokes detected · "+(S.zeroed?"sweep zeroed by tap calibration":"not zeroed: sweep is relative to the average oar position")+(S.biasSet?"":" · gyro bias not yet measured (hold the oar still)");
}

