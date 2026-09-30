# RowLog

A motion logger for rowing, and a web viewer to analyse what it records.

- **Firmware** (`firmware/RowLog/RowLog.ino`) for an ESP32-C3 with a BMI160 IMU, a microSD card, an optional 0.96" OLED and an optional speaker. Mount it on an oar shaft (**oar mode**: sweep, blade height, feather, tap-to-zero) or in the boat (**boat mode**: boat acceleration, check, velocity fluctuation, stroke rate, live sonification).
- **RowLog Viewer** (`docs/`), a web app that opens the SD-card files, connects live over Bluetooth or USB, and switches the device's mode and sound settings. It works on a computer and on a phone.

## Folder layout

```
firmware/RowLog/             the firmware, as modules (see below): edit these
firmware/platformio.ini      PlatformIO project that builds it
firmware/RowLogStandalone/   the same firmware as one .ino file, generated from the modules
tools/make_standalone.py     regenerates that file
docs/index.html              RowLog Viewer: the page, with all its pages as sections
docs/css/app.css             its styles (colours, desktop and phone layout)
docs/js/                     its code (see below)
docs/figures/                images for the viewer's "Reference figure" panel (see below)
```

The viewer lives in `docs/` so GitHub Pages can publish it directly.

## Building the firmware

There is one copy of the firmware, in `firmware/RowLog/`. Build it with either the Arduino IDE or PlatformIO; both compile the same files.

| File | What it does |
|---|---|
| `rowlog_config.h` | **settings and pins**: the file to edit |
| `main.cpp` | `setup()`, `loop()`, modes, status line, commands from the app and USB |
| `imu.*` | BMI160 set-up and the FIFO sampler task |
| `tapzero.*` | tap-to-zero calibration (oar mode) |
| `sdlog.*` | SD card and CSV logging |
| `blelink.*` | Bluetooth LE service for the viewer |
| `strokerate.*` | on-device stroke rate and boat metrics |
| `boatmotion.*` | boat-mode fore-aft acceleration |
| `sonify.*` | speaker sonification and its settings |
| `oled.*` | OLED display |
| `ledbutton.*` | status LED and BOOT button |
| `rowlog.h` | types and state shared by the modules |
| `RowLog.ino` | empty stub: the Arduino IDE needs a `<folder>.ino` to open the project |

### Single-file version

`firmware/RowLogStandalone/RowLogStandalone.ino` is the whole firmware in one file, handy for sharing or for opening a single file in the Arduino IDE. It's generated from the modules, so don't edit it: change the modules, then run

```
python3 tools/make_standalone.py
```

and commit both. `python3 tools/make_standalone.py --check` tells you whether it's up to date.

### With PlatformIO

1. Install VS Code and the **PlatformIO IDE** extension.
2. *File → Open Folder…* and choose the **`firmware`** folder (the one with `platformio.ini`).
3. Click the ✓ (Build) in the status bar. The first build downloads the ESP32 platform, compiler and the U8g2 library, which takes a few minutes.
4. Connect the board over USB and click → (Upload), then the plug icon (Serial Monitor, 115200 baud).

From a terminal in the `firmware` folder: `pio run` (build), `pio run -t upload` (upload), `pio device monitor` (serial monitor).

`platformio.ini` pins the board settings the Arduino IDE needs by hand: ESP32-C3, USB CDC on boot, default partitions, Arduino core 3.3.2 (through the [pioarduino](https://github.com/pioarduino/platform-espressif32) platform, as the standard PlatformIO platform only offers core 2.x) and U8g2 2.37.1. The serial monitor decodes crash backtraces into function names and line numbers.

### With the Arduino IDE

1. Arduino IDE 2, board package **esp32 by Espressif** 3.x (tested to compile with 3.3.2).
2. Library Manager: **U8g2** by olikraus (only needed with `ENABLE_OLED 1`).
3. Open `firmware/RowLog/RowLog.ino`. The IDE shows all the files as tabs.
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

| Page | What's on it |
|---|---|
| **Home** | open a recording, connect the sensor or try an example; what's loaded now |
| **Analysis** | the loaded session in three views: *Overview* (stroke profile or blade path, and the numbers), *3D* (the oar, or the boat with its sculler), *Over time* (the whole session as charts). The player at the bottom plays it back. |
| **Device** | connect over Bluetooth or USB, oar/boat mode, SD logging, sonification and the device speaker |
| **Examples** | a synthetic sweep oar, and single-scull boat sessions from a physics model of a sculler, each technique producing its own boat-acceleration curve, with links to Kleshnev's measured curves |
| **Settings** | which sensor recorded the file, oar mounting and processing, boat axis, light or dark |
| **Help** | mounting, zeroing, what the numbers mean, what is measured and what is modelled, file formats |

On a phone the pages are in a tab bar at the bottom (Settings and Help under *More*).

- **Files:** "Open a recording" on Home, or drag a file onto the page. It reads RowLog files and the older stroke-window logs (`StrokeID, Phase, t_ms, ax_ms2, …`).
- **Live:** "Connect Bluetooth" (Chrome/Edge on Android, Windows, macOS, ChromeOS) or "Connect USB" (Chrome/Edge on a computer). These only work when the page is served over **https** or opened as a local file.

The pages are one web page with addresses like `#/analysis/3d`, not separate files: going to another page would drop a Bluetooth or USB connection and the loaded session. Links to a page (and the browser's back button) still work.

### Viewer code

The scripts in `docs/js/` are plain scripts that share one global scope, loaded in this order:

| File | What it does |
|---|---|
| `analysis.js` | signal processing: oar angles (Madgwick filter, drift removal, strokes) and boat motion |
| `model.js` | the rower model, the examples and the reference-figure slots |
| `io.js` | reading CSV files |
| `sound.js` | sonification in the browser and the device-speaker settings |
| `charts.js` | the 2D charts and the stroke numbers |
| `render3d.js` | the 3D oar and boat views |
| `state.js` | the loaded session, mounting detection, layout |
| `device.js` | Bluetooth and USB connection |
| `app.js` | the frame loop, controls and page navigation |

### Reference figures

The `REFERENCE_FIGURES` list near the top of `docs/js/model.js` has slots for published figures. Put an image in `docs/figures/` and set its `src`, for example `src:"figures/kleshnev-2010-fig3.png"`. Keep the `credit` and `href` fields so each figure stays attributed to its source. Entries without a `src` are not shown.

## Publishing the viewer with GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, Branch: **main**, folder **/docs** → Save. After a minute the viewer is live at `https://lpverheij.github.io/RowLogger/`, over https, so Bluetooth and USB work. On the free GitHub plan, Pages only works for public repositories.

## Log format

```
# RowLog v1
# mode=boat
# odr_hz=200
t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps
```

Time in ms since logging started, acceleration in milli-g and angular rate in 0.1 °/s, all in sensor axes. `#CAL,<t_ms>` lines mark an oar zero.
