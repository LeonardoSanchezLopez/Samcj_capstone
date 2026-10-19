import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, CalendarDays, ChartNoAxesCombined, PackageOpen, Ruler, Wrench } from 'lucide-react';
import api from '../../services/api';
import { money } from '../../utils/format';
import CompactDatePicker from '../../components/CompactDatePicker';

const todayLocal=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const palette=['#ff6b61','#5ea8ff','#6ed7a8','#f4c764','#b98cff','#ff9f6b','#67d3e0','#ef7ca8'];
const totalOf=data=>(data||[]).reduce((sum,x)=>sum+Number(x.value||0),0);

function ChartShell({title,subtitle,children,className=''}){
 return <section className={`bi-chart-card ${className}`}><header><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div></header>{children}</section>;
}

function EmptyChart(){return <div className="bi-empty-chart"><ChartNoAxesCombined size={28}/><span>Aún no hay datos suficientes.</span></div>}

function HorizontalBars({title,subtitle,data=[]}){
 const max=Math.max(1,...data.map(x=>Number(x.value||0)));
 return <ChartShell title={title} subtitle={subtitle}>{data.length?<div className="bi-hbars">{data.map((x,i)=><div className="bi-hbar" key={`${x.label}-${i}`}><div className="bi-hbar-meta"><span>{x.label}</span><strong>{x.value}</strong></div><div className="bi-hbar-track"><i style={{width:`${Math.max(5,(Number(x.value||0)/max)*100)}%`,background:palette[i%palette.length]}}/></div></div>)}</div>:<EmptyChart/>}</ChartShell>;
}

function DonutChart({title,subtitle,data=[]}){
 const total=totalOf(data);
 const gradient=useMemo(()=>{if(!total)return '#262b33';let cursor=0;const stops=data.map((x,i)=>{const start=cursor;const end=cursor+(Number(x.value||0)/total)*360;cursor=end;return `${palette[i%palette.length]} ${start}deg ${end}deg`;});return `conic-gradient(${stops.join(',')})`;},[data,total]);
 return <ChartShell title={title} subtitle={subtitle}>{total?<div className="bi-donut-wrap"><div className="bi-donut" style={{background:gradient}}><div><strong>{total}</strong><span>Total</span></div></div><div className="bi-legend">{data.map((x,i)=><div key={`${x.label}-${i}`}><i style={{background:palette[i%palette.length]}}/><span>{x.label}</span><strong>{x.value}</strong></div>)}</div></div>:<EmptyChart/>}</ChartShell>;
}

function ColumnChart({title,subtitle,data=[]}){
 const max=Math.max(1,...data.map(x=>Number(x.value||0)));
 return <ChartShell title={title} subtitle={subtitle}>{data.length?<div className="bi-columns"><div className="bi-column-grid"><span/><span/><span/><span/></div>{data.map((x,i)=><div className="bi-column-item" key={`${x.label}-${i}`}><div className="bi-column-value">{x.value}</div><div className="bi-column-track"><i style={{height:`${Math.max(8,(Number(x.value||0)/max)*100)}%`,background:palette[i%palette.length]}}/></div><span title={x.label}>{x.label}</span></div>)}</div>:<EmptyChart/>}</ChartShell>;
}

function LineChart({title,subtitle,data=[]}){
 const width=640,height=230,padX=38,padY=28;
 const max=Math.max(1,...data.map(x=>Number(x.value||0)));
 const points=data.map((x,i)=>{const xPos=data.length===1?width/2:padX+i*((width-padX*2)/(data.length-1));const yPos=height-padY-(Number(x.value||0)/max)*(height-padY*2);return{x:xPos,y:yPos,...x};});
 const line=points.map(p=>`${p.x},${p.y}`).join(' ');
 const area=points.length?`${padX},${height-padY} ${line} ${points[points.length-1].x},${height-padY}`:'';
 return <ChartShell title={title} subtitle={subtitle} className="bi-line-card">{data.length?<div className="bi-line-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}><defs><linearGradient id="biArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5ea8ff" stopOpacity=".38"/><stop offset="100%" stopColor="#5ea8ff" stopOpacity="0"/></linearGradient></defs>{[0.25,0.5,0.75,1].map(n=><line key={n} x1={padX} x2={width-padX} y1={height-padY-(height-padY*2)*n} y2={height-padY-(height-padY*2)*n} className="bi-grid-line"/>)}{points.length>1&&<polygon points={area} fill="url(#biArea)"/>}<polyline points={line} className="bi-line-path"/>{points.map((p,i)=><g key={`${p.label}-${i}`}><circle cx={p.x} cy={p.y} r="5" className="bi-line-point"/><text x={p.x} y={p.y-12} textAnchor="middle" className="bi-line-value">{p.value}</text><text x={p.x} y={height-6} textAnchor="middle" className="bi-line-label">{p.label}</text></g>)}</svg></div>:<EmptyChart/>}</ChartShell>;
}

export default function BusinessIntelligencePage({ embedded=false, hideHeading=false }){
 const[data,setData]=useState(null);const[from,setFrom]=useState('');const[to,setTo]=useState('');const[loading,setLoading]=useState(false);
 const load=()=>{setLoading(true);api.get('/admin/bi',{params:{from:from||undefined,to:to||undefined}}).then(r=>setData(r.data)).finally(()=>setLoading(false));};
 useEffect(()=>{load()},[]);
 if(!data)return <div className="page-loading"><div className="spinner"/></div>;
 const cards=[['Servicios finalizados',data.kpis.serviciosFinalizados,Wrench],['Citas registradas',data.kpis.citas,CalendarDays],['Valor total cotizado',money(data.kpis.valorCotizado),BadgeDollarSign],['Metros consumidos',`${Number(data.kpis.metrosConsumidos).toFixed(1)} m`,Ruler],['Stock crítico',data.kpis.stockCritico,PackageOpen]];
 return <div className={embedded?'bi-embedded':'admin-page'}>
  {!hideHeading && (embedded ? <div className="bi-embedded-heading"><h2>Dashboard</h2><p>Filtra los indicadores por fecha. El valor cotizado no representa pagos cobrados.</p></div> : <div className="page-head"><div><span className="eyebrow">DASHBOARD</span><h1>Indicadores del negocio</h1><p>Indicadores operativos obtenidos de citas, cotizaciones, órdenes e inventario. El valor cotizado no representa pagos cobrados.</p></div></div>)}
  <div className="bi-filters"><label><span>Desde</span><CompactDatePicker value={from} onChange={setFrom} maxDate={todayLocal()}/></label><label><span>Hasta</span><CompactDatePicker value={to} onChange={setTo} maxDate={todayLocal()}/></label><button className="btn primary" onClick={load} disabled={loading}><ChartNoAxesCombined size={17}/>{loading?'Actualizando...':'Actualizar análisis'}</button></div>
  <div className="stats-grid bi-stats">{cards.map(([label,value,Icon],i)=><article className="stat-card bi-stat-card" key={label}><span className="stat-icon" style={{'--stat-accent':palette[i%palette.length]}}><Icon/></span><div><small>{label}</small><strong>{value}</strong></div></article>)}</div>
  <div className="bi-dashboard-grid">
    <HorizontalBars title="Servicios finalizados por marca" subtitle="Comparación de las láminas instaladas en servicios finalizados." data={data.porMarca}/>
    <DonutChart title="Particulares vs concesionarios" subtitle="Distribución de órdenes finalizadas por origen del servicio." data={data.porTipoCliente}/>
    <ColumnChart title="Servicios por concesionario" subtitle="Cantidad de vehículos atendidos por concesionario." data={data.porConcesionario}/>
    <DonutChart title="Categorías de vehículo" subtitle="Participación de sedanes, SUV/Hatchback y camionetas/Pickup." data={data.porCategoria}/>
    <DonutChart title="Tonalidades instaladas" subtitle="Distribución de las tonalidades utilizadas en las OT finalizadas." data={data.porTonalidad}/>
    <DonutChart title="Lugar de atención" subtitle="Citas registradas en local frente a servicios a domicilio." data={data.citasPorLugar}/>
    <div className="bi-wide"><LineChart title="Horarios con más citas" subtitle="Comportamiento de la demanda según la hora elegida por los clientes." data={data.horariosCitas}/></div>
  </div>
 </div>;
}
