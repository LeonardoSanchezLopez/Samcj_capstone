import { Router } from 'express';
import { supabaseAdmin } from '../../config/supabase.js';
import { requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, apiError, cleanSearch, ensureData } from '../../utils/http.js';
import { assertNotPastDate as validateBlockDate, dayOccupancy } from '../../services/schedule.service.js';
import {validateDraft,attachDraft,inspectionForOrder,photosForInspection} from '../../services/inspection.service.js';
import { holidayName } from '../../services/holidays.service.js';
import { assertDealerSlotAvailable, assertNotPastDate, assertPublicSlotAvailable, getDealerBatchAvailability, limaParts } from '../../services/schedule.service.js';
import {filterAny, DNI_RE, validateCustomerPayload} from './shared.js';

const router = Router();
router.use(requireAdmin);

// CONCESIONARIOS
router.get('/dealerships', asyncHandler(async (req, res) => {
  const search = cleanSearch(req.query.search || '');
  let query = supabaseAdmin.from('concesionarios').select('*').neq('nombre','B Motors').order('nombre').limit(500);
  if (req.query.status === 'active') query = query.eq('activo', true);
  if (req.query.status === 'inactive') query = query.eq('activo', false);
  if (search) query = query.ilike('nombre', `%${search}%`);
  res.json(ensureData(await query));
}));

router.post('/dealerships', asyncHandler(async (req, res) => {
  if (!req.body?.nombre) throw apiError('Ingresa el nombre del concesionario');
  const data = ensureData(await supabaseAdmin.from('concesionarios').insert({ nombre: req.body.nombre }).select().single());
  res.status(201).json(data);
}));

router.put('/dealerships/:id', asyncHandler(async (req, res) => {
  const data = ensureData(await supabaseAdmin.from('concesionarios').update({ nombre: req.body?.nombre }).eq('id', req.params.id).select().single());
  res.json(data);
}));

router.patch('/dealerships/:id/status', asyncHandler(async (req, res) => {
  const data = ensureData(await supabaseAdmin.from('concesionarios').update({ activo: Boolean(req.body?.activo) }).eq('id', req.params.id).select().single());
  res.json(data);
}));

router.get('/dealerships/:id/brands', asyncHandler(async (req,res)=>{
  const data=ensureData(await supabaseAdmin.from('concesionario_marcas').select('id,marca_vehiculo').eq('concesionario_id',req.params.id).eq('activo',true).order('marca_vehiculo'));
  res.json(data);
}));


export default router;
