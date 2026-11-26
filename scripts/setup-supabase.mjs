// Richtet ein Supabase-Projekt für die ToDo-App vollständig ein (über die Supabase Management API).
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/setup-supabase.mjs [--name todo] [--region eu-central-1]
//       [--admin marco] [--admin-name Marco] [--site https://<user>.github.io/ToDo/] [--project <ref>]
//
// Schritte: Projekt anlegen (falls nötig) -> Datenbank (supabase/schema.sql) -> Anmeldung konfigurieren
// -> Edge Functions + Secrets -> Erinnerungs-Cronjob -> Admin-Konto -> public/config.js schreiben.
// Das Skript kann erneut ausgeführt werden; bestehende Daten bleiben erhalten.
// Erzeugte Geheimnisse (VAPID-Schlüssel, Cron-Secret) liegen lokal in .supabase-setup.json – fehlt die Datei,
// werden neue erzeugt und Geräte müssen Push-Benachrichtigungen einmal neu aktivieren.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as webpush from 'web-push';

const root = path.resolve(import.meta.dirname, '..');
const API = 'https://api.supabase.com';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || 'injected-by-proxy';
const STATE_FILE = path.join(root, '.supabase-setup.json'); // local only (gitignored)

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const opts = {
  name: args.name || 'todo',
  region: args.region || 'eu-central-1',
  admin: (args.admin || 'marco').toLowerCase(),
  adminName: args['admin-name'] || 'Marco',
  site: args.site || 'https://marcolinder-hainzer.github.io/ToDo/',
  project: args.project || '',
  loginDomain: 'todo.local',
};

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
const random = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const log = (msg) => console.log(`• ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, { form = false, allow = [] } = {}) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let payload;
  if (form) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + url, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok && !allow.includes(res.status)) {
    throw new Error(`${method} ${url} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

async function sql(ref, query) {
  const { data } = await api('POST', `/v1/projects/${ref}/database/query`, { query });
  return data;
}

async function findOrCreateProject() {
  if (opts.project) return opts.project;
  const { data: projects } = await api('GET', '/v1/projects');
  const existing = projects.find((p) => p.name === opts.name);
  if (existing) {
    log(`Projekt „${opts.name}“ existiert bereits (${existing.ref || existing.id})`);
    return existing.ref || existing.id;
  }
  const { data: orgs } = await api('GET', '/v1/organizations');
  if (!orgs?.length) throw new Error('Keine Supabase-Organisation gefunden – bitte im Dashboard eine anlegen.');
  const org = orgs[0];
  log(`Lege Projekt „${opts.name}“ in Organisation „${org.name}“ an (Region ${opts.region}) …`);
  const dbPass = random(24);
  const { data: created } = await api('POST', '/v1/projects', {
    name: opts.name,
    organization_slug: org.slug || org.id,
    region_selection: { type: 'specific', code: opts.region },
    db_pass: dbPass,
    auth_site_url: opts.site,
  });
  state.dbPassword = dbPass;
  state.ref = created.ref || created.id;
  saveState();
  return state.ref;
}

async function waitUntilReady(ref) {
  for (let i = 0; i < 90; i++) {
    const { data } = await api('GET', `/v1/projects/${ref}`);
    if (data.status === 'ACTIVE_HEALTHY') return;
    if (i % 6 === 0) log(`Warte auf Projekt (Status: ${data.status}) …`);
    await sleep(10_000);
  }
  throw new Error('Projekt wurde nicht rechtzeitig bereit');
}

async function sqlWhenReady(ref, query) {
  for (let i = 0; i < 30; i++) {
    try {
      return await sql(ref, query);
    } catch (err) {
      if (i === 29 || !/connect|timeout|starting|ECONN|503|502|not ready/i.test(err.message)) throw err;
      await sleep(10_000);
    }
  }
}

async function apiKeys(ref) {
  const { data } = await api('GET', `/v1/projects/${ref}/api-keys?reveal=true`);
  const find = (pred) => data.find(pred)?.api_key;
  const publishable = find((k) => k.type === 'publishable') || find((k) => k.name === 'anon');
  const secret = find((k) => k.type === 'secret') || find((k) => k.name === 'service_role');
  if (!publishable || !secret) throw new Error('API-Schlüssel konnten nicht gelesen werden');
  return { publishable, secret };
}

async function deployFunction(ref, slug) {
  const source = fs.readFileSync(path.join(root, 'supabase/functions', slug, 'index.ts'));
  const form = new FormData();
  form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: false }));
  form.append('file', new Blob([source], { type: 'application/typescript' }), 'index.ts');
  await api('POST', `/v1/projects/${ref}/functions/deploy?slug=${slug}`, form, { form: true });
  log(`Edge Function „${slug}“ veröffentlicht`);
}

async function createAdmin(ref, projectUrl) {
  const existing = await sql(ref, 'select count(*)::int as n from public.profiles');
  if (existing?.[0]?.n > 0) {
    log('Es gibt bereits Benutzer – Admin-Konto wird nicht neu angelegt');
    return null;
  }
  const password = `${random(9)}-${crypto.randomInt(10, 99)}`;
  const body = { action: 'bootstrap', username: opts.admin, displayName: opts.adminName, password, mustChangePassword: true };
  try {
    const res = await fetch(`${projectUrl}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-setup-token': state.setupToken },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  } catch (err) {
    // Fallback: let the database call the function (works without direct network access to the project).
    log(`Direkter Aufruf nicht möglich (${err.message}) – nutze pg_net`);
    const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
    const [{ id }] = await sql(
      ref,
      `select net.http_post(url := ${lit(`${projectUrl}/functions/v1/admin-users`)},
         headers := jsonb_build_object('Content-Type','application/json','x-setup-token',${lit(state.setupToken)}),
         body := ${lit(JSON.stringify(body))}::jsonb, timeout_milliseconds := 20000) as id`,
    );
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const rows = await sql(ref, `select status_code, content from net._http_response where id = ${Number(id)}`);
      if (rows?.length) {
        if (rows[0].status_code !== 200) throw new Error(`Admin-Konto: ${rows[0].status_code} ${rows[0].content}`);
        break;
      }
    }
  }
  const check = await sql(ref, `select username, is_admin from public.profiles where username = '${opts.admin}'`);
  if (!check?.[0]?.is_admin) throw new Error('Admin-Konto konnte nicht angelegt werden');
  return password;
}

async function main() {
  const ref = await findOrCreateProject();
  const projectUrl = `https://${ref}.supabase.co`;
  await waitUntilReady(ref);
  log(`Projekt bereit: ${projectUrl}`);

  await sqlWhenReady(ref, fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  log('Datenbank, Zugriffsregeln und Bildspeicher eingerichtet');

  try {
    await api('PATCH', `/v1/projects/${ref}/config/auth`, {
      disable_signup: true,
      external_email_enabled: true,
      mailer_autoconfirm: true,
      password_min_length: 8,
      site_url: opts.site,
      uri_allow_list: opts.site,
    });
    log('Anmeldung konfiguriert (keine Selbstregistrierung, Passwort min. 8 Zeichen)');
  } catch (err) {
    // Selbstregistrierung ist zusätzlich in der Datenbank gesperrt (siehe handle_new_user in schema.sql).
    log(`Hinweis: Auth-Einstellungen konnten nicht gesetzt werden (${err.message.slice(0, 120)}) – bitte im Dashboard „Allow new users to sign up“ ausschalten`);
    state.authConfigPending = true;
  }

  const keys = await apiKeys(ref);
  state.ref = ref;
  state.cronSecret ||= random(32);
  state.setupToken ||= random(32);
  if (!state.vapid) state.vapid = webpush.generateVAPIDKeys();
  saveState();

  await api('POST', `/v1/projects/${ref}/secrets`, [
    { name: 'TODO_SERVICE_KEY', value: keys.secret },
    { name: 'LOGIN_EMAIL_DOMAIN', value: opts.loginDomain },
    { name: 'CRON_SECRET', value: state.cronSecret },
    { name: 'SETUP_TOKEN', value: state.setupToken },
    { name: 'VAPID_PUBLIC_KEY', value: state.vapid.publicKey },
    { name: 'VAPID_PRIVATE_KEY', value: state.vapid.privateKey },
    { name: 'VAPID_SUBJECT', value: 'mailto:todo-app@example.com' },
  ]);
  log('Secrets gespeichert');

  await deployFunction(ref, 'admin-users');
  await deployFunction(ref, 'send-reminders');

  const cron = fs
    .readFileSync(path.join(root, 'supabase/cron.sql'), 'utf8')
    .replaceAll('__PROJECT_URL__', projectUrl)
    .replaceAll('__CRON_SECRET__', state.cronSecret);
  await sql(ref, cron);
  log('Erinnerungs-Cronjob aktiv (jede Minute)');

  await sleep(5000); // give freshly deployed functions a moment
  const adminPassword = await createAdmin(ref, projectUrl);

  const config = fs
    .readFileSync(path.join(root, 'public/config.js'), 'utf8')
    .replace(/supabaseUrl: '.*?'/, `supabaseUrl: '${projectUrl}'`)
    .replace(/supabaseKey: '.*?'/, `supabaseKey: '${keys.publishable}'`)
    .replace(/vapidPublicKey: '.*?'/, `vapidPublicKey: '${state.vapid.publicKey}'`);
  fs.writeFileSync(path.join(root, 'public/config.js'), config);
  log('public/config.js aktualisiert');

  console.log('\nFertig!');
  if (adminPassword) console.log(`Admin-Konto: ${opts.admin} / Start-Passwort: ${adminPassword} (muss bei der ersten Anmeldung geändert werden)`);
}

main().catch((err) => {
  console.error(`\nFehler: ${err.message}`);
  process.exit(1);
});
