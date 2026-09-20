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

// OT
router.get('/orders', asyncHandler(async (req, res) => {
  let query = supabaseAdmin.from('v_ordenes_trabajo').select('*').order('creado_en', { ascending: false }).limit(500);
  if (req.query.type) query = query.eq('tipo_ot', req.query.type);
  if (req.query.state) query = query.eq('estado', req.query.state);
  const rows = ensureData(await query);
  const search = cleanSearch(req.query.search || '');
  res.json(filterAny(rows, search, ['codigo','cliente_o_concesionario','dni','serie_interna','marca_lamina','categoria_vehiculo','estado']));
}));

router.get('/orders/dealership-batch-slots', asyncHandler(async (req, res) => {
  const date = String(req.query.date || '');
  const count = Number(req.query.count || 0);
  if (!date) throw apiError('Selecciona una fecha');
  const data = await getDealerBatchAvailability(date, count);
  res.json(data);
}));

// IMPORTANTE: las rutas estáticas de /orders deben declararse antes de /orders/:id.
// De lo contrario Express interpreta textos como "dealership-batch-slots" como si fueran UUID de una OT.
router.get('/orders/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('ordenes_trabajo').select(`
    *,
    clientes(*),
    concesionarios(*),
    citas(*, respuestas_cita(*, preguntas_cita(codigo,texto), opciones_pregunta(codigo,texto)), recomendaciones_cita(*)),
    cotizaciones(*),
    servicios(*),
    categorias_vehiculo(*),
    tipos_vehiculo_especial(*),
    marcas_lamina(*),
    tonalidades(*),
    bloques_atencion_concesionario(*)
  `).eq('id', req.params.id).single();
  if (error) throw apiError('No se pudo cargar la orden', 404, error.message);
  res.json(data);
}));

router.post('/orders/dealership-batch', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const vehicles = Array.isArray(b.vehiculos) ? b.vehiculos : [];
  if (!b.concesionario_id || !b.fecha || !b.hora_inicio) throw apiError('Completa concesionario, fecha y hora de inicio del lote');
  assertNotPastDate(b.fecha);
  if (vehicles.length < 2 || vehicles.length > 5) throw apiError('Un lote debe contener entre 2 y 5 vehículos');

  for(const [i,v] of vehicles.entries()){
    try{await validateDraft(v.fotoToken,req.auth.perfil.id)}catch{throw apiError(`Faltan cuatro fotos de recepción para el vehículo ${i+1}`)}
  }
  const availability = await getDealerBatchAvailability(b.fecha, vehicles.length);
  const selectedSlot = availability.slots.find(x => x.time === String(b.hora_inicio).slice(0, 5) && x.available);
  if (!selectedSlot) throw apiError('Ese horario ya no está disponible para la cantidad de vehículos del lote', 409);
  const calculatedEnd = selectedSlot.end;

  const allowed = ensureData(await supabaseAdmin.from('concesionario_marcas').select('marca_vehiculo').eq('concesionario_id', b.concesionario_id).eq('activo', true));
  const allowedBrands = new Set(allowed.map(x => x.marca_vehiculo));
  const seenSeries = new Set();
  const normalized = vehicles.map((v, index) => {
    const required = ['servicio_id','categoria_vehiculo_id','marca_lamina_id','tonalidad_id','serie_interna','marca_vehiculo'];
    if (required.some(k => !v?.[k])) throw apiError(`Completa los datos obligatorios del vehículo ${index + 1}`);
    const serie = String(v.serie_interna).trim().toUpperCase();
    if (!/^[A-Z0-9]{6,8}$/.test(serie)) throw apiError(`La Serie Interna del vehículo ${index + 1} debe tener entre 6 y 8 letras o números`);
    if (seenSeries.has(serie)) throw apiError(`La Serie Interna ${serie} está repetida dentro del lote`);
    seenSeries.add(serie);
    if (!allowedBrands.has(v.marca_vehiculo)) throw apiError(`La marca del vehículo ${index + 1} no corresponde al concesionario seleccionado`);
    return {
      servicio_id: v.servicio_id,
      categoria_vehiculo_id: Number(v.categoria_vehiculo_id),
      tipo_vehiculo_especial_id: v.tipo_vehiculo_especial_id ? Number(v.tipo_vehiculo_especial_id) : '',
      marca_vehiculo: v.marca_vehiculo,
      modelo_vehiculo: v.modelo_vehiculo || '',
      serie_interna: serie,
      marca_lamina_id: Number(v.marca_lamina_id),
      tonalidad_id: Number(v.tonalidad_id),
      asesor_concesionario: v.asesor_concesionario || '',
      observaciones: v.observaciones || ''
    };
  });

  const result = await supabaseAdmin.rpc('fn_registrar_lote_concesionario', {
    p_concesionario_id: b.concesionario_id,
    p_fecha: b.fecha,
    p_hora_inicio: b.hora_inicio,
    p_hora_fin: calculatedEnd,
    p_vehiculos: normalized,
    p_observaciones: b.observaciones || null
  });
  if (result.error) throw apiError('No se pudo registrar el lote de concesionario', 409, result.error.message);
  // Adjuntar las cuatro fotos a cada OT devuelta por la función del lote.
  const created=result.data?.ordenes;
  if(!Array.isArray(created)||created.length!==vehicles.length)throw apiError('El lote fue creado, pero la respuesta no permite asociar las fotos. Revisa las OT y no registres un segundo lote.',500);
  try {
    for(let i=0;i<created.length;i++) await attachDraft(created[i].id||created[i].orden_trabajo_id,vehicles[i].fotoToken,req.auth.perfil.id,'RECEPCION');
  } catch(error) {
    // Compensación de una operación compuesta (Storage / PostgREST / RPC).
    // Mantener el aviso si alguna FK o política impide el rollback.
    const ids=created.map(x=>x.id||x.orden_trabajo_id);
    const cleanup=await supabaseAdmin.from('ordenes_trabajo').delete().in('id',ids);
    if(cleanup.error)console.error('Lote con fotos incompletas; reparación manual requerida:',ids,cleanup.error.message);
    const blockId=result.data?.bloque?.id;
    if(blockId&&!cleanup.error){const deleted=await supabaseAdmin.from('bloques_atencion_concesionario').delete().eq('id',blockId);if(deleted.error)console.warn('Revisar bloque del lote:',blockId,deleted.error.message)}
    throw apiError(cleanup.error?'La OT quedó registrada pero faltaron fotografías: revisa las OT existentes antes de reintentar.':'Fallo al guardar fotografías: el lote se revirtió, puedes reintentarlo.',500);
  }
  res.status(201).json(result.data);
}));

router.post('/orders/dealership' , asyncHandler(async (req, res) => {
  const b=req.body||{};
  const required=['concesionario_id','servicio_id','categoria_vehiculo_id','marca_lamina_id','tonalidad_id','serie_interna','marca_vehiculo','fecha_inicio'];
  if(required.some(k=>!b[k])) throw apiError('Completa concesionario, serie interna, fecha/hora, categoría, marca del vehículo, lámina y tonalidad');
  await validateDraft(b.fotoToken,req.auth.perfil.id);
  const serie=String(b.serie_interna).trim().toUpperCase();
  if(!/^[A-Z0-9]{6,8}$/.test(serie)) throw apiError('La Serie Interna debe contener entre 6 y 8 letras o números');
  const brand=await supabaseAdmin.from('concesionario_marcas').select('id').eq('concesionario_id',b.concesionario_id).eq('marca_vehiculo',b.marca_vehiculo).eq('activo',true).maybeSingle();
  if(brand.error||!brand.data) throw apiError('La marca del vehículo no corresponde al concesionario seleccionado');
  await assertDealerSlotAvailable(b.fecha_inicio);

  let precio=b.precio_final??null;
  if(precio==null){
    const result=await supabaseAdmin.rpc('fn_calcular_precio',{p_tipo_cliente:'CONCESIONARIO',p_servicio_id:b.servicio_id,p_categoria_vehiculo_id:b.categoria_vehiculo_id,p_marca_lamina_id:b.marca_lamina_id,p_tipo_vehiculo_especial_id:b.tipo_vehiculo_especial_id||null});
    if(!result.error) precio=result.data;
  }
  const data=ensureData(await supabaseAdmin.from('ordenes_trabajo').insert({
    codigo:'',tipo_ot:'CONCESIONARIO',concesionario_id:b.concesionario_id,servicio_id:b.servicio_id,
    categoria_vehiculo_id:b.categoria_vehiculo_id,tipo_vehiculo_especial_id:b.tipo_vehiculo_especial_id||null,
    marca_vehiculo:b.marca_vehiculo,modelo_vehiculo:b.modelo_vehiculo||null,serie_interna:serie,
    marca_lamina_id:b.marca_lamina_id,tonalidad_id:b.tonalidad_id,asesor_concesionario:b.asesor_concesionario||null,
    atencion_paralela:false,bloque_atencion_id:null,estado:'EN_PROCESO',fecha_inicio:b.fecha_inicio,precio_final:precio,observaciones:b.observaciones||null
  }).select().single(),'No se pudo registrar la OT del concesionario');
  try {await attachDraft(data.id,b.fotoToken,req.auth.perfil.id,'RECEPCION');}
  catch(error){
    const cleanup=await supabaseAdmin.from('ordenes_trabajo').delete().eq('id',data.id);
    if(cleanup.error)console.error('OT creada sin fotos. Requiere reparación manual:',data.id,cleanup.error.message);
    throw error;
  }
  res.status(201).json(data);
}));

router.patch('/orders/:id/start', asyncHandler(async (req, res) => {
  const { data: current, error: currentError } = await supabaseAdmin.from('ordenes_trabajo').select('*').eq('id', req.params.id).single();
  if (currentError) throw apiError('Orden no encontrada', 404);
  if (current.tipo_ot !== 'CLIENTE_NATURAL' || current.estado !== 'PENDIENTE_VALIDACION') throw apiError('Esta orden no puede iniciarse desde su estado actual');
  if (current.cita_id) {
    const cita = ensureData(await supabaseAdmin.from('citas').select('fecha').eq('id', current.cita_id).single(), 'No se pudo validar la fecha de la cita');
    const today = limaParts(new Date()).date;
    if (cita.fecha > today) throw apiError(`La cita está programada para ${cita.fecha}. No puede marcarse como atendida antes de esa fecha.`);
  }

  const allowed = ['servicio_id','categoria_vehiculo_id','tipo_vehiculo_especial_id','marca_lamina_id','tonalidad_id','precio_final','marca_vehiculo','modelo_vehiculo','anio_vehiculo','observaciones'];
  const payload = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  payload.estado = 'EN_PROCESO';
  payload.fecha_inicio = req.body?.fecha_inicio || new Date().toISOString();
  const data = ensureData(await supabaseAdmin.from('ordenes_trabajo').update(payload).eq('id', req.params.id).select().single(), 'No se pudo iniciar el servicio');

  if (current.cotizacion_id) {
    await supabaseAdmin.from('cotizaciones').update({
      servicio_id: payload.servicio_id || current.servicio_id,
      categoria_vehiculo_id: payload.categoria_vehiculo_id || current.categoria_vehiculo_id,
      tipo_vehiculo_especial_id: payload.tipo_vehiculo_especial_id ?? current.tipo_vehiculo_especial_id,
      marca_lamina_id: payload.marca_lamina_id || current.marca_lamina_id,
      tonalidad_id: payload.tonalidad_id || current.tonalidad_id,
      monto: payload.precio_final ?? current.precio_final,
      estado: 'CONFIRMADA'
    }).eq('id', current.cotizacion_id);
  }
  if (current.cita_id) await supabaseAdmin.from('citas').update({ estado: 'ATENDIDA' }).eq('id', current.cita_id);

  res.json(data);
}));

router.patch('/orders/:id/finalize', asyncHandler(async (req, res) => {
  const { realizadoPor = [], fechaFin = null } = req.body || {};
  const allowedPerformers=['MAX NICK QUEZADA MORALES','CARLOS ANDRES QUEZADA MORALES'];
  const performers=[...new Set(realizadoPor.map(x=>String(x).trim().toUpperCase()))].filter(x=>allowedPerformers.includes(x));
  if(!performers.length) throw apiError('Selecciona al menos un responsable del servicio');
  const { data: current, error } = await supabaseAdmin.from('ordenes_trabajo').select('*').eq('id', req.params.id).single();
  if (error) throw apiError('Orden no encontrada', 404);
  if (current.estado !== 'EN_PROCESO') throw apiError('Solo una OT en proceso puede finalizarse');
  // OT antiguas sin inspección inicial permanecen intactas; las nuevas deben haber sido registradas con fotos.
  if(current.tipo_ot==='CONCESIONARIO'){
   const initial=await inspectionForOrder(current.id,'RECEPCION');
   if(initial){const final=await inspectionForOrder(current.id,'ENTREGA');
    if(!final||final.estado!=='REVISADA'||(await photosForInspection(final.id)).length!==4)throw apiError('Toma las cuatro fotos finales y confirma su comparación antes de finalizar la OT');
   }
  }
  const data = ensureData(await supabaseAdmin.from('ordenes_trabajo').update({
    estado: 'FINALIZADA', fecha_fin: fechaFin || new Date().toISOString(), realizado_por: performers
  }).eq('id', req.params.id).select().single(), 'No se pudo finalizar la orden');
  res.json(data);
}));


export default router;
