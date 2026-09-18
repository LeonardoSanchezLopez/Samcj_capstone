function answerMap(answers = []) {
  const map = {};
  for (const a of answers) {
    if (!a?.preguntaCodigo) continue;
    const code = a.preguntaCodigo;
    if (map[code] === undefined) map[code] = a.opcionCodigo;
    else if (Array.isArray(map[code])) map[code].push(a.opcionCodigo);
    else map[code] = [map[code], a.opcionCodigo];
  }
  return map;
}

const has = (value, code) => Array.isArray(value) ? value.includes(code) : value === code;

export function calculateRecommendation(answers = []) {
  const a = answerMap(answers);

  let tonalidad = 50;
  switch (a.NIVEL_PRIVACIDAD) {
    case 'BAJA': tonalidad = 70; break;
    case 'MEDIA': tonalidad = 50; break;
    case 'ALTA': tonalidad = 35; break;
    case 'MAXIMA': tonalidad = 5; break;
    default: tonalidad = 50;
  }

  const lowLightRisk = a.CONDUCCION_NOCTURNA === 'FRECUENTEMENTE'
    || a.IMPORTANCIA_VISIBILIDAD === 'MUY_IMPORTANTE'
    || a.DIFICULTAD_POCA_LUZ === 'SI';

  if (lowLightRisk && tonalidad < 50) tonalidad = 50;
  if (a.DIFICULTAD_POCA_LUZ === 'SI' && a.CONDUCCION_NOCTURNA === 'FRECUENTEMENTE') tonalidad = 70;

  const objectiveHeat = has(a.OBJETIVO_POLARIZADO, 'CALOR') || has(a.OBJETIVO_POLARIZADO, 'UV');
  const heatHigh = a.PROTECCION_CALOR === 'ALTO' || objectiveHeat;
  let marca = 'Stek';
  let calidad = 'Estándar';

  if (a.PRESUPUESTO === 'ECONOMICO') {
    marca = 'Nexfil USA';
  } else if (a.PRESUPUESTO === 'PREMIUM') {
    marca = heatHigh ? '3M' : 'Llumar';
    calidad = 'Premium';
  } else if (a.PRESUPUESTO === 'COMPARAR') {
    marca = heatHigh ? 'Llumar' : 'Stek';
    calidad = heatHigh ? 'Premium' : 'Estándar';
  } else if (heatHigh) {
    marca = 'Llumar';
    calidad = 'Premium';
  }

  const reasons = [];
  if (a.NIVEL_PRIVACIDAD) reasons.push('tu preferencia de privacidad');
  if (a.CONDUCCION_NOCTURNA === 'FRECUENTEMENTE') reasons.push('tu conducción nocturna frecuente');
  if (a.DIFICULTAD_POCA_LUZ === 'SI') reasons.push('la prioridad de visibilidad con poca iluminación');
  if (heatHigh) reasons.push('la protección contra el calor/sol que indicaste');
  if (a.PRESUPUESTO) reasons.push('tu rango de presupuesto');

  return {
    marca,
    calidad,
    tonalidad,
    explicacion: `La sugerencia considera ${reasons.length ? reasons.join(', ') : 'tus respuestas del formulario'}. Es una preselección referencial y debe ser validada por el especialista antes del servicio.`
  };
}
