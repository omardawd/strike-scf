export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div style={{ height: 48, background: 'var(--white)', borderBottom: '1px solid var(--border)', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--gray)', fontSize: 13, opacity: 0.5 }}>Loading room…</span>
      </div>
    </div>
  )
}
