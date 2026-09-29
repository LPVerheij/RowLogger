"use strict";
// Reading log files.
// ---------------------------------------------------------------- CSV parsing
// Stroke-window logs from the older boat logger: StrokeID, Phase (PRE/STROKE), t_ms relative to a
// stroke trigger, acceleration in m/s² (or g/mg), no gyro. Each STROKE block runs from one
// trigger to the next and is capped (75 rows = 3 s at 25 Hz); the 1 s PRE blocks are skipped
// because that logger mostly repeats a stale buffer there. The STROKE blocks are laid end to end
// to rebuild a timeline; after a capped block the real pause is unknown and a 1 s gap is used.
// The viewer's own boat analysis then finds the catches.
function parseStrokeWindows(lines,hdr,li){
  const col=n=>hdr.findIndex(h=>h===n||h.startsWith(n+"_"));
  const iS=col("strokeid"),iP=col("phase"),iT=col("t"),iA=["ax","ay","az"].map(col);
  if(iT<0||iA.some(i=>i<0))throw new Error("Stroke log: could not find t_ms and ax…az columns in: "+hdr.join(", "));
  const u=hdr[iA[0]].slice(hdr[iA[0]].indexOf("_")+1);
  const aScale=/ms2|m\/s/.test(u)?1/9.80665:/mg/.test(u)?1e-3:1;
  const wins=[];let cur=null;
  for(;li<lines.length;li++){
    const L=lines[li];if(!L||L[0]==="#")continue;
    const p=L.split(/[,;\t]/);
    if((p[iP]||"").trim().toUpperCase()==="PRE")continue;
    const id=p[iS].trim(),t=parseFloat(p[iT]);if(!isFinite(t))continue;
    if(!cur||cur.id!==id){cur={id,rows:[]};wins.push(cur)}
    cur.rows.push([t,parseFloat(p[iA[0]])*aScale,parseFloat(p[iA[1]])*aScale,parseFloat(p[iA[2]])*aScale]);
  }
  const cap=Math.max(...wins.map(w=>w.rows.length));
  const n=wins.reduce((a,w)=>a+w.rows.length,0),out={t:new Float64Array(n),n,mode:"boat",cal:[]};
  for(const k of ["ax","ay","az","gx","gy","gz"])out[k]=new Float32Array(n);
  let T=0,i=0,gaps=0;
  for(const w of wins){
    const r=w.rows,dt=r.length>1?(r[r.length-1][0]-r[0][0])/(r.length-1):40;
    for(const [t,ax,ay,az] of r){out.t[i]=T+t/1000;out.ax[i]=ax;out.ay[i]=ay;out.az[i]=az;i++}
    T+=(r[r.length-1][0]+dt)/1000;                  // the next trigger: where this block ended
    if(r.length>=cap){out.gaps=out.gaps||[];out.gaps.push(T+1);T+=1;gaps++}   // capped: the real pause is unknown
  }
  // keep time strictly increasing (a block can start a few ms before the previous one ended)
  for(let k=1;k<n;k++)if(out.t[k]<=out.t[k-1])out.t[k]=out.t[k-1]+0.001;
  const t0=out.t[0];for(let k=0;k<n;k++)out.t[k]-=t0;
  if(out.gaps)out.gaps=out.gaps.map(g=>[g-1-t0,g-t0]);  // [start, end] of each inserted pause
  // Fore-aft direction from the windows themselves: the axis along which the within-window pattern
  // is strongest, pointed so that the catch check (which this logger's trigger follows closely,
  // so it sits at the end of each window) is negative.
  {const up=[0,0,0];for(let k=0;k<n;k++){up[0]+=out.ax[k];up[1]+=out.ay[k];up[2]+=out.az[k]}
   const un=norm(up),C=[[0,0,0],[0,0,0],[0,0,0]],full=wins.filter(w=>w.rows.length>=12&&w.rows.length<cap);
   const hor=r=>{const a=[r[1],r[2],r[3]],d=dot(a,un);return [a[0]-d*un[0],a[1]-d*un[1],a[2]-d*un[2]]};
   for(const w of full){const H=w.rows.map(hor),m=[0,1,2].map(q=>H.reduce((a,h)=>a+h[q],0)/H.length);
     for(const h of H)for(let r=0;r<3;r++)for(let q=0;q<3;q++)C[r][q]+=(h[r]-m[r])*(h[q]-m[q])}
   let e=norm(cross(un,[0,0,1]).map((v,q)=>v+[0.3,0.2,0.1][q]));
   for(let it=0;it<50;it++){const v=[0,1,2].map(r=>dot(C[r],e));const d=dot(v,un);e=norm([v[0]-d*un[0],v[1]-d*un[1],v[2]-d*un[2]])}
   let end=0,cnt=0;for(const w of full){const H=w.rows.map(hor),pr=H.map(h=>dot(h,e)),m=pr.reduce((a,b)=>a+b,0)/pr.length;
     for(let q=Math.floor(pr.length*0.75);q<pr.length;q++){end+=pr[q]-m;cnt++}}
   if(full.length>=20){if(end>0)e=e.map(v=>-v);out.axisVec=e}}
  out.note=`stroke-window log: ${wins.length} windows laid end to end, no gyro`+(gaps?`, ${gaps} pauses over 3 s shortened to 1 s`:"");
  return out;
}
function parseCSV(text){
  const lines=text.split(/\r?\n/);let fileMode=null;
  let hdr=null,li=0;
  for(;li<lines.length;li++){
    const L=lines[li].trim();if(!L)continue;
    if(L[0]==="#"){const mm=/^#\s*mode\s*=\s*(\w+)/i.exec(L);if(mm)fileMode=mm[1].toLowerCase();continue}
    if(/[a-z]/i.test(L)){hdr=L.split(/[,;\t]/).map(s=>s.trim().toLowerCase());li++;}
    break;
  }
  if(!hdr)hdr=["t_ms","ax_mg","ay_mg","az_mg","gx_ddps","gy_ddps","gz_ddps"];
  if(hdr.includes("strokeid")&&hdr.includes("phase"))return parseStrokeWindows(lines,hdr,li);
  const find=p=>hdr.findIndex(h=>h===p||h.startsWith(p+"_")||h.startsWith(p+" ")||h.startsWith(p+"("));
  const ti=hdr.findIndex(h=>/^(t|time|timestamp)(\b|_|\s|\()/.test(h));
  const cols=["ax","ay","az","gx","gy","gz"].map(find);
  if(ti<0||cols.some(c=>c<0))throw new Error("Could not find t, ax…az, gx…gz columns in the header: "+hdr.join(", "));
  const unit=h=>h.slice(h.search(/[_ (]/)+1).replace(/[()]/g,"");
  const tu=unit(hdr[ti]);
  const tScale=/us|µs/.test(tu)?1e-6:/ms/.test(tu)?1e-3:/^s$|sec/.test(tu)?1:null;
  const aScale=/mg/.test(unit(hdr[cols[0]]))?1e-3:/ms2|m\/s/.test(unit(hdr[cols[0]]))?1/9.80665:1;
  const gu=unit(hdr[cols[3]]);
  const gScale=/ddps/.test(gu)?0.1:/mdps/.test(gu)?1e-3:/rad/.test(gu)?R2D:1;
  const N=lines.length-li, out={t:new Float64Array(N)};
  const keys=["ax","ay","az","gx","gy","gz"];
  for(const k of keys)out[k]=new Float32Array(N);
  let n=0;const cals=[];
  for(;li<lines.length;li++){
    const L=lines[li];if(!L)continue;
    if(L[0]==="#"){const m=/^#\s*CAL\s*[,=:]?\s*(-?[\d.]+)/i.exec(L);if(m)cals.push(parseFloat(m[1]));continue}
    const p=L.split(/[,;\t]/);
    const tv=parseFloat(p[ti]);if(!isFinite(tv))continue;
    out.t[n]=tv;
    for(let k=0;k<6;k++)out[keys[k]][n]=parseFloat(p[cols[k]])*(k<3?aScale:gScale);
    n++;
  }
  let ts=tScale;
  if(ts===null){const span=out.t[n-1]-out.t[0];ts=span>5000?1e-3:1}
  const t0=out.t[0];
  for(let i=0;i<n;i++)out.t[i]=(out.t[i]-t0)*ts;
  out.n=n;out.cal=cals.map(v=>(v-t0)*ts);out.mode=fileMode;
  return out;
}

