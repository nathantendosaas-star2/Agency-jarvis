const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { generateSocialContent, generateContentCalendar } = require("../agents/socialAgent");
const { getClientById } = require("./clientsService");
const { createApprovalRequest, claimApprovalForExecution, markApprovalExecuted } = require("./approvalService");
const { scheduleBufferPost, getBufferProfiles } = require("./bufferService");
const { logActivity } = require("./activityService");

async function listSocialContent(filters = {}) {
  if (!isSupabaseConfigured()) {
    return { content: [], total: 0 };
  }

  let query = getSupabaseClient().from("social_content").select("*, clients(name, company)", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.client_id) query = query.eq("client_id", filters.client_id);

  const limit = Math.min(Number(filters.limit) || 50, 100);
  query = query.order("created_at", { ascending: false }).limit(limit);

  const { data, error, count } = await query;
  if (error) throw error;
  return { content: data || [], total: count || 0 };
}

async function getSocialContentById(id) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from("social_content").select("*, clients(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function generateSocialPostsForClient(clientId, objective, platform = "linkedin") {
  let client = { name: "Sample Client", company: "Agency Demo" };
  if (clientId) {
    const fetched = await getClientById(clientId);
    if (fetched) client = fetched;
  }

  const generated = await generateSocialContent(client, objective, platform);
  const createdPosts = [];

  for (const idea of (generated.content_ideas || [])) {
    const record = {
      client_id: clientId || null,
      title: idea.title || `${platform.toUpperCase()} Post`,
      content: idea.caption,
      platforms: [idea.platform || platform],
      status: "draft",
      post_type: "post"
    };

    if (isSupabaseConfigured()) {
      const { data, error } = await getSupabaseClient()
        .from("social_content")
        .insert(record)
        .select()
        .single();
      if (!error && data) createdPosts.push(data);
    } else {
      createdPosts.push({ id: "mock-social-" + Date.now() + Math.random(), ...record });
    }
  }

  await logActivity("social_content_generated", `Generated ${createdPosts.length} posts for ${client.company}`, {
    entityType: "social",
    metadata: { clientId, platform, count: createdPosts.length }
  });

  return {
    strategy_notes: generated.strategy_notes,
    posts: createdPosts
  };
}

async function requestSocialPostApproval(socialPostId) {
  const post = await getSocialContentById(socialPostId);
  if (!post) throw new Error("Social content not found.");
  if (post.status === "scheduled" || post.status === "published") {
    throw new Error("This post has already been scheduled or published.");
  }

  const approval = await createApprovalRequest({
    action_type: "schedule_post",
    entity_type: "social",
    entity_id: socialPostId,
    title: `Schedule Post: "${post.title}"`,
    summary: post.content.slice(0, 150) + "…",
    payload: {
      platforms: post.platforms,
      content: post.content
    }
  });

  return approval;
}

async function scheduleApprovedSocialPost(socialPostId, bufferProfileIds, scheduledAt = null) {
  const post = await getSocialContentById(socialPostId);
  if (!post) throw new Error("Social content not found.");

  if (post.status === "scheduled" || post.status === "published") {
    throw new Error("Duplicate scheduling prevented: Post already scheduled or published.");
  }

  // Atomically consume the approved decision before calling Buffer.
  const approval = await claimApprovalForExecution("social", socialPostId, "schedule_post", { platforms: post.platforms, content: post.content });
  if (!approval) throw new Error("Backend Approval Error: no current, matching administrator approval exists for this post.");

  try {
    const bufferRes = await scheduleBufferPost({
      profileIds: bufferProfileIds,
      text: post.content,
      scheduledAt: scheduledAt
    });

    const bufferUpdateId = bufferRes.updates?.[0]?.id || bufferRes.id || "buf-sim";
    const updates = {
      status: "scheduled",
      scheduled_at: scheduledAt || new Date().toISOString(),
      buffer_profile_id: bufferProfileIds[0],
      buffer_update_id: String(bufferUpdateId)
    };

    let updatedPost = { ...post, ...updates };

    if (isSupabaseConfigured()) {
      const { data, error } = await getSupabaseClient()
        .from("social_content")
        .update(updates)
        .eq("id", socialPostId)
        .select()
        .single();
      if (error) throw error;
      updatedPost = data;

      await markApprovalExecuted(approval.id, bufferRes);
    }

    return {
      success: true,
      post: updatedPost,
      bufferResult: bufferRes
    };
  } catch (err) {
    if (isSupabaseConfigured()) {
      // Keep the approval claim locked if Buffer may have accepted the post.
      await getSupabaseClient().from("social_content").update({ status: "failed", failure_reason: err.message }).eq("id", socialPostId);
    }
    throw err;
  }
}

module.exports = {
  listSocialContent,
  getSocialContentById,
  generateSocialPostsForClient,
  requestSocialPostApproval,
  scheduleApprovedSocialPost
};
