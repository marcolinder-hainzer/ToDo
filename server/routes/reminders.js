import { Router } from 'express';
import { now, q } from '../db.js';
import { serializeTodo } from './todos.js';

const router = Router();

// Reminders that are due and have not been dismissed yet.
router.get('/', (req, res) => {
  const rows = q(
    `SELECT t.*, (SELECT COUNT(*) FROM todo_images i WHERE i.todo_id = t.id) AS image_count
       FROM todos t
      WHERE t.user_id = ? AND t.reminder_at IS NOT NULL AND t.reminder_at <= ?
        AND t.reminder_dismissed = 0 AND t.completed_at IS NULL
      ORDER BY t.reminder_at DESC LIMIT 100`,
  ).all(req.user.id, now());
  res.json(rows.map(serializeTodo));
});

export default router;
