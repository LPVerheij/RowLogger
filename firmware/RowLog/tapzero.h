// Tap-to-zero calibration (oar mode): hold the oar perpendicular to the boat, tap the
// gunwale 3 times, then hold still. The detector runs in the sampler task and reports
// events to loop() through a queue.
#pragma once
#include "rowlog.h"

void tapZeroInit();                     // create the event queue
void tapDetector(const Sample& s);      // sampler task, every sample in oar mode
bool tapZeroEvent(CalEvent& e);         // loop(): the next event, if there is one

extern volatile bool calibrated;        // an oar zero has been set in the current file
