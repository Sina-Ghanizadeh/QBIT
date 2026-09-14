"use strict";
// ---------------------------------------------------------------------------
//  Centralised configuration -- all environment variables read here
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProduction = exports.NODE_ENV = exports.TELEGRAM_BOT_USERNAME = exports.TELEGRAM_BOT_TOKEN = exports.ADMIN_PASSWORD_MAX_LEN = exports.ADMIN_PASSWORD_MIN_LEN = exports.ADMIN_USERNAME_MAX_LEN = exports.FAILED_LOGIN_DELAY_MS = exports.ADMIN_LOGIN_RATE_LIMIT = exports.AUTH_RATE_LIMIT = exports.LIBRARY_RATE_LIMIT = exports.API_RATE_LIMIT = exports.ADMIN_SESSION_MAX_AGE = exports.SESSION_MAX_AGE = exports.MAX_QGIF_SIZE = exports.MAX_DEVICE_CONNECTIONS_PER_IP = exports.MAX_DEVICE_CONNECTIONS = exports.DEVICE_API_KEY = exports.ADMIN_PASSWORD = exports.ADMIN_USERNAME = exports.HEALTH_SECRET = exports.ADMIN_SESSION_SECRET = exports.SESSION_SECRET = exports.LIBRARY_DIR = exports.LOCAL_AUTH_AVAILABLE = exports.LOCAL_REGISTRATION_ENABLED = exports.LOCAL_AUTH_ENABLED = exports.LOCAL_AUTH_PASSWORD = exports.LOCAL_AUTH_USERNAME = exports.COOKIE_SECURE = exports.IS_LOCAL_DEV = exports.COOKIE_DOMAIN = exports.FRONTEND_URL = exports.ADMIN_HOST = exports.ADMIN_PORT = exports.PORT = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const NODE_ENV = process.env.NODE_ENV || 'development';
exports.NODE_ENV = NODE_ENV;
const isProduction = NODE_ENV === 'production';
exports.isProduction = isProduction;
// ---- Main app ----
exports.PORT = parseInt(process.env.PORT || '3001', 10);
exports.ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '3002', 10);
exports.ADMIN_HOST = process.env.ADMIN_HOST || '127.0.0.1';
exports.FRONTEND_URL = process.env.FRONTEND_URL || 'https://qbit.labxcloud.com';
exports.COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.labxcloud.com';
exports.IS_LOCAL_DEV = exports.COOKIE_DOMAIN === 'localhost';
// Secure cookies only when the frontend is served over HTTPS (works for http://IP self-host).
exports.COOKIE_SECURE = exports.FRONTEND_URL.startsWith('https://');
// Optional local username/password login for self-hosted setups without Google OAuth.
// Enabled when both LOCAL_AUTH_USERNAME and LOCAL_AUTH_PASSWORD are set.
exports.LOCAL_AUTH_USERNAME = (process.env.LOCAL_AUTH_USERNAME || '').trim();
exports.LOCAL_AUTH_PASSWORD = (process.env.LOCAL_AUTH_PASSWORD || '').trim();
exports.LOCAL_AUTH_ENABLED = exports.LOCAL_AUTH_USERNAME.length > 0 && exports.LOCAL_AUTH_PASSWORD.length >= 8;
// Allow users to self-register local accounts (default: on). Set to "false" to disable.
exports.LOCAL_REGISTRATION_ENABLED = (process.env.LOCAL_REGISTRATION_ENABLED || 'true').trim().toLowerCase() !== 'false';
// Local auth UI/API available if env bootstrap account OR registration is enabled
exports.LOCAL_AUTH_AVAILABLE = exports.LOCAL_AUTH_ENABLED || exports.LOCAL_REGISTRATION_ENABLED;
// ---- Data / library ----
exports.LIBRARY_DIR = process.env.LIBRARY_DIR || '/data';
const SECRETS_PATH = path_1.default.join(exports.LIBRARY_DIR, 'secrets.json');
function loadPersistedSecrets() {
    try {
        return JSON.parse(fs_1.default.readFileSync(SECRETS_PATH, 'utf-8'));
    }
    catch {
        return {};
    }
}
function savePersistedSecrets(secrets) {
    fs_1.default.mkdirSync(path_1.default.dirname(SECRETS_PATH), { recursive: true });
    fs_1.default.writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2), { mode: 0o600 });
}
// Generate a random password: 16 alphanumeric characters
function generateRandomPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < 16; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}
// Generate a random username: "qbit_" + 8 hex chars
function generateRandomUsername() {
    return 'qbit_' + crypto_1.default.randomBytes(4).toString('hex');
}
function resolveSecret(envValue, persistedValue, label) {
    // 1. Env var takes priority
    if (envValue) {
        return { value: envValue, source: 'env' };
    }
    // 2. Previously persisted value
    if (persistedValue) {
        return { value: persistedValue, source: 'persisted' };
    }
    // 3. Generate new
    const generated = crypto_1.default.randomBytes(32).toString('hex');
    // eslint-disable-next-line no-console
    console.log(`[config] Auto-generated ${label} (persisted to secrets.json)`);
    return { value: generated, source: 'generated' };
}
// Resolve all three secrets
const persisted = loadPersistedSecrets();
const sessionResult = resolveSecret(process.env.SESSION_SECRET, persisted.sessionSecret, 'SESSION_SECRET');
const adminSessionResult = resolveSecret(process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET, persisted.adminSessionSecret, 'ADMIN_SESSION_SECRET');
const healthResult = resolveSecret(process.env.HEALTH_SECRET, persisted.healthSecret, 'HEALTH_SECRET');
// Persist any newly generated values back to disk
if (sessionResult.source === 'generated' || adminSessionResult.source === 'generated' || healthResult.source === 'generated') {
    savePersistedSecrets({
        sessionSecret: sessionResult.value,
        adminSessionSecret: adminSessionResult.value,
        healthSecret: healthResult.value,
    });
}
exports.SESSION_SECRET = sessionResult.value;
exports.ADMIN_SESSION_SECRET = adminSessionResult.value;
exports.HEALTH_SECRET = healthResult.value;
// ---- Admin credentials (auto-generate if not provided) ----
// If ADMIN_USERNAME and ADMIN_PASSWORD are not set via environment variables,
// they are auto-generated on first startup and persisted to secrets.json
const adminCredsEnv = loadPersistedSecrets();
let adminUsernameGenerated = false;
let adminPasswordGenerated = false;
let adminUsername = (process.env.ADMIN_USERNAME || '').trim();
if (!adminUsername) {
    adminUsername = adminCredsEnv.adminUsername || generateRandomUsername();
    if (!adminCredsEnv.adminUsername) {
        adminUsernameGenerated = true;
    }
}
let adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
if (!adminPassword) {
    adminPassword = adminCredsEnv.adminPassword || generateRandomPassword();
    if (!adminCredsEnv.adminPassword) {
        adminPasswordGenerated = true;
    }
}
// Persist newly generated credentials
if (adminUsernameGenerated || adminPasswordGenerated) {
    const toMerge = {
        sessionSecret: sessionResult.value,
        adminSessionSecret: adminSessionResult.value,
        healthSecret: healthResult.value,
        adminUsername,
        adminPassword,
    };
    savePersistedSecrets(toMerge);
    // Log the auto-generated credentials (only on first startup)
    // eslint-disable-next-line no-console
    console.log('\n========= AUTO-GENERATED ADMIN CREDENTIALS =========');
    // eslint-disable-next-line no-console
    console.log(`Username: ${adminUsername}`);
    // eslint-disable-next-line no-console
    console.log(`Password: ${adminPassword}`);
    // eslint-disable-next-line no-console
    console.log('====================================================');
    // eslint-disable-next-line no-console
    console.log('⚠️  Save these credentials securely. They are persisted in /data/secrets.json');
    // eslint-disable-next-line no-console
    console.log('====================================================\n');
}
exports.ADMIN_USERNAME = adminUsername;
exports.ADMIN_PASSWORD = adminPassword;
// ---- Device WebSocket ----
exports.DEVICE_API_KEY = process.env.DEVICE_API_KEY || '';
exports.MAX_DEVICE_CONNECTIONS = parseInt(process.env.MAX_DEVICE_CONNECTIONS || '100', 10);
// Max QBIT devices per single IP (0 = unlimited). Applies to device WebSocket, not web users.
exports.MAX_DEVICE_CONNECTIONS_PER_IP = parseInt(process.env.MAX_DEVICE_CONNECTIONS_PER_IP || '0', 10);
// ---- Limits ----
exports.MAX_QGIF_SIZE = 512 * 1024; // 512 KB per file
exports.SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
exports.ADMIN_SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
// ---- Rate limiting ----
exports.API_RATE_LIMIT = { windowMs: 1 * 60 * 1000, max: 60 };
exports.LIBRARY_RATE_LIMIT = { windowMs: 1 * 60 * 1000, max: 300 };
exports.AUTH_RATE_LIMIT = { windowMs: 5 * 60 * 1000, max: 15 };
exports.ADMIN_LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 20 };
// ---- Misc ----
exports.FAILED_LOGIN_DELAY_MS = 800;
exports.ADMIN_USERNAME_MAX_LEN = 64;
exports.ADMIN_PASSWORD_MIN_LEN = 8;
exports.ADMIN_PASSWORD_MAX_LEN = 128;
// ---- Telegram bot (optional) ----
exports.TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
exports.TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '').trim();
//# sourceMappingURL=config.js.map