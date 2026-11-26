import { createProject, updateProject } from '../data.js';
import { h, icon } from '../dom.js';
import { AREAS, loadProjects, notifyChanged } from '../store.js';
import { errorToast, field, openDialog, segmented, setBusy, toast } from '../ui.js';

export const PROJECT_COLORS = [
  '#6366f1', '#2563eb', '#0ea5e9', '#14b8a6', '#10b981', '#84cc16',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b',
];

/** Create or edit a project. Resolves with the saved project (or null). */
export function openProjectEditor({ project = null, defaults = {} } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const state = {
      name: project?.name ?? '',
      description: project?.description ?? '',
      area: project?.area ?? defaults.area ?? 'work',
      color: project?.color ?? PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
    };

    const nameInput = h('input', { class: 'input', value: state.name, maxlength: 80, placeholder: 'z. B. Website-Relaunch', required: true });
    const descInput = h('textarea', { class: 'input textarea', rows: 3, maxlength: 2000, value: state.description, placeholder: 'Worum geht es in diesem Projekt?' });
    const areaControl = segmented(
      Object.entries(AREAS).map(([value, a]) => ({ value, label: a.label, icon: a.icon, className: `seg-${value}` })),
      state.area,
      (v) => (state.area = v),
      { name: 'Bereich' },
    );

    const customColor = h('input', { type: 'color', class: 'color-input', value: state.color, 'aria-label': 'Eigene Farbe' });
    const swatches = h('div', { class: 'swatches' });
    function renderSwatches() {
      swatches.replaceChildren(
        ...PROJECT_COLORS.map((c) =>
          h('button', {
            type: 'button',
            class: ['swatch', c === state.color && 'active'],
            style: { '--swatch': c },
            'aria-label': `Farbe ${c}`,
            'aria-pressed': String(c === state.color),
            onclick: () => {
              state.color = c;
              customColor.value = c;
              renderSwatches();
            },
          }),
        ),
        h('label', { class: ['swatch', 'swatch-custom', !PROJECT_COLORS.includes(state.color) && 'active'], title: 'Eigene Farbe', style: { '--swatch': state.color } }, customColor),
      );
    }
    customColor.addEventListener('input', () => {
      state.color = customColor.value;
      renderSwatches();
    });
    renderSwatches();

    const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), project ? 'Speichern' : 'Projekt anlegen');
    const form = h(
      'form',
      {
        class: 'stack',
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const name = nameInput.value.trim();
          if (!name) {
            nameInput.classList.add('is-invalid');
            nameInput.focus();
            return;
          }
          const payload = { name, description: descInput.value, area: state.area, color: state.color };
          setBusy(saveBtn, true);
          try {
            result = project ? await updateProject(project.id, payload) : await createProject(payload);
            await loadProjects();
            notifyChanged();
            toast(project ? 'Projekt gespeichert' : 'Projekt angelegt', { type: 'success' });
            dialog.close();
          } catch (err) {
            errorToast(err);
          } finally {
            setBusy(saveBtn, false);
          }
        },
      },
      field('Name', nameInput),
      field('Beschreibung', descInput),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Bereich'), areaControl,
        project && state.area && h('span', { class: 'field-hint' }, 'Beim Wechsel des Bereichs werden alle Todos des Projekts mitverschoben.')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Farbe'), swatches),
      h('footer', { class: 'dialog-foot' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Abbrechen'), saveBtn),
    );

    const dialog = openDialog({
      title: project ? 'Projekt bearbeiten' : 'Neues Projekt',
      body: form,
      onClose: () => resolve(result),
    });
    nameInput.focus();
  });
}
