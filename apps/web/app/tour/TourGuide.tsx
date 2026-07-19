import { useEffect, useState } from 'react'
import type { TourGuide as TourGuideData } from './tour-data'

// Floating narrator card — same corner/z-index convention as the real
// components/ai-overlay.tsx (bottom: 88, right: 24) so it feels like the
// same assistant, minus any real chat/tool-call plumbing. Re-opens on every
// scene change even if the visitor dismissed the previous one, since each
// scene has something new to say.
export default function TourGuide({ guide, sceneKey }: { guide: TourGuideData; sceneKey: string }) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    setOpen(true)
  }, [sceneKey])

  return (
    <div style={{ position: 'fixed', bottom: 88, right: 24, zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
      {open && (
        <div
          style={{
            width: 300,
            maxWidth: 'calc(100vw - 48px)',
            background: 'var(--white)',
            border: '1px solid var(--blue-light, var(--border))',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-elevated, 0 8px 24px rgba(0,0,0,0.12))',
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: 'var(--blue)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width={12} height={12} viewBox="0 0 20 20" fill="#fff">
                  <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
                </svg>
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--blue)' }}>
                Strike AI
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Dismiss"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 14, lineHeight: 1, padding: 2 }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 3 }}>
            {guide.title}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--gray)', lineHeight: 1.55 }}>{guide.body}</div>
        </div>
      )}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Show Strike AI guide"
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--blue)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-elevated, 0 8px 24px rgba(0,0,0,0.15))',
          }}
        >
          <svg width={18} height={18} viewBox="0 0 20 20" fill="#fff">
            <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
          </svg>
        </button>
      )}
    </div>
  )
}
