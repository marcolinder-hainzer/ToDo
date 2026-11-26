// Edge Function "send-reminders": verschickt fällige Erinnerungen als Web-Push.
// Wird jede Minute von pg_cron aufgerufen (Header x-cron-secret) und kann von
// einem angemeldeten Benutzer mit { test: true } für eine Test-Benachrichtigung genutzt werden.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('TODO_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Payload = { title: string; body: string; url: string; tag: string };

async function pushToUser(userId: string, payload: Payload) {
  const { data: subs, error } = await admin.from('push_subscriptions').select('*').eq('user_id', userId);
  if (error) throw error;
  let sent = 0;
  let failed = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 24 * 60 * 60, urgency: 'high' },
      );
      sent++;
    } catch (err) {
      failed++;
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id); // subscription expired
      } else {
        console.warn('push failed', status ?? (err as Error).message);
      }
    }
  }
  return { sent, failed, devices: subs?.length ?? 0 };
}

function formatDue(date: string | null, time: string | null) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `Fällig am ${d}.${m}.${y}${time ? `, ${time} Uhr` : ''}`;
}

async function sendDueReminders() {
  const now = new Date().toISOString();
  const { data: due, error } = await admin
    .from('todos')
    .select('id, user_id, title, description, area, due_date, due_time, projects(name)')
    .lte('reminder_at', now)
    .is('reminder_sent_at', null)
    .eq('reminder_dismissed', false)
    .is('completed_at', null)
    .order('reminder_at')
    .limit(100);
  if (error) throw error;

  let notified = 0;
  for (const todo of due ?? []) {
    // Claim the reminder first so it is never sent twice.
    const { data: claimed } = await admin
      .from('todos')
      .update({ reminder_sent_at: now })
      .eq('id', todo.id)
      .is('reminder_sent_at', null)
      .select('id');
    if (!claimed?.length) continue;
    const project = (todo.projects as { name?: string } | null)?.name;
    const parts = [todo.area === 'work' ? 'Beruflich' : 'Privat', project, formatDue(todo.due_date, todo.due_time)].filter(Boolean);
    await pushToUser(todo.user_id, {
      title: todo.title,
      body: parts.join(' · ') + (todo.description ? `\n${String(todo.description).slice(0, 140)}` : ''),
      url: `#/todo/${todo.id}`,
      tag: `todo-${todo.id}`,
    });
    notified++;
  }
  return { due: due?.length ?? 0, notified };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
      return json(await sendDueReminders());
    }
    // Test notification for the logged-in user.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json({ error: 'Nicht erlaubt' }, 401);
    const result = await pushToUser(data.user.id, {
      title: 'Test-Benachrichtigung',
      body: 'Super – Erinnerungen kommen auf diesem Gerät an.',
      url: '#/settings',
      tag: 'test',
    });
    return json(result);
  } catch (err) {
    console.error(err);
    return json({ error: 'Interner Fehler' }, 500);
  }
});
