# Cloud webcam protocol (device ↔ server ↔ browser)

Status: firmware webcam relay only. `set_animation` download/play is **out of scope** and ignored by firmware until a separate download pipeline lands.

## Board / build

- Repo ships two envs (shared flags/libs):
  - `seeed_xiao_esp32c3` — Seeed XIAO ESP32-C3
  - `esp32dev` — **classic ESP32** (`board = esp32dev`), not a C3 alias
- Hardware reviewers may keep their own `platformio.ini`; build/test against that board.

```bash
cd firmware
pio run -e esp32dev
```

## Authorization

- Browser must be logged in (Socket.io session).
- Server allows **claim owner only** (`canStreamCam`) to start/stop/frame.
- Animation grants do **not** authorize webcam.

## Device cloud WebSocket (`/device`)

### Server → device

| Message | Transport | Body |
|--------|-----------|------|
| Start | text JSON | `{"type":"cam_start"}` |
| Frame | **binary** | exactly **1024** bytes, packed 128×64 1bpp (QGIF: bit 1 = dark) |
| Stop | text JSON | `{"type":"cam_stop"}` |

Base64 `cam_frame` JSON is **not** used.

### Device → server

| Message | Body |
|--------|------|
| Accepted | `{"type":"cam_started"}` |
| Rejected / busy | `{"type":"cam_busy","message":"..."}` |
| Ended | `{"type":"cam_stopped","reason":"user_exit\|timeout\|ws_drop\|remote_stop"}` |

### Session rules (firmware)

1. Each start gets a generation **token**. Display calls `webCamConfirmFromDisplay(token, accept)` which **atomically** validates the token and activates/rejects under the cam mutex. Display enters `CAM_VIEW` **only after** a successful accept return — never before.
2. `cam_start` becomes active only from `GIF_PLAYBACK`. Games/menus → `cam_busy`.
3. Exactly one source: local `/ws_cam` **or** cloud.
4. Local frames before display approval are buffered/ignored — **client is not disconnected**.
5. Binary cloud frames ignored unless cloud session is active (no auto-restart after tap-exit).
6. Failed display-queue enqueue or pending timeout (~2s) → clear pending + `cam_busy`.
7. Failed `CAM_STOP` enqueue sets a sticky UI-exit bit; display also leaves `CAM_VIEW` when no live session remains (`webCamDisplayShouldShowCam`).
8. Cloud WS drop → `cam_stopped` / `ws_drop`. Frame watchdog: **15s** to first frame (timer resets when `cam_started` is **successfully sent** on the cloud WS), then 3s gap between frames. Timeout Serial logs `kind=first_frame|frame_gap`, `elapsed_ms`, and `accepted_frames`.
9. Browser may send frames immediately after `device:cam:start` (does not wait for `device:cam:started`); device ignores them until the session is active.
10. `networkTask` polls the cloud WebSocket **before** `webCamCloudTick()`. Blocking MQTT reconnect / timezone HTTP / version HTTPS are deferred (or postponed while cam is hot) so they cannot starve frame intake.
11. `webCamCloudTick()` also runs when the cloud WebSocket is offline (pending + timeouts).
12. Shared cam state updates go through the cam mutex; on lock timeout, state is **not** mutated.
13. Outbound notifies use a small ring queue (depth 8). Accepted cloud frames are logged from `webCamPushCloudFrame`.

## Browser ↔ server (Socket.io)

| Event | Direction | Payload |
|------|-----------|---------|
| `device:cam:start` | browser → server | `{ deviceId }` |
| `device:cam:frame` | browser → server | `{ deviceId, frame: Uint8Array(1024) }` |
| `device:cam:stop` | browser → server | `{ deviceId }` |
| `device:cam:started` | server → browser | `{ deviceId }` |
| `device:cam:stopped` | server → browser | `{ deviceId, reason, message? }` |
| `device:cam:error` | server → browser | `{ deviceId?, error }` |

Browser starts sending frames right after `device:cam:start`. `device:cam:started` updates UI only.

## Manual test matrix

- [ ] Normal stream (idle GIF → OLED updates)
- [ ] Tap to exit → browser stops; frames do not restart cam
- [ ] Close browser tab → device leaves CAM_VIEW
- [ ] Cloud WS drop → device exits cam (`ws_drop`)
- [ ] Start while in game/menu → `cam_busy`, no CAM_VIEW
- [ ] Local `qbit.local` cam + cloud start → one busy
- [ ] Rapid start/stop (cloud) → no stuck CAM_VIEW / no stale accept
- [ ] Local webcam startup with early frames → WS stays open until accept/reject
- [ ] Cancel pending start before display accept → never stuck in CAM_VIEW
- [ ] Cam timeout while cloud WS offline → pending/session still cleared
