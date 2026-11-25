import { h, icon } from './dom.js';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

const toastHost = () => document.getElementById('toasts');

/**
 * Everything outside an open modal <dialog> is inert, so the toast container is moved
 * into the topmost open dialog (and back to <body> when it closes).
 */
export function placeToasts(exclude = null) {
  const host = toastHost();
  if (!host) return;
  const open = [...document.querySelectorAll('dialog[open]')].filter((d) => d !== exclude);
  const target = open.length ? open[open.length - 1] : document.body;
  if (host.parentElement !== target) target.append(host);
}
export function toast(message, { type = 'info', action = null, duration = 4500 } = {}) {
  const host = toastHost();
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  const el = h(
    'div',
    { class: ['toast', `toast-${type}`], role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : type === 'reminder' ? 'bell' : 'alert'),
    h('div', { class: 'toast-text' }, message),
    action &&
      h(
        'button',
        {
          class: 'toast-action',
          type: 'button',
          onclick: () => {
            close();
            action.onClick();
          },
        },
        action.label,
      ),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Schließen', onclick: close }, icon('x')),
  );
  placeToasts();
  host.append(el);
  if (duration) setTimeout(close, duration);
  return close;
}

export function errorToast(err) {
  toast(err?.message || 'Es ist ein Fehler aufgetreten', { type: 'error' });
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/**
 * Opens a modal <dialog>. `onRequestClose` may return false to keep it open
 * (e.g. for unsaved changes).
 */
export function openDialog({ title, body, footer, className = '', onClose, onRequestClose, dismissable = true, wide = false }) {
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen' }, icon('x'));
  const panel = h(
    'div',
    { class: 'dialog-panel' },
    title != null && h('header', { class: 'dialog-head' }, h('h2', { class: 'dialog-title' }, title), closeBtn),
    h('div', { class: 'dialog-body' }, body),
    footer && h('footer', { class: 'dialog-foot' }, footer),
  );
  const dlg = h('dialog', { class: ['dialog', wide && 'dialog-wide', className] }, panel);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dlg.close();
  };
  const requestClose = async () => {
    if (onRequestClose && (await onRequestClose()) === false) return;
    close();
  };

  closeBtn.addEventListener('click', requestClose);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose();
  });
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === dlg));
  dlg.addEventListener('click', (e) => {
    if (dismissable && downOnBackdrop && e.target === dlg) requestClose();
  });
  dlg.addEventListener('close', () => {
    closed = true;
    placeToasts(dlg);
    dlg.remove();
    onClose?.();
  });

  document.body.append(dlg);
  dlg.showModal();
  placeToasts();
  return { el: dlg, panel, close, requestClose };
}

/** Promise-based confirmation dialog. Resolves to { ok, checked }. */
export function confirmDialog({
  title = 'Bist du sicher?',
  message = '',
  confirmLabel = 'Löschen',
  cancelLabel = 'Abbrechen',
  danger = true,
  checkbox = null,
}) {
  return new Promise((resolve) => {
    let result = { ok: false, checked: false };
    const cb = checkbox ? h('input', { type: 'checkbox', checked: !!checkbox.checked }) : null;
    const confirmBtn = h(
      'button',
      {
        class: ['btn', danger ? 'btn-danger' : 'btn-primary'],
        type: 'button',
        onclick: () => {
          result = { ok: true, checked: cb ? cb.checked : false };
          dialog.close();
        },
      },
      confirmLabel,
    );
    const dialog = openDialog({
      title,
      className: 'dialog-confirm',
      body: [
        message && h('p', { class: 'confirm-message' }, message),
        cb && h('label', { class: 'check-row' }, cb, h('span', checkbox.label)),
      ],
      footer: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, cancelLabel),
        confirmBtn,
      ],
      onClose: () => resolve(result),
    });
    confirmBtn.focus();
  });
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

export function field(label, control, { hint, className } = {}) {
  return h('label', { class: ['field', className] }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
}

/** Segmented control. options: [{ value, label, icon? }] */
export function segmented(options, value, onChange, { name = '', small = false } = {}) {
  const el = h('div', { class: ['segmented', small && 'segmented-sm'], role: 'radiogroup', 'aria-label': name });
  const buttons = options.map((opt) => {
    const b = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'segment',
        dataset: { value: String(opt.value) },
        onclick: () => {
          set(opt.value);
          onChange(opt.value);
        },
      },
      opt.icon && icon(opt.icon),
      h('span', opt.label),
    );
    if (opt.className) b.classList.add(opt.className);
    return b;
  });
  el.append(...buttons);
  function set(v) {
    buttons.forEach((b, i) => {
      const active = options[i].value === v;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });
  }
  set(value);
  el.setValue = set;
  return el;
}

export function passwordInput(attrs = {}) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', ...attrs });
  const toggle = h(
    'button',
    {
      class: 'icon-btn input-addon',
      type: 'button',
      'aria-label': 'Passwort anzeigen',
      onclick: () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
        toggle.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
      },
    },
    icon('eye'),
  );
  const wrap = h('div', { class: 'input-group' }, input, toggle);
  wrap.input = input;
  return wrap;
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
}

export function emptyState(iconName, title, text) {
  return h('div', { class: 'empty' }, icon(iconName), h('div', { class: 'empty-title' }, title), text && h('div', { class: 'empty-text' }, text));
}
