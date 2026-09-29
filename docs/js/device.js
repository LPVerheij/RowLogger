"use strict";
// Live connection to the sensor over Bluetooth or USB.
// ---------------------------------------------------------------- live
let liveRaw=null,liveDetected=false,liveNextDetect=40;
function liveCols(){const r=liveRaw,o={n:r.t.n,t:r.t.a};for(const k of ["ax","ay","az","gx","gy","gz"])o[k]=r[k].a;return o}
function newLiveSession(){applyLayout();return effMode()==="boat"?new BoatSession(cfgBoat(),true):new Session(cfg(),true)}
function rebuildLive(){
  const cals=S&&S.cals?S.cals.slice():[],cols=liveCols();
  S=newLiveSession();
  for(let i=0;i<cols.n;i++){S.append(cols.t[i],cols.ax[i],cols.ay[i],cols.az[i],cols.gx[i],cols.gy[i],cols.gz[i]);}
  if(S.addCal)for(const c of cals)S.addCal(c);
  if(follow)cursor=S.n-1;else cursor=Math.min(cursor,S.n-1);dirty=true;
}
function liveStart(label){
  $("exNote").hidden=true;markExample("");
  mode="live";src=null;follow=true;playing=false;liveOff=0;liveLastT=-1;
  liveRaw={t:new Buf(Float64Array)};for(const k of ["ax","ay","az","gx","gy","gz"])liveRaw[k]=new Buf();
  liveDetected=false;liveNextDetect=40;
  S=newLiveSession();cursor=0;dirty=true;
  setChip(label,"live");$("srcInfo").textContent="Live · 50 Hz";$("devPanel").hidden=false;
}
let devMode=null;
function devModeUi(dm){
  devMode=dm;
  for(const [id,v] of [["modeOarBtn","OAR"],["modeBoatBtn","BOAT"]])$(id).setAttribute("aria-pressed",String(dm===v));
}
function setDevMode(target){
  if(!conn||devMode===target)return;
  sendCmd({OAR:"MO",BOAT:"MB"}[target],{OAR:"o",BOAT:"b"}[target]);
}
function liveStatus(txt){
  if(txt.startsWith("SND ")){sndFromDevice(txt.slice(4).trim().split(/\s+/).map(Number));return}
  $("devTxt").textContent=txt;
  const m=/^\[(OAR|BOAT)\]/.exec(txt);
  if(m)devModeUi(m[1]);
  if(m){const dm=m[1].toLowerCase();if(dm!==dataMode){dataMode=dm;if($("viewMode").value==="auto"&&liveRaw)rebuildLive()}}
}
function sendCmd(ble,ser){ // one GATT write at a time: queue them
  const c=conn;if(!c)return Promise.resolve();
  c.q=(c.q||Promise.resolve()).then(async()=>{
    if(conn!==c)return;
    try{if(c.type==="ble")await c.ctrl.writeValue(new TextEncoder().encode(ble));else await c.send(ser)}catch(e){setMsg(e.message)}
  });
  return c.q;
}
function liveCal(tms){if(!S||!S.addCal)return;S.addCal(tms/1000+liveOff);dirty=true;setMsg("");$("devTxt").textContent="Zero set by tap calibration"}
function liveSample(tms,a,g){ // a in mg, g in 0.1 dps
  let t=tms/1000+liveOff;
  if(liveLastT>=0&&t<liveLastT-0.5){liveOff+=liveLastT-t+0.02;t=tms/1000+liveOff}
  liveLastT=t;
  const v=[a[0]/1000,a[1]/1000,a[2]/1000,g[0]/10,g[1]/10,g[2]/10];
  liveRaw.t.push(t);["ax","ay","az","gx","gy","gz"].forEach((k,j)=>liveRaw[k].push(v[j]));
  S.append(t,...v);
  if(follow)cursor=S.n-1;dirty=true;
  if(effMode()==="oar"&&!liveDetected&&$("mountMode").value==="auto"&&t>=liveNextDetect){ // re-check mounting every 20 s until settled
    liveNextDetect=t+20;const before=$("axShaft").value+$("axUp").value;
    liveDetected=applyMounting(liveCols());
    if($("axShaft").value+$("axUp").value!==before)rebuildLive();
  }
}
const SVC="7a1e0001-5c3b-4b8e-9f2a-6f6172000001",DATA="7a1e0002-5c3b-4b8e-9f2a-6f6172000001",
      STAT="7a1e0003-5c3b-4b8e-9f2a-6f6172000001",CTRL="7a1e0004-5c3b-4b8e-9f2a-6f6172000001";
async function connectBLE(){
  if(!navigator.bluetooth){setMsg("This browser has no Web Bluetooth. Use Chrome or Edge, and open this page directly rather than embedded.");return}
  try{
    const dev=await navigator.bluetooth.requestDevice({filters:[{services:[SVC]}]});
    setMsg("Connecting to "+dev.name+" …");
    const gatt=await dev.gatt.connect(),svc=await gatt.getPrimaryService(SVC);
    const data=await svc.getCharacteristic(DATA),stat=await svc.getCharacteristic(STAT),ctrl=await svc.getCharacteristic(CTRL);
    disconnect();
    conn={type:"ble",dev,ctrl};
    dev.addEventListener("gattserverdisconnected",()=>{if(conn&&conn.dev===dev){conn=null;setChip("Bluetooth disconnected","err");$("devPanel").hidden=true;sndDevUi()}});
    liveStart("Live · "+(dev.name||"RowLog")+" (Bluetooth)");
    data.addEventListener("characteristicvaluechanged",e=>{
      const v=e.target.value;if(v.byteLength<16)return;
      liveSample(v.getUint32(0,true),[v.getInt16(4,true),v.getInt16(6,true),v.getInt16(8,true)],[v.getInt16(10,true),v.getInt16(12,true),v.getInt16(14,true)]);
    });
    stat.addEventListener("characteristicvaluechanged",e=>{const txt=new TextDecoder().decode(e.target.value);
      if(txt.startsWith("CAL "))liveCal(+txt.slice(4));else liveStatus(txt)});
    await data.startNotifications();await stat.startNotifications();
    try{liveStatus(new TextDecoder().decode(await stat.readValue()))}catch(_){}
    setMsg("");sndConnected();
  }catch(e){setMsg(e.name==="NotFoundError"?"No device chosen.":e.name==="SecurityError"?"Bluetooth is blocked in this embedded view. Download the page and open it directly in Chrome or Edge.":e.message)}
}
async function connectSerial(){
  if(!navigator.serial){setMsg("This browser has no Web Serial. Use Chrome or Edge on a computer, and open this page directly rather than embedded.");return}
  try{
    const port=await navigator.serial.requestPort();
    await port.open({baudRate:115200});
    disconnect();
    const enc=new TextEncoder(),writer=port.writable.getWriter();
    await writer.write(enc.encode("1\n"));
    const reader=port.readable.pipeThrough(new TextDecoderStream()).getReader();
    conn={type:"serial",port,writer,reader,send:s=>writer.write(enc.encode(s))};
    liveStart("Live · USB serial");
    (async()=>{
      let buf="";
      try{
        for(;;){const {value,done}=await reader.read();if(done)break;buf+=value;
          let k;while((k=buf.indexOf("\n"))>=0){const L=buf.slice(0,k).trim();buf=buf.slice(k+1);
            if(L.startsWith("D,")){const p=L.split(",").map(Number);if(p.length>=8)liveSample(p[1],[p[2],p[3],p[4]],[p[5],p[6],p[7]])}
            else if(L.startsWith("S,"))liveStatus(L.slice(2));
            else if(L.startsWith("C,"))liveCal(+L.slice(2));
            else if(L.startsWith("P,"))sndFromDevice(L.slice(2).split(",").map(Number));
          }}
      }catch(_){}
    })();
    setMsg("");sndConnected();
  }catch(e){setMsg(e.name==="NotFoundError"?"No port chosen.":e.name==="SecurityError"?"USB access is blocked in this embedded view. Download the page and open it directly in Chrome or Edge.":e.message)}
}
async function disconnect(){
  const c=conn;conn=null;$("devPanel").hidden=true;sndDevUi();if(!c)return;
  try{
    if(c.type==="ble")c.dev.gatt.disconnect();
    else{await c.send("0\n");await c.reader.cancel();c.writer.releaseLock();await c.port.close()}
  }catch(_){}
  if(mode==="live"){setChip("Live session ended","");follow=false;if(S&&S.n>50){S.live=false;if(S instanceof BoatSession)rebuildLiveAsFile();else S.finalize();dirty=true}}
}
function rebuildLiveAsFile(){ // after a live boat session: redo it with the whole-file analysis
  const cols=liveCols(),c={n:cols.n,t:Float64Array.from(cols.t.subarray(0,cols.n))};
  for(const k of ["ax","ay","az","gx","gy","gz"])c[k]=Float32Array.from(cols[k].subarray(0,cols.n));
  c.mode="boat";src=c;mode="file";buildFromColumns(c);cursor=S.n-1;
}
function toggleLog(){return sendCmd("L","L")}

