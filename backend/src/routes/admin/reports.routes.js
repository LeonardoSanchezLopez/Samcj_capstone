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
