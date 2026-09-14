// ---------------------------------------------------------------------------
//  Auth routes -- Google OAuth + optional local login (self-host)
// ---------------------------------------------------------------------------

import { Router } from 'express';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import {
  FRONTEND_URL,
  AUTH_RATE_LIMIT,
  LOCAL_AUTH_ENABLED,
  LOCAL_AUTH_USERNAME,
  LOCAL_AUTH_PASSWORD,
  FAILED_LOGIN_DELAY_MS,
} from '../config';
import { isBanned } from '../services/ban.service';
import { ensurePublicUserId } from '../services/publicUserId.service';
import * as userService from '../services/user.service';
import logger from '../logger';
import type { AppUser } from '../types';

const router = Router();

const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT.windowMs,
  max: AUTH_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

const oauthConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// GET /auth/providers -- which login methods are available
router.get('/providers', (_req, res) => {
  res.json({
    google: oauthConfigured,
    local: LOCAL_AUTH_ENABLED,
  });
});

// GET /auth/google -- start OAuth flow
router.get('/google', authLimiter, (req, res, next) => {
  if (!oauthConfigured) {
    return res.status(503).json({ error: 'Google OAuth is not configured' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// GET /auth/google/callback -- OAuth callback
router.get('/google/callback', (req, res, next) => {
  if (!oauthConfigured) {
    return res.redirect(FRONTEND_URL);
  }
  passport.authenticate('google', (err: Error | null, user: AppUser | false) => {
    if (err) return next(err);
    if (!user) return res.redirect(FRONTEND_URL);

    const clientIp = req.ip || req.socket?.remoteAddress || '';
    if (isBanned(user.id, clientIp)) {
      logger.info({ userId: user.id, ip: clientIp }, 'Banned user attempted login');
      return res.redirect(FRONTEND_URL + '?banned=1');
    }

    req.logIn(user, (loginErr: Error | undefined) => {
      if (loginErr) return next(loginErr);
      res.redirect(FRONTEND_URL);
    });
  })(req, res, next);
});

// POST /auth/local -- username/password login for self-hosted setups
router.post('/local', authLimiter, async (req, res, next) => {
  if (!LOCAL_AUTH_ENABLED) {
    return res.status(503).json({ error: 'Local login is not configured' });
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  // Constant-ish delay to slow brute force
  await new Promise((r) => setTimeout(r, FAILED_LOGIN_DELAY_MS));

  const userOk = timingSafeEqualString(username, LOCAL_AUTH_USERNAME);
  const passOk = timingSafeEqualString(password, LOCAL_AUTH_PASSWORD);
  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const user: AppUser = {
    id: `local:${LOCAL_AUTH_USERNAME}`,
    displayName: LOCAL_AUTH_USERNAME,
    email: '',
    avatar: '',
  };

  const clientIp = req.ip || req.socket?.remoteAddress || '';
  if (isBanned(user.id, clientIp)) {
    logger.info({ userId: user.id, ip: clientIp }, 'Banned local user attempted login');
    return res.status(403).json({ error: 'Banned' });
  }

  userService.upsertUser(user.id, {
    displayName: user.displayName,
    email: user.email,
    avatar: user.avatar,
  });

  req.logIn(user, (loginErr: Error | undefined) => {
    if (loginErr) return next(loginErr);
    res.json({
      publicUserId: ensurePublicUserId(user.id),
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
    });
  });
});

// GET /auth/me -- current user info (expose only publicUserId, not raw Google id)
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    const user = req.user as AppUser;
    res.json({
      publicUserId: ensurePublicUserId(user.id),
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect(FRONTEND_URL);
  });
});

export default router;
