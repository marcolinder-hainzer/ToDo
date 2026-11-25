import { Router } from 'express';
import { now, q, tx, unlinkImageFiles } from '../db.js';
import {
  area,
  badRequest,
  body,
  bool,
  dateStr,
  has,
  id,
  int,
  isoDateTime,
  notFound,
  oneOf,
  text,
  timeStr,
} from '../validate.js';
import { imageUploadHandler, serializeImage } from './images.js';

const router = Router();

export function serializeTodo(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    area: t.area,
    projectId: t.project_id,
    priority: t.priority,
    dueDate: t.due_date,
    dueTime: t.due_time,
    reminderAt: t.reminder_at,
    reminderSentAt: t.reminder_sent_at,
    reminderDismissed: !!t.reminder_dismissed,
    completed: !!t.completed_at,
    completedAt: t.completed_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    imageCount: t.image_count ?? 0,
  };
}

const SELECT = `
  SELECT t.*, (SELECT COUNT(*) FROM todo_images i WHERE i.todo_id = t.id) AS image_count
  FROM todos t`;

export function getOwnTodo(userId, todoId) {
  const todo = q(`${SELECT} WHERE t.id = ? AND t.user_id = ?`).get(todoId, userId);
  if (!todo) throw notFound('Todo nicht gefunden');
  return todo;
}

function withImages(todo) {
  const images = q('SELECT * FROM todo_images WHERE todo_id = ? ORDER BY id').all(todo.id);
  return { ...serializeTodo(todo), images: images.map(serializeImage) };
}

function getOwnProject(userId, projectId) {
  const project = q('SELECT id, area FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!project) throw badRequest('Projekt nicht gefunden');
  return project;
}

const PRIORITY = { field: 'Priorität', min: 0, max: 2 };

// GET /api/todos?status=open|done|all&area=work|private&project=<id>|none&q=<search>&limit=<n>
router.get('/', (req, res) => {
  const where = ['t.user_id = :uid'];
  const params = { uid: req.user.id };
  const status = req.query.status ? oneOf(req.query.status, ['open', 'done', 'all'], 'Status') : 'open';
  if (status === 'open') where.push('t.completed_at IS NULL');
  if (status === 'done') where.push('t.completed_at IS NOT NULL');
  if (req.query.area) {
    where.push('t.area = :area');
    params.area = area(req.query.area);
  }
  if (req.query.project === 'none') {
    where.push('t.project_id IS NULL');
  } else if (req.query.project) {
    where.push('t.project_id = :pid');
    params.pid = id(req.query.project, 'Projekt');
  }
  if (req.query.q) {
    const search = text(req.query.q, { field: 'Suche', max: 100 }).toLowerCase();
    if (search) {
      where.push(`(ulower(t.title) LIKE :q ESCAPE '\\' OR ulower(t.description) LIKE :q ESCAPE '\\')`);
      params.q = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }
  }
  params.limit = req.query.limit ? int(req.query.limit, 'Limit', { min: 1, max: 5000 }) : 2000;
  const order =
    status === 'done'
      ? 't.completed_at DESC'
      : `t.completed_at IS NOT NULL, t.due_date IS NULL, t.due_date, COALESCE(t.due_time, '99:99'),
         t.priority DESC, t.created_at DESC`;
  const rows = q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit`).all(params);
  res.json(rows.map(serializeTodo));
});

router.get('/:id', (req, res) => {
  res.json(withImages(getOwnTodo(req.user.id, id(req.params.id))));
});

function applyFields(b, current, userId) {
  const fields = {};
  if (has(b, 'title')) fields.title = text(b.title, { field: 'Titel', max: 200, required: true });
  if (has(b, 'description')) fields.description = text(b.description, { field: 'Beschreibung', max: 10000, multiline: true });
  if (has(b, 'priority')) fields.priority = int(b.priority, PRIORITY.field, PRIORITY);
  if (has(b, 'dueDate')) fields.due_date = dateStr(b.dueDate, 'Fälligkeitsdatum');
  if (has(b, 'dueTime')) fields.due_time = timeStr(b.dueTime, 'Fälligkeitszeit');
  if (has(b, 'area')) fields.area = area(b.area);

  if (has(b, 'projectId')) {
    if (b.projectId === null || b.projectId === '') {
      fields.project_id = null;
    } else {
      const project = getOwnProject(userId, id(b.projectId, 'Projekt'));
      fields.project_id = project.id;
      // A todo always lives in the area of its project.
      if (!has(b, 'area')) fields.area = project.area;
      else if (fields.area !== project.area) throw badRequest('Das Projekt gehört zu einem anderen Bereich');
    }
  } else if (fields.area && current?.project_id) {
    const project = getOwnProject(userId, current.project_id);
    if (project.area !== fields.area) throw badRequest('Das Projekt gehört zu einem anderen Bereich');
  }

  // No time without a date.
  const dueDate = has(fields, 'due_date') ? fields.due_date : current?.due_date;
  if (!dueDate) fields.due_time = null;

  if (has(b, 'reminderAt')) {
    fields.reminder_at = isoDateTime(b.reminderAt, 'Erinnerung');
    if (fields.reminder_at !== (current?.reminder_at ?? null) || !current) {
      fields.reminder_sent_at = null;
      fields.reminder_dismissed = 0;
    }
  }
  if (has(b, 'reminderDismissed')) fields.reminder_dismissed = bool(b.reminderDismissed, 'Erinnerung') ? 1 : 0;

  if (has(b, 'completed')) {
    const completed = bool(b.completed, 'Erledigt');
    if (completed && !current?.completed_at) fields.completed_at = now();
    if (!completed) fields.completed_at = null;
  }
  return fields;
}

router.post('/', (req, res) => {
  const b = body(req);
  if (!has(b, 'area') && !b.projectId) throw badRequest('Bereich fehlt');
  const fields = applyFields(b, null, req.user.id);
  if (!fields.title) throw badRequest('Titel fehlt');
  const ts = now();
  const row = {
    user_id: req.user.id,
    project_id: null,
    description: '',
    priority: 1,
    due_date: null,
    due_time: null,
    reminder_at: null,
    reminder_sent_at: null,
    reminder_dismissed: 0,
    completed_at: null,
    ...fields,
    created_at: ts,
    updated_at: ts,
  };
  const cols = Object.keys(row);
  const result = q(`INSERT INTO todos (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`).run(row);
  res.status(201).json(withImages(getOwnTodo(req.user.id, Number(result.lastInsertRowid))));
});

router.patch('/:id', (req, res) => {
  const todo = getOwnTodo(req.user.id, id(req.params.id));
  const fields = applyFields(body(req), todo, req.user.id);
  const keys = Object.keys(fields);
  if (keys.length) {
    q(`UPDATE todos SET ${keys.map((k) => `${k} = :${k}`).join(', ')}, updated_at = :updated_at WHERE id = :id`).run({
      ...fields,
      updated_at: now(),
      id: todo.id,
    });
  }
  res.json(withImages(getOwnTodo(req.user.id, todo.id)));
});

router.delete('/:id', (req, res) => {
  const todo = getOwnTodo(req.user.id, id(req.params.id));
  const images = tx(() => {
    const rows = q('SELECT file_name FROM todo_images WHERE todo_id = ?').all(todo.id);
    q('DELETE FROM todos WHERE id = ?').run(todo.id);
    return rows;
  });
  unlinkImageFiles(images);
  res.json({ ok: true });
});

router.post('/:id/images', (req, res, next) => {
  req.todo = getOwnTodo(req.user.id, id(req.params.id));
  next();
}, imageUploadHandler);

export default router;
