import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NOMBRES, ADMIN_APELLIDOS } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL o ADMIN_PASSWORD en backend/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await supabase.auth.admin.createUser({
  email: ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
  email_confirm: true,
  user_metadata: {
    nombres: ADMIN_NOMBRES || 'Administrador',
    apellidos: ADMIN_APELLIDOS || 'SAMCJ'
  }
});

if (error) {
  console.error('No se pudo crear el administrador:', error.message);
  process.exit(1);
}

console.log('Administrador creado correctamente:', data.user.email);
console.log('La contraseña se almacena y valida mediante Supabase Auth; no se guarda en public.perfiles.');
