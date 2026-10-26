import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes.js';
import publicRoutes from './routes/public.routes.js';
import inspectionRoutes from './routes/inspection.routes.js';
import forecastRoutes from './routes/forecast.routes.js';
import adminRoutes from './routes/admin.routes.js';

const app = express();
const port = process.env.PORT || 4000;

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: false }));
app.use(express.json({ limit: '6mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'SAMCJ Polarizados API' }));
app.use('/api/auth', (req,res,next)=>{res.set('Cache-Control','no-store');next()},authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin',(req,res,next)=>{res.set('Cache-Control','no-store');next()},inspectionRoutes);
app.use('/api/admin', forecastRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ message: 'Ruta no encontrada' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? err.details || null : undefined
  });
});

app.listen(port, () => console.log(`API lista en http://localhost:${port}`));
