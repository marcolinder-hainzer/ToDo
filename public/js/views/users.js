import { api } from '../api.js';
import { formatDateTime } from '../dates.js';
import { h, icon } from '../dom.js';
import { store } from '../store.js';
import { confirmDialog, emptyState, errorToast, field, openDialog, passwordInput, setBusy, toast } from '../ui.js';

function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function passwordWithGenerator() {
  const pw = passwordInput({ autocomplete: 'new-password', minlength: 8 });
  const gen = h(
    'button',
    {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      onclick: () => {
        pw.input.value = generatePassword();
        pw.input.type = 'text';
      },
    },
    icon('refresh'),
    'Generieren',
  );
  return { el: h('div', { class: 'input-row' }, pw, gen), input: pw.input };
}

function openUserDialog(onSaved) {
  const username = h('input', { class: 'input', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 32, placeholder: 'z. B. anna' });
  const displayName = h('input', { class: 'input', maxlength: 60, placeholder: 'z. B. Anna' });
  const pw = passwordWithGenerator();
  const isAdmin = h('input', { type: 'checkbox' });
  const mustChange = h('input', { type: 'checkbox', checked: true });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), 'Benutzer anlegen');

  const form = h(
    'form',
    {
      class: 'stack',
      autocomplete: 'off',
      onsubmit: async (e) => {
        e.preventDefault();
        setBusy(save, true);
        try {
          await api.post('/api/users', {
            username: username.value.trim(),
            displayName: displayName.value.trim(),
            password: pw.input.value,
            isAdmin: isAdmin.checked,
            mustChangePassword: mustChange.checked,
          });
          toast(`Benutzer „${username.value.trim()}“ angelegt`, { type: 'success' });
          dialog.close();
          onSaved();
        } catch (err) {
          errorToast(err);
        } finally {
          setBusy(save, false);
        }
      },
    },
    field('Benutzername', username, { hint: '3–32 Zeichen: Buchstaben, Zahlen, . _ -' }),
    field('Anzeigename', displayName),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Start-Passwort'), pw.el, h('span', { class: 'field-hint' }, 'Mindestens 8 Zeichen. Teile es dem Benutzer sicher mit.')),
    h('label', { class: 'check-row' }, mustChange, h('span', 'Muss das Passwort bei der ersten Anmeldung ändern')),
    h('label', { class: 'check-row' }, isAdmin, h('span', 'Administrator (darf Benutzer verwalten)')),
    h('footer', { class: 'dialog-foot' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Abbrechen'), save),
  );
  const dialog = openDialog({ title: 'Neuer Benutzer', body: form });
  username.focus();
}

function openResetDialog(user, onSaved) {
  const pw = passwordWithGenerator();
  const mustChange = h('input', { type: 'checkbox', checked: user.id !== store.user.id });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('key'), 'Passwort setzen');
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        setBusy(save, true);
        try {
          await api.patch(`/api/users/${user.id}`, { password: pw.input.value, mustChangePassword: mustChange.checked });
          toast(`Passwort für „${user.username}“ gesetzt`, { type: 'success' });
          dialog.close();
          onSaved();
        } catch (err) {
          errorToast(err);
        } finally {
          setBusy(save, false);
        }
      },
    },
    h('p', { class: 'muted' }, `Neues Passwort für ${user.displayName} (${user.username}). Alle Sitzungen des Benutzers werden beendet.`),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Neues Passwort'), pw.el),
    h('label', { class: 'check-row' }, mustChange, h('span', 'Muss das Passwort bei der nächsten Anmeldung ändern')),
    h('footer', { class: 'dialog-foot' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Abbrechen'), save),
  );
  const dialog = openDialog({ title: 'Passwort zurücksetzen', body: form });
  pw.input.focus();
}

export async function usersView(root, { setTitle, setNewTodoDefaults }) {
  setTitle('Benutzer');
  setNewTodoDefaults({ area: 'work' });
  if (!store.user.isAdmin) {
    root.replaceChildren(h('div', { class: 'card' }, emptyState('lock', 'Kein Zugriff', 'Nur Administratoren können Benutzer verwalten.')));
    return {};
  }
  const list = h('div', { class: 'user-list' });
  root.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', h('h1', 'Benutzer'), h('p', { class: 'muted' }, 'Nur hier angelegte Benutzer können sich anmelden. Jeder Benutzer sieht ausschließlich seine eigenen Todos.')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openUserDialog(load) }, icon('plus'), 'Neuer Benutzer'),
    ),
    list,
  );

  async function load() {
    let users;
    try {
      users = await api.get('/api/users');
    } catch (err) {
      errorToast(err);
      return;
    }
    list.replaceChildren(
      ...users.map((u) => {
        const self = u.id === store.user.id;
        return h(
          'div',
          { class: 'card user-card' },
          h('div', { class: 'avatar', 'aria-hidden': 'true' }, (u.displayName || u.username).charAt(0).toUpperCase()),
          h(
            'div',
            { class: 'user-info' },
            h('div', { class: 'user-name' }, h('strong', u.displayName), h('span', { class: 'muted' }, `@${u.username}`), u.isAdmin && h('span', { class: 'badge badge-accent' }, 'Admin'), self && h('span', { class: 'badge' }, 'Du'), u.mustChangePassword && h('span', { class: 'badge badge-warn' }, 'Passwortänderung ausstehend')),
            h('div', { class: 'muted small' }, `${u.todoCount} Todos · ${u.projectCount} Projekte · ${u.lastLoginAt ? `Zuletzt angemeldet ${formatDateTime(u.lastLoginAt)}` : 'Noch nie angemeldet'}`),
          ),
          h(
            'div',
            { class: 'user-actions' },
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openResetDialog(u, load) }, icon('key'), 'Passwort'),
            !self &&
              h(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  onclick: async () => {
                    try {
                      await api.patch(`/api/users/${u.id}`, { isAdmin: !u.isAdmin });
                      toast(u.isAdmin ? 'Admin-Rechte entzogen' : 'Zum Administrator gemacht');
                      load();
                    } catch (err) {
                      errorToast(err);
                    }
                  },
                },
                icon('shield'),
                u.isAdmin ? 'Admin entziehen' : 'Zum Admin',
              ),
            !self &&
              h(
                'button',
                {
                  class: 'btn btn-ghost btn-sm btn-danger-text',
                  type: 'button',
                  onclick: async () => {
                    const { ok } = await confirmDialog({
                      title: 'Benutzer löschen?',
                      message: `„${u.displayName}“ (${u.username}) wird mit allen ${u.todoCount} Todos, Projekten und Bildern endgültig gelöscht.`,
                    });
                    if (!ok) return;
                    try {
                      await api.del(`/api/users/${u.id}`);
                      toast('Benutzer gelöscht');
                      load();
                    } catch (err) {
                      errorToast(err);
                    }
                  },
                },
                icon('trash'),
                'Löschen',
              ),
          ),
        );
      }),
    );
  }
  await load();
  return { refresh: load };
}
