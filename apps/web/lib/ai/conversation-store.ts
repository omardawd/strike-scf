// Shared Strike AI conversation persistence — localStorage-backed, used by both
// the Strike AI page and Dashboard 2's inline chat so a conversation started on
// either surface shows up identically (and continues) on the other.
export type TFn = (key: string, vars?: Record<string, string | number>) => string

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isDocument?: boolean
  attachmentName?: string // filename pill for display; full file text is embedded in content
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

export const CONVERSATIONS_KEY = 'strike-ai-conversations'
export const MAX_CONVERSATIONS = 50

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {}
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function isMessage(v: unknown): v is Message {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (o.role === 'user' || o.role === 'assistant') &&
    typeof o.content === 'string' &&
    typeof o.timestamp === 'string'
}

function isConversation(v: unknown): v is Conversation {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.updatedAt === 'string' &&
    Array.isArray(o.messages) &&
    o.messages.every(isMessage)
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConversation)
  } catch {
    return []
  }
}

export function saveConversations(convos: Conversation[]) {
  try {
    const pruned = [...convos]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_CONVERSATIONS)
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(pruned))
  } catch {}
}

export function deriveTitle(messages: Message[], t: TFn): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return t('aiPage.newConversation')
  return firstUser.content.slice(0, 40) || t('aiPage.newConversation')
}
