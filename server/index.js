import { generatePassword, hashPassword } from './auth.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { cleanupOrphanUploads, now, q } from './db.js';
import { initPush } from './push.js';
import { startReminderScheduler } from './reminders.js';

/** Create the first administrator account on an empty database. */
async function ensureAdmin() {
  if (q('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const username = config.adminUsername;
  const generated = !config.adminPassword;
  const password = config.adminPassword || generatePassword();
  const displayName = config.adminDisplayName || username.charAt(0).toUpperCase() + username.slice(1);
  q(
    `INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(username, displayName, await hashPassword(password), generated ? 1 : 0, now());

  const lines = [
    'Administrator-Konto wurde angelegt:',
    `  Benutzername: ${username}`,
    generated ? `  Passwort:     ${password}` : '  Passwort:     (aus ADMIN_PASSWORD)',
    generated ? 'Bitte nach der ersten Anmeldung ändern (wird erzwungen).' : '',
  ].filter(Boolean);
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`\n${'='.repeat(width)}\n${lines.map((l) => `  ${l}`).join('\n')}\n${'='.repeat(width)}\n`);
}

await ensureAdmin();
initPush();
cleanupOrphanUploads();
startReminderScheduler();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`ToDo-App läuft auf http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
