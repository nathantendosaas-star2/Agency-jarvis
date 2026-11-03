const { logActivity } = require("./activityService");

function getBufferConfig() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  return {
    accessToken: token,
    isConfigured: Boolean(token && token.trim().length > 0)
  };
}

async function getBufferProfiles(accessToken = process.env.BUFFER_ACCESS_TOKEN) {
  if (!accessToken) {
    throw new Error("BUFFER_ACCESS_TOKEN is not configured.");
  }

  const endpoint = "https://api.bufferapp.com/1/profiles.json";
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Buffer API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function scheduleBufferPost({ profileIds, text, mediaUrls = [], scheduledAt = null }) {
  const accessToken = process.env.BUFFER_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("BUFFER_ACCESS_TOKEN is not configured.");
  }

  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    throw new Error("At least one Buffer profile ID must be specified.");
  }
  if (!text || !text.trim()) {
    throw new Error("Post text cannot be empty.");
  }

  const endpoint = "https://api.bufferapp.com/1/updates/create.json";

  const params = new URLSearchParams();
  profileIds.forEach((pid) => params.append("profile_ids[]", pid));
  params.append("text", text.trim());

  if (scheduledAt) {
    params.append("scheduled_at", Math.floor(new Date(scheduledAt).getTime() / 1000).toString());
  } else {
    params.append("now", "false"); // Schedule into queue
  }

  if (mediaUrls && mediaUrls.length > 0) {
    params.append("media[photo]", mediaUrls[0]);
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Buffer scheduling failed (${res.status}): ${errorText}`);
  }

  const result = await res.json();
  await logActivity("buffer_post_scheduled", `Scheduled post across ${profileIds.length} Buffer profiles`, {
    metadata: { profileIds, bufferUpdateId: result.updates?.[0]?.id || result.id }
  });

  return result;
}

async function testBufferConnection() {
  const { isConfigured, accessToken } = getBufferConfig();
  if (!isConfigured) {
    return {
      connected: false,
      message: "BUFFER_ACCESS_TOKEN is not configured."
    };
  }

  try {
    const profiles = await getBufferProfiles(accessToken);
    return {
      connected: true,
      message: `Connected successfully to Buffer. Found ${profiles.length} connected channel(s).`,
      profiles: profiles.map((p) => ({
        id: p.id,
        service: p.service,
        service_username: p.service_username
      }))
    };
  } catch (err) {
    return {
      connected: false,
      message: `Buffer verification failed: ${err.message}`
    };
  }
}

module.exports = {
  getBufferConfig,
  getBufferProfiles,
  scheduleBufferPost,
  testBufferConnection
};
