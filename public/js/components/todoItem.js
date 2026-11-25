import { api } from '../api.js';
import { daysFromToday, formatDateTime, formatDue, formatDueLong, formatReminder, isOverdue } from '../dates.js';
import { h, icon } from '../dom.js';
import { AREAS, notifyChanged, projectById } from '../store.js';
import { errorToast, toast } from '../ui.js';
import { openTodoEditor } from './todoEditor.js';

export async function toggleCompleted(todo, completed) {
  await api.patch(`/api/todos/${todo.id}`, { completed });
  if (completed) {
    toast(`„${todo.title}“ erledigt`, {
      type: 'success',
      action: {
        label: 'Rückgängig',
        onClick: () =>
          api
            .patch(`/api/todos/${todo.id}`, { completed: false })
            .then(notifyChanged)
            .catch(errorToast),
      },
    });
  }
}

export function todoItem(todo, { showArea = false, showProject = true } = {}) {
  const overdue = isOverdue(todo);
  const project = todo.projectId ? projectById(todo.projectId) : null;

  const check = h(
    'button',
    {
      class: 'todo-check',
      type: 'button',
      role: 'checkbox',
      'aria-checked': String(todo.completed),
      'aria-label': todo.completed ? 'Wieder als offen markieren' : 'Als erledigt markieren',
      title: todo.completed ? 'Wieder öffnen' : 'Erledigt',
      onclick: async (e) => {
        e.stopPropagation();
        check.disabled = true;
        li.classList.add(todo.completed ? 'is-reopening' : 'is-completing');
        try {
          await toggleCompleted(todo, !todo.completed);
          setTimeout(notifyChanged, 280);
        } catch (err) {
          li.classList.remove('is-completing', 'is-reopening');
          check.disabled = false;
          errorToast(err);
        }
      },
    },
    icon('check'),
  );

  const meta = [];
  if (showArea) {
    meta.push(h('span', { class: ['chip', 'chip-area', `chip-${todo.area}`] }, icon(AREAS[todo.area].icon), AREAS[todo.area].label));
  }
  if (showProject && project) {
    meta.push(
      h('span', { class: 'chip chip-project', title: `Projekt: ${project.name}` }, h('span', { class: 'dot', style: { '--dot': project.color } }), project.name),
    );
  }
  if (todo.dueDate) {
    const today = !overdue && daysFromToday(todo.dueDate) === 0;
    meta.push(
      h(
        'span',
        { class: ['chip', 'chip-due', overdue && 'is-overdue', today && 'is-today'], title: `Fällig: ${formatDueLong(todo)}` },
        icon(overdue ? 'alert' : 'calendar'),
        formatDue(todo),
      ),
    );
  }
  if (todo.reminderAt && !todo.completed) {
    meta.push(
      h(
        'span',
        {
          class: ['chip', 'chip-reminder', todo.reminderDismissed && 'is-muted'],
          title: `Erinnerung: ${formatDateTime(todo.reminderAt)}`,
        },
        icon('bell'),
        formatReminder(todo.reminderAt),
      ),
    );
  }
  if (todo.imageCount) {
    meta.push(h('span', { class: 'chip chip-plain', title: `${todo.imageCount} Bild(er)` }, icon('image'), String(todo.imageCount)));
  }

  const li = h(
    'li',
    {
      class: [
        'todo',
        `area-${todo.area}`,
        todo.completed && 'is-done',
        overdue && 'is-overdue',
        todo.priority === 2 && 'prio-high',
        todo.priority === 0 && 'prio-low',
      ],
      dataset: { id: String(todo.id) },
    },
    check,
    h(
      'button',
      { class: 'todo-main', type: 'button', onclick: () => openTodoEditor({ id: todo.id }) },
      h(
        'span',
        { class: 'todo-title' },
        todo.priority === 2 && h('span', { class: 'prio-flag', title: 'Hohe Priorität' }, icon('flag')),
        h('span', { class: 'todo-title-text' }, todo.title),
      ),
      todo.description && h('span', { class: 'todo-desc' }, todo.description),
      meta.length > 0 && h('span', { class: 'todo-meta' }, meta),
    ),
  );
  return li;
}
