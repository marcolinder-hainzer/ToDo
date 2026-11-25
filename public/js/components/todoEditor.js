import { api } from '../api.js';
import { addDays, formatDateTime, fromLocalInput, toDateStr, toLocalInput, todayStr } from '../dates.js';
import { h, icon } from '../dom.js';
import { AREAS, PRIORITIES, loadProjects, notifyChanged, projectById, store } from '../store.js';
import { confirmDialog, errorToast, field, openDialog, segmented, setBusy, toast } from '../ui.js';
import { openLightbox } from './lightbox.js';

const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_DIMENSION = 2560;

/** Downscale big photos (e.g. from phone cameras) before upload; convert exotic formats to JPEG. */
async function prepareImage(file) {
  const convert = !SUPPORTED.includes(file.type);
  if (!convert && (file.type === 'image/gif' || file.size < 1.5 * 1024 * 1024)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
    if (!blob || (!convert && blob.size >= file.size)) return file;
    const base = (file.name || 'bild').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}${type === 'image/png' ? '.png' : '.jpg'}`, { type });
  } catch {
    return file;
  }
}

async function uploadImages(todoId, files) {
  const uploaded = [];
  for (let i = 0; i < files.length; i += 10) {
    const form = new FormData();
    for (const f of files.slice(i, i + 10)) form.append('images', f, f.name || 'bild.jpg');
    uploaded.push(...(await api.upload(`/api/todos/${todoId}/images`, form)));
  }
  return uploaded;
}

function nextMonday() {
  const d = new Date();
  const diff = ((8 - d.getDay()) % 7) || 7;
  return addDays(d, diff);
}

function atTime(date, hours, minutes = 0) {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Opens the create/edit dialog.
 *  openTodoEditor({ id })                      – edit existing todo
 *  openTodoEditor({ defaults: { area, projectId, dueDate } }) – new todo
 */
export async function openTodoEditor({ id = null, defaults = {}, onClose } = {}) {
  let todo = null;
  try {
    if (id) todo = await api.get(`/api/todos/${id}`);
    if (!store.projects.length) await loadProjects();
  } catch (err) {
    errorToast(err);
    onClose?.();
    return;
  }

  const isNew = !todo;
  const defaultProject = defaults.projectId ? projectById(defaults.projectId) : null;
  const state = {
    title: todo?.title ?? defaults.title ?? '',
    description: todo?.description ?? '',
    area: todo?.area ?? defaultProject?.area ?? defaults.area ?? 'work',
    projectId: todo?.projectId ?? defaultProject?.id ?? null,
    priority: todo?.priority ?? 1,
    dueDate: todo?.dueDate ?? defaults.dueDate ?? '',
    dueTime: todo?.dueTime ?? '',
    reminderAt: todo?.reminderAt ?? null,
  };
  let images = todo?.images ? [...todo.images] : [];
  const pending = []; // images chosen before a new todo exists: { file, url }
  let dirty = false;
  let imagesChanged = false;
  const markDirty = () => (dirty = true);

  // ---- Title & description ------------------------------------------------
  const titleInput = h('input', {
    class: 'input input-title',
    value: state.title,
    maxlength: 200,
    placeholder: 'Was ist zu tun?',
    'aria-label': 'Titel',
    oninput: (e) => {
      state.title = e.target.value;
      titleInput.classList.remove('is-invalid');
      markDirty();
    },
  });

  const autoGrow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 420)}px`;
  };
  const descInput = h('textarea', {
    class: 'input textarea',
    rows: 4,
    maxlength: 10000,
    placeholder: 'Kurze Beschreibung, Notizen, Links …',
    value: state.description,
    oninput: (e) => {
      state.description = e.target.value;
      autoGrow(e.target);
      markDirty();
    },
  });

  // ---- Area & project -----------------------------------------------------
  const projectSelect = h('select', {
    class: 'input',
    onchange: (e) => {
      state.projectId = e.target.value ? Number(e.target.value) : null;
      markDirty();
    },
  });
  function renderProjectOptions() {
    const options = store.projects.filter((p) => p.area === state.area && (!p.archived || p.id === state.projectId));
    projectSelect.replaceChildren(
      h('option', { value: '' }, 'Kein Projekt'),
      ...options.map((p) => h('option', { value: String(p.id) }, p.name + (p.archived ? ' (archiviert)' : ''))),
    );
    projectSelect.value = state.projectId ? String(state.projectId) : '';
  }
  renderProjectOptions();

  const areaControl = segmented(
    Object.entries(AREAS).map(([value, a]) => ({ value, label: a.label, icon: a.icon, className: `seg-${value}` })),
    state.area,
    (value) => {
      state.area = value;
      if (state.projectId && projectById(state.projectId)?.area !== value) state.projectId = null;
      renderProjectOptions();
      markDirty();
    },
    { name: 'Bereich' },
  );

  // ---- Due date -----------------------------------------------------------
  const dueDateInput = h('input', { class: 'input', type: 'date', value: state.dueDate, 'aria-label': 'Fälligkeitsdatum' });
  const dueTimeInput = h('input', { class: 'input input-time', type: 'time', value: state.dueTime, 'aria-label': 'Uhrzeit (optional)' });
  function setDue(date, time = state.dueTime) {
    state.dueDate = date || '';
    state.dueTime = state.dueDate ? time || '' : '';
    dueDateInput.value = state.dueDate;
    dueTimeInput.value = state.dueTime;
    dueTimeInput.disabled = !state.dueDate;
    markDirty();
    renderReminderPresets();
  }
  dueDateInput.addEventListener('change', () => setDue(dueDateInput.value));
  dueTimeInput.addEventListener('change', () => setDue(state.dueDate, dueTimeInput.value));
  dueTimeInput.disabled = !state.dueDate;

  const dueChips = h(
    'div',
    { class: 'quick-chips' },
    h('button', { type: 'button', class: 'chip-btn', onclick: () => setDue(todayStr()) }, 'Heute'),
    h('button', { type: 'button', class: 'chip-btn', onclick: () => setDue(toDateStr(addDays(new Date(), 1))) }, 'Morgen'),
    h('button', { type: 'button', class: 'chip-btn', onclick: () => setDue(toDateStr(nextMonday())) }, 'Nächste Woche'),
    h('button', { type: 'button', class: 'chip-btn chip-btn-clear', onclick: () => setDue('') }, icon('x'), 'Kein Datum'),
  );

  // ---- Reminder -----------------------------------------------------------
  const reminderInput = h('input', {
    class: 'input',
    type: 'datetime-local',
    value: toLocalInput(state.reminderAt),
    'aria-label': 'Erinnerung',
    onchange: (e) => setReminder(fromLocalInput(e.target.value)),
  });
  const reminderNote = h('div', { class: 'field-hint' });
  const reminderChips = h('div', { class: 'quick-chips' });

  function setReminder(iso) {
    state.reminderAt = iso;
    reminderInput.value = toLocalInput(iso);
    markDirty();
    renderReminderNote();
  }
  function renderReminderNote() {
    let note = '';
    if (state.reminderAt && new Date(state.reminderAt) < new Date()) note = 'Dieser Zeitpunkt liegt in der Vergangenheit.';
    if (todo && state.reminderAt && state.reminderAt === todo.reminderAt) {
      if (todo.reminderDismissed) note = 'Erinnerung wurde bereits erledigt/ausgeblendet.';
      else if (todo.reminderSentAt) note = `Erinnerung wurde am ${formatDateTime(todo.reminderSentAt)} gesendet.`;
    }
    reminderNote.textContent = note;
    reminderNote.hidden = !note;
  }
  function renderReminderPresets() {
    const now = new Date();
    const presets = [
      { label: 'In 1 Std.', at: new Date(now.getTime() + 60 * 60 * 1000) },
      now.getHours() < 17 && { label: 'Heute 18:00', at: atTime(now, 18) },
      { label: 'Morgen 9:00', at: atTime(addDays(now, 1), 9) },
    ];
    if (state.dueDate) {
      const [y, m, d] = state.dueDate.split('-').map(Number);
      const dueDay = new Date(y, m - 1, d);
      presets.push({ label: 'Am Fälligkeitstag 9:00', at: atTime(dueDay, 9) });
      presets.push({ label: '1 Tag vorher', at: atTime(addDays(dueDay, -1), 9) });
      if (state.dueTime) {
        const [hh, mm] = state.dueTime.split(':').map(Number);
        presets.push({ label: '1 Std. vor Fälligkeit', at: new Date(atTime(dueDay, hh, mm).getTime() - 3600_000) });
      }
    }
    reminderChips.replaceChildren(
      ...presets
        .filter((p) => p && p.at > now)
        .map((p) => h('button', { type: 'button', class: 'chip-btn', onclick: () => setReminder(p.at.toISOString()) }, p.label)),
      h('button', { type: 'button', class: 'chip-btn chip-btn-clear', onclick: () => setReminder(null) }, icon('x'), 'Keine'),
    );
  }
  renderReminderPresets();
  renderReminderNote();

  // ---- Priority -----------------------------------------------------------
  const priorityControl = segmented(
    PRIORITIES.map((p) => ({ ...p, className: `seg-prio-${p.value}` })),
    state.priority,
    (value) => {
      state.priority = value;
      markDirty();
    },
    { name: 'Priorität', small: true },
  );

  // ---- Images -------------------------------------------------------------
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    onchange: (e) => {
      addFiles([...e.target.files]);
      e.target.value = '';
    },
  });
  const thumbs = h('div', { class: 'thumbs' });
  const dropzone = h(
    'div',
    { class: 'dropzone' },
    thumbs,
    fileInput,
  );

  function renderThumbs(busy = false) {
    const viewable = [...images.map((img) => ({ url: img.url, originalName: img.originalName })), ...pending.map((p) => ({ url: p.url, originalName: p.file.name }))];
    const tiles = [
      ...images.map((img, i) =>
        h(
          'div',
          { class: 'thumb' },
          h('button', { type: 'button', class: 'thumb-open', 'aria-label': `Bild öffnen: ${img.originalName}`, onclick: () => openLightbox(viewable, i) }, h('img', { src: img.url, alt: img.originalName, loading: 'lazy' })),
          h('button', { type: 'button', class: 'thumb-remove', 'aria-label': 'Bild entfernen', onclick: () => removeImage(img) }, icon('x')),
        ),
      ),
      ...pending.map((p, i) =>
        h(
          'div',
          { class: 'thumb is-pending' },
          h('button', { type: 'button', class: 'thumb-open', onclick: () => openLightbox(viewable, images.length + i) }, h('img', { src: p.url, alt: p.file.name })),
          h(
            'button',
            {
              type: 'button',
              class: 'thumb-remove',
              'aria-label': 'Bild entfernen',
              onclick: () => {
                URL.revokeObjectURL(p.url);
                pending.splice(pending.indexOf(p), 1);
                renderThumbs();
              },
            },
            icon('x'),
          ),
        ),
      ),
      h(
        'button',
        { type: 'button', class: ['thumb', 'thumb-add', busy && 'is-busy'], disabled: busy, onclick: () => fileInput.click() },
        busy ? h('span', { class: 'spinner spinner-sm' }) : icon('plus'),
        h('span', busy ? 'Lädt hoch…' : 'Bild hinzufügen'),
      ),
    ];
    thumbs.replaceChildren(...tiles);
  }

  async function addFiles(files) {
    const list = files.filter((f) => !f.type || f.type.startsWith('image/'));
    if (!list.length) return;
    renderThumbs(true);
    try {
      const prepared = await Promise.all(list.map(prepareImage));
      if (isNew && !todo) {
        prepared.forEach((file) => pending.push({ file, url: URL.createObjectURL(file) }));
        markDirty();
      } else {
        const uploaded = await uploadImages(todo.id, prepared);
        images.push(...uploaded);
        imagesChanged = true;
      }
    } catch (err) {
      errorToast(err);
    }
    renderThumbs();
  }

  async function removeImage(img) {
    const { ok } = await confirmDialog({ title: 'Bild löschen?', message: img.originalName, confirmLabel: 'Löschen' });
    if (!ok) return;
    try {
      await api.del(`/api/images/${img.id}`);
      images = images.filter((i) => i.id !== img.id);
      imagesChanged = true;
      renderThumbs();
    } catch (err) {
      errorToast(err);
    }
  }
  renderThumbs();

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    addFiles([...(e.dataTransfer?.files || [])]);
  });

  // ---- Footer ---------------------------------------------------------------
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check'), isNew ? 'Hinzufügen' : 'Speichern');
  const completeBtn =
    todo &&
    h(
      'button',
      { class: 'btn btn-ghost', type: 'button', onclick: () => save({ completed: !todo.completed }) },
      icon(todo.completed ? 'undo' : 'checkCircle'),
      todo.completed ? 'Wieder öffnen' : 'Erledigt',
    );
  const deleteBtn =
    todo &&
    h(
      'button',
      {
        class: 'btn btn-ghost btn-danger-text',
        type: 'button',
        onclick: async () => {
          const { ok } = await confirmDialog({
            title: 'Todo löschen?',
            message: `„${todo.title}“ wird inklusive Bilder endgültig gelöscht.`,
          });
          if (!ok) return;
          try {
            await api.del(`/api/todos/${todo.id}`);
            dirty = false;
            imagesChanged = false;
            dialog.close();
            toast('Todo gelöscht');
            notifyChanged();
          } catch (err) {
            errorToast(err);
          }
        },
      },
      icon('trash'),
      h('span', { class: 'hide-sm' }, 'Löschen'),
    );

  async function save(extra = {}) {
    state.title = titleInput.value.trim();
    if (!state.title) {
      titleInput.classList.add('is-invalid');
      titleInput.focus();
      toast('Bitte gib einen Titel ein', { type: 'error' });
      return;
    }
    const payload = {
      title: state.title,
      description: state.description,
      area: state.area,
      projectId: state.projectId,
      priority: state.priority,
      dueDate: state.dueDate || null,
      dueTime: state.dueTime || null,
      reminderAt: state.reminderAt,
      ...extra,
    };
    setBusy(saveBtn, true);
    try {
      let saved;
      if (todo) {
        saved = await api.patch(`/api/todos/${todo.id}`, payload);
      } else {
        saved = await api.post('/api/todos', payload);
        todo = saved;
        if (pending.length) {
          try {
            await uploadImages(saved.id, pending.map((p) => p.file));
          } catch (err) {
            toast(`Todo gespeichert, aber Bilder konnten nicht hochgeladen werden: ${err.message}`, { type: 'error', duration: 8000 });
          }
          pending.forEach((p) => URL.revokeObjectURL(p.url));
          pending.length = 0;
        }
      }
      dirty = false;
      imagesChanged = false;
      dialog.close();
      if (extra.completed === true) toast(`„${saved.title}“ erledigt`, { type: 'success' });
      else if (isNew) toast('Todo hinzugefügt', { type: 'success' });
      notifyChanged();
    } catch (err) {
      errorToast(err);
    } finally {
      setBusy(saveBtn, false);
    }
  }

  // ---- Layout -------------------------------------------------------------
  const meta =
    todo &&
    h(
      'div',
      { class: 'editor-meta' },
      `Erstellt ${formatDateTime(todo.createdAt)}`,
      todo.completedAt && ` · Erledigt ${formatDateTime(todo.completedAt)}`,
    );

  const form = h(
    'form',
    {
      class: 'editor',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        save();
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
      },
      onpaste: (e) => {
        const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (files.length) {
          e.preventDefault();
          addFiles(files);
        }
      },
    },
    h(
      'div',
      { class: 'editor-grid' },
      h('div', { class: 'editor-main' }, titleInput, field('Beschreibung', descInput)),
      h(
        'div',
        { class: 'editor-images field' },
        h('span', { class: 'field-label' }, icon('image'), 'Bilder'),
        dropzone,
        h('span', { class: 'field-hint hint-desktop' }, 'Tipp: Bilder hierher ziehen oder mit Strg+V einfügen.'),
      ),
      h(
        'div',
        { class: 'editor-side' },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Bereich'), areaControl),
        field('Projekt', projectSelect),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, icon('calendar'), 'Fällig am'), h('div', { class: 'input-row' }, dueDateInput, dueTimeInput), dueChips),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, icon('bell'), 'Erinnerung'), reminderInput, reminderChips, reminderNote),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, icon('flag'), 'Priorität'), priorityControl),
        meta,
      ),
    ),
    h('footer', { class: 'dialog-foot editor-foot' }, deleteBtn, h('div', { class: 'spacer' }), completeBtn, saveBtn),
  );

  const dialog = openDialog({
    title: isNew ? 'Neues Todo' : todo.completed ? 'Erledigtes Todo' : 'Todo bearbeiten',
    body: form,
    wide: true,
    className: 'dialog-editor',
    dismissable: true,
    onRequestClose: async () => {
      if (!dirty) return true;
      const { ok } = await confirmDialog({
        title: 'Änderungen verwerfen?',
        message: 'Du hast ungespeicherte Änderungen.',
        confirmLabel: 'Verwerfen',
      });
      return ok;
    },
    onClose: () => {
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      if (imagesChanged) notifyChanged();
      onClose?.();
    },
  });

  requestAnimationFrame(() => {
    autoGrow(descInput);
    if (isNew) titleInput.focus();
  });
}
