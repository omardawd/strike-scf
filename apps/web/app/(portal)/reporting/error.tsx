'use client'
import { useRouter } from 'next/navigation'

export default function ReportingError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter()
  return (
    <div className="main-content">
      <div className="page">
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <div className="alert-body">{error.message || 'Failed to load reporting data.'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={reset}>Try again</button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    </div>
  )
}
