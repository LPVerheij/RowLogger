"use strict";
// 3D views of the oar and of the boat with its sculler.
// ---------------------------------------------------------------- 3D view
const cam={yaw:-125,pitch:28,dist:5.8,target:[0.75,0,0]};
const VIEWS={persp:{yaw:-125,pitch:28,dist:5.8},top:{yaw:-90,pitch:89,dist:6.6},stern:{yaw:-90,pitch:12,dist:6}};
function draw3D(){
  const cv=$("c3d"),{g,w,h}=fit(cv);g.clearRect(0,0,w,h);
  if(!S||!S.n)return;
  const cy=cam.yaw*D2R,cp=cam.pitch*D2R,T=cam.target;
  const eye=[T[0]+cam.dist*Math.cos(cp)*Math.cos(cy),T[1]+cam.dist*Math.cos(cp)*Math.sin(cy),T[2]+cam.dist*Math.sin(cp)];
  const f=norm([T[0]-eye[0],T[1]-eye[1],T[2]-eye[2]]);let r=cross(f,[0,0,1]);
  if(Math.hypot(...r)<1e-3)r=[Math.sin(cy),-Math.cos(cy),0];r=norm(r);const up=cross(r,f);
  const F=Math.min(w/1.6,h)*1.25,cx=w/2,cyy=h/2+h*0.05;
  const P=p=>{const d=[p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]],z=dot(d,f);if(z<0.05)return null;return [cx+F*dot(d,r)/z,cyy-F*dot(d,up)/z]};
  const line=(pts,color,wid,alpha=1)=>{g.strokeStyle=color;g.lineWidth=wid;g.globalAlpha=alpha;g.beginPath();let m=false;
    for(const p of pts){const q=P(p);if(!q){m=false;continue}m?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);m=true}g.stroke();g.globalAlpha=1};
  const wz=OAR.water;
  // water grid
  for(let x=-1.5;x<=3.51;x+=0.5)line([[x,-3.5,wz],[x,3.5,wz]],C.water,1);
  for(let y=-3.5;y<=3.51;y+=0.5)line([[-1.5,y,wz],[3.5,y,wz]],C.water,1);
  // hull (centre line at x=-0.85) and rigger
  const bow=S.catchSign, hx=-0.85, hull=[];
  for(let k=0;k<=40;k++){const y=-3.5+k*7/40,wd=0.24*Math.sqrt(Math.max(0,1-Math.pow(y/4.2,2)));hull.push([hx+wd,y,0.02])}
  for(let k=40;k>=0;k--){const y=-3.5+k*7/40,wd=0.24*Math.sqrt(Math.max(0,1-Math.pow(y/4.2,2)));hull.push([hx-wd,y,0.02])}
  g.fillStyle=C.hull;g.globalAlpha=0.35;g.beginPath();hull.forEach((p,k)=>{const q=P(p);if(q)k?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1])});g.fill();g.globalAlpha=1;
  line(hull,C.hull,1.2);
  line([[hx+0.2,-0.25,0.05],[0,0,0.12],[hx+0.2,0.25,0.05]],C.hull,2);
  // bow label
  const bl=P([hx,bow*3.7,0.05]);if(bl){g.fillStyle=C.muted;g.font="600 12px "+getComputedStyle(document.body).fontFamily;g.textAlign="center";g.fillText("BOW",bl[0],bl[1])}
  // blade trace (last 1.5 s)
  const t=S.t.a,i=cursor,t0=t[i]-1.5;let j=i;while(j>0&&t[j-1]>=t0)j--;
  const step=Math.max(1,Math.floor((i-j)/120));
  let prev=null;
  for(let k=j;k<=i;k+=step){const v=oarVectors(S.abs.a[k]*D2R,S.vert.a[k]*D2R,S.feather.a[k]*D2R),c=OAR.outboard-OAR.bladeLen/2;
    const p=[v.s[0]*c,v.s[1]*c,v.s[2]*c];if(prev)line([prev,p],C.blade,2,(k-j)/(i-j+1));prev=p}
  // oar
  // Feathering always turns the blade's top edge toward the bow (the top of the handle rolls toward
  // the rower's chest), so the driving face ends up facing up. Draw the measured amount that way,
  // whatever sign the sensor's mounting gives the feather angle.
  const fd=Math.abs(S.feather.a[i])*bow*D2R;
  const v=oarVectors(S.abs.a[i]*D2R,S.vert.a[i]*D2R,fd),s=v.s,u=v.u;
  const at=d=>[s[0]*d,s[1]*d,s[2]*d];
  line([at(-OAR.inboard),at(OAR.outboard-OAR.bladeLen)],C.ink,3.2);
  line([at(-OAR.inboard),at(-OAR.inboard+0.3)],C.accent,6);
  const b0=OAR.outboard-OAR.bladeLen,b1=OAR.outboard,hw=OAR.bladeW/2;
  const quad=BLADE_SHAPE.map(([a,e])=>{const d=b0+a*(b1-b0),w=e*2*hw;return [s[0]*d+u[0]*w,s[1]*d+u[1]*w,s[2]*d+u[2]*w]});
  const qq=quad.map(P);
  if(qq.every(Boolean)){g.fillStyle=C.blade;g.beginPath();qq.forEach((q,k)=>k?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]));g.closePath();g.fill();
    // driving face (faces the stern when squared, up when feathered) in the blade colour, the back darker
    const n=cross(s,u).map(x=>x*bow),bm=at(OAR.outboard-OAR.bladeLen/2),bc=[bm[0]-u[0]*hw,bm[1]-u[1]*hw,bm[2]-u[2]*hw];
    if(dot(n,[eye[0]-bc[0],eye[1]-bc[1],eye[2]-bc[2]])<0){g.fillStyle=C.ink;g.globalAlpha=0.45;g.fill();g.globalAlpha=1}
    g.strokeStyle=C.ink;g.lineWidth=1;g.stroke()}
  const pin=P([0,0,0]);if(pin){g.fillStyle=C.ink;g.beginPath();g.arc(pin[0],pin[1],4,0,7);g.fill()}
  $("hSweep").textContent=fmtA(S.abs.a[i]);$("hVert").textContent=fmtA(S.vert.a[i]);$("hFeather").textContent=Math.abs(S.feather.a[i]).toFixed(0)+"°";
}

// ---------------------------------------------------------------- 3D boat view
// World: +x toward the bow, +y to port, z up, origin at the rigger pins on the waterline.
// Two ways to show the boat's fore-aft movement:
//  - relative: the water stands still and so does a boat running at constant average speed (the
//    dashed outline); the hull moves fore and aft of it by the in-stroke position wobble (double
//    integral of the surge acceleration).
//  - absolute: the camera travels at the average speed, so the water moves past at that steady
//    speed, and the hull surges ahead and drops back in the frame by the same in-stroke wobble.
//    For the examples the average is the model's (smoothed) speed; for recorded sessions it is
//    assumed (no GPS) and only the in-stroke changes are measured.
// Pitch, roll and the in-stroke movement are scaled by the exaggeration setting; the speed of the
// water never is, so the boat always looks as fast as it is.
// The sculler and oars come from the rower model (examples) or a standard sequence timed to the
// detected catch and finish (recorded sessions).
let boatAbs=false;
function boatMotionUi(){
  $("bmRel").setAttribute("aria-pressed",String(!boatAbs));$("bmAbs").setAttribute("aria-pressed",String(boatAbs));
  const ex=!!(src&&src.speed);
  $("bAvgLbl").hidden=!boatAbs||ex;
  $("hbDispL").textContent=boatAbs?"Speed":"Ahead / behind";
  const E=+$("boatExag").value||1;
  $("bNote").textContent=(boatAbs
    ?(ex?"Absolute: the view travels with the boat's average speed, so the water streams past steadily; the hull surges ahead and drops back in the frame as its speed changes within the stroke."
        :"Absolute: the view travels at the average speed you set (assumed: there is no GPS), so the water streams past steadily; the hull surges ahead and drops back in the frame with the measured speed changes.")
    :"Relative: the dashed outline is a boat at constant average speed. The hull drops behind it on the check and pulls ahead on the drive.")
    +(E>1?` Movement, pitch and roll are drawn ${E}× larger than real${boatAbs?", so the hull can seem to slide back at the check":""}; the speed shown is real.`:"");
  dirty=true;
}
const fmtSplit=v=>{if(!(v>0.3))return "–";const s=500/v,m=Math.floor(s/60);return m+":"+String(Math.round(s-m*60)).padStart(2,"0")};
const camB={yaw:-118,pitch:20,dist:9.2,target:[-0.2,0,0.3]};
const BVIEWS={persp:{yaw:-118,pitch:20,dist:9.2},side:{yaw:-90,pitch:5,dist:8.8},stern:{yaw:180,pitch:14,dist:6},top:{yaw:-90,pitch:89,dist:9.5}};
const HULL={len:7.8,beam:0.2,sheer:0.14,keel:-0.1,bowX:3.7};

// Catch, finish and next catch (s) of the stroke around sample i, as the graphs mark them.
// tf2 is the finish after the next catch (the body's next drive can start before that catch).
function strokeTimesAt(i){
  if(!S.strokes.length)return null;
  const t=S.t.a,k=S.strokeAt(i);if(k<0)return null;
  const s=S.strokes[k];
  if(s.valid&&i<s.n){const nx=S.strokes[k+1];
    return {tc:t[s.c],tf:t[s.f],tn:t[s.n],tf2:nx&&nx.valid?t[nx.f]:t[s.n]+(t[s.f]-t[s.c])}}
  // live, after the last complete stroke: repeat its timing from the latest catch
  const last=S.catches.length?S.catches[S.catches.length-1]:-1;if(last<0||!s.valid)return null;
  const T=t[s.n]-t[s.c],dr=t[s.f]-t[s.c],c0=t[last];
  if(t[i]-c0>T*1.3)return null;
  return {tc:c0,tf:c0+dr,tn:c0+T,tf2:c0+T+dr};
}
// The blades follow the catch and finish in the graphs exactly: covered at the catch, clear of the
// water at the finish. The artificial catch delay (animation only) starts the rower's drive that
// much earlier, so the oar already turns while the blade is still above the water (a late catch);
// the catch itself stays where the graphs put it.
// The sculler's pose: examples replay the simulated technique, recorded sessions a standard
// legs-trunk-arms sequence, both timed to those catches and finishes.
const catchDelayS=()=>(+($("catchDelay")&&$("catchDelay").value)||0)/1000;
const BLADE_Z={buried:-0.03,clear:0.27,skim:0.1};  // height of the blade's top edge (= shaft line), m
function scullerState(i){
  const tech=(src&&src.tech&&src.n===S.n&&TECH[src.tech])||TECH.generic;
  const T=strokeTimesAt(i),t=S.t.a[i],D=catchDelayS(),Z=BLADE_Z;
  const clamp=x=>Math.max(0,Math.min(1,x));
  if(!T){const pose={legs:0.45,trunk:4,arms:0,lmin:tech.body.lmin};
    return {tech,ph:null,pose,J:bodyJoints(pose),depth:Z.skim,feather:1,inWater:false}}
  // body: the drive runs from D before the catch to the finish, the recovery from the finish to
  // D before the next catch
  let ph;
  if(t>=T.tn-D)ph={drive:clamp((t-(T.tn-D))/Math.max(0.2,T.tf2-(T.tn-D)))};
  else if(t>=T.tf)ph={rec:clamp((t-T.tf)/Math.max(0.2,T.tn-D-T.tf))};
  else ph={drive:clamp((t-(T.tc-D))/Math.max(0.2,T.tf-(T.tc-D)))};
  const pose=techPose(tech,ph);
  // blade: squared it hangs below the shaft, so it has to be lifted clear before it feathers
  const entry=tc0=>smooth5((t-(tc0-0.05))/0.05);           // 0 → 1 over the 50 ms up to a catch
  let depth,feather;
  if(t<T.tf){                                               // drive: in at the catch, out at the finish
    depth=Z.buried+(Z.clear-Z.buried)*((1-entry(T.tc))+smooth5((t-(T.tf-0.09))/0.09));feather=0;
  }else{                                                    // recovery
    const R=T.tn-T.tf,q=(t-T.tf)/R;
    const qSq=Math.min(0.92,(T.tn-D-T.tf)/R);               // squared by the time the body reaches the catch
    feather=smooth5((t-T.tf)/0.07)*(1-smooth5((q-(qSq-0.14))/0.14));
    depth=Z.clear+(Z.skim-Z.clear)*smooth5((t-T.tf)/0.25)*(1-smooth5((q-(qSq-0.3))/0.16));
    depth+=(Z.buried-depth)*entry(T.tn);
  }
  return {tech,ph,pose,J:bodyJoints(pose),depth,feather,inWater:t>=T.tc&&t<T.tf};
}
// Blade outline of a big ("hatchet") blade: the top edge runs on in line with the shaft, the blade
// hangs below it. [along the blade 0 = neck → 1 = tip, across 0 = top edge → -1 = bottom edge]
const BLADE_SHAPE=[[0,0],[1,0],[0.98,-0.5],[0.92,-0.92],[0.78,-1],[0.55,-0.93],[0.3,-0.68],[0.1,-0.36],[0,-0.18]];
function drawBoat3D(){
  const cv=$("c3dB"),{g,w,h}=fit(cv);g.clearRect(0,0,w,h);
  if(!S||!S.n)return;
  const i=cursor,E=+$("boatExag").value||1,t=S.t.a;
  // in-stroke position wobble: per completed stroke, otherwise the running estimate
  const k=S.strokeAt(i),inStroke=k>=0&&i<S.strokes[k].n;
  const ex=src&&src.speed&&src.n===S.n;           // an example: the model's true speed is known
  const wob=ex?src.pos[i]-src.basePos[i]:(inStroke?S.disp.a[i]:S.dhp.a[i]);
  let dx=0,waterX=0,speed=NaN;
  dx=wob*E;                                         // the hull moves around the average-speed position
  if(boatAbs){                                      // ... and the water streams past at the average speed
    const vAvg=Math.max(0,+$("bAvgSpd").value||4);
    waterX=ex?src.basePos[i]:vAvg*t[i];
    speed=ex?src.speed[i]:vAvg+(inStroke?S.vel.a[i]:S.vhp.a[i]);
  }
  const pitch=S.pitch.a[i]*E*D2R,roll=S.set.a[i]*E*D2R;
  const cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  const B=p=>{ // boat frame -> world
    const y1=p[1]*cr-p[2]*sr,z1=p[1]*sr+p[2]*cr;
    return [p[0]*cp-z1*sp+dx,y1,p[0]*sp+z1*cp]};
  // camera
  const cy=camB.yaw*D2R,cpp=camB.pitch*D2R,T=camB.target;
  const eye=[T[0]+camB.dist*Math.cos(cpp)*Math.cos(cy),T[1]+camB.dist*Math.cos(cpp)*Math.sin(cy),T[2]+camB.dist*Math.sin(cpp)];
  const f=norm([T[0]-eye[0],T[1]-eye[1],T[2]-eye[2]]);let r=cross(f,[0,0,1]);
  if(Math.hypot(...r)<1e-3)r=[Math.sin(cy),-Math.cos(cy),0];r=norm(r);const up=cross(r,f);
  const F=Math.min(w/1.8,h)*1.35,cx=w/2,cyy=h*0.42+Math.max(0,h-w/1.8)*0.5;
  const P=p=>{const d=[p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]],z=dot(d,f);if(z<0.05)return null;return [cx+F*dot(d,r)/z,cyy-F*dot(d,up)/z]};
  const line=(pts,color,wid,alpha=1,dash)=>{g.strokeStyle=color;g.lineWidth=wid;g.globalAlpha=alpha;if(dash)g.setLineDash(dash);g.beginPath();let m=false;
    for(const p of pts){const q=P(p);if(!q){m=false;continue}m?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);m=true}g.stroke();g.globalAlpha=1;if(dash)g.setLineDash([])};
  const poly=(pts,color,alpha)=>{const qs=pts.map(P);if(!qs.every(Boolean))return;g.fillStyle=color;g.globalAlpha=alpha;g.beginPath();qs.forEach((q,n)=>n?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]));g.closePath();g.fill();g.globalAlpha=1};
  // water: a 1 m grid, moving past the boat in the absolute view, plus lane buoys every 2.5 m
  const wf=waterX-Math.floor(waterX);
  for(let x=-7;x<=7.01;x+=1){const xx=x-wf;if(xx<-6.5||xx>6.5)continue;line([[xx,-3,0],[xx,3,0]],C.water,1)}
  for(let y=-3;y<=3.01;y+=1)line([[-6.5,y,0],[6.5,y,0]],C.water,1);
  {const bf=waterX/2.5-Math.floor(waterX/2.5);g.fillStyle=C.hull;
   for(let x=-7.5;x<=7.5;x+=2.5){const xx=x-bf*2.5;if(xx<-6.5||xx>6.5)continue;
     for(const y of [-3,3]){const q=P([xx,y,0.03]);if(q){g.beginPath();g.arc(q[0],q[1],2.6,0,7);g.fill()}}}}
  // hull shape (bow at +x, stern at -x)
  const half=x=>{const u=(x-(HULL.bowX-HULL.len/2))/(HULL.len/2);return HULL.beam*Math.pow(Math.max(0,1-u*u),0.65)};
  const xs=[];for(let q=0;q<=48;q++)xs.push(HULL.bowX-HULL.len+q*HULL.len/48);
  const deckP=xs.map(x=>[x,half(x),HULL.sheer]),deckS=xs.map(x=>[x,-half(x),HULL.sheer]);
  const keel=xs.map(x=>{const u=(x-(HULL.bowX-HULL.len/2))/(HULL.len/2);return [x,0,HULL.keel*Math.max(0,1-Math.pow(Math.abs(u),3))]});
  // ghost: a boat at constant average speed (relative view only)
  if(!boatAbs){line([...deckP,...deckS.slice().reverse(),deckP[0]],C.muted,1.2,0.9,[5,4]);
    const gl=P([HULL.bowX-0.2,-0.45,0.02]);if(gl){g.font="11px "+getComputedStyle(document.body).fontFamily;g.fillStyle=C.muted;g.textAlign="left";g.fillText("boat at average speed",gl[0]+4,gl[1]+12)}}
  // hull surfaces: sides then deck
  const W=xs.map(x=>[x,0,0]);
  for(const side of [deckP,deckS]){
    for(let q=0;q<xs.length-1;q++)poly([B(side[q]),B(side[q+1]),B(keel[q+1]),B(keel[q])],C.hull,0.5);
  }
  poly([...deckP.map(B),...deckS.slice().reverse().map(B)],C.panel,0.95);
  line([...deckP.map(B),...deckS.slice().reverse().map(B),B(deckP[0])],C.ink,1.2);
  line(keel.map(B),C.hull,1);
  // cockpit and bow ball
  const ck=[[-0.55,0.13,HULL.sheer],[1.35,0.13,HULL.sheer],[1.35,-0.13,HULL.sheer],[-0.55,-0.13,HULL.sheer]];
  poly(ck.map(B),C.grid,1);line([...ck.map(B),B(ck[0])],C.hull,1);
  const bb=P(B([HULL.bowX,0,HULL.sheer+0.03]));if(bb){g.fillStyle=C.ink;g.beginPath();g.arc(bb[0],bb[1],3,0,7);g.fill()}
  // riggers and pins
  const pinZ=0.3,pinY=0.8;
  for(const sg of [1,-1]){
    line([B([-0.35,sg*0.13,HULL.sheer]),B([0,sg*pinY,pinZ]),B([0.4,sg*0.13,HULL.sheer])],C.hull,2);
    line([B([0,sg*0.13,HULL.sheer]),B([0,sg*pinY,pinZ])],C.hull,1.2);
  }
  // sculler + oars: the handle position comes from the body, the oar angle from the handle
  const st=scullerState(i),J=st.J;
  const ps=sweepFromHand(J.hand[0]),IN=RIG.IN,OUT=RIG.OUT,BL=RIG.BLADE,BW=0.24;
  let handles=[];
  for(const sg of [1,-1]){
    const pin=[0,sg*pinY,pinZ];
    const drop=Math.asin(Math.max(-0.6,Math.min(0.6,(st.depth-pinZ)/OUT)));
    const dir=[Math.sin(ps)*Math.cos(drop),sg*Math.cos(ps)*Math.cos(drop),Math.sin(drop)];
    const at=d=>[pin[0]+dir[0]*d,pin[1]+dir[1]*d,pin[2]+dir[2]*d];
    handles.push(at(-IN));
    line([B(at(-IN)),B(at(OUT-BL))],C.ink,2.4);
    // blade: squared (vertical) on the drive, flat on the recovery
    // blade frame, the same on both sides: vz = up (blade squared), hz = horizontal toward the bow.
    // Feathering turns the top edge toward the bow, so the face ends up facing up on both sides.
    let hz=norm(cross(dir,[0,0,1]));if(hz[0]<0)hz=hz.map(x=>-x);
    let vz=cross(hz,dir);if(vz[2]<0)vz=vz.map(x=>-x);
    const fe=st.feather*Math.PI/2;
    const bu=[vz[0]*Math.cos(fe)+hz[0]*Math.sin(fe),vz[1]*Math.cos(fe)+hz[1]*Math.sin(fe),vz[2]*Math.cos(fe)+hz[2]*Math.sin(fe)];
    const bq=BLADE_SHAPE.map(([a,e])=>{const p=at(OUT-BL+a*BL);return B([p[0]+bu[0]*e*BW,p[1]+bu[1]*e*BW,p[2]+bu[2]*e*BW])});
    const c0=at(OUT-BL/2),c=[c0[0]-bu[0]*BW/2,c0[1]-bu[1]*BW/2,c0[2]-bu[2]*BW/2],wq=P([c[0]+dx,c[1],0]);
    // driving face: toward the stern when squared, up when feathered; is it the side we see?
    const nb=[-hz[0]*Math.cos(fe)+vz[0]*Math.sin(fe),-hz[1]*Math.cos(fe)+vz[1]*Math.sin(fe),-hz[2]*Math.cos(fe)+vz[2]*Math.sin(fe)];
    const cw=B(c),nw=B([c[0]+nb[0],c[1]+nb[1],c[2]+nb[2]]);
    const back=dot([nw[0]-cw[0],nw[1]-cw[1],nw[2]-cw[2]],[eye[0]-cw[0],eye[1]-cw[1],eye[2]-cw[2]])<0;
    if(st.inWater){ // underwater: see-through blade and a ripple ring where the shaft enters the water
      if(wq){g.fillStyle=C.accent;g.globalAlpha=0.16;g.beginPath();g.ellipse(wq[0],wq[1],22,7,0,0,7);g.fill();g.globalAlpha=1}
      poly(bq,C.blade,0.45);if(back)poly(bq,C.ink,0.25);line([...bq,bq[0]],C.accent,1.2,1,[3,2]);
      if(wq){g.strokeStyle=C.accent;g.lineWidth=1.6;g.beginPath();g.ellipse(wq[0],wq[1],22,7,0,0,7);g.stroke();
        g.globalAlpha=0.5;g.lineWidth=1;g.beginPath();g.ellipse(wq[0],wq[1],30,10,0,0,7);g.stroke();g.globalAlpha=1}
    }else{          // in the air: solid blade and its shadow on the water
      if(wq){g.fillStyle=C.ink;g.globalAlpha=0.12;g.beginPath();g.ellipse(wq[0],wq[1],12,4,0,0,7);g.fill();g.globalAlpha=1}
      poly(bq,C.blade,1);if(back)poly(bq,C.ink,0.45);line([...bq,bq[0]],C.ink,0.8);
    }
    const pq=P(B(pin));if(pq){g.fillStyle=C.ink;g.beginPath();g.arc(pq[0],pq[1],2.5,0,7);g.fill()}
  }
  // the sculler (faces the stern) from the same joint positions the model used
  const V=(p,y=0)=>[p[0],y,p[1]];
  line([[-0.05,0,HULL.sheer],[0.7,0,HULL.sheer]].map(B),C.muted,1.6);   // slide
  const hx=J.hip[0],sz=BODY.hipZ-0.04;
  poly([[hx-0.12,-0.11,sz],[hx+0.1,-0.11,sz],[hx+0.1,0.11,sz],[hx-0.12,0.11,sz]].map(B),C.hull,1);
  for(const sg of [1,-1])line([V(J.heel,sg*0.09),V(J.knee,sg*0.1),V(J.hip,sg*0.09)].map(B),C.ink,3);
  line([V(J.hip),V(J.sh)].map(B),C.ink,4.5);
  // arms: the elbow sits where upper arm and forearm (half the arm length each) meet, bent outward
  // (and a little down and back), so the arms are straight at the catch and the elbows flare out
  // to the sides as the hands come in at the finish
  const elbow3=(sh3,h3,sg)=>{const d=[h3[0]-sh3[0],h3[1]-sh3[1],h3[2]-sh3[2]],dl=Math.hypot(d[0],d[1],d[2])||1e-6;
    // bend follows the arm draw of the pose: 0 = straight (catch, drive start), 1 = drawn in (finish)
    const m=[(sh3[0]+h3[0])/2,(sh3[1]+h3[1])/2,(sh3[2]+h3[2])/2],r=0.2*smooth5(st.pose.arms),u=d.map(x=>x/dl);
    let q=[0.3,sg,-0.1];const kq=dot(q,u);q=norm([q[0]-kq*u[0],q[1]-kq*u[1],q[2]-kq*u[2]]);
    return [m[0]+r*q[0],m[1]+r*q[1],m[2]+r*q[2]]};
  for(let n=0;n<2;n++){const sg=n?-1:1,s3=V(J.sh,sg*0.18);line([B(s3),B(elbow3(s3,handles[n],sg)),B(handles[n])],C.ink,2.2)}
  const head=P(B(V(J.head)));if(head){g.fillStyle=C.ink;g.beginPath();g.arc(head[0],head[1],Math.max(4,F*0.1/camB.dist),0,7);g.fill()}
  // acceleration arrow above the boat
  const a=S.slp.a[i],ax0=B([0.5,0,1.35]),ax1=[ax0[0]+a*0.35,ax0[1],ax0[2]];
  const q0=P(ax0),q1=P(ax1);
  if(q0&&q1&&Math.abs(a)>0.05){const col=a>=0?C.accent:C.blade;g.strokeStyle=col;g.fillStyle=col;g.lineWidth=3;g.beginPath();g.moveTo(q0[0],q0[1]);g.lineTo(q1[0],q1[1]);g.stroke();
    const an=Math.atan2(q1[1]-q0[1],q1[0]-q0[0]);g.beginPath();g.moveTo(q1[0]+Math.cos(an)*6,q1[1]+Math.sin(an)*6);g.lineTo(q1[0]+Math.cos(an+2.5)*9,q1[1]+Math.sin(an+2.5)*9);g.lineTo(q1[0]+Math.cos(an-2.5)*9,q1[1]+Math.sin(an-2.5)*9);g.fill()}
  // labels
  g.font="600 11px "+getComputedStyle(document.body).fontFamily;g.fillStyle=C.muted;g.textAlign="center";
  const lb=P([HULL.bowX+0.5+dx,0,0.2]),ls=P([HULL.bowX-HULL.len-0.4+dx,0,0.2]);
  if(lb)g.fillText("BOW",lb[0],lb[1]);if(ls)g.fillText("STERN",ls[0],ls[1]);
  const ph2=st.ph?(st.inWater?"drive":"recovery"):"";
  $("hbAcc").innerHTML=(a>0?"+":"")+a.toFixed(1)+"<small style=\"font:500 11px var(--body);color:var(--muted)\"> m/s²"+(ph2?" · "+ph2:"")+"</small>";
  $("hbDisp").textContent=boatAbs?(isFinite(speed)?speed.toFixed(2)+" m/s":"–"):((wob*100>0?"+":"")+(wob*100).toFixed(1)+" cm");
  $("hbDisp").title=boatAbs&&isFinite(speed)?fmtSplit(speed)+" /500 m":"";
  const hb=$("hbBlade");hb.textContent=st.ph?(st.inWater?"in water":"out"):"–";
  hb.className="sm "+(st.ph?(st.inWater?"inwater":"outwater"):"");
  $("hbPitch").textContent=(S.pitch.a[i]>0?"+":"")+S.pitch.a[i].toFixed(1)+"°";
  $("hbRoll").textContent=(S.set.a[i]>0?"+":"")+S.set.a[i].toFixed(1)+"°";
}

