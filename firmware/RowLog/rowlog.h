// Types and device-wide state shared by all RowLog modules.
#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "rowlog_config.h"

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
