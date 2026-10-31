import { supabaseAdmin } from '../config/supabase.js';
import { apiError } from '../utils/http.js';
import { holidayName } from './holidays.service.js';

const LIMA = 'America/Lima';

export const toMinutes = (hhmm = '00:00') => {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

export const toTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

export function limaParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const o = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, minutes: Number(o.hour) * 60 + Number(o.minute) };
}

export function assertNotPastDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw apiError('Fecha no válida');
  const today = limaParts(new Date()).date;
  if (date < today) throw apiError('No puedes seleccionar una fecha que ya pasó', 400);
  // El servicio de polarizado no atiende domingos (fecha local, sin conversión UTC).
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw apiError('Fecha no válida', 400);
  if (d.getUTCDay() === 0) throw apiError('Los domingos no son laborables. Selecciona otro día.', 400);
  const feriado=holidayName(date); if(feriado) throw apiError(`El ${date} es feriado nacional (${feriado}). Selecciona otro día.`,400);
}

export async function getScheduleConfig() {
  const { data, error } = await supabaseAdmin.from('configuracion_empresa').select('*').eq('id', 1).single();
  if (error) throw apiError('No se pudo cargar la configuración de agenda', 500, error.message);
  return data;
}

export function serviceDuration(config, location = 'LOCAL') {
  return location === 'DOMICILIO'
    ? Number(config.duracion_domicilio_minutos || 180)
    : Number(config.duracion_servicio_minutos || 120);
}

export function candidateSlots(config, duration) {
  const interval = Number(config.intervalo_citas_minutos || 30);
  const periods = [
    [String(config.turno_manana_inicio).slice(0, 5), String(config.turno_manana_fin).slice(0, 5)],
    [String(config.turno_tarde_inicio).slice(0, 5), String(config.turno_tarde_fin).slice(0, 5)]
  ];
  const result = [];
  for (const [startText, endText] of periods) {
    const start = toMinutes(startText), end = toMinutes(endText);
    for (let m = start; m + duration <= end; m += interval) result.push(toTime(m));
  }
  return result;
}

function workBounds(config) {
  return {
    morningStart: toMinutes(config.turno_manana_inicio),
    morningEnd: toMinutes(config.turno_manana_fin),
    afternoonStart: toMinutes(config.turno_tarde_inicio),
    afternoonEnd: toMinutes(config.turno_tarde_fin)
  };
}

function advanceWorkingMinutes(config, start, minutesToAdd) {
  const { morningStart, morningEnd, afternoonStart, afternoonEnd } = workBounds(config);
  let current = start;
  let remaining = minutesToAdd;

  while (remaining > 0) {
    if (current < morningStart) current = morningStart;
    if (current >= morningEnd && current < afternoonStart) current = afternoonStart;
    if (current >= afternoonEnd) return null;

    const segmentEnd = current < morningEnd ? morningEnd : afternoonEnd;
    const available = Math.max(0, segmentEnd - current);
    if (available === 0) {
      if (segmentEnd === morningEnd) { current = afternoonStart; continue; }
      return null;
    }

    const consumed = Math.min(remaining, available);
    current += consumed;
    remaining -= consumed;

    if (remaining > 0 && current >= morningEnd && current < afternoonStart) current = afternoonStart;
    else if (remaining > 0 && current === morningEnd) current = afternoonStart;
  }

  return current <= afternoonEnd ? current : null;
}

/**
 * Regla operativa SAMCJ para lotes de concesionario:
 * - Cada pareja de vehículos atendida en paralelo consume ~180 minutos de trabajo.
 * - Si queda un vehículo impar, ese último consume ~120 minutos con ambos trabajando juntos.
 * - El descanso 13:00-14:00 no cuenta como tiempo de trabajo.
 */
export function calculateDealerBatchEnd(config, startTime, vehicleCount) {
  const count = Number(vehicleCount);
  if (!Number.isInteger(count) || count < 2 || count > 5) return null;
  const { morningStart, morningEnd, afternoonStart, afternoonEnd } = workBounds(config);
  let current = toMinutes(startTime);
  const validStart = (current >= morningStart && current < morningEnd) || (current >= afternoonStart && current < afternoonEnd);
  if (!validStart) return null;

  let remainingVehicles = count;
  while (remainingVehicles > 0) {
    const batchSize = remainingVehicles >= 2 ? 2 : 1;
    const workMinutes = batchSize === 2 ? 180 : 120;
    current = advanceWorkingMinutes(config, current, workMinutes);
    if (current == null || current > afternoonEnd) return null;
    remainingVehicles -= batchSize;
  }
  return toTime(current);
}

export async function dayOccupancy(date, { excludeCitaId = null, excludeOrderId = null } = {}) {
  const dayStart = new Date(`${date}T00:00:00-05:00`).toISOString();
  const next = new Date(`${date}T00:00:00-05:00`); next.setDate(next.getDate() + 1);
  const dayEnd = next.toISOString();

  const [config, citasRes, otRes, blocksRes, dealerBlocksRes] = await Promise.all([
    getScheduleConfig(),
    supabaseAdmin.from('citas').select('id,hora,lugar_servicio,estado').eq('fecha', date).eq('activo', true).in('estado', ['RESERVADA', 'CONFIRMADA', 'ATENDIDA']),
    supabaseAdmin.from('ordenes_trabajo').select('id,fecha_inicio,estado,tipo_ot,bloque_atencion_id').eq('tipo_ot', 'CONCESIONARIO').eq('activo', true).is('bloque_atencion_id', null).gte('fecha_inicio', dayStart).lt('fecha_inicio', dayEnd).in('estado', ['EN_PROCESO', 'FINALIZADA']),
    supabaseAdmin.from('bloqueos_agenda').select('*').eq('fecha', date).eq('activo', true),
    supabaseAdmin.from('bloques_atencion_concesionario').select('id,fecha,hora_inicio,hora_fin,cantidad_vehiculos,estado,activo,concesionario_id').eq('fecha', date).eq('activo', true).neq('estado', 'CANCELADO')
  ]);
  if (citasRes.error || otRes.error || blocksRes.error || dealerBlocksRes.error) {
    throw apiError('No se pudo consultar la agenda', 500, [citasRes.error, otRes.error, blocksRes.error, dealerBlocksRes.error].filter(Boolean));
  }

  const intervals = [];
  for (const c of citasRes.data || []) {
    if (excludeCitaId && c.id === excludeCitaId) continue;
    const start = toMinutes(c.hora);
    const duration = serviceDuration(config, c.lugar_servicio);
    intervals.push({ source: 'CITA', id: c.id, start, end: start + duration, vehicles: 1 });
  }
  for (const ot of otRes.data || []) {
    if (excludeOrderId && ot.id === excludeOrderId) continue;
    const parts = limaParts(ot.fecha_inicio);
    if (parts.date !== date) continue;
    const duration = Number(config.duracion_servicio_minutos || 120);
    intervals.push({ source: 'CONCESIONARIO_INDIVIDUAL', id: ot.id, start: parts.minutes, end: parts.minutes + duration, vehicles: 1 });
  }
  for (const block of dealerBlocksRes.data || []) {
    intervals.push({
      source: 'LOTE_CONCESIONARIO', id: block.id,
      start: toMinutes(block.hora_inicio), end: toMinutes(block.hora_fin),
      vehicles: Number(block.cantidad_vehiculos || 0)
    });
  }

  const blocks = (blocksRes.data || []).map(b => ({
    ...b,
    start: b.hora_inicio ? toMinutes(b.hora_inicio) : null,
    end: b.hora_fin ? toMinutes(b.hora_fin) : null
  }));

  const reservedDealerVehicles = (dealerBlocksRes.data || []).reduce((sum, x) => sum + Number(x.cantidad_vehiculos || 0), 0);
  const dailyCount = (citasRes.data?.length || 0) + (otRes.data?.length || 0) + reservedDealerVehicles;
  return { config, intervals, blocks, dailyCount };
}

export async function getAvailability(date, location = 'LOCAL', options = {}) {
  assertNotPastDate(date);
  const { config, intervals, blocks, dailyCount } = await dayOccupancy(date, options);
  const duration = serviceDuration(config, location);
  const fullDay = blocks.some(b => b.todo_el_dia);
  const dailyFull = dailyCount >= Number(config.max_servicios_dia || 5);
  const now = limaParts(new Date());
  const slots = candidateSlots(config, duration).map(time => {
    const start = toMinutes(time), end = start + duration;
    const occupied = intervals.some(x => overlaps(start, end, x.start, x.end));
    const blocked = blocks.some(b => !b.todo_el_dia && b.start != null && overlaps(start, end, b.start, b.end));
    const past = now.date === date && start <= now.minutes;
    return { time, available: !fullDay && !dailyFull && !occupied && !blocked && !past };
  });
  return { slots, remaining: Math.max(0, Number(config.max_servicios_dia || 5) - dailyCount), duration };
}

export async function getDealerBatchAvailability(date, vehicleCount) {
  assertNotPastDate(date);
  const count = Number(vehicleCount);
  if (!Number.isInteger(count) || count < 2 || count > 5) throw apiError('La cantidad del lote debe ser de 2 a 5 vehículos');

  const { config, intervals, blocks, dailyCount } = await dayOccupancy(date);
  const interval = Number(config.intervalo_citas_minutos || 30);
  const maxDaily = Number(config.max_servicios_dia || 5);
  const { morningStart, morningEnd, afternoonStart, afternoonEnd } = workBounds(config);
  const fullDay = blocks.some(b => b.todo_el_dia);
  const now = limaParts(new Date());
  const slots = [];

  for (let start = morningStart; start < afternoonEnd; start += interval) {
    const isWorkingStart = (start >= morningStart && start < morningEnd) || (start >= afternoonStart && start < afternoonEnd);
    if (!isWorkingStart) continue;
    const time = toTime(start);
    const endTime = calculateDealerBatchEnd(config, time, count);
    if (!endTime) continue;
    const end = toMinutes(endTime);
    const occupied = intervals.some(x => overlaps(start, end, x.start, x.end));
    const blocked = blocks.some(b => !b.todo_el_dia && b.start != null && overlaps(start, end, b.start, b.end));
    const past = now.date === date && start <= now.minutes;
    const capacityExceeded = dailyCount + count > maxDaily;
    slots.push({ time, end: endTime, available: !fullDay && !occupied && !blocked && !past && !capacityExceeded });
  }

  return {
    slots,
    remaining: Math.max(0, maxDaily - dailyCount),
    vehicleCount: count,
    rule: 'PAREJAS_180_SOBRANTE_120'
  };
}

export async function assertPublicSlotAvailable(date, time, location, { excludeCitaId = null } = {}) {
  assertNotPastDate(date);
  const { slots } = await getAvailability(date, location, { excludeCitaId });
  if (!slots.some(x => x.time === String(time).slice(0, 5) && x.available)) {
    throw apiError('Ese horario ya no está disponible. Elige otro horario.', 409);
  }
}

export async function assertDealerSlotAvailable(fechaInicio, { excludeOrderId = null } = {}) {
  if (!fechaInicio) throw apiError('Selecciona la fecha y hora de inicio');
  const parts = limaParts(fechaInicio);
  assertNotPastDate(parts.date);
  const { config, intervals, blocks, dailyCount } = await dayOccupancy(parts.date, { excludeOrderId });
  if (dailyCount >= Number(config.max_servicios_dia || 5)) throw apiError('Se alcanzó el máximo de servicios programados para ese día', 409);

  const duration = Number(config.duracion_servicio_minutos || 120);
  const start = parts.minutes, end = start + duration;
  const interval = Number(config.intervalo_citas_minutos || 30);
  if (start % interval !== 0) throw apiError(`La hora de inicio debe respetar intervalos de ${interval} minutos`);

  const morningStart = toMinutes(config.turno_manana_inicio), morningEnd = toMinutes(config.turno_manana_fin);
  const afternoonStart = toMinutes(config.turno_tarde_inicio), afternoonEnd = toMinutes(config.turno_tarde_fin);
  const fitsTurn = (start >= morningStart && end <= morningEnd) || (start >= afternoonStart && end <= afternoonEnd);
  if (!fitsTurn) throw apiError('La OT individual debe iniciar y terminar dentro de un turno de trabajo');

  if (blocks.some(b => b.todo_el_dia || (b.start != null && overlaps(start, end, b.start, b.end)))) {
    throw apiError('Ese horario está bloqueado en la agenda', 409);
  }
  if (intervals.some(x => overlaps(start, end, x.start, x.end))) {
    throw apiError('Ese horario se cruza con otra atención programada', 409);
  }
}
