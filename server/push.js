import * as webpush from 'web-push';
import { config } from './config.js';
import { now, q } from './db.js';

let publicKey = null;

export function initPush() {
  const row = q("SELECT value FROM app_settings WHERE key = 'vapid'").get();
  let keys;
  if (row) {
    keys = JSON.parse(row.value);
  } else {
    keys = webpush.generateVAPIDKeys();
    q("INSERT INTO app_settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  }
  webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;
}

export const getPublicKey = () => publicKey;

export function saveSubscription(userId, sub) {
  q(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, now());
}

export function removeSubscription(userId, endpoint) {
  q('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

/** Send a notification to every registered device of a user. Returns { sent, failed }. */
export async function sendPushToUser(userId, payload) {
  const subs = q('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 24 * 60 * 60, urgency: 'high', topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
      ),
    ),
  );
  let sent = 0;
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sent++;
      return;
    }
    failed++;
    const status = r.reason?.statusCode;
    if (status === 404 || status === 410) {
      q('DELETE FROM push_subscriptions WHERE id = ?').run(subs[i].id); // subscription expired
    } else {
      console.warn(`[push] Senden fehlgeschlagen (${status ?? r.reason?.message ?? 'unbekannt'})`);
    }
  });
  return { sent, failed, devices: subs.length };
}
