export default function DashboardLoading() {
  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ width: 160, height: 12, background: 'var(--border)', marginBottom: 10, animation: 'skeleton-pulse 1.8s ease infinite' }} />
        <div style={{ width: 280, height: 28, background: 'var(--border)', marginBottom: 8, animation: 'skeleton-pulse 1.8s ease infinite' }} />
        <div style={{ width: 220, height: 14, background: 'var(--border)', animation: 'skeleton-pulse 1.8s ease infinite' }} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1, height: 64, background: 'var(--white)', border: '1px solid var(--border)', animation: 'skeleton-pulse 1.8s ease infinite' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: 88, background: 'var(--white)', border: '1px solid var(--border)', animation: 'skeleton-pulse 1.8s ease infinite' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '65fr 35fr', gap: 20 }}>
        <div style={{ height: 320, background: 'var(--white)', border: '1px solid var(--border)', animation: 'skeleton-pulse 1.8s ease infinite' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ height: 160, background: 'var(--white)', border: '1px solid var(--border)', animation: 'skeleton-pulse 1.8s ease infinite' }} />
          <div style={{ height: 120, background: 'var(--white)', border: '1px solid var(--border)', animation: 'skeleton-pulse 1.8s ease infinite' }} />
        </div>
      </div>
    </div>
  )
}
