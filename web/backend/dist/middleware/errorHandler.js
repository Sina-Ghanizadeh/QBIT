"use strict";
// ---------------------------------------------------------------------------
//  Global error-handling middleware
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const logger_1 = __importDefault(require("../logger"));
const config_1 = require("../config");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err, _req, res, _next) {
    logger_1.default.error({ err, stack: err.stack }, 'Unhandled error');
    if (res.headersSent)
        return;
    const status = err.status || 500;
    if (config_1.isProduction) {
        res.status(status).json({ error: 'Internal server error' });
    }
    else {
        res.status(status).json({ error: err.message, stack: err.stack });
    }
}
//# sourceMappingURL=errorHandler.js.map