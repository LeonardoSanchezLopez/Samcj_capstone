import {Router} from 'express';
import {supabaseAdmin} from '../config/supabase.js';
import {requireAdmin} from '../middleware/auth.js';
import {asyncHandler,apiError,ensureData} from '../utils/http.js';
import {buildForecast} from '../services/forecast.service.js';
const r=Router();r.use(requireAdmin);
r.get('/inventory/predictions',asyncHandler(async(req,res)=>res.json(await buildForecast(Number(req.query.days||60),req.query.scenario||'NORMAL'))));
r.put('/inventory/:id/replenishment',asyncHandler(async(req,res)=>{
 const b=req.body||{},lead=Number(b.plazo_normal_dias),scarcity=Number(b.plazo_escasez_dias),safety=Number(b.stock_seguridad_metros),cost=b.costo_rollo===''||b.costo_rollo==null?null:Number(b.costo_rollo);
 if(!Number.isInteger(lead)||lead<1||lead>365||!Number.isInteger(scarcity)||scarcity<1||scarcity>365||!Number.isFinite(safety)||safety<0||cost!==null&&(!Number.isFinite(cost)||cost<0))throw apiError('Datos de reposición inválidos');
 const data=ensureData(await supabaseAdmin.from('configuracion_reposicion').upsert({inventario_id:req.params.id,plazo_normal_dias:lead,plazo_escasez_dias:scarcity,stock_seguridad_metros:safety,costo_rollo:cost,actualizado_en:new Date().toISOString()}).select().single());res.json(data);
}));
r.get('/purchase-plans',asyncHandler(async(req,res)=>{const data=ensureData(await supabaseAdmin.from('planes_compra').select('*,planes_compra_detalles(*)').order('creado_en',{ascending:false}).limit(30));res.json(data)}));
r.post('/purchase-plans',asyncHandler(async(req,res)=>{
 const {nombre,horizonte_dias,items}=req.body||{};
 if(![30,60,90].includes(Number(horizonte_dias))||!Array.isArray(items)||!items.length||items.length>100||!String(nombre||'').trim())throw apiError('Plan de compras inválido');
 const stock=ensureData(await supabaseAdmin.from('inventario').select('id'));const allowed=new Set(stock.map(x=>x.id));const seen=new Set();
 for(const x of items){if(!allowed.has(x.inventario_id)||seen.has(x.inventario_id)||![x.rollos_sugeridos,x.rollos_aprobados].every(n=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=1000))throw apiError('Producto o cantidad inválida');seen.add(x.inventario_id);}
 const plan=ensureData(await supabaseAdmin.from('planes_compra').insert({nombre:String(nombre).trim().slice(0,120),horizonte_dias,creado_por:req.auth.perfil.id}).select().single());
 const details=items.map(x=>({plan_id:plan.id,inventario_id:x.inventario_id,rollos_sugeridos:Number(x.rollos_sugeridos),rollos_aprobados:Number(x.rollos_aprobados),fecha_pedido_sugerida:x.fecha_pedido_sugerida||null}));
 const result=await supabaseAdmin.from('planes_compra_detalles').insert(details);
 if(result.error){await supabaseAdmin.from('planes_compra').delete().eq('id',plan.id);throw apiError('No se pudo guardar el detalle',500)}res.status(201).json(plan);
}));
r.patch('/purchase-plans/:id/review',asyncHandler(async(req,res)=>res.json(ensureData(await supabaseAdmin.from('planes_compra').update({estado:'REVISADO'}).eq('id',req.params.id).select().single()))));
export default r;
