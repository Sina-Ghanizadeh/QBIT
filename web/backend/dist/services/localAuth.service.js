"use strict";
// ---------------------------------------------------------------------------
//  Local username/password accounts (register + login)
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
exports.normalizeUsername = normalizeUsername;
exports.isValidUsername = isValidUsername;
exports.findByUsername = findByUsername;
exports.registerLocalAccount = registerLocalAccount;
exports.verifyLocalPassword = verifyLocalPassword;
const crypto_1 = __importDefault(require("crypto"));
const util_1 = require("util");
const db_1 = __importDefault(require("../db"));
const userService = __importStar(require("./user.service"));
const scryptAsync = (0, util_1.promisify)(crypto_1.default.scrypt);
const KEYLEN = 64;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const stmtGetByUsername = db_1.default.prepare('SELECT * FROM local_accounts WHERE username = ? COLLATE NOCASE');
const stmtInsert = db_1.default.prepare('INSERT INTO local_accounts (username, userId, passwordHash, salt, createdAt) VALUES (?, ?, ?, ?, ?)');
function normalizeUsername(raw) {
    return raw.trim();
}
function isValidUsername(username) {
    return USERNAME_RE.test(username);
}
function toUserId(username) {
    return `local:${username.toLowerCase()}`;
}
async function hashPassword(password, salt) {
    const derived = await scryptAsync(password, salt, KEYLEN);
    return derived.toString('hex');
}
function timingSafeEqualHex(a, b) {
    try {
        const ba = Buffer.from(a, 'hex');
        const bb = Buffer.from(b, 'hex');
        if (ba.length !== bb.length)
            return false;
        return crypto_1.default.timingSafeEqual(ba, bb);
    }
    catch {
        return false;
    }
}
function findByUsername(username) {
    return stmtGetByUsername.get(normalizeUsername(username)) ?? null;
}
async function registerLocalAccount(input) {
    const username = normalizeUsername(input.username);
    if (!isValidUsername(username)) {
        return {
            error: 'Username must be 3-32 characters: letters, numbers, underscore',
            status: 400,
        };
    }
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) {
        return { error: 'Password must be 8-128 characters', status: 400 };
    }
    if (findByUsername(username)) {
        return { error: 'Username already taken', status: 409 };
    }
    const userId = toUserId(username);
    if (userService.getUserById(userId)) {
        return { error: 'Username already taken', status: 409 };
    }
    const salt = crypto_1.default.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(input.password, salt);
    const createdAt = new Date().toISOString();
    const displayName = (input.displayName || '').trim().slice(0, 64) || username;
    try {
        const tx = db_1.default.transaction(() => {
            stmtInsert.run(username.toLowerCase(), userId, passwordHash, salt, createdAt);
            userService.upsertUser(userId, {
                displayName,
                email: '',
                avatar: '',
            });
        });
        tx();
    }
    catch {
        return { error: 'Username already taken', status: 409 };
    }
    const user = userService.getUserById(userId);
    if (!user)
        return { error: 'Failed to create account', status: 500 };
    return { ok: true, user };
}
async function verifyLocalPassword(username, password) {
    const row = findByUsername(username);
    if (!row)
        return null;
    const candidate = await hashPassword(password, row.salt);
    if (!timingSafeEqualHex(candidate, row.passwordHash))
        return null;
    return userService.getUserById(row.userId);
}
//# sourceMappingURL=localAuth.service.js.map