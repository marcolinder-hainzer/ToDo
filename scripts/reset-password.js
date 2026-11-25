// Usage:
//   npm run reset-password -- <benutzername> [neues-passwort]
//   npm run reset-password -- <benutzername> [neues-passwort] --admin   (legt Admin an, falls nicht vorhanden)
import { generatePassword, hashPassword } from '../server/auth.js';
import { now, q } from '../server/db.js';

const args = process.argv.slice(2);
const makeAdmin = args.includes('--admin');
const [username, givenPassword] = args.filter((a) => a !== '--admin');

if (!username) {
  console.log('Verwendung: npm run reset-password -- <benutzername> [neues-passwort] [--admin]');
  process.exit(1);
}
if (givenPassword && givenPassword.length < 8) {
  console.error('Das Passwort muss mindestens 8 Zeichen lang sein.');
  process.exit(1);
}

const password = givenPassword || generatePassword();
const hash = await hashPassword(password);
const user = q('SELECT * FROM users WHERE username = ?').get(username);

if (user) {
  q('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(hash, givenPassword ? 0 : 1, user.id);
  if (makeAdmin) q('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  q('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  console.log(`Passwort für „${user.username}“ wurde zurückgesetzt.`);
} else if (makeAdmin) {
  q(
    `INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(username, username, hash, givenPassword ? 0 : 1, now());
  console.log(`Administrator „${username}“ wurde angelegt.`);
} else {
  console.error(`Benutzer „${username}“ existiert nicht. Mit --admin wird er als Administrator angelegt.`);
  process.exit(1);
}
if (!givenPassword) console.log(`Neues Passwort: ${password}  (muss bei der nächsten Anmeldung geändert werden)`);
