export default function Loading() {
  return (
    <div className="main-content">
      <div className="page" style={{ maxWidth: 680 }}>
        <div className="card" style={{ height: 400, animation: 'skeleton-pulse 1.8s ease infinite' }} />
      </div>
    </div>
  )
}
