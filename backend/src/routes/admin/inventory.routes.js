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


export default router;
