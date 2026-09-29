#include <Wire.h>
#include "esp_timer.h"
#include "imu.h"
#include "sdlog.h"
#include "tapzero.h"
#include "oled.h"

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
