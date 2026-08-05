'use client'

import { useEffect, useRef } from 'react'
import { speak } from './demo-speech'

// Captions always render immediately from `line`, independent of audio.
// `audioSrc` is optional — when a real recorded narration clip exists for
// this beat, it plays alongside the caption. Without one, `line` is spoken
// aloud via the free Web Speech API instead — no account, no generated
// files, works today.
export function DemoNarrator({ line, audioSrc, onSkip }: { line: string; audioSrc?: string; onSkip: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!audioSrc) return
    const audio = new Audio(audioSrc)
    audioRef.current = audio
    audio.play().catch(() => {}) // ignored — autoplay may still be blocked pre-gesture; captions carry the beat regardless
    return () => { audio.pause() }
  }, [audioSrc])

  useEffect(() => {
    if (audioSrc || !line) return
    speak(line)
    // No cleanup cancel here — DemoConductor cancels on beat change/finish
    // itself, and cancelling on every dependency change would cut a line
    // off mid-sentence the instant its own re-render fires.
  }, [line, audioSrc])

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
