// Bluetooth LE link to the RowLog Viewer: a data characteristic (16-byte samples, notify),
// a status characteristic (text, read + notify) and a control characteristic (write).
// Commands written by the app are collected here and handled in loop().
// With ENABLE_BLE 0 these functions do nothing.
#pragma once
#include "rowlog.h"

void bleInit();
bool bleIsConnected();
void bleSendStatus(const char* text);        // status characteristic: set, and notify if connected
void bleSendSample(const Sample& s);         // data characteristic: notify, if connected

// Commands from the app, each returned once
char bleTakeCommand();                       // 'o' oar mode, 'b' boat mode, 's' sound on/off, or 0
bool bleTakeToggle();                        // start/stop logging
bool bleTakeSoundCmd(char* out, size_t n);   // sound settings: the text after the 'P'
