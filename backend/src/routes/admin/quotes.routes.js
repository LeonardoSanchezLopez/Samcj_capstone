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

// COTIZACIONES
router.get('/quotes', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('cotizaciones').select(`
    *,
    clientes(nombres,apellidos,dni,telefono),
    servicios(nombre),
    categorias_vehiculo(nombre),
    marcas_lamina(nombre),
    tonalidades(porcentaje,nombre)
  `).order('creado_en', { ascending: false }).limit(500);
  if (error) throw apiError('No se pudieron cargar las cotizaciones', 500, error.message);
  let rows = data;
  if (req.query.status) rows = rows.filter(x => x.estado === req.query.status);
  rows = filterAny(rows, cleanSearch(req.query.search || ''), ['codigo','clientes.nombres','clientes.apellidos','clientes.dni','marcas_lamina.nombre','estado']);
  res.json(rows);
}));

router.put('/quotes/:id', asyncHandler(async (req, res) => {
  const allowed = ['marca_lamina_id','tonalidad_id','monto','estado','observaciones'];
  const payload = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  const data = ensureData(await supabaseAdmin.from('cotizaciones').update(payload).eq('id', req.params.id).select().single());
  res.json(data);
}));


export default router;
