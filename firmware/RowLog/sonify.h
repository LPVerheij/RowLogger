// Boat-mode sonification on a speaker: pitch follows boat acceleration (centre pitch at
// zero, one octave up per sndMs2PerOct of drive, down on the check). All settings can be
// changed at runtime with the P command and are kept in flash.
//   P?                                              report the settings
//   P,<hz>,<ms2/oct>,<vol>,<mute ms2>,<max oct>,<on>  set them (an empty field keeps its value)
//   PT                                              play a test tone at the centre pitch
// The answer is "SND <hz> <ms2/oct> <vol> <mute> <maxoct> <on>" on the BLE status and
// "P,<same fields>" on serial.
#pragma once
#include "rowlog.h"

void soundLoad();                    // settings from flash (call after prefs.begin)
void soundInit();                    // speaker PWM
void soundUpdate(bool rowing);       // ~100 Hz in boat mode: set the pitch, or mute
void beep(float hz, int ms);         // short feedback tone (blocks for ms)
void soundCommand(const char* s);    // a P command, s = the text after the 'P'
void soundToggle();                  // on/off
void soundService();                 // loop(): save changed settings to flash, 3 s after the last change

extern bool soundOn;
extern float sndMuteMs2;             // mute while the surge RMS is below this
