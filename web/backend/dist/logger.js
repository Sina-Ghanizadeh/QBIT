"use strict";
// ---------------------------------------------------------------------------
//  Structured logger (pino)
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("./config");
const isDev = config_1.NODE_ENV === 'development';
// Check if pino-pretty is available (it is a devDependency and may not be
// installed in production / Docker runtime images).
let hasPinoPretty = false;
if (isDev) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('pino-pretty');
        hasPinoPretty = true;
    }
    catch {
        // pino-pretty not installed -- use plain JSON output
    }
}
exports.logger = (0, pino_1.default)({
    level: isDev ? 'debug' : 'info',
    serializers: {
        req: (req) => {
            // SanitizeHeaders: remove sensitive fields before logging
            const headers = { ...req.headers };
            if (headers.authorization)
                delete headers.authorization;
            if (headers['x-device-api-key'])
                delete headers['x-device-api-key'];
            return {
                method: req.method,
                url: req.url,
                headers: headers,
            };
        },
    },
    ...(hasPinoPretty
        ? {
            transport: {
                target: 'pino-pretty',
                options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
        }
        : {}),
});
exports.default = exports.logger;
//# sourceMappingURL=logger.js.map