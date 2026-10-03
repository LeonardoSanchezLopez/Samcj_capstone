import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardCheck, PackageOpen, Users, Wrench } from 'lucide-react';
import api from '../../services/api';
import BusinessIntelligencePage from './BusinessIntelligencePage';

export default function DashboardPage(){
  const [data,setData]=useState(null);

  useEffect(()=>{
    api.get('/admin/dashboard').then(r=>setData(r.data));
  },[]);

  if(!data) return <div className="page-loading"><div className="spinner"/></div>;

  const cards=[
    ['Clientes activos',data.stats.clientesActivos,Users],
    ['Citas hoy',data.stats.citasHoy,CalendarDays],
    ['OT pendientes',data.stats.otPendientes,ClipboardCheck],
    ['OT en proceso',data.stats.otEnProceso,Wrench],
    ['Stock bajo',data.stats.stockBajo,PackageOpen]
  ];

  return <div className="admin-page dashboard-page">
    <div className="page-head">
      <div>
        <span className="eyebrow">RESUMEN GENERAL</span>
        <h1>Dashboard</h1>
        <p>Estado actual de citas, órdenes y stock de láminas.</p>
      </div>
    </div>

    <div className="stats-grid dashboard-stats">
      {cards.map(([label,value,Icon])=><article className="stat-card" key={label}>
        <span className="stat-icon"><Icon/></span>
        <div><small>{label}</small><strong>{value}</strong></div>
      </article>)}
    </div>

    <BusinessIntelligencePage embedded hideHeading />
  </div>;
}
