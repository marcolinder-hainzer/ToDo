import { Router } from 'express';
import { q } from '../db.js';
import { badRequest, body, color, has, oneOf, text } from '../validate.js';

const router = Router();

export const DEFAULT_SETTINGS = {
  theme: {
    mode: 'system',
    preset: 'standard',
    accent: '#4f46e5',
    work: '#2563eb',
    private: '#16a34a',
    background: null,
    fontSize: 'normal',
  },
  dashboardArea: 'both',
};

function readSettings(user) {
  let stored = {};
  try {
    stored = JSON.parse(user.settings || '{}');
  } catch {
    stored = {};
  }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    theme: { ...DEFAULT_SETTINGS.theme, ...(stored.theme || {}) },
  };
}

function validateTheme(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw badRequest('Design ist ungültig');
  return {
    mode: oneOf(t.mode, ['system', 'light', 'dark'], 'Modus'),
    preset: text(t.preset, { field: 'Farbschema', max: 30 }) || 'custom',
    accent: color(t.accent, 'Akzentfarbe'),
    work: color(t.work, 'Farbe Beruflich'),
    private: color(t.private, 'Farbe Privat'),
    background: t.background ? color(t.background, 'Hintergrundfarbe') : null,
    fontSize: oneOf(t.fontSize, ['small', 'normal', 'large'], 'Schriftgröße'),
  };
}

router.get('/', (req, res) => {
  res.json(readSettings(req.user));
});

router.put('/', (req, res) => {
  const b = body(req);
  const settings = readSettings(req.user);
  if (has(b, 'theme')) settings.theme = validateTheme(b.theme);
  if (has(b, 'dashboardArea')) settings.dashboardArea = oneOf(b.dashboardArea, ['both', 'work', 'private'], 'Bereich');
  q('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(settings), req.user.id);
  res.json(settings);
});

export default router;
