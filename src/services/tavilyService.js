async function researchBusinessWithTavily(query, options = {}) {
  const apiKey = options.apiKey || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (!normalizedQuery) throw new Error("A non-empty Tavily search query is required.");
  if (normalizedQuery.length > 1500) throw new Error(`Tavily query is too long (${normalizedQuery.length} characters; maximum 1500).`);

  const endpoint = "https://api.tavily.com/search";
  const body = {
    api_key: apiKey,
    query: normalizedQuery,
    search_depth: options.searchDepth || "advanced",
    include_answer: true,
    max_results: options.maxResults || 5
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(`Tavily search failed (${response.status}): ${errorDetail}`);
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const sources = results.map((r) => ({
    title: r.title || "",
    url: r.url || "",
    content: r.content || ""
  }));

  return {
    query,
    answer: data.answer || null,
    sources,
    raw: data
  };
}

module.exports = {
  researchBusinessWithTavily
};
