// On-device stroke rate (both modes) and last-stroke boat metrics (boat mode).
#pragma once
#include "rowlog.h"

void rateAddSample(float x, float y, float z);   // every sample: 3 gyro axes (oar) or surge (boat)
void rateReset();
void rateCompute();                               // once a second

extern float strokeRate;                          // spm, 0 = not rowing / unclear
extern float boatCheck, boatDrive, boatDv;        // m/s^2, m/s^2, m/s over the last stroke
