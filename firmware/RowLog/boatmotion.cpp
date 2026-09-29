#include "boatmotion.h"

// Gravity is tracked in the sensor frame (gyro-propagated, slowly pulled toward the
// accelerometer) and subtracted, so pitching and rolling of the hull don't leak into
// the signal. The surge (fore-aft) axis is the main horizontal axis of what's left;
// its sign is chosen so the boat accelerates forward for most of the stroke (see boatUpdateAxis).
float surgeLP = 0, surgeMS = 0;

static float bG[3] = {0, 0, 9.81f};        // gravity estimate, m/s^2, sensor frame
static bool  bInit = false;
static float bCov[3][3];                    // slow covariance of horizontal linear accel
static float bM3 = 0;                       // slow third moment along the axis (skew sign)
static float bPLP = 0, bPos = 0;            // low-passed projection and its mean sign (-1..1)
static float bAxis[3] = {1, 0, 0};
static float bSign = 1;
static float surge = 0;                     // m/s^2, raw
static float boatRoll = 0, boatPitch = 0;   // deg, from the gravity estimate (not used yet)

void boatReset() { bInit = false; memset(bCov, 0, sizeof(bCov)); bM3 = 0; bPLP = 0; bPos = 0; surge = surgeLP = surgeMS = 0; }

void boatStep(const Sample& s) {
  const float dt = 1.0f / ODR_HZ, G = 9.80665f / 1000.0f, D2R = 0.01745329f / 10.0f;
  const float a[3] = {s.a[0] * G, s.a[1] * G, s.a[2] * G};
  const float w[3] = {s.g[0] * D2R, s.g[1] * D2R, s.g[2] * D2R};
  if (!bInit) { for (int k = 0; k < 3; k++) bG[k] = a[k]; bInit = true; }
  // rotate gravity with the sensor: dg/dt = -w x g
  const float c0 = w[1] * bG[2] - w[2] * bG[1], c1 = w[2] * bG[0] - w[0] * bG[2], c2 = w[0] * bG[1] - w[1] * bG[0];
  bG[0] -= c0 * dt; bG[1] -= c1 * dt; bG[2] -= c2 * dt;
  const float kg = dt / 2.0f;                                   // 2 s pull toward the accelerometer
  for (int k = 0; k < 3; k++) bG[k] += kg * (a[k] - bG[k]);
  const float gn = sqrtf(bG[0] * bG[0] + bG[1] * bG[1] + bG[2] * bG[2]) + 1e-6f;
  const float u[3] = {bG[0] / gn, bG[1] / gn, bG[2] / gn};
  float lin[3] = {a[0] - bG[0], a[1] - bG[1], a[2] - bG[2]};
  const float up = lin[0] * u[0] + lin[1] * u[1] + lin[2] * u[2];
  for (int k = 0; k < 3; k++) lin[k] -= up * u[k];             // horizontal part only

#if BOAT_AXIS == 0
  const float kc = dt / 20.0f;                                  // 20 s statistics
  for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) bCov[i][j] += kc * (lin[i] * lin[j] - bCov[i][j]);
  const float p = lin[0] * bAxis[0] + lin[1] * bAxis[1] + lin[2] * bAxis[2];
  bM3 += kc * (p * p * p - bM3);
  bPLP += (p - bPLP) * (dt / (0.02f + dt));
  bPos += kc * ((bPLP > 0 ? 1.0f : -1.0f) - bPos);
  surge = bSign * p;
#else
  const int ax = abs(BOAT_AXIS) - 1;
  surge = (BOAT_AXIS > 0 ? 1 : -1) * lin[ax];
#endif
  surgeLP += (surge - surgeLP) * (dt / (0.02f + dt));
  surgeMS += (surgeLP * surgeLP - surgeMS) * (dt / 2.0f);
  // boat attitude relative to the sensor's mounting (only changes matter)
  boatRoll  = atan2f(u[1], u[2]) * 57.2958f;
  boatPitch = atan2f(-u[0], sqrtf(u[1] * u[1] + u[2] * u[2])) * 57.2958f;
}

void boatUpdateAxis() {   // once a second: principal axis of the covariance
#if BOAT_AXIS == 0
  float v[3] = {bAxis[0] + 0.01f, bAxis[1] + 0.01f, bAxis[2] + 0.01f};
  for (int it = 0; it < 20; it++) {
    float w[3];
    for (int a = 0; a < 3; a++) w[a] = bCov[a][0] * v[0] + bCov[a][1] * v[1] + bCov[a][2] * v[2];
    float n = sqrtf(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
    if (n < 1e-9f) return;
    for (int a = 0; a < 3; a++) v[a] = w[a] / n;
  }
  if (v[0] * bAxis[0] + v[1] * bAxis[1] + v[2] * bAxis[2] < 0) for (int a = 0; a < 3; a++) v[a] = -v[a];
  for (int a = 0; a < 3; a++) bAxis[a] = v[a];     // keep a continuous direction
  // Forward is the direction the boat accelerates in most of the time (drive and recovery);
  // the catch and release are short negative spikes. The skew only decides when that's unclear.
  if (fabsf(bPos) > 0.08f) bSign = bPos > 0 ? 1.0f : -1.0f;
  else if (fabsf(bM3) > 0.05f) bSign = bM3 < 0 ? 1.0f : -1.0f;
#endif
}
