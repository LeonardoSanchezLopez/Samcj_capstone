import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, apiError } from '../utils/http.js';
import { calculateRecommendation } from '../services/recommendation.service.js';
import { assertNotPastDate, assertPublicSlotAvailable, getAvailability } from '../services/schedule.service.js';

const router = Router();
router.get('/blocked-dates',asyncHandler(async(req,res)=>{
 const month=String(req.query.month||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw apiError('Mes inválido');
 const first=`${month}-01`,last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 const {data,error}=await supabaseAdmin.from('bloqueos_agenda').select('fecha,todo_el_dia').eq('activo',true).gte('fecha',first).lte('fecha',last);
 if(error)throw apiError('No se pudieron consultar los bloqueos',500);res.json(data||[]);
}));

const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,99}$/u;
const DNI_RE = /^\d{8}$/;
const PHONE_RE = /^9\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Límite básico por IP para evitar búsquedas masivas; usar Redis/gateway si se escala a múltiples instancias.
const dniAttempts=new Map();
function limitDniLookup(req,_res,next){
 const key=String(req.ip||req.socket.remoteAddress||'desconocido'),now=Date.now();
 if(dniAttempts.size>5000){for(const [k,v] of dniAttempts)if(v.until<=now)dniAttempts.delete(k);}
 const state=dniAttempts.get(key);
 if(!state||state.until<=now){dniAttempts.set(key,{count:1,until:now+900000});return next()}
 if(state.count>=10)return next(apiError('Demasiadas consultas. Vuelve a intentarlo en unos minutos.',429));
 state.count++;next();
}
// Búsqueda con segundo dato de comprobación; nunca revelar PII con solo DNI.
router.post('/customer-existing',limitDniLookup,asyncHandler(async(req,res)=>{
 const dni=String(req.body?.dni||''),telefono=String(req.body?.telefono||'');
 if(!DNI_RE.test(dni)||!PHONE_RE.test(telefono))throw apiError('Ingresa DNI y número de celular registrado');
 const result=await supabaseAdmin.from('clientes').select('nombres,apellidos,dni,telefono,correo,activo').eq('dni',dni).eq('telefono',telefono).eq('activo',true).maybeSingle();
 if(result.error)throw apiError('No fue posible validar al cliente',500);
 if(!result.data)throw apiError('No encontramos una coincidencia. Verifica el DNI y celular registrados.',404);
 res.json({cliente:result.data});
}));
router.get('/bootstrap' , asyncHandler(async (_req, res) => {
  const [config, categorias, especiales, calidades, marcas, tonalidades, servicios, preguntas] = await Promise.all([
    supabaseAdmin.from('configuracion_empresa').select('*').eq('id', 1).single(),
    supabaseAdmin.from('categorias_vehiculo').select('*').eq('activo', true).order('id'),
    supabaseAdmin.from('tipos_vehiculo_especial').select('*').eq('activo', true).order('nombre'),
    supabaseAdmin.from('calidades_lamina').select('*').eq('activo', true).order('id'),
    supabaseAdmin.from('marcas_lamina').select('*,calidades_lamina(id,codigo,nombre,metros_por_rollo)').eq('activo', true).order('id'),
    supabaseAdmin.from('tonalidades').select('*').eq('activo', true).order('orden'),
    supabaseAdmin.from('servicios').select('*').eq('activo', true).order('nombre'),
    supabaseAdmin.from('preguntas_cita').select('*,opciones_pregunta(*)').eq('activo', true).order('orden')
  ]);
  const errors = [config, categorias, especiales, calidades, marcas, tonalidades, servicios, preguntas].filter(x => x.error);
  if (errors.length) throw apiError('No se pudieron cargar los catálogos', 500, errors.map(e => e.error?.message));
  res.json({
    configuracion: config.data,
    categorias: categorias.data,
    especiales: especiales.data,
    calidades: calidades.data,
    marcas: marcas.data,
    tonalidades: tonalidades.data,
    servicios: servicios.data,
    preguntas: preguntas.data.map(q => ({
      ...q,
      opciones_pregunta: (q.opciones_pregunta || []).filter(o => o.activo).sort((a, b) => a.orden - b.orden)
    }))
  });
}));

router.get('/availability', asyncHandler(async (req, res) => {
  const { date, location = 'LOCAL' } = req.query;
  if (!date) throw apiError('Selecciona una fecha');
  if (!['LOCAL', 'DOMICILIO'].includes(location)) throw apiError('Lugar de servicio no válido');
  assertNotPastDate(date);
  const data = await getAvailability(date, location);
  res.json({ date, ...data });
}));

router.post('/recommendation', asyncHandler(async (req, res) => {
  res.json(calculateRecommendation(req.body?.answers || []));
}));

router.post('/quote', asyncHandler(async (req, res) => {
  const { servicioId, categoriaId, especialId = null, marcaId } = req.body || {};
  if (!servicioId || !categoriaId || !marcaId) throw apiError('Faltan datos para calcular la cotización');
  const { data, error } = await supabaseAdmin.rpc('fn_calcular_precio', {
    p_tipo_cliente: 'NATURAL',
    p_servicio_id: servicioId,
    p_categoria_vehiculo_id: categoriaId,
    p_marca_lamina_id: marcaId,
    p_tipo_vehiculo_especial_id: especialId || null
  });
  if (error) throw apiError('No se pudo calcular la cotización', 400, error.message);
  let monto = data;
  if (monto == null) {
    const base = await supabaseAdmin.from('servicios').select('id').eq('nombre', 'Polarizado completo').eq('activo', true).maybeSingle();
    if (base.data?.id && base.data.id !== servicioId) {
      const fallback = await supabaseAdmin.rpc('fn_calcular_precio', {
        p_tipo_cliente: 'NATURAL', p_servicio_id: base.data.id, p_categoria_vehiculo_id: categoriaId,
        p_marca_lamina_id: marcaId, p_tipo_vehiculo_especial_id: especialId || null
      });
      if (!fallback.error) monto = fallback.data;
    }
  }
  if (monto == null) throw apiError('No existe una tarifa configurada para esta selección', 400);
  res.json({ monto });
}));

function serviceFromAnswer(catalog, answers) {
  const selected = answers.find(a => a.preguntaCodigo === 'SERVICIO_DESEADO')?.opcionCodigo;
  const mapping = {
    POLARIZADO_COMPLETO: 'Polarizado completo',
    CAMBIAR_POLARIZADO: 'Cambio de lámina existente'
  };
  const wanted = mapping[selected] || 'Polarizado completo';
  return catalog.find(s => s.nombre === wanted) || catalog.find(s => s.nombre === 'Polarizado completo');
}

function validateCustomer(customer) {
  if (!customer?.nombres || !customer?.apellidos || !customer?.dni || !customer?.telefono) throw apiError('Completa los datos obligatorios del cliente');
  if (!NAME_RE.test(customer.nombres.trim())) throw apiError('Los nombres solo pueden contener letras');
  if (!NAME_RE.test(customer.apellidos.trim())) throw apiError('Los apellidos solo pueden contener letras');
  if (!DNI_RE.test(customer.dni)) throw apiError('El DNI debe contener exactamente 8 números');
  if (!PHONE_RE.test(customer.telefono)) throw apiError('El celular debe tener 9 dígitos y comenzar por 9');
  if (customer.correo && !EMAIL_RE.test(customer.correo)) throw apiError('Ingresa un correo electrónico válido');
}

router.post('/book', asyncHandler(async (req, res) => {
  const { customer, appointment, vehicle, answers = [], selection, idempotencyKey } = req.body || {};
  validateCustomer(customer);
  // No permitir sobrescribir fichas existentes con información diferente desde la reserva pública.
  const existing=await supabaseAdmin.from('clientes').select('nombres,apellidos,telefono').eq('dni',customer.dni).maybeSingle();
  if(existing.error)throw apiError('No fue posible validar el DNI',500);
  if(existing.data && (existing.data.nombres!==customer.nombres.trim()||existing.data.apellidos!==customer.apellidos.trim()||existing.data.telefono!==customer.telefono))
   throw apiError('El DNI ya está registrado con otros datos. Usa «Ya soy cliente» y verifica tu celular.',409);

  if (!UUID_RE.test(String(idempotencyKey || ''))) throw apiError('No se pudo validar la confirmación de la reserva. Recarga la página e inténtalo de nuevo.');

  const existingConfirmation = await supabaseAdmin.from('citas').select('id,fecha,hora').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existingConfirmation.error) throw apiError('No se pudo validar la confirmación de la reserva', 500, existingConfirmation.error.message);
  if (existingConfirmation.data) {
    const [existingQuote, existingOrder] = await Promise.all([
      supabaseAdmin.from('cotizaciones').select('id,monto').eq('cita_id', existingConfirmation.data.id).order('creado_en', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('ordenes_trabajo').select('id').eq('cita_id', existingConfirmation.data.id).order('creado_en', { ascending: false }).limit(1).maybeSingle()
    ]);
    return res.status(200).json({
      message: 'La reserva ya había sido confirmada', reused: true,
      cita: existingConfirmation.data,
      cotizacion: existingQuote.data || null,
      orden: existingOrder.data || null
    });
  }
  if (!appointment?.fecha || !appointment?.hora || !appointment?.lugarServicio) throw apiError('Completa la fecha, hora y lugar del servicio');
  assertNotPastDate(appointment.fecha);
  if (!['LOCAL', 'DOMICILIO'].includes(appointment.lugarServicio)) throw apiError('Lugar de servicio no válido');
  if (appointment.lugarServicio === 'DOMICILIO' && (!appointment.distrito || !appointment.calleAvenida?.trim())) throw apiError('Completa distrito/zona y calle con número para el servicio a domicilio');
  if (!vehicle?.categoriaId || !vehicle?.marca || !vehicle?.modelo || !vehicle?.anio) throw apiError('Completa categoría, marca, modelo y año del vehículo');
  if (!selection?.marcaId || !selection?.tonalidadId) throw apiError('Selecciona marca de lámina y tonalidad');

  // Comprobación amigable previa. La BD vuelve a comprobarlo dentro de la transacción.
  await assertPublicSlotAvailable(appointment.fecha, appointment.hora, appointment.lugarServicio);

  const { data: services, error: servicesError } = await supabaseAdmin.from('servicios').select('*').eq('activo', true);
  if (servicesError) throw apiError('No se pudo cargar el servicio');
  const service = serviceFromAnswer(services, answers);
  if (!service) throw apiError('No existe un servicio configurado');

  // La cotización debe existir antes de confirmar: ya no se guarda "sujeto a evaluación".
  const quoteResult = await supabaseAdmin.rpc('fn_calcular_precio', {
    p_tipo_cliente: 'NATURAL',
    p_servicio_id: service.id,
    p_categoria_vehiculo_id: vehicle.categoriaId,
    p_marca_lamina_id: selection.marcaId,
    p_tipo_vehiculo_especial_id: vehicle.especialId || null
  });
  if (quoteResult.error) throw apiError('No se pudo calcular el precio', 400, quoteResult.error.message);
  if (quoteResult.data == null) {
    const baseService = services.find(s => s.nombre === 'Polarizado completo');
    if (baseService && baseService.id !== service.id) {
      const fallback = await supabaseAdmin.rpc('fn_calcular_precio', {
        p_tipo_cliente: 'NATURAL', p_servicio_id: baseService.id, p_categoria_vehiculo_id: vehicle.categoriaId,
        p_marca_lamina_id: selection.marcaId, p_tipo_vehiculo_especial_id: vehicle.especialId || null
      });
      if (fallback.error || fallback.data == null) throw apiError('No existe una tarifa configurada para esta combinación. Elige otra opción o comunícate con SAMCJ.', 400);
    } else {
      throw apiError('No existe una tarifa configurada para esta combinación. Elige otra opción o comunícate con SAMCJ.', 400);
    }
  }

  const rec = calculateRecommendation(answers);
  const [{ data: recBrand }, { data: recTone }, { data: recQuality }] = await Promise.all([
    supabaseAdmin.from('marcas_lamina').select('id').eq('nombre', rec.marca).maybeSingle(),
    supabaseAdmin.from('tonalidades').select('id').eq('porcentaje', rec.tonalidad).maybeSingle(),
    supabaseAdmin.from('calidades_lamina').select('id').eq('nombre', rec.calidad).maybeSingle()
  ]);

  const rpc = await supabaseAdmin.rpc('fn_registrar_reserva_publica', {
    p_idempotency_key: idempotencyKey,
    p_cliente: {
      nombres: customer.nombres.trim(), apellidos: customer.apellidos.trim(), dni: customer.dni,
      telefono: customer.telefono, correo: customer.correo || ''
    },
    p_cita: {
      servicio_id: service.id,
      fecha: appointment.fecha,
      hora: appointment.hora,
      lugar_servicio: appointment.lugarServicio,
      distrito: appointment.lugarServicio === 'DOMICILIO' ? appointment.distrito : '',
      calle_avenida: appointment.lugarServicio === 'DOMICILIO' ? appointment.calleAvenida.trim() : '',
      referencia: appointment.lugarServicio === 'DOMICILIO' ? (appointment.referencia || '') : '',
      categoria_vehiculo_id: vehicle.categoriaId,
      tipo_vehiculo_especial_id: vehicle.especialId || '',
      marca_vehiculo: vehicle.marca,
      modelo_vehiculo: vehicle.modelo,
      anio_vehiculo: Number(vehicle.anio),
      observaciones: answers.find(a => a.preguntaCodigo === 'SERVICIO_DESEADO')?.opcionCodigo === 'NO_SEGURO'
        ? 'Servicio exacto por confirmar durante la asesoría.' : ''
    },
    p_respuestas: answers.filter(a => a.preguntaId && a.opcionId).map(a => ({ pregunta_id: a.preguntaId, opcion_id: a.opcionId })),
    p_recomendacion: {
      calidad_lamina_id: recQuality?.id || '',
      marca_lamina_id: recBrand?.id || '',
      tonalidad_id: recTone?.id || '',
      explicacion: rec.explicacion
    },
    p_seleccion: { marca_lamina_id: selection.marcaId, tonalidad_id: selection.tonalidadId }
  });
  if (rpc.error) throw apiError('No se pudo confirmar la reserva', 409, rpc.error.message);
  if (!rpc.data?.reused) {
    // El error de la campana no debe invalidar una cita que ya fue confirmada.
    const note = await supabaseAdmin.from('notificaciones').insert({
      tipo:'CITA',titulo:'Nueva cita registrada',
      mensaje:`Nueva reserva para ${appointment.fecha} a las ${appointment.hora}. Revisa el módulo Citas.`
    });
    if (note.error) console.warn('Aviso de nueva cita no registrado:',note.error.message);
  }

  res.status(201).json({ message: rpc.data?.reused ? 'La reserva ya había sido confirmada' : 'Cita registrada correctamente', ...rpc.data });
}));

export default router;
