# RowLog: project knowledge

What someone (or Claude) needs to know to pick up this project. Facts about the current state,
the decisions behind it, the domain knowledge it rests on, and where it's going. README.md is the
how-to; this file is the why and the context. Keep it up to date when something here changes.

---

## 1. What it is

A DIY rowing measurement system, built by a TU Delft student who rows.

- **RowLog device**: ESP32-C3 + BMI160 IMU logger. Mounted on an **oar** (sweep angle, blade
  height, feather) or in the **boat** (fore-aft acceleration, check, velocity fluctuation, pitch,
  roll, stroke rate, live sonification). Logs to microSD, streams live over Bluetooth LE and USB.
- **RowLog Viewer**: a web app (`docs/`) that opens the SD files, connects live, controls the
  device, and shows the stroke in charts and 3D. Includes physics-based example sessions modelled
  on Kleshnev's research.
- **Repo**: GitHub, private. Moved from `Petrowlium/rowlogger` to **`LPVerheij/RowLogger`** (the old
  address still redirects and accepts pushes). Work goes straight to `main`.
- **Viewer hosting**: GitHub Pages from `main` → `/docs` → `https://lpverheij.github.io/RowLogger/`
  (on the free plan Pages needs a public repo). The owner hosts the site and adds figure images
  himself. There is also a published claude.ai artifact copy of the viewer.

### The long-term goal ("ultimate setup")

One hub per boat plus sensors on everything, all time-synced:
- **Hub** in the boat: ESP32-S3 with PSRAM (e.g. LOLIN S3 Pro), u-blox M10 GPS with PPS, IMU,
  SD card, speaker, Bluetooth to a phone.
- **Oar sensor** on every oar (blade height, feather), **trunk sensor** on every rower,
  **gate encoder** on every oarlock (sweep angle). Sensors stream to the hub over ESP-NOW.
- Then: data-driven 3D animation from real oar and body data (now it's modelled).
- Camera work is explicitly out of scope for now.

---

## 2. Hardware (current device)

| Part | Detail |
|---|---|
| MCU | ESP32-C3 SuperMini |
| IMU | BMI160, I2C, read through its FIFO (headerless, 12-byte gyro+accel frames) |
| Storage | microSD over SPI |
| Display | optional 0.96" SSD1306 OLED (0x3C or 0x3D, auto-detected) |
| Sound | optional speaker on PWM via a small amp (PAM8302) or passive piezo |

Pins: I2C SDA 1 / SCL 0 · SD SCK 4, MISO 5, MOSI 6, CS 7 · LED 8 (active low) · BOOT button 9 ·
speaker 10. All settings are in `firmware/RowLog/rowlog_config.h`.

Sampling: ODR 200 Hz (100/200/400), BLE live 50 Hz, USB serial 200 Hz, accel ±8 g, gyro ±1000 °/s.
A phase-locked loop ties sample timestamps to the IMU's own sample clock (gains 0.01 / 0.0001).

---

## 3. Firmware

- Arduino-ESP32 core **3.3.2**, U8g2 **2.37.1**. Builds in the Arduino IDE (open
  `firmware/RowLog/RowLog.ino`, a stub) or PlatformIO (`firmware/platformio.ini`, using the
  **pioarduino** platform 55.03.32, because the official PlatformIO platform only has core 2.x).
  Default partition scheme.
- Proper `.h/.cpp` modules in `firmware/RowLog/`: `main`, `imu`, `tapzero`, `sdlog`, `blelink`,
  `strokerate`, `boatmotion`, `sonify`, `oled`, `ledbutton`, shared `rowlog.h`, settings in
  `rowlog_config.h`.
- `firmware/RowLogStandalone/RowLogStandalone.ino` is **generated** from the modules by
  `tools/make_standalone.py` (`--check` to verify). Never edit it by hand; regenerate and commit both.

Behaviour:
- Starts logging at power-up to `/ROW0001.CSV`, `/ROW0002.CSV`, … A short BOOT press toggles logging.
- **Mode (oar/boat) is set from the app** and stored in flash. The boot button no longer switches mode.
- **OTA was removed entirely** (WiFi + BLE together crashed it, and it wasn't needed). Don't bring it back.
- **Tap-to-zero** (oar): hold the oar perpendicular to the boat, tap the gunwale 3 times, hold still
  until the LED is solid. Logged as `#CAL,<t_ms>`.
- **Boat surge axis**: gravity tracked in the sensor frame (gyro-propagated, 2 s pull to the
  accelerometer) and removed; the fore-aft axis is the principal axis of the remaining horizontal
  acceleration (20 s statistics). **Forward = the direction the boat accelerates in most of the time**
  (positive-time fraction; skew only as a tie-breaker). The same rule is used in the viewer.
- **Sonification** (boat mode): pitch = centre × 2^(accel / m/s²-per-octave), clamped to ± max
  octaves, muted below an RMS threshold. Settings are persisted (flash writes batched 3 s after
  the last change).

### Protocols

**BLE GATT** (service `7a1e0001-5c3b-4b8e-9f2a-6f6172000001`):
- `…0002` data, notify: 16 bytes = u32 t_ms, 3× i16 accel (mg), 3× i16 gyro (0.1 °/s), little-endian.
- `…0003` status, notify/read: text. Starts with `[OAR]` or `[BOAT]`; `CAL <ms>` for a zero;
  `SND <hz> <ms2/oct> <vol> <mute> <maxoct> <on>` for sound settings.
- `…0004` control, write: `MO` / `MB` mode, `L` logging toggle, `S` sound toggle,
  `P…` sound commands (see below).

**USB serial** (115200): commands `1` / `0` stream on/off, `o` / `b` mode, `L` logging, `s` sound,
`P…` sound. While streaming: `D,t,ax,ay,az,gx,gy,gz`, `S,<status>`, `C,<t_ms>` (zero),
`P,<sound fields>`.

**Sound command**: `P?` report, `P,<hz>,<ms2/oct>,<vol 1-10>,<mute ms2>,<max oct>,<on>`
(empty field = keep), `PT` test tone.

**SD file**: `# RowLog v1`, `# mode=…`, `# odr_hz=…` header lines, then
`t_ms,ax_mg,ay_mg,az_mg,gx_ddps,gy_ddps,gz_ddps`, with `#CAL,<t_ms>` lines for zeros.

---

## 4. Viewer (`docs/`)

- One HTML page with **hash routes** (`#/`, `#/analysis[/3d|/plots]`, `#/device`, `#/examples`,
  `#/settings`, `#/help[/section]`, `#/more`). Deliberately not separate HTML files: page
  navigation would drop a Bluetooth/USB connection and the loaded session.
- Desktop: top nav. Phone: bottom tab bar (Home, Analysis, Device, Examples, More), a player bar
  above it, stacked layouts, pinch-zoom in 3D.
- `css/app.css` (design tokens on `:root`, light + dark) and classic scripts sharing one global
  scope, loaded in order: `analysis.js` (processing) → `model.js` (rower model, examples, reference
  figures) → `io.js` (CSV) → `sound.js` → `charts.js` → `render3d.js` → `state.js` (session, mounting,
  layout) → `device.js` (BLE/USB) → `app.js` (loop, controls, router).
- Canvases on hidden pages aren't drawn; showing one sets `dirty=true`. `fit()` sizes from layout.
- Design: Barlow Condensed (display), IBM Plex Sans (body), IBM Plex Mono; accent teal `#0B6E8A`,
  blade orange `#D18700`.
- **Example switcher** on the Analysis page keeps the view, moment and playback when switching.
- **Reference figures**: `REFERENCE_FIGURES` in `docs/js/model.js` has slots; set `src` to an image
  in `docs/figures/` and keep `credit` + `href`. The owner may use and link Kleshnev's figures with credit.

### Analysis
- **Oar**: Madgwick filter; sweep from the shaft's horizontal direction, drift and boat turns removed
  with a centred window (default 15 s); strokes by hysteresis on sweep (15°); **catch and finish
  told apart by blade height** (the drive is the half where the blade is lower); mounting (shaft
  axis, blade direction, up axis) detected from the data via centripetal acceleration; tap zeros
  make sweep absolute.
- **Boat**: surge axis and sign as in the firmware; catch marked at the **negative peak around the
  front of the stroke (Kleshnev point 6)**; finish found via the **release dip**; velocity
  fluctuation integrated per stroke with the mean removed.
- **Stroke-window logs** from the older boat logger (`StrokeID, Phase, t_ms, ax_ms2, …`, ~25 Hz,
  no gyro): PRE blocks skipped (stale buffer), STROKE blocks laid end to end, capped gaps shortened
  to 1 s, and strokes spanning a gap excluded from the numbers.

### Examples and the rower model
- Examples: **sweep oar** (oar sensor, sweep dimensions 1.15 m inboard / 2.59 m outboard), and four
  single-scull boat curves: elite front-loaded, elite late peak, club mid-drive hump, amateur.
- The boat curves are not drawn by hand: a **rower model** (body segments, legs/trunk/arms timing per
  technique, handle force) produces them. Boat acceleration = (handle/blade force − drag −
  body-inertia forces) / boat mass. The owner requires the animated movement to be physically
  representative of the technique, because the curve is a result of oar forces and body inertia.
- The amateur curve is an estimate (rushed slide, late blade entry, early arm bend).

### 3D animation rules (agreed with the owner)
- Sweep sign: the rower faces the stern; the oar handle moves toward the bow on the drive.
- **Blades are covered at the catch and clear of the water at the finish, exactly where the graphs
  mark them.** The **catch delay** starts the rower's drive earlier while the blades are still out;
  it never moves the catch.
- **Feathering turns the blade's top edge toward the bow** (top of the handle rolls toward the
  chest), so the driving face points up on the recovery, on both sides. Quick feather after the release.
- Blades are drawn as **big (hatchet) blades**: top edge in line with the shaft, blade below it;
  driving face orange, back darker.
- Elbows flare outward at the finish.
- **Relative** movement: water still, dashed outline = boat at constant average speed. **Absolute**:
  camera moves at constant average speed, water streams past, the hull surges in the frame.
  Exaggeration scales movement, pitch and roll, never the water speed.
- The sculler is modelled, not measured: timed to the detected catch and finish for recordings.

---

## 5. Rowing domain knowledge used

- **Kleshnev's 15 boat-acceleration points**: the catch is when the oar changes direction (point 5);
  the negative peak (point 6) can be before, at or after it. Boat-only data can only find point 6,
  so an oar sensor is needed for the true catch. With a long, shallow check (amateur) the deepest
  dip can jump between two minima.
- Elite front-loaded: legs connect fast → short deep check, early first peak. Late peak: legs and
  trunk together. Mid-drive hump: trunk opens late and suddenly (double trunk work) while the
  handle force sags.
- Sources: Kleshnev 2010, *Boat acceleration, temporal structure of the stroke cycle, and
  effectiveness in rowing* (doi:10.1243/17543371jset40); Kleshnev, *Rowing Styles* (row2k);
  Rowing in Motion, *avoid the drive hump*.

---

## 6. Known limitations and open issues

- Boat-mode catch marker (point 6) is within about ±50 ms of the true catch for good technique, but
  can jump between two dips on a long shallow check.
- In the Kleshnev check, the boat-mode finish marker came out 0.13–0.23 s early on the model
  curves. Options discussed: relabel the markers, choose the dip consistently, add an oar sensor
  (the real fix).
- A 6-axis IMU has no absolute heading, so oar sweep needs tap zeros and a drift window; boat
  turns are only partly removed.
- No force measurement anywhere (needed for power per seat; strain gauges on oar or gate pin later).

---

## 7. Roadmap and design decisions for the next hardware

**Sync between today's SD units**: knock the units together **twice** (not 3 times: that is
tap-to-zero) at the start and end; or ESP-NOW beacons writing `#SYNC` lines; or GPS per unit.

**ESP-NOW instead of sensor SD cards**
- Data load is tiny: 200 Hz × 12 B ≈ 2.4 KB/s per sensor; batch ~15 samples per 250-byte packet.
- Number packets; sensors keep ~10 s in RAM; hub asks again for gaps. Carbon shafts and water
  block 2.4 GHz: antenna up and away from the shaft.
- The hub broadcasts time beacons disciplined by GPS PPS; sensors timestamp against them → one
  time base, one file.
- Eight: 24 sensors ≈ 190 packets/s → raise the ESP-NOW rate to 6–12 Mbps; the hub's peer table holds
  only 20, so beacons and resend requests go out as broadcasts.
- Sensors with the radio on draw ~70–100 mA (C3), versus ~30–50 mA when logging to SD. Try ESP-NOW
  power saving. Keep sensor SD as a fallback until the link is proven on the water.

**Oar angle**
- Preferred: **gate encoder** (AS5600, or AS5048A if alignment is poor): magnet on the pin top,
  chip on a bracket on the swivel. ~0.1°, no drift. Oar IMU then only for blade height and feather.
- Otherwise: oar gyro minus boat gyro (immune to turns), corrected slowly by oar compass minus
  boat compass. GPS course over ground is a poor heading reference (crab angle, in-stroke yaw).
- If a compass is used: BNO085/086 (easy), LSM6DSO/ISM330DHCX + MMC5983MA (best raw), or
  BMI160 + BMM150 on its aux port (smallest change). Keep speaker magnets and battery wires away;
  use full fusion, not accelerometer tilt.
- **Combined oar + gate unit**: one board on the swivel, oar IMU on a short coiled cable;
  saves ~€22 per oar.

**Power**
- Preferred: **LiPo (~600 mAh) + TP4056 USB-C module with protection (DW01/8205A)**. Change R3 to
  **2.4 kΩ** for 500 mA charge. Charge through magnetic **pogo pins** in a 3D-printed dock so units
  stay sealed. Don't charge below 0 °C.
- NiMH alternative: 3× AAA/AA straight into the board's 5 V pin (onboard 3.3 V regulator), with a
  diode against USB back-feed. ~8 h (AAA) / ~20 h (AA) at ~90 mA.
- On/off with a reed switch: **CMOS 555** (TLC555/ICM7555/LMC555, not NE555) as a toggle latch,
  switching a P-MOSFET (AO3401/Si2301) in the battery line. ~0.1–0.2 mA off, versus ~0.5–3 mA
  with ESP32 deep sleep on the current board (LED, regulator, SD). Deep sleep wake on GPIO3, not
  GPIO2 (strapping pin).

**Cost estimate** (upper-end AliExpress, modules on a carrier PCB, LiPo build; add ~15% for
shipping/EU duty/spares and ~€150 once for development):

| Unit | € | Boat | € |
|---|---|---|---|
| Hub | ~101 | 1× | ~270 |
| Oar unit | ~31 | 2− | ~305 |
| Trunk unit | ~34 | 2× | ~430 |
| Gate unit | ~28 | 4− | ~500 |
| | | 4× | ~750 |
| | | 8+ | ~905 |

Biggest costs in a big boat: battery and charging (~25%), enclosures, sensors, boards, mounts.
In a single, the hub's GPS and IMU. Savings come from fewer units (combine oar + gate) and
3D-printed cases and mounts.

**Camera (parked)**: ESP32-S3 + OV2640 does MJPEG only, ~20–25 fps at VGA. Record continuously with
synced timestamps rather than trigger snapshots. A phone/action camera with a sync marker
(hub-driven LED or beep) gives far better video.

---

## 8. Resources and people

- Workshop: **Kickstart Lab** at the Schiehallen, Schieweg 15Y, Delft (former cable factory,
  communal maker space). A "first year free for TU Delft students" claim was not confirmed online.

## 9. Working conventions

- Plain, clear naming and wording in the viewer; units and assumptions stated (e.g. average speed
  is assumed without GPS).
- Firmware: edit modules, regenerate the standalone `.ino`, commit both.
- Viewer: keep element IDs that the scripts rely on; test at desktop and phone width, light and dark.
- Commit to `main` with clear messages.
