import axios from 'axios';
const api=axios.create({baseURL:import.meta.env.VITE_API_URL||'http://localhost:4000/api',timeout:30000});
let renewPromise=null;
const clearSession=()=>{localStorage.removeItem('samcj_token');localStorage.removeItem('samcj_refresh');localStorage.removeItem('samcj_expires');localStorage.removeItem('samcj_user');window.dispatchEvent(new Event('samcj-auth-lost'));};
export async function refreshAuth(){
 const token=localStorage.getItem('samcj_refresh');if(!token)throw new Error('No hay refresh token');
 if(!renewPromise)renewPromise=axios.post(`${api.defaults.baseURL}/auth/refresh`,{refreshToken:token},{timeout:18000}).then(({data})=>{
  localStorage.setItem('samcj_token',data.accessToken);localStorage.setItem('samcj_refresh',data.refreshToken);localStorage.setItem('samcj_expires',String(data.expiresAt));return data.accessToken;
 }).finally(()=>{renewPromise=null});
 return renewPromise;
}
api.interceptors.request.use(async config=>{
 if(!String(config.url).startsWith('/auth/')&&localStorage.getItem('samcj_refresh')&&Number(localStorage.getItem('samcj_expires')||0)*1000<Date.now()+90000){
  try{await refreshAuth();}catch{clearSession();}
 }
 const token=localStorage.getItem('samcj_token');if(token)config.headers.Authorization=`Bearer ${token}`;return config;
});
api.interceptors.response.use(r=>r,async error=>{
 const config=error.config||{};
 if(error.response?.status===401&&!config._renewed&&!String(config.url||'').startsWith('/auth/')){
  config._renewed=true;try{config.headers.Authorization=`Bearer ${await refreshAuth()}`;return await api(config)}catch{clearSession();}
 }
 return Promise.reject(error);
});
export default api;
