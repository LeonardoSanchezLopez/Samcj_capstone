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

// TARIFARIO
router.get('/rates', asyncHandler(async (req, res) => {
  let rows = ensureData(await supabaseAdmin.from('v_tarifario').select('*').order('tipo_cliente').order('categoria_vehiculo').order('marca_lamina'));
  rows = filterAny(rows, cleanSearch(req.query.search || ''), ['tipo_cliente','servicio','categoria_vehiculo','tipo_especial','marca_lamina','calidad','precio']);
  res.json(rows);
}));

router.put('/rates/:id', asyncHandler(async (req, res) => {
  const precio = Number(req.body?.precio);
  if (!Number.isFinite(precio) || precio < 0) throw apiError('Ingresa un precio válido');
  const data = ensureData(await supabaseAdmin.from('tarifas').update({ precio }).eq('id', req.params.id).select().single());
  res.json(data);
}));


export default router;
