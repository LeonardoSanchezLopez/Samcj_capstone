import { createContext, useContext, useEffect, useState } from 'react';
import api, {refreshAuth} from '../services/api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('samcj_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('samcj_token')));

  useEffect(() => {
    const onLost=()=>{setUser(null);setLoading(false)};window.addEventListener('samcj-auth-lost',onLost);
    const interval=setInterval(()=>{if(localStorage.getItem('samcj_refresh')&&Number(localStorage.getItem('samcj_expires')||0)*1000<Date.now()+120000)refreshAuth().catch(onLost)},60000);
    if (!localStorage.getItem('samcj_token')) {setLoading(false);return ()=>{clearInterval(interval);window.removeEventListener('samcj-auth-lost',onLost)};}
    api.get('/auth/me').then(({ data }) => {
      setUser(data);
      localStorage.setItem('samcj_user', JSON.stringify(data));
    }).catch(() => setUser(null)).finally(() => setLoading(false));
    return ()=>{clearInterval(interval);window.removeEventListener('samcj-auth-lost',onLost)};
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('samcj_token', data.accessToken);
    localStorage.setItem('samcj_refresh',data.refreshToken);
    localStorage.setItem('samcj_expires',String(data.expiresAt));
    const normalized = {
      id: data.user.id,
      email: data.user.email,
      nombres: data.user.perfil?.nombres,
      apellidos: data.user.perfil?.apellidos,
      rol: data.user.perfil?.roles?.nombre || 'Administrador'
    };
    localStorage.setItem('samcj_user', JSON.stringify(normalized));
    setUser(normalized);
    return normalized;
  };

  const logout = async () => {
    try{await api.post('/auth/logout')}catch{}
    localStorage.removeItem('samcj_token');
    localStorage.removeItem('samcj_refresh');
    localStorage.removeItem('samcj_expires');
    localStorage.removeItem('samcj_user');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}
