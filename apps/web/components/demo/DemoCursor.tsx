'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { sleep } from './demo-utils'

export interface DemoCursorHandle {
  show: () => void
  hide: () => void
  /** Animates to the center of `el` (viewport coordinates) and waits for the
   *  move to finish. Distance-scaled duration so a short hop feels snappier
   *  than crossing the whole screen. */
  moveToElement: (el: Element) => Promise<void>
  /** Visual press ripple only — does not click anything itself, so the caller
   *  can time the real `el.click()` precisely against the animation. */
  press: () => Promise<void>
}

const SIZE = 30

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

// A single on-screen pointer the demo tour moves to and "presses" on real
// interactive elements before actually clicking them — the tour navigates the
// same way a viewer would (click the sidebar link, click the room in the
// list, click the deal card), rather than teleporting between routes, so this
// is the visual proof of that click actually happening.
export const DemoCursor = forwardRef<DemoCursorHandle>((_props, ref) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [pressed, setPressed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [duration, setDuration] = useState(600)
  const posRef = useRef<{ x: number; y: number } | null>(null)

  useImperativeHandle(ref, () => ({
    show: () => setVisible(true),
    hide: () => setVisible(false),
    moveToElement: async (el: Element) => {
      const r = el.getBoundingClientRect()
      const target = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      const from = posRef.current ?? { x: window.innerWidth / 2, y: window.innerHeight - 80 }
      const dist = Math.hypot(target.x - from.x, target.y - from.y)
      const dur = clamp(Math.round(dist * 0.7), 380, 1000)

      if (!posRef.current) {
        // First appearance this beat — snap in near the start point with no
        // travel animation, so the very first move still visibly glides in.
        posRef.current = from
        setDuration(0)
        setPos({ ...from })
        setVisible(true)
        await sleep(60)
      }

      setDuration(dur)
      posRef.current = target
      setPos({ ...target })
      await sleep(dur + 40)
    },
    press: async () => {
      setPressed(true)
      await sleep(160)
      setPressed(false)
      await sleep(140)
    },
  }), [])

  if (!visible || !pos) return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', left: 0, top: 0, zIndex: 10002, pointerEvents: 'none',
        transform: `translate3d(${pos.x - 4}px, ${pos.y - 3}px, 0) scale(${pressed ? 0.82 : 1})`,
        transition: `transform ${duration}ms cubic-bezier(.2,.8,.2,1)`,
      }}
    >
      <style>{`
        @keyframes demo-cursor-ripple {
          from { transform: scale(0.4); opacity: 0.55; }
          to   { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
      {pressed && (
        <span
          style={{
            position: 'absolute', left: -SIZE * 0.55, top: -SIZE * 0.45,
            width: SIZE * 1.4, height: SIZE * 1.4, borderRadius: '50%',
            background: 'var(--blue)', animation: 'demo-cursor-ripple 420ms ease-out',
          }}
        />
      )}
      <svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 3px 8px rgba(13,13,13,0.35))' }}>
        <path
          d="M4 2.5 L4 18.5 L8.2 14.8 L10.7 20.5 L13.2 19.4 L10.8 13.7 L16.3 13.2 Z"
          fill="var(--ink)"
          stroke="var(--white)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
})
DemoCursor.displayName = 'DemoCursor'
