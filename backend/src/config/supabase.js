import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[config] Faltan variables de Supabase. Revisa backend/.env');
}

export const supabaseAnon = createClient(
  SUPABASE_URL || 'http://localhost',
  SUPABASE_ANON_KEY || 'missing-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export const supabaseAdmin = createClient(
  SUPABASE_URL || 'http://localhost',
  SUPABASE_SERVICE_ROLE_KEY || 'missing-service-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);
