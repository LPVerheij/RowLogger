// Status LED and the BOOT button.
//   LED: fast blink = IMU error, double blink = no SD card (USB streaming), short blink every
//   second = logging, tiny blip every 3 s = idle; oar zero: flash per tap, solid 1.5 s = zero
//   set, 3 quick flashes = failed.
#pragma once
#include "rowlog.h"

enum BtnEvent : uint8_t { BTN_NONE, BTN_SHORT };

void setLed(bool on);
void ledOverride(uint8_t calEventType);   // show a tap-to-zero event for a moment
void serviceLed();                        // loop()
BtnEvent buttonEvent();                   // loop(): debounced short press, reported on release
