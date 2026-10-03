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

export default router;
