'use client'
import { useState, useRef, useEffect } from 'react'
import { useLocale, LOCALES } from '@/lib/i18n/locale-context'

// Compact dropdown, styled to drop into either a dark auth-page header or the
// light sidebar user menu — pass `variant` to pick the right contrast.
export function LanguageSwitcher({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const { locale, setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = LOCALES.find(l => l.code === locale) ?? LOCALES[0]!

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const dark = variant === 'dark'

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 999,
          border: `1px solid ${dark ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`,
          background: dark ? 'rgba(255,255,255,0.06)' : 'var(--white)',
          color: dark ? '#fff' : 'var(--ink)',
          fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
        }}
        aria-label="Change language"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M1.5 8h13M8 1.5c2 2.2 2 10.8 0 13M8 1.5c-2 2.2-2 10.8 0 13" fill="none" />
        </svg>
        {current.nativeLabel}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: 'var(--white)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-elevated)',
          minWidth: 140, zIndex: 100, overflow: 'hidden',
        }}>
          {LOCALES.map(l => (
            <button
              key={l.code}
              type="button"
              onClick={() => { setLocale(l.code); setOpen(false) }}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 14px',
                background: l.code === locale ? 'var(--offwhite)' : 'none',
                border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--ink)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>{l.nativeLabel}</span>
              {l.code === locale && <span style={{ color: 'var(--blue)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
