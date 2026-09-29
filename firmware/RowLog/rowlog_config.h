// RowLog settings: features, sample rates, pins and tuning. This is the file to edit.
#pragma once

// ------------------------------------------------------------ features
#define ENABLE_BLE        1        // live stream over Bluetooth LE
#define ENABLE_OLED       1        // 0.96" SSD1306 128x64 I2C display (auto-detected)
#define ENABLE_SOUND      1        // BOAT mode: speaker sonification on PIN_SPEAKER
#define AUTO_START        1        // start logging at power-up

// ------------------------------------------------------------ sampling
#define ODR_HZ            200      // 100, 200 or 400
#define LIVE_HZ           50       // Bluetooth live stream rate
#define SERIAL_HZ         200      // USB serial stream rate (max = ODR_HZ)
#define ACC_RANGE_G       8        // 2, 4, 8, 16   (8 g is safe for catches/impacts)
#define GYR_RANGE_DPS     1000     // 125..2000     (oar handles reach ~300-600 dps)

// ------------------------------------------------------------ pins (ESP32-C3 SuperMini / DevKitM-1)
#define PIN_I2C_SDA       1
#define PIN_I2C_SCL       0
#define PIN_SD_SCK        4
#define PIN_SD_MISO       5
#define PIN_SD_MOSI       6
#define PIN_SD_CS         7
#define PIN_LED           8        // onboard LED on SuperMini (active LOW)
#define LED_ACTIVE_LOW    1
#define PIN_BUTTON        9        // BOOT button, to GND
#define PIN_SPEAKER       10       // PWM tone out -> small amp (PAM8302) or passive piezo
#define OLED_ADDR         0x3C     // most 0.96" modules; some are 0x3D (both are probed)

// ------------------------------------------------------------ tap-to-zero calibration (oar mode)
#define TAP_THRESH_MG     800      // |acc| deviation from 1 g that counts as a tap
#define TAP_MAX_ROT_DPS   60       // oar must not be swinging (average rotation, spikes clipped)
#define TAP_GAP_MIN_MS    150      // one tap rings for a while; ignore peaks closer than this
#define TAP_GAP_MAX_MS    1500     // max time between taps (a relaxed ~1 tap per second is fine)
#define TAP_DEBUG         1        // print each tap / rejected tap on USB serial (when not streaming)
#define CAL_STILL_ROT_DPS 15       // "still" after the taps: rotation below this
#define CAL_STILL_MG      150      //   and acceleration within this of 1 g
#define CAL_STILL_MS      400      //   for this long
#define CAL_TIMEOUT_MS    3000     // give up if not still within this time

// ------------------------------------------------------------ boat mode
#define BOAT_AXIS         0        // 0 = find the surge (fore-aft) axis automatically,
                                   // or force one: 1/-1 = +X/-X toward the bow, 2/-2 = Y, 3/-3 = Z
#define BOAT_MIN_RMS_MS2  0.35f    // stroke rate detection: below this surge level, not rowing

// Sound defaults; the viewer can change them and the device remembers them.
#define SOUND_CENTER_HZ   300.0f   // tone at zero acceleration
#define SOUND_MS2_PER_OCT 2.5f     // acceleration (m/s^2) for one octave up (drive) / down (check)
#define SOUND_VOLUME      6        // 1..10 (PWM duty; 10 is loudest)
#define SOUND_MAX_OCT     1.5f     // pitch never goes further than this many octaves from the centre
#define SOUND_DEFAULT_ON  1        // sound on (toggle: BLE "S", serial "s")
#define SOUND_MUTE_MS2    0.35f    // surge RMS below this: boat isn't being rowed, speaker muted

// ------------------------------------------------------------ SD logging
#define FLUSH_INTERVAL_MS 2000     // max data lost on sudden power cut
#define QUEUE_LEN         1024     // samples buffered in RAM for slow SD writes (~5 s @200 Hz)
