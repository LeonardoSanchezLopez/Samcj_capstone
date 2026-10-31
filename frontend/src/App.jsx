import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import BookingPage from './pages/BookingPage';
import LoginPage from './pages/LoginPage';
import AdminLayout from './layouts/AdminLayout';
import DashboardPage from './pages/admin/DashboardPage';
import CustomersPage from './pages/admin/CustomersPage';
import DealershipsPage from './pages/admin/DealershipsPage';
import AppointmentsPage from './pages/admin/AppointmentsPage';
import QuotesPage from './pages/admin/QuotesPage';
import WorkOrdersPage from './pages/admin/WorkOrdersPage';
import InventoryPage from './pages/admin/InventoryPage';
import ServicesPage from './pages/admin/ServicesPage';
import ReportsPage from './pages/admin/ReportsPage';

export default function App() {
  return <Routes>
    <Route path="/" element={<LandingPage/>}/>
    <Route path="/reservar" element={<BookingPage/>}/>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/admin" element={<ProtectedRoute><AdminLayout/></ProtectedRoute>}>
      <Route index element={<Navigate to="dashboard" replace/>}/>
      <Route path="dashboard" element={<DashboardPage/>}/>
      <Route path="clientes" element={<CustomersPage/>}/>
      <Route path="concesionarios" element={<DealershipsPage/>}/>
      <Route path="citas" element={<AppointmentsPage/>}/>
      <Route path="cotizaciones" element={<QuotesPage/>}/>
      <Route path="ot-clientes" element={<WorkOrdersPage type="CLIENTE_NATURAL"/>}/>
      <Route path="ot-concesionarios" element={<WorkOrdersPage type="CONCESIONARIO"/>}/>
      <Route path="inventario" element={<InventoryPage/>}/>
      <Route path="servicios" element={<ServicesPage/>}/>
      <Route path="reportes" element={<ReportsPage/>}/>
      <Route path="bi" element={<Navigate to="/admin/dashboard" replace/>}/>
    </Route>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes>;
}
