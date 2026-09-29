#include "sonify.h"
#include "boatmotion.h"
#include "blelink.h"

bool  soundOn      = SOUND_DEFAULT_ON;
float sndMuteMs2   = SOUND_MUTE_MS2;
static float sndCenterHz  = SOUND_CENTER_HZ;
static float sndMs2PerOct = SOUND_MS2_PER_OCT;
static int   sndVolume    = SOUND_VOLUME;
static float sndMaxOct    = SOUND_MAX_OCT;
static bool  sndDirty = false;              // changed, not saved to flash yet
static uint32_t sndChangedAt = 0;
static bool soundAttached = false;
static float soundHz = 0;

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static int sndDuty() { return 1023 * (sndVolume < 1 ? 1 : sndVolume > 10 ? 10 : sndVolume) / 20; }  // up to 50 %

void soundLoad() {
  soundOn      = prefs.getBool("sOn", SOUND_DEFAULT_ON);
  sndCenterHz  = clampf(prefs.getFloat("sHz", SOUND_CENTER_HZ), 80, 1500);
  sndMs2PerOct = clampf(prefs.getFloat("sOct", SOUND_MS2_PER_OCT), 0.3f, 10);
  sndVolume    = constrain(prefs.getInt("sVol", SOUND_VOLUME), 1, 10);
  sndMuteMs2   = clampf(prefs.getFloat("sMute", SOUND_MUTE_MS2), 0, 3);
  sndMaxOct    = clampf(prefs.getFloat("sMax", SOUND_MAX_OCT), 0.25f, 3);
}

static void soundSave() {
  prefs.putBool("sOn", soundOn);
  prefs.putFloat("sHz", sndCenterHz);
  prefs.putFloat("sOct", sndMs2PerOct);
  prefs.putInt("sVol", sndVolume);
  prefs.putFloat("sMute", sndMuteMs2);
  prefs.putFloat("sMax", sndMaxOct);
  sndDirty = false;
}

void soundService() {                // flash writes are batched: 3 s after the last change
  if (sndDirty && millis() - sndChangedAt > 3000) soundSave();
}

static void soundChanged() { sndDirty = true; sndChangedAt = millis(); soundHz = -1; }  // -1: reapply pitch/duty

void soundInit() {
#if ENABLE_SOUND
  soundAttached = ledcAttach(PIN_SPEAKER, 300, 10);
  if (soundAttached) ledcWrite(PIN_SPEAKER, 0);
#endif
}

void soundUpdate(bool rowing) {
#if ENABLE_SOUND
  if (!soundAttached) return;
  if (!soundOn || !rowing || devMode != MODE_BOAT) {
    if (soundHz != 0) { ledcWrite(PIN_SPEAKER, 0); soundHz = 0; }
    return;
  }
  const float oct = clampf(surgeLP / sndMs2PerOct, -sndMaxOct, sndMaxOct);
  const float f = clampf(sndCenterHz * exp2f(oct), 20, 12000);
  if (fabsf(f - soundHz) > 1.0f) {
    ledcChangeFrequency(PIN_SPEAKER, (uint32_t)f, 10);
    ledcWrite(PIN_SPEAKER, sndDuty());
    soundHz = f;
  }
#endif
}

void beep(float hz, int ms) {
#if ENABLE_SOUND
  if (!soundAttached) return;
  ledcChangeFrequency(PIN_SPEAKER, (uint32_t)hz, 10);
  ledcWrite(PIN_SPEAKER, sndDuty());
  delay(ms);
  ledcWrite(PIN_SPEAKER, 0);
  soundHz = 0;
#endif
}

static void soundReport() {
  char m[64];
  snprintf(m, sizeof(m), "%.0f %.2f %d %.2f %.2f %d", sndCenterHz, sndMs2PerOct, sndVolume,
           sndMuteMs2, sndMaxOct, soundOn ? 1 : 0);
  Serial.printf("P,");
  for (char* p = m; *p; p++) Serial.write(*p == ' ' ? ',' : *p);
  Serial.println();
  char b[72]; snprintf(b, sizeof(b), "SND %s", m);
  bleSendStatus(b);
}

void soundToggle() { soundOn = !soundOn; soundChanged(); soundReport(); }

void soundCommand(const char* s) {   // s starts after the 'P'
  if (*s == 'T' || *s == 't') { beep(sndCenterHz, 400); soundReport(); return; }
  if (*s != ',') { soundReport(); return; }
  float v[6]; bool has[6] = {false};
  const char* p = s + 1;
  for (int i = 0; i < 6 && *p; i++) {
    char* end;
    const float x = strtof(p, &end);
    if (end != p) { v[i] = x; has[i] = true; }
    p = end;
    while (*p && *p != ',') p++;
    if (*p == ',') p++;
  }
  if (has[0]) sndCenterHz  = clampf(v[0], 80, 1500);
  if (has[1]) sndMs2PerOct = clampf(v[1], 0.3f, 10);
  if (has[2]) sndVolume    = constrain((int)lroundf(v[2]), 1, 10);
  if (has[3]) sndMuteMs2   = clampf(v[3], 0, 3);
  if (has[4]) sndMaxOct    = clampf(v[4], 0.25f, 3);
  if (has[5]) soundOn      = v[5] != 0;
  soundChanged();
  soundReport();
}
