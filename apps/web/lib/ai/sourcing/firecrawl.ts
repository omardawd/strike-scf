// Deep page extraction for the shortlisted-candidate pass — renders JS (most
// modern supplier/catalog sites are React/Next, a plain fetch gets an empty
// shell), converts to clean markdown, and can read PDF spec/price sheets
// directly. Using a managed scraper here also means we never make a raw
// server-side fetch() to an attacker-influenced URL ourselves — Firecrawl
// owns that surface, including stripping scripts on the way in.

export interface FirecrawlScrapeResult {
  url: string
  markdown: string
  title: string | null
}

export async function firecrawlScrape(
  url: string,
  opts?: { timeoutMs?: number; maxCharacters?: number }
): Promise<FirecrawlScrapeResult | { error: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return { error: 'Deep page extraction is not configured (missing FIRECRAWL_API_KEY).' }

  const timeoutMs = opts?.timeoutMs ?? 12_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: timeoutMs,
      }),
      signal: controller.signal,
    })

    if (!res.ok) return { error: `Page extraction failed (status ${res.status})` }

    const data = await res.json() as {
      success?: boolean
      data?: { markdown?: string; metadata?: { title?: string } }
    }
    if (!data.success || !data.data?.markdown) return { error: 'No extractable content found on this page' }

    return {
      url,
      markdown: data.data.markdown.slice(0, opts?.maxCharacters ?? 15_000),
      title: data.data.metadata?.title ?? null,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Page extraction failed' }
  } finally {
    clearTimeout(timer)
  }
}
