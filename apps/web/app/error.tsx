'use client'
import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, width: '100%', background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', fontWeight: 600 }}>
          Something went wrong
        </div>
        <div style={{ padding: '20px' }}>
          <p style={{ fontSize: 13, color: 'var(--color-ink-3)', marginBottom: 16, margin: '0 0 16px' }}>
            An error occurred loading this page. Please try again.
          </p>
          <button className="btn btn-primary btn-sm" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}
