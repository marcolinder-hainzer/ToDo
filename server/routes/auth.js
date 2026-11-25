import { Router } from 'express';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  getDummyHash,
  hashPassword,
  loginLimiter,
  publicUser,
  requireAuth,
  validateNewPassword,
  verifyPassword,
} from '../auth.js';
import { now, q } from '../db.js';
import { HttpError, body, text } from '../validate.js';

const router = Router();

router.post('/login', async (req, res) => {
  const b = body(req);
  const username = typeof b.username === 'string' ? b.username.trim().slice(0, 64) : '';
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  if (!username || !password) throw new HttpError(400, 'Bitte Benutzername und Passwort eingeben');

  const wait = loginLimiter.retryAfterMs(req.ip, username);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60000);
    res.set('Retry-After', String(Math.ceil(wait / 1000)));
    throw new HttpError(429, `Zu viele Fehlversuche. Bitte in ${minutes} Min. erneut versuchen.`, 'RATE_LIMITED');
  }

  const user = q('SELECT * FROM users WHERE username = ?').get(username);
  const ok = await verifyPassword(password, user ? user.password_hash : await getDummyHash());
  if (!user || !ok) {
    loginLimiter.fail(req.ip, username);
    throw new HttpError(401, 'Benutzername oder Passwort ist falsch', 'BAD_CREDENTIALS');
  }

  loginLimiter.success(username);
  destroySession(req); // never reuse an existing session id after login
  q('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
  const csrfToken = createSession(req, res, user.id);
  res.json({ user: publicUser(user), csrfToken });
});

router.post('/logout', (req, res) => {
  destroySession(req);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), csrfToken: req.session.csrf_token });
});

router.post('/password', requireAuth, async (req, res) => {
  const b = body(req);
  const current = typeof b.currentPassword === 'string' ? b.currentPassword : '';
  const next = validateNewPassword(b.newPassword);
  if (!(await verifyPassword(current, req.user.password_hash))) {
    throw new HttpError(400, 'Das aktuelle Passwort ist falsch', 'BAD_CREDENTIALS');
  }
  if (current === next) throw new HttpError(400, 'Das neue Passwort muss sich vom alten unterscheiden');
  q('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    await hashPassword(next),
    req.user.id,
  );
  destroyUserSessions(req.user.id, req.session.id); // log out all other devices
  const user = q('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout-others', requireAuth, (req, res) => {
  destroyUserSessions(req.user.id, req.session.id);
  res.json({ ok: true });
});

router.get('/sessions', requireAuth, (req, res) => {
  const rows = q(
    'SELECT id, created_at, last_seen_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
  ).all(req.user.id);
  res.json(
    rows.map((r) => ({
      current: r.id === req.session.id,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      userAgent: r.user_agent,
      ip: r.ip,
    })),
  );
});

router.put('/profile', requireAuth, (req, res) => {
  const displayName = text(body(req).displayName, { field: 'Anzeigename', max: 60, required: true });
  q('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user.id);
  res.json({ user: publicUser(q('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

export default router;
