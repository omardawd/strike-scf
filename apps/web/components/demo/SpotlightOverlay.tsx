'use client'

import { useEffect, useState } from 'react'

interface Rect { top: number; left: number; width: number; height: number }

// Dims the whole viewport except a glowing cutout around the current
// `data-demo-target` element — the standard onboarding-tour spotlight.
//
// The rect is tracked every frame (cheap, short-lived) so it stays correct
// through scroll/resize, and is deliberately reset to null whenever
// `targetSelector` changes: this component is NOT remounted between beats, so
// without that reset the previous beat's rect stays on screen while the new
// page/element is still mounting — which is exactly the "spotlight is on the
// wrong thing" symptom, since `document.querySelector` returning null used to
// leave the last-known rect in place indefinitely rather than clearing it.
export function SpotlightOverlay({ targetSelector }: { targetSelector: string }) {
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    // New target — drop the old rect immediately rather than letting it linger
    // over an element this beat isn't talking about.
    setRect(null)

    let cancelled = false
    let raf = 0
    let scrolled = false

    function update() {
      if (cancelled) return
      const el = document.querySelector(`[data-demo-target="${targetSelector}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        // A mounted-but-not-yet-laid-out element measures 0x0; spotlighting
        // that would flash a tiny dot in the corner before it settles.
        if (r.width > 0 && r.height > 0) {
          if (!scrolled) {
            scrolled = true
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
        }
      } else {
        // Target genuinely gone (route changed, element unmounted) — hide
        // rather than keep highlighting whatever used to be there.
        setRect(null)
      }
      raf = requestAnimationFrame(update)
    }
    update()
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [targetSelector])

  if (!rect) return null

  const pad = 10

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        borderRadius: 16,
        boxShadow:
          '0 0 0 9999px rgba(13,13,13,0.55), 0 0 0 3px var(--blue), 0 0 32px 6px rgba(20,40,204,0.35)',
        pointerEvents: 'none',
        zIndex: 9996,
        transition: 'top 450ms ease-out, left 450ms ease-out, width 450ms ease-out, height 450ms ease-out',
      }}
    />
  )
}
