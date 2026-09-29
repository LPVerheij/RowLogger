#include "ledbutton.h"
#include "sdlog.h"

void setLed(bool on) { digitalWrite(PIN_LED, (on ^ LED_ACTIVE_LOW) ? HIGH : LOW); }

static uint32_t ledOvStart = 0, ledOvLen = 0;
static uint8_t ledOvType = 0;           // EV_TAP / EV_CAL_OK / EV_CAL_FAIL

void ledOverride(uint8_t type) {
  ledOvType = type; ledOvStart = millis();
  ledOvLen = type == EV_TAP ? 70 : type == EV_CAL_OK ? 1500 : 700;
}

void serviceLed() {
  uint32_t m = millis();
  bool on;
  if (ledOvType && m - ledOvStart < ledOvLen) {
    uint32_t d = m - ledOvStart;
    if (ledOvType == EV_CAL_FAIL) on = (d / 120) % 2 == 0;   // 3 quick flashes
    else on = true;                                           // tap flash / solid = zeroed
    setLed(on);
    return;
  }
  ledOvType = 0;
  if (!imuOk)          on = (m / 100) % 2;         // fast blink: IMU error
  else if (!sdOk)      { uint32_t p = m % 1500;       // double blink: no SD, serial only
                         on = p < 80 || (p > 200 && p < 280); }
  else if (logging)    on = (m % 1000) < 80;        // short blink every second
  else                 on = (m % 3000) < 30;        // tiny blip every 3 s: idle
  setLed(on);
}

BtnEvent buttonEvent() {
  static bool lastStable = true, lastRead = true;
  static uint32_t changed = 0;
  bool r = digitalRead(PIN_BUTTON);
  uint32_t m = millis();
  if (r != lastRead) { lastRead = r; changed = m; }
  if (m - changed > 30 && r != lastStable) {
    lastStable = r;
    if (r) return BTN_SHORT;                                          // released
  }
  return BTN_NONE;
}
