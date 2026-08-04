'use client'

import { useEffect, useRef } from 'react'

// Captions always render immediately from `line`, independent of audio.
// `audioSrc` is optional — when a real narration clip exists for this beat
// (Phase 3), it plays alongside the caption; until then this is a silent
// no-op and pacing is governed entirely by the caller's hold duration.
export function DemoNarrator({ line, audioSrc, onSkip }: { line: string; audioSrc?: string; onSkip: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!audioSrc) return
    const audio = new Audio(audioSrc)
    audioRef.current = audio
    audio.play().catch(() => {}) // ignored — autoplay may still be blocked pre-gesture; captions carry the beat regardless
    return () => { audio.pause() }
  }, [audioSrc])

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
