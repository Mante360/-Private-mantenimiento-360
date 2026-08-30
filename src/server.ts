import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { authRouter } from './routes/auth.js';
import { jobsRouter } from './routes/jobs.js';
import { claimsRouter } from './routes/claims.js';
import { pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 10000);

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => {
  res.sendFile(process.cwd() + '/index.html');
});
app.get('/styles.css', (_req, res) => {
  res.sendFile(process.cwd() + '/styles.css');
});

app.get('/app.js', (_req, res) => {
res.sendFile(process.cwd() + '/app.js');
});

app.get('/health', async (_req, res) => {
  const db = await pool.query('select now() as now');
  res.json({ ok: true, service: 'mantenimiento-360-api', dbTime: db.rows[0].now });
});

app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/claims', claimsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal_server_error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Mantenimiento 360 API listening on ${port}`);
});
