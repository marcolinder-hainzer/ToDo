import fs from 'node:fs';
import path from 'node:path';

export const rootDir = path.resolve(import.meta.dirname, '..');

// Optional .env file in the project root (no extra dependency needed).
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function parseTrustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // e.g. "loopback" or a list of subnets
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data')),
  publicDir: path.join(rootDir, 'public'),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // "auto" = Secure-Cookie, sobald die Anfrage über HTTPS kommt.
  cookieSecure: (process.env.COOKIE_SECURE || 'auto').toLowerCase(),
  sessionDays: Number(process.env.SESSION_DAYS) || 30,
  adminUsername: process.env.ADMIN_USERNAME || 'marco',
  adminDisplayName: process.env.ADMIN_DISPLAY_NAME || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 15,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  reminderIntervalMs: Number(process.env.REMINDER_INTERVAL_MS) || 30_000,
};
