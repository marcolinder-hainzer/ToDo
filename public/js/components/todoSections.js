import { categorize, upcomingGroup } from '../dates.js';
import { h, icon } from '../dom.js';
import { todoItem } from './todoItem.js';

const SECTIONS = [
  { key: 'overdue', title: 'Überfällig', icon: 'alert', empty: 'Nichts überfällig – sehr gut!' },
  { key: 'upcoming', title: 'Anstehend', icon: 'calendar', empty: 'Keine Todos mit Fälligkeitsdatum' },
  { key: 'general', title: 'Allgemein', icon: 'inbox', empty: 'Keine allgemeinen Todos' },
];

function list(items, { grouped, ...itemOpts }) {
  const ul = h('ul', { class: 'todo-list' });
  let lastGroup = null;
  for (const todo of items) {
    if (grouped) {
      const group = upcomingGroup(todo);
      if (group !== lastGroup) {
        ul.append(h('li', { class: 'subgroup-title', role: 'presentation' }, group));
        lastGroup = group;
      }
    }
    ul.append(todoItem(todo, itemOpts));
  }
  return ul;
}

/** Renders the three sections Überfällig / Anstehend / Allgemein. */
export function todoSections(todos, { showArea = false, showProject = true, hideEmpty = [] } = {}) {
  const groups = categorize(todos);
  const wrap = h('div', { class: 'sections' });
  for (const s of SECTIONS) {
    const items = groups[s.key];
    if (!items.length && hideEmpty.includes(s.key)) continue;
    wrap.append(
      h(
        'section',
        { class: ['section', `section-${s.key}`, !items.length && 'is-empty'] },
        h(
          'h3',
          { class: 'section-title' },
          icon(s.icon),
          h('span', s.title),
          h('span', { class: 'count' }, String(items.length)),
        ),
        items.length
          ? list(items, { grouped: s.key === 'upcoming', showArea, showProject })
          : h('p', { class: 'section-empty' }, s.empty),
      ),
    );
  }
  return wrap;
}

export function counts(todos) {
  const g = categorize(todos);
  return { overdue: g.overdue.length, upcoming: g.upcoming.length, general: g.general.length };
}
