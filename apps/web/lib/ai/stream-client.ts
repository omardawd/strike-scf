export type AiStreamHandlers = {
  onText: (text: string) => void
  onToolStart?: (name: string) => void
  onDone?: () => void
  onError?: (message: string) => void
}

export async function parseAiChatStream(response: Response, handlers: AiStreamHandlers) {
  if (!response.ok || !response.body) {
    let message = 'Strike AI is temporarily unavailable.'
    try {
      const data = await response.json()
      if (typeof data.error === 'string') message = data.error
    } catch { /* keep fallback */ }
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  const consume = (frame: string) => {
    let eventName = 'message'
    let data = '{}'
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      if (line.startsWith('data:')) data = line.slice(5).trim()
    }
    const payload = JSON.parse(data) as { text?: string; name?: string; message?: string }
    if (eventName === 'text' && payload.text) handlers.onText(payload.text)
    else if (eventName === 'tool_start' && payload.name) handlers.onToolStart?.(payload.name)
    else if (eventName === 'done') { completed = true; handlers.onDone?.() }
    else if (eventName === 'error') {
      handlers.onError?.(payload.message ?? 'Strike AI is temporarily unavailable.')
      throw new Error(payload.message ?? 'Strike AI is temporarily unavailable.')
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''
    for (const frame of frames) if (frame.trim()) consume(frame)
    if (done) break
  }
  if (buffer.trim()) consume(buffer)
  if (!completed) handlers.onDone?.()
}
