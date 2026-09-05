import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const app = express();
const port = process.env.PORT || 4000;
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: false }));
app.use(express.json({ limit: '6mb' }));
app.use(morgan('dev'));
app.get('/api/health', (_req,res)=>res.json({ok:true,service:'SAMCJ Polarizados API'}));
app.use((req,res)=>res.status(404).json({message:'Ruta no encontrada'}));
app.use((err,_req,res,_next)=>{console.error(err);res.status(err.status||500).json({message:err.message||'Error interno del servidor',details:process.env.NODE_ENV==='development'?err.details||null:undefined});});
app.listen(port,()=>console.log(`API lista en http://localhost:${port}`));
