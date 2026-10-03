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

// NOTIFICACIONES
router.get('/notifications', asyncHandler(async (_req, res) => {
  const data = ensureData(await supabaseAdmin.from('notificaciones').select('*').eq('activo', true).order('creado_en', { ascending: false }).limit(20));
  res.json(data);
}));

router.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
  const data = ensureData(await supabaseAdmin.from('notificaciones').update({ leida: true }).eq('id', req.params.id).select().single());
  res.json(data);
}));


export default router;
