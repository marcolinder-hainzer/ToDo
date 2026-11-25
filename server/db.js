import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const uploadsDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'todo.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// Unicode-aware lower() for case-insensitive search incl. umlauts.
db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

const migrations = [
  // v1 – initial schema
  `
  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name         TEXT NOT NULL,
    password_hash        TEXT NOT NULL,
    is_admin             INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    settings             TEXT NOT NULL DEFAULT '{}',
    created_at           TEXT NOT NULL,
    last_login_at        TEXT
  );

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,          -- SHA-256 of the cookie token
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    user_agent   TEXT,
    ip           TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE projects (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    area        TEXT NOT NULL CHECK (area IN ('work', 'private')),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#6366f1',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX idx_projects_user ON projects(user_id);

  CREATE TABLE todos (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id         INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    area               TEXT NOT NULL CHECK (area IN ('work', 'private')),
    title              TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    priority           INTEGER NOT NULL DEFAULT 1 CHECK (priority IN (0, 1, 2)),
    due_date           TEXT,               -- YYYY-MM-DD (local date)
    due_time           TEXT,               -- HH:MM (local time) or NULL = all day
    reminder_at        TEXT,               -- ISO 8601 UTC
    reminder_sent_at   TEXT,
    reminder_dismissed INTEGER NOT NULL DEFAULT 0,
    completed_at       TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );
  CREATE INDEX idx_todos_user ON todos(user_id, completed_at);
  CREATE INDEX idx_todos_project ON todos(project_id);
  CREATE INDEX idx_todos_reminder ON todos(reminder_at) WHERE reminder_at IS NOT NULL;

  CREATE TABLE todo_images (
    id            INTEGER PRIMARY KEY,
    todo_id       INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name     TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size          INTEGER NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_images_todo ON todo_images(todo_id);

  CREATE TABLE push_subscriptions (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

{
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

const statements = new Map();
/** Cached prepared statement. */
export function q(sql) {
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

/** Run fn inside a transaction (not re-entrant). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();

/** Remove image files from disk (DB rows are removed by the caller / cascade). */
export function unlinkImageFiles(rows) {
  for (const row of rows) {
    fs.rm(path.join(uploadsDir, path.basename(row.file_name)), { force: true }, () => {});
  }
}

/** Delete files in the uploads folder that no longer belong to any DB row. */
export function cleanupOrphanUploads() {
  const known = new Set(q('SELECT file_name FROM todo_images').all().map((r) => r.file_name));
  const cutoff = Date.now() - 60 * 60 * 1000; // leave fresh temp files alone
  for (const name of fs.readdirSync(uploadsDir)) {
    if (known.has(name)) continue;
    const file = path.join(uploadsDir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
}
