import { Router } from 'express';
import { supabaseAnon, supabaseAdmin } from '../config/supabase.js';
import {createClient} from '@supabase/supabase-js';
import { asyncHandler, apiError } from '../utils/http.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw apiError('Ingresa correo y contraseña');

  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw apiError('Credenciales incorrectas', 401);

  const { data: perfil, error: perfilError } = await supabaseAdmin
    .from('perfiles')
    .select('id,nombres,apellidos,activo,roles(codigo,nombre)')
    .eq('id', data.user.id)
    .single();

  if (perfilError || !perfil?.activo || perfil.roles?.codigo !== 'ADMIN') {
    throw apiError('La cuenta no tiene acceso de administrador', 403);
  }

  res.json({
    accessToken: data.session.access_token,
    expiresAt: data.session.expires_at,
    refreshToken: data.session.refresh_token,
    user: { id: data.user.id, email: data.user.email, perfil }
  });
}));

router.post('/refresh', asyncHandler(async(req,res)=>{
 const token=String(req.body?.refreshToken||'');if(!token||token.length>512)throw apiError('Sesión inválida',401);
 const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.refreshSession({refresh_token:token});
 if(error||!data?.session)throw apiError('La sesión venció; inicia sesión nuevamente',401);
 const profile=ensureProfile(await supabaseAdmin.from('perfiles').select('activo,roles(codigo)').eq('id',data.user.id).single());
 if(!profile.activo||profile.roles?.codigo!=='ADMIN')throw apiError('Acceso no autorizado',403);
 res.json({accessToken:data.session.access_token,refreshToken:data.session.refresh_token,expiresAt:data.session.expires_at});
}));
router.post('/logout', asyncHandler(async(req,res)=>{
 // La revocación se intenta con credenciales del usuario; la UI borra todas las credenciales locales.
 const token=String(req.headers.authorization||'').replace(/^Bearer /i,'');
 if(token){await supabaseAdmin.auth.admin.signOut(token,'global').catch(()=>{});}
 res.json({ok:true});
}));
function ensureProfile(result){if(result.error||!result.data)throw apiError('Perfil inválido',403);return result.data;}

router.get('/me' , requireAdmin, asyncHandler(async (req, res) => {
  res.json({
    id: req.auth.user.id,
    email: req.auth.user.email,
    nombres: req.auth.perfil.nombres,
    apellidos: req.auth.perfil.apellidos,
    rol: req.auth.perfil.roles?.nombre || 'Administrador'
  });
}));

export default router;
