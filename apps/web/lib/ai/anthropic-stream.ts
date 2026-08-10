export type AnthropicStreamEvent =
  | { type: 'message_start'; inputTokens: number }
  | { type: 'text_delta'; index: number; text: string }
  | { type: 'tool_use_start'; index: number; id: string; name: string }
  | { type: 'tool_use_delta'; index: number; partialJson: string }
  | { type: 'block_stop'; index: number }
  | { type: 'message_delta'; stopReason: string | null; outputTokens: number }
  | { type: 'message_stop' }

export class AnthropicStreamError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
  }
}

export async function* streamAnthropicMessage(
  body: Record<string, unknown>
): AsyncGenerator<AnthropicStreamEvent> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
    },
    body: JSON.stringify({ ...body, stream: true }),
  })

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new AnthropicStreamError(detail || 'AI service error', response.status || 502)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const parseFrame = (frame: string): AnthropicStreamEvent | null => {
    const dataLine = frame.split(/\r?\n/).find(line => line.startsWith('data:'))
    if (!dataLine) return null
    const raw = dataLine.slice(5).trim()
    if (!raw || raw === '[DONE]') return null

    const event = JSON.parse(raw) as {
      type?: string
      index?: number
      message?: { usage?: { input_tokens?: number } }
      content_block?: { type?: string; id?: string; name?: string }
      delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string | null }
      usage?: { output_tokens?: number }
    }
    if (event.type === 'message_start') {
      return { type: 'message_start', inputTokens: event.message?.usage?.input_tokens ?? 0 }
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      return {
        type: 'tool_use_start',
        index: event.index ?? 0,
        id: event.content_block.id ?? '',
        name: event.content_block.name ?? '',
      }
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return { type: 'text_delta', index: event.index ?? 0, text: event.delta.text ?? '' }
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      return { type: 'tool_use_delta', index: event.index ?? 0, partialJson: event.delta.partial_json ?? '' }
    }
    if (event.type === 'content_block_stop') return { type: 'block_stop', index: event.index ?? 0 }
    if (event.type === 'message_delta') {
      return {
        type: 'message_delta',
        stopReason: event.delta?.stop_reason ?? null,
        outputTokens: event.usage?.output_tokens ?? 0,
      }
    }
    if (event.type === 'message_stop') return { type: 'message_stop' }
    return null
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const parsed = parseFrame(frame)
      if (parsed) yield parsed
    }
    if (done) break
  }

  if (buffer.trim()) {
    const parsed = parseFrame(buffer)
    if (parsed) yield parsed
  }
}
