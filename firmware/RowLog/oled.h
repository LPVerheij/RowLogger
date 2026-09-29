// 0.96" SSD1306 OLED (I2C, shares the bus with the IMU): logging state, stroke rate,
// boat numbers or the oar-zero steps. All I2C traffic stays in the sampler task: after each
// FIFO read it sends at most one 128-byte page (~3 ms at 400 kHz), so sampling never stalls.
// loop() draws a frame and hands it over. With ENABLE_OLED 0 there is no display.
#pragma once
#include "rowlog.h"

void oledInit();                       // probe 0x3C / 0x3D and set up (before the sampler starts)
void oledServicePage();                // sampler task: send the next changed page, if any
void oledService();                    // loop(): redraw ~5 times a second
void calUiEvent(const CalEvent& e);    // show oar-zero progress
