const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");

async function logActivity(eventType, description, options = {}) {
  const { entityType = null, entityId = null, metadata = {} } = options;
  const payload = {
    event_type: eventType,
    description: description,
    entity_type: entityType,
    entity_id: entityId,
    metadata: metadata
  };

  if (!isSupabaseConfigured()) {
    return { id: "mock-log-" + Date.now(), ...payload, created_at: new Date().toISOString() };
  }

  try {
    const { data, error } = await getSupabaseClient()
      .from("activity_logs")
      .insert(payload)
      .select()
      .single();
    if (error) {
      console.warn("Failed to insert activity log:", error.message);
      return payload;
    }
    return data;
  } catch (err) {
    console.warn("Activity logging error:", err.message);
    return payload;
  }
}

async function listActivities(limit = 20) {
  if (!isSupabaseConfigured()) {
    return [];
  }
  const { data, error } = await getSupabaseClient()
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

module.exports = {
  logActivity,
  listActivities
};
