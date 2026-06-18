// Thin wrapper around the Anthropic Messages API.
// The codebase calls the API directly via fetch (no SDK) and always uses the
// cost-sensitive Haiku model for in-app AI. Keep that here so every caller is
// consistent and ai_usage logging stays uniform.

export const AI_MODEL = 'claude-haiku-4-5-20251001'

export interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
}

export interface CallClaudeResult {
  text: string
  usage: ClaudeUsage
  model: string
}

export async function callClaude(opts: {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  max_tokens?: number
  model?: string
}): Promise<CallClaudeResult> {
  const model = opts.model ?? AI_MODEL
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.max_tokens ?? 512,
      system: opts.system,
      messages: opts.messages,
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Anthropic error ${res.status}: ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  const text = (data?.content?.[0]?.text as string) ?? ''
  return { text, usage: data?.usage ?? {}, model }
}

// Models occasionally wrap JSON in prose or code fences. Pull the first JSON
// object out defensively so callers never crash on a stray character.
export function extractJson<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(t.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
