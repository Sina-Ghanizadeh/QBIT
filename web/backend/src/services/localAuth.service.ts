// ---------------------------------------------------------------------------
//  Local username/password accounts (register + login)
// ---------------------------------------------------------------------------

import crypto from 'crypto';
import { promisify } from 'util';
import db from '../db';
import * as userService from './user.service';
import type { AppUser } from '../types';

const scryptAsync = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const KEYLEN = 64;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export interface LocalAccountRow {
  username: string;
  userId: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

const stmtGetByUsername = db.prepare('SELECT * FROM local_accounts WHERE username = ? COLLATE NOCASE');
const stmtInsert = db.prepare(
  'INSERT INTO local_accounts (username, userId, passwordHash, salt, createdAt) VALUES (?, ?, ?, ?, ?)'
);

export function normalizeUsername(raw: string): string {
  return raw.trim();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

function toUserId(username: string): string {
  return `local:${username.toLowerCase()}`;
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await scryptAsync(password, salt, KEYLEN);
  return derived.toString('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function findByUsername(username: string): LocalAccountRow | null {
  return (stmtGetByUsername.get(normalizeUsername(username)) as LocalAccountRow | undefined) ?? null;
}

export async function registerLocalAccount(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ ok: true; user: AppUser } | { error: string; status: number }> {
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

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(input.password, salt);
  const createdAt = new Date().toISOString();
  const displayName =
    (input.displayName || '').trim().slice(0, 64) || username;

  try {
    const tx = db.transaction(() => {
      stmtInsert.run(username.toLowerCase(), userId, passwordHash, salt, createdAt);
      userService.upsertUser(userId, {
        displayName,
        email: '',
        avatar: '',
      });
    });
    tx();
  } catch {
    return { error: 'Username already taken', status: 409 };
  }

  const user = userService.getUserById(userId);
  if (!user) return { error: 'Failed to create account', status: 500 };
  return { ok: true, user };
}

export async function verifyLocalPassword(
  username: string,
  password: string
): Promise<AppUser | null> {
  const row = findByUsername(username);
  if (!row) return null;
  const candidate = await hashPassword(password, row.salt);
  if (!timingSafeEqualHex(candidate, row.passwordHash)) return null;
  return userService.getUserById(row.userId);
}