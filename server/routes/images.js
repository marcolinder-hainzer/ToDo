import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { now, q, unlinkImageFiles, uploadsDir } from '../db.js';
import { HttpError, id, notFound } from '../validate.js';

const MAX_IMAGES_PER_TODO = 40;
const MAX_FILES_PER_REQUEST = 10;

const TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

/** Detect the real image type from the file's first bytes (never trust the client). */
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  const ascii = buf.toString('latin1', 0, 12);
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii.slice(8, 12))) return 'image/avif';
  return null;
}

function readHead(file, length = 16) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, `tmp-${crypto.randomBytes(16).toString('hex')}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: MAX_FILES_PER_REQUEST, fields: 5, parts: 20 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype in TYPES || file.mimetype === 'application/octet-stream') return cb(null, true);
    cb(new HttpError(415, 'Nur Bilder (JPG, PNG, GIF, WebP, AVIF) sind erlaubt', 'UNSUPPORTED_TYPE'));
  },
}).array('images', MAX_FILES_PER_REQUEST);

export function serializeImage(img) {
  return {
    id: img.id,
    todoId: img.todo_id,
    url: `/api/images/${img.id}`,
    originalName: img.original_name,
    mimeType: img.mime_type,
    size: img.size,
    createdAt: img.created_at,
  };
}

function cleanName(name) {
  // multer decodes the filename as latin1; restore UTF-8 and strip anything odd.
  let n = Buffer.from(String(name || 'bild'), 'latin1').toString('utf8');
  n = n.replace(/[\u0000-\u001F\u007F/\\]/g, '').trim();
  return n.slice(0, 120) || 'bild';
}

/** Route handler: POST /api/todos/:id/images (req.todo set by the todo router). */
export function imageUploadHandler(req, res, next) {
  const existing = q('SELECT COUNT(*) AS n FROM todo_images WHERE todo_id = ?').get(req.todo.id).n;
  if (existing >= MAX_IMAGES_PER_TODO) {
    return next(new HttpError(400, `Maximal ${MAX_IMAGES_PER_TODO} Bilder pro Todo`));
  }
  upload(req, res, (err) => {
    const files = req.files || [];
    const discard = () => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    if (err) {
      discard();
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `Ein Bild ist zu groß (max. ${config.maxUploadMb} MB)`
            : err.code === 'LIMIT_FILE_COUNT'
              ? `Maximal ${MAX_FILES_PER_REQUEST} Bilder auf einmal`
              : 'Upload fehlgeschlagen';
        return next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, message));
      }
      return next(err);
    }
    if (!files.length) return next(new HttpError(400, 'Keine Bilder empfangen'));
    if (existing + files.length > MAX_IMAGES_PER_TODO) {
      discard();
      return next(new HttpError(400, `Maximal ${MAX_IMAGES_PER_TODO} Bilder pro Todo`));
    }

    // Validate every file before storing any of them.
    const accepted = [];
    for (const file of files) {
      const type = sniff(readHead(file.path));
      if (!type) {
        discard();
        return next(new HttpError(415, `„${cleanName(file.originalname)}“ ist kein unterstütztes Bild`, 'UNSUPPORTED_TYPE'));
      }
      accepted.push({ file, type });
    }

    const created = [];
    for (const { file, type } of accepted) {
      const finalName = `${crypto.randomBytes(16).toString('hex')}${TYPES[type]}`;
      fs.renameSync(file.path, path.join(uploadsDir, finalName));
      const result = q(
        `INSERT INTO todo_images (todo_id, user_id, file_name, original_name, mime_type, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(req.todo.id, req.user.id, finalName, cleanName(file.originalname), type, file.size, now());
      created.push(q('SELECT * FROM todo_images WHERE id = ?').get(result.lastInsertRowid));
    }
    q('UPDATE todos SET updated_at = ? WHERE id = ?').run(now(), req.todo.id);
    res.status(201).json(created.map(serializeImage));
  });
}

const router = Router();

function getOwnImage(userId, imageId) {
  const img = q('SELECT * FROM todo_images WHERE id = ? AND user_id = ?').get(imageId, userId);
  if (!img) throw notFound('Bild nicht gefunden');
  return img;
}

router.get('/:id', (req, res) => {
  const img = getOwnImage(req.user.id, id(req.params.id));
  const file = path.join(uploadsDir, path.basename(img.file_name));
  if (!fs.existsSync(file)) throw notFound('Bilddatei fehlt');
  res.set({
    'Content-Type': img.mime_type,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(img.original_name)}`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  res.sendFile(file);
});

router.delete('/:id', (req, res) => {
  const img = getOwnImage(req.user.id, id(req.params.id));
  q('DELETE FROM todo_images WHERE id = ?').run(img.id);
  q('UPDATE todos SET updated_at = ? WHERE id = ?').run(now(), img.todo_id);
  unlinkImageFiles([img]);
  res.json({ ok: true });
});

export default router;
