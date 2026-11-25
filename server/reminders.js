import { cleanupExpiredSessions } from './auth.js';
import { config } from './config.js';
import { now, q } from './db.js';
import { sendPushToUser } from './push.js';

function formatDue(date, time) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `Fällig am ${d}.${m}.${y}${time ? `, ${time} Uhr` : ''}`;
}

async function tick() {
  const ts = now();
  const due = q(
    `SELECT t.id, t.user_id, t.title, t.description, t.area, t.due_date, t.due_time, p.name AS project_name
       FROM todos t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.reminder_at IS NOT NULL AND t.reminder_at <= ?
        AND t.reminder_sent_at IS NULL AND t.reminder_dismissed = 0 AND t.completed_at IS NULL
      ORDER BY t.reminder_at LIMIT 100`,
  ).all(ts);

  for (const todo of due) {
    // Mark first so a slow push service never causes duplicate notifications.
    q('UPDATE todos SET reminder_sent_at = ? WHERE id = ?').run(ts, todo.id);
    const parts = [
      todo.area === 'work' ? 'Beruflich' : 'Privat',
      todo.project_name,
      formatDue(todo.due_date, todo.due_time),
    ].filter(Boolean);
    try {
      await sendPushToUser(todo.user_id, {
        title: todo.title,
        body: parts.join(' · ') + (todo.description ? `\n${todo.description.slice(0, 140)}` : ''),
        url: `/#/todo/${todo.id}`,
        tag: `todo-${todo.id}`,
      });
    } catch (err) {
      console.warn('[reminder]', err.message);
    }
  }
}

let running = false;
export function startReminderScheduler() {
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
      cleanupExpiredSessions();
    } catch (err) {
      console.error('[reminder] Fehler:', err);
    } finally {
      running = false;
    }
  };
  setInterval(run, config.reminderIntervalMs).unref();
  run();
}
