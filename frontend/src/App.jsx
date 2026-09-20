import { Navigate, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import AdminLayout from './layouts/AdminLayout';
import CustomersPage from './pages/admin/CustomersPage';
import ServicesPage from './pages/admin/ServicesPage';
import InventoryPage from './pages/admin/InventoryPage';
import WorkOrdersPage from './pages/admin/WorkOrdersPage';

function Pendiente({titulo}){return <main className="public-page"><div className="section"><h1>{titulo}</h1><p>Este modulo se integrara en la siguiente entrega.</p><a href="/">Volver al inicio</a></div></main>;}
export default function App(){return <Routes>
<Route path="/" element={<LandingPage/>}/>
<Route path="/login" element={<LoginPage/>}/>
<Route path="/reservar" element={<Pendiente titulo="Cotizacion y reservas"/>}/>
<Route path="/admin" element={<ProtectedRoute><AdminLayout/></ProtectedRoute>}>
<Route index element={<Navigate to="dashboard" replace/>}/>
<Route path="dashboard" element={<div className="admin-page"><h1>Panel administrativo</h1><p>Indicadores en preparacion.</p></div>}/>
<Route path="clientes" element={<CustomersPage/>}/>
<Route path="servicios" element={<ServicesPage/>}/>
<Route path="inventario" element={<InventoryPage/>}/>
<Route path="ot-clientes" element={<WorkOrdersPage type="CLIENTE_NATURAL"/>}/>
<Route path="ot-concesionarios" element={<WorkOrdersPage type="CONCESIONARIO"/>}/>
</Route>
<Route path="*" element={<Navigate to="/" replace/>}/>
</Routes>;}
