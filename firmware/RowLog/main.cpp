/*
  RowLog — oar / boat motion logger
  ESP32-C3  +  BMI160 IMU (I2C)  +  microSD card (SPI)  +  optional OLED and speaker

  Modes (chosen from the RowLog Viewer over Bluetooth or USB; shown on the OLED):
    OAR     mounted on the oar shaft: blade work, tap-to-zero sweep reference.
    BOAT    mounted in the boat: boat run (surge acceleration, check, velocity
            fluctuation, stroke rate) and live sonification on a speaker.
  The mode is remembered across power cycles.

  - Samples accel + gyro at 200 Hz from the BMI160's own FIFO, so every
    sample is kept and evenly spaced (timestamps follow the sensor's clock,
    locked to the ESP32's), and writes CSV files to the SD card
    (/ROW0001.CSV, /ROW0002.CSV, ...). A new file is started every time
    logging starts.
  - Logging starts automatically at power-up (AUTO_START) and is toggled
    with the BOOT button (GPIO9) — short press.
  - Live stream over Bluetooth LE (50 Hz) and USB serial (200 Hz), for the
    RowLog Viewer web app.
  - Zero calibration: hold the oar perpendicular to the boat, tap the
    gunwale 3 times, then hold still. The LED lights solid for 1.5 s when the
    zero is set (3 quick flashes = failed, try again). A "#CAL,<t_ms>" line is
    written to the CSV and the viewer uses it as the 0° sweep reference.
  - 0.96" SSD1306 OLED (I2C, shares the IMU bus) shows logging state, a
    live stroke rate, and the zero-calibration steps (optional; the logger
    runs the same without it). Needs the "U8g2" library.
  - No SD card at power-up (or the card fails): the IMU data is streamed
    over USB serial automatically, and the LED double-blinks.
  - Sonification settings can be changed live from the viewer and are saved
    on the device (P command, see sonify.h).

  Commands (BLE control characteristic / USB serial):
    BLE    serial   action
    MO     o        oar mode
    MB     b        boat mode
    L      L        start/stop logging
    S      s        sound on/off
    P...   P...     sound settings (see sonify.h); over serial, end it with a newline
           1 / 0    USB serial stream on/off

  CSV columns:
    t_ms                 time since logging started, milliseconds
    ax_mg, ay_mg, az_mg  acceleration, milli-g           (sensor axes)
    gx_ddps..gz_ddps     angular rate, 0.1 degree/second (sensor axes)

  Code layout (settings are in rowlog_config.h):
    main.cpp        setup(), loop(), modes, status line, command handling
    imu.*           BMI160 set-up and the FIFO sampler task
    tapzero.*       tap-to-zero calibration detector (oar mode)
    sdlog.*         SD card and CSV logging
    blelink.*       Bluetooth LE service
    strokerate.*    on-device stroke rate and boat metrics
    boatmotion.*    boat-mode surge acceleration
    sonify.*        speaker sonification and its settings
    oled.*          OLED display
    ledbutton.*     status LED and BOOT button
*/

#include <Wire.h>
#include "esp_system.h"
#include "rowlog.h"
#include "imu.h"
#include "tapzero.h"
#include "sdlog.h"
#include "blelink.h"
#include "strokerate.h"
#include "boatmotion.h"
#include "sonify.h"
#include "oled.h"
#include "ledbutton.h"

// ------------------------------------------------------------ device-wide state
volatile DevMode devMode = MODE_OAR;
bool imuOk = false;
bool serialStream = false;
Preferences prefs;
const char* bootWarn = nullptr;

const char* modeName(DevMode m) { return m == MODE_BOAT ? "BOAT" : "OAR"; }

static const char* resetWhy(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_PANIC:    return "crash";
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "watchdog";
    default: return nullptr;               // power-on, reset button, deliberate restart
  }
}

// ------------------------------------------------------------ status line
// Sent over BLE and serial. Starts with the mode in brackets; the viewer reads it.
static void statusText(char* out, size_t n) {
  int k = snprintf(out, n, "[%s] ", modeName(devMode));
  if (bootWarn && millis() < 120000) {    // for 2 minutes after a fault restart
    out += k; n -= k;
    k = snprintf(out, n, "(last restart: %s) ", bootWarn);
  }
  out += k; n -= k;
  if (!imuOk)      snprintf(out, n, "ERROR: IMU not found");
  else if (!sdOk)  snprintf(out, n, "NO SD CARD - streaming over USB serial");
  else if (logging) snprintf(out, n, "LOGGING %s  %lus  drops %lu%s", fileName + 1,
                             (unsigned long)(logged / ODR_HZ), (unsigned long)(dropped + imuLost),
                             devMode == MODE_OAR ? (calibrated ? "  zeroed" : "  not zeroed") : "");
  else             snprintf(out, n, "IDLE  (press button to log)");
}

// ------------------------------------------------------------ mode switching
static bool statusNow = false;            // send the status line right away (after a mode change)
static void setMode(DevMode m) {
  if (m == devMode) return;
  statusNow = true;
  const bool wasLogging = logging;
  if (logging) stopLogging();              // a file holds one mode (header says which)
  devMode = m;
  prefs.putUChar("mode", m);
  rateReset();
  boatReset();
  beep(m == MODE_BOAT ? 440 : 660, 120);
  if (wasLogging) startLogging();
  Serial.printf("Mode: %s\n", modeName(m));
}

// ------------------------------------------------------------ setup
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  setLed(true);
  uint32_t w0 = millis();                    // give the USB host a moment to attach,
  while (!Serial && millis() - w0 < 1500) delay(10);  // so the boot messages are seen
  Serial.println("\nRowLog starting");
  bootWarn = resetWhy(esp_reset_reason());
  if (bootWarn) Serial.printf("last restart: %s%s\n", bootWarn,
                              strcmp(bootWarn, "brownout") == 0 ? "  (supply voltage dipped: weak USB/battery, add a capacitor)" : "");
  prefs.begin("rowlog", false);
  devMode = prefs.getUChar("mode", MODE_OAR) == MODE_BOAT ? MODE_BOAT : MODE_OAR;
  Serial.printf("Mode: %s  (change it from the app)\n", modeName(devMode));
  soundLoad();
  soundInit();
  Serial.setTimeout(50);                     // for reading the rest of a "P..." line

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
  imuOk = imuInit();
  Serial.println(imuOk ? "IMU ok" : "IMU NOT FOUND - check wiring");
  oledInit();

  sdInit();
  tapZeroInit();
  imuStart();                                // the sampler task starts sending samples now
  bleInit();
#if AUTO_START
  startLogging();
#endif
  Serial.printf("Free heap after start-up: %u bytes\n", (unsigned)ESP.getFreeHeap());
}

// ------------------------------------------------------------ loop
static void handleCalEvents() {            // from the tap-to-zero detector
  CalEvent ev;
  while (tapZeroEvent(ev)) {
#if TAP_DEBUG
    if (!serialStream) {
      if (ev.type == EV_TAP) Serial.printf("tap %u/3  peak %.1f g  rotation %u dps\n", ev.n, ev.mg / 1000.0f, ev.dps);
      else if (ev.type == EV_TAP_REJECT) Serial.printf("tap ignored: oar rotating (%u dps avg, limit %d)\n", ev.dps, TAP_MAX_ROT_DPS);
    }
#endif
    if (ev.type == EV_TAP_REJECT) continue;
    ledOverride(ev.type);
    calUiEvent(ev);
    if (ev.type == EV_TAP) continue;
    if (ev.type == EV_CAL_OK) {
      calibrated = true;
      logCalMarker(ev.t);
      if (serialStream) Serial.printf("C,%lu\n", (unsigned long)ev.t);
      else Serial.printf("Zero set (t=%lu ms)\n", (unsigned long)ev.t);
      char m[24]; snprintf(m, sizeof(m), "CAL %lu", (unsigned long)ev.t);
      bleSendStatus(m);
    } else if (!serialStream) Serial.println(ev.n ? "Zero failed: not still within 3 s after the taps"
                                                  : "Zero failed: a 4th tap");
  }
}

static void handleSamples() {              // analysis and live stream
  static int nSer = 0, nBle = 0;
  Sample s;
  while (xQueueReceive(liveQ, &s, 0) == pdTRUE) {
    if (devMode == MODE_BOAT) {
      boatStep(s);
      rateAddSample(surgeLP, 0, 0);
      static int nSnd = 0;
      if (++nSnd >= ODR_HZ / 100) { nSnd = 0; soundUpdate(surgeMS > sndMuteMs2 * sndMuteMs2); }   // 100 Hz pitch updates
    } else {
      rateAddSample(s.g[0] / 10.0f, s.g[1] / 10.0f, s.g[2] / 10.0f);
    }
    bool serNow = ++nSer >= ODR_HZ / SERIAL_HZ; if (serNow) nSer = 0;
    bool bleNow = ++nBle >= ODR_HZ / LIVE_HZ;   if (bleNow) nBle = 0;
    if (serialStream && serNow)
      Serial.printf("D,%lu,%d,%d,%d,%d,%d,%d\n", (unsigned long)s.t,
                    s.a[0], s.a[1], s.a[2], s.g[0], s.g[1], s.g[2]);
    if (bleNow) bleSendSample(s);
  }
}

static void sendStatus() {                 // once a second, or right after a mode change
  static uint32_t lastStatus = 0;
  if (millis() - lastStatus <= 1000 && !statusNow) return;
  lastStatus = millis();
  statusNow = false;
  rateCompute();
  if (devMode == MODE_BOAT) boatUpdateAxis();
  char st[112];
  statusText(st, sizeof(st));
  if (strokeRate > 0) { size_t l = strlen(st); snprintf(st + l, sizeof(st) - l, "  %.1f spm", strokeRate); }
  if (devMode == MODE_BOAT && strokeRate > 0) {
    size_t l = strlen(st);
    snprintf(st + l, sizeof(st) - l, "  dv %.2f", boatDv);
  }
  if (serialStream) Serial.printf("S,%s\n", st);
  bleSendStatus(st);
}

void loop() {
  serviceLogging();

  if (buttonEvent() == BTN_SHORT) toggleLogging();
  if (bleTakeToggle()) toggleLogging();
  char pc[48];
  if (bleTakeSoundCmd(pc, sizeof(pc))) soundCommand(pc);

  // Commands from the app and USB serial: '1'/'0' serial stream on/off, 'L' toggle logging,
  // 'o' oar mode, 'b' boat mode, 's' sound on/off, 'P...' sound settings (to the newline)
  char cmd = bleTakeCommand();
  while (Serial.available() || cmd) {
    char c = cmd ? cmd : Serial.read();
    cmd = 0;
    if (c == '1') serialStream = true;
    else if (c == '0') serialStream = false;
    else if (c == 'L' || c == 'l') toggleLogging();
    else if (c == 'o') setMode(MODE_OAR);
    else if (c == 'b') setMode(MODE_BOAT);
    else if (c == 's') soundToggle();
    else if (c == 'P') { String line = Serial.readStringUntil('\n'); line.trim(); soundCommand(line.c_str()); }
  }
  soundService();

  // No SD card (missing at boot or failed while logging): fall back to serial streaming
  static bool fellBack = false;
  if (!sdOk && imuOk && !fellBack) { fellBack = true; serialStream = true; }
  if (sdOk) fellBack = false;

  handleCalEvents();
  handleSamples();
  sendStatus();
  serviceLed();
  oledService();
  delay(2);
}
