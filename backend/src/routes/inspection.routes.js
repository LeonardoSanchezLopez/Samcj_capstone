import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {supabaseAdmin} from '../config/supabase.js';
import {requireAdmin} from '../middleware/auth.js';
import {asyncHandler,apiError,ensureData} from '../utils/http.js';
import {ANGLES,validateToken,validateDraft,attachDraft,inspectionForOrder,photosForInspection,signedPhotos,compareWithGemini} from '../services/inspection.service.js';
const router=Router();router.use(requireAdmin);
router.post('/inspections/stage',asyncHandler(async(req,res)=>{
 const {token,angulo,base64}=req.body||{};validateToken(token);
 if(!ANGLES.includes(angulo)||typeof base64!=='string'||base64.length>4000000||base64.length<100)throw apiError('Imagen inválida o demasiado grande (máximo 3 MB)');
 const bytes=Buffer.from(base64,'base64');if(bytes.length>3000000||bytes.length<500||bytes[0]!==0xff||bytes[1]!==0xd8)throw apiError('La fotografía debe ser JPG válido');
 const owner=req.auth.perfil.id;
 const existing=await supabaseAdmin.from('fotografias_ot').select('id,ruta_storage').eq('borrador_token',token).eq('usuario_id',owner).eq('angulo',angulo).is('inspeccion_id',null).maybeSingle();
 if(existing.error)throw apiError('No se pudo consultar el borrador',500);
 const path=`borradores/${owner}/${token}/${angulo}-${randomUUID()}.jpg`;
 const upload=await supabaseAdmin.storage.from('inspecciones-ot').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
 if(upload.error)throw apiError('No se pudo guardar la fotografía. Comprueba Storage y la migración.',500);
 const db=existing.data
  ? await supabaseAdmin.from('fotografias_ot').update({ruta_storage:path,creado_en:new Date().toISOString()}).eq('id',existing.data.id).select('id').single()
  : await supabaseAdmin.from('fotografias_ot').insert({borrador_token:token,usuario_id:owner,angulo,ruta_storage:path}).select('id').single();
 if(db.error){await supabaseAdmin.storage.from('inspecciones-ot').remove([path]);throw apiError('No se pudo asociar fotografía',500)}
 if(existing.data)await supabaseAdmin.storage.from('inspecciones-ot').remove([existing.data.ruta_storage]);
 res.status(201).json({id:db.data.id,angulo});
}));
router.get('/inspections/:orderId',asyncHandler(async(req,res)=>{
 const order=ensureData(await supabaseAdmin.from('ordenes_trabajo').select('id').eq('id',req.params.orderId).single());
 const items=await signedPhotos(order.id);const final=items.find(x=>x.tipo==='ENTREGA')?.inspeccion;
 const findings=final?ensureData(await supabaseAdmin.from('hallazgos_inspeccion').select('*').eq('inspeccion_id',final.id)):[];
 res.json({etapas:items,hallazgos:findings});
}));
router.post('/inspections/:orderId/final-attach',asyncHandler(async(req,res)=>{
 const order=ensureData(await supabaseAdmin.from('ordenes_trabajo').select('id,tipo_ot,estado').eq('id',req.params.orderId).single());
 if(order.tipo_ot!=='CONCESIONARIO'||order.estado!=='EN_PROCESO')throw apiError('La OT no permite inspección final');
 if(!(await inspectionForOrder(order.id,'RECEPCION')))throw apiError('Falta inspección inicial');
 const inspection=await attachDraft(order.id,req.body?.token,req.auth.perfil.id,'ENTREGA');res.json(inspection);
}));
router.post('/inspections/:orderId/compare',asyncHandler(async(req,res)=>{
 const result=await compareWithGemini(req.params.orderId);res.json({hallazgos:result});
}));
router.post('/inspections/:orderId/review',asyncHandler(async(req,res)=>{
 const final=await inspectionForOrder(req.params.orderId,'ENTREGA');if(!final)throw apiError('Faltan fotos finales');
 const photos=await photosForInspection(final.id);if(photos.length!==4)throw apiError('Faltan fotografías finales');
 const review=req.body?.revisiones;
 if(!Array.isArray(review))throw apiError('Confirmación inválida');
 const findings=ensureData(await supabaseAdmin.from('hallazgos_inspeccion').select('id').eq('inspeccion_id',final.id));
 if(findings.length!==review.length||new Set(review.map(x=>x.id)).size!==findings.length||!findings.every(x=>review.some(r=>r.id===x.id&&['CONFIRMADO','DESCARTADO'].includes(r.estado))))throw apiError('Revisa cada hallazgo antes de confirmar');
 for(const r of review){const update=await supabaseAdmin.from('hallazgos_inspeccion').update({estado_revision:r.estado,observacion_admin:String(r.observacion||'').slice(0,1000),revisado_por:req.auth.perfil.id,revisado_en:new Date().toISOString()}).eq('id',r.id).eq('inspeccion_id',final.id);if(update.error)throw apiError('No se pudo confirmar un hallazgo',500);}
 ensureData(await supabaseAdmin.from('inspecciones_ot').update({estado:'REVISADA',revisado_por:req.auth.perfil.id,revisado_en:new Date().toISOString()}).eq('id',final.id).select().single());res.json({ok:true});
}));
export default router;
