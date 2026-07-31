// Tiny global pub/sub for ephemeral success toasts ("Listing uploaded",
// "Financing set", ...). Fire-and-forget from any client component via
// emitToast(); components/activity-widget.tsx (mounted once in portal-shell)
// is the sole listener that actually renders them. A plain window CustomEvent
// keeps this decoupled — no context provider needed since there's exactly one
// consumer and it's always mounted.
export interface ToastPayload {
  title: string
  detail?: string
  href?: string
  tone?: 'success' | 'info'
}

const EVENT_NAME = 'strike-toast'

export function emitToast(payload: ToastPayload): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ToastPayload>(EVENT_NAME, { detail: payload }))
}

export function onToast(handler: (payload: ToastPayload) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => handler((e as CustomEvent<ToastPayload>).detail)
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
