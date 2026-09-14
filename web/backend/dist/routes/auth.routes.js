"use strict";
// ---------------------------------------------------------------------------
//  Auth routes -- Google OAuth + local login/register
// ---------------------------------------------------------------------------
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
const express_1 = require("express");
const passport_1 = __importDefault(require("passport"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("../config");
const ban_service_1 = require("../services/ban.service");
const publicUserId_service_1 = require("../services/publicUserId.service");
const userService = __importStar(require("../services/user.service"));
const localAuth = __importStar(require("../services/localAuth.service"));
const logger_1 = __importDefault(require("../logger"));
const router = (0, express_1.Router)();
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.AUTH_RATE_LIMIT.windowMs,
    max: config_1.AUTH_RATE_LIMIT.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later.' },
});
const oauthConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
function timingSafeEqualString(a, b) {
    if (a.length !== b.length)
        return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}
function sessionUserPayload(user) {
    return {
        publicUserId: (0, publicUserId_service_1.ensurePublicUserId)(user.id),
        displayName: user.displayName,
        email: user.email,
        avatar: user.avatar,
    };
}
// GET /auth/providers -- which login methods are available
router.get('/providers', (_req, res) => {
    res.json({
        google: oauthConfigured,
        local: config_1.LOCAL_AUTH_AVAILABLE,
        register: config_1.LOCAL_REGISTRATION_ENABLED,
    });
});
// GET /auth/google -- start OAuth flow
router.get('/google', authLimiter, (req, res, next) => {
    if (!oauthConfigured) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }
    passport_1.default.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
// GET /auth/google/callback -- OAuth callback
router.get('/google/callback', (req, res, next) => {
    if (!oauthConfigured) {
        return res.redirect(config_1.FRONTEND_URL);
    }
    passport_1.default.authenticate('google', (err, user) => {
        if (err)
            return next(err);
        if (!user)
            return res.redirect(config_1.FRONTEND_URL);
        const clientIp = req.ip || req.socket?.remoteAddress || '';
        if ((0, ban_service_1.isBanned)(user.id, clientIp)) {
            logger_1.default.info({ userId: user.id, ip: clientIp }, 'Banned user attempted login');
            return res.redirect(config_1.FRONTEND_URL + '?banned=1');
        }
        req.logIn(user, (loginErr) => {
            if (loginErr)
                return next(loginErr);
            res.redirect(config_1.FRONTEND_URL);
        });
    })(req, res, next);
});
// POST /auth/register -- create a local username/password account
router.post('/register', authLimiter, async (req, res, next) => {
    if (!config_1.LOCAL_REGISTRATION_ENABLED) {
        return res.status(503).json({ error: 'Registration is disabled' });
    }
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;
    await new Promise((r) => setTimeout(r, config_1.FAILED_LOGIN_DELAY_MS));
    const result = await localAuth.registerLocalAccount({ username, password, displayName });
    if ('error' in result) {
        return res.status(result.status).json({ error: result.error });
    }
    const clientIp = req.ip || req.socket?.remoteAddress || '';
    if ((0, ban_service_1.isBanned)(result.user.id, clientIp)) {
        return res.status(403).json({ error: 'Banned' });
    }
    req.logIn(result.user, (loginErr) => {
        if (loginErr)
            return next(loginErr);
        logger_1.default.info({ userId: result.user.id }, 'Local user registered');
        res.status(201).json(sessionUserPayload(result.user));
    });
});
// POST /auth/local -- username/password login (DB accounts, then optional env bootstrap)
router.post('/local', authLimiter, async (req, res, next) => {
    if (!config_1.LOCAL_AUTH_AVAILABLE) {
        return res.status(503).json({ error: 'Local login is not configured' });
    }
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    await new Promise((r) => setTimeout(r, config_1.FAILED_LOGIN_DELAY_MS));
    let user = await localAuth.verifyLocalPassword(username, password);
    if (!user && config_1.LOCAL_AUTH_ENABLED) {
        const userOk = timingSafeEqualString(username, config_1.LOCAL_AUTH_USERNAME);
        const passOk = timingSafeEqualString(password, config_1.LOCAL_AUTH_PASSWORD);
        if (userOk && passOk) {
            user = {
                id: `local:${config_1.LOCAL_AUTH_USERNAME}`,
                displayName: config_1.LOCAL_AUTH_USERNAME,
                email: '',
                avatar: '',
            };
            userService.upsertUser(user.id, {
                displayName: user.displayName,
                email: user.email,
                avatar: user.avatar,
            });
        }
    }
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    const clientIp = req.ip || req.socket?.remoteAddress || '';
    if ((0, ban_service_1.isBanned)(user.id, clientIp)) {
        logger_1.default.info({ userId: user.id, ip: clientIp }, 'Banned local user attempted login');
        return res.status(403).json({ error: 'Banned' });
    }
    req.logIn(user, (loginErr) => {
        if (loginErr)
            return next(loginErr);
        res.json(sessionUserPayload(user));
    });
});
// GET /auth/me -- current user info (expose only publicUserId, not raw Google id)
router.get('/me', (req, res) => {
    if (req.isAuthenticated()) {
        const user = req.user;
        res.json(sessionUserPayload(user));
    }
    else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});
// GET /auth/logout
router.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect(config_1.FRONTEND_URL);
    });
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map