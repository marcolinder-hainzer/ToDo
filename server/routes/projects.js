import { Router } from 'express';
import { now, q, tx, unlinkImageFiles } from '../db.js';
import { area, body, bool, color, dateStr, has, id, notFound, text } from '../validate.js';

const router = Router();

const DEFAULT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function serializeProject(p) {
  return {
    id: p.id,
    area: p.area,
    name: p.name,
    description: p.description,
    color: p.color,
    archived: !!p.archived,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    openCount: p.open_count ?? 0,
    doneCount: p.done_count ?? 0,
    overdueCount: p.overdue_count ?? 0,
  };
}

const SELECT_WITH_COUNTS = `
  SELECT p.*,
    (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id AND t.completed_at IS NULL) AS open_count,
    (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id AND t.completed_at IS NOT NULL) AS done_count,
    (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id AND t.completed_at IS NULL
        AND t.due_date IS NOT NULL AND t.due_date < :today) AS overdue_count
  FROM projects p`;

function getOwnProject(userId, projectId, today = localToday()) {
  const p = q(`${SELECT_WITH_COUNTS} WHERE p.id = :id AND p.user_id = :uid`).get({ id: projectId, uid: userId, today });
  if (!p) throw notFound('Projekt nicht gefunden');
  return p;
}

router.get('/', (req, res) => {
  const today = dateStr(req.query.today, 'Datum') || localToday();
  const rows = q(`${SELECT_WITH_COUNTS} WHERE p.user_id = :uid ORDER BY p.archived, p.name COLLATE NOCASE`).all({
    uid: req.user.id,
    today,
  });
  res.json(rows.map(serializeProject));
});

router.get('/:id', (req, res) => {
  const today = dateStr(req.query.today, 'Datum') || localToday();
  res.json(serializeProject(getOwnProject(req.user.id, id(req.params.id), today)));
});

router.post('/', (req, res) => {
  const b = body(req);
  const count = q('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(req.user.id).n;
  const ts = now();
  const result = q(
    `INSERT INTO projects (user_id, area, name, description, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    req.user.id,
    area(b.area),
    text(b.name, { field: 'Projektname', max: 80, required: true }),
    text(b.description, { field: 'Beschreibung', max: 2000, multiline: true }),
    b.color ? color(b.color) : DEFAULT_COLORS[count % DEFAULT_COLORS.length],
    ts,
    ts,
  );
  res.status(201).json(serializeProject(getOwnProject(req.user.id, Number(result.lastInsertRowid))));
});

router.patch('/:id', (req, res) => {
  const project = getOwnProject(req.user.id, id(req.params.id));
  const b = body(req);
  const updates = {};
  if (has(b, 'name')) updates.name = text(b.name, { field: 'Projektname', max: 80, required: true });
  if (has(b, 'description')) updates.description = text(b.description, { field: 'Beschreibung', max: 2000, multiline: true });
  if (has(b, 'color')) updates.color = color(b.color);
  if (has(b, 'area')) updates.area = area(b.area);
  if (has(b, 'archived')) updates.archived = bool(b.archived, 'Archiviert') ? 1 : 0;

  const keys = Object.keys(updates);
  if (keys.length) {
    tx(() => {
      q(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
        ...keys.map((k) => updates[k]),
        now(),
        project.id,
      );
      // Moving a project to another area moves its todos as well.
      if (updates.area && updates.area !== project.area) {
        q('UPDATE todos SET area = ?, updated_at = ? WHERE project_id = ?').run(updates.area, now(), project.id);
      }
    });
  }
  res.json(serializeProject(getOwnProject(req.user.id, project.id)));
});

router.delete('/:id', (req, res) => {
  const project = getOwnProject(req.user.id, id(req.params.id));
  const deleteTodos = req.query.deleteTodos === '1' || req.query.deleteTodos === 'true';
  const images = tx(() => {
    let rows = [];
    if (deleteTodos) {
      rows = q(
        'SELECT i.file_name FROM todo_images i JOIN todos t ON t.id = i.todo_id WHERE t.project_id = ?',
      ).all(project.id);
      q('DELETE FROM todos WHERE project_id = ?').run(project.id);
    }
    q('DELETE FROM projects WHERE id = ?').run(project.id); // remaining todos: project_id -> NULL
    return rows;
  });
  unlinkImageFiles(images);
  res.json({ ok: true });
});

export default router;
