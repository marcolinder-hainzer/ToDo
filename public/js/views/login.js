import { changePassword, login } from '../data.js';
import { h, icon } from '../dom.js';
import { field, passwordInput, setBusy } from '../ui.js';

function authCard(...children) {
  return h(
    'div',
    { class: 'auth-wrap' },
    h(
      'div',
      { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, h('img', { src: 'icons/icon.svg', alt: '', class: 'auth-logo' }), h('span', 'ToDo')),
      ...children,
    ),
  );
}

export function renderLogin(root, onSuccess) {
  const username = h('input', { class: 'input', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const password = passwordInput({ name: 'password', required: true });
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('lock'), 'Anmelden');

  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        setBusy(submit, true);
        try {
          const user = await login(username.value, password.input.value);
          onSuccess(user);
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          password.input.select();
        } finally {
          setBusy(submit, false);
        }
      },
    },
    h('h1', { class: 'auth-title' }, 'Willkommen zurück'),
    h('p', { class: 'auth-sub' }, 'Melde dich an, um deine Todos zu sehen.'),
    field('Benutzername', username),
    field('Passwort', password),
    error,
    submit,
    h('p', { class: 'auth-foot' }, icon('shield'), 'Zugang nur für freigeschaltete Benutzer.'),
  );
  root.replaceChildren(authCard(form));
  username.focus();
}

export function renderPasswordChange(root, user, onSuccess, onLogout) {
  const current = passwordInput({ autocomplete: 'current-password', required: true });
  const next = passwordInput({ autocomplete: 'new-password', required: true, minlength: 8 });
  const repeat = passwordInput({ autocomplete: 'new-password', required: true });
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('key'), 'Passwort speichern');

  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (next.input.value !== repeat.input.value) {
          error.textContent = 'Die neuen Passwörter stimmen nicht überein';
          error.hidden = false;
          return;
        }
        setBusy(submit, true);
        try {
          const user = await changePassword(current.input.value, next.input.value);
          onSuccess(user);
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        } finally {
          setBusy(submit, false);
        }
      },
    },
    h('h1', { class: 'auth-title' }, `Hallo ${user.displayName}!`),
    h('p', { class: 'auth-sub' }, 'Bitte vergib aus Sicherheitsgründen ein neues, persönliches Passwort.'),
    field('Aktuelles Passwort', current),
    field('Neues Passwort', next, { hint: 'Mindestens 8 Zeichen' }),
    field('Neues Passwort wiederholen', repeat),
    error,
    submit,
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: onLogout }, icon('logout'), 'Abmelden'),
  );
  root.replaceChildren(authCard(form));
  current.input.focus();
}
