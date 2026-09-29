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

router.get('/dashboard', asyncHandler(async (_req, res) => {
  const today = limaParts(new Date()).date;
  const [clients, citasToday, pendingOt, processOt, lowStock] = await Promise.all([
    supabaseAdmin.from('clientes').select('*', { count: 'exact', head: true }).eq('activo', true),
    supabaseAdmin.from('citas').select('*', { count: 'exact', head: true }).eq('fecha', today).eq('activo', true),
    supabaseAdmin.from('ordenes_trabajo').select('*', { count: 'exact', head: true }).eq('estado', 'PENDIENTE_VALIDACION').eq('activo', true),
    supabaseAdmin.from('ordenes_trabajo').select('*', { count: 'exact', head: true }).eq('estado', 'EN_PROCESO').eq('activo', true),
    supabaseAdmin.from('v_inventario').select('*')
  ]);
  if ([clients,citasToday,pendingOt,processOt,lowStock].some(x => x.error)) throw apiError('No se pudo cargar el dashboard', 500);

  const { data: recent } = await supabaseAdmin.from('v_ordenes_trabajo').select('*').order('creado_en', { ascending: false }).limit(6);
  res.json({
    stats: {
      clientesActivos: clients.count || 0,
      citasHoy: citasToday.count || 0,
      otPendientes: pendingOt.count || 0,
      otEnProceso: processOt.count || 0,
      stockBajo: lowStock.data.filter(x => x.estado_stock === 'BAJO').length
    },
    recientes: recent || []
  });
}));

router.get('/profiles', asyncHandler(async (_req, res) => {
  const data = ensureData(await supabaseAdmin.from('perfiles').select('id,nombres,apellidos,telefono,activo').eq('activo', true).order('nombres'));
  res.json(data);
}));


export default router;
