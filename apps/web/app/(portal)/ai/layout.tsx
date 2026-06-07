export default function AILayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flex: 1, height: '100vh', overflow: 'hidden' }}>
      {children}
    </div>
  )
}
