import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { holidayName } from '../utils/holidays';
import api from '../services/api';

const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const weekNames = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

function parseISO(value){
  if(!value) return null;
  const [y,m,d] = value.split('-').map(Number);
  return new Date(y,m-1,d,12,0,0,0);
}

function toISO(date){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date){
  return new Date(date.getFullYear(),date.getMonth(),date.getDate(),12,0,0,0);
}

export default function BookingCalendar({ value, onChange, minDate = new Date() }){
  const selected = parseISO(value);
  const min = startOfDay(minDate);
  const [viewDate,setViewDate] = useState(selected || min);
  const [blocked,setBlocked]=useState([]);
  useEffect(()=>{let active=true;api.get('/public/blocked-dates',{params:{month:`${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}`}}).then(r=>{if(active)setBlocked(r.data||[])}).catch(()=>{});return()=>{active=false};},[viewDate.getFullYear(),viewDate.getMonth()]);

  useEffect(()=>{
    if(selected) setViewDate(new Date(selected.getFullYear(),selected.getMonth(),1,12));
  },[value]);

  const days = useMemo(()=>{
    const y=viewDate.getFullYear();
    const m=viewDate.getMonth();
    const first=new Date(y,m,1,12);
    const lastDay=new Date(y,m+1,0,12).getDate();
    const mondayIndex=(first.getDay()+6)%7;
    return [
      ...Array.from({length:mondayIndex},()=>null),
      ...Array.from({length:lastDay},(_,i)=>new Date(y,m,i+1,12))
    ];
  },[viewDate]);

  const minMonth = new Date(min.getFullYear(),min.getMonth(),1,12);
  const currentMonth = new Date(viewDate.getFullYear(),viewDate.getMonth(),1,12);
  const canPrev = currentMonth > minMonth;

  return <div className="booking-calendar" aria-label="Calendario para elegir fecha">
    <div className="calendar-toolbar">
      <button type="button" className="calendar-nav" disabled={!canPrev} onClick={()=>canPrev&&setViewDate(d=>new Date(d.getFullYear(),d.getMonth()-1,1,12))}><ChevronLeft size={18}/></button>
      <strong>{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</strong>
      <button type="button" className="calendar-nav" onClick={()=>setViewDate(d=>new Date(d.getFullYear(),d.getMonth()+1,1,12))}><ChevronRight size={18}/></button>
    </div>
    <div className="calendar-weekdays">{weekNames.map(w=><span key={w}>{w}</span>)}</div>
    <div className="calendar-days">
      {days.map((date,index)=>{
        if(!date) return <span key={`blank-${index}`} className="calendar-blank"/>;
        const iso=toISO(date);
        const sunday=date.getDay()===0;
        const reason=holidayName(iso);const adminBlocked=blocked.some(b=>b.fecha===iso&&b.todo_el_dia);
        const disabled=date<min || sunday || Boolean(reason) || adminBlocked;
        const isSelected=iso===value;
        const todayIso=toISO(new Date());
        return <button
          key={iso}
          type="button"
          disabled={disabled}
          className={`${isSelected?'selected ':''}${iso===todayIso?'today ':''}${disabled?'past-day ':''}${sunday||reason||adminBlocked?'non-working-day':''}`}
          title={reason|| (sunday?'Domingo no laborable':adminBlocked?'Bloqueo administrativo':undefined)}
          onClick={()=>onChange(iso)}
        >{date.getDate()}</button>;
      })}
    </div>
    <div className="calendar-selected">
      <span>Fecha seleccionada</span>
      <strong>{selected ? new Intl.DateTimeFormat('es-PE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(selected) : 'Elige un día en el calendario'}</strong>
    </div><small className="calendar-help">Los domingos y las fechas anteriores a hoy aparecen opacos y no se pueden seleccionar.</small>
  </div>;
}
