"use strict";
// Sonification in the browser and on the device speaker.
// ---------------------------------------------------------------- sonification (WebAudio)
// Same mapping as the device speaker: tone at the centre pitch for zero acceleration,
// one octave up per "range" m/s^2 of drive, down on the check.
const snd={ctx:null,osc:null,gain:null,on:false};
function soundToggle(){
  try{
    if(!snd.ctx){const AC=window.AudioContext||window.webkitAudioContext;snd.ctx=new AC();
      snd.osc=snd.ctx.createOscillator();snd.osc.type="triangle";snd.gain=snd.ctx.createGain();snd.gain.gain.value=0;
      snd.osc.connect(snd.gain).connect(snd.ctx.destination);snd.osc.start()}
    snd.on=!snd.on;if(snd.on)snd.ctx.resume();
    $("sndBtn").textContent=snd.on?"Browser sound on":"Browser sound off";$("sndBtn").classList.toggle("primary",snd.on);
    $("sndQuick").setAttribute("aria-pressed",String(snd.on));
  }catch(e){setMsg("Sound is not available in this browser: "+e.message)}
}
function sndParams(){
  return {center:+$("sndCenter").value||300,range:Math.max(0.2,+$("sndRange").value||2.5),
          max:+$("sndMax").value||1.5,mute:+$("sndMute").value,vol:+$("sndVol").value||6};
}
function soundTick(){
  if(!snd.ctx)return;const now=snd.ctx.currentTime;let target=0;
  const active=snd.on&&S instanceof BoatSession&&S.n&&(playing||(mode==="live"&&follow));
  const P=sndParams();
  if(active&&S.rms.a[cursor]>P.mute){
    const oct=Math.max(-P.max,Math.min(P.max,S.slp.a[cursor]/P.range));
    snd.osc.frequency.setTargetAtTime(P.center*Math.pow(2,oct),now,0.012);target=0.18;
  }
  snd.gain.gain.setTargetAtTime(target,now,0.03);
}

// Device speaker settings: "P,hz,oct,vol,mute,maxoct,on" to set, "P?" to ask, "PT" test tone.
// The device answers "SND hz oct vol mute maxoct on" (BLE status) or "P,..." (serial).
const SND_DEF={sndCenter:300,sndRange:2.5,sndMax:1.5,sndMute:0.35,sndVol:6};
const devSnd={known:false,on:null,lastEdit:-1e9,timer:0};
function sndLabels(){
  const P=sndParams();
  $("oCenter").textContent=P.center+" Hz";$("oRange").textContent=P.range.toFixed(1)+" m/s²";
  $("oMax").textContent="±"+P.max+" oct";$("oMute").textContent=P.mute.toFixed(2)+" m/s²";$("oVol").textContent=P.vol;
}
function sndDevUi(){
  const c=!!conn;
  $("devSndBtn").disabled=!c||!devSnd.known;$("sndTestBtn").disabled=!c||!devSnd.known;
  $("devSndBtn").textContent=devSnd.on==null?"Device speaker –":devSnd.on?"Device speaker on":"Device speaker off";
  $("devSndBtn").classList.toggle("primary",!!devSnd.on);
  $("sndSync").textContent=!c?"No device connected. Settings apply to the browser sound.":
    devSnd.known?"Device speaker follows these settings; they're saved on the device.":
    "Waiting for the device's sound settings… (needs the updated firmware)";
}
function sndSend(extra){ // push the current slider values (and optionally on/off) to the device
  if(!conn||!devSnd.known)return;
  const P=sndParams();
  const s="P,"+P.center+","+P.range+","+P.vol+","+P.mute+","+P.max+","+(extra==null?"":extra);
  sendCmd(s,s+"\n");
}
function sndEdited(){
  sndLabels();devSnd.lastEdit=performance.now();
  clearTimeout(devSnd.timer);devSnd.timer=setTimeout(()=>sndSend(),150);
}
function sndFromDevice(f){ // f = [hz, oct, vol, mute, maxoct, on]
  if(f.length<6||f.some(x=>!isFinite(x)))return;
  const first=!devSnd.known;devSnd.known=true;devSnd.on=!!f[5];
  if(performance.now()-devSnd.lastEdit>1200){ // don't snap sliders back while they're being dragged
    $("sndCenter").value=f[0];$("sndRange").value=f[1];$("sndVol").value=f[2];$("sndMute").value=f[3];$("sndMax").value=f[4];sndLabels();
  }
  if(first)setMsg("");
  sndDevUi();
}
function sndConnected(){
  devModeUi(null);
  devSnd.known=false;devSnd.on=null;sndDevUi();const c=conn;
  for(const ms of [300,2500])setTimeout(()=>{if(conn===c&&!devSnd.known)sendCmd("P?","P?\n")},ms);
}

