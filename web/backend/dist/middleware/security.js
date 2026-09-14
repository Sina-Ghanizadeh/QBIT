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
// Avoid logging sensitive Authorization header
const sensitiveHeaders = ['authorization', 'x-device-api-key'];
// ---------------------------------------------------------------------------
//  Helmet configuration
// ---------------------------------------------------------------------------
// Default helmet() sets X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security, X-XSS-Protection, etc.
// We customise CSP to allow Google avatar images and inline styles for React.
// Helmet middleware with custom security headers
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
    crossOriginEmbedderPolicy: false, // avoid breaking Google avatar images
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});
function permissionsPolicyMiddleware(_req, res, next) {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), magnetometer=(), gyroscope=(), accelerometer=()');
    next();
}
// ---------------------------------------------------------------------------
//  CSRF origin-check middleware
// ---------------------------------------------------------------------------
// For state-changing requests (POST / PUT / DELETE / PATCH), verify that
// the Origin or Referer header matches FRONTEND_URL.
// This prevents cross-site form submissions while allowing same-origin
// requests from the frontend.
const allowedOrigin = new URL(config_1.FRONTEND_URL).origin;
function csrfOriginCheck(req, res, next) {
    // Only check state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        next();
        return;
    }
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    // Allow requests with no origin (e.g. server-to-server, same-origin
    // navigations in some browsers, curl/Postman in dev).  The session
    // cookie's SameSite=lax already blocks cross-site cookie attachment
    // for POST, so this is an additional layer.
    if (!origin && !referer) {
        next();
        return;
    }
    const requestOrigin = origin || (referer ? new URL(referer).origin : '');
    if (requestOrigin === allowedOrigin) {
        next();
        return;
    }
    logger_1.default.warn({ origin, referer, path: req.path }, 'CSRF origin check failed');
    res.status(403).json({ error: 'Forbidden: origin mismatch' });
}
/**
 * Same-origin check for admin app: only allow state-changing requests when
 * Origin or Referer matches this app's origin (protocol + host).
 */
function csrfOriginCheckSameOrigin(req, res, next) {
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