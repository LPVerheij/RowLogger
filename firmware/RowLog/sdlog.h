// SD card and CSV logging. The sampler task pushes samples into a queue; loop() writes
// them to the card in 4 KB blocks and flushes every FLUSH_INTERVAL_MS.
#pragma once
#include "rowlog.h"

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
