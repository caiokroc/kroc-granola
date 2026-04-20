// Admin client — usa service_role_key, só chamar do servidor (api/)
// NUNCA importar do src/ (frontend)
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('[supabase] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados');
}

export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
