import { openProjectEditor } from '../components/projectEditor.js';
import { h, icon } from '../dom.js';
import { AREAS, loadProjects, store } from '../store.js';
import { emptyState, errorToast } from '../ui.js';

let showArchived = false;

function projectCard(p) {
  const total = p.openCount + p.doneCount;
  const pct = total ? Math.round((p.doneCount / total) * 100) : 0;
  return h(
    'a',
    { class: ['project-card', p.archived && 'is-archived'], href: `#/projects/${p.id}`, style: { '--project': p.color } },
    h('div', { class: 'project-card-top' }, h('span', { class: 'project-dot' }), h('h3', { class: 'project-name' }, p.name), p.archived && h('span', { class: 'badge' }, 'Archiviert')),
    p.description ? h('p', { class: 'project-desc' }, p.description) : h('p', { class: 'project-desc muted' }, 'Keine Beschreibung'),
    h(
      'div',
      { class: 'project-stats' },
      h('span', `${p.openCount} offen`),
      p.overdueCount > 0 && h('span', { class: 'stat-overdue' }, icon('alert'), `${p.overdueCount} überfällig`),
      h('span', { class: 'muted' }, `${p.doneCount} erledigt`),
    ),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Fortschritt' }, h('span', { style: { width: `${pct}%` } })),
  );
}

export async function projectsView(root, { setTitle, setNewTodoDefaults }) {
  setTitle('Projekte');
  setNewTodoDefaults({ area: 'work' });
  const content = h('div');

  const archivedToggle = h('input', {
    type: 'checkbox',
    checked: showArchived,
    onchange: (e) => {
      showArchived = e.target.checked;
      render();
    },
  });

  root.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', h('h1', 'Projekte'), h('p', { class: 'muted' }, 'Gruppiere zusammengehörige Todos in Projekten.')),
      h(
        'div',
        { class: 'row' },
        h('label', { class: 'check-row' }, archivedToggle, h('span', 'Archivierte anzeigen')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openProjectEditor() }, icon('plus'), 'Neues Projekt'),
      ),
    ),
    content,
  );

  function render() {
    const projects = store.projects.filter((p) => showArchived || !p.archived);
    content.replaceChildren(
      ...Object.entries(AREAS).map(([area, a]) => {
        const list = projects.filter((p) => p.area === area);
        return h(
          'section',
          { class: ['project-area', `area-${area}`] },
          h(
            'header',
            { class: 'project-area-head' },
            h('span', { class: 'area-icon' }, icon(a.icon)),
            h('h2', a.label),
            h('span', { class: 'count' }, String(list.length)),
            h('div', { class: 'spacer' }),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openProjectEditor({ defaults: { area } }) }, icon('plus'), 'Projekt'),
          ),
          list.length
            ? h('div', { class: 'project-grid' }, list.map(projectCard))
            : h('div', { class: 'card' }, emptyState('folder', `Noch keine ${a.label === 'Privat' ? 'privaten' : 'beruflichen'} Projekte`, 'Lege ein Projekt an, um Todos zu gruppieren.')),
        );
      }),
    );
  }

  async function load() {
    try {
      await loadProjects();
      render();
    } catch (err) {
      errorToast(err);
    }
  }
  render();
  await load();
  return { refresh: load };
}
