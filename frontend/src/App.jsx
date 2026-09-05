import { Navigate, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';

function Pendiente({titulo}){return <main className="public-page"><div className="section"><h1>{titulo}</h1><p>Este modulo se integrara en la siguiente entrega.</p><a href="/">Volver al inicio</a></div></main>;}
export default function App(){return <Routes>
<Route path="/" element={<LandingPage/>}/>
<Route path="/login" element={<Pendiente titulo="Acceso administrativo"/>}/>
<Route path="/reservar" element={<Pendiente titulo="Cotizacion y reservas"/>}/>
<Route path="*" element={<Navigate to="/" replace/>}/>
</Routes>;}
