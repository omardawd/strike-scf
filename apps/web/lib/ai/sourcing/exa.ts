// Semantic/niche discovery search — finds pages that match the MEANING of a
// query rather than its keywords, which is what surfaces a small manufacturer's
// unoptimized product page instead of only whatever already ranks on Google.
// Complements Tavily (keyword search) during the broad-discovery stage.
// Docs: https://docs.exa.ai/reference/search-api-guide-for-coding-agents

export interface ExaSearchResult {
  url: string
  title: string | null
  publishedDate: string | null
  highlights: string[]
}

export interface ExaSearchParams {
  query: string
  type?: 'auto' | 'fast' | 'deep-lite' | 'deep'
  numResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
}

export async function exaSearch(params: ExaSearchParams): Promise<{ results: ExaSearchResult[] } | { error: string }> {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) return { error: 'Niche supplier search is not configured (missing EXA_API_KEY).' }

  let res: Response
  try {
    res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: params.query,
        type: params.type ?? 'auto',
        numResults: params.numResults ?? 15,
        ...(params.includeDomains ? { includeDomains: params.includeDomains } : {}),
        ...(params.excludeDomains ? { excludeDomains: params.excludeDomains } : {}),
        contents: { highlights: true },
      }),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Exa search failed' }
  }

  if (!res.ok) return { error: `Exa search failed (status ${res.status})` }

  const data = await res.json() as {
    results?: { url: string; title?: string | null; publishedDate?: string | null; highlights?: string[] }[]
  }

  return {
    results: (data.results ?? []).map(r => ({
      url: r.url,
      title: r.title ?? null,
      publishedDate: r.publishedDate ?? null,
      highlights: r.highlights ?? [],
    })),
  }
}
