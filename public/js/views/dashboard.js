import { createTodo, listTodos, saveSettings } from '../data.js';
import { todoSections, counts } from '../components/todoSections.js';
import { formatFullDate, greeting } from '../dates.js';
import { h, icon } from '../dom.js';
import { AREAS, notifyChanged, store } from '../store.js';
import { errorToast, segmented, toast } from '../ui.js';
import { openTodoEditor } from '../components/todoEditor.js';

function quickAdd(area) {
  const input = h('input', {
    class: 'input',
    placeholder: `Neues ${AREAS[area].adjective} Todo…`,
    maxlength: 200,
    'aria-label': `Neues ${AREAS[area].adjective} Todo`,
  });
  const form = h(
    'form',
    {
      class: 'quick-add',
      onsubmit: async (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        input.disabled = true;
        try {
          await createTodo({ title, area });
          input.value = '';
          toast('Todo hinzugefügt', { type: 'success', duration: 2000 });
          notifyChanged();
        } catch (err) {
          errorToast(err);
        } finally {
          input.disabled = false;
          input.focus();
        }
      },
    },
    icon('plus'),
    input,
    h(
      'button',
      { class: 'icon-btn', type: 'button', title: 'Mit Details anlegen', 'aria-label': 'Mit Details anlegen', onclick: () => openTodoEditor({ defaults: { area, title: input.value.trim() } }) },
      icon('edit'),
    ),
  );
  return form;
}

function areaColumn(area, todos) {
  const c = counts(todos);
  return h(
    'section',
    { class: ['area-col', `area-${area}`], 'aria-label': AREAS[area].label },
    h(
      'header',
      { class: 'area-head' },
      h('span', { class: 'area-icon' }, icon(AREAS[area].icon)),
      h('h2', AREAS[area].label),
      h(
        'div',
        { class: 'area-stats' },
        c.overdue > 0 && h('span', { class: 'stat stat-overdue', title: 'Überfällig' }, icon('alert'), String(c.overdue)),
        h('span', { class: 'stat', title: 'Offene Todos' }, `${todos.length} offen`),
      ),
    ),
    quickAdd(area),
    todoSections(todos, { showProject: true }),
  );
}

export async function dashboardView(root, { setTitle, setNewTodoDefaults }) {
  setTitle('Übersicht');
  let areaFilter = store.settings?.dashboardArea || 'both';
  setNewTodoDefaults({ area: areaFilter === 'both' ? 'work' : areaFilter });

  const board = h('div', { class: 'board' });
  const filter = segmented(
    [
      { value: 'both', label: 'Beides' },
      { value: 'work', label: 'Beruflich', icon: 'briefcase', className: 'seg-work' },
      { value: 'private', label: 'Privat', icon: 'user', className: 'seg-private' },
    ],
    areaFilter,
    (value) => {
      areaFilter = value;
      setNewTodoDefaults({ area: value === 'both' ? 'work' : value });
      store.settings.dashboardArea = value;
      saveSettings({ dashboardArea: value }).catch(() => {});
      render();
    },
    { name: 'Bereich anzeigen' },
  );

  root.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', h('h1', { class: 'page-greeting' }, `${greeting()}, ${store.user.displayName}`), h('p', { class: 'muted' }, formatFullDate())),
      filter,
    ),
    board,
  );

  let todos = [];
  function render() {
    const areas = areaFilter === 'both' ? ['work', 'private'] : [areaFilter];
    board.classList.toggle('board-single', areas.length === 1);
    board.replaceChildren(...areas.map((a) => areaColumn(a, todos.filter((t) => t.area === a))));
  }

  async function load() {
    try {
      todos = await listTodos({ status: 'open' });
      render();
    } catch (err) {
      errorToast(err);
    }
  }
  board.append(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
  await load();
  return { refresh: load };
}
