"use strict";
// ---------------------------------------------------------------------------
//  Security middleware -- helmet + CSRF origin check
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.helmetMiddleware = void 0;
exports.permissionsPolicyMiddleware = permissionsPolicyMiddleware;
exports.csrfOriginCheck = csrfOriginCheck;
exports.csrfOriginCheckSameOrigin = csrfOriginCheckSameOrigin;
const helmet_1 = __importDefault(require("helmet"));
const config_1 = require("../config");
const logger_1 = __importDefault(require("../logger"));
// ---------------------------------------------------------------------------
//  Helmet configuration
// ---------------------------------------------------------------------------
exports.helmetMiddleware = (0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://static.cloudflareinsights.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
            connectSrc: ["'self'", 'wss:', 'ws:', 'https://cloudflareinsights.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            objectSrc: ["'none'"],
            frameAncestors: ["'self'"],
            baseUri: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
function permissionsPolicyMiddleware(_req, res, next) {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), magnetometer=(), gyroscope=(), accelerometer=()');
    next();
}
// ---------------------------------------------------------------------------
//  CSRF origin-check middleware
// ---------------------------------------------------------------------------
function requestHostOrigin(req) {
    const hostHeader = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (!hostHeader)
        return null;
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    try {
        return new URL(`${proto}://${hostHeader}`).origin;
    }
    catch {
        return null;
    }
}
function isAllowedOrigin(requestOrigin, req) {
    if (config_1.ALLOW_ANY_ORIGIN)
        return true;
    if (config_1.ALLOWED_ORIGINS.includes(requestOrigin))
        return true;
    const hostOrigin = requestHostOrigin(req);
    return !!hostOrigin && requestOrigin === hostOrigin;
}
function csrfOriginCheck(req, res, next) {
    if (config_1.ALLOW_ANY_ORIGIN) {
        next();
        return;
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        next();
        return;
    }
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (!origin && !referer) {
        next();
        return;
    }
    let requestOrigin = '';
    try {
        requestOrigin = origin || (referer ? new URL(referer).origin : '');
    }
    catch {
        res.status(403).json({ error: 'Forbidden: origin mismatch' });
        return;
    }
    if (requestOrigin && isAllowedOrigin(requestOrigin, req)) {
        next();
        return;
    }
    logger_1.default.warn({ origin, referer, path: req.path, allowed: config_1.ALLOWED_ORIGINS, frontend: config_1.FRONTEND_URL }, 'CSRF origin check failed');
    res.status(403).json({ error: 'Forbidden: origin mismatch' });
}
/**
 * Same-origin check for admin app: only allow state-changing requests when
 * Origin or Referer matches this app's origin (protocol + host).
 * Skipped when ALLOW_ANY_ORIGIN is enabled.
 */
function csrfOriginCheckSameOrigin(req, res, next) {
    if (config_1.ALLOW_ANY_ORIGIN) {
        next();
        return;
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        next();
        return;
    }
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (!origin && !referer) {
        next();
        return;
    }
    const host = req.get('host');
    if (!host) {
        next();
        return;
    }
    const allowedOrigin = `${req.protocol}://${host}`;
    const requestOrigin = origin || (referer ? new URL(referer).origin : '');
    if (requestOrigin === allowedOrigin) {
        next();
        return;
    }
    logger_1.default.warn({ origin, referer, path: req.path }, 'Admin CSRF origin check failed');
    res.status(403).json({ error: 'Forbidden: origin mismatch' });
}
//# sourceMappingURL=security.js.map