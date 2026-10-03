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

// CLIENTES
router.get('/customers', asyncHandler(async (req, res) => {
  const search = cleanSearch(req.query.search || '');
  let query = supabaseAdmin.from('clientes').select('*').order('creado_en', { ascending: false }).limit(500);
  if (req.query.status === 'active') query = query.eq('activo', true);
  if (req.query.status === 'inactive') query = query.eq('activo', false);
  if (search) query = query.or(`nombres.ilike.%${search}%,apellidos.ilike.%${search}%,dni.ilike.%${search}%,telefono.ilike.%${search}%`);
  res.json(ensureData(await query));
}));

router.get('/customers/by-dni/:dni',asyncHandler(async(req,res)=>{
 const dni=String(req.params.dni);if(!DNI_RE.test(dni))throw apiError('DNI inválido');
 const result=await supabaseAdmin.from('clientes').select('*').eq('dni',dni).maybeSingle();
 if(result.error)throw apiError('No se pudo buscar el cliente',500);res.json({cliente:result.data});
}));
router.post('/customers',  asyncHandler(async (req, res) => {
  const { nombres, apellidos, dni, telefono, correo } = req.body || {};
  validateCustomerPayload({ nombres, apellidos, dni, telefono, correo });
  const data = ensureData(await supabaseAdmin.from('clientes').insert({ nombres: nombres.trim(), apellidos: apellidos.trim(), dni, telefono, correo: correo || null }).select().single(), 'No se pudo crear el cliente');
  res.status(201).json(data);
}));

router.put('/customers/:id', asyncHandler(async (req, res) => {
  const { nombres, apellidos, dni, telefono, correo } = req.body || {};
  validateCustomerPayload({ nombres, apellidos, dni, telefono, correo });
  const data = ensureData(await supabaseAdmin.from('clientes').update({ nombres: nombres.trim(), apellidos: apellidos.trim(), dni, telefono, correo: correo || null }).eq('id', req.params.id).select().single(), 'No se pudo modificar el cliente');
  res.json(data);
}));

router.patch('/customers/:id/status', asyncHandler(async (req, res) => {
  const activo = Boolean(req.body?.activo);
  const data = ensureData(await supabaseAdmin.from('clientes').update({ activo }).eq('id', req.params.id).select().single());
  res.json(data);
}));


export default router;
