/*
 * Datenzugriff über Supabase (Auth, Datenbank, Speicher, Edge Functions).
 * Die Sicherheit liegt in der Datenbank (Row Level Security): Jede Abfrage liefert
 * nur die Zeilen des angemeldeten Benutzers.
 */

export const config = window.TODO_CONFIG || {};
export const isConfigured = Boolean(config.supabaseUrl && config.supabaseKey && window.supabase);

export const sb = isConfigured
  ? window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'todo.auth' },
    })
  : null;

const BUCKET = 'todo-images';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export class ApiError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

const MESSAGES = [
  [/Invalid login credentials/i, 'Benutzername oder Passwort ist falsch'],
  [/Failed to fetch|NetworkError|Load failed|Failed to send a request|network request failed/i, 'Keine Verbindung zum Server'],
  [/rate limit|too many|429/i, 'Zu viele Versuche. Bitte warte ein paar Minuten.'],
  [/Password should be at least|password.*(short|length)/i, 'Das Passwort muss mindestens 8 Zeichen lang sein'],
  [/should be different/i, 'Das neue Passwort muss sich vom alten unterscheiden'],
  [/JWT expired|invalid JWT|Auth session missing|refresh token|not authenticated/i, 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'],
  [/Projekt nicht gefunden/, 'Projekt nicht gefunden'],
  [/Ungültiges Push-Abo/, 'Ungültiges Push-Abo'],
  [/exceeded the maximum allowed size|payload too large|entity too large/i, 'Das Bild ist zu groß (max. 15 MB)'],
  [/mime type|invalid_mime_type/i, 'Nur Bilder (JPG, PNG, GIF, WebP, AVIF) sind erlaubt'],
  [/violates check constraint|invalid input syntax|value too long/i, 'Ungültige Eingabe'],
  [/violates row-level security|permission denied/i, 'Keine Berechtigung'],
];

const SESSION_GONE = /JWT expired|Auth session missing|Invalid Refresh Token|refresh_token_not_found|session_not_found/i;

function toError(error, fallback = 'Es ist ein Fehler aufgetreten') {
  if (error instanceof ApiError) return error;
  const raw = String(error?.message || error || '');
  const status = Number(error?.status) || (error?.code === 'PGRST301' ? 401 : 0);
  const match = MESSAGES.find(([re]) => re.test(raw));
  if (status === 401 || SESSION_GONE.test(raw)) window.dispatchEvent(new CustomEvent('auth:expired'));
  return new ApiError(match ? match[1] : fallback, { status, code: error?.code || '' });
}

function check({ data, error }) {
  if (error) throw toError(error);
  return data;
}

async function run(promise) {
  try {
    return check(await promise);
  } catch (err) {
    throw toError(err);
  }
}

// ---------------------------------------------------------------------------
// Mapping DB rows <-> app objects
// ---------------------------------------------------------------------------

export function serializeTodo(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    area: t.area,
    projectId: t.project_id,
    priority: t.priority,
    dueDate: t.due_date,
    dueTime: t.due_time,
    reminderAt: t.reminder_at,
    reminderSentAt: t.reminder_sent_at,
    reminderDismissed: !!t.reminder_dismissed,
    completed: !!t.completed_at,
    completedAt: t.completed_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    imageCount: Array.isArray(t.todo_images) ? (t.todo_images[0]?.count ?? 0) : 0,
  };
}

function todoRow(f) {
  const r = {};
  if ('title' in f) r.title = String(f.title).trim();
  if ('description' in f) r.description = String(f.description ?? '').replace(/\r\n?/g, '\n');
  if ('area' in f) r.area = f.area;
  if ('projectId' in f) r.project_id = f.projectId || null;
  if ('priority' in f) r.priority = f.priority;
  if ('dueDate' in f) r.due_date = f.dueDate || null;
  if ('dueTime' in f) r.due_time = f.dueTime || null;
  if ('reminderAt' in f) r.reminder_at = f.reminderAt || null;
  if ('reminderDismissed' in f) r.reminder_dismissed = !!f.reminderDismissed;
  if ('completed' in f) r.completed_at = f.completed ? new Date().toISOString() : null;
  return r;
}

function serializeProject(p, stat) {
  return {
    id: p.id,
    area: p.area,
    name: p.name,
    description: p.description,
    color: p.color,
    archived: !!p.archived,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    openCount: stat?.open_count ?? 0,
    doneCount: stat?.done_count ?? 0,
    overdueCount: stat?.overdue_count ?? 0,
  };
}

function projectRow(f) {
  const r = {};
  if ('name' in f) r.name = String(f.name).trim();
  if ('description' in f) r.description = String(f.description ?? '').trim();
  if ('area' in f) r.area = f.area;
  if ('color' in f) r.color = String(f.color).toLowerCase();
  if ('archived' in f) r.archived = !!f.archived;
  return r;
}

// ---------------------------------------------------------------------------
// Auth & profile
// ---------------------------------------------------------------------------

let profile = null;
let loggingOut = false;

export const usernameToEmail = (username) => `${username.trim().toLowerCase()}@${config.loginDomain || 'todo.local'}`;

function toUser(p) {
  return {
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    isAdmin: !!p.is_admin,
    mustChangePassword: !!p.must_change_password,
  };
}

async function loadProfile() {
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  const row = await run(sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle());
  if (!row) throw new ApiError('Für dieses Konto existiert kein Profil. Bitte wende dich an den Administrator.');
  profile = row;
  return toUser(row);
}

/** Returns the logged-in user or null. */
export async function currentUser() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) return null;
  return loadProfile();
}

export async function login(username, password) {
  const name = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(name) || !password) throw new ApiError('Benutzername oder Passwort ist falsch');
  try {
    check(await sb.auth.signInWithPassword({ email: usernameToEmail(name), password }));
  } catch (err) {
    throw toError(err);
  }
  return loadProfile();
}

export async function logout() {
  loggingOut = true;
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  profile = null;
}

/** Fires when the session ends without the user logging out (expired / revoked). */
export function onSessionLost(callback) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !loggingOut) callback();
  });
}

export async function changePassword(currentPassword, newPassword) {
  if (newPassword.length < 8) throw new ApiError('Das Passwort muss mindestens 8 Zeichen lang sein');
  if (newPassword.length > 72) throw new ApiError('Das Passwort ist zu lang (max. 72 Zeichen)');
  if (currentPassword === newPassword) throw new ApiError('Das neue Passwort muss sich vom alten unterscheiden');
  // Re-check the current password before changing it.
  const { error } = await sb.auth.signInWithPassword({ email: usernameToEmail(profile.username), password: currentPassword });
  if (error) {
    throw /Invalid login credentials/i.test(error.message) ? new ApiError('Das aktuelle Passwort ist falsch') : toError(error);
  }
  await run(sb.auth.updateUser({ password: newPassword }));
  await sb.auth.signOut({ scope: 'others' }).catch(() => {});
  return loadProfile();
}

export async function logoutOtherDevices() {
  await run(sb.auth.signOut({ scope: 'others' }));
}

export async function updateDisplayName(displayName) {
  const name = String(displayName || '').trim();
  if (!name) throw new ApiError('Bitte gib einen Anzeigenamen ein');
  if (name.length > 60) throw new ApiError('Anzeigename ist zu lang (max. 60 Zeichen)');
  profile = await run(sb.from('profiles').update({ display_name: name }).eq('id', profile.id).select().single());
  return toUser(profile);
}

// ---------------------------------------------------------------------------
// Settings (stored in profiles.settings)
// ---------------------------------------------------------------------------

export function getSettings() {
  const s = profile?.settings || {};
  return { dashboardArea: 'both', ...s, theme: { ...(s.theme || {}) } };
}

export async function saveSettings(patch) {
  const next = { ...(profile?.settings || {}), ...patch };
  profile = await run(sb.from('profiles').update({ settings: next }).eq('id', profile.id).select().single());
  return getSettings();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(today) {
  const [projects, stats] = await Promise.all([
    run(sb.from('projects').select('*')),
    run(sb.rpc('project_stats', { today })),
  ]);
  const byId = new Map((stats || []).map((s) => [s.project_id, s]));
  return projects
    .map((p) => serializeProject(p, byId.get(p.id)))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

export async function createProject(fields) {
  return serializeProject(await run(sb.from('projects').insert(projectRow(fields)).select().single()));
}

export async function updateProject(id, fields) {
  return serializeProject(await run(sb.from('projects').update(projectRow(fields)).eq('id', id).select().single()));
}

export async function deleteProject(id, { deleteTodos = false } = {}) {
  if (deleteTodos) {
    const todos = await run(sb.from('todos').select('id, todo_images(path)').eq('project_id', id));
    await removeFiles(todos.flatMap((t) => t.todo_images.map((i) => i.path)));
    await run(sb.from('todos').delete().eq('project_id', id));
  }
  await run(sb.from('projects').delete().eq('id', id));
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

const TODO_SELECT = '*, todo_images(count)';

/** status: open | done | all; project: id | 'none'; q: search text */
export async function listTodos({ status = 'open', area = '', project = '', q = '', limit = 2000 } = {}) {
  let query = sb.from('todos').select(TODO_SELECT);
  if (status === 'open') query = query.is('completed_at', null);
  if (status === 'done') query = query.not('completed_at', 'is', null);
  if (area) query = query.eq('area', area);
  if (project === 'none') query = query.is('project_id', null);
  else if (project) query = query.eq('project_id', Number(project));
  const term = String(q || '').trim().toLowerCase().slice(0, 100);
  if (term) query = query.ilike('search_text', `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (status === 'done') {
    query = query.order('completed_at', { ascending: false });
  } else {
    query = query
      .order('completed_at', { ascending: false, nullsFirst: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('due_time', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });
  }
  const rows = await run(query.limit(limit));
  return rows.map(serializeTodo);
}

export async function getTodo(id) {
  const row = await run(sb.from('todos').select('*, todo_images(*)').eq('id', id).maybeSingle());
  if (!row) throw new ApiError('Todo nicht gefunden', { status: 404 });
  const images = await withUrls([...row.todo_images].sort((a, b) => a.id - b.id));
  return { ...serializeTodo({ ...row, todo_images: [{ count: images.length }] }), images };
}

export async function createTodo(fields) {
  const row = await run(sb.from('todos').insert(todoRow(fields)).select(TODO_SELECT).single());
  return serializeTodo(row);
}

export async function updateTodo(id, fields) {
  const row = await run(sb.from('todos').update(todoRow(fields)).eq('id', id).select(TODO_SELECT).single());
  return serializeTodo(row);
}

export async function deleteTodo(id) {
  const images = await run(sb.from('todo_images').select('path').eq('todo_id', id));
  await removeFiles(images.map((i) => i.path));
  await run(sb.from('todos').delete().eq('id', id));
}

/** Reminders that are due and not dismissed yet. */
export async function listDueReminders() {
  const rows = await run(
    sb
      .from('todos')
      .select(TODO_SELECT)
      .lte('reminder_at', new Date().toISOString())
      .eq('reminder_dismissed', false)
      .is('completed_at', null)
      .order('reminder_at', { ascending: false })
      .limit(100),
  );
  return rows.map(serializeTodo);
}

// ---------------------------------------------------------------------------
// Images (private storage bucket, folder per user)
// ---------------------------------------------------------------------------

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' };

/** Detect the real image type from the first bytes of the file. */
async function sniffImage(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...b);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii.slice(8, 12))) return 'image/avif';
  return null;
}

function serializeImage(img, url) {
  return { id: img.id, todoId: img.todo_id, path: img.path, url, originalName: img.original_name, mimeType: img.mime_type, size: img.size, createdAt: img.created_at };
}

async function withUrls(rows) {
  if (!rows.length) return [];
  const signed = await run(sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 60 * 60 * 6));
  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => serializeImage(r, byPath.get(r.path) || ''));
}

async function removeFiles(paths) {
  if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
}

function cleanName(name) {
  return String(name || 'bild').replace(/[\u0000-\u001F\u007F/\\]/g, '').trim().slice(0, 120) || 'bild';
}

export async function uploadImages(todoId, files) {
  const prepared = [];
  for (const file of files) {
    const type = await sniffImage(file);
    if (!type) throw new ApiError(`„${cleanName(file.name)}“ ist kein unterstütztes Bild`);
    if (file.size > MAX_IMAGE_BYTES) throw new ApiError(`„${cleanName(file.name)}“ ist zu groß (max. 15 MB)`);
    prepared.push({ file, type });
  }
  const rows = [];
  for (const { file, type } of prepared) {
    const path = `${profile.id}/${crypto.randomUUID()}${EXT[type]}`;
    await run(sb.storage.from(BUCKET).upload(path, file, { contentType: type, cacheControl: '31536000', upsert: false }));
    const { data, error } = await sb
      .from('todo_images')
      .insert({ todo_id: todoId, path, original_name: cleanName(file.name), mime_type: type, size: file.size })
      .select()
      .single();
    if (error) {
      await removeFiles([path]);
      throw toError(error);
    }
    rows.push(data);
  }
  return withUrls(rows);
}

export async function deleteImage(image) {
  await run(sb.from('todo_images').delete().eq('id', image.id));
  await removeFiles([image.path]);
}

// ---------------------------------------------------------------------------
// Push notifications & Edge Functions
// ---------------------------------------------------------------------------

export async function savePushSubscription(subscription) {
  const s = subscription.toJSON();
  await run(sb.rpc('save_push_subscription', { p_endpoint: s.endpoint, p_p256dh: s.keys.p256dh, p_auth: s.keys.auth }));
}

export async function removePushSubscription(endpoint) {
  await run(sb.from('push_subscriptions').delete().eq('endpoint', endpoint));
}

async function invoke(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let message = '';
    try {
      message = (await error.context?.json())?.error || '';
    } catch {
      /* no JSON body */
    }
    const status = error.context?.status || 0;
    if (status === 401) window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError(message || toError(error, 'Der Server ist gerade nicht erreichbar').message, { status });
  }
  return data;
}

export const sendTestPush = () => invoke('send-reminders', { test: true });

export const adminUsers = {
  list: () => invoke('admin-users', { action: 'list' }),
  create: (user) => invoke('admin-users', { action: 'create', ...user }),
  update: (id, patch) => invoke('admin-users', { action: 'update', id, ...patch }),
  remove: (id) => invoke('admin-users', { action: 'delete', id }),
};
