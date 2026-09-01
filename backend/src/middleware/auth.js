import { supabaseAdmin } from '../config/supabase.js';
import { apiError } from '../utils/http.js';

export async function requireAdmin(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw apiError('Sesión no válida', 401);

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) throw apiError('Sesión expirada o inválida', 401);

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfiles')
      .select('id,nombres,apellidos,activo,roles(codigo,nombre)')
      .eq('id', userData.user.id)
      .single();

    if (perfilError || !perfil || !perfil.activo || perfil.roles?.codigo !== 'ADMIN') {
      throw apiError('No autorizado', 403);
    }

    req.auth = { token, user: userData.user, perfil };
    next();
  } catch (error) {
    next(error);
  }
}
