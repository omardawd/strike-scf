export default function Loading() {
  return (
    <div className="main-content">
      <div className="page">
        <div className="split-60">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card" style={{ height: 100, animation: 'skeleton-pulse 1.8s ease infinite' }} />
            <div className="card" style={{ height: 300, animation: 'skeleton-pulse 1.8s ease infinite' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ height: 200, animation: 'skeleton-pulse 1.8s ease infinite' }} />
            <div className="card" style={{ height: 120, animation: 'skeleton-pulse 1.8s ease infinite' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
