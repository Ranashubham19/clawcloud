import { config } from "./config.js";

export function hasSearchProvider() {
  return Boolean(config.tavilyApiKey);
}

export async function webSearch({ query, maxResults = 5, freshness = "" }) {
  if (!config.tavilyApiKey) {
    return {
      ok: false,
      error: "web_search_unavailable",
      message:
        "Web search is not configured. Set TAVILY_API_KEY in the environment to enable it."
    };
  }

  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return {
      ok: false,
      error: "empty_query",
      message: "The web_search query cannot be empty."
    };
  }

  const payload = {
    api_key: config.tavilyApiKey,
    query: trimmedQuery,
    search_depth: "advanced",
    include_answer: true,
    include_images: false,
    include_raw_content: false,
    max_results: Math.min(Math.max(Number(maxResults) || 5, 1), 10)
  };

  if (freshness === "day") {
    payload.days = 1;
  } else if (freshness === "week") {
    payload.days = 7;
  } else if (freshness === "month") {
    payload.days = 30;
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const details = await response.text();
      return {
        ok: false,
        error: "tavily_http_error",
        status: response.status,
        message: details.slice(0, 400)
      };
    }

    const data = await response.json();
    const results = (data.results || []).map((entry) => ({
      title: entry.title || "",
      url: entry.url || "",
      published: entry.published_date || "",
      snippet: String(entry.content || "").slice(0, 500)
    }));

    return {
      ok: true,
      query: trimmedQuery,
      answer: data.answer || "",
      results,
      fetched_at: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      error: "tavily_request_failed",
      message: error.message
    };
  }
}
