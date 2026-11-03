const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { logActivity } = require("./activityService");

async function listClients(filters = {}) {
  if (!isSupabaseConfigured()) {
    return { clients: [], total: 0 };
  }

  let query = getSupabaseClient().from("clients").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(`name.ilike.${term},company.ilike.${term},email.ilike.${term}`);
  }

  const limit = Math.min(Number(filters.limit) || 50, 100);
  query = query.order("created_at", { ascending: false }).limit(limit);

  const { data, error, count } = await query;
  if (error) throw error;
  return { clients: data || [], total: count || 0 };
}

async function getClientById(id) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function createClient(clientData) {
  const name = clientData.name?.trim();
  const company = clientData.company?.trim();

  if (!name || !company) {
    throw new Error("Client name and company are required.");
  }

  const record = {
    name,
    company,
    lead_id: clientData.lead_id || null,
    email: clientData.email?.trim() || null,
    phone: clientData.phone?.trim() || null,
    website: clientData.website?.trim() || null,
    industry: clientData.industry?.trim() || null,
    status: clientData.status || "active",
    tier: clientData.tier || "standard",
    notes: clientData.notes?.trim() || null
  };

  if (!isSupabaseConfigured()) {
    return { id: "mock-client-" + Date.now(), ...record, created_at: new Date().toISOString() };
  }

  const { data, error } = await getSupabaseClient()
    .from("clients")
    .insert(record)
    .select()
    .single();

  if (error) throw error;

  await logActivity("client_created", `Created client ${record.name} (${record.company})`, {
    entityType: "clients",
    entityId: data.id,
    metadata: { company: record.company }
  });

  return data;
}

async function updateClient(id, updates) {
  if (!isSupabaseConfigured()) {
    return { id, ...updates };
  }

  const { data, error } = await getSupabaseClient()
    .from("clients")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  await logActivity("client_updated", `Updated client ${data.name} (${data.company})`, {
    entityType: "clients",
    entityId: id
  });

  return data;
}

module.exports = {
  listClients,
  getClientById,
  createClient,
  updateClient
};
