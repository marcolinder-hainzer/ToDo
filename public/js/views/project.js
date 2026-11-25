import { api } from '../api.js';
import { openProjectEditor } from '../components/projectEditor.js';
import { openTodoEditor } from '../components/todoEditor.js';
import { todoItem } from '../components/todoItem.js';
import { todoSections } from '../components/todoSections.js';
import { append, clear, h, icon } from '../dom.js';
import { AREAS, loadProjects, notifyChanged, projectById } from '../store.js';
import { confirmDialog, emptyState, errorToast, toast } from '../ui.js';

export async function projectView(root, { params, setTitle, setNewTodoDefaults, navigate }) {
  const projectId = Number(params[0]);
  let showDone = false;
  const head = h('div');
  const body = h('div');
  root.replaceChildren(head, body);

  async function load() {
    let project;
    let open;
    let done;
    try {
      await loadProjects();
      project = projectById(projectId);
      if (!project) {
        setTitle('Projekt');
        root.replaceChildren(h('div', { class: 'card' }, emptyState('folder', 'Projekt nicht gefunden', 'Vielleicht wurde es gelöscht.')));
        return;
      }
      [open, done] = await Promise.all([
        api.get(`/api/todos?status=open&project=${projectId}`),
        api.get(`/api/todos?status=done&project=${projectId}&limit=200`),
      ]);
    } catch (err) {
      errorToast(err);
      return;
    }

    setTitle(project.name);
    setNewTodoDefaults({ area: project.area, projectId: project.id });
    const total = project.openCount + project.doneCount;
    const pct = total ? Math.round((project.doneCount / total) * 100) : 0;

    head.replaceChildren(
      h(
        'div',
        { class: ['project-hero', project.archived && 'is-archived'], style: { '--project': project.color } },
        h(
          'div',
          { class: 'project-hero-main' },
          h('a', { class: 'back-link', href: '#/projects' }, icon('chevronLeft'), 'Projekte'),
          h('h1', { class: 'project-hero-title' }, h('span', { class: 'project-dot' }), project.name, project.archived && h('span', { class: 'badge' }, 'Archiviert')),
          h('div', { class: 'project-hero-meta' }, h('span', { class: ['chip', 'chip-area', `chip-${project.area}`] }, icon(AREAS[project.area].icon), AREAS[project.area].label), h('span', { class: 'muted' }, `${project.openCount} offen · ${project.doneCount} erledigt`)),
          project.description && h('p', { class: 'project-hero-desc' }, project.description),
          h('div', { class: 'progress' }, h('span', { style: { width: `${pct}%` } })),
        ),
        h(
          'div',
          { class: 'project-hero-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openTodoEditor({ defaults: { projectId: project.id } }) }, icon('plus'), 'Todo'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => openProjectEditor({ project }) }, icon('edit'), 'Bearbeiten'),
          h(
            'button',
            {
              class: 'btn btn-ghost',
              type: 'button',
              onclick: async () => {
                try {
                  await api.patch(`/api/projects/${project.id}`, { archived: !project.archived });
                  toast(project.archived ? 'Projekt wiederhergestellt' : 'Projekt archiviert');
                  await loadProjects();
                  notifyChanged();
                } catch (err) {
                  errorToast(err);
                }
              },
            },
            icon('archive'),
            project.archived ? 'Wiederherstellen' : 'Archivieren',
          ),
          h(
            'button',
            {
              class: 'btn btn-ghost btn-danger-text',
              type: 'button',
              onclick: async () => {
                const { ok, checked } = await confirmDialog({
                  title: 'Projekt löschen?',
                  message: `„${project.name}“ wird gelöscht. Die Todos bleiben ohne Projekt erhalten – außer du wählst unten etwas anderes.`,
                  checkbox: { label: `Auch alle ${total} Todos dieses Projekts löschen`, checked: false },
                });
                if (!ok) return;
                try {
                  await api.del(`/api/projects/${project.id}${checked ? '?deleteTodos=1' : ''}`);
                  toast('Projekt gelöscht');
                  await loadProjects();
                  navigate('#/projects');
                } catch (err) {
                  errorToast(err);
                }
              },
            },
            icon('trash'),
            'Löschen',
          ),
        ),
      ),
    );

    const doneToggle = h(
      'button',
      {
        class: 'section-toggle',
        type: 'button',
        'aria-expanded': String(showDone),
        onclick: () => {
          showDone = !showDone;
          load();
        },
      },
      icon(showDone ? 'chevronDown' : 'chevronRight'),
      `Erledigt (${done.length})`,
    );

    clear(body);
    append(body, [
      h('div', { class: 'card list-card' }, open.length ? todoSections(open, { showProject: false }) : emptyState('checkCircle', 'Keine offenen Todos', 'Lege oben ein neues Todo für dieses Projekt an.')),
      done.length > 0 &&
        h(
          'div',
          { class: 'card list-card' },
          doneToggle,
          showDone && h('ul', { class: 'todo-list' }, done.map((t) => todoItem(t, { showProject: false }))),
        ),
    ]);
  }

  await load();
  return { refresh: load };
}
