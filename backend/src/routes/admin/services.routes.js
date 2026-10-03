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

// SERVICIOS
router.get('/services', asyncHandler(async (req, res) => {
  const search = cleanSearch(req.query.search || '');
  let query = supabaseAdmin.from('servicios').select('*').neq('nombre','Retiro de lámina').order('nombre').limit(500);
  if (req.query.status === 'active') query = query.eq('activo', true);
  if (req.query.status === 'inactive') query = query.eq('activo', false);
  if (search) query = query.ilike('nombre', `%${search}%`);
  res.json(ensureData(await query));
}));

router.post('/services', asyncHandler(async (req, res) => {
  const { nombre, descripcion, cotizacion_automatica = false } = req.body || {};
  if (!nombre) throw apiError('Ingresa el nombre del servicio');
  const data = ensureData(await supabaseAdmin.from('servicios').insert({ nombre, descripcion: descripcion || null, cotizacion_automatica }).select().single());
  res.status(201).json(data);
}));

router.put('/services/:id', asyncHandler(async (req, res) => {
  const { nombre, descripcion, cotizacion_automatica = false } = req.body || {};
  const data = ensureData(await supabaseAdmin.from('servicios').update({ nombre, descripcion: descripcion || null, cotizacion_automatica }).eq('id', req.params.id).select().single());
  res.json(data);
}));

router.patch('/services/:id/status', asyncHandler(async (req, res) => {
  const data = ensureData(await supabaseAdmin.from('servicios').update({ activo: Boolean(req.body?.activo) }).eq('id', req.params.id).select().single());
  res.json(data);
}));


export default router;
