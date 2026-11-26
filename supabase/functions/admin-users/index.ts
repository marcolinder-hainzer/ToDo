// Edge Function "admin-users": Benutzerverwaltung – nur für Administratoren.
// Aufruf aus der App: supabase.functions.invoke('admin-users', { body: { action, ... } })
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('TODO_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMAIL_DOMAIN = Deno.env.get('LOGIN_EMAIL_DOMAIN') || 'todo.local';
const SETUP_TOKEN = Deno.env.get('SETUP_TOKEN') || '';
const BUCKET = 'todo-images';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-setup-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function username(value: unknown) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(v)) {
    throw new HttpError(400, 'Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, Punkt, Binde- und Unterstrich');
  }
  return v;
}

function displayName(value: unknown, fallback: string) {
  const v = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (v.length > 60) throw new HttpError(400, 'Anzeigename ist zu lang (max. 60 Zeichen)');
  return v || fallback;
}

function password(value: unknown) {
  const v = String(value ?? '');
  if (v.length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen lang sein');
  if (v.length > 72) throw new HttpError(400, 'Das Passwort ist zu lang (max. 72 Zeichen)');
  return v;
}

async function getProfile(id: string) {
  const { data, error } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Benutzer nicht gefunden');
  return data;
}

async function adminCount() {
  const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_admin', true);
  if (error) throw error;
  return count ?? 0;
}

async function createUser(body: Record<string, unknown>) {
  const name = username(body.username);
  const display = displayName(body.displayName, name);
  const pw = password(body.password);
  const isAdmin = body.isAdmin === true;
  const mustChange = body.mustChangePassword !== false;

  const email = `${name}@${EMAIL_DOMAIN}`;
  // The database only accepts new accounts that were invited here (blocks self sign-up).
  const { error: inviteError } = await admin.from('user_invites').upsert({ email, created_at: new Date().toISOString() });
  if (inviteError) throw inviteError;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
    user_metadata: { username: name, display_name: display, must_change_password: mustChange },
  });
  if (error) {
    await admin.from('user_invites').delete().eq('email', email);
    if (/already|exists|registered/i.test(error.message)) throw new HttpError(409, 'Dieser Benutzername ist bereits vergeben');
    throw new HttpError(400, `Benutzer konnte nicht angelegt werden: ${error.message}`);
  }
  const { error: upd } = await admin
    .from('profiles')
    .update({ is_admin: isAdmin, must_change_password: mustChange, display_name: display })
    .eq('id', data.user.id);
  if (upd) throw upd;
  return data.user.id;
}

async function listUsers() {
  const [{ data: profiles, error: e1 }, { data: stats, error: e2 }, { data: authData, error: e3 }] = await Promise.all([
    admin.from('profiles').select('*').order('username'),
    admin.rpc('user_stats'),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;
  const statById = new Map((stats ?? []).map((s: { user_id: string }) => [s.user_id, s]));
  const authById = new Map(authData.users.map((u) => [u.id, u]));
  return (profiles ?? [])
    .map((p) => {
      const s = statById.get(p.id) as { todo_count: number; project_count: number } | undefined;
      return {
        id: p.id,
        username: p.username,
        displayName: p.display_name,
        isAdmin: p.is_admin,
        mustChangePassword: p.must_change_password,
        createdAt: p.created_at,
        lastLoginAt: authById.get(p.id)?.last_sign_in_at ?? null,
        todoCount: Number(s?.todo_count ?? 0),
        projectCount: Number(s?.project_count ?? 0),
      };
    })
    .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.username.localeCompare(b.username));
}

async function updateUser(callerId: string, body: Record<string, unknown>) {
  const target = await getProfile(String(body.id));
  const isSelf = target.id === callerId;
  const updates: Record<string, unknown> = {};

  if ('displayName' in body) updates.display_name = displayName(body.displayName, target.display_name);
  if ('isAdmin' in body) {
    const makeAdmin = body.isAdmin === true;
    if (!makeAdmin && target.is_admin) {
      if (isSelf) throw new HttpError(400, 'Du kannst dir die Admin-Rechte nicht selbst entziehen');
      if ((await adminCount()) <= 1) throw new HttpError(400, 'Es muss mindestens einen Administrator geben');
    }
    updates.is_admin = makeAdmin;
  }
  if ('password' in body) {
    const { error } = await admin.auth.admin.updateUserById(target.id, { password: password(body.password) });
    if (error) throw new HttpError(400, `Passwort konnte nicht gesetzt werden: ${error.message}`);
    if (!isSelf) await admin.rpc('revoke_user_sessions', { target: target.id });
    // must be set after the password update (a DB trigger resets it on every password change)
    updates.must_change_password = 'mustChangePassword' in body ? body.mustChangePassword === true : !isSelf;
  } else if ('mustChangePassword' in body) {
    updates.must_change_password = body.mustChangePassword === true;
  }

  if (Object.keys(updates).length) {
    const { error } = await admin.from('profiles').update(updates).eq('id', target.id);
    if (error) throw error;
  }
}

async function deleteUser(callerId: string, body: Record<string, unknown>) {
  const target = await getProfile(String(body.id));
  if (target.id === callerId) throw new HttpError(400, 'Du kannst dich nicht selbst löschen');
  if (target.is_admin && (await adminCount()) <= 1) throw new HttpError(400, 'Es muss mindestens einen Administrator geben');

  // Remove the user's images from storage (DB rows are removed by ON DELETE CASCADE).
  for (;;) {
    const { data: files, error } = await admin.storage.from(BUCKET).list(target.id, { limit: 1000 });
    if (error || !files?.length) break;
    const { error: rmError } = await admin.storage.from(BUCKET).remove(files.map((f) => `${target.id}/${f.name}`));
    if (rmError) break;
  }
  const { error } = await admin.auth.admin.deleteUser(target.id);
  if (error) throw new HttpError(400, `Benutzer konnte nicht gelöscht werden: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Methode nicht erlaubt' }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // One-time setup: create the first administrator (only while no user exists).
    if (body.action === 'bootstrap') {
      if (!SETUP_TOKEN || !safeEqual(req.headers.get('x-setup-token') ?? '', SETUP_TOKEN)) {
        throw new HttpError(403, 'Nicht erlaubt');
      }
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
      if ((count ?? 0) > 0) throw new HttpError(409, 'Es gibt bereits Benutzer');
      const id = await createUser({ ...body, isAdmin: true });
      return json({ ok: true, id });
    }

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth?.user) throw new HttpError(401, 'Bitte melde dich an');
    const caller = await getProfile(auth.user.id);
    if (!caller.is_admin) throw new HttpError(403, 'Nur für Administratoren');

    switch (body.action) {
      case 'list':
        return json(await listUsers());
      case 'create':
        await createUser(body);
        return json({ ok: true }, 201);
      case 'update':
        await updateUser(caller.id, body);
        return json({ ok: true });
      case 'delete':
        await deleteUser(caller.id, body);
        return json({ ok: true });
      default:
        throw new HttpError(400, 'Unbekannte Aktion');
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Interner Fehler' }, 500);
  }
});
