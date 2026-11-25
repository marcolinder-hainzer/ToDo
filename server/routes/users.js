import { Router } from 'express';
import { destroyUserSessions, hashPassword, publicUser, requireAdmin, validateNewPassword } from '../auth.js';
import { now, q, tx, unlinkImageFiles } from '../db.js';
import { HttpError, badRequest, body, bool, has, id, notFound, text } from '../validate.js';

const router = Router();
router.use(requireAdmin);

function withStats(user) {
  const stats = q(
    `SELECT COUNT(*) AS todos,
            (SELECT COUNT(*) FROM projects WHERE user_id = ?) AS projects
       FROM todos WHERE user_id = ?`,
  ).get(user.id, user.id);
  return { ...publicUser(user), todoCount: stats.todos, projectCount: stats.projects };
}

function getUser(userId) {
  const user = q('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw notFound('Benutzer nicht gefunden');
  return user;
}

function username(value) {
  const v = text(value, { field: 'Benutzername', max: 32, required: true });
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(v)) {
    throw badRequest('Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, Punkt, Binde- und Unterstrich');
  }
  return v;
}

router.get('/', (req, res) => {
  const users = q('SELECT * FROM users ORDER BY is_admin DESC, username COLLATE NOCASE').all();
  res.json(users.map(withStats));
});

router.post('/', async (req, res) => {
  const b = body(req);
  const name = username(b.username);
  const displayName = text(b.displayName, { field: 'Anzeigename', max: 60 }) || name;
  const password = validateNewPassword(b.password);
  const isAdmin = has(b, 'isAdmin') ? bool(b.isAdmin, 'Admin') : false;
  const mustChange = has(b, 'mustChangePassword') ? bool(b.mustChangePassword, 'Passwortänderung') : true;

  if (q('SELECT 1 FROM users WHERE username = ?').get(name)) {
    throw new HttpError(409, 'Dieser Benutzername ist bereits vergeben', 'CONFLICT');
  }
  const hash = await hashPassword(password);
  const result = q(
    `INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(name, displayName, hash, isAdmin ? 1 : 0, mustChange ? 1 : 0, now());
  res.status(201).json(withStats(getUser(result.lastInsertRowid)));
});

router.patch('/:id', async (req, res) => {
  const user = getUser(id(req.params.id));
  const b = body(req);
  const isSelf = user.id === req.user.id;

  const updates = {};
  if (has(b, 'displayName')) updates.display_name = text(b.displayName, { field: 'Anzeigename', max: 60, required: true });
  if (has(b, 'isAdmin')) {
    const isAdmin = bool(b.isAdmin, 'Admin');
    if (!isAdmin && user.is_admin) {
      if (isSelf) throw badRequest('Du kannst dir die Admin-Rechte nicht selbst entziehen');
      const admins = q('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
      if (admins <= 1) throw badRequest('Es muss mindestens einen Administrator geben');
    }
    updates.is_admin = isAdmin ? 1 : 0;
  }
  if (has(b, 'mustChangePassword')) updates.must_change_password = bool(b.mustChangePassword, 'Passwortänderung') ? 1 : 0;
  let resetPassword = false;
  if (has(b, 'password')) {
    updates.password_hash = await hashPassword(validateNewPassword(b.password));
    if (!has(b, 'mustChangePassword')) updates.must_change_password = isSelf ? 0 : 1;
    resetPassword = true;
  }

  const keys = Object.keys(updates);
  if (keys.length) {
    q(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...keys.map((k) => updates[k]),
      user.id,
    );
  }
  if (resetPassword) destroyUserSessions(user.id, isSelf ? req.session.id : null);
  res.json(withStats(getUser(user.id)));
});

router.delete('/:id', (req, res) => {
  const user = getUser(id(req.params.id));
  if (user.id === req.user.id) throw badRequest('Du kannst dich nicht selbst löschen');
  if (user.is_admin && q('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n <= 1) {
    throw badRequest('Es muss mindestens einen Administrator geben');
  }
  const images = tx(() => {
    const rows = q('SELECT file_name FROM todo_images WHERE user_id = ?').all(user.id);
    q('DELETE FROM users WHERE id = ?').run(user.id);
    return rows;
  });
  unlinkImageFiles(images);
  res.json({ ok: true });
});

export default router;
