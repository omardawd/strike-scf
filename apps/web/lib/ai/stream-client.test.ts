import { describe, expect, it, vi } from 'vitest'
import { parseAiChatStream } from './stream-client'
import { streamAnthropicMessage } from './anthropic-stream'

describe('AI streaming', () => {
  it('parses the compact browser SSE protocol incrementally', async () => {
    const text: string[] = []
    const tools: string[] = []
    let done = false
    const response = new Response([
      'event: text\ndata: {"text":"Hel"}\n\n',
      'event: tool_start\ndata: {"name":"get_active_deals"}\n\n',
      'event: text\ndata: {"text":"lo"}\n\n',
      'event: done\ndata: {}\n\n',
    ].join(''), { status: 200 })

    await parseAiChatStream(response, {
      onText: delta => text.push(delta),
      onToolStart: name => tools.push(name),
      onDone: () => { done = true },
    })

    expect(text.join('')).toBe('Hello')
    expect(tools).toEqual(['get_active_deals'])
    expect(done).toBe(true)
  })

  it('parses Anthropic text and tool input deltas', async () => {
    const frames = [
      { type: 'message_start', message: { usage: { input_tokens: 12 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup_entities' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"all"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ].map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(frames, { status: 200 })))

    const events = []
    for await (const event of streamAnthropicMessage({ model: 'test' })) events.push(event)

    expect(events).toContainEqual({ type: 'message_start', inputTokens: 12 })
    expect(events).toContainEqual({ type: 'text_delta', index: 0, text: 'Hi' })
    expect(events).toContainEqual({ type: 'tool_use_delta', index: 1, partialJson: '{"query":"all"}' })
    expect(events).toContainEqual({ type: 'message_delta', stopReason: 'tool_use', outputTokens: 9 })
    vi.unstubAllGlobals()
  })
})
