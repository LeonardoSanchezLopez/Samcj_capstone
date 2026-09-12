import { Navigate, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import AdminLayout from './layouts/AdminLayout';

function Pendiente({titulo}){return <main className="public-page"><div className="section"><h1>{titulo}</h1><p>Este modulo se integrara en la siguiente entrega.</p><a href="/">Volver al inicio</a></div></main>;}
export default function App(){return <Routes>
<Route path="/" element={<LandingPage/>}/>
<Route path="/login" element={<LoginPage/>}/>
<Route path="/reservar" element={<Pendiente titulo="Cotizacion y reservas"/>}/>
<Route path="/admin" element={<ProtectedRoute><AdminLayout/></ProtectedRoute>}>
<Route index element={<Navigate to="dashboard" replace/>}/>
<Route path="dashboard" element={<div className="admin-page"><h1>Panel administrativo</h1><p>Indicadores en preparacion.</p></div>}/>
</Route>
<Route path="*" element={<Navigate to="/" replace/>}/>
</Routes>;}
