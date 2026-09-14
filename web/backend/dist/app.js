"use strict";
// ---------------------------------------------------------------------------
//  Main Express app -- middleware wiring and route mounting
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionMiddleware = void 0;
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const passport_1 = __importDefault(require("passport"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const db_1 = require("./db");
const auth_1 = require("./auth");
const security_1 = require("./middleware/security");
const errorHandler_1 = require("./middleware/errorHandler");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const device_routes_1 = __importDefault(require("./routes/device.routes"));
const library_routes_1 = __importDefault(require("./routes/library.routes"));
const report_routes_1 = __importDefault(require("./routes/report.routes"));
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const group_routes_1 = __importDefault(require("./routes/group.routes"));
const social_routes_1 = __importDefault(require("./routes/social.routes"));
const app = (0, express_1.default)();
// ---------------------------------------------------------------------------
//  Core middleware
// ---------------------------------------------------------------------------
app.set('trust proxy', 1); // trust Cloudflare / reverse proxy
// Security headers (helmet)
app.use(security_1.helmetMiddleware);
app.use(security_1.permissionsPolicyMiddleware);
// CORS — reflect any Origin when ALLOW_ANY_ORIGIN (needed for public IP / LAN)
app.use((0, cors_1.default)({
    origin: config_1.ALLOW_ANY_ORIGIN ? true : config_1.FRONTEND_URL,
    credentials: true,
}));
// Body parsing
app.use(express_1.default.json());
// ---------------------------------------------------------------------------
//  Rate limiting (general API -- library has its own in library.routes.ts)
// ---------------------------------------------------------------------------
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.API_RATE_LIMIT.windowMs,
    max: config_1.API_RATE_LIMIT.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.originalUrl?.startsWith('/api/library') === true,
});
app.use('/api/', apiLimiter);
// ---------------------------------------------------------------------------
//  Session (SQLite-backed store)
// ---------------------------------------------------------------------------
exports.sessionMiddleware = (0, express_session_1.default)({
    store: new db_1.SQLiteSessionStore(),
    secret: config_1.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: config_1.COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: config_1.SESSION_MAX_AGE,
    },
});
app.use(exports.sessionMiddleware);
// ---------------------------------------------------------------------------
//  Passport (Google OAuth)
// ---------------------------------------------------------------------------
app.use(passport_1.default.initialize());
app.use(passport_1.default.session());
(0, auth_1.setupAuth)(passport_1.default);
// ---------------------------------------------------------------------------
//  CSRF origin check (after session/passport so user info is available)
// ---------------------------------------------------------------------------
app.use(security_1.csrfOriginCheck);
// ---------------------------------------------------------------------------
//  Routes
// ---------------------------------------------------------------------------
app.use('/auth', auth_routes_1.default);
app.use('/api', device_routes_1.default);
app.use('/api', social_routes_1.default);
app.use('/api/groups', group_routes_1.default);
app.use('/api', report_routes_1.default);
app.use('/api/library', library_routes_1.default);
app.use('/health', health_routes_1.default);
// ---------------------------------------------------------------------------
//  Global error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map