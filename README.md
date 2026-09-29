# RowLog

A motion logger for rowing, and a web viewer to analyse what it records.

- **Firmware** (`firmware/RowLog/RowLog.ino`) for an ESP32-C3 with a BMI160 IMU, a microSD card, an optional 0.96" OLED and an optional speaker. Mount it on an oar shaft (**oar mode**: sweep, blade height, feather, tap-to-zero) or in the boat (**boat mode**: boat acceleration, check, velocity fluctuation, stroke rate, live sonification).
- **RowLog Viewer** (`docs/index.html`), a single web page that opens the SD-card files, connects live over Bluetooth or USB, and switches the device's mode and sound settings.

## Folder layout

```
firmware/RowLog/RowLog.ino   Arduino sketch (the folder name must match the file name)
docs/index.html              RowLog Viewer, the whole app in one file
docs/figures/                images for the viewer's "Reference figure" panel (see below)
```

The viewer lives in `docs/` so GitHub Pages can publish it directly.

## Building the firmware

1. Arduino IDE 2, board package **esp32 by Espressif** 3.x (tested to compile with 3.3.2).
2. Library Manager: **U8g2** by olikraus (only needed with `ENABLE_OLED 1`).
3. Open `firmware/RowLog/RowLog.ino`.
4. Tools menu:
   - Board: **ESP32C3 Dev Module** (or your C3 board)
   - USB CDC On Boot: **Enabled**
   - Partition Scheme: **Default**
5. Upload over USB.

### Wiring

| Part | Pin(s) on the ESP32-C3 |
|---|---|
| BMI160 and OLED (I2C) | SDA 1, SCL 0 |
| microSD (SPI) | SCK 4, MISO 5, MOSI 6, CS 7 |
| Speaker (PWM, via a small amp or a passive piezo) | 10 |
| Onboard LED / BOOT button | 8 / 9 |

### Using the device

- It starts logging at power-up to `/ROW0001.CSV`, `/ROW0002.CSV`, … A short press of BOOT stops or starts logging.
- Oar or boat mode, the speaker and the sound settings are changed from the viewer and remembered on the device.
- Oar zero: hold the oar perpendicular to the boat, tap the gunwale 3 times, hold still until the LED lights solid.
- No SD card: the data streams over USB serial instead.

## Using the viewer

Open it from GitHub Pages (below) or open `docs/index.html` in Chrome or Edge.

- **Files:** "Open CSV from SD card", or drag a file onto the page. It reads RowLog files and the older stroke-window logs (`StrokeID, Phase, t_ms, ax_ms2, …`).
- **Live:** "Connect Bluetooth" (Chrome/Edge on Android, Windows, macOS, ChromeOS) or "Connect USB" (Chrome/Edge on a computer). These only work when the page is served over **https** or opened as a local file.
- **Examples:** synthetic oar and boat sessions from a physics model of a sculler, each technique producing its own boat-acceleration curve.

### Reference figures

The `REFERENCE_FIGURES` list near the top of the viewer's script has slots for published figures. Put an image in `docs/figures/` and set its `src`, for example `src:"figures/kleshnev-2010-fig3.png"`. Keep the `credit` and `href` fields so each figure stays attributed to its source. Entries without a `src` are not shown.

## Publishing the viewer with GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, Branch: **main**, folder **/docs** → Save. After a minute the viewer is live at `https://<your-username>.github.io/<repository-name>/`, over https, so Bluetooth and USB work.

## Log format

```
# RowLog v1
# mode=boat
# odr_hz=200
t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps
```

Time in ms since logging started, acceleration in milli-g and angular rate in 0.1 °/s, all in sensor axes. `#CAL,<t_ms>` lines mark an oar zero.
