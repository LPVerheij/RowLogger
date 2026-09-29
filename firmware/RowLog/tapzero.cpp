#include "tapzero.h"

volatile bool calibrated = false;
static QueueHandle_t evQ;

void tapZeroInit() { evQ = xQueueCreate(16, sizeof(CalEvent)); }

bool tapZeroEvent(CalEvent& e) { return xQueueReceive(evQ, &e, 0) == pdTRUE; }

static void sendEv(uint8_t type, uint32_t t, uint8_t n = 0, float mg = 0, float dps = 0) {
  CalEvent e{type, n, (uint16_t)fminf(mg, 65535.0f), (uint16_t)dps, t};
  xQueueSend(evQ, &e, 0);
}

void tapDetector(const Sample& s) {    // runs in the sampler task, every sample
  static float rotAvg = 0;
  static uint32_t lastTap = 0, lastPeak = 0, waitStart = 0, stillStart = 0;
  static int taps = 0;
  static bool waiting = false, stillRun = false;

  const float amag = sqrtf((float)s.a[0] * s.a[0] + (float)s.a[1] * s.a[1] + (float)s.a[2] * s.a[2]);
  const float dev  = fabsf(amag - 1000.0f);                                   // mg
  const float rot  = sqrtf((float)s.g[0] * s.g[0] + (float)s.g[1] * s.g[1] + (float)s.g[2] * s.g[2]) / 10.0f;
  // Slow rotation average with the short spikes of the taps themselves clipped off, so a
  // hard tap doesn't block the next one; a real stroke keeps it well above the limit.
  rotAvg += (fminf(rot, 2.0f * TAP_MAX_ROT_DPS) - rotAvg) / (0.5f * ODR_HZ);
  const uint32_t t = s.t;

  if (dev > TAP_THRESH_MG) {
    const bool newPeak = (uint32_t)(t - lastPeak) > TAP_GAP_MIN_MS;   // not the same tap ringing
    lastPeak = t;
    if (!newPeak) return;
    if (rotAvg >= TAP_MAX_ROT_DPS) { sendEv(EV_TAP_REJECT, t, 0, dev, rotAvg); return; }
    if (waiting) {                       // a 4th tap: not a clean sequence
      waiting = false; taps = 0; lastTap = t; sendEv(EV_CAL_FAIL, t); return;
    }
    const uint32_t gap = t - lastTap;
    taps = (taps > 0 && gap <= TAP_GAP_MAX_MS) ? taps + 1 : 1;
    lastTap = t;
    sendEv(EV_TAP, t, taps, dev, rotAvg);
    if (taps == 3) { taps = 0; waiting = true; waitStart = t; stillRun = false; }
    return;
  }
  if (!waiting || (uint32_t)(t - lastTap) < 200) return;   // let the last tap ring out
  if (rot < CAL_STILL_ROT_DPS && dev < CAL_STILL_MG) {
    if (!stillRun) { stillRun = true; stillStart = t; }
    else if ((uint32_t)(t - stillStart) >= CAL_STILL_MS) {
      waiting = false;
      sendEv(EV_CAL_OK, stillStart + CAL_STILL_MS / 2);   // middle of the still window
      return;
    }
  } else stillRun = false;
  if ((uint32_t)(t - waitStart) > CAL_TIMEOUT_MS) { waiting = false; sendEv(EV_CAL_FAIL, t, 1); }
}
