import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function LoginPage(){
  const [form,setForm]=useState({email:'',password:''});
  const [show,setShow]=useState(false); const [loading,setLoading]=useState(false);
  const {login,user,loading:authLoading}=useAuth(); const {show:toast}=useToast(); const nav=useNavigate();
  const submit=async(e)=>{e.preventDefault();setLoading(true);try{await login(form.email,form.password);toast('Bienvenido al panel administrativo');nav('/admin/dashboard',{replace:true});}catch(err){toast(err.response?.data?.message||'No se pudo iniciar sesión','error');}finally{setLoading(false)}};
  if(authLoading)return <div className="screen-loader">Comprobando sesión...</div>;
  if(user)return <Navigate to="/admin/dashboard" replace/>;
  return <div className="login-page">
    <Link className="back-link" to="/"><ArrowLeft size={17}/> Volver al sitio</Link>
    <div className="login-grid">
      <section className="login-copy"><span className="brand-mark large">S</span><span className="eyebrow">PANEL ADMINISTRATIVO</span><h1>Controla citas, órdenes e inventario desde un solo lugar.</h1><div className="login-benefits"><span><ShieldCheck/>Acceso exclusivo para administradores</span><span><LockKeyhole/>Autenticación administrada por Supabase Auth</span></div></section>
      <form className="login-card" onSubmit={submit}>
        <div><span className="eyebrow">INICIAR SESIÓN</span><h2>Bienvenido</h2><p>Ingresa con la cuenta de administrador registrada en Supabase.</p></div>
        <label><span>Correo</span><div className="input-icon"><Mail size={18}/><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="admin@empresa.com" required/></div></label>
        <label><span>Contraseña</span><div className="input-icon"><LockKeyhole size={18}/><input type={show?'text':'password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" required/><button type="button" onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
        <button className="btn primary full" disabled={loading}>{loading?'Ingresando...':'Ingresar al panel'}</button>
        
      </form>
    </div>
  </div>;
}
