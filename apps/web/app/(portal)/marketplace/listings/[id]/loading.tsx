export default function Loading() {
  return (
    <div className="main-content">
      <div className="page mp-page">
        <div className="split-panel">
          <div className="split-panel-main">
            <div className="mp-skeleton-card" style={{ height: 320 }} />
            <div className="mp-skeleton-card" style={{ height: 200, marginTop: 16 }} />
          </div>
          <aside className="split-panel-aside">
            <div className="mp-skeleton-card" style={{ height: 280 }} />
          </aside>
        </div>
      </div>
    </div>
  )
}
