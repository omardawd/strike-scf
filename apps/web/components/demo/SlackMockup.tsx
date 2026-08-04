'use client'

// A hand-built, static preview of what a future Slack conversation with
// Strike AI could look like. This is the ONE deliberate exception to "every
// scene renders the real platform" in this feature — it is not a real Slack
// integration (none exists in this codebase) and must never read as one, so
// the "Coming soon" mark is baked into the mockup itself, not left to
// narration alone.
export function SlackMockup({ onSkip }: { onSkip: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9997,
        background: '#1A1D29',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          background: '#FFFFFF',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-elevated)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 18px', background: '#350D36', color: '#FFFFFF',
          }}
        >
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--gradient-ai, linear-gradient(135deg,#1428CC,#7C3AED))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>S</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>#strike-ai</div>
          <div
            style={{
              marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase', padding: '3px 9px', borderRadius: 999,
              background: 'rgba(255,255,255,0.15)', color: '#FFFFFF',
            }}
          >
            Coming soon
          </div>
        </div>
        <div style={{ padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#E8E8E8', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1D1C1D' }}>Jordan Blake <span style={{ fontWeight: 400, color: '#8A8A8A', marginLeft: 6 }}>9:41 AM</span></div>
              <div style={{ fontSize: 14, color: '#1D1C1D', marginTop: 2 }}>@strike find more steel suppliers for the Q4 restock</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--gradient-ai, linear-gradient(135deg,#1428CC,#7C3AED))', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1D1C1D' }}>Strike AI <span style={{ fontWeight: 400, color: '#8A8A8A', marginLeft: 6 }}>9:41 AM</span></div>
              <div style={{ fontSize: 14, color: '#1D1C1D', marginTop: 2, lineHeight: 1.5 }}>
                Found 3 matching suppliers with strong PassportScores — want me to open negotiations?
              </div>
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        style={{
          position: 'fixed', bottom: 24, background: 'none', border: 'none',
          color: 'rgba(255,255,255,0.45)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        Skip demo
      </button>
    </div>
  )
}
