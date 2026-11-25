import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { csrfCheck, originCheck, requireAuth, sessionMiddleware } from './auth.js';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import imageRoutes from './routes/images.js';
import projectRoutes from './routes/projects.js';
import pushRoutes from './routes/push.js';
import reminderRoutes from './routes/reminders.js';
import settingsRoutes from './routes/settings.js';
import todoRoutes from './routes/todos.js';
import userRoutes from './routes/users.js';
import { HttpError } from './validate.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'blob:', 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // HSTS only makes sense when the app is actually served via HTTPS.
      strictTransportSecurity: config.cookieSecure === 'true',
      referrerPolicy: { policy: 'same-origin' },
    }),
  );

  // ---- API ---------------------------------------------------------------
  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '200kb' }));
  api.use(sessionMiddleware);
  api.use(originCheck);
  api.use(csrfCheck);

  api.use('/auth', authRoutes);
  api.use(requireAuth);
  api.use('/settings', settingsRoutes);
  api.use('/projects', projectRoutes);
  api.use('/todos', todoRoutes);
  api.use('/images', imageRoutes);
  api.use('/reminders', reminderRoutes);
  api.use('/push', pushRoutes);
  api.use('/users', userRoutes);
  api.use((req, res) => {
    throw new HttpError(404, 'Unbekannter API-Endpunkt', 'NOT_FOUND');
  });
  app.use('/api', api);

  // ---- Frontend (static, no build step) ------------------------------------
  app.use(
    express.static(config.publicDir, {
      index: 'index.html',
      setHeaders(res, file) {
        // Always revalidate so updates show up immediately (ETag keeps it cheap).
        res.set('Cache-Control', 'no-cache');
        if (path.basename(file) === 'sw.js') res.set('Service-Worker-Allowed', '/');
        if (file.endsWith('.webmanifest')) res.set('Content-Type', 'application/manifest+json');
      },
    }),
  );

  // ---- Errors --------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Ungültige Anfrage', code: 'BAD_JSON' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Anfrage zu groß', code: 'TOO_LARGE' });
    }
    console.error(err);
    res.status(500).json({ error: 'Interner Serverfehler', code: 'SERVER_ERROR' });
  });

  return app;
}
