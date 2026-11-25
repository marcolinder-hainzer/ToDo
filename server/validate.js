export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new HttpError(400, message, 'BAD_REQUEST');
export const notFound = (message = 'Nicht gefunden') => new HttpError(404, message, 'NOT_FOUND');
export const forbidden = (message = 'Keine Berechtigung') => new HttpError(403, message, 'FORBIDDEN');

export function text(value, { field, max = 200, required = false, multiline = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} fehlt`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${field} ist ungültig`);
  let v = value.replace(/\r\n?/g, '\n');
  // Strip control characters (keep newlines/tabs for multiline fields).
  v = multiline ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') : v.replace(/[\u0000-\u001F\u007F]/g, ' ');
  v = v.trim();
  if (required && !v) throw badRequest(`${field} darf nicht leer sein`);
  if (v.length > max) throw badRequest(`${field} ist zu lang (max. ${max} Zeichen)`);
  return v;
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw badRequest(`${field} ist ungültig`);
  return value;
}

export function area(value) {
  return oneOf(value, ['work', 'private'], 'Bereich');
}

export function dateStr(value, field = 'Datum') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${field} ist ungültig`);
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw badRequest(`${field} ist ungültig`);
  }
  return value;
}

export function timeStr(value, field = 'Uhrzeit') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw badRequest(`${field} ist ungültig`);
  return value;
}

export function isoDateTime(value, field = 'Zeitpunkt') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40) throw badRequest(`${field} ist ungültig`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`${field} ist ungültig`);
  const year = new Date(ms).getUTCFullYear();
  if (year < 2000 || year > 2200) throw badRequest(`${field} ist ungültig`);
  return new Date(ms).toISOString();
}

export function color(value, field = 'Farbe') {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw badRequest(`${field} ist ungültig`);
  return value.toLowerCase();
}

export function int(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${field} ist ungültig`);
  return n;
}

export function id(value, field = 'ID') {
  return int(value, field, { min: 1, max: Number.MAX_SAFE_INTEGER });
}

export function bool(value, field) {
  if (typeof value !== 'boolean') throw badRequest(`${field} ist ungültig`);
  return value;
}

export function has(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

export function body(req) {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return {};
  return b;
}
