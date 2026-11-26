import { createReminderBell, startReminderPolling, stopReminderPolling } from './components/reminders.js';
import { currentUser, getSettings, isConfigured, logout as signOut, onSessionLost } from './data.js';
import { openTodoEditor } from './components/todoEditor.js';
import { h, icon } from './dom.js';
import { detachPushSubscription, registerServiceWorker, syncPushSubscription } from './push.js';
import { AREAS, loadProjects, store } from './store.js';
import { applyTheme } from './theme.js';
import { emptyState } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { renderLogin, renderPasswordChange } from './views/login.js';
import { projectView } from './views/project.js';
import { projectsView } from './views/projects.js';
import { settingsView } from './views/settings.js';
import { todosView } from './views/todos.js';
import { usersView } from './views/users.js';

const root = document.getElementById('app');

const ROUTES = [
  { pattern: /^\/?$/, view: dashboardView, nav: 'dashboard' },
  { pattern: /^\/todos$/, view: todosView, nav: 'todos' },
  { pattern: /^\/projects$/, view: projectsView, nav: 'projects' },
  { pattern: /^\/projects\/(\d+)$/, view: projectView, nav: 'projects' },
  { pattern: /^\/settings$/, view: settingsView, nav: 'settings' },
  { pattern: /^\/users$/, view: usersView, nav: 'users' },
];

let shell = null;
let currentView = null;
let renderToken = null;
let newTodoDefaults = { area: 'work' };
let listenersInstalled = false;

const openNewTodo = () => openTodoEditor({ defaults: { ...newTodoDefaults } });

// ---------------------------------------------------------------------------
// Shell (sidebar, top bar, bottom navigation)
// ---------------------------------------------------------------------------

function buildShell() {
  const navLinks = {};
  const navItem = (key, href, iconName, label, cls = 'nav-link') => {
    const a = h('a', { class: cls, href, dataset: { nav: key } }, icon(iconName), h('span', label));
    (navLinks[key] ||= []).push(a);
    return a;
  };

  const title = h('h1', { class: 'topbar-title' });
  const content = h('main', { class: 'content', id: 'main', tabindex: '-1' });
  const projectsNav = h('div', { class: 'nav-projects' });
  const userName = h('span', { class: 'sidebar-user-name' });
  const avatar = h('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' });

  const sidebar = h(
    'aside',
    { class: 'sidebar', id: 'sidebar', 'aria-label': 'Navigation' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icons/icon.svg', alt: '' }), h('span', 'ToDo')),
    h(
      'nav',
      { class: 'nav' },
      navItem('dashboard', '#/', 'home', 'Übersicht'),
      navItem('todos', '#/todos', 'list', 'Alle Todos'),
      navItem('projects', '#/projects', 'folder', 'Projekte'),
    ),
    projectsNav,
    h(
      'div',
      { class: 'sidebar-bottom' },
      navItem('settings', '#/settings', 'sliders', 'Einstellungen'),
      store.user.isAdmin && navItem('users', '#/users', 'users', 'Benutzer'),
      h(
        'div',
        { class: 'sidebar-user' },
        avatar,
        userName,
        h('button', { class: 'icon-btn', type: 'button', title: 'Abmelden', 'aria-label': 'Abmelden', onclick: logout }, icon('logout')),
      ),
    ),
  );

  const scrim = h('div', { class: 'scrim', onclick: () => closeDrawer() });
  const openDrawer = () => document.body.classList.add('drawer-open');
  const closeDrawer = () => document.body.classList.remove('drawer-open');

  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Menü öffnen', onclick: openDrawer }, icon('menu')),
    title,
    h(
      'div',
      { class: 'topbar-actions' },
      createReminderBell(),
      h('button', { class: 'btn btn-primary topbar-new', type: 'button', onclick: openNewTodo, title: 'Neues Todo (Taste N)' }, icon('plus'), h('span', 'Neues Todo')),
    ),
  );

  const bottomnav = h(
    'nav',
    { class: 'bottomnav', 'aria-label': 'Hauptnavigation' },
    navItem('dashboard', '#/', 'home', 'Übersicht', 'bottom-link'),
    navItem('todos', '#/todos', 'list', 'Todos', 'bottom-link'),
    h('button', { class: 'fab', type: 'button', 'aria-label': 'Neues Todo', onclick: openNewTodo }, icon('plus')),
    navItem('projects', '#/projects', 'folder', 'Projekte', 'bottom-link'),
    navItem('settings', '#/settings', 'sliders', 'Mehr', 'bottom-link'),
  );

  root.replaceChildren(h('div', { class: 'shell' }, sidebar, scrim, h('div', { class: 'main' }, topbar, content), bottomnav));

  function renderUser() {
    userName.textContent = store.user.displayName;
    avatar.textContent = store.user.displayName.charAt(0).toUpperCase();
  }

  function renderProjectsNav() {
    const active = store.projects.filter((p) => !p.archived);
    projectsNav.replaceChildren(
      ...Object.entries(AREAS).map(([area, a]) => {
        const list = active.filter((p) => p.area === area);
        return h(
          'div',
          { class: ['nav-group', `area-${area}`] },
          h('div', { class: 'nav-group-title' }, h('span', { class: 'area-dot' }), a.label),
          list.length
            ? list.map((p) =>
                h(
                  'a',
                  { class: 'nav-project', href: `#/projects/${p.id}`, dataset: { project: String(p.id) } },
                  h('span', { class: 'dot', style: { '--dot': p.color } }),
                  h('span', { class: 'nav-project-name' }, p.name),
                  p.openCount > 0 && h('span', { class: ['nav-count', p.overdueCount > 0 && 'is-overdue'] }, String(p.openCount)),
                ),
              )
            : h('div', { class: 'nav-empty' }, 'Keine Projekte'),
        );
      }),
    );
    highlightProject();
  }

  function highlightProject() {
    const path = location.hash.replace(/^#/, '');
    projectsNav.querySelectorAll('.nav-project').forEach((a) => a.classList.toggle('active', path === `/projects/${a.dataset.project}`));
  }

  function setActive(key) {
    Object.entries(navLinks).forEach(([k, links]) => links.forEach((a) => a.classList.toggle('active', k === key)));
    highlightProject();
  }

  window.addEventListener('projects:changed', renderProjectsNav);
  renderUser();
  renderProjectsNav();

  return {
    content,
    setTitle: (text) => {
      title.textContent = text;
      document.title = `${text} · ToDo`;
    },
    setActive,
    closeDrawer,
    renderUser,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const currentPath = () => location.hash.replace(/^#/, '') || '/';

async function route() {
  if (!store.user || !shell) return;
  const path = currentPath();
  const todoLink = path.match(/^\/todo\/(\d+)$/);
  if (todoLink) {
    // Deep link (e.g. from a notification): open the todo on top of the current page.
    history.replaceState(null, '', '#/');
    if (!currentView) await renderRoute('/');
    openTodoEditor({ id: Number(todoLink[1]) });
    return;
  }
  await renderRoute(path);
}

async function renderRoute(path) {
  const match = ROUTES.find((r) => r.pattern.test(path));
  currentView?.destroy?.();
  currentView = null;
  shell.closeDrawer();
  const container = h('div', { class: 'view' });
  shell.content.replaceChildren(container);
  window.scrollTo(0, 0);

  if (!match) {
    shell.setActive(null);
    shell.setTitle('Nicht gefunden');
    container.append(h('div', { class: 'card' }, emptyState('alert', 'Seite nicht gefunden', 'Diese Adresse gibt es nicht.')));
    return;
  }
  shell.setActive(match.nav);
  const token = (renderToken = Symbol('render'));
  const view = await match.view(container, {
    params: path.match(match.pattern).slice(1),
    setTitle: shell.setTitle,
    setNewTodoDefaults: (d) => (newTodoDefaults = d),
    navigate: (hash) => (location.hash = hash),
    onUserChanged: () => shell.renderUser(),
  });
  if (token !== renderToken) {
    view?.destroy?.();
    return;
  }
  currentView = view || {};
}

async function onDataChanged() {
  try {
    await loadProjects();
  } catch {
    /* handled by views */
  }
  const y = window.scrollY;
  await currentView?.refresh?.();
  window.scrollTo(0, y);
}

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------

function showLogin(message) {
  shell = null;
  currentView = null;
  stopReminderPolling();
  document.title = 'Anmelden · ToDo';
  renderLogin(root, (user) => startApp(user));
  if (message) {
    const err = root.querySelector('.form-error');
    if (err) {
      err.textContent = message;
      err.hidden = false;
    }
  }
}

function showPasswordChange() {
  shell = null;
  stopReminderPolling();
  document.title = 'Passwort ändern · ToDo';
  renderPasswordChange(root, store.user, (user) => startApp(user), logout);
}

async function logout() {
  await detachPushSubscription();
  await signOut();
  store.user = null;
  location.replace(location.pathname);
}

function sessionLost() {
  if (!store.user) return;
  store.user = null;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
}

function installGlobalListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener('hashchange', route);
  window.addEventListener('data:changed', onDataChanged);
  window.addEventListener('auth:expired', sessionLost);
  onSessionLost(sessionLost);
  // Changes made on another device show up when the app comes back to the foreground.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (shell && Date.now() - hiddenAt > 15_000) window.dispatchEvent(new CustomEvent('data:changed'));
  });
  window.addEventListener('auth:password-required', () => {
    if (store.user) {
      store.user.mustChangePassword = true;
      showPasswordChange();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!shell || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const tag = e.target.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openNewTodo();
    }
  });
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && typeof e.data.hash === 'string' && e.data.hash.startsWith('#/')) {
      location.hash = e.data.hash;
    }
  });
}

async function startApp(user) {
  store.user = user;
  installGlobalListeners();
  if (user.mustChangePassword) return showPasswordChange();
  try {
    store.settings = getSettings();
    applyTheme(store.settings.theme);
    await loadProjects();
  } catch (err) {
    if (err.status === 401) return showLogin();
    return showFatal(err);
  }
  shell = buildShell();
  startReminderPolling();
  syncPushSubscription();
  await route();
}

function showFatal(err) {
  root.replaceChildren(
    h(
      'div',
      { class: 'auth-wrap' },
      h(
        'div',
        { class: 'auth-card' },
        emptyState('alert', 'Verbindung fehlgeschlagen', err?.message || 'Der Server ist nicht erreichbar.'),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => location.reload() }, icon('refresh'), 'Erneut versuchen'),
      ),
    ),
  );
}

function showNotConfigured() {
  root.replaceChildren(
    h(
      'div',
      { class: 'auth-wrap' },
      h(
        'div',
        { class: 'auth-card' },
        emptyState('sliders', 'Noch nicht eingerichtet', 'Die App ist noch nicht mit der Datenbank (Supabase) verbunden. Trage Projekt-URL und Schlüssel in config.js ein.'),
      ),
    ),
  );
}

async function boot() {
  if (!isConfigured) return showNotConfigured();
  registerServiceWorker();
  try {
    const user = await currentUser();
    if (user) {
      await startApp(user);
    } else {
      installGlobalListeners();
      showLogin();
    }
  } catch (err) {
    showFatal(err);
  }
}

boot();
