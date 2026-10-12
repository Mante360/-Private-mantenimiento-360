import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { checkJwtConfiguration } from './auth.js';
import { authRouter } from './routes/auth.js';
import { jobsRouter } from './routes/jobs.js';
import { quotesRouter } from './routes/quotes.js';
import { claimsRouter } from './routes/claims.js';
import { pool } from './db.js';

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
app.use('/api/claims', claimsRouter);

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  // No stack traces or SQL/database details in public responses.
  console.error('API request failed', error);
  res.status(500).json({ error: 'internal_server_error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log('Mantenimiento 360 development API listening on ' + port);
});
