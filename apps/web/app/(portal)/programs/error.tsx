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
    <div className="main-content">
      <div className="page">
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-head">
            <span>Something went wrong</span>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>
              An error occurred loading this page. Please try again.
            </p>
            <button className="btn btn-primary btn-sm" onClick={reset}>
              Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
