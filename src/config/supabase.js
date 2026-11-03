const { createClient } = require("@supabase/supabase-js");

let supabaseInstance = null;

function getSupabaseClient() {
  if (supabaseInstance) return supabaseInstance;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase configuration missing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be defined in environment variables."
    );
  }

  supabaseInstance = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return supabaseInstance;
}

function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Helper to set client for unit testing/mocking
function setSupabaseClient(client) {
  supabaseInstance = client;
}

module.exports = {
  getSupabaseClient,
  isSupabaseConfigured,
  setSupabaseClient
};
