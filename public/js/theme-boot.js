/* Wird synchron im <head> geladen, damit das gespeicherte Farbschema ohne Flackern greift. */
(function () {
  if (window.top !== window.self) {
    try {
      window.top.location = window.self.location.href;
    } catch (e) {
      document.documentElement.style.display = 'none';
    }
  }

  var DEFAULT = {
    mode: 'system',
    preset: 'standard',
    accent: '#4f46e5',
    work: '#2563eb',
    private: '#16a34a',
    background: null,
    fontSize: 'normal',
  };

  function luminance(hex) {
    var c = hex.replace('#', '');
    var rgb = [0, 2, 4].map(function (i) {
      var v = parseInt(c.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function contrast(hex) {
    return luminance(hex) > 0.3 ? '#111318' : '#ffffff';
  }

  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var current = null;

  var HEX = /^#[0-9a-fA-F]{6}$/;
  function sanitize(theme) {
    var t = Object.assign({}, DEFAULT);
    if (!theme || typeof theme !== 'object') return t;
    if (['system', 'light', 'dark'].indexOf(theme.mode) >= 0) t.mode = theme.mode;
    if (['small', 'normal', 'large'].indexOf(theme.fontSize) >= 0) t.fontSize = theme.fontSize;
    if (typeof theme.preset === 'string') t.preset = theme.preset.slice(0, 30);
    ['accent', 'work', 'private'].forEach(function (k) {
      if (HEX.test(theme[k])) t[k] = theme[k].toLowerCase();
    });
    t.background = HEX.test(theme.background) ? theme.background.toLowerCase() : null;
    return t;
  }

  function apply(theme) {
    var t = sanitize(theme);
    current = t;
    var root = document.documentElement;
    var dark;
    if (t.background) {
      root.style.setProperty('--bg', t.background);
      dark = luminance(t.background) < 0.18;
    } else {
      root.style.removeProperty('--bg');
      dark = t.mode === 'dark' || (t.mode === 'system' && !!media && media.matches);
    }
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-font-size', t.fontSize);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-contrast', contrast(t.accent));
    root.style.setProperty('--work', t.work);
    root.style.setProperty('--work-contrast', contrast(t.work));
    root.style.setProperty('--private', t.private);
    root.style.setProperty('--private-contrast', contrast(t.private));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.background || (dark ? '#0e1016' : '#f4f5f9'));
    try {
      localStorage.setItem('todo.theme', JSON.stringify(t));
    } catch (e) {
      /* private mode */
    }
  }

  if (media && media.addEventListener) {
    media.addEventListener('change', function () {
      if (current && current.mode === 'system' && !current.background) apply(current);
    });
  }

  window.__todoTheme = { apply: apply, sanitize: sanitize, DEFAULT: DEFAULT, luminance: luminance };

  var stored = null;
  try {
    stored = JSON.parse(localStorage.getItem('todo.theme') || 'null');
  } catch (e) {
    stored = null;
  }
  apply(stored);
})();
