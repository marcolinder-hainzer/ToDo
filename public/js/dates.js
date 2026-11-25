const pad = (n) => String(n).padStart(2, '0');

export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const todayStr = () => toDateStr(new Date());

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Whole days between today and the given YYYY-MM-DD date (negative = past). */
export function daysFromToday(s) {
  return Math.round((parseDate(s) - parseDate(todayStr())) / 86_400_000);
}

export function dueDateTime(todo) {
  const d = parseDate(todo.dueDate);
  if (todo.dueTime) {
    const [h, m] = todo.dueTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

export function isOverdue(todo) {
  return !todo.completed && !!todo.dueDate && dueDateTime(todo) < new Date();
}

const fmtWeekday = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
const fmtShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtWithYear = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtFull = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export const formatFullDate = (d = new Date()) => fmtFull.format(d);
export const formatDateTime = (iso) => fmtDateTime.format(new Date(iso));

export function formatDay(s) {
  const diff = daysFromToday(s);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  const d = parseDate(s);
  if (diff > 1 && diff < 7) return fmtWeekday.format(d);
  return d.getFullYear() === new Date().getFullYear() ? fmtShort.format(d) : fmtWithYear.format(d);
}

/** Text for the due-date chip. */
export function formatDue(todo) {
  if (!todo.dueDate) return '';
  const diff = daysFromToday(todo.dueDate);
  if (!todo.completed && diff < -1) return `seit ${-diff} Tagen`;
  return formatDay(todo.dueDate) + (todo.dueTime ? `, ${todo.dueTime}` : '');
}

export function formatDueLong(todo) {
  if (!todo.dueDate) return '';
  return fmtFull.format(parseDate(todo.dueDate)) + (todo.dueTime ? `, ${todo.dueTime} Uhr` : '');
}

export function formatReminder(iso) {
  const d = new Date(iso);
  return `${formatDay(toDateStr(d))}, ${toTimeStr(d)}`;
}

/** ISO (UTC) -> value for <input type="datetime-local"> */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${toDateStr(d)}T${toTimeStr(d)}`;
}

/** <input type="datetime-local"> value -> ISO (UTC) */
export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function upcomingGroup(todo) {
  const diff = daysFromToday(todo.dueDate);
  if (diff <= 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff < 7) return 'Nächste 7 Tage';
  if (diff < 31) return 'Diesen Monat';
  return 'Später';
}

const byDue = (a, b) =>
  a.dueDate.localeCompare(b.dueDate) ||
  (a.dueTime || '24:00').localeCompare(b.dueTime || '24:00') ||
  b.priority - a.priority;

/** Split open todos into overdue / upcoming / general (no due date). */
export function categorize(todos) {
  const overdue = [];
  const upcoming = [];
  const general = [];
  for (const t of todos) {
    if (t.completed) continue;
    if (!t.dueDate) general.push(t);
    else if (isOverdue(t)) overdue.push(t);
    else upcoming.push(t);
  }
  overdue.sort(byDue);
  upcoming.sort(byDue);
  general.sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt));
  return { overdue, upcoming, general };
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'Guten Morgen';
  if (h >= 11 && h < 17) return 'Guten Tag';
  if (h >= 17 && h < 23) return 'Guten Abend';
  return 'Hallo';
}
