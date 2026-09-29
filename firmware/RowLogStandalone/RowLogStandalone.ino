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

// This single-file sketch is GENERATED from the modules in firmware/RowLog/ by
// tools/make_standalone.py. Don't edit it: change the modules and run the script.
// Settings and pins are in the rowlog_config.h section right below.

// ========================================================================================
// rowlog_config.h
// ========================================================================================
// RowLog settings: features, sample rates, pins and tuning. This is the file to edit.

// ------------------------------------------------------------ features
#define ENABLE_BLE        1        // live stream over Bluetooth LE
#define ENABLE_OLED       1        // 0.96" SSD1306 128x64 I2C display (auto-detected)
#define ENABLE_SOUND      1        // BOAT mode: speaker sonification on PIN_SPEAKER
#define AUTO_START        1        // start logging at power-up

// ------------------------------------------------------------ sampling
#define ODR_HZ            200      // 100, 200 or 400
#define LIVE_HZ           50       // Bluetooth live stream rate
#define SERIAL_HZ         200      // USB serial stream rate (max = ODR_HZ)
#define ACC_RANGE_G       8        // 2, 4, 8, 16   (8 g is safe for catches/impacts)
#define GYR_RANGE_DPS     1000     // 125..2000     (oar handles reach ~300-600 dps)

// ------------------------------------------------------------ pins (ESP32-C3 SuperMini / DevKitM-1)
#define PIN_I2C_SDA       1
#define PIN_I2C_SCL       0
#define PIN_SD_SCK        4
#define PIN_SD_MISO       5
#define PIN_SD_MOSI       6
#define PIN_SD_CS         7
#define PIN_LED           8        // onboard LED on SuperMini (active LOW)
#define LED_ACTIVE_LOW    1
#define PIN_BUTTON        9        // BOOT button, to GND
#define PIN_SPEAKER       10       // PWM tone out -> small amp (PAM8302) or passive piezo
#define OLED_ADDR         0x3C     // most 0.96" modules; some are 0x3D (both are probed)

// ------------------------------------------------------------ tap-to-zero calibration (oar mode)
#define TAP_THRESH_MG     800      // |acc| deviation from 1 g that counts as a tap
#define TAP_MAX_ROT_DPS   60       // oar must not be swinging (average rotation, spikes clipped)
#define TAP_GAP_MIN_MS    150      // one tap rings for a while; ignore peaks closer than this
#define TAP_GAP_MAX_MS    1500     // max time between taps (a relaxed ~1 tap per second is fine)
#define TAP_DEBUG         1        // print each tap / rejected tap on USB serial (when not streaming)
#define CAL_STILL_ROT_DPS 15       // "still" after the taps: rotation below this
#define CAL_STILL_MG      150      //   and acceleration within this of 1 g
#define CAL_STILL_MS      400      //   for this long
#define CAL_TIMEOUT_MS    3000     // give up if not still within this time

// ------------------------------------------------------------ boat mode
#define BOAT_AXIS         0        // 0 = find the surge (fore-aft) axis automatically,
                                   // or force one: 1/-1 = +X/-X toward the bow, 2/-2 = Y, 3/-3 = Z
#define BOAT_MIN_RMS_MS2  0.35f    // stroke rate detection: below this surge level, not rowing

// Sound defaults; the viewer can change them and the device remembers them.
#define SOUND_CENTER_HZ   300.0f   // tone at zero acceleration
#define SOUND_MS2_PER_OCT 2.5f     // acceleration (m/s^2) for one octave up (drive) / down (check)
#define SOUND_VOLUME      6        // 1..10 (PWM duty; 10 is loudest)
#define SOUND_MAX_OCT     1.5f     // pitch never goes further than this many octaves from the centre
#define SOUND_DEFAULT_ON  1        // sound on (toggle: BLE "S", serial "s")
#define SOUND_MUTE_MS2    0.35f    // surge RMS below this: boat isn't being rowed, speaker muted

// ------------------------------------------------------------ SD logging
#define FLUSH_INTERVAL_MS 2000     // max data lost on sudden power cut
#define QUEUE_LEN         1024     // samples buffered in RAM for slow SD writes (~5 s @200 Hz)

// ========================================================================================
// rowlog.h
// ========================================================================================
// Types and device-wide state shared by all RowLog modules.
#include <Arduino.h>
#include <Preferences.h>

struct Sample {        // 16 bytes, already scaled: mg and 0.1 dps
  uint32_t t;          // ms since logging/boot start
  int16_t a[3];
  int16_t g[3];
};

enum DevMode : uint8_t { MODE_OAR = 0, MODE_BOAT = 1 };

// Tap-to-zero calibration events (tapzero -> loop)
enum : uint8_t { EV_TAP = 1, EV_CAL_OK, EV_CAL_FAIL, EV_TAP_REJECT };
struct CalEvent {
  uint8_t  type;
  uint8_t  n;        // EV_TAP: tap number 1..3; EV_CAL_FAIL: 1 = timeout, 0 = extra tap
  uint16_t mg, dps;  // tap peak and rotation, for debugging
  uint32_t t;
};

// Device-wide state (defined in main.cpp)
extern volatile DevMode devMode;
extern bool imuOk;
extern bool serialStream;           // stream samples and status over USB serial
extern Preferences prefs;           // settings kept in flash
extern const char* bootWarn;        // why the last restart happened, if it was a fault
const char* modeName(DevMode m);

// ========================================================================================
// imu.h
// ========================================================================================
// BMI160 IMU: set-up and the sampler task that empties its FIFO.

bool imuInit();                  // find and configure the BMI160; false if it isn't there
void imuStart();                 // create the live queue and, with an IMU, start the sampler task

extern QueueHandle_t liveQ;      // every sample, for the live stream and on-device analysis
extern volatile uint32_t imuLost;   // frames lost to FIFO overflow (should stay 0)
extern volatile float imuHz;        // measured sensor sample rate

// ========================================================================================
// tapzero.h
// ========================================================================================
// Tap-to-zero calibration (oar mode): hold the oar perpendicular to the boat, tap the
// gunwale 3 times, then hold still. The detector runs in the sampler task and reports
// events to loop() through a queue.

void tapZeroInit();                     // create the event queue
void tapDetector(const Sample& s);      // sampler task, every sample in oar mode
bool tapZeroEvent(CalEvent& e);         // loop(): the next event, if there is one

extern volatile bool calibrated;        // an oar zero has been set in the current file

// ========================================================================================
// sdlog.h
// ========================================================================================
// SD card and CSV logging. The sampler task pushes samples into a queue; loop() writes
// them to the card in 4 KB blocks and flushes every FLUSH_INTERVAL_MS.

void sdInit();                   // SPI bus, card, log queue
void logPush(const Sample& s);   // sampler task: queue a sample while logging
void startLogging();             // new file /ROWnnnn.CSV
void stopLogging();
void toggleLogging();            // button / app: stop, or (re)try the card and start
void serviceLogging();           // loop(): write queued samples, flush now and then
void logCalMarker(uint32_t t);   // write "#CAL,<t>" after the data recorded before it

extern volatile bool logging;
extern volatile uint32_t dropped, logged;   // samples dropped (queue full) / written
extern volatile int64_t t0us;               // time base of the file (esp_timer, us)
extern bool sdOk;
extern char fileName[16];

// ========================================================================================
// blelink.h
// ========================================================================================
// Bluetooth LE link to the RowLog Viewer: a data characteristic (16-byte samples, notify),
// a status characteristic (text, read + notify) and a control characteristic (write).
// Commands written by the app are collected here and handled in loop().
// With ENABLE_BLE 0 these functions do nothing.

void bleInit();
bool bleIsConnected();
void bleSendStatus(const char* text);        // status characteristic: set, and notify if connected
void bleSendSample(const Sample& s);         // data characteristic: notify, if connected

// Commands from the app, each returned once
char bleTakeCommand();                       // 'o' oar mode, 'b' boat mode, 's' sound on/off, or 0
bool bleTakeToggle();                        // start/stop logging
bool bleTakeSoundCmd(char* out, size_t n);   // sound settings: the text after the 'P'

// ========================================================================================
// strokerate.h
// ========================================================================================
// On-device stroke rate (both modes) and last-stroke boat metrics (boat mode).

void rateAddSample(float x, float y, float z);   // every sample: 3 gyro axes (oar) or surge (boat)
void rateReset();
void rateCompute();                               // once a second

extern float strokeRate;                          // spm, 0 = not rowing / unclear
extern float boatCheck, boatDrive, boatDv;        // m/s^2, m/s^2, m/s over the last stroke

// ========================================================================================
// boatmotion.h
// ========================================================================================
// Boat mode: fore-aft (surge) acceleration of the hull from the IMU, independent of how the
// sensor is mounted.

void boatReset();
void boatStep(const Sample& s);   // every sample
void boatUpdateAxis();            // once a second: re-estimate the fore-aft axis and its sign

extern float surgeLP;             // m/s^2, ~8 Hz low-passed, + = boat speeding up
extern float surgeMS;             // ~2 s mean square of surgeLP (is the boat being rowed?)

// ========================================================================================
// sonify.h
// ========================================================================================
// Boat-mode sonification on a speaker: pitch follows boat acceleration (centre pitch at
// zero, one octave up per sndMs2PerOct of drive, down on the check). All settings can be
// changed at runtime with the P command and are kept in flash.
//   P?                                              report the settings
//   P,<hz>,<ms2/oct>,<vol>,<mute ms2>,<max oct>,<on>  set them (an empty field keeps its value)
//   PT                                              play a test tone at the centre pitch
// The answer is "SND <hz> <ms2/oct> <vol> <mute> <maxoct> <on>" on the BLE status and
// "P,<same fields>" on serial.

void soundLoad();                    // settings from flash (call after prefs.begin)
void soundInit();                    // speaker PWM
void soundUpdate(bool rowing);       // ~100 Hz in boat mode: set the pitch, or mute
void beep(float hz, int ms);         // short feedback tone (blocks for ms)
void soundCommand(const char* s);    // a P command, s = the text after the 'P'
void soundToggle();                  // on/off
void soundService();                 // loop(): save changed settings to flash, 3 s after the last change

extern bool soundOn;
extern float sndMuteMs2;             // mute while the surge RMS is below this

// ========================================================================================
// oled.h
// ========================================================================================
// 0.96" SSD1306 OLED (I2C, shares the bus with the IMU): logging state, stroke rate,
// boat numbers or the oar-zero steps. All I2C traffic stays in the sampler task: after each
// FIFO read it sends at most one 128-byte page (~3 ms at 400 kHz), so sampling never stalls.
// loop() draws a frame and hands it over. With ENABLE_OLED 0 there is no display.

void oledInit();                       // probe 0x3C / 0x3D and set up (before the sampler starts)
void oledServicePage();                // sampler task: send the next changed page, if any
void oledService();                    // loop(): redraw ~5 times a second
void calUiEvent(const CalEvent& e);    // show oar-zero progress

// ========================================================================================
// ledbutton.h
// ========================================================================================
// Status LED and the BOOT button.
//   LED: fast blink = IMU error, double blink = no SD card (USB streaming), short blink every
//   second = logging, tiny blip every 3 s = idle; oar zero: flash per tap, solid 1.5 s = zero
//   set, 3 quick flashes = failed.

enum BtnEvent : uint8_t { BTN_NONE, BTN_SHORT };

void setLed(bool on);
void ledOverride(uint8_t calEventType);   // show a tap-to-zero event for a moment
void serviceLed();                        // loop()
BtnEvent buttonEvent();                   // loop(): debounced short press, reported on release

// ========================================================================================
// imu.cpp
// ========================================================================================
#include <Wire.h>

QueueHandle_t liveQ;
volatile uint32_t imuLost = 0;
volatile float imuHz = ODR_HZ;

// ------------------------------------------------------------ BMI160 registers
static uint8_t bmiAddr = 0x68;

static bool bmiWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(bmiAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool bmiRead(uint8_t reg, uint8_t* buf, size_t n) {
  Wire.beginTransmission(bmiAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(bmiAddr, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static uint8_t odrCode(int hz) {  // same code table for acc and gyr
  switch (hz) { case 100: return 0x08; case 400: return 0x0A; default: return 0x09; }
}
static uint8_t accRangeCode(int g) {
  switch (g) { case 2: return 0x03; case 4: return 0x05; case 16: return 0x0C; default: return 0x08; }
}
static uint8_t gyrRangeCode(int dps) {
  switch (dps) { case 2000: return 0x00; case 500: return 0x02; case 250: return 0x03; case 125: return 0x04; default: return 0x01; }
}

bool imuInit() {
  uint8_t id = 0;
  const uint8_t addrs[2] = {0x68, 0x69};
  bool found = false;
  for (uint8_t a : addrs) {
    bmiAddr = a;
    if (bmiRead(0x00, &id, 1) && id == 0xD1) { found = true; break; }
  }
  if (!found) return false;

  bmiWrite(0x7E, 0xB6); delay(100);          // soft reset
  bmiWrite(0x7E, 0x11); delay(10);           // accel -> normal mode
  bmiWrite(0x7E, 0x15); delay(100);          // gyro  -> normal mode
  bmiWrite(0x40, 0x20 | odrCode(ODR_HZ));    // ACC_CONF: normal filter, ODR
  bmiWrite(0x41, accRangeCode(ACC_RANGE_G)); // ACC_RANGE
  bmiWrite(0x42, 0x20 | odrCode(ODR_HZ));    // GYR_CONF: normal filter, ODR
  bmiWrite(0x43, gyrRangeCode(GYR_RANGE_DPS));
  // FIFO: headerless, gyro + accel. Each frame is 12 bytes: gyro X,Y,Z then accel X,Y,Z.
  bmiWrite(0x47, 0xC0);                      // FIFO_CONFIG_1: fifo_gyr_en | fifo_acc_en
  delay(20);
  bmiWrite(0x7E, 0xB0);                      // fifo_flush

  uint8_t pmu = 0, err = 0;
  bmiRead(0x03, &pmu, 1);
  bmiRead(0x02, &err, 1);
  Serial.printf("BMI160 @0x%02X  PMU=0x%02X  ERR=0x%02X\n", bmiAddr, pmu, err);
  return ((pmu >> 4) & 3) == 1 && ((pmu >> 2) & 3) == 1;  // both in normal mode
}

// raw -> integer units
static const float ACC_LSB_PER_G   = 32768.0f / ACC_RANGE_G;
static const float GYR_LSB_PER_DPS = 32768.0f / GYR_RANGE_DPS;

// ------------------------------------------------------------ sampler task
// The BMI160 samples on its own clock into a 1 KB FIFO (85 frames = 425 ms at 200 Hz). The task
// empties it every 10 ms, so nothing is lost when the SD card, BLE or the OLED hold things up.
// Timestamps count frames at the sensor's rate, and that rate is measured against the ESP32
// clock (a small phase-locked loop), so samples are exactly evenly spaced and don't drift.
// All I2C traffic happens in this task, including the OLED pages (oledServicePage).
#define FIFO_FRAME        12
#define FIFO_POLL_MS      10

static void emitSample(const uint8_t* b, int64_t tus) {
  Sample s;
  const int64_t rel = tus - t0us;          // frames sampled before logging started: not logged
  s.t = rel > 0 ? (uint32_t)(rel / 1000) : 0;
  for (int i = 0; i < 3; i++) {
    int16_t g = (int16_t)(b[2 * i] | (b[2 * i + 1] << 8));
    int16_t a = (int16_t)(b[6 + 2 * i] | (b[6 + 2 * i + 1] << 8));
    s.g[i] = (int16_t)lroundf(g * 10.0f / GYR_LSB_PER_DPS);
    s.a[i] = (int16_t)lroundf(a * 1000.0f / ACC_LSB_PER_G);
  }
  if (rel >= 0) logPush(s);
  xQueueSend(liveQ, &s, 0);               // live stream, decimated in loop()
  if (devMode == MODE_OAR) tapDetector(s);
}

static void samplerTask(void*) {
  const TickType_t period = pdMS_TO_TICKS(FIFO_POLL_MS);
  TickType_t last = xTaskGetTickCount();
  static uint8_t buf[FIFO_FRAME * 10];     // Wire moves at most 128 bytes per transfer
  double tpUs = 1e6 / ODR_HZ;              // sample period on the ESP32 clock, tracked
  double tNext = 0;                        // timestamp (us) the next frame gets
  bool locked = false;
  for (;;) {
    vTaskDelayUntil(&last, period);
    uint8_t lb[2];
    if (!bmiRead(0x22, lb, 2)) { oledServicePage(); continue; }
    int bytes = lb[0] | ((lb[1] & 0x07) << 8);
    const int64_t now = esp_timer_get_time();
    if (bytes >= 1024 - FIFO_FRAME) {      // full: older frames were overwritten
      imuLost = imuLost + 85;              // (approximate: one FIFO's worth)
      bmiWrite(0x7E, 0xB0);                // flush and start the clock again
      locked = false;
      oledServicePage();
      continue;
    }
    int frames = bytes / FIFO_FRAME;
    if (!frames) { oledServicePage(); continue; }
    // The newest frame was sampled at most one period ago; on average half a period.
    const double tLastNow = (double)now - 0.5 * tpUs;
    if (!locked) { tNext = tLastNow - (frames - 1) * tpUs; locked = true; }
    else {
      const double err = tLastNow - (tNext + (frames - 1) * tpUs);   // + = our clock runs slow
      tNext += 0.01 * err;                               // phase: poll jitter averages out
      tpUs  += 0.0001 * err / frames;                    // rate: locks to the sensor clock in ~5 s
      const double nom = 1e6 / ODR_HZ;                   // the BMI160 is within a few %
      if (tpUs < nom * 0.95) tpUs = nom * 0.95; else if (tpUs > nom * 1.05) tpUs = nom * 1.05;
      if (fabs(err) > 20000) { tNext = tLastNow - (frames - 1) * tpUs; }   // lost track: resync
    }
    imuHz = (float)(1e6 / tpUs);
    while (frames > 0) {
      const int n = frames > 10 ? 10 : frames;
      if (!bmiRead(0x24, buf, n * FIFO_FRAME)) break;
      for (int k = 0; k < n; k++) {
        emitSample(buf + k * FIFO_FRAME, (int64_t)tNext);
        tNext += tpUs;
      }
      frames -= n;
    }
    oledServicePage();
  }
}

void imuStart() {
  liveQ = xQueueCreate(128, sizeof(Sample));   // created even without an IMU: loop() reads it
  if (imuOk) xTaskCreate(samplerTask, "sampler", 4096, nullptr, 10, nullptr);
}

// ========================================================================================
// tapzero.cpp
// ========================================================================================
volatile bool calibrated = false;
static QueueHandle_t evQ;

void tapZeroInit() { evQ = xQueueCreate(16, sizeof(CalEvent)); }

bool tapZeroEvent(CalEvent& e) { return xQueueReceive(evQ, &e, 0) == pdTRUE; }

static void sendEv(uint8_t type, uint32_t t, uint8_t n = 0, float mg = 0, float dps = 0) {
  CalEvent e{type, n, (uint16_t)fminf(mg, 65535.0f), (uint16_t)dps, t};
  xQueueSend(evQ, &e, 0);
}

void tapDetector(const Sample& s) {    // runs in the sampler task, every sample
  static float rotAvg = 0;
  static uint32_t lastTap = 0, lastPeak = 0, waitStart = 0, stillStart = 0;
  static int taps = 0;
  static bool waiting = false, stillRun = false;

  const float amag = sqrtf((float)s.a[0] * s.a[0] + (float)s.a[1] * s.a[1] + (float)s.a[2] * s.a[2]);
  const float dev  = fabsf(amag - 1000.0f);                                   // mg
  const float rot  = sqrtf((float)s.g[0] * s.g[0] + (float)s.g[1] * s.g[1] + (float)s.g[2] * s.g[2]) / 10.0f;
  // Slow rotation average with the short spikes of the taps themselves clipped off, so a
  // hard tap doesn't block the next one; a real stroke keeps it well above the limit.
  rotAvg += (fminf(rot, 2.0f * TAP_MAX_ROT_DPS) - rotAvg) / (0.5f * ODR_HZ);
  const uint32_t t = s.t;

  if (dev > TAP_THRESH_MG) {
    const bool newPeak = (uint32_t)(t - lastPeak) > TAP_GAP_MIN_MS;   // not the same tap ringing
    lastPeak = t;
    if (!newPeak) return;
    if (rotAvg >= TAP_MAX_ROT_DPS) { sendEv(EV_TAP_REJECT, t, 0, dev, rotAvg); return; }
    if (waiting) {                       // a 4th tap: not a clean sequence
      waiting = false; taps = 0; lastTap = t; sendEv(EV_CAL_FAIL, t); return;
    }
    const uint32_t gap = t - lastTap;
    taps = (taps > 0 && gap <= TAP_GAP_MAX_MS) ? taps + 1 : 1;
    lastTap = t;
    sendEv(EV_TAP, t, taps, dev, rotAvg);
    if (taps == 3) { taps = 0; waiting = true; waitStart = t; stillRun = false; }
    return;
  }
  if (!waiting || (uint32_t)(t - lastTap) < 200) return;   // let the last tap ring out
  if (rot < CAL_STILL_ROT_DPS && dev < CAL_STILL_MG) {
    if (!stillRun) { stillRun = true; stillStart = t; }
    else if ((uint32_t)(t - stillStart) >= CAL_STILL_MS) {
      waiting = false;
      sendEv(EV_CAL_OK, stillStart + CAL_STILL_MS / 2);   // middle of the still window
      return;
    }
  } else stillRun = false;
  if ((uint32_t)(t - waitStart) > CAL_TIMEOUT_MS) { waiting = false; sendEv(EV_CAL_FAIL, t, 1); }
}

// ========================================================================================
// sdlog.cpp
// ========================================================================================
#include <SPI.h>
#include <SD.h>

volatile bool logging = false;
volatile uint32_t dropped = 0, logged = 0;
volatile int64_t t0us = 0;
bool sdOk = false;
char fileName[16] = "";

static QueueHandle_t logQ;
static File logFile;
static char wbuf[4096];
static size_t wlen = 0;
static uint32_t lastFlush = 0;

void sdInit() {
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  sdOk = SD.begin(PIN_SD_CS, SPI, 20000000) || SD.begin(PIN_SD_CS, SPI, 4000000);
  if (sdOk) Serial.printf("SD ok, %llu MB\n", SD.cardSize() / (1024ULL * 1024ULL));
  else      Serial.println("SD NOT FOUND - streaming IMU data over USB serial instead");
  logQ = xQueueCreate(QUEUE_LEN, sizeof(Sample));
  t0us = esp_timer_get_time();
}

void logPush(const Sample& s) {
  if (logging) {
    if (xQueueSend(logQ, &s, 0) != pdTRUE) dropped = dropped + 1;
  }
}

static bool nextFileName() {
  for (int i = 1; i < 10000; i++) {
    snprintf(fileName, sizeof(fileName), "/ROW%04d.CSV", i);
    if (!SD.exists(fileName)) return true;
  }
  return false;
}

void startLogging() {
  if (!sdOk || !imuOk || logging) return;
  if (!nextFileName()) { Serial.println("No free file name"); return; }
  logFile = SD.open(fileName, FILE_WRITE);
  if (!logFile) { Serial.println("Open failed"); sdOk = false; return; }
  logFile.printf("# RowLog v1\n# mode=%s\n# odr_hz=%d\n# acc_range_g=%d\n# gyr_range_dps=%d\n"
                 "# units: t=ms, a=milli-g, g=0.1 deg/s, sensor axes\n",
                 devMode == MODE_BOAT ? "boat" : "oar", ODR_HZ, ACC_RANGE_G, GYR_RANGE_DPS);
  logFile.print("t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps\n");
  logFile.flush();
  xQueueReset(logQ);
  dropped = 0; logged = 0; wlen = 0;
  calibrated = false;                 // zero again after starting a new file
  t0us = esp_timer_get_time();
  lastFlush = millis();
  logging = true;
  Serial.printf("Logging to %s\n", fileName);
}

static void drainQueue() {
  Sample s;
  while (xQueueReceive(logQ, &s, 0) == pdTRUE) {
    wlen += snprintf(wbuf + wlen, sizeof(wbuf) - wlen, "%lu,%d,%d,%d,%d,%d,%d\n",
                     (unsigned long)s.t, s.a[0], s.a[1], s.a[2], s.g[0], s.g[1], s.g[2]);
    logged = logged + 1;
    if (wlen > sizeof(wbuf) - 64) {
      if (logFile.write((uint8_t*)wbuf, wlen) != wlen) { sdOk = false; logging = false; }
      wlen = 0;
    }
  }
}

void stopLogging() {
  if (!logging) return;
  logging = false;
  vTaskDelay(pdMS_TO_TICKS(20));
  drainQueue();
  if (wlen) { logFile.write((uint8_t*)wbuf, wlen); wlen = 0; }
  logFile.close();
  Serial.printf("Stopped %s: %lu samples, %lu dropped, %lu lost in the IMU FIFO, IMU rate %.2f Hz\n", fileName,
                (unsigned long)logged, (unsigned long)dropped, (unsigned long)imuLost, imuHz);
}

void toggleLogging() {
  if (logging) stopLogging();
  else {
    if (!sdOk) sdOk = SD.begin(PIN_SD_CS, SPI, 20000000);  // card re-inserted?
    startLogging();
  }
}

void serviceLogging() {
  if (!logging) return;
  drainQueue();
  if (millis() - lastFlush > FLUSH_INTERVAL_MS) {
    if (wlen) { logFile.write((uint8_t*)wbuf, wlen); wlen = 0; }
    logFile.flush();
    lastFlush = millis();
  }
}

void logCalMarker(uint32_t t) {
  if (!logging) return;
  drainQueue();                         // the marker goes after the data recorded before it
  wlen += snprintf(wbuf + wlen, sizeof(wbuf) - wlen, "#CAL,%lu\n", (unsigned long)t);
}

// ========================================================================================
// blelink.cpp
// ========================================================================================
#if ENABLE_BLE
#include <BLEDevice.h>
#include <BLEServer.h>
#if !defined(CONFIG_NIMBLE_ENABLED) && !defined(CONFIG_BT_NIMBLE_ENABLED)
#include <BLE2902.h>
#define ADD_2902(c) (c)->addDescriptor(new BLE2902())
#else
#define ADD_2902(c)            // NimBLE adds the CCCD itself
#endif
#define SVC_UUID    "7a1e0001-5c3b-4b8e-9f2a-6f6172000001"
#define DATA_UUID   "7a1e0002-5c3b-4b8e-9f2a-6f6172000001"  // notify, 16-byte Sample
#define STATUS_UUID "7a1e0003-5c3b-4b8e-9f2a-6f6172000001"  // read/notify, text
#define CTRL_UUID   "7a1e0004-5c3b-4b8e-9f2a-6f6172000001"  // write: commands, see CtrlCB

static BLECharacteristic *dataChr, *statusChr;
static volatile bool bleConnected = false;
static volatile bool bleActive = false;   // true once Bluetooth is up
static volatile bool toggleRequest = false;
static volatile char bleCmd = 0;          // mode / sound commands, handled in loop()
static char blePCmd[48];                  // sound settings command ("P..."), handled in loop()
static volatile bool blePPending = false;

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; if (bleActive) BLEDevice::startAdvertising(); }
};
class CtrlCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue();
    if (!v.length()) return;
    if (v[0] == 'P') {                      // sound settings
      if (!blePPending) { strlcpy(blePCmd, v.c_str() + 1, sizeof(blePCmd)); blePPending = true; }
    }
    else if (v[0] == 'L' || v[0] == 'l') toggleRequest = true;
    else if (v == "MO") bleCmd = 'o';       // oar mode
    else if (v == "MB") bleCmd = 'b';       // boat mode
    else if (v[0] == 'S') bleCmd = 's';     // sound on/off
  }
};

void bleInit() {
  BLEDevice::init("RowLog");
  BLEDevice::setMTU(185);
  BLEServer* srv = BLEDevice::createServer();
  srv->setCallbacks(new ServerCB());
  BLEService* svc = srv->createService(SVC_UUID);
  dataChr = svc->createCharacteristic(DATA_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  ADD_2902(dataChr);
  statusChr = svc->createCharacteristic(STATUS_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  ADD_2902(statusChr);
  BLECharacteristic* ctrl = svc->createCharacteristic(CTRL_UUID, BLECharacteristic::PROPERTY_WRITE);
  ctrl->setCallbacks(new CtrlCB());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  bleActive = true;
}

bool bleIsConnected() { return bleConnected; }

void bleSendStatus(const char* text) {
  if (bleActive) { statusChr->setValue(text); if (bleConnected) statusChr->notify(); }
}

void bleSendSample(const Sample& s) {
  if (bleActive && bleConnected) { dataChr->setValue((uint8_t*)&s, sizeof(s)); dataChr->notify(); }
}

char bleTakeCommand() { const char c = bleCmd; bleCmd = 0; return c; }

bool bleTakeToggle() { if (!toggleRequest) return false; toggleRequest = false; return true; }

bool bleTakeSoundCmd(char* out, size_t n) {
  if (!blePPending) return false;
  strlcpy(out, blePCmd, n);
  blePPending = false;
  return true;
}

#else   // ENABLE_BLE 0
void bleInit() {}
bool bleIsConnected() { return false; }
void bleSendStatus(const char*) {}
void bleSendSample(const Sample&) {}
char bleTakeCommand() { return 0; }
bool bleTakeToggle() { return false; }
bool bleTakeSoundCmd(char*, size_t) { return false; }
#endif

// ========================================================================================
// strokerate.cpp
// ========================================================================================
// The stroke is a back-and-forth rotation, so the gyro signal along its main axis of
// rotation (sweep or feather, whichever is larger) swings + and - once per stroke.
// Its autocorrelation over the last ~10 s peaks at the stroke period. This needs no
// knowledge of how the sensor is mounted.
#define RATE_FS  25                       // Hz, decimated from ODR
#define RATE_N   256                      // ~10 s window

float strokeRate = 0;
float boatCheck = 0, boatDrive = 0, boatDv = 0;

static float rg[RATE_N][3];
static int rHead = 0, rCount = 0;

// Oar mode feeds the 3 gyro axes (deg/s); boat mode feeds surge acceleration (m/s^2).
void rateAddSample(float x, float y, float z) {
  static int dec = 0;
  if (++dec < ODR_HZ / RATE_FS) return;
  dec = 0;
  rg[rHead][0] = x; rg[rHead][1] = y; rg[rHead][2] = z;
  rHead = (rHead + 1) % RATE_N;
  if (rCount < RATE_N) rCount++;
}

void rateReset() { rCount = 0; rHead = 0; strokeRate = 0; boatCheck = boatDrive = boatDv = 0; }

void rateCompute() {
  static float x[RATE_N];
  if (rCount < RATE_N) { strokeRate = 0; return; }
  float m[3] = {0, 0, 0}, C[3][3] = {{0}};
  for (int i = 0; i < RATE_N; i++) for (int k = 0; k < 3; k++) m[k] += rg[i][k];
  for (int k = 0; k < 3; k++) m[k] /= RATE_N;
  for (int i = 0; i < RATE_N; i++)
    for (int a = 0; a < 3; a++) for (int b = 0; b < 3; b++)
      C[a][b] += (rg[i][a] - m[a]) * (rg[i][b] - m[b]);
  float v[3] = {0.577f, 0.577f, 0.577f};  // principal axis by power iteration
  for (int it = 0; it < 25; it++) {
    float w[3];
    for (int a = 0; a < 3; a++) w[a] = C[a][0] * v[0] + C[a][1] * v[1] + C[a][2] * v[2];
    float n = sqrtf(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
    if (n < 1e-6f) { strokeRate = 0; return; }
    for (int a = 0; a < 3; a++) v[a] = w[a] / n;
  }
  float var = 0;
  for (int i = 0; i < RATE_N; i++) {
    const float* g = rg[(rHead + i) % RATE_N];
    x[i] = (g[0] - m[0]) * v[0] + (g[1] - m[1]) * v[1] + (g[2] - m[2]) * v[2];
    var += x[i] * x[i];
  }
  const float minRms = devMode == MODE_BOAT ? BOAT_MIN_RMS_MS2 : 15.0f;   // m/s^2 or deg/s
  if (sqrtf(var / RATE_N) < minRms) { strokeRate = 0; return; }   // not rowing
  const int lagMin = RATE_FS * 60 / 60, lagMax = RATE_FS * 60 / 12; // 60 .. 12 spm
  float r[lagMax + 2], rmax = -1;
  for (int L = lagMin - 1; L <= lagMax + 1; L++) {
    float sxy = 0, sxx = 0, syy = 0;
    for (int i = 0; i + L < RATE_N; i++) { sxy += x[i] * x[i + L]; sxx += x[i] * x[i]; syy += x[i + L] * x[i + L]; }
    r[L] = sxy / sqrtf(sxx * syy + 1e-9f);
    if (L >= lagMin && L <= lagMax && r[L] > rmax) rmax = r[L];
  }
  if (rmax < 0.4f) { strokeRate = 0; return; }
  int best = -1;   // first peak close to the maximum; 2x and 3x the period correlate just as well
  for (int L = lagMin; L <= lagMax && best < 0; L++)
    if (r[L] >= r[L - 1] && r[L] >= r[L + 1] && r[L] >= 0.85f * rmax) best = L;
  if (best < 0) { strokeRate = 0; return; }
  float den = r[best - 1] - 2 * r[best] + r[best + 1];               // parabolic peak refinement
  float lag = best + (fabsf(den) > 1e-6f ? 0.5f * (r[best - 1] - r[best + 1]) / den : 0);
  float spm = 60.0f * RATE_FS / lag;
  strokeRate = strokeRate > 0 ? strokeRate + 0.5f * (spm - strokeRate) : spm;  // light smoothing

  if (devMode == MODE_BOAT) {   // metrics over the last stroke period (x = surge, mean removed)
    const int P = (int)lroundf(lag), i0 = RATE_N - P;
    float mn = 1e9f, mx = -1e9f, mean = 0, v = 0, vmin = 0, vmax = 0;
    for (int i = i0; i < RATE_N; i++) mean += x[i];
    mean /= P;
    for (int i = i0; i < RATE_N; i++) {
      const float a = x[i] + m[0];               // put the window mean back for check/drive
      if (a < mn) mn = a;
      if (a > mx) mx = a;
      v += (x[i] - mean) / RATE_FS;              // velocity fluctuation within the stroke
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    boatCheck = mn; boatDrive = mx; boatDv = vmax - vmin;
  }
}

// ========================================================================================
// boatmotion.cpp
// ========================================================================================
// Gravity is tracked in the sensor frame (gyro-propagated, slowly pulled toward the
// accelerometer) and subtracted, so pitching and rolling of the hull don't leak into
// the signal. The surge (fore-aft) axis is the main horizontal axis of what's left;
// its sign is chosen so the boat accelerates forward for most of the stroke (see boatUpdateAxis).
float surgeLP = 0, surgeMS = 0;

static float bG[3] = {0, 0, 9.81f};        // gravity estimate, m/s^2, sensor frame
static bool  bInit = false;
static float bCov[3][3];                    // slow covariance of horizontal linear accel
static float bM3 = 0;                       // slow third moment along the axis (skew sign)
static float bPLP = 0, bPos = 0;            // low-passed projection and its mean sign (-1..1)
static float bAxis[3] = {1, 0, 0};
static float bSign = 1;
static float surge = 0;                     // m/s^2, raw
static float boatRoll = 0, boatPitch = 0;   // deg, from the gravity estimate (not used yet)

void boatReset() { bInit = false; memset(bCov, 0, sizeof(bCov)); bM3 = 0; bPLP = 0; bPos = 0; surge = surgeLP = surgeMS = 0; }

void boatStep(const Sample& s) {
  const float dt = 1.0f / ODR_HZ, G = 9.80665f / 1000.0f, D2R = 0.01745329f / 10.0f;
  const float a[3] = {s.a[0] * G, s.a[1] * G, s.a[2] * G};
  const float w[3] = {s.g[0] * D2R, s.g[1] * D2R, s.g[2] * D2R};
  if (!bInit) { for (int k = 0; k < 3; k++) bG[k] = a[k]; bInit = true; }
  // rotate gravity with the sensor: dg/dt = -w x g
  const float c0 = w[1] * bG[2] - w[2] * bG[1], c1 = w[2] * bG[0] - w[0] * bG[2], c2 = w[0] * bG[1] - w[1] * bG[0];
  bG[0] -= c0 * dt; bG[1] -= c1 * dt; bG[2] -= c2 * dt;
  const float kg = dt / 2.0f;                                   // 2 s pull toward the accelerometer
  for (int k = 0; k < 3; k++) bG[k] += kg * (a[k] - bG[k]);
  const float gn = sqrtf(bG[0] * bG[0] + bG[1] * bG[1] + bG[2] * bG[2]) + 1e-6f;
  const float u[3] = {bG[0] / gn, bG[1] / gn, bG[2] / gn};
  float lin[3] = {a[0] - bG[0], a[1] - bG[1], a[2] - bG[2]};
  const float up = lin[0] * u[0] + lin[1] * u[1] + lin[2] * u[2];
  for (int k = 0; k < 3; k++) lin[k] -= up * u[k];             // horizontal part only

#if BOAT_AXIS == 0
  const float kc = dt / 20.0f;                                  // 20 s statistics
  for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) bCov[i][j] += kc * (lin[i] * lin[j] - bCov[i][j]);
  const float p = lin[0] * bAxis[0] + lin[1] * bAxis[1] + lin[2] * bAxis[2];
  bM3 += kc * (p * p * p - bM3);
  bPLP += (p - bPLP) * (dt / (0.02f + dt));
  bPos += kc * ((bPLP > 0 ? 1.0f : -1.0f) - bPos);
  surge = bSign * p;
#else
  const int ax = abs(BOAT_AXIS) - 1;
  surge = (BOAT_AXIS > 0 ? 1 : -1) * lin[ax];
#endif
  surgeLP += (surge - surgeLP) * (dt / (0.02f + dt));
  surgeMS += (surgeLP * surgeLP - surgeMS) * (dt / 2.0f);
  // boat attitude relative to the sensor's mounting (only changes matter)
  boatRoll  = atan2f(u[1], u[2]) * 57.2958f;
  boatPitch = atan2f(-u[0], sqrtf(u[1] * u[1] + u[2] * u[2])) * 57.2958f;
}

void boatUpdateAxis() {   // once a second: principal axis of the covariance
#if BOAT_AXIS == 0
  float v[3] = {bAxis[0] + 0.01f, bAxis[1] + 0.01f, bAxis[2] + 0.01f};
  for (int it = 0; it < 20; it++) {
    float w[3];
    for (int a = 0; a < 3; a++) w[a] = bCov[a][0] * v[0] + bCov[a][1] * v[1] + bCov[a][2] * v[2];
    float n = sqrtf(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
    if (n < 1e-9f) return;
    for (int a = 0; a < 3; a++) v[a] = w[a] / n;
  }
  if (v[0] * bAxis[0] + v[1] * bAxis[1] + v[2] * bAxis[2] < 0) for (int a = 0; a < 3; a++) v[a] = -v[a];
  for (int a = 0; a < 3; a++) bAxis[a] = v[a];     // keep a continuous direction
  // Forward is the direction the boat accelerates in most of the time (drive and recovery);
  // the catch and release are short negative spikes. The skew only decides when that's unclear.
  if (fabsf(bPos) > 0.08f) bSign = bPos > 0 ? 1.0f : -1.0f;
  else if (fabsf(bM3) > 0.05f) bSign = bM3 < 0 ? 1.0f : -1.0f;
#endif
}

// ========================================================================================
// sonify.cpp
// ========================================================================================
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

// ========================================================================================
// oled.cpp
// ========================================================================================
#include <Wire.h>
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

// ========================================================================================
// ledbutton.cpp
// ========================================================================================
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

// ========================================================================================
// main.cpp
// ========================================================================================
#include <Wire.h>

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
