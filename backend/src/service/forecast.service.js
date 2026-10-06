import { supabaseAdmin } from '../config/supabase.js';
import { apiError } from '../utils/http.js';
const daysBetween=(a,b)=>Math.max(0,Math.round((new Date(`${b}T12:00:00Z`)-new Date(`${a}T12:00:00Z`))/86400000));
const dateAfter=(iso,days)=>{const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const limaDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function buildForecast(horizon=60,scenario='NORMAL'){
 if(![30,60,90].includes(Number(horizon)))throw apiError('Horizonte de predicción inválido');
 if(!['NORMAL','ESCASEZ'].includes(scenario))throw apiError('Escenario inválido');
 const today=limaDay(),since=dateAfter(today,-365),until=dateAfter(today,Number(horizon));
 const [stock,moves,orders,configs]=await Promise.all([
  supabaseAdmin.from('v_inventario').select('*'),
  supabaseAdmin.from('movimientos_inventario').select('inventario_id,metros,creado_en').eq('tipo_movimiento','CONSUMO').gte('creado_en',`${since}T00:00:00Z`).order('creado_en',{ascending:false}).limit(10000),
  supabaseAdmin.from('ordenes_trabajo').select('id,estado,marca_lamina_id,tonalidad_id,metraje_estimado,fecha_inicio').eq('activo',true).in('estado',['EN_PROCESO','PENDIENTE_VALIDACION']).gte('fecha_inicio',`${today}T00:00:00-05:00`).lte('fecha_inicio',`${until}T23:59:59-05:00`).limit(1000),
  supabaseAdmin.from('configuracion_reposicion').select('*')
 ]);
 if([stock,moves,orders,configs].some(r=>r.error))throw apiError('No se pudo calcular la predicción. Comprueba que aplicaste la migración V6.3.0.',500);
 const configById=new Map(configs.data.map(x=>[x.inventario_id,x]));
 const catalog=await supabaseAdmin.from('inventario').select('id,marca_lamina_id,tonalidad_id');if(catalog.error)throw apiError('Inventario no disponible',500);
 const ids=new Map(catalog.data.map(x=>[`${x.marca_lamina_id}:${x.tonalidad_id}`,x.id]));
 const promised=new Map();for(const o of orders.data){const id=ids.get(`${o.marca_lamina_id}:${o.tonalidad_id}`);if(id)promised.set(id,(promised.get(id)||0)+Number(o.metraje_estimado||0));}
 const movedById=new Map();for(const m of moves.data){const arr=movedById.get(m.inventario_id)||[];arr.push(m);movedById.set(m.inventario_id,arr);}
 return {horizon:Number(horizon),scenario,fecha_calculo:today,products:stock.data.map(s=>{
  const hist=movedById.get(s.id)||[];const historic30=hist.filter(m=>daysBetween(String(m.creado_en).slice(0,10),today)<=30).reduce((a,b)=>a+Number(b.metros),0);
  const historic90=hist.filter(m=>daysBetween(String(m.creado_en).slice(0,10),today)<=90).reduce((a,b)=>a+Number(b.metros),0);
  const observedDays=hist.length?Math.min(90,Math.max(30,daysBetween(hist[hist.length-1].creado_en.slice(0,10),today))):90;
  const daily=hist.length?Math.max(historic30/30,historic90/Math.min(90,observedDays)):0;
  const stockNow=Number(s.metros_actuales||0),scheduled=promised.get(s.id)||0,forecastBase=daily*Number(horizon);
  // Los trabajos programados están dentro del horizonte, pero no se suman dos veces al promedio estimado.
  const demand=Math.max(forecastBase,scheduled);const config=configById.get(s.id)||{};
  const lead=scenario==='ESCASEZ'?(config.plazo_escasez_dias??45):(config.plazo_normal_dias??20);
  const safety=Number(config.stock_seguridad_metros??s.metros_minimos??5),rollMeters=Number(s.metros_por_rollo)||45;
  const daysCover=daily>0?Math.floor(stockNow/daily):null;
  const reorderPoint=daily*lead+safety;
  const buyMeters=Math.max(0,demand+safety-stockNow);
  const rolls=Math.ceil(buyMeters/rollMeters);
  const daysToOrder=daily>0?Math.max(0,Math.floor((stockNow-reorderPoint)/daily)):null;
  const priority=stockNow<reorderPoint?'CRITICO':stockNow<reorderPoint+daily*15?'ATENCION':'NORMAL';
  return {...s,stock_actual:stockNow,consumo_30:historic30,consumo_90:historic90,consumo_diario:daily,demanda_proyectada:Number(demand.toFixed(1)),stock_proyectado:Number((stockNow-demand).toFixed(1)),comprometido:scheduled,cobertura_dias:daysCover,fecha_agotamiento:daysCover==null?null:dateAfter(today,daysCover),plazo_reposicion_dias:lead,plazo_normal_dias:config.plazo_normal_dias??20,plazo_escasez_dias:config.plazo_escasez_dias??45,stock_seguridad:safety,punto_pedido:Number(reorderPoint.toFixed(1)),dias_para_pedir:daysToOrder,rollos_sugeridos:rolls,metros_sugeridos:rolls*rollMeters,prioridad:priority,confianza:hist.length<12?'BAJA':hist.length<35?'MEDIA':'ALTA',costo_rollo:config.costo_rollo??null};
 })};
}
