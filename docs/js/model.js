"use strict";
// Examples: reference figures, the rower model and the synthetic sessions.
// ---------------------------------------------------------------- boat examples
// Synthetic single sculls. Each example is a boat-acceleration curve built from the features
// Kleshnev describes: the catch dip, the "first peak" straight after it (legs pushing off the
// stretcher, high in elite crews), where the main drive peak sits (front-loaded sequential
// legs-first drive vs. a later peak when legs and trunk work together), the mid-drive "hump"
// when legs and trunk disconnect, the release dip, and the recovery (rower moving to the stern
// pushes the boat on; stopping at the catch pulls it back). Shapes are given on a normalised
// stroke where the drive is the first 40 %; at higher rates the drive takes a bigger share.
// [amplitude m/s², centre, width] triples on that normalised stroke.
// ---------------------------------------------------------------- reference figures
// Slots for published figures, shown under the stroke profile (Analysis → Overview, boat sessions). Fill in `src` with
// the address of an image you host (a path next to this page such as "figures/kleshnev-2010-fig3.png",
// or a full https URL). Entries with an empty `src` are not shown; the panel stays hidden until at
// least one has an image. `example` picks the entry automatically when that example is loaded.
// Keep `credit` and `href` so every figure stays attributed to its source.
const REFERENCE_FIGURES=[
  {id:"kl2010-rates",example:"front",src:"",
   caption:"Boat and rower centre-of-mass acceleration over the stroke at different stroke rates.",
   credit:"Kleshnev V. (2010) Boat acceleration, temporal structure of the stroke cycle, and effectiveness in rowing. Proc IMechE Part P, 224(1).",
   href:"https://doi.org/10.1243/17543371jset40"},
  {id:"kl-styles",example:"late",src:"",
   caption:"Rowing styles: timing of legs and trunk, and how it shapes the force and acceleration curves.",
   credit:"Kleshnev V. Rowing Styles, Analysis and Optimisation. row2k.",
   href:"https://www.row2k.com/features/5531/rowing-styles-analysis-and-optimisation-by-dr-valery-kleshnev/"},
  {id:"rim-hump",example:"hump",src:"",
   caption:"A mid-drive hump in the boat acceleration curve compared with an elite curve.",
   credit:"Rowing in Motion: Improve your Stroke – avoid the drive hump.",
   href:"https://www.rowinginmotion.com/improve-your-stroke-avoid-the-drive-hump/"},
  {id:"extra-1",example:"amateur",src:"",caption:"",credit:"",href:""},
  {id:"extra-2",example:"",src:"",caption:"",credit:"",href:""}
];
function refFigures(){return REFERENCE_FIGURES.filter(f=>f.src)}
function refInit(){
  const figs=refFigures(),sel=$("refSel");
  $("refPanel").dataset.has=figs.length?"1":"";
  sel.replaceChildren(...figs.map(f=>{const o=document.createElement("option");o.value=f.id;o.textContent=f.caption||f.id;return o}));
  sel.hidden=figs.length<2;
  if(figs.length)refShow(figs[0].id);
}
function refShow(id){
  const f=REFERENCE_FIGURES.find(x=>x.id===id&&x.src);if(!f)return;
  $("refSel").value=f.id;$("refImg").src=f.src;$("refImg").alt=f.caption||"Reference figure";
  const L=$("refLink");if(f.href)L.href=f.href;else L.removeAttribute("href");
  const cap=$("refCap");cap.replaceChildren();
  if(f.caption)cap.append(f.caption+" ");
  if(f.credit||f.href){const a=document.createElement(f.href?"a":"span");a.textContent="Source: "+(f.credit||f.href);
    if(f.href){a.href=f.href;a.target="_blank";a.rel="noopener"}cap.append(a)}
}
function refForExample(k){const f=refFigures().find(x=>x.example===k);if(f)refShow(f.id)}

// Where to see the real curves these examples are modelled on.
const EX_SOURCES=[
  ["Boat acceleration and temporal structure of the stroke cycle (2010)","https://doi.org/10.1243/17543371jset40"],
  ["Figure: boat and rower acceleration at different rates","https://www.researchgate.net/figure/Patterns-of-acceleration-of-a-the-boat-and-b-the-rowers-CM-at-different-stroke-rates_fig3_245524699"],
  ["Rowing styles (row2k)","https://www.row2k.com/features/5531/rowing-styles-analysis-and-optimisation-by-dr-valery-kleshnev/"],
  ["The drive hump (Rowing in Motion)","https://www.rowinginmotion.com/improve-your-stroke-avoid-the-drive-hump/"]];
// ---------------------------------------------------------------- rower model
// A single sculler as a chain of segments in the boat frame (x toward the bow, z up, origin at the
// pins on the waterline; the sculler faces the stern). Technique = how legs, trunk and arms move
// through the drive and recovery, plus the shape of the handle force. From that:
//  - the rower's centre of mass along the boat (its acceleration is the inertia force),
//  - the handle position, so the oar angle (the oar pivots at the pin),
//  - the blade force (handle force x leverage x forward component of the oar angle).
// Boat acceleration then follows from Newton on the boat + rower system:
//   (m_boat + m_rower) * a_boat = F_blade_forward - drag - m_rower * a_rower_relative
const RIG={IN:0.88,OUT:1.99,BLADE:0.47,pinZ:0.3,pinY:0.8};
const BODY={heelX:-0.33,heelZ:0.17,hipZ:0.30,shank:0.47,thigh:0.47,trunk:0.55,head:0.2,arm:0.63,handZ:0.42,drawnReach:0.24};
const SEG={legs:0.32,trunk:0.58,arms:0.10};          // share of body mass
const smooth5=x=>x<=0?0:x>=1?1:x*x*x*(x*(6*x-15)+10);   // continuous up to acceleration
const PROFILES=new Map();
function profile(up,down,su,sd){ // position 0..1 for a movement whose speed ramps up, holds, and ramps down
  // su/sd: start/end with a finite acceleration (a continuous reversal, as at the catch) instead of from rest
  const key=[up,down,su,sd].join();if(PROFILES.has(key))return PROFILES.get(key);
  const n=2000,x=new Float64Array(n+1),v=new Float64Array(n+1);
  const rise=u=>su?(u>=1?1:Math.sin(Math.PI/2*u)):smooth5(u),fall=u=>sd?(u>=1?1:Math.sin(Math.PI/2*u)):smooth5(u);
  const vel=u=>rise(Math.min(1,u/up))*fall(Math.min(1,(1-u)/down));
  for(let i=0;i<=n;i++)v[i]=vel(i/n);
  for(let i=1;i<=n;i++)x[i]=x[i-1]+(v[i]+v[i-1])/(2*n);
  const L=x[n];for(let i=0;i<=n;i++){x[i]/=L;v[i]/=L}
  // cubic Hermite between nodes using the known speed: smooth position, speed and acceleration
  const f=u=>{if(u<=0)return 0;if(u>=1)return 1;const g=u*n,i=Math.floor(g),s=g-i,h=1/n;
    const s2=s*s,s3=s2*s;return (2*s3-3*s2+1)*x[i]+(s3-2*s2+s)*h*v[i]+(-2*s3+3*s2)*x[i+1]+(s3-s2)*h*v[i+1]};
  PROFILES.set(key,f);return f;
}
// w = [start, end, up, down, reversal-at-start, reversal-at-end]: window as a fraction of the
// drive/recovery and its speed profile
const win=(x,w)=>profile(w[2]??0.5,w[3]??0.5,w[4],w[5])((x-w[0])/(w[1]-w[0]));
// Techniques. Drive windows [start,end] as fractions of the drive; recovery windows likewise.
// force: [blade entry, blade exit, peak position, shape exponent, optional mid-drive dip [at, depth, width]]
const TECH={
  // legs connect quickly at the catch, trunk joins as the legs are halfway, arms finish
  front:{label:"sequential, legs first",massR:85,massB:17,body:{tc:28,tf:-25,lmin:0.30},
    drive:{legs:[0,0.76,0.3,0.66,1],trunk:[0.18,0.92,0.5,0.5],arms:[0.5,1,0.5,0.4]},
    rec:{arms:[0,0.4,0.35,0.75],trunk:[0.02,0.72,0.3,0.75],legs:[0.08,1,0.75,0.3,0,1]},
    force:{in:0.02,out:0.97,pk:0.3,k:1.6},speed:[4.35,4.75,5.1],driveT:1.05},
  // legs and trunk start together and share the drive; the effort peaks in the middle
  late:{label:"legs and trunk together",massR:85,massB:17,body:{tc:28,tf:-25,lmin:0.30},
    drive:{legs:[0,0.86,0.42,0.55,1],trunk:[0.04,0.92,0.45,0.55],arms:[0.5,1,0.5,0.4]},
    rec:{arms:[0,0.4,0.35,0.75],trunk:[0.02,0.72,0.3,0.75],legs:[0.08,1,0.75,0.3,0,1]},
    force:{in:0.02,out:0.97,pk:0.48,k:1.7},speed:[4.3,4.7,5.05],driveT:1.08},
  // legs drive first, then the trunk opens late and suddenly ("double trunk work"): a second burst of
  // body acceleration mid-drive while the handle force sags, so the boat slows again (the hump)
  hump:{label:"trunk opens late and suddenly",massR:82,massB:17,body:{tc:26,tf:-25,lmin:0.31},
    drive:{legs:[0,0.64,0.3,0.5,1],trunk:[0.34,0.8,0.3,0.45],arms:[0.6,1,0.5,0.4]},
    rec:{arms:[0,0.4,0.35,0.75],trunk:[0.02,0.72,0.3,0.75],legs:[0.08,1,0.75,0.3,0,1]},
    force:{in:0.03,out:0.95,pk:0.27,k:1.5,dip:[0.45,0.4,0.1]},speed:[3.95,4.3,4.55],driveT:1.08},
  // blade goes in late while the body is already moving, arms bend early, force fades before the
  // finish; on the recovery the seat hurries up the slide and stops hard at the front stops
  amateur:{label:"slow catch, early arms, rushed slide",massR:80,massB:17,body:{tc:18,tf:-30,lmin:0.36},
    drive:{legs:[0.04,0.82,0.5,0.6],trunk:[0.3,0.95,0.5,0.5],arms:[0.2,1,0.5,0.4]},
    rec:{arms:[0,0.4,0.35,0.7],trunk:[0.03,0.65,0.35,0.7],legs:[0.18,0.92,0.25,0.22]},
    force:{in:0.12,out:0.86,pk:0.5,k:1.3},speed:[3.35,3.6,3.8],driveT:1.15},
};
TECH.generic=TECH.front;
// leg extension, trunk angle (deg, + = leaning to the stern) and arm draw for a stroke phase
function techPose(tech,ph){
  const d=tech.drive,r=tech.rec;
  if(ph.drive!==undefined){const u=ph.drive;
    const legs=win(u,d.legs),trunk=win(u,d.trunk),arms=win(u,d.arms);
    const b=tech.body;return {legs,trunk:b.tc+(b.tf-b.tc)*trunk,arms,lmin:b.lmin}}
  const v=ph.rec;
  const b=tech.body,arms=1-win(v,r.arms),trunk=b.tf+(b.tc-b.tf)*win(v,r.trunk),legs=1-win(v,r.legs);
  return {legs,trunk,arms,lmin:b.lmin};
}
// joint positions (x,z) in the boat frame and the rower's centre of mass x
function bodyJoints(p){
  const B=BODY,dz=B.hipZ-B.heelZ,leg=B.shank+B.thigh;
  const dMin=p.lmin||0.3,dMax=Math.sqrt(leg*leg-dz*dz)*0.985;
  const heel=[B.heelX,B.heelZ],hip=[B.heelX+dMin+(dMax-dMin)*p.legs,B.hipZ];
  const hd=Math.hypot(hip[0]-heel[0],hip[1]-heel[1]),a=Math.acos(Math.min(1,(B.shank*B.shank+hd*hd-B.thigh*B.thigh)/(2*B.shank*hd)));
  const base=Math.atan2(hip[1]-heel[1],hip[0]-heel[0]),knee=[heel[0]+B.shank*Math.cos(base+a),heel[1]+B.shank*Math.sin(base+a)];
  const th=p.trunk*Math.PI/180,sh=[hip[0]-B.trunk*Math.sin(th),hip[1]+B.trunk*Math.cos(th)];
  const head=[sh[0]-B.head*Math.sin(th),sh[1]+B.head*Math.cos(th)];
  const dzh=sh[1]-B.handZ,straight=Math.sqrt(Math.max(0.01,B.arm*B.arm-dzh*dzh));
  const reach=straight+(B.drawnReach-straight)*p.arms;             // horizontal distance shoulder->hand
  const hand=[sh[0]-reach,B.handZ];
  const hh=Math.hypot(sh[0]-hand[0],sh[1]-hand[1]),ea=Math.acos(Math.min(1,hh/B.arm)); // elbow bends as the hand comes in
  const ang=Math.atan2(hand[1]-sh[1],hand[0]-sh[0]),elbow=[sh[0]+B.arm/2*Math.cos(ang-ea),sh[1]+B.arm/2*Math.sin(ang-ea)];
  const cmx=SEG.legs*(0.25*heel[0]+0.4*knee[0]+0.35*hip[0])+SEG.trunk*(hip[0]+0.55*(sh[0]-hip[0]))+SEG.arms*(0.5*(sh[0]+hand[0]));
  return {heel,knee,hip,sh,head,elbow,hand,cmx};
}
// oar angle from the handle: + = blade toward the bow (catch), handle x = -IN*sin(angle)
const sweepFromHand=hx=>Math.asin(Math.max(-0.99,Math.min(0.99,-hx/RIG.IN)));
function handleForce(tech,ph){ // relative handle force 0..1
  if(ph.drive===undefined)return 0;
  const f=tech.force,x=(ph.drive-f.in)/(f.out-f.in);if(x<=0||x>=1)return 0;
  const a=f.k*f.pk/(1-f.pk),b=f.k; // peak at pk
  let v=Math.pow(x,a)*Math.pow(1-x,b)/(Math.pow(f.pk,a)*Math.pow(1-f.pk,b));
  if(f.dip)v*=1-f.dip[1]*Math.exp(-0.5*((x-f.dip[0])/f.dip[2])**2);
  return v;
}
function phaseOf(p,df){return p<df?{drive:p/df}:{rec:(p-df)/(1-df)}}
// Simulate a session: returns boat acceleration, rower cm, phase per sample.
function simulateRowing(kind,fs,T,opts={}){
  const tech=TECH[kind],n=Math.round(fs*T),dt=1/fs;
  const M=tech.massB+tech.massR,k=3.9;                   // drag: F = k v^2 (single scull incl. rower)
  const acc=new Float32Array(n),cm=new Float32Array(n),phs=new Float32Array(n),sp=new Float32Array(n),force=new Float32Array(n),vel=new Float32Array(n),inert=new Float32Array(n),prop=new Float32Array(n),rates=opts.rates||[22,28,34];
  const rnd=opts.rnd||Math.random,vari=opts.vari||0;
  let v=tech.speed[0],ph=0,last=-1,st=null;
  const warm=Math.round(12*fs);
  const strokeParams=(rate,target)=>{
    const df=Math.min(0.55,tech.driveT*(1+0.01*(22-rate))*rate/60);
    // scale force so the mean forward blade force balances drag at the target speed
    let g=0;for(let q=0;q<400;q++){const P=phaseOf(q/400,df);if(P.drive===undefined)continue;
      const hx=bodyJoints(techPose(tech,P)).hand[0];g+=handleForce(tech,P)*Math.cos(sweepFromHand(hx))}
    g=2*g/400*RIG.IN/(RIG.OUT-RIG.BLADE/2);
    return {df,F:k*target*target/g};
  };
  for(let i=-warm;i<n;i++){
    const t=Math.max(0,i)/fs,ri=t<45?0:t<70?1:2,rate0=rates[ri],target0=tech.speed[ri];
    if(Math.floor(ph)!==last){last=Math.floor(ph);const rate=rate0*(1+vari*0.4*(rnd()*2-1));
      st={rate,...strokeParams(rate,target0*(1+vari*0.3*(rnd()*2-1)))};st.F*=1+vari*(rnd()*2-1)}
    const p=ph-Math.floor(ph),P=phaseOf(p,st.df),J=bodyJoints(techPose(tech,P));
    const ang=sweepFromHand(J.hand[0]);
    const Fb=2*st.F*handleForce(tech,P)*RIG.IN/(RIG.OUT-RIG.BLADE/2)*Math.cos(ang);
    // rower acceleration relative to the boat: central difference of the cm over +-2 ms
    const dp=0.004*st.rate/60,cmAt=q=>bodyJoints(techPose(tech,phaseOf(((q%1)+1)%1,st.df))).cmx;
    const ar=(cmAt(p+dp)-2*J.cmx+cmAt(p-dp))/(0.004*0.004);
    const a=(Fb-k*v*Math.abs(v)-tech.massR*ar)/M;
    v+=a*dt;
    if(i>=0){acc[i]=a;cm[i]=J.cmx;phs[i]=p;sp[i]=P.drive!==undefined?P.drive:1+P.rec;force[i]=Fb/2/(RIG.IN/(RIG.OUT-RIG.BLADE/2))/Math.max(1e-3,Math.cos(ang));vel[i]=v;inert[i]=-tech.massR*ar/M;prop[i]=Fb/M}
    ph+=st.rate/60/fs;
  }
  return {acc,cm,phase:phs,sp,force,vel,inert,prop};
}

// The boat examples are produced by the rower model above: the sculler's technique causes the curve.
const BOAT_EXAMPLES={
  front:{name:"Elite · front-loaded",rates:[22,28,34],var:0.02,rollNoise:0.3,
    note:"Sequential, legs-first technique. The legs connect quickly at the catch: the rower's mass reversing direction gives a short, deep check, and the fast-rising blade force a first peak. The trunk takes over as the legs slow, so the boat keeps accelerating through the middle of the drive."},
  late:{name:"Elite · late peak",rates:[22,28,34],var:0.02,rollNoise:0.3,
    note:"Legs and trunk start together and share the drive. More of the body accelerates at once, so the check is broader; the biggest boat acceleration comes later in the drive, as legs and trunk slow down together while the blade force is still high."},
  hump:{name:"Club · mid-drive hump",rates:[20,26,30],var:0.05,rollNoise:0.6,
    note:"Legs first, then the trunk opens late and suddenly (double trunk work) while the handle force sags. That second burst of body acceleration pulls on the boat mid-drive: after the first peak the boat slows again (the hump) before a second peak."},
  amateur:{name:"Amateur · slow catch, rushed slide",rates:[18,21,24],var:0.08,rollNoise:1.2,
    note:"My estimate of a novice. The seat hurries up the slide and stops hard at the front stops (a dip before the catch), the blade goes in late while the body is already moving (a long, shallow check), the arms bend early and the force fades before the finish. Less reach, more variation from stroke to stroke, and a less stable set."}
};
function makeBoatDemo(kind="front"){
  const ex=BOAT_EXAMPLES[kind]||BOAT_EXAMPLES.front;
  const fs=200,T=90,n=fs*T,out={t:new Float64Array(n),n,mode:"boat",tech:kind,axis:"-Z"};   // sensor -Z points to the bow
  for(const k of ["ax","ay","az","gx","gy","gz"])out[k]=new Float32Array(n);
  const sim=simulateRowing(kind,fs,T,{rates:ex.rates,vari:ex.var});
  out.sp=sim.sp;                                 // stroke phase, so the 3D sculler moves as simulated
  // true boat speed from the model, for the absolute view: distance covered (pos) and a smooth
  // "average speed" distance (base, speed averaged over ~3 s) to scale the in-stroke part by
  out.speed=sim.vel;
  {const P=new Float64Array(n),Bs=new Float64Array(n),H=fs*1.5|0,C=new Float64Array(n+1);
   for(let i=0;i<n;i++)C[i+1]=C[i]+sim.vel[i];
   let acc=0,bacc=0;for(let i=0;i<n;i++){const lo=Math.max(0,i-H),hi=Math.min(n,i+H);
     acc+=sim.vel[i]/fs;bacc+=(C[hi]-C[lo])/(hi-lo)/fs;P[i]=acc;Bs[i]=bacc}
   out.pos=P;out.basePos=Bs}
  let cmMean=0;for(let i=0;i<n;i++)cmMean+=sim.cm[i];cmMean/=n;
  const rnd=()=>{let s=0;for(let k=0;k<4;k++)s+=Math.random();return (s-2)*0.87};
  let prev=null,rollW=0,rollOff=0,lastStroke=-1;
  const Rx=a=>[[1,0,0],[0,Math.cos(a),-Math.sin(a)],[0,Math.sin(a),Math.cos(a)]];
  const Ry=a=>[[Math.cos(a),0,Math.sin(a)],[0,1,0],[-Math.sin(a),0,Math.cos(a)]];
  const mul=(A,B)=>A.map(r=>[0,1,2].map(j=>r[0]*B[0][j]+r[1]*B[1][j]+r[2]*B[2][j]));
  const tv=(A,v)=>[0,1,2].map(j=>A[0][j]*v[0]+A[1][j]*v[1]+A[2][j]*v[2]); // A^T v
  for(let i=0;i<n;i++){
    const t=i/fs,ph=sim.phase[i];
    if(i&&ph<sim.phase[i-1]){lastStroke++;rollOff=ex.rollNoise*(Math.random()*2-1)}
    const surge=sim.acc[i],heave=0.5*Math.sin(4*Math.PI*ph),sway=0.25*Math.sin(2*Math.PI*ph+1);
    rollW+=(rollOff-rollW)*(1/fs/0.8);            // set: slow wander, larger for less stable crews
    // trim follows the rower's mass: moving to the stern sinks the stern, so the bow comes up
    // (Ry here tilts the bow down for a positive angle, hence the sign)
    const pitch=2.2*D2R*(sim.cm[i]-cmMean),roll=D2R*(2*Math.sin(2*Math.PI*t/7)+0.8*Math.sin(2*Math.PI*ph)+2*rollW);
    const R=mul(Ry(pitch),Rx(roll)),f=tv(R,[surge,sway,heave+G0]);
    let w=[0,0,0];if(prev){const d=mul(prev.map((r,a)=>[0,1,2].map(b=>prev[b][a])),R);w=[(d[2][1]-d[1][2])/2*fs,(d[0][2]-d[2][0])/2*fs,(d[1][0]-d[0][1])/2*fs]}
    prev=R;
    // sensor x = -boat y, sensor y = boat z, sensor z = -boat x
    const fa=[-f[1],f[2],-f[0]],wa=[-w[1],w[2],-w[0]];
    out.t[i]=t;out.ax[i]=fa[0]/G0+rnd()*0.005;out.ay[i]=fa[1]/G0+rnd()*0.005;out.az[i]=fa[2]/G0+rnd()*0.005;
    out.gx[i]=wa[0]*R2D+0.3+rnd()*0.2;out.gy[i]=wa[1]*R2D-0.2+rnd()*0.2;out.gz[i]=wa[2]*R2D+rnd()*0.2;
  }
  return out;
}

// ---------------------------------------------------------------- demo data
function makeDemo(){
  const fs=200,T=80,n=fs*T,out={t:new Float64Array(n),n};
  for(const k of ["ax","ay","az","gx","gy","gz"])out[k]=new Float32Array(n);
  const smooth=x=>x<=0?0:x>=1?1:(1-Math.cos(Math.PI*x))/2;
  const band=(p,a,b,r)=>smooth((p-(a-r))/r)*(1-smooth((p-b)/r));
  const bias=[0.6,-0.4,0.25];let phase=0,prevR=null;
  const rnd=()=>{let s=0;for(let k=0;k<4;k++)s+=Math.random();return (s-2)*0.87};
  for(let i=0;i<n;i++){
    const t=i/fs,rate=t<35?20:t<60?28:34;
    const blend=smooth((t-3)/2);
    if(t>4)phase=(phase+rate/60/fs)%1;
    const p=phase, catchA=-54+(rate-20)*0.2, finA=33;
    let psi;
    if(p>=0.05&&p<0.45)psi=catchA+(finA-catchA)*smooth((p-0.05)/0.4);
    else{const r=((p<0.05?p+1:p)-0.45)/0.6;psi=finA+(catchA-finA)*smooth(r)}
    const theta=3.5+(-5-3.5)*band(p,0.05,0.45,0.04);
    const phi=90*band(p,0.55,0.9,0.08);
    const heading=0.35*t+4*Math.sin(0.07*t);
    const P=(psi*blend+heading)*D2R, Th=(-3+(theta+3)*blend)*D2R, Ph=(90+(phi-90)*blend)*D2R;
    const {s,u}=oarVectors(P,Th,Ph), y=cross(u,s);
    const R=[s,y,u]; // columns (body axes in world)
    const gB=[R[0][2],R[1][2],R[2][2]];
    out.t[i]=t;
    const tap=[1.2,1.5,1.8].some(tt=>Math.abs(t-tt)<0.006)?1.4:0; // three taps on the gunwale
    out.ax[i]=gB[0]+rnd()*0.01+(blend*0.08*Math.sin(2*Math.PI*p))+tap;
    out.ay[i]=gB[1]+rnd()*0.01;out.az[i]=gB[2]+rnd()*0.01;
    let w=[0,0,0];
    if(prevR){ // body rate from rotation increment
      const A=(a,b)=>dot(prevR[a],R[b]);
      w=[(A(2,1)-A(1,2))/2*fs*R2D,(A(0,2)-A(2,0))/2*fs*R2D,(A(1,0)-A(0,1))/2*fs*R2D];
    }
    prevR=R;
    out.gx[i]=w[0]+bias[0]+rnd()*0.3;out.gy[i]=w[1]+bias[1]+rnd()*0.3;out.gz[i]=w[2]+bias[2]+rnd()*0.3;
    out.ax[i]-=((w[1]*D2R)**2+(w[2]*D2R)**2)*0.3/9.80665; // centripetal, sensor 0.3 m outboard of the pin
  }
  out.cal=[2.3];
  return out;
}

