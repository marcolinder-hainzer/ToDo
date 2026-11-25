import { api } from '../api.js';
import { addDays, formatReminder } from '../dates.js';
import { h, icon } from '../dom.js';
import { AREAS, notifyChanged, projectById, store } from '../store.js';
import { pushActiveHere, showLocalNotification } from '../push.js';
import { emptyState, errorToast, openDialog, toast } from '../ui.js';
import { openTodoEditor } from './todoEditor.js';
import { toggleCompleted } from './todoItem.js';

const NOTIFIED_KEY = 'todo.notified';
const POLL_MS = 30_000;

let due = [];
const toasted = new Set();
const bells = [];
let timer = null;
let panel = null;

const keyOf = (t) => `${t.id}@${t.reminderAt}`;

function loadNotified() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function saveNotified(set) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set].slice(-200)));
}

export function createReminderBell() {
  const badge = h('span', { class: 'bell-badge', hidden: true });
  const btn = h('button', { class: 'icon-btn bell-btn', type: 'button', 'aria-label': 'Erinnerungen', title: 'Erinnerungen', onclick: openReminderPanel }, icon('bell'), badge);
  bells.push({ btn, badge });
  updateBells();
  return btn;
}

function updateBells() {
  for (const { btn, badge } of bells) {
    badge.hidden = !due.length;
    badge.textContent = due.length > 9 ? '9+' : String(due.length);
    btn.classList.toggle('has-reminders', due.length > 0);
    btn.setAttribute('aria-label', due.length ? `Erinnerungen (${due.length} fällig)` : 'Erinnerungen');
  }
}

async function poll() {
  if (!store.user || store.user.mustChangePassword) return;
  try {
    due = await api.get('/api/reminders');
  } catch {
    return;
  }
  updateBells();
  if (panel) renderPanel();

  const fresh = due.filter((t) => !toasted.has(keyOf(t)));
  fresh.forEach((t) => toasted.add(keyOf(t)));
  fresh.slice(0, 3).forEach((t) =>
    toast(`Erinnerung: ${t.title}`, {
      type: 'reminder',
      duration: 12000,
      action: { label: 'Öffnen', onClick: () => openTodoEditor({ id: t.id }) },
    }),
  );
  if (fresh.length > 3) toast(`… und ${fresh.length - 3} weitere Erinnerungen`, { type: 'reminder', action: { label: 'Anzeigen', onClick: openReminderPanel } });

  // System notification if this device doesn't get server push.
  if (fresh.length && !(await pushActiveHere())) {
    const notified = loadNotified();
    for (const t of fresh) {
      if (notified.has(keyOf(t))) continue;
      notified.add(keyOf(t));
      showLocalNotification(t.title, { body: `${AREAS[t.area].label} · Erinnerung`, tag: `todo-${t.id}`, data: { url: `/#/todo/${t.id}` } }).catch(() => {});
    }
    saveNotified(notified);
  }
}

let listening = false;

export function startReminderPolling() {
  if (timer) return;
  poll();
  timer = setInterval(poll, POLL_MS);
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', () => timer && !document.hidden && poll());
    window.addEventListener('data:changed', () => timer && setTimeout(poll, 300));
  }
}

export function stopReminderPolling() {
  clearInterval(timer);
  timer = null;
  due = [];
  bells.length = 0;
}

async function act(todo, action) {
  try {
    if (action === 'done') await toggleCompleted(todo, true);
    else if (action === 'dismiss') await api.patch(`/api/todos/${todo.id}`, { reminderDismissed: true });
    else await api.patch(`/api/todos/${todo.id}`, { reminderAt: action.toISOString() });
    if (action instanceof Date) toast(`Erinnerung verschoben auf ${formatReminder(action.toISOString())}`);
    notifyChanged();
    await poll();
  } catch (err) {
    errorToast(err);
  }
}

function snoozeTargets() {
  const now = Date.now();
  const tomorrow = addDays(new Date(), 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { label: '+10 Min.', at: new Date(now + 10 * 60_000) },
    { label: '+1 Std.', at: new Date(now + 60 * 60_000) },
    { label: 'Morgen 9:00', at: tomorrow },
  ];
}

function renderPanel() {
  const body = panel.panel.querySelector('.dialog-body');
  if (!due.length) {
    body.replaceChildren(emptyState('bell', 'Keine fälligen Erinnerungen', 'Neue Erinnerungen erscheinen hier und als Benachrichtigung.'));
    return;
  }
  body.replaceChildren(
    h(
      'ul',
      { class: 'reminder-list' },
      due.map((t) => {
        const project = t.projectId ? projectById(t.projectId) : null;
        return h(
          'li',
          { class: ['reminder-item', `area-${t.area}`] },
          h(
            'button',
            {
              class: 'reminder-main',
              type: 'button',
              onclick: () => {
                panel.close();
                openTodoEditor({ id: t.id });
              },
            },
            h('span', { class: 'reminder-title' }, t.title),
            h('span', { class: 'reminder-meta' }, [AREAS[t.area].label, project?.name, `🔔 ${formatReminder(t.reminderAt)}`].filter(Boolean).join(' · ')),
          ),
          h(
            'div',
            { class: 'reminder-actions' },
            h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => act(t, 'done') }, icon('check'), 'Erledigt'),
            ...snoozeTargets().map((s) => h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => act(t, s.at) }, s.label)),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Erinnerung ausblenden', onclick: () => act(t, 'dismiss') }, icon('bellOff'), 'Ausblenden'),
          ),
        );
      }),
    ),
  );
}

export function openReminderPanel() {
  if (panel) return;
  panel = openDialog({ title: 'Fällige Erinnerungen', body: h('div'), onClose: () => (panel = null) });
  renderPanel();
  poll();
}
