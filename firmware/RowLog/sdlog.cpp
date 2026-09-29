#include <SPI.h>
#include <SD.h>
#include "esp_timer.h"
#include "sdlog.h"
#include "imu.h"
#include "tapzero.h"

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
