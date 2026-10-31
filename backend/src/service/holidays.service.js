// Feriados nacionales del Perú. No confundir con días no laborables del sector público.
// https://www.gob.pe/feriados — fechas fijas + Jueves/Viernes Santo (computus gregoriano).
export function easterSunday(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return new Date(Date.UTC(year,month-1,day));
}
const FIXED={'01-01':'Año Nuevo','05-01':'Día del Trabajo','06-07':'Batalla de Arica y Día de la Bandera','06-29':'San Pedro y San Pablo','07-23':'Día de la Fuerza Aérea del Perú','07-28':'Fiestas Patrias','07-29':'Fiestas Patrias','08-06':'Batalla de Junín','08-30':'Santa Rosa de Lima','10-08':'Combate de Angamos','11-01':'Todos los Santos','12-08':'Inmaculada Concepción','12-09':'Batalla de Ayacucho','12-25':'Navidad'};
export function holidayName(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)))return null;
  const [year,month,day]=iso.split('-').map(Number);if(year<2020||year>2100)return null;
  const easter=easterSunday(year);const holyThursday=new Date(easter.getTime()-3*86400000).toISOString().slice(0,10);
  const goodFriday=new Date(easter.getTime()-2*86400000).toISOString().slice(0,10);
  return iso===holyThursday?'Jueves Santo':iso===goodFriday?'Viernes Santo':FIXED[`${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`]||null;
}
export function isNonWorkingDate(iso){const d=new Date(`${iso}T12:00:00Z`);return d.getUTCDay()===0||Boolean(holidayName(iso));}
