# QBIT Architecture Overview

**QBIT** is an open-source ESP32-C3 desktop companion robot and personal IoT avatar. It shows mood animations on an OLED display, receives **poke** messages from a shared cloud network, hosts a local device dashboard, and optionally integrates with **Home Assistant via MQTT**.

- **Official cloud:** [https://qbit.labxcloud.com](https://qbit.labxcloud.com)
- **License:** Creative Commons BY-NC-SA 4.0
- **Hardware:** ESP32-C3 (e.g. Seeed XIAO ESP32-C3) + SSD1306 OLED + TTP223 touch + passive buzzer

This document summarizes the repository layout, system architecture, major components, data flows, and the role of MQTT.

---

## Table of contents

1. [System at a glance](#1-system-at-a-glance)
2. [Repository structure](#2-repository-structure)
3. [Architecture style](#3-architecture-style)
4. [Firmware (edge device)](#4-firmware-edge-device)
5. [Web platform](#5-web-platform)
6. [Key product domains](#6-key-product-domains)
7. [Request and event flows](#7-request-and-event-flows)
8. [MQTT and Home Assistant](#8-mqtt-and-home-assistant)
9. [Data storage](#9-data-storage)
10. [Tech stack](#10-tech-stack)
11. [Deployment and CI](#11-deployment-and-ci)
12. [Entry points](#12-entry-points)
13. [One-line summary](#13-one-line-summary)

---

## 1. System at a glance

QBIT is a **hybrid IoT system** with three cooperating worlds that meet on the device:

| Path | Purpose |
|------|---------|
| **Cloud web platform** | Users, Network graph, Poke, Library, Claim/Friends, Admin |
| **On-device firmware** | OLED UI, touch, games, local dashboard, cloud WebSocket client |
| **Local MQTT (optional)** | Bridge to Home Assistant / home automation |

```
Browsers ──HTTPS──► Nginx (SPA) ──proxy──► Node backend (API + Socket.io)
                                              │
ESP32 devices ──── WSS /device + API key ─────┘
  │
  ├── http://qbit.local     (local dashboard)
  └── MQTT (optional) ──► broker ──► Home Assistant
```

| Concern | Cloud (WebSocket / HTTP) | MQTT |
|---------|--------------------------|------|
| Goal | Multi-user network & poke | Home automation |
| Network | Internet / central server | Usually LAN |
| Required? | Yes for the web Network | No |

Turning MQTT off does **not** break Network or cloud Poke.

---

## 2. Repository structure

```
QBIT/
├── README.md / README.zh-TW.md
├── LICENSE
├── docs/                    # Images + this architecture doc
├── firmware/                # ESP32-C3 firmware (PlatformIO / Arduino)
├── web/
│   ├── backend/             # Express API + device WS + Socket.io + admin host
│   ├── frontend/            # React user SPA (Network / Flash / Library)
│   ├── admin/               # React admin SPA (baked into backend image)
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── .env.example
├── tools/                   # Animation converters, flasher, simulator, ops TUI
└── .github/workflows/       # Firmware release + GitHub Pages flasher
```

| Path | Responsibility |
|------|----------------|
| `firmware/src/` | Device app: RTOS tasks, poke, MQTT, settings, games, weather |
| `firmware/lib/` | Reusable libs (GIF player, web dashboard) |
| `firmware/data/` | LittleFS image: dashboard assets + sample `.qgif` files |
| `web/backend/src/` | Cloud API, auth, WebSocket, Socket.io, SQLite |
| `web/frontend/src/` | Public web UI |
| `web/admin/src/` | Operator / moderation UI |
| `tools/` | Offline converters, Web Serial flasher, device simulator, `qbit-ctl` |
| `.github/` | Release & flasher deployment automation |

There is **no** .NET / Visual Studio solution. Builds use **PlatformIO** (firmware) and **npm / Docker** (web).

---

## 3. Architecture style

| Layer | Style |
|-------|--------|
| Overall | IoT edge + central cloud |
| Web platform | **Modular monolith** — one Node process, SQLite, service/route folders |
| Frontends | React SPAs (Vite) |
| Firmware | **FreeRTOS multi-task** Arduino/ESP32 app + local Async HTTP server |
| Realtime | Raw **WebSocket** (devices) + **Socket.io** (browsers) + optional **MQTT** |
| Deployment | Two Docker services (Nginx frontend + Node backend); TLS usually at Cloudflare / reverse proxy |

Closest labels: **modular monolith (web)** + **embedded RTOS (device)** + **event-driven realtime**.

Backend layering is intentionally thin:

```
Routes → Services → SQLite / WebSocket / Socket.io
```

Not a full Application → Domain → Infrastructure package split.

---

## 4. Firmware (edge device)

### Runtime model

`firmware/src/main.cpp` starts FreeRTOS tasks (display, network, input) with queues and mutexes. Work runs in tasks; the Arduino `loop()` is not the main execution path.

### On-device capabilities

- Shuffle playback of local `.qgif` animations while idle
- Receive and show poke notifications (sender, message, timestamp)
- Clock / date (12h or 24h), notification history
- Weather, timer, mini-games (e.g. T-Rex, Flappy, Car Avoidance)
- Settings menu (timezone, GPIO pins, display, etc.)
- Local web dashboard at **`http://qbit.local`**
- Cloud connection over WSS to `/device` with a bearer API key
- Optional MQTT + Home Assistant discovery

### Local dashboard

Served by ESPAsyncWebServer from LittleFS (`firmware/data/` + `firmware/lib/web_dashboard/`):

- Upload / manage `.qgif` animations
- Wi-Fi and device settings
- MQTT broker configuration
- Webcam → OLED stream (dithering modes; single client)

### Local storage on device

| Store | Contents |
|-------|----------|
| **NVS** | Wi-Fi, GPIO, MQTT, display settings |
| **LittleFS** | Animations + dashboard static assets |

---

## 5. Web platform

### Backend (`web/backend/`)

Entry: `src/index.ts` — starts two HTTP servers, device WebSocket, Socket.io, graceful shutdown.

| Port | App | Role |
|------|-----|------|
| **3001** | `app.ts` | User API, Google OAuth, device WS, Socket.io |
| **3002** | `adminApp.ts` | Admin API + static admin SPA |

| Module area | Responsibility |
|-------------|----------------|
| Auth | Google OAuth 2.0 (Passport) + express-session |
| Devices / poke | Online list, poke delivery (incl. pre-rendered bitmaps for CJK/emoji) |
| Claim / friends | Device ownership, friend requests, poke gating |
| Library | Upload / list / star / download `.qgif`; zip batch |
| Reports / bans | User reports; IP / user bans |
| Users | User records; opaque public IDs |
| Socket.io | Live browser updates (Network graph) |
| Device WS (`/device`) | ESP32 connections and control messages |
| Config / validation | Env (`config.ts`), Zod schemas |
| Middleware | Helmet, CORS, rate limit, CSRF origin, ban check, errors |

**High-level API surface:**

- `/auth/*` — login / me / logout
- `/api/devices`, `/api/poke`, `/api/claim`, `/api/friends*`, `/api/me/settings`
- `/api/library/*`
- `/api/report`
- `/health`
- Admin `:3002` — `/api/admin/*` (devices, bans, reports, broadcast)

npm package: `qbit-backend` (private).

### User frontend (`web/frontend/`)

React 19 + Vite SPA. Main pages:

| Page | Purpose |
|------|---------|
| **Network** | Real-time device / user graph (`vis-network`) |
| **Flash** | Browser-based firmware flasher |
| **Library** | Community animation repository |

npm package: `qbit-frontend`.

### Admin frontend (`web/admin/`)

React SPA for sessions, users, devices, bans, reports, and broadcast. Built into the backend Docker image.

npm package: `qbit-admin`.

### Nginx / Compose

- Frontend container serves the SPA and proxies `/api`, `/auth`, `/socket.io`, `/device` to the backend
- Production: `web/docker-compose.yml`
- Dev (Vite HMR): `web/docker-compose.dev.yml`

Docker images: `seanchangx/qbit-backend`, `seanchangx/qbit-frontend`.

---

## 6. Key product domains

| Capability | Where it lives |
|------------|----------------|
| **Network graph** | Frontend + Socket.io + online device registry |
| **Poke** | Frontend → API → device WS; optional MQTT publish on device |
| **Claim / unclaim** | API + on-device long-press confirmation |
| **Friends** | Friend token flow; poke permissions; public pairs |
| **Library** | Community `.qgif` upload / star / download |
| **Flash** | In-app flasher + standalone `tools/flasher` (GitHub Pages) |
| **On-device UI** | Weather, timer, games, settings |
| **Animations** | Custom `.qgif` format; converters under `tools/` |
| **MQTT / HA** | Local broker + discovery entities |
| **Admin / moderation** | Ban, reports, broadcast notify |
| **Webcam → OLED** | Local dashboard WebSocket stream |

---

## 7. Request and event flows

### A. Browser poke → device

```
Browser (React)
  → HTTPS → reverse proxy / Cloudflare
    → frontend Nginx
      → POST /api/poke → Express
        → device.service (find WS connection)
          → WebSocket message to ESP32 (/device)
            → network_task → poke_handler / display_task
              → OLED (+ optional MQTT poke event to HA)
  ← Socket.io events refresh Network for other browsers
```

### B. Device presence → browsers

```
ESP32 network_task
  → WSS to cloud /device (Bearer WS / device API key)
    → device.service registers device
      → Socket.io broadcast → frontends (graph nodes)
```

### C. Local-only (no cloud)

```
Phone/PC → http://qbit.local (mDNS)
  → ESP AsyncWebServer + web_dashboard
    → LittleFS files, NVS settings, MQTT config, webcam
```

### D. Home Assistant

```
HA / MQTT broker ↔ PubSubClient on device
  topics under <prefix>/<deviceId>/...
  HA MQTT discovery creates entities automatically
```

### E. Firmware internals

```
setup()
  → FreeRTOS queues / mutexes
  → displayTask | networkTask | inputTask
```

---

## 8. MQTT and Home Assistant

MQTT is an **optional local integration**. It is **not** how the cloud Network works.

### What it does

Bidirectional bridge between the device and a local MQTT broker (typically Home Assistant’s):

**Publish (device → HA)**

- Online / offline status (LWT)
- Cloud/server WebSocket connection state
- IP / device info
- Last poke (sender, text, time)
- Touch gestures (`single_tap`, `double_tap`, `long_press`)
- Mute state
- Current animation filename

**Subscribe (HA → device)**

- Poke command (JSON on `.../command`)
- Poke message text entity (`.../poke_text/set`)
- Mute set (`ON` / `OFF`)
- Next animation

### Configuration

Set host, port, credentials, and topic prefix from the device dashboard at `http://qbit.local`.

Default topic prefix: `qbit`.

### Home Assistant discovery

On connect, the firmware publishes MQTT discovery payloads so HA auto-creates entities such as:

| Entity | Type | Description |
|--------|------|-------------|
| Status | Binary sensor | Device online/offline |
| Server | Binary sensor | Cloud WS connected |
| IP | Sensor | Local IP |
| Poke | Button | Trigger a poke |
| Poke message | Text | Message used when poking from HA |
| Last poke | Sensor | Last received poke |
| Mute | Switch | Buzzer mute |
| Touch | Sensor | Gesture events |
| Next animation | Button | Advance `.qgif` |

### Example topics (prefix `qbit`)

| Topic | Direction | Description |
|-------|-----------|-------------|
| `qbit/<id>/status` | Pub | `online` / `offline` (retained, LWT) |
| `qbit/<id>/info` | Pub | Device info JSON |
| `qbit/<id>/command` | Sub | e.g. `{"command":"poke","sender":"...","text":"..."}` |
| `qbit/<id>/poke` | Pub | Poke event JSON |
| `qbit/<id>/mute/state` | Pub | `ON` / `OFF` |
| `qbit/<id>/mute/set` | Sub | Set mute |
| `qbit/<id>/touch` | Pub | Gesture JSON |
| `qbit/<id>/animation/state` | Pub | Current animation |
| `qbit/<id>/animation/next` | Sub | Switch animation |

Implementation: `firmware/src/mqtt_ha.*` and MQTT helpers in `firmware/src/network_task.cpp` (`PubSubClient`).

---

## 9. Data storage

### Cloud (Docker volume `qbit-data`)

| Store | Typical path | Contents |
|-------|--------------|----------|
| SQLite (`better-sqlite3`, WAL) | `/data/qbit.db` | sessions, users, claims, library, stars, device records, bans, reports |
| Files | `/data/files/` | Library `.qgif` blobs |
| Secrets | `/data/secrets.json` | Auto-generated secrets if unset |

### Device

| Store | Contents |
|-------|----------|
| NVS | Wi-Fi, pins, MQTT, display |
| LittleFS | Animations + local dashboard assets |

---

## 10. Tech stack

| Area | Stack |
|------|--------|
| Firmware language | C++ (Arduino on ESP32) |
| Board / build | ESP32-C3, PlatformIO (`seeed_xiao_esp32c3`) |
| Device libs | U8g2, NetWizard, ESPAsyncWebServer, ArduinoJson, ArduinoWebsockets, PubSubClient, QRCode, NonBlockingRTTTL |
| Backend | Node 20, Express 4, TypeScript, Zod, Pino, Helmet, Multer, Archiver |
| DB | SQLite via `better-sqlite3` |
| Realtime | `ws` (devices), `socket.io` (browsers) |
| Auth (users) | `passport-google-oauth20`, express-session |
| Auth (devices) | Bearer `DEVICE_API_KEY` / `WS_API_KEY` |
| Auth (admin) | Username/password session |
| Frontend | React 19, Vite 6, TypeScript, vis-network / vis-data |
| Ops | Docker Compose, GitHub Actions, optional Cloudflare Tunnel |
| Tooling | Python 3 + Pillow (GIF↔qgif), bash `qbit-ctl` |

---

## 11. Deployment and CI

### Self-hosting

Typical production shape:

```
Internet
  └── Cloudflare Tunnel / reverse proxy (TLS)
        ├── frontend (Nginx :80) — SPA + proxy to backend
        └── backend (Node :3001 API, :3002 admin)
```

See `web/docker-compose.yml` and `web/.env.example` (Google OAuth credentials required for user login).

### CI / CD

| Workflow | Purpose |
|----------|---------|
| `.github/workflows/build-and-release.yml` | Tag `v*` → PlatformIO build → GitHub Release |
| `.github/workflows/deploy-gh-pages.yml` | Deploy browser flasher from `tools/flasher` |

### Tools worth knowing

| Tool | Role |
|------|------|
| `tools/gif2qbit.py`, `qgif2gif.py`, `qgif2header.py`, `png2xbm.py` | Animation conversion |
| `tools/flasher/` | Web Serial flasher UI |
| `tools/simulate-devices.py` | Device simulator |
| `tools/qbit-ctl` | TUI for Docker volume / SQLite ops |

---

## 12. Entry points

| Entry | Path | Starts |
|-------|------|--------|
| Backend process | `web/backend/src/index.ts` | API :3001, admin :3002, `/device` WS, Socket.io |
| Main Express app | `web/backend/src/app.ts` | User-facing routes |
| Admin Express app | `web/backend/src/adminApp.ts` | Admin API + static UI |
| User SPA | `web/frontend/src/main.tsx` | Network / Flash / Library |
| Admin SPA | `web/admin/src/main.tsx` | Operator UI |
| Firmware | `firmware/src/main.cpp` | Device RTOS runtime |
| Local device HTTP | AsyncWebServer :80 | Captive portal + dashboard |
| Prod compose | `web/docker-compose.yml` | `qbit-backend` + `qbit-frontend` |
| Dev compose | `web/docker-compose.dev.yml` | Backend + Vite |

---

## 13. One-line summary

**QBIT = ESP32 companion (local UI + optional MQTT) + Node/React cloud (Network, Poke, Library, Flash)** — MQTT is the home-automation bridge, not the cloud poke path.

---

## Related docs

- Product features and setup: [`README.md`](../README.md)
- Traditional Chinese README: [`README.zh-TW.md`](../README.zh-TW.md)
- MQTT entity / topic details: README section **MQTT & Home Assistant**
- Self-hosting: README section **Self-Hosting the Web Platform**
