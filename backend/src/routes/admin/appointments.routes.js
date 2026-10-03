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

// CITAS
router.get('/appointments', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('citas').select(`
    *,
    clientes(id,nombres,apellidos,dni,telefono),
    servicios(id,nombre),
    categorias_vehiculo(id,nombre),
    tipos_vehiculo_especial(id,nombre)
  `).order('fecha', { ascending: false }).order('hora', { ascending: true }).limit(500);
  if (error) throw apiError('No se pudieron cargar las citas', 500, error.message);
  let rows = data;
  if (req.query.status) rows = rows.filter(x => x.estado === req.query.status);
  rows = filterAny(rows, cleanSearch(req.query.search || ''), ['codigo','clientes.nombres','clientes.apellidos','clientes.dni','clientes.telefono','marca_vehiculo','modelo_vehiculo','fecha']);
  res.json(rows);
}));

router.put('/appointments/:id', asyncHandler(async (req, res) => {
  const allowed = ['fecha','hora','lugar_servicio','distrito','calle_avenida','referencia','marca_vehiculo','modelo_vehiculo','anio_vehiculo','observaciones'];
  const payload = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  const current=ensureData(await supabaseAdmin.from('citas').select('*').eq('id',req.params.id).single(),'Cita no encontrada');
  const date=payload.fecha||current.fecha, time=payload.hora||String(current.hora).slice(0,5), location=payload.lugar_servicio||current.lugar_servicio;
  if(location==='DOMICILIO' && !(payload.distrito??current.distrito) ) throw apiError('Selecciona distrito o zona');
  if(location==='DOMICILIO' && !(payload.calle_avenida??current.calle_avenida) ) throw apiError('Ingresa calle/avenida y número');
  await assertPublicSlotAvailable(date,time,location,{excludeCitaId:req.params.id});
  const data = ensureData(await supabaseAdmin.from('citas').update(payload).eq('id', req.params.id).select().single(), 'No se pudo modificar la cita');
  res.json(data);
}));

router.patch('/appointments/:id/state', asyncHandler(async (req, res) => {
  const valid = ['RESERVADA','CONFIRMADA','CANCELADA','ATENDIDA'];
  if (!valid.includes(req.body?.estado)) throw apiError('Estado de cita no válido');
  const data = ensureData(await supabaseAdmin.from('citas').update({ estado: req.body.estado }).eq('id', req.params.id).select().single());
  if(req.body.estado==='CANCELADA')await supabaseAdmin.from('notificaciones').insert({tipo:'CITA',titulo:'Cita cancelada',mensaje:`Se canceló la cita ${data.codigo||data.id}.`});
  res.json(data);
}));


export default router;
