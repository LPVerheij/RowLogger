#include <Wire.h>
#include "oled.h"
#include "sdlog.h"
#include "tapzero.h"
#include "strokerate.h"
#include "sonify.h"
#include "blelink.h"
#if ENABLE_OLED
#include <U8g2lib.h>
#endif

// ------------------------------------------------------------ transport (sampler task)
static bool oledOk = false;
static uint8_t oledAddr = OLED_ADDR;
static uint8_t oledFront[1024], oledSent[1024];
static volatile bool oledFrameReady = false;
static int oledPage = 0;

static void oledCmds(const uint8_t* c, size_t n) {
  Wire.beginTransmission(oledAddr);
  Wire.write(0x00);
  Wire.write(c, n);
  Wire.endTransmission();
}

void oledServicePage() {        // call from the task that owns the bus
  if (!oledOk || !oledFrameReady) return;
  while (oledPage < 8 && memcmp(oledFront + oledPage * 128, oledSent + oledPage * 128, 128) == 0) oledPage++;
  if (oledPage < 8) {
    const uint8_t* d = oledFront + oledPage * 128;
    const uint8_t pos[3] = {(uint8_t)(0xB0 | oledPage), 0x00, 0x10};   // page, column 0
    oledCmds(pos, 3);
    for (int off = 0; off < 128; off += 64) {
      Wire.beginTransmission(oledAddr);
      Wire.write(0x40);
      Wire.write(d + off, 64);
      Wire.endTransmission();
    }
    memcpy(oledSent + oledPage * 128, d, 128);
    oledPage++;
  }
  if (oledPage >= 8) { oledPage = 0; oledFrameReady = false; }
}

// ------------------------------------------------------------ oar-zero progress
enum CalUi : uint8_t { CU_NONE, CU_TAPS, CU_HOLD, CU_OK, CU_FAIL };
static CalUi calUi = CU_NONE;
static uint8_t calUiTaps = 0;
static uint32_t calUiSince = 0, lastCalMillis = 0;

void calUiEvent(const CalEvent& e) {
  calUiSince = millis();
  if (e.type == EV_TAP) { calUiTaps = e.n; calUi = e.n >= 3 ? CU_HOLD : CU_TAPS; }
  else if (e.type == EV_CAL_OK) { calUi = CU_OK; lastCalMillis = millis(); }
  else calUi = CU_FAIL;
}

// ------------------------------------------------------------ screen (loop)
#if ENABLE_OLED
static U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, PIN_I2C_SCL, PIN_I2C_SDA);

static bool i2cProbe(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }

void oledInit() {
  if (i2cProbe(0x3C)) oledAddr = 0x3C; else if (i2cProbe(0x3D)) oledAddr = 0x3D; else return;
  u8g2.setI2CAddress(oledAddr * 2);
  u8g2.setBusClock(400000);
  u8g2.begin();                              // init + clear, before the sampler task starts
  const uint8_t pageMode[2] = {0x20, 0x02};  // page addressing, used by oledServicePage()
  oledCmds(pageMode, 2);
  memset(oledSent, 0, sizeof(oledSent));
  oledOk = true;
  Serial.printf("OLED @0x%02X\n", oledAddr);
}

static void oledFlush() {
  // hand the frame to the sampler task (or send it ourselves if the sampler isn't running)
  memcpy(oledFront, u8g2.getBufferPtr(), 1024);
  oledFrameReady = true;
  if (!imuOk) while (oledFrameReady) oledServicePage();
}

static void oledDraw() {
  char buf[32];
  u8g2.clearBuffer();
  // top line: recording state
  u8g2.setFont(u8g2_font_6x10_tf);
  if (bootWarn && millis() < 30000) snprintf(buf, sizeof(buf), "RESTART: %s", bootWarn);
  else if (!imuOk)  strcpy(buf, "IMU ERROR");
  else if (!sdOk)   strcpy(buf, "NO SD - USB STREAM");
  else if (logging) { uint32_t sec = logged / ODR_HZ; snprintf(buf, sizeof(buf), "REC %s %lu:%02lu", fileName + 4,
                      (unsigned long)(sec / 60), (unsigned long)(sec % 60)); }
  else              strcpy(buf, "IDLE - BOOT TO LOG");
  u8g2.drawStr(0, 8, buf);
  u8g2.drawStr(98, 8, devMode == MODE_BOAT ? "B" : "O");       // mode letter
  if (bleIsConnected()) u8g2.drawStr(116, 8, "BT");
  u8g2.drawHLine(0, 11, 128);

  // middle: stroke rate
  if (strokeRate > 0) snprintf(buf, sizeof(buf), "%d", (int)lroundf(strokeRate));
  else strcpy(buf, "--");
  u8g2.setFont(u8g2_font_logisoso32_tn);
  int w = u8g2.getStrWidth(buf);
  u8g2.drawStr(88 - w, 48, buf);
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(94, 48, "spm");

  if (devMode == MODE_BOAT) {           // bottom line: last-stroke boat run numbers
    if (strokeRate > 0) snprintf(buf, sizeof(buf), "dv%.2f ck%+.1f pk%+.1f", boatDv, boatCheck, boatDrive);
    else snprintf(buf, sizeof(buf), "BOAT %s", soundOn ? "sound on" : "sound off");
    u8g2.drawStr(0, 62, buf);
    oledFlush();
    return;
  }

  // bottom line: zero calibration
  uint32_t age = millis() - calUiSince;
  if ((calUi == CU_TAPS && age > TAP_GAP_MAX_MS + 100) || ((calUi == CU_OK || calUi == CU_FAIL) && age > 2500))
    calUi = CU_NONE;
  bool inverse = true;
  switch (calUi) {
    case CU_TAPS: snprintf(buf, sizeof(buf), "TAP %u/3", calUiTaps); break;
    case CU_HOLD: strcpy(buf, "HOLD STILL..."); break;
    case CU_OK:   strcpy(buf, "ZERO SET"); break;
    case CU_FAIL: strcpy(buf, "ZERO FAILED - AGAIN"); break;
    default:
      inverse = !calibrated;
      if (calibrated) {
        uint32_t m = (millis() - lastCalMillis) / 60000;
        if (m < 1) strcpy(buf, "ZEROED just now");
        else if (m < 120) snprintf(buf, sizeof(buf), "ZEROED %lu min ago", (unsigned long)m);
        else snprintf(buf, sizeof(buf), "ZEROED %lu h ago", (unsigned long)(m / 60));
      } else strcpy(buf, "NOT ZEROED: TAP 3x");
  }
  if (inverse) { u8g2.drawBox(0, 53, 128, 11); u8g2.setDrawColor(0); }
  u8g2.drawStr(2, 62, buf);
  u8g2.setDrawColor(1);
  oledFlush();
}

void oledService() {
  static uint32_t lastDraw = 0;               // ~5 fps, only when the previous frame is out
  if (oledOk && !oledFrameReady && millis() - lastDraw > 200) { lastDraw = millis(); oledDraw(); }
}

#else   // ENABLE_OLED 0
void oledInit() {}
void oledService() {}
#endif
