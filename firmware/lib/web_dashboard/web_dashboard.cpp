#include "web_dashboard.h"
#include "gif_player.h"
#include "../../src/settings.h"
#include "../../src/app_state.h"
#include "../../src/network_task.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <cstring>
#include <cstdio>
#if defined(ESP32) || defined(ESP8266)
#include <WiFi.h>
#endif
#if defined(ESP32)
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

// ==========================================================================
//  Upload state
// ==========================================================================

static File   _uploadFile;
static bool   _uploadOk    = false;
static String _uploadError;

// ==========================================================================
//  Path sanitization (prevent path traversal)
// ==========================================================================

#define MAX_BASENAME_LEN 64

// Returns a safe basename for a file under "/", or empty string if invalid.
// Rejects "..", "/", "\\", NUL, and limits length.
static String sanitizeFileBasename(const String &input) {
    if (input.length() == 0 || input.length() > MAX_BASENAME_LEN)
        return "";
    for (size_t i = 0; i < input.length(); i++) {
        char c = input[i];
        if (c == '\0' || c == '/' || c == '\\')
            return "";
    }
    if (input.indexOf("..") >= 0)
        return "";
    return input;
}

// Normalize request path to a single segment under root for .qgif serving.
// Returns path like "/foo.qgif" or empty if invalid.
static String normalizeQgifPath(const String &url) {
    String path = url;
    path.trim();
    if (path.length() == 0) return "";
    if (path.startsWith("/")) path = path.substring(1);
    if (path.length() == 0 || path.indexOf("..") >= 0 || path.indexOf('/') >= 0)
        return "";
    if (!path.endsWith(".qgif")) return "";
    if (path.length() > MAX_BASENAME_LEN) return "";
    return "/" + path;
}

// ==========================================================================
//  Helpers
// ==========================================================================

// Serve a file from LittleFS with the given content type.
static void serveFile(AsyncWebServerRequest *request,
                      const char *path, const char *contentType) {
    if (LittleFS.exists(path)) {
        request->send(LittleFS, path, contentType);
    } else {
        request->send(404, "text/plain", "File not found");
    }
}

// ==========================================================================
//  Handlers -- static assets
// ==========================================================================

static void handleRoot(AsyncWebServerRequest *request) {
    serveFile(request, "/index.html", "text/html");
}

static void handleCSS(AsyncWebServerRequest *request) {
    serveFile(request, "/style.css", "text/css");
}

static void handleScript(AsyncWebServerRequest *request) {
    serveFile(request, "/script.js", "application/javascript");
}

static void handleJszip(AsyncWebServerRequest *request) {
    serveFile(request, "/jszip.min.js", "application/javascript");
}

static void handleFont(AsyncWebServerRequest *request) {
    serveFile(request, "/inter-latin.woff2", "font/woff2");
}

static void handleIcon(AsyncWebServerRequest *request) {
    serveFile(request, "/icon.svg", "image/svg+xml");
}

static void handleFavicon(AsyncWebServerRequest *request) {
    // Browsers auto-request /favicon.ico; redirect to SVG icon
    request->redirect("/icon.svg");
}

// ==========================================================================
//  Handlers -- REST API
// ==========================================================================

static void handleList(AsyncWebServerRequest *request) {
    StaticJsonDocument<2048> doc;
    JsonArray arr = doc.to<JsonArray>();
    File root = LittleFS.open("/");
    if (root && root.isDirectory()) {
        String current = gifPlayerGetCurrentFile();
        File f = root.openNextFile();
        while (f) {
            String name = String(f.name());
            size_t sz   = f.size();
            f.close();
            if (name.startsWith("/")) name = name.substring(1);
            if (name.endsWith(".qgif")) {
                JsonObject obj = arr.add<JsonObject>();
                obj["name"]    = name;
                obj["size"]    = sz;
                obj["playing"] = (name == current);
            }
            f = root.openNextFile();
        }
        root.close();
    }
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

static void handleStorage(AsyncWebServerRequest *request) {
    StaticJsonDocument<128> doc;
    doc["total"] = LittleFS.totalBytes();
    doc["used"]  = LittleFS.usedBytes();
    doc["free"]  = LittleFS.totalBytes() - LittleFS.usedBytes();
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

static void handleUploadDone(AsyncWebServerRequest *request) {
    StaticJsonDocument<256> doc;
    if (_uploadOk) {
        doc["ok"] = true;
    } else {
        doc["error"] = _uploadError;
    }
    String json;
    serializeJson(doc, json);
    request->send(_uploadOk ? 200 : 507, "application/json", json);
}

// Called for each chunk of the multipart file upload.
//   filename -- original file name from the client
//   index    -- byte offset of this chunk within the upload stream
//   data/len -- current chunk payload
//   final    -- true when this is the last chunk
static void handleUploadData(AsyncWebServerRequest *request,
                             const String &filename, size_t index,
                             uint8_t *data, size_t len, bool final) {
    // --- Start of upload (first chunk, index == 0) ---
    if (index == 0) {
        _uploadOk    = true;
        _uploadError = "";

        // Validate extension
        if (!filename.endsWith(".qgif")) {
            _uploadOk    = false;
            _uploadError = "Only .qgif files are accepted";
            return;
        }

        // Path traversal: use basename only and sanitize
        int lastSlash = filename.lastIndexOf('/');
        String basename = lastSlash >= 0 ? filename.substring(lastSlash + 1) : filename;
        basename = sanitizeFileBasename(basename);
        if (basename.length() == 0 || !basename.endsWith(".qgif")) {
            _uploadOk    = false;
            _uploadError = "Invalid filename";
            return;
        }

        // Rough free-space check (exact size unknown at this point)
        size_t freeBytes = LittleFS.totalBytes() - LittleFS.usedBytes();
        if (freeBytes < 2048) {
            _uploadOk    = false;
            _uploadError = "Insufficient storage -- delete some files first";
            return;
        }

        _uploadFile = LittleFS.open("/" + basename, "w");
        if (!_uploadFile) {
            _uploadOk    = false;
            _uploadError = "Failed to create file";
        }
    }

    // --- Write data ---
    if (_uploadOk && _uploadFile && len > 0) {
        if (_uploadFile.write(data, len) != len) {
            _uploadOk    = false;
            _uploadError = "Write failed -- storage may be full";
        }
    }

    // --- End of upload (last chunk) ---
    if (final) {
        if (_uploadFile) _uploadFile.close();

        int lastSlash = filename.lastIndexOf('/');
        String basename = lastSlash >= 0 ? filename.substring(lastSlash + 1) : filename;
        basename = sanitizeFileBasename(basename);
        if (basename.length() == 0) {
            _uploadOk = false;
            _uploadError = "Invalid filename";
            return;
        }
        String path = "/" + basename;

        if (!_uploadOk) {
            LittleFS.remove(path);
            return;
        }

        // Validate .qgif header
        File vf = LittleFS.open(path, "r");
        if (!vf) {
            _uploadOk = false;
            _uploadError = "Cannot reopen file";
        } else {
            uint8_t hdr[QGIF_HEADER_SIZE];
            if (vf.read(hdr, QGIF_HEADER_SIZE) != QGIF_HEADER_SIZE) {
                _uploadOk = false;
                _uploadError = "File too small";
            } else {
                uint8_t  fc = hdr[0];
                uint16_t w  = hdr[1] | ((uint16_t)hdr[2] << 8);
                uint16_t h  = hdr[3] | ((uint16_t)hdr[4] << 8);
                if (fc == 0 || w != QGIF_FRAME_WIDTH || h != QGIF_FRAME_HEIGHT) {
                    _uploadOk    = false;
                    _uploadError = "Invalid .qgif format (bad header)";
                }
            }
            vf.close();
        }

        if (!_uploadOk) {
            LittleFS.remove(path);
            return;
        }

        if (gifPlayerGetCurrentFile().length() == 0)
            gifPlayerSetFile(basename);
    }
}

// Serve a single .qgif file by name (for backup download; ensures correct binary response)
static void handleGetFile(AsyncWebServerRequest *request) {
    if (!request->hasParam("name")) {
        request->send(400, "text/plain", "Missing name");
        return;
    }
    String name = sanitizeFileBasename(request->getParam("name")->value());
    if (name.length() == 0 || !name.endsWith(".qgif")) {
        request->send(400, "text/plain", "Invalid name");
        return;
    }
    String path = "/" + name;
    if (!LittleFS.exists(path)) {
        request->send(404, "text/plain", "Not found");
        return;
    }
    request->send(LittleFS, path, "application/octet-stream");
}

static void handleDelete(AsyncWebServerRequest *request) {
    if (!request->hasParam("name")) {
        request->send(400, "application/json", "{\"error\":\"Missing name\"}");
        return;
    }
    String name = sanitizeFileBasename(request->getParam("name")->value());
    if (name.length() == 0) {
        request->send(400, "application/json", "{\"error\":\"Invalid name\"}");
        return;
    }

    String path = "/" + name;
    if (!LittleFS.exists(path)) {
        request->send(404, "application/json", "{\"error\":\"File not found\"}");
        return;
    }

    LittleFS.remove(path);

    if (gifPlayerGetCurrentFile() == name) {
        String next = gifPlayerGetFirstFile();
        gifPlayerSetFile(next);
    }

    request->send(200, "application/json", "{\"ok\":true}");
}

// ==========================================================================
//  Handlers -- Settings API
// ==========================================================================

static void handleGetSettings(AsyncWebServerRequest *request) {
    StaticJsonDocument<128> doc;
    doc["speed"]      = getPlaybackSpeed();
    doc["brightness"] = getDisplayBrightness();
    doc["volume"]     = getBuzzerVolume();
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

static void handlePostSettings(AsyncWebServerRequest *request) {
    if (request->hasParam("speed")) {
        int v = request->getParam("speed")->value().toInt();
        if (v >= 1 && v <= 10) setPlaybackSpeed((uint16_t)v);
    }
    if (request->hasParam("brightness")) {
        int v = request->getParam("brightness")->value().toInt();
        if (v >= 0 && v <= 255) setDisplayBrightness((uint8_t)v);
    }
    if (request->hasParam("volume")) {
        int v = request->getParam("volume")->value().toInt();
        if (v >= 0 && v <= 100) setBuzzerVolume((uint8_t)v);
    }
    // If save=1 is passed, persist to NVS
    if (request->hasParam("save")) {
        saveSettings();
    }

    // Echo back the current state
    handleGetSettings(request);
}

// ==========================================================================
//  Handlers -- Play API
// ==========================================================================

static void handlePlay(AsyncWebServerRequest *request) {
    if (!request->hasParam("name")) {
        request->send(400, "application/json", "{\"error\":\"Missing name\"}");
        return;
    }
    String name = sanitizeFileBasename(request->getParam("name")->value());
    if (name.length() == 0) {
        request->send(400, "application/json", "{\"error\":\"Invalid name\"}");
        return;
    }

    String path = "/" + name;
    if (!LittleFS.exists(path)) {
        request->send(404, "application/json", "{\"error\":\"File not found\"}");
        return;
    }

    gifPlayerSetFile(name);
    request->send(200, "application/json", "{\"ok\":true}");
}

// ==========================================================================
//  Handlers -- WiFi reset and Reboot (extern from network_task / ESP)
// ==========================================================================

extern void networkWifiReset();

static void handleWifiReset(AsyncWebServerRequest *request) {
    request->send(200, "application/json", "{\"ok\":true}");
    networkWifiReset();
}

static void handleReboot(AsyncWebServerRequest *request) {
    request->send(200, "application/json", "{\"ok\":true,\"rebooting\":true}");
#if defined(ESP32)
    esp_restart();
#elif defined(ESP8266)
    ESP.restart();
#else
    (void)0;
#endif
}

// ==========================================================================
//  Handlers -- Device identity API
// ==========================================================================

static void handleGetDevice(AsyncWebServerRequest *request) {
    StaticJsonDocument<512> doc;
    doc["id"]               = getDeviceId();
    doc["name"]             = getDeviceName();
    doc["uptime_s"]         = (uint32_t)networkGetBootUptimeSeconds();
    doc["server_connected"] = networkIsCloudWsConnected();
    doc["server_uptime_s"]  = (uint32_t)networkGetCloudWsUptimeSeconds();
    EventBits_t bits        = xEventGroupGetBits(connectivityBits);
    doc["mqtt_connected"]   = (bits & MQTT_CONNECTED_BIT) != 0;
    doc["mqtt_enabled"]     = getMqttEnabled();
    doc["firmware"]         = kQbitVersion;
    bool ua = updateAvailable;
    doc["update_available"] = ua;
    doc["latest_version"]   =
        (ua && updateAvailableVersion[0] != '\0') ? String(updateAvailableVersion) : String("");
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

static void handlePostDevice(AsyncWebServerRequest *request) {
    if (request->hasParam("name")) {
        String name = request->getParam("name")->value();
        if (name.length() > 0 && name.length() <= 32) {
            setDeviceName(name);
        }
    }
    if (request->hasParam("save")) {
        saveSettings();
    }
    handleGetDevice(request);
}

// ==========================================================================
//  Handlers -- Local MQTT settings API
// ==========================================================================

static void handleGetMqtt(AsyncWebServerRequest *request) {
    StaticJsonDocument<512> doc;
    doc["enabled"] = getMqttEnabled();
    doc["host"]    = getMqttHost();
    doc["port"]    = getMqttPort();
    doc["user"]    = getMqttUser();
    doc["pass"]    = getMqttPass();
    doc["prefix"]  = getMqttPrefix();
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

static void handlePostMqtt(AsyncWebServerRequest *request) {
    String  host    = request->hasParam("host")    ?  request->getParam("host")->value()            : getMqttHost();
    int     portVal = request->hasParam("port")    ?  request->getParam("port")->value().toInt()    : (int)getMqttPort();
    String  user    = request->hasParam("user")    ?  request->getParam("user")->value()            : getMqttUser();
    String  pass    = request->hasParam("pass")    ?  request->getParam("pass")->value()            : getMqttPass();
    String  prefix  = request->hasParam("prefix")  ?  request->getParam("prefix")->value()          : getMqttPrefix();
    bool    enabled = request->hasParam("enabled") ? (request->getParam("enabled")->value() == "1") : getMqttEnabled();

    host.trim();
    prefix.trim();
    if (prefix.length() == 0) prefix = "qbit";
    if (portVal < 1 || portVal > 65535) portVal = 1883;
    uint16_t port = (uint16_t)portVal;

    setMqttConfig(host, port, user, pass, prefix, enabled);

    if (request->hasParam("save")) {
        saveSettings();
    }

    handleGetMqtt(request);
}

// ==========================================================================
//  Handlers -- GPIO Pin Configuration API
// ==========================================================================

// Valid GPIOs for ESP32-C3 Super Mini
static const uint8_t VALID_PINS[] = {0,1,2,3,4,5,6,7,8,9,10,20,21};
static const uint8_t VALID_PINS_COUNT = sizeof(VALID_PINS) / sizeof(VALID_PINS[0]);

static bool isValidPin(uint8_t pin) {
    for (uint8_t i = 0; i < VALID_PINS_COUNT; i++) {
        if (VALID_PINS[i] == pin) return true;
    }
    return false;
}

static void handleGetPins(AsyncWebServerRequest *request) {
    StaticJsonDocument<128> doc;
    doc["touch"]  = getPinTouch();
    doc["buzzer"] = getPinBuzzer();
    doc["sda"]    = getPinSDA();
    doc["scl"]    = getPinSCL();
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

static void handlePostPins(AsyncWebServerRequest *request) {
    if (!request->hasParam("touch") || !request->hasParam("buzzer") ||
        !request->hasParam("sda")   || !request->hasParam("scl")) {
        request->send(400, "application/json",
                      "{\"error\":\"Missing pin parameters (touch, buzzer, sda, scl)\"}");
        return;
    }

    uint8_t touch  = (uint8_t)request->getParam("touch")->value().toInt();
    uint8_t buzzer = (uint8_t)request->getParam("buzzer")->value().toInt();
    uint8_t sda    = (uint8_t)request->getParam("sda")->value().toInt();
    uint8_t scl    = (uint8_t)request->getParam("scl")->value().toInt();

    // Validate: all pins must be in the allowed set
    if (!isValidPin(touch) || !isValidPin(buzzer) ||
        !isValidPin(sda)   || !isValidPin(scl)) {
        request->send(400, "application/json",
                      "{\"error\":\"Invalid GPIO pin number\"}");
        return;
    }

    // Validate: all 4 pins must be distinct
    if (touch == buzzer || touch == sda || touch == scl ||
        buzzer == sda   || buzzer == scl || sda == scl) {
        request->send(400, "application/json",
                      "{\"error\":\"All four pins must be different\"}");
        return;
    }

    // Send response before reboot
    request->send(200, "application/json", "{\"ok\":true,\"rebooting\":true}");

    // Save and reboot (setPinConfig writes NVS then calls ESP.restart)
    setPinConfig(touch, buzzer, sda, scl);
}

// ==========================================================================
//  Handlers -- Current playing file
// ==========================================================================

static void handleCurrent(AsyncWebServerRequest *request) {
    StaticJsonDocument<256> doc;
    doc["name"] = gifPlayerGetCurrentFile();
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

// ==========================================================================
//  Handlers -- Timezone API
// ==========================================================================

static void handleGetTimezone(AsyncWebServerRequest *request) {
    StaticJsonDocument<128> doc;
    doc["timezone"] = getTimezoneIANA();
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

static void handlePostTimezone(AsyncWebServerRequest *request) {
    // Accept both "tz" and "iana" param names for the timezone
    String tz;
    if (request->hasParam("tz")) {
        tz = request->getParam("tz")->value();
    } else if (request->hasParam("iana")) {
        tz = request->getParam("iana")->value();
    }
    if (tz.length() > 0) {
        setTimezoneIANA(tz);
        timeManagerSetTimezone(tz);
    } else {
        // Empty value = auto-detect: clear saved timezone
        setTimezoneIANA("");
    }
    saveSettings();
    handleGetTimezone(request);
}

// ==========================================================================
//  Web Cam (local /ws_cam + cloud relay) -- exclusive single source
// ==========================================================================

static AsyncWebSocket      _camWs("/ws_cam");
static uint8_t             _camBuf[QGIF_FRAME_SIZE];
static volatile bool       _camFrameNew       = false;
static SemaphoreHandle_t   _camMutex          = nullptr;
static volatile int        _camClientCount    = 0;
static uint32_t            _camActiveClientId = 0;
static uint32_t            _camLastFrameMs    = 0;
static uint32_t            _camSessionStartMs = 0;
static uint32_t            _camPendingSinceMs = 0;
static uint32_t            _camAcceptedFrames = 0;
static void              (*_onCamStart)()     = nullptr;
static void              (*_onCamStop)()      = nullptr;

enum CamSource : uint8_t { CAM_SRC_NONE = 0, CAM_SRC_LOCAL = 1, CAM_SRC_CLOUD = 2 };
enum CamPending : uint8_t { CAM_PEND_NONE = 0, CAM_PEND_LOCAL = 1, CAM_PEND_CLOUD = 2 };
static CamSource           _camSource         = CAM_SRC_NONE;
static CamPending          _camPending        = CAM_PEND_NONE;
static uint32_t            _camToken          = 0;
static uint32_t            _camTokenSeq       = 0;

// Outbound JSON notify queue (device → cloud server)
#define CAM_OUT_Q_DEPTH 8
#define CAM_OUT_MSG_LEN 96
static char                _camOutQ[CAM_OUT_Q_DEPTH][CAM_OUT_MSG_LEN];
static uint8_t             _camOutHead = 0;
static uint8_t             _camOutTail = 0;
static uint8_t             _camOutCount = 0;
// Sticky bit: CAM_STOP enqueue failed — display must leave CAM_VIEW.
static volatile bool       _camUiExitRequested = false;

#define CAM_PENDING_TIMEOUT_MS 2000
#define CAM_START_NOFRAME_MS   15000  // allow cam_started delivery + browser warmup
#define CAM_FRAME_GAP_MS       3000

static void camRequestUiExit() {
    _camUiExitRequested = true;
}

static bool camLock(TickType_t ticks) {
    return _camMutex && xSemaphoreTake(_camMutex, ticks) == pdTRUE;
}

static void camUnlock() {
    if (_camMutex) xSemaphoreGive(_camMutex);
}

static void camQueueOutboundLocked(const char *json) {
    if (!json) return;
    if (_camOutCount >= CAM_OUT_Q_DEPTH) {
        // Drop oldest
        _camOutHead = (uint8_t)((_camOutHead + 1) % CAM_OUT_Q_DEPTH);
        _camOutCount--;
    }
    strncpy(_camOutQ[_camOutTail], json, CAM_OUT_MSG_LEN - 1);
    _camOutQ[_camOutTail][CAM_OUT_MSG_LEN - 1] = '\0';
    _camOutTail = (uint8_t)((_camOutTail + 1) % CAM_OUT_Q_DEPTH);
    _camOutCount++;
}

static void camQueueOutbound(const char *json) {
    if (!camLock(pdMS_TO_TICKS(50))) return;  // do not mutate on timeout
    camQueueOutboundLocked(json);
    camUnlock();
}

void webCamSetCallbacks(void (*onStart)(), void (*onStop)()) {
    _onCamStart = onStart;
    _onCamStop  = onStop;
}

bool webCamHasNewFrame() {
    return _camFrameNew;
}

void webCamConsumeFrame(uint8_t *dst) {
    if (!dst) return;
    if (!camLock(pdMS_TO_TICKS(10))) return;
    memcpy(dst, _camBuf, QGIF_FRAME_SIZE);
    _camFrameNew = false;
    camUnlock();
}

bool webCamIsBusy() {
    if (!camLock(pdMS_TO_TICKS(20))) return true;  // treat lock fail as busy
    bool busy = _camSource != CAM_SRC_NONE || _camPending != CAM_PEND_NONE || _camActiveClientId != 0;
    camUnlock();
    return busy;
}

bool webCamCloudIsActive() {
    if (!camLock(pdMS_TO_TICKS(20))) return false;
    bool active = (_camSource == CAM_SRC_CLOUD);
    camUnlock();
    return active;
}

uint32_t webCamPendingToken() {
    if (!camLock(pdMS_TO_TICKS(20))) return 0;
    uint32_t t = (_camPending != CAM_PEND_NONE) ? _camToken : 0;
    camUnlock();
    return t;
}

bool webCamDisplayShouldShowCam() {
    if (!camLock(pdMS_TO_TICKS(20))) return true;  // keep UI until we can read
    bool show = (_camSource == CAM_SRC_LOCAL || _camSource == CAM_SRC_CLOUD);
    camUnlock();
    return show;
}

bool webCamConsumeUiExitRequest() {
    if (!_camUiExitRequested) return false;
    _camUiExitRequested = false;
    return true;
}

void webCamOnStopEnqueueFailed() {
    camRequestUiExit();
}

bool webCamCloudTakeOutbound(char *buf, size_t buflen) {
    if (!buf || buflen == 0) return false;
    if (!camLock(pdMS_TO_TICKS(20))) return false;
    if (_camOutCount == 0) {
        camUnlock();
        return false;
    }
    strncpy(buf, _camOutQ[_camOutHead], buflen - 1);
    buf[buflen - 1] = '\0';
    _camOutHead = (uint8_t)((_camOutHead + 1) % CAM_OUT_Q_DEPTH);
    _camOutCount--;
    camUnlock();
    return true;
}

void webCamCloudOnStartedSent() {
    // Watchdog should start when the browser can learn the session is live,
    // not when CAM_VIEW was entered (outbound/network may lag several seconds).
    if (!camLock(pdMS_TO_TICKS(20))) return;
    if (_camSource == CAM_SRC_CLOUD && _camLastFrameMs == 0) {
        _camSessionStartMs = millis();
    }
    camUnlock();
}

static void camClearCloudLocked() {
    if (_camPending == CAM_PEND_CLOUD) _camPending = CAM_PEND_NONE;
    if (_camSource == CAM_SRC_CLOUD) {
        _camSource = CAM_SRC_NONE;
        _camFrameNew = false;
        _camLastFrameMs = 0;
        _camSessionStartMs = 0;
        _camAcceptedFrames = 0;
    }
    _camPendingSinceMs = 0;
}

void webCamCloudStop(const char *reason) {
    bool wasCloud = false;
    bool wasPending = false;
    if (!camLock(pdMS_TO_TICKS(50))) return;  // no unlocked mutation
    wasPending = (_camPending == CAM_PEND_CLOUD);
    wasCloud = (_camSource == CAM_SRC_CLOUD);
    camClearCloudLocked();
    if (wasCloud || wasPending) {
        char msg[CAM_OUT_MSG_LEN];
        const char *r = (reason && reason[0]) ? reason : "remote_stop";
        snprintf(msg, sizeof(msg), "{\"type\":\"cam_stopped\",\"reason\":\"%s\"}", r);
        camQueueOutboundLocked(msg);
    }
    // Session cleared: display must leave CAM_VIEW even if CAM_STOP enqueue fails.
    bool callStop = wasCloud && (_camActiveClientId == 0);
    if (wasCloud) camRequestUiExit();
    camUnlock();
    if (callStop && _onCamStop) _onCamStop();
}

void webCamDisconnectAll() {
    bool stopCb = false;
    if (!camLock(pdMS_TO_TICKS(50))) return;
    bool cloud = (_camSource == CAM_SRC_CLOUD || _camPending == CAM_PEND_CLOUD);
    if (cloud) {
        camClearCloudLocked();
        camQueueOutboundLocked("{\"type\":\"cam_stopped\",\"reason\":\"user_exit\"}");
    }
    bool local = (_camSource == CAM_SRC_LOCAL || _camPending == CAM_PEND_LOCAL);
    if (local) {
        _camSource = CAM_SRC_NONE;
        _camPending = CAM_PEND_NONE;
        _camActiveClientId = 0;
        _camFrameNew = false;
        _camLastFrameMs = 0;
        _camPendingSinceMs = 0;
        stopCb = true;
    }
    if (cloud || local) camRequestUiExit();
    camUnlock();
    _camWs.closeAll();
    if (stopCb && _onCamStop) _onCamStop();
}

static bool camBeginPending(CamPending kind, uint32_t *outToken) {
    if (!camLock(pdMS_TO_TICKS(50))) return false;
    if (_camSource != CAM_SRC_NONE || _camPending != CAM_PEND_NONE || _camActiveClientId != 0) {
        camUnlock();
        return false;
    }
    _camTokenSeq++;
    if (_camTokenSeq == 0) _camTokenSeq = 1;
    _camToken = _camTokenSeq;
    _camPending = kind;
    _camPendingSinceMs = millis();
    if (outToken) *outToken = _camToken;
    camUnlock();
    return true;
}

bool webCamCloudRequestStart() {
    uint32_t token = 0;
    if (!camBeginPending(CAM_PEND_CLOUD, &token)) {
        camQueueOutbound("{\"type\":\"cam_busy\",\"message\":\"camera busy\"}");
        return false;
    }
    if (_onCamStart) {
        _onCamStart();
        return true;
    }
    webCamOnStartEnqueueFailed(token);
    return false;
}

void webCamOnStartEnqueueFailed(uint32_t token) {
    if (!camLock(pdMS_TO_TICKS(50))) return;
    if (_camPending == CAM_PEND_NONE || _camToken != token) {
        camUnlock();
        return;
    }
    CamPending was = _camPending;
    _camPending = CAM_PEND_NONE;
    _camPendingSinceMs = 0;
    if (was == CAM_PEND_CLOUD) {
        camQueueOutboundLocked("{\"type\":\"cam_busy\",\"message\":\"display queue full\"}");
    }
    uint32_t localId = 0;
    if (was == CAM_PEND_LOCAL) {
        localId = _camActiveClientId;
        _camActiveClientId = 0;
    }
    camUnlock();
    if (was == CAM_PEND_LOCAL && localId != 0) {
        // Reject local client without leaving a half-open pending session
        _camWs.closeAll();
    }
}

bool webCamConfirmFromDisplay(uint32_t token, bool accepted) {
    if (token == 0) return false;
    if (!camLock(pdMS_TO_TICKS(50))) return false;
    // Token check + pending clear + source activate are one critical section.
    if (_camPending == CAM_PEND_NONE || _camToken != token) {
        camUnlock();
        return false;  // stale / cancelled — do not enter CAM_VIEW
    }

    CamPending kind = _camPending;
    _camPending = CAM_PEND_NONE;
    _camPendingSinceMs = 0;

    if (kind == CAM_PEND_CLOUD) {
        if (accepted) {
            if (_camActiveClientId != 0) {
                camQueueOutboundLocked("{\"type\":\"cam_busy\",\"message\":\"camera busy\"}");
                camUnlock();
                return false;
            }
            _camSource = CAM_SRC_CLOUD;
            _camSessionStartMs = millis();
            _camLastFrameMs = 0;
            _camFrameNew = false;
            _camAcceptedFrames = 0;
            camQueueOutboundLocked("{\"type\":\"cam_started\"}");
            camUnlock();
            return true;
        }
        camQueueOutboundLocked("{\"type\":\"cam_busy\",\"message\":\"device busy\"}");
        camUnlock();
        return false;
    }

    if (kind == CAM_PEND_LOCAL) {
        if (accepted) {
            _camSource = CAM_SRC_LOCAL;
            _camSessionStartMs = millis();
            _camLastFrameMs = 0;
            // Keep any frames buffered during pending
            camUnlock();
            return true;
        }
        uint32_t id = _camActiveClientId;
        _camActiveClientId = 0;
        _camSource = CAM_SRC_NONE;
        _camFrameNew = false;
        camUnlock();
        if (id != 0) {
            // Close with busy — only on reject, not on early frames
            _camWs.textAll("{\"error\":\"busy\",\"message\":\"device busy\"}");
            _camWs.closeAll();
        }
        if (_onCamStop) _onCamStop();
        return false;
    }
    camUnlock();
    return false;
}

void webCamPushCloudFrame(const uint8_t *data, size_t len) {
    if (!data || len != QGIF_FRAME_SIZE) return;
    uint32_t nowMs = millis();
    if (!camLock(pdMS_TO_TICKS(5))) return;
    if (_camSource != CAM_SRC_CLOUD) {
        camUnlock();
        return;
    }
    if (_camLastFrameMs != 0 && (nowMs - _camLastFrameMs) < 50) {
        camUnlock();
        return;  // rate-limit drop (not counted as accepted)
    }
    memcpy(_camBuf, data, QGIF_FRAME_SIZE);
    _camFrameNew = true;
    _camLastFrameMs = nowMs;
    _camAcceptedFrames++;
    uint32_t n = _camAcceptedFrames;
    camUnlock();
    if (n <= 5 || (n % 50) == 0) {
        Serial.printf("[CAM] accepted cloud frame #%lu len=%u\n",
                      (unsigned long)n, (unsigned)len);
    }
}

void webCamCloudTick() {
    uint32_t nowMs = millis();
    if (!camLock(pdMS_TO_TICKS(20))) return;

    // Pending start timeout (display never confirmed)
    if (_camPending != CAM_PEND_NONE && _camPendingSinceMs != 0 &&
        (nowMs - _camPendingSinceMs) > CAM_PENDING_TIMEOUT_MS) {
        CamPending kind = _camPending;
        uint32_t localId = 0;
        _camPending = CAM_PEND_NONE;
        _camPendingSinceMs = 0;
        if (kind == CAM_PEND_CLOUD) {
            camQueueOutboundLocked("{\"type\":\"cam_busy\",\"message\":\"start timeout\"}");
        } else if (kind == CAM_PEND_LOCAL) {
            localId = _camActiveClientId;
            _camActiveClientId = 0;
            _camFrameNew = false;
        }
        camUnlock();
        if (kind == CAM_PEND_LOCAL && localId != 0) {
            _camWs.textAll("{\"error\":\"busy\",\"message\":\"start timeout\"}");
            _camWs.closeAll();
            if (_onCamStop) _onCamStop();
        }
        return;
    }

    if (_camSource == CAM_SRC_CLOUD) {
        bool timedOut = false;
        const char *kind = nullptr;
        uint32_t elapsed = 0;
        uint32_t accepted = _camAcceptedFrames;
        if (_camLastFrameMs == 0) {
            if (_camSessionStartMs != 0 && (nowMs - _camSessionStartMs) > CAM_START_NOFRAME_MS) {
                timedOut = true;
                kind = "first_frame";
                elapsed = nowMs - _camSessionStartMs;
            }
        } else if ((nowMs - _camLastFrameMs) > CAM_FRAME_GAP_MS) {
            timedOut = true;
            kind = "frame_gap";
            elapsed = nowMs - _camLastFrameMs;
        }
        camUnlock();
        if (timedOut) {
            Serial.printf("[CAM] timeout kind=%s elapsed_ms=%lu accepted_frames=%lu\n",
                          kind ? kind : "?",
                          (unsigned long)elapsed,
                          (unsigned long)accepted);
            webCamCloudStop("timeout");
        }
        return;
    }
    camUnlock();
}

static void onCamWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                         AwsEventType type, void *arg, uint8_t *data, size_t len) {
    switch (type) {
        case WS_EVT_CONNECT: {
#if defined(ESP32) || defined(ESP8266)
            IPAddress remote = client->remoteIP();
            IPAddress local  = WiFi.localIP();
            if ((remote[0] != local[0]) || (remote[1] != local[1]) || (remote[2] != local[2])) {
                client->close();
                break;
            }
#endif
            uint32_t token = 0;
            if (!camBeginPending(CAM_PEND_LOCAL, &token)) {
                client->text("{\"error\":\"busy\",\"message\":\"Web Cam is in use by another client\"}");
                client->close();
                break;
            }
            if (!camLock(pdMS_TO_TICKS(50))) {
                webCamOnStartEnqueueFailed(token);
                client->text("{\"error\":\"busy\",\"message\":\"camera unavailable\"}");
                client->close();
                break;
            }
            _camClientCount++;
            _camActiveClientId = client->id();
            camUnlock();
            if (_onCamStart) _onCamStart();
            else webCamOnStartEnqueueFailed(token);
            break;
        }
        case WS_EVT_DISCONNECT:
            if (!camLock(pdMS_TO_TICKS(50))) break;
            if (client->id() == _camActiveClientId) {
                _camActiveClientId = 0;
                _camFrameNew = false;
                _camLastFrameMs = 0;
                bool stopCb = false;
                if (_camPending == CAM_PEND_LOCAL) {
                    _camPending = CAM_PEND_NONE;
                    _camPendingSinceMs = 0;
                }
                if (_camSource == CAM_SRC_LOCAL) {
                    _camSource = CAM_SRC_NONE;
                    stopCb = true;
                    camRequestUiExit();
                }
                if (_camClientCount > 0) _camClientCount--;
                camUnlock();
                if (stopCb && _onCamStop) _onCamStop();
            } else {
                camUnlock();
            }
            _camWs.cleanupClients();
            break;
        case WS_EVT_DATA: {
            AwsFrameInfo *info = (AwsFrameInfo *)arg;
            // Before display approval: accept/ignore frames from the pending client
            // but NEVER disconnect (browser often sends immediately after open).
            if (!camLock(pdMS_TO_TICKS(5))) break;
            bool isOurClient = (client->id() == _camActiveClientId);
            bool allowStore = isOurClient &&
                (_camSource == CAM_SRC_LOCAL || _camPending == CAM_PEND_LOCAL);
            bool foreign = !isOurClient;
            camUnlock();

            if (foreign) {
                client->text("{\"error\":\"busy\",\"message\":\"Web Cam is in use by another client\"}");
                client->close();
                break;
            }
            if (!allowStore) break;

            uint32_t nowMs = millis();
            if (info->final && info->index == 0 &&
                info->len == QGIF_FRAME_SIZE && info->opcode == WS_BINARY &&
                len == QGIF_FRAME_SIZE) {
                if (!camLock(pdMS_TO_TICKS(5))) break;
                // Re-check under lock
                if (client->id() == _camActiveClientId &&
                    (_camSource == CAM_SRC_LOCAL || _camPending == CAM_PEND_LOCAL)) {
                    if (_camLastFrameMs == 0 || (nowMs - _camLastFrameMs) >= 50) {
                        memcpy(_camBuf, data, QGIF_FRAME_SIZE);
                        _camFrameNew = true;
                        _camLastFrameMs = nowMs;
                    }
                }
                camUnlock();
            }
            break;
        }
        default:
            break;
    }
}

// ==========================================================================
//  Handlers -- Weather location API
// ==========================================================================

static void handleWeatherSearch(AsyncWebServerRequest *request);

// GET /api/weather → {city, lat, lon, displayName}
static void handleGetWeather(AsyncWebServerRequest *request) {
    // Defensive guard: some router versions/plugins may do prefix matching.
    // If /api/weather/search lands here, forward to the proper handler.
    if (request->url() == "/api/weather/search") {
        handleWeatherSearch(request);
        return;
    }
    StaticJsonDocument<256> doc;
    doc["city"]        = getWeatherCity();
    doc["lat"]         = getWeatherLat();
    doc["lon"]         = getWeatherLon();
    doc["displayName"] = getWeatherDisplayName();
    // Keep snake_case alias for backward compatibility across UI versions.
    doc["display_name"] = getWeatherDisplayName();
    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
}

// Returns request parameter from URL query first, then POST body.
static bool getParamValue(AsyncWebServerRequest *request, const char *name, String &out) {
    const AsyncWebParameter *p = request->getParam(name, false);
    if (!p) p = request->getParam(name, true);
    if (!p) return false;
    out = p->value();
    return true;
}

// POST /api/weather?lat=&lon=&display_name=&city=&save=1  → updated JSON
static void handlePostWeather(AsyncWebServerRequest *request) {
    String latStr, lonStr;
    if (getParamValue(request, "lat", latStr) && getParamValue(request, "lon", lonStr)) {
        float lat = latStr.toFloat();
        float lon = lonStr.toFloat();
        // Basic range validation
        if (lat < -90.0f || lat > 90.0f || lon < -180.0f || lon > 180.0f) {
            request->send(400, "application/json", "{\"error\":\"lat/lon out of range\"}");
            return;
        }
        String city;
        if (!getParamValue(request, "city", city)) city = getWeatherCity();

        String displayName;
        if (!getParamValue(request, "display_name", displayName)) {
            // Also accept camelCase from any older/newer UI variants.
            if (!getParamValue(request, "displayName", displayName)) {
                displayName = getWeatherDisplayName();
            }
        }
        // Reject suspiciously long or empty values
        if (city.length() == 0 || city.length() > WEATHER_CITY_MAX_LEN)
            city = city.length() > WEATHER_CITY_MAX_LEN ? city.substring(0, WEATHER_CITY_MAX_LEN) : getWeatherCity();
        if (displayName.length() > WEATHER_NAME_MAX_LEN)
            displayName = displayName.substring(0, WEATHER_NAME_MAX_LEN);
        // Persist immediately (setWeatherLocation also writes to NVS)
        setWeatherLocation(lat, lon, city, displayName);
        setWeatherManual(true);
        // Fetch fresh weather now so active weather screen doesn't show "No data".
        (void)weatherScreenRefreshNow();
    }
    handleGetWeather(request);
}

// Percent-encode a string for use as a URL query value
static String urlEncodeParam(const String &s) {
    String out;
    out.reserve(s.length() * 3);
    for (size_t i = 0; i < s.length(); i++) {
        char c = s[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
            out += c;
        } else {
            char enc[4];
            snprintf(enc, sizeof(enc), "%%%02X", (unsigned char)c);
            out += enc;
        }
    }
    return out;
}

// GET /api/weather/search?q=CityName
// · Geocode via Open-Meteo Geocoding API (proxied by the device)
// · Returns JSON array: [{name, country, lat, lon}] (max 5 results)
static void handleWeatherSearch(AsyncWebServerRequest *request) {
    if (!request->hasParam("q")) {
        request->send(400, "application/json", "{\"error\":\"Missing q\"}");
        return;
    }
    String q = request->getParam("q")->value();
    q.trim();
    if (q.length() == 0 || q.length() > 64) {
        request->send(400, "application/json", "{\"error\":\"q must be 1-64 chars\"}");
        return;
    }
    // Build URL using plain HTTP to avoid cert overhead on ESP32-C3
    char url[256];
    String qEnc = urlEncodeParam(q);
    snprintf(url, sizeof(url),
        "http://geocoding-api.open-meteo.com/v1/search"
        "?name=%s&count=5&language=en&format=json",
        qEnc.c_str());

    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(8000);
    http.begin(url);
    int code = http.GET();
    if (code < 200 || code >= 300) {
        String errMsg = "{\"error\":\"Geocoding unavailable (HTTP " + String(code) + ")\"}";
        http.end();
        request->send(502, "application/json", errMsg);
        return;
    }
    String body = http.getString();
    http.end();

    // Parse and re-emit a compact array
    JsonDocument inDoc;
    if (deserializeJson(inDoc, body) || !inDoc["results"].is<JsonArray>()) {
        request->send(200, "application/json", "[]");
        return;
    }
    JsonArray results = inDoc["results"].as<JsonArray>();
    JsonDocument outDoc;
    JsonArray arr = outDoc.to<JsonArray>();
    for (JsonObject r : results) {
        JsonObject item = arr.add<JsonObject>();
        item["name"]    = r["name"].as<const char *>();
        item["country"] = r["country_code"].as<const char *>();
        item["lat"]     = r["latitude"].as<float>();
        item["lon"]     = r["longitude"].as<float>();
    }
    String out;
    serializeJson(outDoc, out);
    request->send(200, "application/json", out);
}

// ==========================================================================
//  Init
// ==========================================================================

void webDashboardInit(AsyncWebServer &server) {
    // Cam WebSocket: create mutex, register event handler, and add to server
    _camMutex = xSemaphoreCreateMutex();
    _camWs.onEvent(onCamWsEvent);
    server.addHandler(&_camWs);

    // Dashboard at "/" only when STA is connected; when in AP mode (e.g. after WiFi lost
    // and portal restarted), "/" is left for NetWizard so opening 192.168.4.1/ shows WiFi setup.
    server.on("/", HTTP_GET, handleRoot).setFilter(ON_STA_FILTER);
    // Static assets (served from LittleFS data/ partition)
    server.on("/icon.svg",          HTTP_GET,  handleIcon);
    server.on("/favicon.ico",       HTTP_GET,  handleFavicon);
    server.on("/style.css",         HTTP_GET,  handleCSS);
    server.on("/script.js",         HTTP_GET,  handleScript);
    server.on("/jszip.min.js",      HTTP_GET,  handleJszip);
    server.on("/inter-latin.woff2", HTTP_GET,  handleFont);

    // API endpoints
    server.on("/api/list",          HTTP_GET,  handleList);
    server.on("/api/storage",       HTTP_GET,  handleStorage);
    server.on("/api/upload",        HTTP_POST, handleUploadDone, handleUploadData);
    server.on("/api/delete",        HTTP_POST, handleDelete);
    server.on("/api/play",          HTTP_POST, handlePlay);
    server.on("/api/current",       HTTP_GET,  handleCurrent);
    server.on("/api/file",          HTTP_GET,  handleGetFile);
    server.on("/api/settings",      HTTP_GET,  handleGetSettings);
    server.on("/api/settings",      HTTP_POST, handlePostSettings);
    server.on("/api/device",        HTTP_GET,  handleGetDevice);
    server.on("/api/device",        HTTP_POST, handlePostDevice);
    server.on("/api/wifi-reset",    HTTP_POST, handleWifiReset);
    server.on("/api/reboot",        HTTP_POST, handleReboot);
    server.on("/api/mqtt",          HTTP_GET,  handleGetMqtt);
    server.on("/api/mqtt",          HTTP_POST, handlePostMqtt);
    server.on("/api/pins",          HTTP_GET,  handleGetPins);
    server.on("/api/pins",          HTTP_POST, handlePostPins);
    server.on("/api/timezone",      HTTP_GET,  handleGetTimezone);
    server.on("/api/timezone",      HTTP_POST, handlePostTimezone);
    // Register more specific weather route first to avoid accidental prefix captures.
    server.on("/api/weather/search",HTTP_GET,  handleWeatherSearch);
    server.on("/api/weather",       HTTP_GET,  handleGetWeather);
    server.on("/api/weather",       HTTP_POST, handlePostWeather);

    // Catch-all: serve .qgif files from LittleFS for browser preview (path-normalized)
    server.onNotFound([](AsyncWebServerRequest *request) {
        if (request->method() != HTTP_GET) {
            request->send(404, "text/plain", "Not found");
            return;
        }
        String path = normalizeQgifPath(request->url());
        if (path.length() > 0 && LittleFS.exists(path)) {
            request->send(LittleFS, path, "application/octet-stream");
        } else {
            request->send(404, "text/plain", "Not found");
        }
    });
}
