export async function handleSearchWeb(input: Record<string, unknown>) {
  const { query, topic = 'general', max_results = 5 } = input as {
    query: string
    topic?: string
    max_results?: number
  }

  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return { error: 'Web search is not configured (missing TAVILY_API_KEY).' }

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      topic,
      search_depth: 'basic',
      include_answer: true,
      max_results,
    }),
  })

  if (!res.ok) return { error: `Web search failed (status ${res.status})` }

  const data = await res.json() as {
    answer?: string
    results?: { title: string; url: string; content: string; published_date?: string }[]
  }

  return {
    answer: data.answer ?? null,
    results: (data.results ?? []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 500),
      published_date: r.published_date ?? null,
    })),
  }
}
