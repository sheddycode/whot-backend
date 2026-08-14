const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[config] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. ' +
      'Copy .env.example to .env and fill in your Supabase project values.'
  );
}

// Service-role client: used ONLY on the server, bypasses RLS.
// Never ship the service role key to the mobile app.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = { supabaseAdmin };
