export default function Loading() {
  return (
    <div className="main-content">
      <div className="page" style={{ maxWidth: 1280 }}>
        <div className="split-panel">
          <div className="split-panel-main">
            <div className="card" style={{ height: 240, animation: 'skeleton-pulse 1.8s ease infinite' }} />
            <div className="card" style={{ height: 200, marginTop: 16, animation: 'skeleton-pulse 1.8s ease infinite' }} />
          </div>
          <div className="split-panel-aside">
            <div className="card" style={{ height: 280, animation: 'skeleton-pulse 1.8s ease infinite' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
