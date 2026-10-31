import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, Eye } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../context/ToastContext';
import Pagination, { usePagedRows } from '../../components/Pagination';
import CompactDatePicker from '../../components/CompactDatePicker';
import { downloadDealerWeeklyPdf } from '../../utils/dealerWeeklyPdf';
import { money } from '../../utils/format';

function mondayISO(date){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()-(d.getDay()+6)%7);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const currentISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const prettyDate=value=>value?new Intl.DateTimeFormat('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Lima'}).format(new Date(`${value}T12:00:00`)):'—';

export default function ReportsPage(){
  const { show } = useToast();
  const [dealers,setDealers] = useState([]);
  const [dealerId,setDealerId] = useState('');
  const [weekStart,setWeekStart] = useState(()=>mondayISO(currentISO()));
  const [weekly,setWeekly] = useState(null);
  const [loading,setLoading] = useState(false);
  const weeklyPaging = usePagedRows(weekly?.items||[],`${dealerId}|${weekStart}`);

  useEffect(()=>{
    api.get('/admin/dealerships',{params:{status:'all'}})
      .then(r=>setDealers(r.data))
      .catch(()=>show('No se pudo consultar concesionarios','error'));
  },[]);

  const selectedDealer = useMemo(()=>dealers.find(d=>d.id===dealerId),[dealers,dealerId]);

  const showWeekly = async()=>{
    if(!dealerId){show('Selecciona un concesionario','error');return;}
    if(!weekStart){show('Selecciona una semana','error');return;}
    setLoading(true);
    setWeekly(null);
    try{
      const r = await api.get('/admin/reports/dealership-weekly',{params:{dealershipId:dealerId,weekStart}});
      setWeekly(r.data);
    }catch(e){
      show(e.response?.data?.message || 'No se pudo generar el reporte semanal','error');
    }finally{
      setLoading(false);
    }
  };

  const changeWeek = value => {
    setWeekStart(value ? mondayISO(value) : '');
    setWeekly(null);
  };

  return <div className="admin-page reports-page">
    <div className="page-head">
      <div>
        <span className="eyebrow">REPORTES</span>
        <h1>Liquidación semanal por concesionario</h1>
        <p>Consulta una sola concesionaria por semana, revisa sus OT finalizadas y descarga el PDF con el total a cobrar.</p>
      </div>
    </div>

    <section className="weekly-report weekly-report-dark">
      <div className="weekly-report-panel">
        <div className="weekly-report-head">
          <div>
            <h2>Reporte semanal por concesionario</h2>
            <p>La búsqueda agrupa la semana de lunes a domingo y utiliza el precio guardado en cada OT finalizada.</p>
          </div>
          <span className="weekly-report-icon"><CalendarDays size={22}/></span>
        </div>

        <div className="weekly-report-controls">
          <label>
            <span>Concesionario</span>
            <select value={dealerId} onChange={e=>{setDealerId(e.target.value);setWeekly(null);}}>
              <option value="">Seleccionar concesionario</option>
              {dealers.map(d=><option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </label>

          <label>
            <span>Fecha de la semana</span>
            <CompactDatePicker value={weekStart} onChange={changeWeek} placeholder="Seleccionar fecha"/>
          </label>

          <div className="weekly-report-actions">
            <button type="button" className="btn primary" onClick={showWeekly} disabled={loading || !dealerId}>
              <Eye size={17}/>{loading ? 'Consultando…' : 'Ver reporte semanal'}
            </button>
            <button type="button" className="btn ghost" onClick={()=>downloadDealerWeeklyPdf(weekly)} disabled={!weekly || !weekly.items.length}>
              <Download size={17}/>Descargar PDF
            </button>
          </div>
        </div>

        <p className="muted weekly-report-note">Si eliges cualquier día de la semana, el sistema toma automáticamente el lunes correspondiente.</p>

        {weekly && <div className="weekly-report-result">
          <div className="weekly-report-summary">
            <div><small>Concesionario</small><strong>{weekly.concesionario.nombre}</strong></div>
            <div><small>Semana</small><strong>{prettyDate(weekly.desde)} al {prettyDate(weekly.hasta)}</strong></div>
            <div><small>Servicios finalizados</small><strong>{weekly.cantidad}</strong></div>
            <div><small>Total semanal</small><strong>{money(weekly.total)}</strong></div>
          </div>

          {weekly.sinPrecio > 0 && <p role="alert" className="muted weekly-report-alert">Hay {weekly.sinPrecio} OT sin precio guardado. No se consideran en la suma final.</p>}

          {weekly.items.length ? <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha cierre</th>
                    <th>OT</th>
                    <th>Vehículo</th>
                    <th>Servicio</th>
                    <th>Lámina</th>
                    <th>Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyPaging.visible.map(x=><tr key={x.id}>
                    <td>{new Date(x.fecha_fin).toLocaleDateString('es-PE',{timeZone:'America/Lima'})}</td>
                    <td><strong>{x.codigo}</strong></td>
                    <td>{x.vehiculo}</td>
                    <td>{x.servicio}</td>
                    <td>{x.lamina} {x.opacidad ? `${x.opacidad}%` : ''}</td>
                    <td><strong>{x.precio_final==null ? 'Sin precio' : money(x.precio_final)}</strong></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <Pagination paging={weeklyPaging}/>
          </> : <div className="weekly-report-empty">Este concesionario no tiene OT finalizadas durante la semana seleccionada.</div>}
        </div>}

        {!weekly && !loading && <div className="weekly-report-placeholder">
          <strong>{selectedDealer?.nombre || 'Selecciona una concesionaria'}</strong>
          <span>Escoge una semana y luego pulsa <em>Ver reporte semanal</em> para mostrar el detalle y habilitar la descarga del PDF.</span>
        </div>}
      </div>
    </section>
  </div>;
}
