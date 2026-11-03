const { logActivity } = require("./activityService");
const BUFFER_ENDPOINT = "https://api.buffer.com";
function getBufferConfig() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  return { accessToken: token, isConfigured: Boolean(token && token.trim()) };
}
async function bufferGraphQL(query, accessToken = process.env.BUFFER_ACCESS_TOKEN) {
  if (!accessToken) throw new Error("BUFFER_ACCESS_TOKEN is not configured.");
  const res = await fetch(BUFFER_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Buffer API error (${res.status}): ${JSON.stringify(payload)}`);
  if (payload.errors?.length) throw new Error(`Buffer GraphQL error: ${payload.errors.map(e => e.message).join("; ")}`);
  return payload.data || {};
}
async function getBufferProfiles(accessToken = process.env.BUFFER_ACCESS_TOKEN) {
  const accountData = await bufferGraphQL("query AgencyJarvisOrganizations { account { organizations { id name } } }", accessToken);
  const organizations = accountData.account?.organizations || [];
  const channels = [];
  for (const organization of organizations) {
    const data = await bufferGraphQL(`query AgencyJarvisChannels { channels(input: { organizationId: ${JSON.stringify(organization.id)} }) { id name service displayName descriptor } }`, accessToken);
    for (const channel of (data.channels || [])) channels.push({ ...channel, organization_id: organization.id, organization_name: organization.name, service_username: channel.displayName || channel.descriptor || channel.name });
  }
  return channels;
}
async function scheduleBufferPost({ profileIds, text, mediaUrls = [], scheduledAt = null }) {
  if (!Array.isArray(profileIds) || !profileIds.length) throw new Error("At least one Buffer channel ID must be specified.");
  if (!text || !text.trim()) throw new Error("Post text cannot be empty.");
  if (mediaUrls.length) throw new Error("Media scheduling is not supported by this text-only Buffer workflow.");
  const posts = [];
  for (const channelId of profileIds) {
    let schedule;
    if (scheduledAt) {
      const date = new Date(scheduledAt);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Scheduled time must be a valid future date.");
      schedule = `mode: customScheduled, dueAt: ${JSON.stringify(date.toISOString())}`;
    } else schedule = "mode: addToQueue";
    const query = `mutation AgencyJarvisCreatePost { createPost(input: { text: ${JSON.stringify(text.trim())}, channelId: ${JSON.stringify(channelId)}, schedulingType: automatic, ${schedule} }) { ... on PostActionSuccess { post { id text dueAt status channelId } } ... on MutationError { message } } }`;
    const data = await bufferGraphQL(query);
    const post = data.createPost?.post;
    if (!post?.id) throw new Error(data.createPost?.message || "Buffer did not confirm post creation.");
    posts.push(post);
  }
  await logActivity("buffer_post_scheduled", `Scheduled post to ${posts.length} Buffer channel(s)`, { metadata: { channelIds: profileIds, bufferPostIds: posts.map(p => p.id) } });
  return { posts, updates: posts.map(post => ({ id: post.id, ...post })) };
}
async function testBufferConnection() {
  const { isConfigured, accessToken } = getBufferConfig();
  if (!isConfigured) return { connected: false, message: "BUFFER_ACCESS_TOKEN is not configured." };
  try {
    const profiles = await getBufferProfiles(accessToken);
    return { connected: true, message: `Connected successfully to Buffer. Found ${profiles.length} connected channel(s).`, profiles: profiles.map(p => ({ id: p.id, service: p.service, service_username: p.service_username, name: p.name })) };
  } catch (err) { return { connected: false, message: `Buffer verification failed: ${err.message}` }; }
}
module.exports = { getBufferConfig, getBufferProfiles, scheduleBufferPost, testBufferConnection, bufferGraphQL };
