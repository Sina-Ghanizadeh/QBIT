"use strict";
// ---------------------------------------------------------------------------
//  Reject banned users on state-changing API (use after auth is established)
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireNotBanned = requireNotBanned;
const ban_service_1 = require("../services/ban.service");
function requireNotBanned(req, res, next) {
    if (!req.isAuthenticated()) {
        next();
        return;
    }
    const user = req.user;
    const clientIp = req.ip || req.socket?.remoteAddress || '';
    if ((0, ban_service_1.isBanned)(user.id, clientIp)) {
        res.status(403).json({ error: 'Account or IP is banned' });
        return;
    }
    next();
}
//# sourceMappingURL=requireNotBanned.js.map