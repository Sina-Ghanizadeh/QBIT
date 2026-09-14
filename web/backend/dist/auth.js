"use strict";
// ---------------------------------------------------------------------------
//  Passport Google OAuth setup
// ---------------------------------------------------------------------------
// Security fix: serializeUser stores only the user ID in the session.
// deserializeUser looks up the full user record from the SQLite users table.
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
exports.setupAuth = setupAuth;
const passport_google_oauth20_1 = require("passport-google-oauth20");
const userService = __importStar(require("./services/user.service"));
const logger_1 = __importDefault(require("./logger"));
function setupAuth(passport) {
    // Store only the user ID in the session (not the full user object)
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });
    // Reconstruct the full user from the database on each request
    passport.deserializeUser((id, done) => {
        const user = userService.getUserById(id);
        if (user) {
            done(null, user);
        }
        else {
            // User not found in DB -- session is stale
            done(null, false);
        }
    });
    const clientID = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientID || !clientSecret) {
        logger_1.default.warn('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set -- Google OAuth disabled');
        return;
    }
    passport.use(new passport_google_oauth20_1.Strategy({
        clientID,
        clientSecret,
        callbackURL: process.env.GOOGLE_CALLBACK_URL ||
            'https://qbit-api.labxcloud.com/auth/google/callback',
    }, (_accessToken, _refreshToken, profile, done) => {
        const user = {
            id: profile.id,
            displayName: profile.displayName,
            email: profile.emails?.[0]?.value || '',
            avatar: profile.photos?.[0]?.value || '',
        };
        // Persist / update the user in the database
        userService.upsertUser(user.id, {
            displayName: user.displayName,
            email: user.email,
            avatar: user.avatar,
        });
        done(null, user);
    }));
}
//# sourceMappingURL=auth.js.map