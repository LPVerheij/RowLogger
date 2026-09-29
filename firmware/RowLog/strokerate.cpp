#include "strokerate.h"

// The stroke is a back-and-forth rotation, so the gyro signal along its main axis of
// rotation (sweep or feather, whichever is larger) swings + and - once per stroke.
// Its autocorrelation over the last ~10 s peaks at the stroke period. This needs no
// knowledge of how the sensor is mounted.
#define RATE_FS  25                       // Hz, decimated from ODR
#define RATE_N   256                      // ~10 s window

float strokeRate = 0;
float boatCheck = 0, boatDrive = 0, boatDv = 0;

static float rg[RATE_N][3];
static int rHead = 0, rCount = 0;

// Oar mode feeds the 3 gyro axes (deg/s); boat mode feeds surge acceleration (m/s^2).
void rateAddSample(float x, float y, float z) {
  static int dec = 0;
  if (++dec < ODR_HZ / RATE_FS) return;
  dec = 0;
  rg[rHead][0] = x; rg[rHead][1] = y; rg[rHead][2] = z;
  rHead = (rHead + 1) % RATE_N;
  if (rCount < RATE_N) rCount++;
}

void rateReset() { rCount = 0; rHead = 0; strokeRate = 0; boatCheck = boatDrive = boatDv = 0; }

void rateCompute() {
  static float x[RATE_N];
  if (rCount < RATE_N) { strokeRate = 0; return; }
  float m[3] = {0, 0, 0}, C[3][3] = {{0}};
  for (int i = 0; i < RATE_N; i++) for (int k = 0; k < 3; k++) m[k] += rg[i][k];
  for (int k = 0; k < 3; k++) m[k] /= RATE_N;
  for (int i = 0; i < RATE_N; i++)
    for (int a = 0; a < 3; a++) for (int b = 0; b < 3; b++)
      C[a][b] += (rg[i][a] - m[a]) * (rg[i][b] - m[b]);
  float v[3] = {0.577f, 0.577f, 0.577f};  // principal axis by power iteration
  for (int it = 0; it < 25; it++) {
    float w[3];
    for (int a = 0; a < 3; a++) w[a] = C[a][0] * v[0] + C[a][1] * v[1] + C[a][2] * v[2];
    float n = sqrtf(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
    if (n < 1e-6f) { strokeRate = 0; return; }
    for (int a = 0; a < 3; a++) v[a] = w[a] / n;
  }
  float var = 0;
  for (int i = 0; i < RATE_N; i++) {
    const float* g = rg[(rHead + i) % RATE_N];
    x[i] = (g[0] - m[0]) * v[0] + (g[1] - m[1]) * v[1] + (g[2] - m[2]) * v[2];
    var += x[i] * x[i];
  }
  const float minRms = devMode == MODE_BOAT ? BOAT_MIN_RMS_MS2 : 15.0f;   // m/s^2 or deg/s
  if (sqrtf(var / RATE_N) < minRms) { strokeRate = 0; return; }   // not rowing
  const int lagMin = RATE_FS * 60 / 60, lagMax = RATE_FS * 60 / 12; // 60 .. 12 spm
  float r[lagMax + 2], rmax = -1;
  for (int L = lagMin - 1; L <= lagMax + 1; L++) {
    float sxy = 0, sxx = 0, syy = 0;
    for (int i = 0; i + L < RATE_N; i++) { sxy += x[i] * x[i + L]; sxx += x[i] * x[i]; syy += x[i + L] * x[i + L]; }
    r[L] = sxy / sqrtf(sxx * syy + 1e-9f);
    if (L >= lagMin && L <= lagMax && r[L] > rmax) rmax = r[L];
  }
  if (rmax < 0.4f) { strokeRate = 0; return; }
  int best = -1;   // first peak close to the maximum; 2x and 3x the period correlate just as well
  for (int L = lagMin; L <= lagMax && best < 0; L++)
    if (r[L] >= r[L - 1] && r[L] >= r[L + 1] && r[L] >= 0.85f * rmax) best = L;
  if (best < 0) { strokeRate = 0; return; }
  float den = r[best - 1] - 2 * r[best] + r[best + 1];               // parabolic peak refinement
  float lag = best + (fabsf(den) > 1e-6f ? 0.5f * (r[best - 1] - r[best + 1]) / den : 0);
  float spm = 60.0f * RATE_FS / lag;
  strokeRate = strokeRate > 0 ? strokeRate + 0.5f * (spm - strokeRate) : spm;  // light smoothing

  if (devMode == MODE_BOAT) {   // metrics over the last stroke period (x = surge, mean removed)
    const int P = (int)lroundf(lag), i0 = RATE_N - P;
    float mn = 1e9f, mx = -1e9f, mean = 0, v = 0, vmin = 0, vmax = 0;
    for (int i = i0; i < RATE_N; i++) mean += x[i];
    mean /= P;
    for (int i = i0; i < RATE_N; i++) {
      const float a = x[i] + m[0];               // put the window mean back for check/drive
      if (a < mn) mn = a;
      if (a > mx) mx = a;
      v += (x[i] - mean) / RATE_FS;              // velocity fluctuation within the stroke
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    boatCheck = mn; boatDrive = mx; boatDv = vmax - vmin;
  }
}
