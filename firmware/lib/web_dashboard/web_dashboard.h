#ifndef WEB_DASHBOARD_H
#define WEB_DASHBOARD_H

#include <ESPAsyncWebServer.h>

// Register all QBIT dashboard routes on the shared AsyncWebServer.
//
// Static assets (served from LittleFS):
//   GET  /                    -- dashboard UI
//   GET  /style.css           -- stylesheet
//   GET  /script.js           -- client-side logic
//   GET  /inter-latin.woff2   -- Inter font (latin subset)
//
// REST API:
//   GET  /api/list            -- JSON array of .qgif files
//   GET  /api/storage         -- JSON storage info  {total, used, free}
//   POST /api/upload          -- multipart .qgif upload
//   POST /api/delete          -- delete a file      (?name=xxx)
//   POST /api/play            -- select file to play (?name=xxx)
//   GET  /api/settings        -- JSON {speed, brightness, volume}
//   POST /api/settings        -- apply settings live (RAM only)
//   POST /api/settings?save=1 -- also persist current settings to NVS
//   GET  /api/timezone        -- JSON {timezone, offset}
//   POST /api/timezone?tz=    -- set timezone IANA name
void webDashboardInit(AsyncWebServer &server);

// Settings callbacks -- implemented by settings.cpp / display_helpers.cpp.
extern void     setPlaybackSpeed(uint16_t val);
extern uint16_t getPlaybackSpeed();
extern void     setDisplayBrightness(uint8_t val);
extern uint8_t  getDisplayBrightness();
extern void     setBuzzerVolume(uint8_t pct);
extern uint8_t  getBuzzerVolume();
extern void     saveSettings();

// Device identity -- implemented by settings.cpp.
extern String   getDeviceId();
extern String   getDeviceName();
extern void     setDeviceName(const String &name);

// Local MQTT settings -- implemented by settings.cpp.
extern String   getMqttHost();
extern uint16_t getMqttPort();
extern String   getMqttUser();
extern String   getMqttPass();
extern String   getMqttPrefix();
extern bool     getMqttEnabled();
extern void     setMqttConfig(const String &host, uint16_t port,
                              const String &user, const String &pass,
                              const String &prefix, bool enabled);

// GPIO pin configuration -- implemented by settings.cpp.
extern uint8_t  getPinTouch();
extern uint8_t  getPinBuzzer();
extern uint8_t  getPinSDA();
extern uint8_t  getPinSCL();
extern void     setPinConfig(uint8_t touch, uint8_t buzzer,
                             uint8_t sda, uint8_t scl);

// Timezone -- implemented by settings.cpp / time_manager.cpp.
extern String  getTimezoneIANA();
extern void    setTimezoneIANA(const String &tz);

// Time manager -- implemented by time_manager.cpp.
extern void timeManagerSetTimezone(const String &ianaTz);

// Weather location -- implemented by settings.cpp / weather_screen.cpp.
extern String  getWeatherCity();
extern float   getWeatherLat();
extern float   getWeatherLon();
extern String  getWeatherDisplayName();
extern void    setWeatherLocation(float lat, float lon,
                                   const String &city, const String &displayName);
// Cache invalidation (defined in weather_screen.cpp).
extern void weatherScreenInvalidateCache();
extern bool weatherScreenRefreshNow();

// ==========================================================================
//  Web Cam streaming (local /ws_cam + cloud device WS relay)
// ==========================================================================
//
//  Shared 1024-byte frame buffer. Exactly one source may be active:
//  local browser on LAN (/ws_cam) OR cloud relay (device WS binary frames).
//
//  Cloud control (text JSON on device cloud WebSocket):
//    {"type":"cam_start"}
//    {"type":"cam_stop"}
//  Cloud frames: binary WS messages, exactly 1024 bytes (128x64 1bpp QGIF).
//  Device -> server (text JSON):
//    {"type":"cam_started"}
//    {"type":"cam_busy","message":"..."}
//    {"type":"cam_stopped","reason":"user_exit|timeout|ws_drop|remote_stop"}
//
void webCamSetCallbacks(void (*onStart)(), void (*onStop)());

bool webCamHasNewFrame();
void webCamConsumeFrame(uint8_t *dst);

// User exit (tap) or forced teardown: close local clients + stop cloud.
void webCamDisconnectAll();

// Cloud: request start (queues CAM_START). False if busy; queues cam_busy.
// Active only after webCamConfirmFromDisplay(token, true) returns true.
bool webCamCloudRequestStart();
// Token of the current pending start (for NetworkEvent::CAM_START.token).
uint32_t webCamPendingToken();
// Atomically validate token + accept/reject under the cam mutex.
// Returns true only when accepted and the session is now active — display
// must enter CAM_VIEW only after a true return (never before).
bool webCamConfirmFromDisplay(uint32_t token, bool accepted);
// Call when CAM_START could not be enqueued to the display task.
void webCamOnStartEnqueueFailed(uint32_t token);
// Call when CAM_STOP could not be enqueued; sticky UI-exit bit for reconcile.
void webCamOnStopEnqueueFailed();
// Display polls: sticky exit request (failed CAM_STOP enqueue) or no live session.
bool webCamConsumeUiExitRequest();
bool webCamDisplayShouldShowCam();
void webCamCloudStop(const char *reason);
bool webCamCloudIsActive();
bool webCamIsBusy();
void webCamPushCloudFrame(const uint8_t *data, size_t len);
// Timeouts / pending maintenance — call even when cloud WS is offline.
void webCamCloudTick();
bool webCamCloudTakeOutbound(char *buf, size_t buflen);
// Call after cam_started is actually written to the cloud WS (resets no-frame watchdog).
void webCamCloudOnStartedSent();

#endif // WEB_DASHBOARD_H
