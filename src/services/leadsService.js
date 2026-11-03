const { getSupabaseClient } = require("../config/supabase");

function normalizeWebsite(url) {
  if (!url || typeof url !== "string") return null;
  let trimmed = url.trim().toLowerCase();
  if (!trimmed) return null;
  trimmed = trimmed.replace(/^https?:\/\//, "");
  trimmed = trimmed.replace(/^www\./, "");
  trimmed = trimmed.split("/")[0].split("?")[0].split("#")[0].trim();
  return trimmed || null;
}

function normalizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

async function listLeads(filters = {}) {
  const supabase = getSupabaseClient();
  let query = supabase.from("leads").select("*", { count: "exact" });
  if (filters.status) query = query.eq("lead_status", filters.status);
  if (filters.research_status) query = query.eq("research_status", filters.research_status);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(`business_name.ilike.${term},company_name.ilike.${term},contact_name.ilike.${term},email.ilike.${term}`);
  }
  const limit = Math.min(Number(filters.limit) || 50, 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  return { leads: data || [], total: count || 0, limit, offset };
}

async function getLeadById(id) {
  const { data, error } = await getSupabaseClient().from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data && !data.business_name) data.business_name = data.company_name;
  return data;
}

async function createLead(leadData) {
  const businessName = leadData.business_name?.trim();
  const normalizedWeb = normalizeWebsite(leadData.website);
  const normalizedMail = normalizeEmail(leadData.email);
  const record = {
    company_name: businessName,
    business_name: businessName,
    website: leadData.website?.trim() || null,
    normalized_website: normalizedWeb,
    contact_name: leadData.contact_name?.trim() || null,
    email: normalizedMail,
    phone: leadData.phone?.trim() || null,
    business_category: leadData.business_category?.trim() || null,
    industry: leadData.business_category?.trim() || null,
    location: leadData.location?.trim() || null,
    source: leadData.source?.trim() || "manual",
    lead_status: leadData.lead_status || "new",
    research_status: leadData.research_status || "pending",
    qualification_score: typeof leadData.qualification_score === "number" ? leadData.qualification_score : null,
    notes: leadData.notes?.trim() || null
  };
  const { data, error } = await getSupabaseClient().from("leads").insert(record).select().single();
  if (error) throw error;
  return data;
}

async function updateLead(id, updates) {
  const updateData = { ...updates };
  if ("website" in updateData) updateData.normalized_website = normalizeWebsite(updateData.website);
  if ("email" in updateData) updateData.email = normalizeEmail(updateData.email);
  const { data, error } = await getSupabaseClient().from("leads").update(updateData).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

async function findDuplicateLead({ normalized_website, email, business_name }) {
  const supabase = getSupabaseClient();
  if (normalized_website) {
    const { data, error } = await supabase.from("leads").select("id,business_name,company_name,website")
      .eq("normalized_website", normalized_website).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  if (email) {
    const { data, error } = await supabase.from("leads").select("id,business_name,company_name,email")
      .eq("email", email.toLowerCase().trim()).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  if (business_name) {
    const { data, error } = await supabase.from("leads").select("id,business_name,company_name")
      .ilike("business_name", business_name.trim()).maybeSingle();
    if (error) throw error;
    if (error) throw error;
    if (data) return data;
    const fallback = await supabase.from("leads").select("id,company_name")
      .ilike("company_name", business_name.trim()).maybeSingle();
    if (fallback.error) throw fallback.error;
    if (fallback.data) return fallback.data;
  }
  return null;
}

module.exports = { normalizeWebsite, normalizeEmail, listLeads, getLeadById, createLead, updateLead, findDuplicateLead };
