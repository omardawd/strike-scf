// Broad-discovery keyword search — separate from lib/ai/tools/handlers/search-web.ts
// (that one is tuned for general chat use, basic depth). This uses 'advanced'
// depth and supports domain targeting for the directory-focused discovery round.

export interface TavilySearchResult {
  url: string
  title: string
  snippet: string
}

export async function tavilySearch(params: {
  query: string
  maxResults?: number
  includeDomains?: string[]
}): Promise<{ results: TavilySearchResult[] } | { error: string }> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return { error: 'Web search is not configured (missing TAVILY_API_KEY).' }

  let res: Response
  try {
    res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: params.query,
        search_depth: 'advanced',
        max_results: params.maxResults ?? 12,
        ...(params.includeDomains ? { include_domains: params.includeDomains } : {}),
      }),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Tavily search failed' }
  }

  if (!res.ok) return { error: `Tavily search failed (status ${res.status})` }

  const data = await res.json() as { results?: { title: string; url: string; content: string }[] }
  return {
    results: (data.results ?? []).map(r => ({ url: r.url, title: r.title, snippet: r.content?.slice(0, 500) ?? '' })),
  }
}
