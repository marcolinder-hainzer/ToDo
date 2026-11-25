// End-to-end API tests: starts the real server with a temporary data directory.
// Run with: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'Admin-Passwort-123';
let dataDir;
let server;

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

class Client {
  constructor() {
    this.cookie = '';
    this.csrf = '';
  }

  async request(method, url, { json, form, headers = {}, csrf = true } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (csrf && this.csrf && method !== 'GET') h['x-csrf-token'] = this.csrf;
    let body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const res = await fetch(BASE + url, { method, headers: h, body, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const [pair] = setCookie.split(';');
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  }

  get(url, opts) {
    return this.request('GET', url, opts);
  }
  post(url, json, opts) {
    return this.request('POST', url, { json, ...opts });
  }
  patch(url, json, opts) {
    return this.request('PATCH', url, { json, ...opts });
  }
  del(url, opts) {
    return this.request('DELETE', url, opts);
  }

  async login(username, password) {
    const res = await this.post('/api/auth/login', { username, password });
    if (res.status === 200) this.csrf = res.data.csrfToken;
    return res;
  }
}

async function startServer() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-test-'));
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ADMIN_USERNAME: 'marco',
      ADMIN_PASSWORD,
      REMINDER_INTERVAL_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stderr.on('data', (d) => (output += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server start timeout\n${output}`)), 10000);
    server.stdout.on('data', (d) => {
      output += d;
      if (output.includes('läuft auf')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', (code) => reject(new Error(`Server exited (${code})\n${output}`)));
  });
}

before(startServer);
after(() => {
  server?.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('authentication', () => {
  test('API requires login', async () => {
    const c = new Client();
    assert.equal((await c.get('/api/todos')).status, 401);
    assert.equal((await c.get('/api/auth/me')).status, 401);
    assert.equal((await c.get('/api/images/1')).status, 401);
  });

  test('wrong password is rejected, correct one works', async () => {
    const c = new Client();
    assert.equal((await c.login('marco', 'falsch-falsch')).status, 401);
    assert.equal((await c.login('nobody', 'falsch-falsch')).status, 401);
    const ok = await c.login('MARCO', ADMIN_PASSWORD); // username is case-insensitive
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.isAdmin, true);
    assert.match(c.cookie, /^todo_sid=/);
    assert.equal((await c.get('/api/auth/me')).status, 200);
  });

  test('session cookie is HttpOnly and SameSite', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'marco', password: ADMIN_PASSWORD }),
    });
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  test('state-changing requests need the CSRF token and same origin', async () => {
    const c = new Client();
    await c.login('marco', ADMIN_PASSWORD);
    const noToken = await c.post('/api/todos', { title: 'x', area: 'work' }, { csrf: false });
    assert.equal(noToken.status, 403);
    const foreign = await c.post('/api/todos', { title: 'x', area: 'work' }, { headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const ok = await c.post('/api/todos', { title: 'x', area: 'work' }, { headers: { origin: BASE } });
    assert.equal(ok.status, 201);
  });

  test('logout invalidates the session', async () => {
    const c = new Client();
    await c.login('marco', ADMIN_PASSWORD);
    const cookie = c.cookie;
    await c.post('/api/auth/logout');
    c.cookie = cookie; // replay old cookie
    assert.equal((await c.get('/api/todos')).status, 401);
  });

  test('brute force protection locks the account temporarily', async () => {
    const admin = new Client();
    await admin.login('marco', ADMIN_PASSWORD);
    await admin.post('/api/users', { username: 'bruteforce', password: 'Richtig-123', mustChangePassword: false });
    const c = new Client();
    for (let i = 0; i < 8; i++) assert.equal((await c.login('bruteforce', `falsch-${i}`)).status, 401);
    const blocked = await c.login('bruteforce', 'Richtig-123');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  });
});

describe('users & permissions', () => {
  const admin = new Client();
  const anna = new Client();

  before(async () => {
    await admin.login('marco', ADMIN_PASSWORD);
  });

  test('admin creates a user who must change the password first', async () => {
    const res = await admin.post('/api/users', { username: 'anna', displayName: 'Anna', password: 'Start-1234' });
    assert.equal(res.status, 201);
    assert.equal(res.data.mustChangePassword, true);
    assert.equal((await admin.post('/api/users', { username: 'ANNA', password: 'Start-1234' })).status, 409);
    assert.equal((await admin.post('/api/users', { username: 'a', password: 'Start-1234' })).status, 400);
    assert.equal((await admin.post('/api/users', { username: 'kurz', password: '123' })).status, 400);

    await anna.login('anna', 'Start-1234');
    const blocked = await anna.get('/api/todos');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, 'PASSWORD_CHANGE_REQUIRED');
    const changed = await anna.post('/api/auth/password', { currentPassword: 'Start-1234', newPassword: 'Anna-Geheim-99' });
    assert.equal(changed.status, 200);
    assert.equal((await anna.get('/api/todos')).status, 200);
  });

  test('non-admins cannot manage users', async () => {
    assert.equal((await anna.get('/api/users')).status, 403);
    assert.equal((await anna.post('/api/users', { username: 'evil', password: 'Evil-12345' })).status, 403);
  });

  test('admin cannot delete or demote themselves', async () => {
    const me = (await admin.get('/api/auth/me')).data.user;
    assert.equal((await admin.del(`/api/users/${me.id}`)).status, 400);
    assert.equal((await admin.patch(`/api/users/${me.id}`, { isAdmin: false })).status, 400);
  });

  test('users only see their own data', async () => {
    const project = (await admin.post('/api/projects', { name: 'Geheim', area: 'work' })).data;
    const todo = (await admin.post('/api/todos', { title: 'Nur für Marco', projectId: project.id })).data;
    const form = new FormData();
    form.append('images', new Blob([PNG], { type: 'image/png' }), 'bild.png');
    const [image] = (await admin.request('POST', `/api/todos/${todo.id}/images`, { form })).data;

    assert.equal((await anna.get(`/api/todos/${todo.id}`)).status, 404);
    assert.equal((await anna.patch(`/api/todos/${todo.id}`, { title: 'gehackt' })).status, 404);
    assert.equal((await anna.del(`/api/todos/${todo.id}`)).status, 404);
    assert.equal((await anna.get(`/api/images/${image.id}`)).status, 404);
    assert.equal((await anna.del(`/api/images/${image.id}`)).status, 404);
    assert.equal((await anna.patch(`/api/projects/${project.id}`, { name: 'x' })).status, 404);
    assert.equal((await anna.post('/api/todos', { title: 'x', projectId: project.id })).status, 400);
    const annaTodos = (await anna.get('/api/todos?status=all')).data;
    assert.equal(annaTodos.length, 0);
    const annaProjects = (await anna.get('/api/projects')).data;
    assert.equal(annaProjects.length, 0);
  });

  test('password reset by admin logs the user out', async () => {
    const users = (await admin.get('/api/users')).data;
    const annaUser = users.find((u) => u.username === 'anna');
    assert.equal((await admin.patch(`/api/users/${annaUser.id}`, { password: 'Neu-Gesetzt-1' })).status, 200);
    assert.equal((await anna.get('/api/todos')).status, 401);
  });
});

describe('todos, projects & images', () => {
  const c = new Client();
  before(async () => {
    await c.login('marco', ADMIN_PASSWORD);
  });

  test('create, update, complete and filter todos', async () => {
    const project = (await c.post('/api/projects', { name: 'Garten', area: 'private', color: '#10b981' })).data;
    const todo = (
      await c.post('/api/todos', {
        title: '  Rasen mähen  ',
        description: 'Zeile 1\nZeile 2',
        projectId: project.id,
        dueDate: '2030-05-01',
        dueTime: '10:30',
        priority: 2,
      })
    ).data;
    assert.equal(todo.title, 'Rasen mähen');
    assert.equal(todo.area, 'private'); // taken from project
    assert.equal(todo.description, 'Zeile 1\nZeile 2');

    const moved = await c.patch(`/api/todos/${todo.id}`, { area: 'work' });
    assert.equal(moved.status, 400, 'area must match project');

    const done = (await c.patch(`/api/todos/${todo.id}`, { completed: true })).data;
    assert.ok(done.completedAt);
    const open = (await c.get(`/api/todos?project=${project.id}`)).data;
    assert.equal(open.length, 0);
    const finished = (await c.get(`/api/todos?status=done&project=${project.id}`)).data;
    assert.equal(finished.length, 1);

    const search = (await c.get(`/api/todos?status=all&q=${encodeURIComponent('MÄHEN')}`)).data;
    assert.equal(search.length, 1, 'search is case-insensitive incl. umlauts');
  });

  test('input validation', async () => {
    assert.equal((await c.post('/api/todos', { title: '', area: 'work' })).status, 400);
    assert.equal((await c.post('/api/todos', { title: 'x', area: 'büro' })).status, 400);
    assert.equal((await c.post('/api/todos', { title: 'x', area: 'work', dueDate: '2030-02-30' })).status, 400);
    assert.equal((await c.post('/api/todos', { title: 'x', area: 'work', dueTime: '25:00', dueDate: '2030-01-01' })).status, 400);
    assert.equal((await c.post('/api/todos', { title: 'x', area: 'work', reminderAt: 'morgen' })).status, 400);
    assert.equal((await c.post('/api/todos', { title: 'x'.repeat(201), area: 'work' })).status, 400);
    assert.equal((await c.post('/api/projects', { name: 'x', area: 'work', color: 'red' })).status, 400);
    assert.equal((await c.get('/api/todos/abc')).status, 400);
  });

  test('images: only real images are accepted, files are deleted with the todo', async () => {
    const todo = (await c.post('/api/todos', { title: 'Mit Bild', area: 'work' })).data;

    const fake = new FormData();
    fake.append('images', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
    assert.equal((await c.request('POST', `/api/todos/${todo.id}/images`, { form: fake })).status, 415);

    const svg = new FormData();
    svg.append('images', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'x.svg');
    assert.equal((await c.request('POST', `/api/todos/${todo.id}/images`, { form: svg })).status, 415);

    const good = new FormData();
    good.append('images', new Blob([PNG], { type: 'application/octet-stream' }), 'foto.png');
    const up = await c.request('POST', `/api/todos/${todo.id}/images`, { form: good });
    assert.equal(up.status, 201);
    const [image] = up.data;
    assert.equal(image.mimeType, 'image/png');

    const file = await c.get(image.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(file.data).equals(PNG));

    const uploadsDir = path.join(dataDir, 'uploads');
    const before = fs.readdirSync(uploadsDir).filter((f) => !f.startsWith('tmp-'));
    assert.ok(before.length >= 1);
    assert.equal((await c.del(`/api/todos/${todo.id}`)).status, 200);
    await new Promise((r) => setTimeout(r, 100));
    const afterDelete = fs.readdirSync(uploadsDir).filter((f) => !f.startsWith('tmp-'));
    assert.equal(afterDelete.length, before.length - 1);
    assert.equal((await c.get(image.url)).status, 404);
  });

  test('deleting a project keeps its todos unless requested', async () => {
    const p = (await c.post('/api/projects', { name: 'Temp', area: 'work' })).data;
    const t = (await c.post('/api/todos', { title: 'Bleibt', projectId: p.id })).data;
    assert.equal((await c.del(`/api/projects/${p.id}`)).status, 200);
    const kept = (await c.get(`/api/todos/${t.id}`)).data;
    assert.equal(kept.projectId, null);

    const p2 = (await c.post('/api/projects', { name: 'Temp2', area: 'work' })).data;
    const t2 = (await c.post('/api/todos', { title: 'Weg', projectId: p2.id })).data;
    await c.del(`/api/projects/${p2.id}?deleteTodos=1`);
    assert.equal((await c.get(`/api/todos/${t2.id}`)).status, 404);
  });

  test('moving a project to the other area moves its todos', async () => {
    const p = (await c.post('/api/projects', { name: 'Wandert', area: 'work' })).data;
    const t = (await c.post('/api/todos', { title: 'Mit', projectId: p.id })).data;
    await c.patch(`/api/projects/${p.id}`, { area: 'private' });
    assert.equal((await c.get(`/api/todos/${t.id}`)).data.area, 'private');
  });

  test('reminders become due and are marked as sent by the scheduler', async () => {
    const t = (await c.post('/api/todos', { title: 'Erinnere mich', area: 'private', reminderAt: new Date(Date.now() - 1000).toISOString() })).data;
    const due = (await c.get('/api/reminders')).data;
    assert.ok(due.some((r) => r.id === t.id));
    await new Promise((r) => setTimeout(r, 1200));
    assert.ok((await c.get(`/api/todos/${t.id}`)).data.reminderSentAt);

    await c.patch(`/api/todos/${t.id}`, { reminderDismissed: true });
    assert.ok(!(await c.get('/api/reminders')).data.some((r) => r.id === t.id));

    // snoozing resets the state
    const later = new Date(Date.now() + 3600_000).toISOString();
    const snoozed = (await c.patch(`/api/todos/${t.id}`, { reminderAt: later })).data;
    assert.equal(snoozed.reminderSentAt, null);
    assert.equal(snoozed.reminderDismissed, false);
  });

  test('settings (theme) are validated and stored per user', async () => {
    const theme = { mode: 'dark', preset: 'custom', accent: '#ff0000', work: '#00ff00', private: '#0000ff', background: null, fontSize: 'large' };
    assert.equal((await c.request('PUT', '/api/settings', { json: { theme } })).status, 200);
    assert.deepEqual((await c.get('/api/settings')).data.theme, theme);
    const bad = await c.request('PUT', '/api/settings', { json: { theme: { ...theme, accent: 'javascript:alert(1)' } } });
    assert.equal(bad.status, 400);
  });
});

describe('security headers', () => {
  test('frontend is served with a strict Content-Security-Policy', async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
