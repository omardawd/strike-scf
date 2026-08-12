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

export const MAX_CONVERSATIONS = 50

// Scoped per logged-in user, not a single fixed key — localStorage is shared
// across every account that ever logs into the SAME browser/device, so a
// fixed key meant one user's real conversation history (including the demo
// tour's own scripted exchange) was readable by whoever logged in next on
// that machine. `userId` is `auth.users.id` (from useUser()), never an org
// id, since a colleague on the same org sharing a browser shouldn't see it
// either — conversation history is personal to the signed-in person.
function conversationsKey(userId: string): string {
  return `strike-ai-conversations:${userId}`
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch { /* fall through to the timestamp-based id below */ }
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

export function loadConversations(userId: string): Conversation[] {
  try {
    const raw = localStorage.getItem(conversationsKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConversation)
  } catch {
    return []
  }
}

export function saveConversations(userId: string, convos: Conversation[]) {
  try {
    const pruned = [...convos]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_CONVERSATIONS)
    localStorage.setItem(conversationsKey(userId), JSON.stringify(pruned))
  } catch { /* best-effort — e.g. storage quota exceeded or unavailable */ }
}

export function deriveTitle(messages: Message[], t: TFn): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return t('aiPage.newConversation')
  return firstUser.content.slice(0, 40) || t('aiPage.newConversation')
}
