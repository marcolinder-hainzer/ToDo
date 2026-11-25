import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { q, now } from './db.js';
import { HttpError } from './validate.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };
const MAXMEM = 128 * 1024 * 1024;
const KEYLEN = 64;

export const SESSION_COOKIE = 'todo_sid';
export const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// Passwords (scrypt, per-user salt, constant-time comparison)
// ---------------------------------------------------------------------------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

let dummyHash;
/** Used when a username does not exist, so response timing does not reveal valid usernames. */
export async function getDummyHash() {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`, 'WEAK_PASSWORD');
  }
  if (password.length > 200) throw new HttpError(400, 'Das Passwort ist zu lang', 'WEAK_PASSWORD');
  return password;
}

export function generatePassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ---------------------------------------------------------------------------
// Sessions (random token in an HttpOnly cookie, only its SHA-256 hash is stored)
// ---------------------------------------------------------------------------

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sessionMs = () => config.sessionDays * 24 * 60 * 60 * 1000;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function cookieOptions(req) {
  const secure = config.cookieSecure === 'true' ? true : config.cookieSecure === 'false' ? false : req.secure;
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: sessionMs() });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const ts = now();
  q(`INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sha256(token),
    userId,
    csrfToken,
    ts,
    ts,
    new Date(Date.now() + sessionMs()).toISOString(),
    String(req.get('user-agent') || '').slice(0, 300),
    String(req.ip || '').slice(0, 64),
  );
  setSessionCookie(req, res, token);
  return csrfToken;
}

export function destroySession(req) {
  if (req.session) q('DELETE FROM sessions WHERE id = ?').run(req.session.id);
}

export function destroyUserSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) q('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
  else q('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function cleanupExpiredSessions() {
  q('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

/** Attaches req.session and req.user if a valid session cookie is present. */
export function sessionMiddleware(req, res, next) {
  const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
  if (!token || token.length > 100) return next();

  const session = q('SELECT * FROM sessions WHERE id = ?').get(sha256(token));
  if (!session) return next();
  if (session.expires_at < now()) {
    q('DELETE FROM sessions WHERE id = ?').run(session.id);
    clearSessionCookie(req, res);
    return next();
  }
  const user = q('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return next();

  // Sliding expiration, refreshed at most once per hour.
  if (Date.now() - Date.parse(session.last_seen_at) > 60 * 60 * 1000) {
    q('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
      now(),
      new Date(Date.now() + sessionMs()).toISOString(),
      session.id,
    );
    setSessionCookie(req, res, token);
  }

  req.session = session;
  req.user = user;
  next();
}

const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout']);

export function requireAuth(req, res, next) {
  if (!req.user) throw new HttpError(401, 'Bitte melde dich an', 'UNAUTHENTICATED');
  if (req.user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(req.baseUrl + req.path)) {
    throw new HttpError(403, 'Bitte ändere zuerst dein Passwort', 'PASSWORD_CHANGE_REQUIRED');
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) throw new HttpError(403, 'Nur für Administratoren', 'FORBIDDEN');
  next();
}

// ---------------------------------------------------------------------------
// CSRF: same-origin check + per-session token in a custom header
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser clients; CSRF token still required below
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Ungültige Herkunft der Anfrage', 'BAD_ORIGIN');
  }
  const hosts = [req.get('host')];
  if (config.trustProxy) hosts.push(req.get('x-forwarded-host'));
  if (hosts.includes(originHost) || config.allowedOrigins.includes(origin)) return next();
  throw new HttpError(403, 'Ungültige Herkunft der Anfrage', 'BAD_ORIGIN');
}

export function csrfCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method) || !req.session) return next();
  const header = String(req.get('x-csrf-token') || '');
  const expected = req.session.csrf_token;
  const ok =
    header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  if (!ok) throw new HttpError(403, 'Sicherheitstoken ungültig – bitte Seite neu laden', 'BAD_CSRF');
  next();
}

// ---------------------------------------------------------------------------
// Brute-force protection for the login
// ---------------------------------------------------------------------------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER = 8;
const MAX_PER_IP = 30;
const failures = new Map();

function recent(key) {
  const t = Date.now();
  const list = (failures.get(key) || []).filter((ts) => t - ts < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

export const loginLimiter = {
  retryAfterMs(ip, username) {
    const byUser = recent(`u:${username.toLowerCase()}`);
    const byIp = recent(`ip:${ip}`);
    const blocked = [];
    if (byUser.length >= MAX_PER_USER) blocked.push(byUser[byUser.length - MAX_PER_USER]);
    if (byIp.length >= MAX_PER_IP) blocked.push(byIp[byIp.length - MAX_PER_IP]);
    if (!blocked.length) return 0;
    return Math.max(...blocked.map((ts) => ts + WINDOW_MS - Date.now()));
  },
  fail(ip, username) {
    for (const key of [`u:${username.toLowerCase()}`, `ip:${ip}`]) {
      const list = recent(key);
      list.push(Date.now());
      failures.set(key, list);
    }
  },
  success(username) {
    failures.delete(`u:${username.toLowerCase()}`);
  },
};

// Keep the map from growing forever.
setInterval(() => {
  for (const key of failures.keys()) recent(key);
}, WINDOW_MS).unref();

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    isAdmin: !!user.is_admin,
    mustChangePassword: !!user.must_change_password,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}
