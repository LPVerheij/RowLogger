#include "blelink.h"

#if ENABLE_BLE
#include <BLEDevice.h>
#include <BLEServer.h>
#if !defined(CONFIG_NIMBLE_ENABLED) && !defined(CONFIG_BT_NIMBLE_ENABLED)
#include <BLE2902.h>
#define ADD_2902(c) (c)->addDescriptor(new BLE2902())
#else
#define ADD_2902(c)            // NimBLE adds the CCCD itself
#endif
#define SVC_UUID    "7a1e0001-5c3b-4b8e-9f2a-6f6172000001"
#define DATA_UUID   "7a1e0002-5c3b-4b8e-9f2a-6f6172000001"  // notify, 16-byte Sample
#define STATUS_UUID "7a1e0003-5c3b-4b8e-9f2a-6f6172000001"  // read/notify, text
#define CTRL_UUID   "7a1e0004-5c3b-4b8e-9f2a-6f6172000001"  // write: commands, see CtrlCB

static BLECharacteristic *dataChr, *statusChr;
static volatile bool bleConnected = false;
static volatile bool bleActive = false;   // true once Bluetooth is up
static volatile bool toggleRequest = false;
static volatile char bleCmd = 0;          // mode / sound commands, handled in loop()
static char blePCmd[48];                  // sound settings command ("P..."), handled in loop()
static volatile bool blePPending = false;

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; if (bleActive) BLEDevice::startAdvertising(); }
};
class CtrlCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue();
    if (!v.length()) return;
    if (v[0] == 'P') {                      // sound settings
      if (!blePPending) { strlcpy(blePCmd, v.c_str() + 1, sizeof(blePCmd)); blePPending = true; }
    }
    else if (v[0] == 'L' || v[0] == 'l') toggleRequest = true;
    else if (v == "MO") bleCmd = 'o';       // oar mode
    else if (v == "MB") bleCmd = 'b';       // boat mode
    else if (v[0] == 'S') bleCmd = 's';     // sound on/off
  }
};

void bleInit() {
  BLEDevice::init("RowLog");
  BLEDevice::setMTU(185);
  BLEServer* srv = BLEDevice::createServer();
  srv->setCallbacks(new ServerCB());
  BLEService* svc = srv->createService(SVC_UUID);
  dataChr = svc->createCharacteristic(DATA_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  ADD_2902(dataChr);
  statusChr = svc->createCharacteristic(STATUS_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  ADD_2902(statusChr);
  BLECharacteristic* ctrl = svc->createCharacteristic(CTRL_UUID, BLECharacteristic::PROPERTY_WRITE);
  ctrl->setCallbacks(new CtrlCB());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  bleActive = true;
}

bool bleIsConnected() { return bleConnected; }

void bleSendStatus(const char* text) {
  if (bleActive) { statusChr->setValue(text); if (bleConnected) statusChr->notify(); }
}

void bleSendSample(const Sample& s) {
  if (bleActive && bleConnected) { dataChr->setValue((uint8_t*)&s, sizeof(s)); dataChr->notify(); }
}

char bleTakeCommand() { const char c = bleCmd; bleCmd = 0; return c; }

bool bleTakeToggle() { if (!toggleRequest) return false; toggleRequest = false; return true; }

bool bleTakeSoundCmd(char* out, size_t n) {
  if (!blePPending) return false;
  strlcpy(out, blePCmd, n);
  blePPending = false;
  return true;
}

#else   // ENABLE_BLE 0
void bleInit() {}
bool bleIsConnected() { return false; }
void bleSendStatus(const char*) {}
void bleSendSample(const Sample&) {}
char bleTakeCommand() { return 0; }
bool bleTakeToggle() { return false; }
bool bleTakeSoundCmd(char*, size_t) { return false; }
#endif
