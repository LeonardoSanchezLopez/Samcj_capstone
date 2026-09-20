import VehiclePhotos from '../../components/VehiclePhotos';
import Pagination, { usePagedRows } from '../../components/Pagination';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, Layers3, Play, Plus, UserRound } from 'lucide-react';
import api from '../../services/api';
import SearchBar from '../../components/SearchBar';
import Modal from '../../components/Modal';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import CompactDatePicker from '../../components/CompactDatePicker';
import { useToast } from '../../context/ToastContext';
import { dateTime, money } from '../../utils/format';

const RESPONSABLES = ['MAX NICK QUEZADA MORALES', 'CARLOS ANDRES QUEZADA MORALES'];
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const todayLocal = () => nowLocal().slice(0, 10);
const toIsoLima = (date, time) => new Date(`${date}T${time}:00-05:00`).toISOString();

export default function WorkOrdersPage({ type }) {
  const { show } = useToast();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [detail, setDetail] = useState(null);
  const [mode, setMode] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [dealerBrands, setDealerBrands] = useState([]);
  const [form, setForm] = useState({});
  const [attentionMode, setAttentionMode] = useState('INDIVIDUAL');
  const [batch, setBatch] = useState({});
  const [batchVehicles, setBatchVehicles] = useState([]);
  const [vehicleIndex, setVehicleIndex] = useState(0);
  const [savingBatch, setSavingBatch] = useState(false);
  const [photoDrafts,setPhotoDrafts]=useState({});
  const [individualToken,setIndividualToken]=useState(()=>crypto.randomUUID());
  const [batchTokens,setBatchTokens]=useState([]);
  const [finalToken,setFinalToken]=useState(()=>crypto.randomUUID());
  const [inspection,setInspection]=useState(null);
  const [reviewChoices,setReviewChoices]=useState({});
  const [inspectionLoading,setInspectionLoading]=useState(false);
  const setPhoto=(token,angle,preview)=>setPhotoDrafts(v=>({...v,[token]:{...(v[token]||{}),[angle]:preview}}));
  const fourPhotos=token=>Object.keys(photoDrafts[token]||{}).length===4;
  const refreshInspection=async(id)=>{try{const {data}=await api.get(`/admin/inspections/${id}`);setInspection(data);return data}catch{setInspection(null);return null}};
  const saveFinalPhotos=async()=>{if(!fourPhotos(finalToken)){show('Toma las cuatro fotos finales antes de continuar','error');return}setInspectionLoading(true);try{await api.post(`/admin/inspections/${detail.id}/final-attach`,{token:finalToken});await refreshInspection(detail.id);show('Fotografías finales guardadas')}catch(e){show(e.response?.data?.message||'No se pudieron guardar fotos','error')}finally{setInspectionLoading(false)}};
  const comparePhotos=async()=>{setInspectionLoading(true);try{await api.post(`/admin/inspections/${detail.id}/compare`);await refreshInspection(detail.id);show('Análisis completado: revisa cada hallazgo')}catch(e){show(e.response?.data?.message||'Gemini no disponible. Puedes revisar manualmente.','error')}finally{setInspectionLoading(false)}};
  const confirmReview=async()=>{const findings=inspection?.hallazgos||[];if(findings.some(x=>!reviewChoices[x.id])){show('Confirma o descarta cada posible hallazgo','error');return}try{await api.post(`/admin/inspections/${detail.id}/review`,{revisiones:findings.map(x=>({id:x.id,estado:reviewChoices[x.id]}))});await refreshInspection(detail.id);show('Inspección revisada. Ya puedes finalizar la OT.')}catch(e){show(e.response?.data?.message||'No se pudo confirmar la inspección','error')}};

  const [dealerSlots, setDealerSlots] = useState([]);
  const [batchSlots, setBatchSlots] = useState([]);

  const paging = usePagedRows(rows, `${type}|${search}|${state}`);
  const isNatural = type === 'CLIENTE_NATURAL';
  const load = () => api.get('/admin/orders', { params: { type, search, state: state || undefined } }).then(r => setRows(r.data)).catch(() => show('No se pudieron cargar las OT', 'error'));
  useEffect(() => { const t = setTimeout(load, 160); return () => clearTimeout(t); }, [type, search, state]);
  useEffect(() => {
    Promise.all([api.get('/public/bootstrap'), api.get('/admin/dealerships', { params: { status: 'active' } })])
      .then(([a, c]) => { setCatalog(a.data); setDealers(c.data); }).catch(() => {});
  }, []);

  const loadDealerBrands = async id => {
    if (!id) { setDealerBrands([]); return; }
    try { const { data } = await api.get(`/admin/dealerships/${id}/brands`); setDealerBrands(data); }
    catch { setDealerBrands([]); }
  };

  useEffect(() => {
    if (mode !== 'newDealer' || attentionMode !== 'INDIVIDUAL' || !form.fecha) return;
    api.get('/public/availability', { params: { date: form.fecha, location: 'LOCAL' } })
      .then(({ data }) => {
        const slots = (data.slots || []).filter(x => x.available);
        setDealerSlots(slots);
        setForm(f => ({ ...f, hora: slots.some(x => x.time === f.hora) ? f.hora : '' }));
      })
      .catch(() => { setDealerSlots([]); setForm(f => ({ ...f, hora: '' })); });
  }, [mode, attentionMode, form.fecha]);

  useEffect(() => {
    if (mode !== 'newDealer' || attentionMode !== 'LOTE' || !batch.fecha || !batch.cantidad_vehiculos) return;
    api.get('/admin/orders/dealership-batch-slots', { params: { date: batch.fecha, count: batch.cantidad_vehiculos } })
      .then(({ data }) => {
        const slots = (data.slots || []).filter(x => x.available);
        setBatchSlots(slots);
        setBatch(b => {
          const current = slots.find(x => x.time === b.hora_inicio);
          return { ...b, hora_inicio: current ? current.time : '', hora_fin: current ? current.end : '' };
        });
      })
      .catch(() => { setBatchSlots([]); setBatch(b => ({ ...b, hora_inicio: '', hora_fin: '' })); });
  }, [mode, attentionMode, batch.fecha, batch.cantidad_vehiculos]);

  const defaultVehicle = () => {
    const s = catalog?.servicios?.find(x => x.nombre === 'Polarizado completo');
    return {
      servicio_id: s?.id || '', categoria_vehiculo_id: catalog?.categorias?.[0]?.id || '', tipo_vehiculo_especial_id: '',
      marca_lamina_id: catalog?.marcas?.[0]?.id || '', tonalidad_id: catalog?.tonalidades?.[0]?.id || '',
      marca_vehiculo: '', modelo_vehiculo: '', asesor_concesionario: '', serie_interna: '', observaciones: ''
    };
  };

  const view = async r => {
    setInspection(null);
    try { const { data } = await api.get(`/admin/orders/${r.id}`); setDetail(data); setMode('view'); if(data.tipo_ot==='CONCESIONARIO')refreshInspection(r.id); }
    catch { show('No se pudo abrir la OT', 'error'); }
  };

  const start = async r => {
    try {
      const { data } = await api.get(`/admin/orders/${r.id}`);
      setDetail(data);
      setForm({
        servicio_id: data.servicio_id, categoria_vehiculo_id: data.categoria_vehiculo_id,
        tipo_vehiculo_especial_id: data.tipo_vehiculo_especial_id || '', marca_lamina_id: data.marca_lamina_id,
        tonalidad_id: data.tonalidad_id, precio_final: data.precio_final ?? '', marca_vehiculo: data.marca_vehiculo || '',
        modelo_vehiculo: data.modelo_vehiculo || '', anio_vehiculo: data.anio_vehiculo || '', observaciones: data.observaciones || '',
        fecha_inicio: nowLocal()
      });
      setMode('start');
    } catch { show('No se pudo abrir la OT', 'error'); }
  };

  const finalize = r => {setDetail(r);setFinalToken(crypto.randomUUID());setInspection(null);setReviewChoices({});setForm({ fechaFin: nowLocal(), realizadoPor: [] });setMode('finalize');if(r.tipo_ot==='CONCESIONARIO')refreshInspection(r.id);};

  const submitStart = async e => {
    e.preventDefault();
    try {
      await api.patch(`/admin/orders/${detail.id}/start`, {
        ...form,
        tipo_vehiculo_especial_id: form.tipo_vehiculo_especial_id || null,
        precio_final: form.precio_final === '' ? null : Number(form.precio_final),
        fecha_inicio: new Date(form.fecha_inicio).toISOString()
      });
      show('OT iniciada. Estado: En proceso'); setMode(null); load();
    } catch (err) { show(err.response?.data?.message || 'No se pudo iniciar la OT', 'error'); }
  };

  const submitFinalize = async e => {
    e.preventDefault();
    if (!form.realizadoPor?.length) { show('Selecciona al menos un responsable', 'error'); return; }
    try {
      await api.patch(`/admin/orders/${detail.id}/finalize`, { realizadoPor: form.realizadoPor, fechaFin: new Date(form.fechaFin).toISOString() });
      show('OT finalizada y stock descontado automáticamente'); setMode(null); load();
    } catch (err) { show(err.response?.data?.message || 'No se pudo finalizar la OT', 'error'); }
  };

  const openNewDealer = async () => {
    const dealer = dealers[0];
    const vehicle = defaultVehicle();
    const today = todayLocal();
    setAttentionMode('INDIVIDUAL');
    setDealerSlots([]);
    setBatchSlots([]);
    setForm({ ...vehicle, concesionario_id: dealer?.id || '', fecha: today, hora: '' });
    setBatch({ concesionario_id: dealer?.id || '', fecha: today, hora_inicio: '', hora_fin: '', cantidad_vehiculos: 2, observaciones: '' });
    setBatchVehicles([defaultVehicle(), defaultVehicle()]);
    setVehicleIndex(0);
    setIndividualToken(crypto.randomUUID());setBatchTokens([crypto.randomUUID(),crypto.randomUUID()]);setPhotoDrafts({});
    if (dealer) await loadDealerBrands(dealer.id);
    setMode('newDealer');
  };

  const createDealer = async e => {
    e.preventDefault();
    if (!form.fecha || !form.hora) { show('Selecciona fecha y un horario disponible', 'error'); return; }
    if (!/^[A-Za-z0-9]{6,8}$/.test(form.serie_interna || '')) { show('La Serie Interna debe tener entre 6 y 8 letras o números', 'error'); return; }
    if(!fourPhotos(individualToken)){show('Debes tomar las cuatro fotografías iniciales antes de registrar la OT','error');return;}
    try {
      await api.post('/admin/orders/dealership', {
        fotoToken:individualToken,
        ...form,
        categoria_vehiculo_id: Number(form.categoria_vehiculo_id),
        tipo_vehiculo_especial_id: form.tipo_vehiculo_especial_id ? Number(form.tipo_vehiculo_especial_id) : null,
        marca_lamina_id: Number(form.marca_lamina_id), tonalidad_id: Number(form.tonalidad_id),
        serie_interna: form.serie_interna.toUpperCase(), fecha_inicio: toIsoLima(form.fecha, form.hora)
      });
      show('OT individual de concesionario registrada y agenda actualizada'); setMode(null); load();
    } catch (err) { show(err.response?.data?.message || 'No se pudo registrar la OT', 'error'); }
  };

  const changeBatchCount = count => {
    const n = Number(count);
    setBatch(b => ({ ...b, cantidad_vehiculos: n, hora_inicio: '', hora_fin: '' }));
    setBatchVehicles(prev => Array.from({ length: n }, (_, i) => prev[i] || defaultVehicle()));
    setVehicleIndex(i => Math.min(i, n - 1));
    setBatchTokens(prev=>Array.from({length:n},(_,i)=>prev[i]||crypto.randomUUID()));
  };

  const changeBatchDealer = async id => {
    setBatch(b => ({ ...b, concesionario_id: id }));
    setBatchVehicles(prev => prev.map(v => ({ ...v, marca_vehiculo: '' })));
    await loadDealerBrands(id);
  };

  const updateBatchVehicle = (key, value) => {
    setBatchVehicles(prev => prev.map((v, i) => i === vehicleIndex ? { ...v, [key]: value, ...(key === 'categoria_vehiculo_id' ? { tipo_vehiculo_especial_id: '' } : {}) } : v));
  };

  const validateVehicle = (v, idx) => {
    if (!v.servicio_id || !v.categoria_vehiculo_id || !v.marca_lamina_id || !v.tonalidad_id || !v.marca_vehiculo) return `Completa los datos obligatorios del vehículo ${idx + 1}`;
    if (!/^[A-Za-z0-9]{6,8}$/.test(v.serie_interna || '')) return `La Serie Interna del vehículo ${idx + 1} debe tener entre 6 y 8 letras o números`;
    return null;
  };

  const createBatch = async e => {
    e.preventDefault();
    if (!batch.concesionario_id || !batch.fecha || !batch.hora_inicio || !batch.hora_fin) { show('Completa concesionario, fecha y un horario disponible para el lote', 'error'); return; }
    if (batch.fecha < todayLocal()) { show('No se puede programar un lote en una fecha pasada', 'error'); return; }
    for (let i = 0; i < batchVehicles.length; i++) {
      const error = validateVehicle(batchVehicles[i], i);
      if (error) { setVehicleIndex(i); show(error, 'error'); return; }
      if(!fourPhotos(batchTokens[i])){setVehicleIndex(i);show(`Faltan fotografías de recepción del vehículo ${i+1}`,'error');return;}
    }
    const series = batchVehicles.map(v => v.serie_interna.toUpperCase());
    if (new Set(series).size !== series.length) { show('No puedes repetir la misma Serie Interna dentro del lote', 'error'); return; }

    setSavingBatch(true);
    try {
      const { data } = await api.post('/admin/orders/dealership-batch', {
        ...batch,
        vehiculos: batchVehicles.map((v,i) => ({ ...v, fotoToken:batchTokens[i], serie_interna: v.serie_interna.toUpperCase() }))
      });
      show(`Lote registrado correctamente: ${data?.ordenes?.length || batchVehicles.length} OT creadas`);
      setMode(null); load();
    } catch (err) { show(err.response?.data?.message || 'No se pudo registrar el lote', 'error'); }
    finally { setSavingBatch(false); }
  };

  const currentBatchVehicle = batchVehicles[vehicleIndex] || defaultVehicle();
  const special = useMemo(() => catalog?.especiales?.filter(x => String(x.categoria_vehiculo_id) === String(form.categoria_vehiculo_id)) || [], [catalog, form.categoria_vehiculo_id]);
  const batchSpecial = useMemo(() => catalog?.especiales?.filter(x => String(x.categoria_vehiculo_id) === String(currentBatchVehicle.categoria_vehiculo_id)) || [], [catalog, currentBatchVehicle.categoria_vehiculo_id]);
  const togglePerformer = name => setForm(f => ({ ...f, realizadoPor: f.realizadoPor?.includes(name) ? f.realizadoPor.filter(x => x !== name) : [...(f.realizadoPor || []), name] }));
  const pageTitle = isNatural ? 'Órdenes de trabajo · Clientes' : 'Órdenes de trabajo · Concesionarios';

  return <div className="admin-page">
    <div className="page-head"><div><span className="eyebrow">GESTIÓN</span><h1>{pageTitle}</h1><p>{isNatural ? 'Pendiente de validación → En proceso → Finalizada.' : 'Una OT por vehículo. Los lotes agrupan 2 a 5 vehículos sin perder la OT individual.'}</p></div>{!isNatural && <button className="btn primary" onClick={openNewDealer}><Plus size={17}/> Nueva atención concesionario</button>}</div>
    <SearchBar value={search} onChange={setSearch} placeholder={isNatural ? 'Buscar por N° OT, nombre o DNI...' : 'Buscar por N° OT, concesionario o Serie Interna...'}><select className="filter-select" value={state} onChange={e => setState(e.target.value)}><option value="">Todos los estados</option>{isNatural && <option>PENDIENTE_VALIDACION</option>}<option>EN_PROCESO</option><option>FINALIZADA</option></select></SearchBar>
    <section className="table-card responsive-table-card">{rows.length ? <div className="table-scroll"><table><thead><tr><th>OT</th><th>{isNatural ? 'Cliente' : 'Concesionario'}</th><th>Vehículo</th><th>Lámina</th><th>Precio</th><th>Inicio</th><th>Fin</th><th>Estado</th><th className="actions-col">Acciones</th></tr></thead><tbody>{paging.visible.map(r => <tr key={r.id}><td data-label="OT"><strong>{r.codigo}</strong></td><td data-label={isNatural ? 'Cliente' : 'Concesionario'}>{r.cliente_o_concesionario}{r.dni && <small className="cell-sub">DNI {r.dni}</small>}</td><td data-label="Vehículo">{r.categoria_vehiculo}<small className="cell-sub">{isNatural ? [r.marca_vehiculo, r.modelo_vehiculo, r.anio_vehiculo].filter(Boolean).join(' · ') : [r.marca_vehiculo, r.modelo_vehiculo, r.serie_interna && `Serie ${r.serie_interna}`].filter(Boolean).join(' · ')}</small></td><td data-label="Lámina">{r.marca_lamina}<small className="cell-sub">{r.tonalidad_porcentaje}% · {r.tonalidad}</small></td><td data-label="Precio">{money(r.precio_final)}</td><td data-label="Inicio">{dateTime(r.fecha_inicio)}{!isNatural && <small className="cell-sub">{r.modalidad_atencion === 'LOTE' ? `Lote · ${String(r.bloque_hora_inicio || '').slice(0,5)}–${String(r.bloque_hora_fin || '').slice(0,5)}` : 'Individual'}</small>}</td><td data-label="Fin">{dateTime(r.fecha_fin)}</td><td data-label="Estado"><StatusBadge value={r.estado}/></td><td className="actions" data-label="Acciones"><button className="icon-btn" title="Ver detalle" onClick={() => view(r)}><Eye size={17}/></button>{isNatural && r.estado === 'PENDIENTE_VALIDACION' && <button className="icon-btn success-soft" title="Iniciar servicio" onClick={() => start(r)}><Play size={17}/></button>}{r.estado === 'EN_PROCESO' && <button className="icon-btn success-soft" title="Finalizar servicio" onClick={() => finalize(r)}><CheckCircle2 size={17}/></button>}</td></tr>)}</tbody></table></div> : <EmptyState/>}<Pagination paging={paging}/></section>

    <Modal open={mode === 'view'} title={detail?.codigo || 'Detalle de OT'} onClose={() => setMode(null)} wide>{detail && <div className="detail-grid"><div className="detail-box"><span>Tipo</span><strong>{detail.tipo_ot === 'CLIENTE_NATURAL' ? 'Cliente natural' : 'Concesionario'}</strong></div><div className="detail-box"><span>Estado</span><StatusBadge value={detail.estado}/></div><div className="detail-box"><span>Cliente / concesionario</span><strong>{detail.clientes ? `${detail.clientes.nombres} ${detail.clientes.apellidos}` : detail.concesionarios?.nombre}</strong></div><div className="detail-box"><span>Vehículo</span><strong>{detail.categorias_vehiculo?.nombre}</strong><small>{[detail.marca_vehiculo, detail.modelo_vehiculo, detail.tipo_ot === 'CONCESIONARIO' && detail.serie_interna ? `Serie ${detail.serie_interna}` : detail.anio_vehiculo].filter(Boolean).join(' · ')}</small></div>{detail.bloque_atencion_id && <div className="detail-box"><span>Modalidad</span><strong>Lote de concesionario</strong><small>{detail.bloques_atencion_concesionario ? `${String(detail.bloques_atencion_concesionario.hora_inicio||'').slice(0,5)}–${String(detail.bloques_atencion_concesionario.hora_fin||'').slice(0,5)} · ${detail.bloques_atencion_concesionario.cantidad_vehiculos} vehículos` : 'Esta OT pertenece a un bloque conjunto de atención.'}</small></div>}<div className="detail-box"><span>Configuración</span><strong>{detail.marcas_lamina?.nombre} · {detail.tonalidades?.porcentaje}%</strong><small>{detail.tonalidades?.nombre}</small></div><div className="detail-box"><span>Precio final</span><strong>{money(detail.precio_final)}</strong></div><div className="detail-box"><span>Fecha inicio</span><strong>{dateTime(detail.fecha_inicio)}</strong></div><div className="detail-box"><span>Fecha fin</span><strong>{dateTime(detail.fecha_fin)}</strong></div><div className="detail-box"><span>Metraje automático</span><strong>{Number(detail.metraje_estimado || 0).toFixed(1)} m</strong><small>{detail.stock_descontado ? 'Stock ya descontado' : 'Se descuenta al finalizar'}</small></div>{detail.realizado_por?.length > 0 && <div className="detail-box"><span>Realizado por</span><strong>{detail.realizado_por.join(' / ')}</strong></div>}{detail.citas?.respuestas_cita?.length > 0 && <div className="span-2"><h4>Respuestas del cliente</h4><div className="answer-grid">{detail.citas.respuestas_cita.map(x => <div key={x.id}><small>{x.preguntas_cita?.texto}</small><strong>{x.opciones_pregunta?.texto}</strong></div>)}</div></div>}</div>}{!isNatural&&inspection?.etapas?.some(x=>x.fotos.length>0)&&<section className="saved-inspection"><h3>Expediente fotográfico de la OT</h3><p className="muted">Fotografías privadas asociadas a esta orden. Los enlaces expiran automáticamente.</p><div className="saved-photo-grid">{inspection.etapas.map(stage=><div key={stage.tipo}><strong>{stage.tipo==='RECEPCION'?'Recepción (antes)':'Entrega (después)'}</strong><div className="photos-grid">{stage.fotos.map(f=><a key={f.id} href={f.url||'#'} rel="noreferrer" target="_blank"><img src={f.url} alt={f.angulo}/><small>{f.angulo}</small></a>)}</div></div>)}</div>{inspection.hallazgos?.length>0&&<div><h4>Hallazgos revisados</h4>{inspection.hallazgos.map(h=><p key={h.id}><strong>{h.angulo}:</strong> {h.descripcion_ia} · {h.estado_revision}</p>)}</div>}</section>}</Modal>

    <Modal open={mode === 'start'} title="Validar e iniciar servicio" onClose={() => setMode(null)} wide><form onSubmit={submitStart} className="form-grid two"><div className="info-banner span-2"><Play/><span>Al guardar, la OT cambiará a <strong>En proceso</strong> y se registrará la fecha de inicio. Una cita futura no podrá marcarse como atendida antes de su fecha.</span></div><label><span>Servicio</span><select value={form.servicio_id || ''} onChange={e => setForm({ ...form, servicio_id: e.target.value })}>{catalog?.servicios?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Categoría</span><select value={form.categoria_vehiculo_id || ''} onChange={e => setForm({ ...form, categoria_vehiculo_id: e.target.value, tipo_vehiculo_especial_id: '' })}>{catalog?.categorias?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>{special.length > 0 && <label><span>Caso especial</span><select value={form.tipo_vehiculo_especial_id || ''} onChange={e => setForm({ ...form, tipo_vehiculo_especial_id: e.target.value })}><option value="">General</option>{special.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>}<label><span>Marca de lámina</span><select value={form.marca_lamina_id || ''} onChange={e => setForm({ ...form, marca_lamina_id: e.target.value })}>{catalog?.marcas?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Tonalidad</span><select value={form.tonalidad_id || ''} onChange={e => setForm({ ...form, tonalidad_id: e.target.value })}>{catalog?.tonalidades?.map(x => <option key={x.id} value={x.id}>{x.porcentaje}% · {x.nombre}</option>)}</select></label><label><span>Precio final (S/)</span><input type="number" min="0" step="0.01" value={form.precio_final} onChange={e => setForm({ ...form, precio_final: e.target.value })}/></label><label><span>Fecha de inicio</span><input required type="datetime-local" value={form.fecha_inicio || ''} onChange={e => setForm({ ...form, fecha_inicio: e.target.value })}/></label><label><span>Marca vehículo</span><input value={form.marca_vehiculo || ''} onChange={e => setForm({ ...form, marca_vehiculo: e.target.value })}/></label><label><span>Modelo</span><input value={form.modelo_vehiculo || ''} onChange={e => setForm({ ...form, modelo_vehiculo: e.target.value })}/></label><label><span>Año</span><input value={form.anio_vehiculo || ''} onChange={e => setForm({ ...form, anio_vehiculo: e.target.value })}/></label><label className="span-2"><span>Observaciones</span><textarea value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })}/></label><div className="modal-actions span-2"><button type="button" className="btn ghost" onClick={() => setMode(null)}>Cancelar</button><button className="btn primary">Validar e iniciar servicio</button></div></form></Modal>

    <Modal open={mode === 'finalize'} title={`Finalizar ${detail?.codigo || 'OT'}`} onClose={() => setMode(null)}><form onSubmit={submitFinalize}><div className="info-banner"><CheckCircle2/><span>Al finalizar se descontará automáticamente el metraje correspondiente del inventario.</span></div>{!isNatural&&inspection?.etapas?.some(x=>x.tipo==='RECEPCION'&&x.fotos.length===4)&&<div className="final-inspection"><h3>Inspección fotográfica de entrega</h3>{!inspection?.etapas?.some(x=>x.tipo==='ENTREGA'&&x.fotos.length===4)?<><VehiclePhotos token={finalToken} photos={photoDrafts[finalToken]||{}} onUploaded={(angle,preview)=>setPhoto(finalToken,angle,preview)} title="Fotografías después del servicio"/><button type="button" disabled={inspectionLoading||!fourPhotos(finalToken)} className="btn primary" onClick={saveFinalPhotos}>Guardar 4 fotografías finales</button></>:<><div className="compare-grid">{['FRONTAL','POSTERIOR','IZQUIERDO','DERECHO'].map(a=><section key={a}><strong>{a}</strong><div>{['RECEPCION','ENTREGA'].map(t=>{const f=inspection.etapas.find(x=>x.tipo===t)?.fotos.find(x=>x.angulo===a);return <a key={t} href={f?.url||'#'} target="_blank" rel="noreferrer"><img src={f?.url} alt={`${t} ${a}`}/><small>{t==='RECEPCION'?'Antes':'Después'}</small></a>})}</div></section>)}</div><button type="button" className="btn ghost" disabled={inspectionLoading} onClick={comparePhotos}>Analizar diferencias con Gemini</button><p className="muted">La IA puede equivocarse. Compara las fotografías y confirma personalmente los hallazgos. Si Gemini falla, puedes realizar la revisión manual.</p>{inspection?.hallazgos?.map(h=><div key={h.id} className="finding-review"><strong>{h.angulo} · {h.descripcion_ia}</strong><select value={reviewChoices[h.id]||''} onChange={e=>setReviewChoices(v=>({...v,[h.id]:e.target.value}))}><option value="">Selecciona evaluación</option><option value="CONFIRMADO">Confirmado</option><option value="DESCARTADO">Descartado</option></select></div>)}{inspection?.etapas?.find(x=>x.tipo==='ENTREGA')?.inspeccion?.estado!=='REVISADA'?<button type="button" className="btn primary" onClick={confirmReview}>Confirmar comparación {inspection?.hallazgos?.length?'y hallazgos':'manual'}</button>:<p className="success-soft">Inspección revisada y confirmada.</p>}</>}</div>}<label><span>Fecha de fin *</span><input required type="datetime-local" value={form.fechaFin || ''} onChange={e => setForm({ ...form, fechaFin: e.target.value })}/></label><fieldset className="performers"><legend>Realizado por *</legend>{RESPONSABLES.map(name => <label key={name} className="check-row"><input type="checkbox" checked={form.realizadoPor?.includes(name) || false} onChange={() => togglePerformer(name)}/><span>{name}</span></label>)}</fieldset><div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setMode(null)}>Cancelar</button><button className="btn primary" disabled={!isNatural&&inspection?.etapas?.some(x=>x.tipo==='RECEPCION'&&x.fotos.length===4)&&inspection?.etapas?.find(x=>x.tipo==='ENTREGA')?.inspeccion?.estado!=='REVISADA'}>Finalizar servicio</button></div></form></Modal>

    <Modal open={mode === 'newDealer'} title="Nueva atención de concesionario" onClose={() => setMode(null)} wide>
      <div className="dealer-mode-grid">
        <button type="button" className={`dealer-mode-card ${attentionMode === 'INDIVIDUAL' ? 'selected' : ''}`} onClick={() => setAttentionMode('INDIVIDUAL')}><UserRound/><strong>Vehículo individual</strong><small>Registra una OT y reserva aproximadamente 2 horas.</small></button>
        <button type="button" className={`dealer-mode-card ${attentionMode === 'LOTE' ? 'selected' : ''}`} onClick={() => setAttentionMode('LOTE')}><Layers3/><strong>Lote de vehículos</strong><small>Registra de 2 a 5 vehículos juntos; cada vehículo tendrá su propia OT.</small></button>
      </div>

      {attentionMode === 'INDIVIDUAL' ? <form onSubmit={createDealer} className="form-grid two dealer-form"><label><span>Concesionario *</span><select required value={form.concesionario_id || ''} onChange={async e => { const id = e.target.value; setForm({ ...form, concesionario_id: id, marca_vehiculo: '' }); await loadDealerBrands(id); }}><option value="">Selecciona</option>{dealers.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Serie Interna *</span><input required minLength="6" maxLength="8" value={form.serie_interna || ''} onChange={e => setForm({ ...form, serie_interna: e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) })} placeholder="6 a 8 letras/números"/></label><label><span>Asesor del concesionario</span><input value={form.asesor_concesionario || ''} onChange={e => setForm({ ...form, asesor_concesionario: e.target.value })}/></label><label><span>Fecha *</span><CompactDatePicker disableSundays value={form.fecha || ''} minDate={todayLocal()} onChange={fecha => setForm({ ...form, fecha, hora: '' })}/></label><label><span>Hora de inicio *</span><select required value={form.hora || ''} onChange={e => setForm({ ...form, hora: e.target.value })}><option value="">{dealerSlots.length?'Selecciona un horario':'Sin horarios disponibles'}</option>{dealerSlots.map(x => <option key={x.time} value={x.time}>{x.time}</option>)}</select><small>Solo se muestran horarios disponibles para una atención individual de aproximadamente 2 horas.</small></label><label><span>Marca del vehículo *</span><select required value={form.marca_vehiculo || ''} onChange={e => setForm({ ...form, marca_vehiculo: e.target.value })}><option value="">Selecciona según concesionario</option>{dealerBrands.map(x => <option key={x.id} value={x.marca_vehiculo}>{x.marca_vehiculo}</option>)}</select></label><label><span>Modelo</span><input value={form.modelo_vehiculo || ''} onChange={e => setForm({ ...form, modelo_vehiculo: e.target.value })}/></label><label><span>Servicio *</span><select required value={form.servicio_id || ''} onChange={e => setForm({ ...form, servicio_id: e.target.value })}>{catalog?.servicios?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Categoría *</span><select required value={form.categoria_vehiculo_id || ''} onChange={e => setForm({ ...form, categoria_vehiculo_id: e.target.value, tipo_vehiculo_especial_id: '' })}>{catalog?.categorias?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>{special.length > 0 && <label><span>Caso especial</span><select value={form.tipo_vehiculo_especial_id || ''} onChange={e => setForm({ ...form, tipo_vehiculo_especial_id: e.target.value })}><option value="">General</option>{special.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>}<label><span>Marca lámina *</span><select required value={form.marca_lamina_id || ''} onChange={e => setForm({ ...form, marca_lamina_id: e.target.value })}>{catalog?.marcas?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Tonalidad *</span><select required value={form.tonalidad_id || ''} onChange={e => setForm({ ...form, tonalidad_id: e.target.value })}>{catalog?.tonalidades?.map(x => <option key={x.id} value={x.id}>{x.porcentaje}% · {x.nombre}</option>)}</select></label><label className="span-2"><span>Observaciones</span><textarea value={form.observaciones || ''} onChange={e => setForm({ ...form, observaciones: e.target.value })}/></label><div className="span-2"><VehiclePhotos token={individualToken} photos={photoDrafts[individualToken]||{}} onUploaded={(angle,preview)=>setPhoto(individualToken,angle,preview)}/></div><div className="modal-actions span-2"><button type="button" className="btn ghost" onClick={() => setMode(null)}>Cancelar</button><button className="btn primary">Registrar OT individual</button></div></form> :
      <form onSubmit={createBatch} className="dealer-batch-form">
        <div className="batch-setup form-grid two"><label><span>Concesionario *</span><select required value={batch.concesionario_id || ''} onChange={e => changeBatchDealer(e.target.value)}><option value="">Selecciona</option>{dealers.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Cantidad de vehículos *</span><select value={batch.cantidad_vehiculos || 2} onChange={e => changeBatchCount(e.target.value)}>{[2,3,4,5].map(n => <option key={n} value={n}>{n} vehículos</option>)}</select></label><label><span>Fecha *</span><CompactDatePicker disableSundays value={batch.fecha || ''} minDate={todayLocal()} onChange={fecha => setBatch({ ...batch, fecha, hora_inicio: '', hora_fin: '' })}/></label><label><span>Hora de inicio *</span><select required value={batch.hora_inicio || ''} onChange={e => { const selected = batchSlots.find(x => x.time === e.target.value); setBatch({ ...batch, hora_inicio: selected?.time || '', hora_fin: selected?.end || '' }); }}><option value="">{batchSlots.length?'Selecciona un horario':'Sin horarios disponibles'}</option>{batchSlots.map(x => <option key={x.time} value={x.time}>{x.time} · termina aprox. {x.end}</option>)}</select><small>Los horarios se calculan cada 30 minutos según la cantidad de vehículos y la agenda ocupada.</small></label><div className="calculated-end"><span>Fin estimado del bloque</span><strong>{batch.hora_fin || '—'}</strong><small>Calculado automáticamente por tandas de hasta 2 vehículos y respetando el descanso de 13:00 a 14:00.</small></div><label><span>Observación general</span><input value={batch.observaciones || ''} onChange={e => setBatch({ ...batch, observaciones: e.target.value })} placeholder="Ej. 3 vehículos programados por Autonort"/></label></div>
        <div className="batch-progress"><div><span>Vehículo</span><strong>{vehicleIndex + 1} de {batchVehicles.length}</strong></div><div className="batch-dots">{batchVehicles.map((_, i) => <button key={i} type="button" className={i === vehicleIndex ? 'active' : ''} onClick={() => setVehicleIndex(i)}>{i + 1}</button>)}</div></div>
        <div className="form-grid two batch-vehicle-card"><label><span>Serie Interna *</span><input required minLength="6" maxLength="8" value={currentBatchVehicle.serie_interna || ''} onChange={e => updateBatchVehicle('serie_interna', e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8))} placeholder="6 a 8 letras/números"/></label><label><span>Marca del vehículo *</span><select required value={currentBatchVehicle.marca_vehiculo || ''} onChange={e => updateBatchVehicle('marca_vehiculo', e.target.value)}><option value="">Selecciona según concesionario</option>{dealerBrands.map(x => <option key={x.id} value={x.marca_vehiculo}>{x.marca_vehiculo}</option>)}</select></label><label><span>Modelo</span><input value={currentBatchVehicle.modelo_vehiculo || ''} onChange={e => updateBatchVehicle('modelo_vehiculo', e.target.value)}/></label><label><span>Asesor del concesionario</span><input value={currentBatchVehicle.asesor_concesionario || ''} onChange={e => updateBatchVehicle('asesor_concesionario', e.target.value)}/></label><label><span>Servicio *</span><select required value={currentBatchVehicle.servicio_id || ''} onChange={e => updateBatchVehicle('servicio_id', e.target.value)}>{catalog?.servicios?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Categoría *</span><select required value={currentBatchVehicle.categoria_vehiculo_id || ''} onChange={e => updateBatchVehicle('categoria_vehiculo_id', e.target.value)}>{catalog?.categorias?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>{batchSpecial.length > 0 && <label><span>Caso especial</span><select value={currentBatchVehicle.tipo_vehiculo_especial_id || ''} onChange={e => updateBatchVehicle('tipo_vehiculo_especial_id', e.target.value)}><option value="">General</option>{batchSpecial.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>}<label><span>Marca lámina *</span><select required value={currentBatchVehicle.marca_lamina_id || ''} onChange={e => updateBatchVehicle('marca_lamina_id', e.target.value)}>{catalog?.marcas?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label><span>Tonalidad *</span><select required value={currentBatchVehicle.tonalidad_id || ''} onChange={e => updateBatchVehicle('tonalidad_id', e.target.value)}>{catalog?.tonalidades?.map(x => <option key={x.id} value={x.id}>{x.porcentaje}% · {x.nombre}</option>)}</select></label><label className="span-2"><span>Observaciones del vehículo</span><textarea value={currentBatchVehicle.observaciones || ''} onChange={e => updateBatchVehicle('observaciones', e.target.value)}/></label></div>
        <VehiclePhotos token={batchTokens[vehicleIndex]} photos={photoDrafts[batchTokens[vehicleIndex]]||{}} onUploaded={(angle,preview)=>setPhoto(batchTokens[vehicleIndex],angle,preview)} title={`Fotos recepción · vehículo ${vehicleIndex+1}`}/><div className="batch-navigation"><button type="button" className="btn ghost" disabled={vehicleIndex === 0} onClick={() => setVehicleIndex(i => Math.max(0, i - 1))}><ChevronLeft size={17}/> Anterior</button>{vehicleIndex < batchVehicles.length - 1 && <button type="button" className="btn ghost" onClick={() => { const error = validateVehicle(currentBatchVehicle, vehicleIndex); if (error) { show(error, 'error'); return; } setVehicleIndex(i => i + 1); }}>Siguiente vehículo <ChevronRight size={17}/></button>}</div>
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setMode(null)}>Cancelar</button><button className="btn primary" disabled={savingBatch}>{savingBatch ? 'Registrando lote...' : `Registrar lote y ${batchVehicles.length} OT`}</button></div>
      </form>}
    </Modal>
  </div>;
}
