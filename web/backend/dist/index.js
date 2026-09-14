"use strict";
// ==========================================================================
//  QBIT Backend -- Entry point
// ==========================================================================
//  This file creates the HTTP servers, wires up WebSocket and Socket.io,
//  and handles graceful shutdown.  All route / middleware logic lives in
//  app.ts, adminApp.ts, and their imported modules.
// ==========================================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const config_1 = require("./config");
const app_1 = __importStar(require("./app"));
const adminApp_1 = __importDefault(require("./adminApp"));
const deviceService = __importStar(require("./services/device.service"));
const socketService = __importStar(require("./services/socket.service"));
const telegram_bot_1 = require("./services/telegram.bot");
const db_1 = __importDefault(require("./db"));
const logger_1 = __importDefault(require("./logger"));
// ---------------------------------------------------------------------------
//  HTTP servers
// ---------------------------------------------------------------------------
const httpServer = (0, http_1.createServer)(app_1.default);
const adminHttpServer = (0, http_1.createServer)(adminApp_1.default);
// ---------------------------------------------------------------------------
//  Device WebSocket server (attaches to httpServer upgrade event)
// ---------------------------------------------------------------------------
deviceService.setupWebSocketServer(httpServer);
// ---------------------------------------------------------------------------
//  Socket.io (frontend real-time updates)
// ---------------------------------------------------------------------------
socketService.setupSocketIo(httpServer, app_1.sessionMiddleware);
// ---------------------------------------------------------------------------
//  Start servers
// ---------------------------------------------------------------------------
httpServer.listen(config_1.PORT, () => {
    logger_1.default.info({ port: config_1.PORT }, 'QBIT backend listening');
    (0, telegram_bot_1.startTelegramBot)();
});
adminHttpServer.listen(config_1.ADMIN_PORT, config_1.ADMIN_HOST, () => {
    logger_1.default.info({ port: config_1.ADMIN_PORT, host: config_1.ADMIN_HOST }, 'Admin server listening');
});
// ---------------------------------------------------------------------------
//  Graceful shutdown
// ---------------------------------------------------------------------------
let shutdownInProgress = false;
function shutdown(signal) {
    if (shutdownInProgress)
        return;
    shutdownInProgress = true;
    logger_1.default.info({ signal }, 'Graceful shutdown initiated');
    // 1. Stop accepting new connections
    httpServer.close(() => {
        logger_1.default.info('Main HTTP server closed');
    });
    adminHttpServer.close(() => {
        logger_1.default.info('Admin HTTP server closed');
    });
    // 2. Close all device WebSocket connections
    deviceService.closeAll();
    // 3. Close Socket.io
    const io = socketService.getIo();
    if (io) {
        io.close(() => {
            logger_1.default.info('Socket.io closed');
        });
    }
    // 4. Defer SQLite close until after WS 'close' handlers have fired
    //    (they synchronously write Device-offline rows; closing DB first crashes them).
    setTimeout(() => {
        try {
            db_1.default.close();
            logger_1.default.info('SQLite database closed');
        }
        catch {
            // already closed or error -- ignore
        }
        logger_1.default.info('Shutdown complete');
        process.exit(0);
    }, 3000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
//# sourceMappingURL=index.js.map