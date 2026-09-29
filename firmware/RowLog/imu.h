// BMI160 IMU: set-up and the sampler task that empties its FIFO.
#pragma once
#include "rowlog.h"

bool imuInit();                  // find and configure the BMI160; false if it isn't there
void imuStart();                 // create the live queue and, with an IMU, start the sampler task

extern QueueHandle_t liveQ;      // every sample, for the live stream and on-device analysis
extern volatile uint32_t imuLost;   // frames lost to FIFO overflow (should stay 0)
extern volatile float imuHz;        // measured sensor sample rate
