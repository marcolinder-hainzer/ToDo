import { changePassword, logoutOtherDevices, saveSettings, sendTestPush, updateDisplayName } from '../data.js';
import { debounce, h, icon } from '../dom.js';
import { disablePush, enablePush, getPushState } from '../push.js';
import { store } from '../store.js';
import { BACKGROUNDS, DEFAULT_THEME, PRESETS, applyTheme, sanitizeTheme } from '../theme.js';
import { errorToast, field, passwordInput, segmented, setBusy, toast } from '../ui.js';

function card(title, iconName, ...children) {
  return h('section', { class: 'card settings-card' }, h('h2', { class: 'card-title' }, icon(iconName), title), ...children);
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------
function appearanceCard() {
  const theme = { ...DEFAULT_THEME, ...(store.settings?.theme || {}) };
  const status = h('span', { class: 'save-status muted', 'aria-live': 'polite' });

  const persist = debounce(async () => {
    try {
      store.settings = await saveSettings({ theme: sanitizeTheme(theme) });
      status.textContent = 'Gespeichert ✓';
    } catch (err) {
      status.textContent = '';
      errorToast(err);
    }
  }, 500);

  function update(patch) {
    Object.assign(theme, patch);
    applyTheme(theme);
    status.textContent = 'Wird gespeichert…';
    persist();
    sync();
  }

  const modeControl = segmented(
    [
      { value: 'system', label: 'System', icon: 'monitor' },
      { value: 'light', label: 'Hell', icon: 'sun' },
      { value: 'dark', label: 'Dunkel', icon: 'moon' },
    ],
    theme.mode,
    (mode) => update({ mode, background: null }),
    { name: 'Modus' },
  );

  const presetButtons = PRESETS.map((p) =>
    h(
      'button',
      {
        type: 'button',
        class: 'preset',
        dataset: { id: p.id },
        onclick: () => update({ preset: p.id, accent: p.accent, work: p.work, private: p.private }),
      },
      h('span', { class: 'preset-dots' }, ...[p.accent, p.work, p.private].map((c) => h('span', { style: { '--c': c } }))),
      h('span', { class: 'preset-name' }, p.name),
    ),
  );

  function colorField(key, label, hint) {
    const input = h('input', { type: 'color', class: 'color-input', value: theme[key], 'aria-label': label });
    const code = h('code', theme[key]);
    input.addEventListener('input', () => {
      code.textContent = input.value;
      update({ [key]: input.value, preset: 'custom' });
    });
    const el = h('label', { class: 'color-field' }, h('span', { class: 'color-preview' }, input), h('span', { class: 'color-text' }, h('span', label), hint && h('small', { class: 'muted' }, hint)), code);
    el.sync = () => {
      input.value = theme[key];
      code.textContent = theme[key];
    };
    return el;
  }
  const colorFields = [
    colorField('accent', 'Akzentfarbe', 'Buttons, Links, Auswahl'),
    colorField('work', 'Beruflich', 'Farbe für den Bereich Beruf'),
    colorField('private', 'Privat', 'Farbe für den Bereich Privat'),
  ];

  const bgCustom = h('input', { type: 'color', class: 'color-input', value: theme.background || '#ffffff', 'aria-label': 'Eigene Hintergrundfarbe' });
  bgCustom.addEventListener('input', () => update({ background: bgCustom.value }));
  const bgButtons = BACKGROUNDS.map((b) =>
    h(
      'button',
      {
        type: 'button',
        class: ['swatch', 'swatch-bg', !b.value && 'swatch-default'],
        style: { '--swatch': b.value || 'var(--bg-default)' },
        title: b.name,
        'aria-label': `Hintergrund ${b.name}`,
        dataset: { value: b.value || '' },
        onclick: () => update({ background: b.value }),
      },
      !b.value && icon('undo'),
    ),
  );
  const bgCustomLabel = h('label', { class: 'swatch swatch-custom', title: 'Eigene Farbe' }, bgCustom);
  const bgHint = h('p', { class: 'field-hint' });

  const fontControl = segmented(
    [
      { value: 'small', label: 'Klein' },
      { value: 'normal', label: 'Normal' },
      { value: 'large', label: 'Groß' },
    ],
    theme.fontSize,
    (fontSize) => update({ fontSize }),
    { name: 'Schriftgröße', small: true },
  );

  function sync() {
    modeControl.setValue(theme.mode);
    presetButtons.forEach((b) => b.classList.toggle('active', b.dataset.id === theme.preset));
    colorFields.forEach((f) => f.sync());
    const known = BACKGROUNDS.some((b) => b.value === theme.background);
    bgButtons.forEach((b) => b.classList.toggle('active', (b.dataset.value || null) === theme.background));
    bgCustomLabel.classList.toggle('active', !!theme.background && !known);
    bgCustomLabel.style.setProperty('--swatch', theme.background && !known ? theme.background : 'transparent');
    bgHint.textContent = theme.background
      ? 'Mit eigener Hintergrundfarbe werden Text- und Flächenfarben automatisch hell oder dunkel gewählt.'
      : '';
    bgHint.hidden = !theme.background;
    fontControl.setValue(theme.fontSize);
  }
  sync();

  return card(
    'Darstellung & Farben',
    'droplet',
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Modus'), modeControl),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Farbschema'), h('div', { class: 'presets' }, presetButtons)),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Eigene Farben'), h('div', { class: 'color-fields' }, colorFields)),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Hintergrund'), h('div', { class: 'swatches' }, bgButtons, bgCustomLabel), bgHint),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Schriftgröße'), fontControl),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: 'btn btn-ghost',
          type: 'button',
          onclick: () => update({ ...DEFAULT_THEME }),
        },
        icon('undo'),
        'Auf Standard zurücksetzen',
      ),
      h('div', { class: 'spacer' }),
      status,
    ),
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function notificationsCard() {
  const content = h('div', { class: 'stack' });

  async function render() {
    let s;
    try {
      s = await getPushState();
    } catch {
      s = { supported: false };
    }
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const items = [];
    const status = (cls, text) => h('p', { class: ['push-status', cls] }, icon(cls === 'ok' ? 'checkCircle' : 'alert'), text);

    if (!s.supported) {
      items.push(status('warn', 'Dieser Browser unterstützt keine Push-Benachrichtigungen.'));
      if (isIos && !standalone) {
        items.push(h('p', { class: 'muted' }, 'Auf iPhone/iPad: Öffne die Seite in Safari, tippe auf „Teilen“ → „Zum Home-Bildschirm“ und starte die App von dort. Dann kannst du hier Benachrichtigungen aktivieren.'));
      }
    } else if (!s.configured) {
      items.push(status('warn', 'Push-Benachrichtigungen sind für diese App noch nicht eingerichtet.'));
    } else if (!s.secure) {
      items.push(status('warn', 'Push-Benachrichtigungen benötigen eine sichere Verbindung (HTTPS).'));
    } else if (s.permission === 'denied') {
      items.push(status('warn', 'Benachrichtigungen sind für diese Seite im Browser blockiert. Bitte in den Website-Einstellungen erlauben.'));
    } else if (s.subscribed) {
      const off = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('bellOff'), 'Deaktivieren');
      const test = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('send'), 'Test senden');
      off.addEventListener('click', async () => {
        setBusy(off, true);
        await disablePush();
        toast('Benachrichtigungen auf diesem Gerät deaktiviert');
        render();
      });
      test.addEventListener('click', async () => {
        setBusy(test, true);
        try {
          const r = await sendTestPush();
          toast(r.sent ? 'Test-Benachrichtigung gesendet' : 'Senden fehlgeschlagen – bitte erneut aktivieren', { type: r.sent ? 'success' : 'error' });
        } catch (err) {
          errorToast(err);
        } finally {
          setBusy(test, false);
        }
      });
      items.push(status('ok', 'Benachrichtigungen sind auf diesem Gerät aktiv.'), h('div', { class: 'row' }, test, off));
    } else {
      const on = h('button', { class: 'btn btn-primary', type: 'button' }, icon('bell'), 'Auf diesem Gerät aktivieren');
      on.addEventListener('click', async () => {
        setBusy(on, true);
        try {
          await enablePush();
          toast('Benachrichtigungen aktiviert', { type: 'success' });
        } catch (err) {
          errorToast(err);
        }
        render();
      });
      items.push(h('p', 'Erhalte Erinnerungen als Benachrichtigung – auch wenn die App geschlossen ist.'), h('div', { class: 'row' }, on));
    }
    items.push(h('p', { class: 'field-hint' }, 'Fällige Erinnerungen werden zusätzlich immer in der App angezeigt (Glocke oben rechts).'));
    content.replaceChildren(...items);
  }
  render();
  return card('Benachrichtigungen', 'bell', content);
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
function accountCard(onUserChanged) {
  const nameInput = h('input', { class: 'input', value: store.user.displayName, maxlength: 60 });
  const nameBtn = h('button', { class: 'btn btn-ghost', type: 'submit' }, 'Speichern');
  const nameForm = h(
    'form',
    {
      class: 'inline-form',
      onsubmit: async (e) => {
        e.preventDefault();
        setBusy(nameBtn, true);
        try {
          store.user = await updateDisplayName(nameInput.value);
          onUserChanged();
          toast('Name gespeichert', { type: 'success' });
        } catch (err) {
          errorToast(err);
        } finally {
          setBusy(nameBtn, false);
        }
      },
    },
    field('Anzeigename', nameInput),
    nameBtn,
  );

  const current = passwordInput({ autocomplete: 'current-password' });
  const next = passwordInput({ autocomplete: 'new-password' });
  const repeat = passwordInput({ autocomplete: 'new-password' });
  const pwBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('key'), 'Passwort ändern');
  const pwForm = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        if (next.input.value !== repeat.input.value) return toast('Die neuen Passwörter stimmen nicht überein', { type: 'error' });
        setBusy(pwBtn, true);
        try {
          store.user = await changePassword(current.input.value, next.input.value);
          pwForm.reset();
          toast('Passwort geändert – andere Geräte wurden abgemeldet', { type: 'success' });
        } catch (err) {
          errorToast(err);
        } finally {
          setBusy(pwBtn, false);
        }
      },
    },
    h('h3', { class: 'subhead' }, 'Passwort ändern'),
    field('Aktuelles Passwort', current),
    h('div', { class: 'grid-2' }, field('Neues Passwort', next, { hint: 'Mindestens 8 Zeichen' }), field('Wiederholen', repeat)),
    h('div', { class: 'row' }, pwBtn),
  );

  const logoutOthers = h(
    'button',
    {
      class: 'btn btn-ghost',
      type: 'button',
      onclick: async () => {
        setBusy(logoutOthers, true);
        try {
          await logoutOtherDevices();
          toast('Alle anderen Geräte wurden abgemeldet', { type: 'success' });
        } catch (err) {
          errorToast(err);
        } finally {
          setBusy(logoutOthers, false);
        }
      },
    },
    icon('logout'),
    'Auf allen anderen Geräten abmelden',
  );
  const sessions = h(
    'div',
    { class: 'stack' },
    h('h3', { class: 'subhead' }, 'Geräte'),
    h('p', { class: 'muted' }, 'Handy verloren oder an einem fremden PC angemeldet? Hier beendest du alle anderen Anmeldungen.'),
    h('div', { class: 'row' }, logoutOthers),
  );

  return card(
    'Konto',
    'user',
    h('p', { class: 'muted' }, `Angemeldet als `, h('strong', store.user.username), store.user.isAdmin ? ' · Administrator' : ''),
    nameForm,
    h('hr'),
    pwForm,
    h('hr'),
    sessions,
  );
}

export async function settingsView(root, { setTitle, setNewTodoDefaults, onUserChanged }) {
  setTitle('Einstellungen');
  setNewTodoDefaults({ area: 'work' });
  root.replaceChildren(
    h('div', { class: 'page-head' }, h('div', h('h1', 'Einstellungen'), h('p', { class: 'muted' }, 'Passe die App an deinen Geschmack an.'))),
    h('div', { class: 'settings-grid' }, appearanceCard(), h('div', { class: 'stack' }, notificationsCard(), accountCard(onUserChanged))),
  );
  return {};
}
