"use strict";
// ---------------------------------------------------------------------------
//  Admin Express app -- separate session, routes, static serving
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
const db_1 = require("./db");
const security_1 = require("./middleware/security");
const errorHandler_1 = require("./middleware/errorHandler");
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const adminApp = (0, express_1.default)();
// ---------------------------------------------------------------------------
//  Core middleware
// ---------------------------------------------------------------------------
adminApp.set('trust proxy', 1);
adminApp.use(security_1.helmetMiddleware);
adminApp.use(security_1.permissionsPolicyMiddleware);
adminApp.use(express_1.default.json());
adminApp.use(security_1.csrfOriginCheckSameOrigin);
// ---------------------------------------------------------------------------
//  Session (SQLite-backed, separate cookie name)
// ---------------------------------------------------------------------------
adminApp.use((0, express_session_1.default)({
    store: new db_1.SQLiteSessionStore(),
    secret: config_1.ADMIN_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'qbit_admin_sid',
    cookie: {
        httpOnly: true,
        secure: config_1.COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: config_1.ADMIN_SESSION_MAX_AGE,
    },
}));
// ---------------------------------------------------------------------------\n//  Startup: admin credentials are auto-managed in config.ts\n// ---------------------------------------------------------------------------\n// If ADMIN_USERNAME/PASSWORD are set via environment, those are used.\n// Otherwise, random credentials are auto-generated on first startup and persisted.\n// Check logs for auto-generated credentials on first deployment.
// ---------------------------------------------------------------------------
//  Routes
// ---------------------------------------------------------------------------
// Admin API routes (login, logout, sessions, users, devices, bans, claims)
adminApp.use('/api', admin_routes_1.default);
// ---------------------------------------------------------------------------
//  Static files (admin UI built by Vite)
// ---------------------------------------------------------------------------
const adminStaticDir = path_1.default.join(__dirname, '..', 'static', 'admin');
if (fs_1.default.existsSync(adminStaticDir)) {
    adminApp.use(express_1.default.static(adminStaticDir));
    adminApp.get('*', (_req, res) => {
        res.sendFile(path_1.default.join(adminStaticDir, 'index.html'));
    });
}
else {
    adminApp.get('/', (_req, res) => {
        res.send('<p>Admin UI not built. Build the admin app and place output in backend/static/admin.</p>');
    });
}
// ---------------------------------------------------------------------------
//  Global error handler
// ---------------------------------------------------------------------------
adminApp.use(errorHandler_1.errorHandler);
exports.default = adminApp;
//# sourceMappingURL=adminApp.js.map