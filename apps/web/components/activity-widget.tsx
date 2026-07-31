'use client'
// Global bottom-right activity surface — mounted once in portal-shell.tsx so
// it's available on every portal page. Two independent layers:
//  1. Ephemeral success toasts (emitToast() in lib/toast-bus.ts) — "Listing
//     uploaded", "Financing set", etc. Auto-dismiss, click-through to the
//     relevant page, and — critically — let a user fire an action then
//     immediately go do something else without babysitting a spinner.
//  2. A persistent "Negotiation pending" chip per active agent_negotiations
//     row for this org, polled on an interval, linking straight into the
//     Strike Room where the negotiation is actually happening.
import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { useT } from '@/lib/i18n/locale-context'
import { onToast, type ToastPayload } from '@/lib/toast-bus'

interface Toast extends ToastPayload {
  id: string
}

interface NegotiationRow {
  id: string
  status: string
  current_round: number | null
  listing_title: string | null
  room_id: string | null
  deal_id: string | null
  updated_at: string
}

const POLL_MS = 25_000
const TOAST_LIFETIME_MS = 6_000

function SuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--color-green)" opacity="0.14" />
      <path d="M6 10.2l2.4 2.4L14.2 7" stroke="var(--color-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function ActivityWidget() {
  const router = useRouter()
  const t = useT()
  const portal = usePortal()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [negotiations, setNegotiations] = useState<NegotiationRow[]>([])
  const [dismissedNegotiations, setDismissedNegotiations] = useState<Set<string>>(new Set())

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(tt => tt.id !== id))
  }, [])

  useEffect(() => {
    return onToast(payload => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setToasts(prev => [...prev, { ...payload, id }])
      setTimeout(() => dismissToast(id), TOAST_LIFETIME_MS)
    })
  }, [dismissToast])

  // Negotiations are only ever org-scoped (anchor/supplier), never bank/admin.
  useEffect(() => {
    if (portal === 'bank' || portal === 'admin') return
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('/api/agents/active-negotiations')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setNegotiations(data.negotiations ?? [])
      } catch { /* silent — this is a passive background indicator */ }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [portal])

  const visibleNegotiations = negotiations.filter(n => !dismissedNegotiations.has(n.id))

  if (toasts.length === 0 && visibleNegotiations.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 300,
        display: 'flex', flexDirection: 'column-reverse', gap: 10,
        maxWidth: 340, pointerEvents: 'none',
      }}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="reveal"
          role="status"
          style={{
            pointerEvents: 'auto', display: 'flex', alignItems: 'flex-start', gap: 10,
            background: 'var(--white)', border: '1px solid var(--border)',
            borderLeft: `3px solid ${toast.tone === 'info' ? 'var(--blue)' : 'var(--color-green)'}`,
            borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-elevated)',
            padding: '12px 14px', cursor: toast.href ? 'pointer' : 'default',
          }}
          onClick={() => { if (toast.href) { router.push(toast.href); dismissToast(toast.id) } }}
        >
          <span style={{ flexShrink: 0, marginTop: 1 }}><SuccessIcon /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
              {toast.title}
            </div>
            {toast.detail && (
              <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 2, lineHeight: 1.4 }}>
                {toast.detail}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={e => { e.stopPropagation(); dismissToast(toast.id) }}
            style={{
              flexShrink: 0, width: 20, height: 20, borderRadius: '50%', border: 'none',
              background: 'transparent', color: 'var(--gray-soft)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
            }}
          >
            <CloseIcon />
          </button>
        </div>
      ))}

      {visibleNegotiations.map(neg => {
        const awaitingYou = neg.status === 'awaiting_finalization'
        return (
          <button
            key={neg.id}
            type="button"
            className="ai-sheen"
            onClick={() => { if (neg.room_id) router.push(`/rooms/${neg.room_id}`) }}
            style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--white)', border: '1px solid var(--border)',
              borderRadius: 999, boxShadow: 'var(--shadow-elevated)',
              padding: '10px 14px 10px 12px', cursor: neg.room_id ? 'pointer' : 'default',
              textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span
              className={awaitingYou ? '' : 'ai-breathe'}
              style={{
                flexShrink: 0, width: 8, height: 8, borderRadius: '50%',
                background: awaitingYou ? 'var(--color-amber)' : 'var(--gradient-ai)',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                {awaitingYou ? t('activityWidget.negotiationAwaitingYou') : t('activityWidget.negotiationPending')}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {neg.listing_title ?? ''}
                {neg.current_round != null ? ` · ${t('activityWidget.negotiationRound', { n: neg.current_round })}` : ''}
              </div>
            </div>
            <span
              role="button"
              aria-label="Dismiss"
              onClick={e => { e.stopPropagation(); setDismissedNegotiations(prev => new Set(prev).add(neg.id)) }}
              style={{
                flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                color: 'var(--gray-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <CloseIcon />
            </span>
          </button>
        )
      })}
    </div>
  )
}
