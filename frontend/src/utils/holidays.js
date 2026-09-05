// Calendario nacional peruano — https://www.gob.pe/feriados
export function holidayName(iso){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)))return null;
 const year=Number(iso.slice(0,4));if(year<2020||year>2100)return null;
 const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451);
 const em=Math.floor((h+l-7*m+114)/31),ed=(h+l-7*m+114)%31+1,easter=Date.UTC(year,em-1,ed);
 const th=new Date(easter-3*86400000).toISOString().slice(0,10),fr=new Date(easter-2*86400000).toISOString().slice(0,10);
 const fixed={'01-01':'Año Nuevo','05-01':'Día del Trabajo','06-07':'Batalla de Arica','06-29':'San Pedro y San Pablo','07-23':'Día de la Fuerza Aérea','07-28':'Fiestas Patrias','07-29':'Fiestas Patrias','08-06':'Batalla de Junín','08-30':'Santa Rosa de Lima','10-08':'Combate de Angamos','11-01':'Todos los Santos','12-08':'Inmaculada Concepción','12-09':'Batalla de Ayacucho','12-25':'Navidad'};
 return iso===th?'Jueves Santo':iso===fr?'Viernes Santo':fixed[iso.slice(5)]||null;
}
export const nonWorking=(iso)=>new Date(`${iso}T12:00:00Z`).getUTCDay()===0||Boolean(holidayName(iso));
