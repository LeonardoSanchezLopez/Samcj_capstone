import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler, apiError, cleanSearch, ensureData } from '../utils/http.js';
import { assertNotPastDate as validateBlockDate, dayOccupancy } from '../services/schedule.service.js';
import {validateDraft,attachDraft,inspectionForOrder,photosForInspection} from '../services/inspection.service.js';
import { holidayName } from '../services/holidays.service.js';
import { assertDealerSlotAvailable, assertNotPastDate, assertPublicSlotAvailable, getDealerBatchAvailability, limaParts } from '../services/schedule.service.js';

const router = Router();
router.use(requireAdmin);

function includesText(value, search) {
  return String(value ?? '').toLowerCase().includes(search.toLowerCase());
}

function filterAny(rows, search, keys) {
  if (!search) return rows;
  return rows.filter(row => keys.some(key => {
    const value = key.split('.').reduce((acc, part) => acc?.[part], row);
    return includesText(value, search);
  }));
}

const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,99}$/u;
const DNI_RE = /^\d{8}$/;
const PHONE_RE = /^9\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateCustomerPayload({ nombres, apellidos, dni, telefono, correo }) {
  if (!nombres || !apellidos || !dni || !telefono) throw apiError('Completa nombres, apellidos, DNI y teléfono');
  if (!NAME_RE.test(String(nombres).trim())) throw apiError('Los nombres solo pueden contener letras');
  if (!NAME_RE.test(String(apellidos).trim())) throw apiError('Los apellidos solo pueden contener letras');
  if (!DNI_RE.test(String(dni))) throw apiError('El DNI debe contener exactamente 8 números');
  if (!PHONE_RE.test(String(telefono))) throw apiError('El celular debe tener 9 dígitos y comenzar por 9');
  if (correo && !EMAIL_RE.test(String(correo))) throw apiError('Ingresa un correo electrónico válido');
}

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

// BLOQUEOS ADMINISTRATIVOS — sin modificar citas ni OT históricas
router.get('/calendar-blocks',asyncHandler(async(req,res)=>{
 const from=String(req.query.from||limaParts().date),to=String(req.query.to||`${new Date().getFullYear()+1}-12-31`);
 const data=ensureData(await supabaseAdmin.from('bloqueos_agenda').select('*').eq('activo',true).gte('fecha',from).lte('fecha',to).order('fecha'));
 res.json(data);
}));
router.post('/calendar-blocks',asyncHandler(async(req,res)=>{
 const {fecha,todo_el_dia=true,hora_inicio=null,hora_fin=null,motivo=''}=req.body||{};
 validateBlockDate(fecha);if(!todo_el_dia&&(!/^\d{2}:\d{2}$/.test(hora_inicio)||!/^\d{2}:\d{2}$/.test(hora_fin)||hora_fin<=hora_inicio))throw apiError('Selecciona un horario de bloqueo válido');
 const existing=ensureData(await supabaseAdmin.from('bloqueos_agenda').select('id').eq('fecha',fecha).eq('activo',true));
 if(existing.length)throw apiError('Ya existe un bloqueo para esta fecha. Revísalo antes de crear otro.',409);
 const agenda=await dayOccupancy(fecha);
 if(agenda.dailyCount>0)throw apiError(`La fecha tiene ${agenda.dailyCount} servicios programados. Reprograma los compromisos antes de bloquear.`,409);
 if(String(motivo).length>250)throw apiError('El motivo no puede superar 250 caracteres');
 const data=ensureData(await supabaseAdmin.from('bloqueos_agenda').insert({fecha,todo_el_dia:Boolean(todo_el_dia),hora_inicio:todo_el_dia?null:hora_inicio,hora_fin:todo_el_dia?null:hora_fin,motivo:String(motivo).trim()||null}).select().single());res.status(201).json(data);
}));
router.patch('/calendar-blocks/:id/deactivate',asyncHandler(async(req,res)=>{
 const data=ensureData(await supabaseAdmin.from('bloqueos_agenda').update({activo:false}).eq('id',req.params.id).select().single());res.json(data);
}));
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

// INVENTARIO
router.get('/inventory', asyncHandler(async (req, res) => {
  let rows = ensureData(await supabaseAdmin.from('v_inventario').select('*').order('calidad').order('marca').order('tonalidad_porcentaje', { ascending: false }));
  rows = filterAny(rows, cleanSearch(req.query.search || ''), ['marca','calidad','tonalidad','tonalidad_porcentaje','estado_stock']);
  res.json(rows);
}));

router.patch('/inventory/:id/adjust', asyncHandler(async (req, res) => {
  const { metros, motivo } = req.body || {};
  const newMeters = Number(metros);
  if (!Number.isFinite(newMeters) || newMeters < 0) throw apiError('Ingresa un stock válido');
  if(!String(motivo||'').trim()||String(motivo).length>250)throw apiError('Ingresa un motivo válido para el ajuste (máximo 250 caracteres)');

  const current = ensureData(await supabaseAdmin.from('inventario').select('*').eq('id', req.params.id).single(), 'Registro de inventario no encontrado');
  if (newMeters === Number(current.metros_actuales)) return res.json(current);

  const type = newMeters > Number(current.metros_actuales) ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO';
  const diff = Math.abs(newMeters - Number(current.metros_actuales));
  const updated = ensureData(await supabaseAdmin.from('inventario').update({ metros_actuales: newMeters }).eq('id', req.params.id).select().single(), 'No se pudo ajustar el stock');

  await supabaseAdmin.from('movimientos_inventario').insert({
    inventario_id: req.params.id,
    tipo_movimiento: type,
    metros: diff,
    metros_antes: current.metros_actuales,
    metros_despues: newMeters,
    motivo: motivo || 'Ajuste manual de inventario',
    creado_por: req.auth.perfil.id
  });
  if(newMeters<=Number(updated.metros_minimos)&&Number(current.metros_actuales)>Number(updated.metros_minimos)){
   await supabaseAdmin.from('notificaciones').insert({tipo:'STOCK',titulo:'Stock bajo por ajuste',mensaje:`El inventario ${req.params.id} quedó con ${newMeters} m después de un ajuste manual.`});
  }
  res.json(updated);
}));

router.post('/inventory/:id/add-rolls', asyncHandler(async (req,res)=>{
  const quantity=Number(req.body?.cantidadRollos);
  if(!Number.isInteger(quantity)||quantity<=0||quantity>100) throw apiError('Ingresa una cantidad válida de rollos');
  const result = await supabaseAdmin.rpc('fn_agregar_rollos_inventario',{
    p_inventario_id:req.params.id,
    p_cantidad:quantity,
    p_creado_por:req.auth.perfil.id
  });
  if(result.error) throw apiError('No se pudieron ingresar los rollos',400,result.error.message);
  const row=Array.isArray(result.data)?result.data[0]:result.data;
  res.json({
    cantidadRollos:Number(row?.cantidad_rollos||quantity),
    metrosPorRollo:Number(row?.metros_por_rollo||0),
    metrosAgregados:Number(row?.metros_agregados||0),
    stockAnterior:Number(row?.stock_anterior||0),
    nuevoStock:Number(row?.stock_nuevo||0)
  });
}));

router.get('/inventory/:id/movements', asyncHandler(async (req,res)=>{
  const data=ensureData(await supabaseAdmin.from('movimientos_inventario').select('*').eq('inventario_id',req.params.id).order('creado_en',{ascending:false}).limit(30));
  res.json(data);
}));

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

// NOTIFICACIONES
router.get('/notifications', asyncHandler(async (_req, res) => {
  const data = ensureData(await supabaseAdmin.from('notificaciones').select('*').eq('activo', true).order('creado_en', { ascending: false }).limit(20));
  res.json(data);
}));

router.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
  const data = ensureData(await supabaseAdmin.from('notificaciones').update({ leida: true }).eq('id', req.params.id).select().single());
  res.json(data);
}));

// REPORTES
// Informe de servicios terminados: una concesionaria y una semana (lunes a domingo).
// El importe proviene del precio congelado en cada OT, nunca del tarifario vigente.
router.get('/reports/dealership-weekly', asyncHandler(async (req,res)=>{
  const dealershipId=String(req.query.dealershipId||'');
  const weekStart=String(req.query.weekStart||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealershipId)) throw apiError('Selecciona un concesionario válido');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw apiError('Selecciona el lunes de la semana');

  const [y,m,d]=weekStart.split('-').map(Number);
  const monday=new Date(Date.UTC(y,m-1,d,12));
  if(monday.getUTCFullYear()!==y||monday.getUTCMonth()!==m-1||monday.getUTCDate()!==d||monday.getUTCDay()!==1) throw apiError('La semana debe comenzar un lunes');

  const fmt=date=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
  const sunday=new Date(monday); sunday.setUTCDate(sunday.getUTCDate()+6);
  const nextMonday=new Date(monday); nextMonday.setUTCDate(nextMonday.getUTCDate()+7);

  const dealer=ensureData(
    await supabaseAdmin.from('concesionarios').select('id,nombre').eq('id',dealershipId).single(),
    'Concesionario no encontrado'
  );

  const orders=ensureData(
    await supabaseAdmin
      .from('ordenes_trabajo')
      .select('id,codigo,fecha_fin,precio_final,marca_vehiculo,modelo_vehiculo,serie_interna,servicios(nombre),categorias_vehiculo(nombre),marcas_lamina(nombre),tonalidades(porcentaje)')
      .eq('concesionario_id',dealershipId)
      .eq('tipo_ot','CONCESIONARIO')
      .eq('estado','FINALIZADA')
      .eq('activo',true)
      .gte('fecha_fin',`${weekStart}T00:00:00-05:00`)
      .lt('fecha_fin',`${fmt(nextMonday)}T00:00:00-05:00`)
      .order('fecha_fin',{ascending:true})
      .limit(500),
    'No se pudo obtener las OT semanales'
  );

  const items=orders.map(ot=>({
    id:ot.id,
    codigo:ot.codigo,
    fecha_fin:ot.fecha_fin,
    serie_interna:ot.serie_interna||'',
    vehiculo:[ot.marca_vehiculo,ot.modelo_vehiculo].filter(Boolean).join(' ') || ot.categorias_vehiculo?.nombre || 'Sin detalle',
    servicio:ot.servicios?.nombre || 'Polarizado',
    lamina:ot.marcas_lamina?.nombre || '',
    opacidad:ot.tonalidades?.porcentaje ?? null,
    precio_final:ot.precio_final===null ? null : Number(ot.precio_final)
  }));

  const sinPrecio=items.filter(x=>x.precio_final===null).length;
  const totalCentavos=items.reduce((sum,x)=>sum + (x.precio_final===null ? 0 : Math.round(x.precio_final*100)),0);

  res.json({
    concesionario:dealer,
    desde:weekStart,
    hasta:fmt(sunday),
    cantidad:items.length,
    sinPrecio,
    total:Number((totalCentavos/100).toFixed(2)),
    items
  });
}));

router.get('/reports', asyncHandler(async (_req, res) => {
  const [orders, inventory, appointments] = await Promise.all([
    supabaseAdmin.from('v_ordenes_trabajo').select('*'),
    supabaseAdmin.from('v_inventario').select('*'),
    supabaseAdmin.from('citas').select('fecha,estado,lugar_servicio').eq('activo', true)
  ]);
  if (orders.error || inventory.error || appointments.error) throw apiError('No se pudieron generar los reportes', 500);

  const finalized = orders.data.filter(x => x.estado === 'FINALIZADA');
  const byBrand = {};
  const byCategory = {};
  finalized.forEach(x => {
    byBrand[x.marca_lamina] = (byBrand[x.marca_lamina] || 0) + 1;
    byCategory[x.categoria_vehiculo] = (byCategory[x.categoria_vehiculo] || 0) + 1;
  });
  const local = appointments.data.filter(x => x.lugar_servicio === 'LOCAL').length;
  const home = appointments.data.filter(x => x.lugar_servicio === 'DOMICILIO').length;

  res.json({
    totalOrdenes: orders.data.length,
    finalizadas: finalized.length,
    metrosConsumidosEstimados: finalized.reduce((s,x) => s + Number(x.metraje_estimado || 0), 0),
    stockBajo: inventory.data.filter(x => x.estado_stock === 'BAJO'),
    porMarca: Object.entries(byBrand).map(([label,value]) => ({ label, value })),
    porCategoria: Object.entries(byCategory).map(([label,value]) => ({ label, value })),
    citasPorLugar: [{ label: 'Local', value: local }, { label: 'Domicilio', value: home }]
  });
}));


router.get('/bi', asyncHandler(async (req,res)=>{
  const from=req.query.from||null, to=req.query.to||null;
  let ordersQ=supabaseAdmin.from('v_ordenes_trabajo').select('*');
  let citasQ=supabaseAdmin.from('citas').select('fecha,hora,lugar_servicio,estado').eq('activo',true);
  let quotesQ=supabaseAdmin.from('cotizaciones').select('monto,creado_en,estado').eq('activo',true);
  if(from){ ordersQ=ordersQ.gte('creado_en',`${from}T00:00:00-05:00`); citasQ=citasQ.gte('fecha',from); quotesQ=quotesQ.gte('creado_en',`${from}T00:00:00-05:00`); }
  if(to){ ordersQ=ordersQ.lte('creado_en',`${to}T23:59:59-05:00`); citasQ=citasQ.lte('fecha',to); quotesQ=quotesQ.lte('creado_en',`${to}T23:59:59-05:00`); }
  const [orders,citas,quotes,inventory]=await Promise.all([ordersQ,citasQ,quotesQ,supabaseAdmin.from('v_inventario').select('*')]);
  if(orders.error||citas.error||quotes.error||inventory.error) throw apiError('No se pudo generar el análisis BI',500);
  const finalized=orders.data.filter(x=>x.estado==='FINALIZADA');
  const countBy=(rows,key)=>Object.entries(rows.reduce((a,x)=>{const k=x[key]||'Sin dato';a[k]=(a[k]||0)+1;return a},{})).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
  const valueQuoted=quotes.data.filter(x=>x.estado!=='ANULADA').reduce((s,x)=>s+Number(x.monto||0),0);
  const dealers=finalized.filter(x=>x.tipo_ot==='CONCESIONARIO');
  const slots=Object.entries(citas.data.reduce((a,x)=>{const k=String(x.hora||'').slice(0,5)||'Sin hora';a[k]=(a[k]||0)+1;return a},{})).map(([label,value])=>({label,value})).sort((a,b)=>a.label.localeCompare(b.label));
  res.json({
    kpis:{serviciosFinalizados:finalized.length,citas:citas.data.length,valorCotizado:valueQuoted,metrosConsumidos:finalized.reduce((s,x)=>s+Number(x.metraje_estimado||0),0),stockCritico:inventory.data.filter(x=>x.estado_stock==='BAJO').length},
    porMarca:countBy(finalized,'marca_lamina'),porCategoria:countBy(finalized,'categoria_vehiculo'),porTipoCliente:countBy(finalized,'tipo_ot'),
    porTonalidad:countBy(finalized,'tonalidad'),porConcesionario:countBy(dealers,'cliente_o_concesionario'),horariosCitas:slots,
    citasPorLugar:[{label:'Local',value:citas.data.filter(x=>x.lugar_servicio==='LOCAL').length},{label:'Domicilio',value:citas.data.filter(x=>x.lugar_servicio==='DOMICILIO').length}]
  });
}));

export default router;
