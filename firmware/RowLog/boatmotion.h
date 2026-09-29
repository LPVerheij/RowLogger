// Boat mode: fore-aft (surge) acceleration of the hull from the IMU, independent of how the
// sensor is mounted.
#pragma once
#include "rowlog.h"

void boatReset();
void boatStep(const Sample& s);   // every sample
void boatUpdateAxis();            // once a second: re-estimate the fore-aft axis and its sign

extern float surgeLP;             // m/s^2, ~8 Hz low-passed, + = boat speeding up
extern float surgeMS;             // ~2 s mean square of surgeLP (is the boat being rowed?)
