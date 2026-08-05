'use client'

// Captions always render immediately from `line`, independent of audio.
// Narration itself (recorded clip or Web Speech fallback) is driven
// centrally by DemoConductor's own sequence, not from here — it needs to be
// awaited against the beat's hold timer so a scene never advances before
// its narration finishes (see demo-speech.ts's narrate()/speak() doc
// comments).
export function DemoNarrator({ line, onSkip }: { line: string; onSkip: () => void }) {
  if (!line) return null
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 32,
        transform: 'translateX(-50%)',
        maxWidth: 560,
        width: 'calc(100% - 48px)',
        background: 'var(--ink)',
        color: 'var(--white)',
        borderRadius: 'var(--radius-card)',
        padding: '16px 22px',
        fontSize: 15,
        lineHeight: 1.5,
        textAlign: 'center',
        boxShadow: 'var(--shadow-elevated)',
        zIndex: 10000,
      }}
    >
      {line}
      <button
        type="button"
        onClick={onSkip}
        style={{
          display: 'block',
          margin: '10px auto 0',
          background: 'none',
          border: 'none',
          color: 'var(--gray-soft)',
          fontSize: 12,
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        Skip demo
      </button>
    </div>
  )
}
