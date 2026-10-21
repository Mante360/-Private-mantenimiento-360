import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { checkJwtConfiguration } from './auth.js';
import { authRouter } from './routes/auth.js';
import { jobsRouter } from './routes/jobs.js';
import { quotesRouter } from './routes/quotes.js';
import { claimsRouter } from './routes/claims.js';
import { photosRouter, ensureLabPhotoSchema } from './routes/photos.js';
import { technicalRouter, ensureLabTechnicalSchema } from './routes/technical.js';
import { pool } from './db.js';
import { bootstrapTestSchemaIfRequested } from './test-db-bootstrap.js';
import { seedLabAdminIfRequested } from './test-admin-seed.js';
import { adminRouter } from './routes/admin.js';
import { claimPerformanceRouter } from './routes/claim-performance.js';
import { claimRemindersRouter } from './routes/claim-reminders.js';
import { professionsRouter } from './routes/professions.js';
import {labServicesRouter} from './routes/lab-service-offerings.js';
import {ensureLabServiceOfferings} from './lab-service-offerings.js';
import { ensureLabProfessionCatalog } from './lab-professions.js';
import { ensureLabClaimReminderSchema } from './lab-claim-reminders.js';

checkJwtConfiguration(); // Fail closed on weak/missing secret.
const app = express();
const port = Number(process.env.PORT || 10000);

// No permissive CORS fallback: configure an explicit frontend domain.
// Non-browser API clients still require an authenticated access token.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigins, credentials: false }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '256kb' }));

// Development backend is API only. Do not serve the official prototype UI
// from a separate test origin or create misleading browser-local data.
app.get('/', (_req, res) => {
  res.json({ service: 'mantenimiento-360-api-pruebas', status: 'development_only' });
});

// Separate test-only registration console, not the official client app.
// Same-origin requests; never embed API credentials in static files.
const serveLab = (filename: string): express.RequestHandler => (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.sendFile(process.cwd() + '/test-ui/' + filename);
};
app.get('/pruebas', serveLab('index.html'));
app.get('/pruebas/ui.css', serveLab('ui.css'));
app.get('/pruebas/ui.js', serveLab('ui.js'));
app.get('/pruebas/photos.js', serveLab('photos.js'));
app.get('/pruebas/technical.js', serveLab('technical.js'));

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, service: 'mantenimiento-360-api-dev' });
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/jobs', quotesRouter);
app.use('/api/jobs', photosRouter);
app.use('/api/jobs', technicalRouter);
app.use('/api/claims', claimsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/claim-performance', claimPerformanceRouter);
app.use('/api/admin/claim-reminders', claimRemindersRouter);
app.use('/api/catalog/professions', professionsRouter);
app.use('/api/lab-services', labServicesRouter);

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  if ((error as {type?:string})?.type === 'entity.too.large') {
    res.status(413).json({ error:'photo_too_large' }); return;
  }
  // No stack traces or SQL/database details in public responses.
  console.error('API request failed', error);
  res.status(500).json({ error: 'internal_server_error' });
});

await bootstrapTestSchemaIfRequested();
await ensureLabPhotoSchema();
await ensureLabTechnicalSchema();
await ensureLabClaimReminderSchema();
await ensureLabProfessionCatalog();
await ensureLabServiceOfferings();
await seedLabAdminIfRequested();

app.listen(port, '0.0.0.0', () => {
  console.log('Mantenimiento 360 development API listening on ' + port);
});
