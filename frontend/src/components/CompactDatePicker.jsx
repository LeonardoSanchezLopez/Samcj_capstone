import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { holidayName } from '../utils/holidays';
import api from '../services/api';

const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const weekdays = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
const parse = value => { if (!value) return null; const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d,12); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1, 12);

export default function CompactDatePicker({ value, onChange, placeholder='Seleccionar fecha', minDate=null, maxDate=null, disableSundays=false }) {
  const selected = parse(value);
  const min = minDate ? parse(minDate) : null;
  const max = maxDate ? parse(maxDate) : null;
  const [open,setOpen] = useState(false);
  const [view,setView] = useState(selected || min || max || new Date());
  const root = useRef(null);
  const [blocked,setBlocked]=useState([]);
  useEffect(()=>{
   if(!disableSundays)return;
   let live=true;api.get('/public/blocked-dates',{params:{month:`${view.getFullYear()}-${String(view.getMonth()+1).padStart(2,'0')}`}}).then(r=>{if(live)setBlocked(r.data||[])}).catch(()=>{});
   return ()=>{live=false};
  },[view.getFullYear(),view.getMonth(),disableSundays]);

  useEffect(() => {
    if (selected) setView(selected);
  }, [value]);

  useEffect(() => {
    const close = e => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  },[]);

  const days = useMemo(() => {
    const y=view.getFullYear(), m=view.getMonth();
    const first=new Date(y,m,1,12), count=new Date(y,m+1,0,12).getDate();
    const blanks=(first.getDay()+6)%7;
    return [...Array(blanks).fill(null), ...Array.from({length:count},(_,i)=>new Date(y,m,i+1,12))];
  },[view]);

  const label = selected ? new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}).format(selected) : placeholder;
  const previousMonth = new Date(view.getFullYear(), view.getMonth()-1, 1, 12);
  const nextMonth = new Date(view.getFullYear(), view.getMonth()+1, 1, 12);
  const canPrev = !min || monthStart(previousMonth) >= monthStart(min);
  const canNext = !max || monthStart(nextMonth) <= monthStart(max);
  const disabledDay = d => Boolean((min && d < min) || (max && d > max) || (disableSundays && (d.getDay()===0 || Boolean(holidayName(iso(d))) || blocked.some(b=>b.fecha===iso(d)&&b.todo_el_dia))));

  return <div className="compact-date-picker" ref={root}>
    <button type="button" className="compact-date-trigger" onClick={()=>setOpen(v=>!v)}><CalendarDays size={17}/><span>{label}</span></button>
    {open&&<div className="compact-calendar-popover">
      <div className="compact-calendar-head"><button type="button" disabled={!canPrev} onClick={()=>canPrev&&setView(d=>new Date(d.getFullYear(),d.getMonth()-1,1,12))}><ChevronLeft size={16}/></button><strong>{months[view.getMonth()]} {view.getFullYear()}</strong><button type="button" disabled={!canNext} onClick={()=>canNext&&setView(d=>new Date(d.getFullYear(),d.getMonth()+1,1,12))}><ChevronRight size={16}/></button></div>
      <div className="compact-weekdays">{weekdays.map(w=><span key={w}>{w}</span>)}</div>
      <div className="compact-days">{days.map((d,i)=>d?<button key={iso(d)} type="button" disabled={disabledDay(d)} title={holidayName(iso(d))||undefined} className={`${value===iso(d)?'selected':''} ${disableSundays&&(d.getDay()===0||holidayName(iso(d))||blocked.some(b=>b.fecha===iso(d)&&b.todo_el_dia))?'non-working-day':''}`} onClick={()=>{onChange(iso(d));setOpen(false)}}>{d.getDate()}</button>:<span key={`b-${i}`}/>)}</div>
      {value&&<button type="button" className="compact-clear" onClick={()=>{onChange('');setOpen(false)}}>Limpiar fecha</button>}
    </div>}
  </div>;
}
