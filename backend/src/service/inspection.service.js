import {supabaseAdmin} from '../config/supabase.js';
import {apiError,ensureData} from '../utils/http.js';
export const ANGLES=['FRONTAL','POSTERIOR','IZQUIERDO','DERECHO'];
const BUCKET='inspecciones-ot';
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
export function validateToken(t){if(!UUID.test(String(t||'')))throw apiError('Identificador de sesión fotográfica inválido');return t;}
export async function validateDraft(token,owner){
 validateToken(token);
 const rows=ensureData(await supabaseAdmin.from('fotografias_ot').select('id,angulo,ruta_storage').eq('borrador_token',token).eq('usuario_id',owner).is('inspeccion_id',null));
 if(rows.length!==4||new Set(rows.map(x=>x.angulo)).size!==4||!ANGLES.every(a=>rows.some(x=>x.angulo===a)))throw apiError('Debes tomar las cuatro fotografías iniciales del vehículo antes de registrar la OT',400);
 return rows;
}
export async function attachDraft(orderId,token,owner,type){
 const drafts=await validateDraft(token,owner);
 const existing=await supabaseAdmin.from('inspecciones_ot').select('id').eq('orden_trabajo_id',orderId).eq('tipo',type).maybeSingle();
 if(existing.error)throw apiError('No se pudo consultar la inspección',500);
 if(existing.data)throw apiError('Ya existe una inspección de este tipo',409);
 const inspection=ensureData(await supabaseAdmin.from('inspecciones_ot').insert({orden_trabajo_id:orderId,tipo:type,estado:type==='RECEPCION'?'REVISADA':'COMPLETA',revisado_por:type==='RECEPCION'?owner:null,revisado_en:type==='RECEPCION'?new Date().toISOString():null}).select().single());
 const link=await supabaseAdmin.from('fotografias_ot').update({inspeccion_id:inspection.id,borrador_token:null}).in('id',drafts.map(x=>x.id)).eq('usuario_id',owner).eq('borrador_token',token).select('id');
 if(link.error||link.data?.length!==4){await supabaseAdmin.from('inspecciones_ot').delete().eq('id',inspection.id);throw apiError('Error al asociar las fotografías; no continúes sin revisar la OT',500);}
 return inspection;
}
export async function inspectionForOrder(id,type){
 const item=await supabaseAdmin.from('inspecciones_ot').select('*').eq('orden_trabajo_id',id).eq('tipo',type).maybeSingle();
 if(item.error)throw apiError('Error consultando inspección',500);return item.data;
}
export async function photosForInspection(id){return ensureData(await supabaseAdmin.from('fotografias_ot').select('*').eq('inspeccion_id',id));}
export async function signedPhotos(id){
 const all=await Promise.all(['RECEPCION','ENTREGA'].map(async type=>{
 const ins=await inspectionForOrder(id,type);if(!ins)return {tipo:type,fotos:[],inspeccion:null};
 const files=await photosForInspection(ins.id);return {tipo:type,inspeccion:ins,fotos:await Promise.all(files.map(async x=>{
  const {data}=await supabaseAdmin.storage.from(BUCKET).createSignedUrl(x.ruta_storage,600);
  return {...x,url:data?.signedUrl||null};
 }))};
 }));return all;
}
export async function compareWithGemini(orderId){
 const key=process.env.GEMINI_API_KEY;if(!key)throw apiError('Gemini no está configurado. Puedes realizar la revisión manual.',503);
 const initial=await inspectionForOrder(orderId,'RECEPCION'),final=await inspectionForOrder(orderId,'ENTREGA');
 if(!initial||!final)throw apiError('Faltan fotografías iniciales o finales');
 const before=await photosForInspection(initial.id),after=await photosForInspection(final.id);
 if(before.length!==4||after.length!==4)throw apiError('Debes completar los cuatro ángulos de ambas etapas');
 const parts=[{text:'Compara los pares ANTES y DESPUÉS del mismo vehículo para los ángulos FRONTAL, POSTERIOR, IZQUIERDO y DERECHO. Señala SOLO diferencias visibles que requieran inspección humana, nunca afirmes origen, culpabilidad ni ausencia de daños. La iluminación y los reflejos pueden causar falsos positivos. Devuelve exclusivamente JSON válido como {"hallazgos":[{"angulo":"FRONTAL","descripcion":"Posible ..."}]}. Máximo 8 hallazgos. Si no hay indicios claros, array vacío.'}];
 for(const angle of ANGLES){for(const [label,rows] of [['ANTES',before],['DESPUES',after]]){
 const photo=rows.find(x=>x.angulo===angle);const result=await supabaseAdmin.storage.from(BUCKET).download(photo.ruta_storage);
 if(result.error)throw apiError('No se pudo descargar una fotografía',500);
 const base64=Buffer.from(await result.data.arrayBuffer()).toString('base64');parts.push({text:`${angle} ${label}:`},{inline_data:{mime_type:'image/jpeg',data:base64}});
 }}
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),50000);
 let response;try{response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL||'gemini-2.5-flash'}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts}],generationConfig:{responseMimeType:'application/json',temperature:0.1}}),signal:controller.signal});}catch{throw apiError('No fue posible conectar con Gemini. Continúa con revisión manual.',503)}finally{clearTimeout(timer)}
 if(!response.ok)throw apiError('Gemini no está disponible o alcanzó la cuota. Continúa con revisión manual.',503);
 const raw=await response.json();let parsed;try{parsed=JSON.parse(raw.candidates?.[0]?.content?.parts?.find(x=>x.text)?.text||'{}')}catch{throw apiError('Respuesta de IA no válida; revisa manualmente.',503)}
 if(!Array.isArray(parsed.hallazgos))throw apiError('El análisis no pudo completarse',503);
 await supabaseAdmin.from('hallazgos_inspeccion').delete().eq('inspeccion_id',final.id);
 const items=parsed.hallazgos.filter(x=>ANGLES.includes(x.angulo)&&typeof x.descripcion==='string'&&x.descripcion.length<600).slice(0,8).map(x=>({inspeccion_id:final.id,angulo:x.angulo,descripcion_ia:x.descripcion,estado_revision:'PENDIENTE'}));
 if(items.length)ensureData(await supabaseAdmin.from('hallazgos_inspeccion').insert(items));
 return items;
}
