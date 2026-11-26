export const PRESETS = [
  { id: 'standard', name: 'Indigo', accent: '#4f46e5', work: '#2563eb', private: '#16a34a' },
  { id: 'ocean', name: 'Ozean', accent: '#0891b2', work: '#1d4ed8', private: '#0d9488' },
  { id: 'sunset', name: 'Sonnenuntergang', accent: '#ea580c', work: '#be123c', private: '#d97706' },
  { id: 'forest', name: 'Wald', accent: '#15803d', work: '#3f6212', private: '#0f766e' },
  { id: 'lavender', name: 'Lavendel', accent: '#9333ea', work: '#6d28d9', private: '#db2777' },
  { id: 'berry', name: 'Beere', accent: '#be185d', work: '#7e22ce', private: '#e11d48' },
  { id: 'graphite', name: 'Graphit', accent: '#334155', work: '#475569', private: '#0f766e' },
  { id: 'sky', name: 'Himmel', accent: '#2563eb', work: '#0284c7', private: '#f59e0b' },
];

export const BACKGROUNDS = [
  { name: 'Standard', value: null },
  { name: 'Papier', value: '#faf7f0' },
  { name: 'Minze', value: '#eef7f3' },
  { name: 'Rosé', value: '#fbf1f3' },
  { name: 'Eis', value: '#eef4fb' },
  { name: 'Nacht', value: '#0f172a' },
  { name: 'Kohle', value: '#18181b' },
  { name: 'Tiefsee', value: '#0b1f2a' },
];

export const DEFAULT_THEME = window.__todoTheme.DEFAULT;

export function applyTheme(theme) {
  window.__todoTheme.apply(theme);
}

export function sanitizeTheme(theme) {
  return window.__todoTheme.sanitize(theme);
}
