export default function Loading() {
  return (
    <div className="main-content">
      <div className="page">
        <div className="page-header">
          <div style={{ height: 28, width: 200, background: 'var(--border)', borderRadius: 6 }} />
          <div style={{ height: 16, width: 360, background: 'var(--border)', borderRadius: 4, marginTop: 8 }} />
        </div>
        <div className="card" style={{ marginTop: 24 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16 }}>
              <div style={{ height: 14, width: 140, background: 'var(--border)', borderRadius: 4 }} />
              <div style={{ height: 14, width: 200, background: 'var(--border)', borderRadius: 4 }} />
              <div style={{ height: 14, width: 80,  background: 'var(--border)', borderRadius: 4 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
