import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, ClipboardCheck, FileText, LayoutDashboard, LogOut, Menu, PackageOpen, Store, Users, X, BadgeDollarSign, CarFront, ChartNoAxesCombined, BrainCircuit } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { dateTime } from '../utils/format';

const nav = [
  ['Dashboard','/admin/dashboard',LayoutDashboard],
  ['Clientes','/admin/clientes',Users],
  ['Servicios','/admin/servicios',FileText],
  ['Inventario','/admin/inventario',PackageOpen],
  ['OT clientes','/admin/ot-clientes',ClipboardCheck],
  ['OT concesionarios','/admin/ot-concesionarios',CarFront],
  ['Concesionarios','/admin/concesionarios',Store],
  ['Citas','/admin/citas',CalendarDays],
  ['Cotizaciones','/admin/cotizaciones',BadgeDollarSign],
  ['Reportes','/admin/reportes',ChartNoAxesCombined],
];

export default function AdminLayout(){
  const {user,logout}=useAuth(); const navigate=useNavigate(); const [open,setOpen]=useState(false); const [notes,setNotes]=useState([]); const [noteOpen,setNoteOpen]=useState(false);
  const loadNotes=()=>api.get('/admin/notifications').then(r=>setNotes(r.data)).catch(()=>{});
  useEffect(()=>{loadNotes();const t=setInterval(loadNotes,45000);return()=>clearInterval(t)},[]);
  const signOut=async()=>{await logout();navigate('/login',{replace:true})};
  const read=async(n)=>{if(!n.leida)await api.patch(`/admin/notifications/${n.id}/read`);loadNotes();};
  return <div className="admin-shell">
    <aside className={`admin-sidebar ${open?'open':''}`}>
      <div className="sidebar-brand"><span className="brand-mark">S</span><div><strong>SAMCJ</strong><small>Panel administrativo</small></div><button className="mobile-close" onClick={()=>setOpen(false)}><X/></button></div>
      <nav>{nav.map(([label,path,Icon])=><NavLink key={path} to={path} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'active':''}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>
      <button className="sidebar-logout" onClick={signOut}><LogOut size={18}/> Cerrar sesión</button>
    </aside>
    <section className="admin-workspace">
      <header className="admin-topbar"><button className="menu-btn" onClick={()=>setOpen(true)}><Menu/></button><div className="admin-top-spacer"/><div className="notification-wrap"><button className="icon-btn notification-btn" onClick={()=>setNoteOpen(!noteOpen)}><Bell size={19}/>{notes.some(n=>!n.leida)&&<span/>}</button>{noteOpen&&<div className="notification-popover"><div className="notification-head"><strong>Notificaciones</strong><small>{notes.filter(n=>!n.leida).length} sin leer</small></div>{notes.length?notes.slice(0,8).map(n=><button key={n.id} className={n.leida?'read':''} onClick={()=>read(n)}><strong>{n.titulo}</strong><span>{n.mensaje}</span><small>{dateTime(n.creado_en)}</small></button>):<p className="muted">No hay notificaciones.</p>}</div>}</div><div className="admin-user"><div className="avatar">{(user?.nombres||'A').slice(0,1)}</div><div><strong>{user?.nombres||'Administrador'} {user?.apellidos||''}</strong><small>Administrador</small></div></div></header>
      <main className="admin-content"><Outlet/></main>
    </section>
    {open&&<div className="sidebar-overlay" onClick={()=>setOpen(false)}/>} 
  </div>;
}
