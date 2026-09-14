// ---------------------------------------------------------------------------
//  Security middleware -- helmet + CSRF origin check
// ---------------------------------------------------------------------------

import helmet from 'helmet';
import { Request, Response, NextFunction } from 'express';
import { ALLOWED_ORIGINS, ALLOW_ANY_ORIGIN, FRONTEND_URL } from '../config';
import logger from '../logger';

// ---------------------------------------------------------------------------
//  Helmet configuration
// ---------------------------------------------------------------------------

export const helmetMiddleware = helmet({
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

export function permissionsPolicyMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), magnetometer=(), gyroscope=(), accelerometer=()'
  );
  next();
}

// ---------------------------------------------------------------------------
//  CSRF origin-check middleware
// ---------------------------------------------------------------------------

function requestHostOrigin(req: Request): string | null {
  const hostHeader = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!hostHeader) return null;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  try {
    return new URL(`${proto}://${hostHeader}`).origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(requestOrigin: string, req: Request): boolean {
  if (ALLOW_ANY_ORIGIN) return true;
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return true;
  const hostOrigin = requestHostOrigin(req);
  return !!hostOrigin && requestOrigin === hostOrigin;
}

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  if (ALLOW_ANY_ORIGIN) {
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
  } catch {
    res.status(403).json({ error: 'Forbidden: origin mismatch' });
    return;
  }

  if (requestOrigin && isAllowedOrigin(requestOrigin, req)) {
    next();
    return;
  }

  logger.warn(
    { origin, referer, path: req.path, allowed: ALLOWED_ORIGINS, frontend: FRONTEND_URL },
    'CSRF origin check failed'
  );
  res.status(403).json({ error: 'Forbidden: origin mismatch' });
}

/**
 * Same-origin check for admin app: only allow state-changing requests when
 * Origin or Referer matches this app's origin (protocol + host).
 * Skipped when ALLOW_ANY_ORIGIN is enabled.
 */
export function csrfOriginCheckSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (ALLOW_ANY_ORIGIN) {
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
  logger.warn({ origin, referer, path: req.path }, 'Admin CSRF origin check failed');
  res.status(403).json({ error: 'Forbidden: origin mismatch' });
}
