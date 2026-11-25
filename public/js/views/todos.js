import { api } from '../api.js';
import { todoItem } from '../components/todoItem.js';
import { todoSections } from '../components/todoSections.js';
import { h, icon, debounce } from '../dom.js';
import { store } from '../store.js';
import { emptyState, errorToast, segmented } from '../ui.js';

const filters = { q: '', area: '', project: '', status: 'open', view: 'sections' };

export async function todosView(root, { setTitle, setNewTodoDefaults }) {
  setTitle('Alle Todos');
  setNewTodoDefaults({ area: filters.area || 'work' });

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Suchen in Titel und Beschreibung…',
    value: filters.q,
    'aria-label': 'Suche',
    oninput: debounce((e) => {
      filters.q = e.target.value;
      load();
    }, 250),
  });

  const projectSelect = h('select', {
    class: 'input',
    'aria-label': 'Projekt',
    onchange: (e) => {
      filters.project = e.target.value;
      load();
    },
  });
  function renderProjectOptions() {
    const list = store.projects.filter((p) => !filters.area || p.area === filters.area);
    if (filters.project && filters.project !== 'none' && !list.some((p) => String(p.id) === filters.project)) filters.project = '';
    projectSelect.replaceChildren(
      h('option', { value: '' }, 'Alle Projekte'),
      h('option', { value: 'none' }, 'Ohne Projekt'),
      ...list.map((p) => h('option', { value: String(p.id) }, p.name + (p.archived ? ' (archiviert)' : ''))),
    );
    projectSelect.value = filters.project;
  }
  renderProjectOptions();

  const areaControl = segmented(
    [
      { value: '', label: 'Alle' },
      { value: 'work', label: 'Beruflich', icon: 'briefcase', className: 'seg-work' },
      { value: 'private', label: 'Privat', icon: 'user', className: 'seg-private' },
    ],
    filters.area,
    (v) => {
      filters.area = v;
      setNewTodoDefaults({ area: v || 'work' });
      renderProjectOptions();
      load();
    },
    { name: 'Bereich', small: true },
  );
  const statusControl = segmented(
    [
      { value: 'open', label: 'Offen' },
      { value: 'done', label: 'Erledigt' },
      { value: 'all', label: 'Alle' },
    ],
    filters.status,
    (v) => {
      filters.status = v;
      load();
    },
    { name: 'Status', small: true },
  );

  const summary = h('div', { class: 'list-summary muted' });
  const results = h('div', { class: 'card list-card' });

  root.replaceChildren(
    h(
      'div',
      { class: 'filter-bar card' },
      h('div', { class: 'search-box' }, icon('search'), search),
      h('div', { class: 'filter-row' }, areaControl, statusControl, projectSelect),
    ),
    summary,
    results,
  );

  async function load() {
    const params = new URLSearchParams({ status: filters.status });
    if (filters.area) params.set('area', filters.area);
    if (filters.project) params.set('project', filters.project);
    if (filters.q.trim()) params.set('q', filters.q.trim());
    try {
      const todos = await api.get(`/api/todos?${params}`);
      summary.textContent = `${todos.length} ${todos.length === 1 ? 'Todo' : 'Todos'}`;
      if (!todos.length) {
        results.replaceChildren(
          emptyState(filters.q ? 'search' : 'checkCircle', filters.q ? 'Keine Treffer' : 'Keine Todos', filters.q ? 'Versuche einen anderen Suchbegriff.' : 'Hier ist gerade nichts zu tun.'),
        );
        return;
      }
      if (filters.status === 'open') {
        results.replaceChildren(todoSections(todos, { showArea: !filters.area, showProject: true }));
      } else {
        const open = todos.filter((t) => !t.completed);
        const done = todos.filter((t) => t.completed);
        results.replaceChildren(
          open.length ? todoSections(open, { showArea: !filters.area }) : '',
          done.length
            ? h(
                'section',
                { class: 'section section-done' },
                h('h3', { class: 'section-title' }, icon('checkCircle'), h('span', 'Erledigt'), h('span', { class: 'count' }, String(done.length))),
                h('ul', { class: 'todo-list' }, done.map((t) => todoItem(t, { showArea: !filters.area }))),
              )
            : '',
        );
      }
    } catch (err) {
      errorToast(err);
    }
  }

  const onProjects = () => renderProjectOptions();
  window.addEventListener('projects:changed', onProjects);
  await load();
  return { refresh: load, destroy: () => window.removeEventListener('projects:changed', onProjects) };
}
