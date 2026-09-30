"use strict";
// RowLog viewer: shared helpers and the oar and boat signal processing.
const $ = id => document.getElementById(id);
const D2R = Math.PI/180, R2D = 180/Math.PI;
const OAR = {inboard:1.15, outboard:2.59, bladeLen:0.55, bladeW:0.21, water:-0.14};   // sweep oar, for drawing only

// ---------------------------------------------------------------- buffers
class Buf{
  constructor(T=Float32Array,n=4096){this.T=T;this.a=new T(n);this.n=0}
  push(v){if(this.n===this.a.length){const b=new this.T(this.a.length*2);b.set(this.a);this.a=b}this.a[this.n++]=v}
}
function axisVec(s){const v=[0,0,0];v["XYZ".indexOf(s[1])]=s[0]==="-"?-1:1;return v}
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=a=>{const n=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/n,a[1]/n,a[2]/n]};

// ---------------------------------------------------------------- Madgwick IMU (6-DOF)
function madgwick(q,gx,gy,gz,ax,ay,az,dt,beta){
  let [q0,q1,q2,q3]=q;
  let d0=0.5*(-q1*gx-q2*gy-q3*gz), d1=0.5*(q0*gx+q2*gz-q3*gy),
      d2=0.5*(q0*gy-q1*gz+q3*gx),  d3=0.5*(q0*gz+q1*gy-q2*gx);
  const n=Math.hypot(ax,ay,az);
  if(beta>0&&n>0){
    ax/=n;ay/=n;az/=n;
    const _2q0=2*q0,_2q1=2*q1,_2q2=2*q2,_2q3=2*q3,_4q0=4*q0,_4q1=4*q1,_4q2=4*q2,_8q1=8*q1,_8q2=8*q2,
          q0q0=q0*q0,q1q1=q1*q1,q2q2=q2*q2,q3q3=q3*q3;
    let s0=_4q0*q2q2+_2q2*ax+_4q0*q1q1-_2q1*ay;
    let s1=_4q1*q3q3-_2q3*ax+4*q0q0*q1-_2q0*ay-_4q1+_8q1*q1q1+_8q1*q2q2+_4q1*az;
    let s2=4*q0q0*q2+_2q0*ax+_4q2*q3q3-_2q3*ay-_4q2+_8q2*q1q1+_8q2*q2q2+_4q2*az;
    let s3=4*q1q1*q3-_2q1*ax+4*q2q2*q3-_2q2*ay;
    const sn=Math.hypot(s0,s1,s2,s3)||1;
    d0-=beta*s0/sn;d1-=beta*s1/sn;d2-=beta*s2/sn;d3-=beta*s3/sn;
  }
  q0+=d0*dt;q1+=d1*dt;q2+=d2*dt;q3+=d3*dt;
  const qn=Math.hypot(q0,q1,q2,q3);
  q[0]=q0/qn;q[1]=q1/qn;q[2]=q2/qn;q[3]=q3/qn;
}
function quatFromAccel(ax,ay,az){
  const r=Math.atan2(ay,az),p=Math.atan2(-ax,Math.hypot(ay,az));
  const cr=Math.cos(r/2),sr=Math.sin(r/2),cp=Math.cos(p/2),sp=Math.sin(p/2);
  return [cr*cp,sr*cp,cr*sp,-sr*sp];
}

// oar direction vectors from angles (world frame, sweep psi, height theta, feather phi)
function oarVectors(psi,theta,phi){
  const s=[Math.cos(theta)*Math.cos(psi),Math.cos(theta)*Math.sin(psi),Math.sin(theta)];
  const h=norm(cross([0,0,1],s)), u0=cross(s,h);
  const c=Math.cos(phi),si=Math.sin(phi);
  return {s,h,u:[c*u0[0]+si*h[0],c*u0[1]+si*h[1],c*u0[2]+si*h[2]]};
}

// ---------------------------------------------------------------- session / processing
class Session{
  constructor(cfg,live=false){
    this.cfg=cfg;this.live=live;
    const X=axisVec(cfg.shaft),Z=axisVec(cfg.up),Y=cross(Z,X);
    this.M=[X,Y,Z];
    this.t=new Buf(Float64Array);
    for(const k of ["ax","ay","az","gx","gy","gz","sweep","vert","feather","det","sm","abs"])this[k]=new Buf();
    this.q=null;this.bias=[0,0,0];this.biasSet=false;this.nextBiasCheck=0;
    this.prevRaw=null;this.wrapOff=0;this.runSum=0;this.j=0;
    this.ext=[];this.strokes=[];this.catchSign=-1;
    this.cals=[];this.curOff=0;this.zeroed=false; // tap-calibration times (s) and sweep offset
  }
  get n(){return this.t.n}
  checkStationary(i){
    const t=this.t.a,te=t[i];let j=i,sx=0,sy=0,sz=0,qx=0,qy=0,qz=0,sa=0,c=0;
    while(j>=0&&t[j]>te-1.0){
      const gx=this.gx.a[j],gy=this.gy.a[j],gz=this.gz.a[j];
      sx+=gx;sy+=gy;sz+=gz;qx+=gx*gx;qy+=gy*gy;qz+=gz*gz;
      sa+=Math.hypot(this.ax.a[j],this.ay.a[j],this.az.a[j]);c++;j--;
    }
    if(c<20||j<0&&t[0]>te-0.95)return false;
    const mx=sx/c,my=sy/c,mz=sz/c,v=Math.max(qx/c-mx*mx,qy/c-my*my,qz/c-mz*mz);
    if(Math.sqrt(Math.max(v,0))<1.2&&Math.abs(sa/c-1)<0.06&&Math.hypot(mx,my,mz)<6){
      this.bias=[mx,my,mz];this.biasSet=true;return true;
    }
    return false;
  }
  append(ts,ax,ay,az,gx,gy,gz){
    const M=this.M,a=[ax,ay,az],g=[gx,gy,gz];
    const oa=[dot(M[0],a),dot(M[1],a),dot(M[2],a)],og=[dot(M[0],g),dot(M[1],g),dot(M[2],g)];
    const i=this.t.n,prevT=i?this.t.a[i-1]:ts;
    this.t.push(ts);this.ax.push(oa[0]);this.ay.push(oa[1]);this.az.push(oa[2]);
    this.gx.push(og[0]);this.gy.push(og[1]);this.gz.push(og[2]);
    if(ts>=this.nextBiasCheck){this.checkStationary(i);this.nextBiasCheck=ts+0.5}
    if(!this.q){this.q=quatFromAccel(oa[0],oa[1],oa[2]);this.tq0=ts}
    let dt=ts-prevT;if(!(dt>0.0002&&dt<0.2))dt=0;
    const an=Math.hypot(oa[0],oa[1],oa[2]);
    const beta=ts-this.tq0<1.5?1.5:(Math.abs(an-1)<0.3?0.08:0);
    if(dt>0)madgwick(this.q,(og[0]-this.bias[0])*D2R,(og[1]-this.bias[1])*D2R,(og[2]-this.bias[2])*D2R,oa[0],oa[1],oa[2],dt,beta);
    const [w,x,y,z]=this.q;
    const s=[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)];
    const u=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)];
    let raw=Math.atan2(s[1],s[0])*R2D;
    if(this.prevRaw!==null){const d=raw-this.prevRaw;if(d>180)this.wrapOff-=360;else if(d<-180)this.wrapOff+=360}
    this.prevRaw=raw;
    const sw=raw+this.wrapOff;
    const vert=Math.asin(Math.max(-1,Math.min(1,s[2])))*R2D;
    const h=norm(cross([0,0,1],s)),u0=cross(s,h);
    const fea=Math.atan2(dot(u,h),dot(u,u0))*R2D;
    this.sweep.push(sw);this.vert.push(vert);this.feather.push(fea);
    // trailing drift removal (live); files are redone centred in finalize()
    this.runSum+=sw;
    while(this.t.a[this.j]<ts-this.cfg.driftWin&&this.j<i){this.runSum-=this.sweep.a[this.j];this.j++}
    const det=sw-this.runSum/(i-this.j+1);
    this.det.push(det);this.abs.push(det+this.curOff);
    const pr=i?this.sm.a[i-1]:det, al=dt>0?dt/(0.04+dt):1;
    this.sm.push(pr+al*(det-pr));
    if(this.live)this.detectStep(i,true);
  }
  finalize(){
    const n=this.n,t=this.t.a,sw=this.sweep.a,P=new Float64Array(n+1);
    for(let i=0;i<n;i++)P[i+1]=P[i]+sw[i];
    const W=this.cfg.driftWin/2;let lo=0,hi=0;
    for(let i=0;i<n;i++){
      while(t[lo]<t[i]-W)lo++;
      while(hi<n&&t[hi]<=t[i]+W)hi++;
      this.det.a[i]=sw[i]-(P[hi]-P[lo])/(hi-lo);
      this.abs.a[i]=this.det.a[i];
    }
    for(let i=0;i<n;i++){
      const dt=i?t[i]-t[i-1]:0,al=dt>0?dt/(0.04+dt):1,pr=i?this.sm.a[i-1]:this.det.a[0];
      this.sm.a[i]=pr+al*(this.det.a[i]-pr);
    }
    this.ext=[];this.dState=undefined;
    for(let i=0;i<n;i++)this.detectStep(i,false);
    this.buildStrokes();
  }
  detectStep(i,rebuild){
    const v=this.sm.a[i],H=this.cfg.hyst;
    if(this.dState===undefined){this.dState=1;this.ex=v;this.exI=i;this.segFrom=i;return}
    if(this.dState===1){
      if(v>=this.ex){this.ex=v;this.exI=i}
      else if(this.ex-v>H){this.addExt(this.exI,1,rebuild);this.dState=-1;this.ex=v;this.exI=i}
    }else{
      if(v<=this.ex){this.ex=v;this.exI=i}
      else if(v-this.ex>H){this.addExt(this.exI,-1,rebuild);this.dState=1;this.ex=v;this.exI=i}
    }
  }
  addExt(idx,type,rebuild){
    let s=0,c=0;for(let k=this.segFrom;k<=idx;k++){s+=this.vert.a[k];c++}
    this.ext.push({i:idx,type,segVert:c?s/c:0});
    this.segFrom=idx;
    if(rebuild)this.buildStrokes();
  }
  buildStrokes(){
    // type +1 = max (ends a rising segment). The drive is the segment type with the lower blade.
    let rs=0,rc=0,fs=0,fc=0;
    for(let k=1;k<this.ext.length;k++){const e=this.ext[k];if(e.type===1){rs+=e.segVert;rc++}else{fs+=e.segVert;fc++}}
    const driveRising=rc&&fc?rs/rc<fs/fc:true;
    const catchType=driveRising?-1:1, t=this.t.a, det=this.det.a;
    const S=[];
    for(let k=0;k+2<this.ext.length;k++){
      const c=this.ext[k];if(c.type!==catchType)continue;
      const f=this.ext[k+1],nx=this.ext[k+2];
      const period=t[nx.i]-t[c.i],drive=t[f.i]-t[c.i];
      const st={c:c.i,f:f.i,n:nx.i,arc:Math.abs(det[f.i]-det[c.i]),
                rate:60/period,ratio:drive/Math.max(period-drive,1e-3)};
      st.valid=st.rate>8&&st.rate<65&&st.arc>20;
      S.push(st);
    }
    this.strokes=S;
    this.applyCal();
    for(const st of S){st.catchA=this.abs.a[st.c];st.finA=this.abs.a[st.f]}
    const v=S.filter(s=>s.valid);
    if(v.length){const m=v.reduce((a,s)=>a+s.catchA,0)/v.length;this.catchSign=m>=0?1:-1}
  }
  // Tap calibration: at a cal time the oar was perpendicular, so raw yaw there = 0°.
  // Raw yaw drifts and follows the boat's heading, so it is only trusted for ~60 s after
  // the tap: in that window we measure where the average oar position (the drift-removal
  // trend) sits relative to perpendicular, and keep that offset until the next calibration.
  calOffset(k){
    const t=this.t.a,tc=this.cals[k],ci=this.idxAt(tc),tn=k+1<this.cals.length?this.cals[k+1]:Infinity;
    const we=Math.min(tc+60,tn),wi=this.idxAt(we),base=this.sweep.a[ci];
    let sum=0,cnt=0,strokes=0;
    for(const st of this.strokes){if(!st.valid||st.c<ci||st.n>wi)continue;strokes++;
      for(let i=st.c;i<st.n;i++){sum+=this.sweep.a[i]-base-this.det.a[i];cnt++}}
    if(strokes<2){sum=0;cnt=0;const e=this.idxAt(Math.min(tc+10,we));
      for(let i=ci;i<=e;i++){sum+=this.sweep.a[i]-base-this.det.a[i];cnt++}}
    return {ci,off:cnt?sum/cnt:0,settled:t[this.n-1]>=we||strokes>=20};
  }
  applyCal(){
    const n=this.n;if(!this.cals.length||!n){this.zeroed=false;return}
    if(this.live){ // only the newest calibration can still change; rewrite from its start
      const k=this.cals.length-1;
      if(this.calSettled===k)return;
      const {ci,off,settled}=this.calOffset(k);
      if(settled)this.calSettled=k;
      if(Math.abs(off-this.curOff)<0.05&&this.zeroed)return;
      this.curOff=off;this.zeroed=true;
      for(let i=k===0?0:ci;i<n;i++)this.abs.a[i]=this.det.a[i]+off;
      return;
    }
    const offs=this.cals.map((_,k)=>this.calOffset(k));
    for(let k=0;k<offs.length;k++){
      const from=k===0?0:offs[k].ci,to=k+1<offs.length?offs[k+1].ci:n;
      for(let i=from;i<to;i++)this.abs.a[i]=this.det.a[i]+offs[k].off;
    }
    this.zeroed=true;
  }
  addCal(time){this.cals.push(time);this.calSettled=undefined;if(this.strokes.length||!this.live)this.buildStrokes();else this.applyCal()}
  strokeAt(i){
    const S=this.strokes;let lo=0,hi=S.length-1,r=-1;
    while(lo<=hi){const m=(lo+hi)>>1;if(S[m].c<=i){r=m;lo=m+1}else hi=m-1}
    return r;
  }
  idxAt(time){
    const t=this.t.a;let lo=0,hi=this.n-1;
    if(hi<0)return 0;
    while(lo<hi){const m=(lo+hi+1)>>1;if(t[m]<=time)lo=m;else hi=m-1}
    return lo;
  }
}


// ---------------------------------------------------------------- boat analysis
// The same idea as the firmware: track gravity in the sensor frame (gyro-propagated,
// pulled toward the accelerometer over ~2 s), keep the horizontal part of what's left,
// and take its main axis as fore-aft. The sign makes the sharp catch check negative.
const G0=9.80665;
// Which way is the bow? Boat acceleration is positive for most of the stroke (the drive and the
// recovery) and strongly negative only around the catch and the release, so the direction in
// which it is positive most of the time is forward. Only when that is too close to call does the
// skew (the catch check being the biggest negative spike) decide. pf: mean sign (-1..1).
function boatSign(pf,m3,cur){if(Math.abs(pf)>0.08)return pf>0?1:-1;if(Math.abs(m3)>0.02)return m3<0?1:-1;return cur}
class BoatSession{
  constructor(cfg,live=false){
    this.cfg=cfg;this.live=live;this.t=new Buf(Float64Array);
    for(const k of ["hx","hy","hz","surge","slp","vel","roll","set","rms","ux","uy","uz","praw","pitch","disp","vhp","dhp"])this[k]=new Buf();
    this.pitchSum=0;this.pitchJ=0;this.hv=0;this.hd=0;
    this.g=null;this.axis=[1,0,0];this.sign=1;this.cov=[[0,0,0],[0,0,0],[0,0,0]];this.m3=0;this.plp=0;this.pf=0;this.nextAxis=0;
    this.strokes=[];this.catches=[];this.ms=0;this.D={state:0,min:0,minI:0,last:-1e9};
    this.rollSum=0;this.rollJ=0;this.axisInfo="";
    const f=cfg.boatAxis;
    if(Array.isArray(f)){this.forced=true;this.axis=norm(f);this.sign=1}
    else if(f&&f!=="auto"){this.forced=true;this.axis=axisVec(f).map(Math.abs);this.sign=f[0]==="-"?-1:1}
  }
  get n(){return this.t.n}
  append(ts,ax,ay,az,gx,gy,gz){
    const i=this.t.n,dt=i?Math.min(0.1,Math.max(1e-4,ts-this.t.a[i-1])):0.005;
    const a=[ax*G0,ay*G0,az*G0],w=[gx*D2R,gy*D2R,gz*D2R];
    if(!this.g)this.g=a.slice();
    const c=cross(w,this.g),kg=Math.min(1,dt/2);
    for(let k=0;k<3;k++){this.g[k]-=c[k]*dt;this.g[k]+=kg*(a[k]-this.g[k])}
    const u=norm(this.g);let lin=[a[0]-this.g[0],a[1]-this.g[1],a[2]-this.g[2]];
    const up=dot(lin,u);lin=[lin[0]-up*u[0],lin[1]-up*u[1],lin[2]-up*u[2]];
    this.t.push(ts);this.hx.push(lin[0]);this.hy.push(lin[1]);this.hz.push(lin[2]);
    // attitude (pitch, roll) from a slower, gyro-led gravity estimate: the 2 s one above is
    // pulled several degrees by the boat's own acceleration on every stroke
    if(!this.g2)this.g2=a.slice();
    {const c2=cross(w,this.g2),k2=Math.min(1,dt/15);for(let q=0;q<3;q++){this.g2[q]-=c2[q]*dt;this.g2[q]+=k2*(a[q]-this.g2[q])}}
    const u2=norm(this.g2);this.ux.push(u2[0]);this.uy.push(u2[1]);this.uz.push(u2[2]);
    if(!this.um)this.um=u2.slice();else{const ku=Math.min(1,dt/20);for(let q=0;q<3;q++)this.um[q]+=ku*(u2[q]-this.um[q])}
    const roll=this.rollOf(i,this.um);this.roll.push(roll);
    for(const k of ["surge","slp","vel","set","rms","praw","pitch","disp","vhp","dhp"])this[k].push(0);
    if(this.live){
      if(!this.forced){const kc=Math.min(1,dt/20);
        for(let r=0;r<3;r++)for(let q=0;q<3;q++)this.cov[r][q]+=kc*(lin[r]*lin[q]-this.cov[r][q]);
        const pr=dot(lin,this.axis);this.m3+=kc*(pr*pr*pr-this.m3);
        this.plp+=(pr-this.plp)*(dt/(0.02+dt));this.pf+=kc*((this.plp>0?1:-1)-this.pf);
        if(ts>=this.nextAxis){this.updateAxis();this.nextAxis=ts+1}}
      this.fill(i,dt,true);
      // set: roll minus the trailing 20 s mean
      this.rollSum+=roll;while(this.t.a[this.rollJ]<ts-20&&this.rollJ<i){this.rollSum-=this.roll.a[this.rollJ];this.rollJ++}
      this.set.a[i]=roll-this.rollSum/(i-this.rollJ+1);
      // pitch (bow up +) about the current fore-aft axis, minus the trailing 20 s mean
      const pr=this.pitchOf(i);this.praw.a[i]=pr;this.pitchSum+=pr;
      while(this.t.a[this.pitchJ]<ts-20&&this.pitchJ<i){this.pitchSum-=this.praw.a[this.pitchJ];this.pitchJ++}
      this.pitch.a[i]=pr-this.pitchSum/(i-this.pitchJ+1);
    }
  }
  updateAxis(){
    let v=[this.axis[0]+0.01,this.axis[1]+0.01,this.axis[2]+0.01];
    for(let it=0;it<25;it++){const w=[0,1,2].map(r=>dot(this.cov[r],v)),nn=Math.hypot(...w);if(nn<1e-12)return;v=w.map(x=>x/nn)}
    if(dot(v,this.axis)<0)v=v.map(x=>-x);
    this.axis=v;this.sign=boatSign(this.pf,this.m3,this.sign);
  }
  rollOf(i,um){ // roll about the fore-aft axis (port up +), relative to the average "up" um
    const f=this.axis.map(x=>x*this.sign),u=[this.ux.a[i],this.uy.a[i],this.uz.a[i]];
    const d=dot(um,f),u0=norm([um[0]-d*f[0],um[1]-d*f[1],um[2]-d*f[2]]),l=cross(u0,f);
    return -Math.atan2(dot(u,l),dot(u,u0))*R2D}
  pitchOf(i){const d=this.sign*(this.ux.a[i]*this.axis[0]+this.uy.a[i]*this.axis[1]+this.uz.a[i]*this.axis[2]);return Math.asin(Math.max(-1,Math.min(1,d)))*R2D}
  hpInt(i,dt){ // leaky double integral of surge: velocity and position wobble for the stroke in progress
    const k=Math.min(1,dt/2);this.hv+=this.slp.a[i]*dt-this.hv*k;this.hd+=this.hv*dt-this.hd*k;this.vhp.a[i]=this.hv;this.dhp.a[i]=this.hd}
  fill(i,dt,causal){ // surge, low-pass, rolling rms, stroke detection for sample i
    const s=this.sign*(this.hx.a[i]*this.axis[0]+this.hy.a[i]*this.axis[1]+this.hz.a[i]*this.axis[2]);
    this.surge.a[i]=s;
    if(causal){const pr=i?this.slp.a[i-1]:s;this.slp.a[i]=pr+(s-pr)*(dt/(0.02+dt))}
    const v=this.slp.a[i];this.ms+=(v*v-this.ms)*Math.min(1,dt/6);this.rms.a[i]=Math.sqrt(this.ms);
    this.hpInt(i,dt);
    this.detect(i);
  }
  finalize(){ // whole-file pass: global axis, zero-phase filtering, strokes
    const n=this.n,t=this.t.a,H=[this.hx.a,this.hy.a,this.hz.a];
    if(!this.forced){
      const C=[[0,0,0],[0,0,0],[0,0,0]];
      for(let i=0;i<n;i+=2)for(let r=0;r<3;r++)for(let q=0;q<3;q++)C[r][q]+=H[r][i]*H[q][i];
      this.cov=C;this.axis=[1,0.3,0.2];this.m3=0;
      let v=norm([1,0.3,0.2]);for(let it=0;it<40;it++){const w=[0,1,2].map(r=>dot(C[r],v)),nn=Math.hypot(...w);if(nn<1e-12)break;v=w.map(x=>x/nn)}
      this.axis=v;
      let p=0,m3=0,pos=0;for(let i=0;i<n;i++){const x=H[0][i]*v[0]+H[1][i]*v[1]+H[2][i]*v[2];const dt=i?t[i]-t[i-1]:0.005;p+=(x-p)*(dt/(0.02+dt));m3+=p*p*p;pos+=p>0?1:-1}
      this.sign=boatSign(pos/Math.max(1,n),m3/Math.max(1,n),1);
    }
    for(let i=0;i<n;i++)this.surge.a[i]=this.sign*(H[0][i]*this.axis[0]+H[1][i]*this.axis[1]+H[2][i]*this.axis[2]);
    // zero-phase ~8 Hz low-pass (forward + backward one-pole)
    const S=this.surge.a,L=this.slp.a;
    for(let i=0;i<n;i++){const dt=i?t[i]-t[i-1]:0.005,pr=i?L[i-1]:S[0];L[i]=pr+(S[i]-pr)*(dt/(0.028+dt))}
    for(let i=n-2;i>=0;i--){const dt=t[i+1]-t[i];L[i]=L[i+1]+(L[i]-L[i+1])*(dt/(0.028+dt))}
    // roll about the fore-aft axis (the live pass used the axis as it was then)
    const um=[0,0,0];for(let i=0;i<n;i++){um[0]+=this.ux.a[i];um[1]+=this.uy.a[i];um[2]+=this.uz.a[i]}
    for(let i=0;i<n;i++)this.roll.a[i]=this.rollOf(i,um);
    // set: roll minus a centred 20 s mean
    const P=new Float64Array(n+1);for(let i=0;i<n;i++)P[i+1]=P[i]+this.roll.a[i];
    let lo=0,hi=0;for(let i=0;i<n;i++){while(t[lo]<t[i]-10)lo++;while(hi<n&&t[hi]<=t[i]+10)hi++;this.set.a[i]=this.roll.a[i]-(P[hi]-P[lo])/(hi-lo)}
    // pitch, centred 20 s mean removed
    for(let i=0;i<n;i++){this.praw.a[i]=this.pitchOf(i);P[i+1]=P[i]+this.praw.a[i]}
    lo=0;hi=0;for(let i=0;i<n;i++){while(t[lo]<t[i]-10)lo++;while(hi<n&&t[hi]<=t[i]+10)hi++;this.pitch.a[i]=this.praw.a[i]-(P[hi]-P[lo])/(hi-lo)}
    this.hv=0;this.hd=0;for(let i=0;i<n;i++)this.hpInt(i,i?t[i]-t[i-1]:0.005);
    this.strokes=[];this.catches=[];this.ms=0;this.D={state:0,min:0,minI:0,last:-1e9};
    for(let i=0;i<n;i++){const v=L[i],dt=i?t[i]-t[i-1]:0.005;this.ms+=(v*v-this.ms)*Math.min(1,dt/6);this.rms.a[i]=Math.sqrt(this.ms);this.detect(i)}
    const names=["X","Y","Z"],k=[0,1,2].reduce((a,b)=>Math.abs(this.axis[b])>Math.abs(this.axis[a])?b:a,0);
    this.axisInfo=(this.cfg.fromTrigger?"Fore-aft direction from the logger's stroke timing: ":this.cfg.known?"Fore-aft axis (known for this example): ":this.forced?"Fore-aft axis set by hand: ":"Detected fore-aft axis: ")+(this.sign*Math.sign(this.axis[k])>0?"+":"-")+names[k]+
      (Math.abs(this.axis[k])<0.9?` (tilted, ${(Math.acos(Math.min(1,Math.abs(this.axis[k])))*R2D).toFixed(0)}° off the axis)`:"");
  }
  // A catch is the deepest point of each dip below -1.2 x rms of the recent signal.
  detect(i){
    const v=this.slp.a[i],t=this.t.a,r=this.rms.a[i],thr=-1.2*r,D=this.D;
    if(r<0.35){D.state=0;D.ref=undefined;D.per=0;return}     // not being rowed
    if(D.state===0){if(v<thr&&t[i]-D.last>0.9){D.state=1;D.min=v;D.minI=i}}
    else{if(v<D.min){D.min=v;D.minI=i}
      if(v>thr*0.4){D.state=0;
        // reject dips much shallower than recent catches (finish / pre-catch dips) and
        // dips far too soon after the last catch
        const tooShallow=D.ref!==undefined&&D.min>0.5*D.ref,tooSoon=D.per&&t[D.minI]-D.last<0.5*D.per;
        if(!tooShallow&&!tooSoon){
          if(D.last>0&&t[D.minI]-D.last<6)D.per=D.per?D.per+0.3*(t[D.minI]-D.last-D.per):t[D.minI]-D.last;
          D.ref=D.ref===undefined||D.min<D.ref?D.min:D.ref+0.1*(D.min-D.ref);/* ref follows the deepest catches */D.last=t[D.minI];this.addCatch(D.minI)}}}
  }
  addCatch(ci){
    const prev=this.catches.length?this.catches[this.catches.length-1]:-1;this.catches.push(ci);
    if(prev<0)return;const st=this.makeStroke(prev,ci);if(st)this.strokes.push(st);
  }
  makeStroke(c,n){
    const t=this.t.a,L=this.slp.a,S=this.surge.a,T=t[n]-t[c];
    if(!(T>0.9&&T<6))return {c,f:c,n,rate:60/Math.max(T,1e-3),valid:false};
    let pk=-1e9,pkI=c;for(let i=c;i<n&&t[i]<t[c]+0.55*T;i++)if(L[i]>pk){pk=L[i];pkI=i}
    // finish: the release dip is the lowest point 20-60 % into the stroke; the finish is where the
    // acceleration crossed zero on the way into it (a mid-drive hump can cross zero earlier)
    let f=-1;{let lo=Infinity,loI=-1;for(let i=c;i<n;i++){const e=t[i]-t[c];if(e<0.2*T)continue;if(e>0.6*T)break;if(L[i]<lo){lo=L[i];loI=i}}
      if(loI>0&&lo<0){let j=loI;while(j>pkI&&L[j]<=0)j--;if(j>pkI)f=j+1}}
    if(f<0){f=pkI;while(f<n-1&&L[f]>0)f++}
    let mean=0;for(let i=c;i<n;i++)mean+=S[i];mean/=(n-c);
    let v=0,vmin=0,vmax=0,vs=0;const V=this.vel.a;
    for(let i=c;i<n;i++){const dt=i>c?t[i]-t[i-1]:0;v+=(S[i]-mean)*dt;V[i]=v;vs+=v;if(v<vmin)vmin=v;if(v>vmax)vmax=v}
    const vm=vs/(n-c);for(let i=c;i<n;i++)V[i]-=vm;
    // position wobble around the mean-speed position over the stroke
    const Dp=this.disp.a;let d=0,ds=0;for(let i=c;i<n;i++){const dt=i>c?t[i]-t[i-1]:0;d+=V[i]*dt;Dp[i]=d;ds+=d}
    const dm=ds/(n-c);for(let i=c;i<n;i++)Dp[i]-=dm;
    let rs=0,rq=0;for(let i=c;i<n;i++){rs+=this.set.a[i];rq+=this.set.a[i]**2}
    const rmean=rs/(n-c),setSd=Math.sqrt(Math.max(0,rq/(n-c)-rmean*rmean));
    return {c,f,n,rate:60/T,check:L[c],peak:pk,tPeak:(t[pkI]-t[c])*1000,dv:vmax-vmin,
      ratio:(t[f]-t[c])/Math.max(1e-3,t[n]-t[f]),set:setSd,valid:60/T>=10&&60/T<=65&&pk>0};
  }
}
BoatSession.prototype.idxAt=Session.prototype.idxAt;
BoatSession.prototype.strokeAt=Session.prototype.strokeAt;

function guessMode(cols){ // oar data swings the gyro by hundreds of deg/s, a hull barely rotates
  if(cols.mode==="boat"||cols.mode==="oar")return cols.mode;
  let s=0,c=0;for(let i=0;i<cols.n;i+=10){s+=cols.gx[i]**2+cols.gy[i]**2+cols.gz[i]**2;c++}
  return Math.sqrt(s/Math.max(c,1))>40?"oar":"boat";
}

