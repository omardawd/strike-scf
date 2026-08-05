'use client'

import { useEffect, useState } from 'react'

interface Rect { top: number; left: number; width: number; height: number }

// Finds the `<strong>` (rendered markdown bold run) inside `container` whose
// own text matches `headingText` — used to locate one of a real AI reply's
// **Bold Section Headers** in the rendered chat bubble, so a specific part of
// a long reply can be spotlighted instead of the whole thing. Matches on
// prefix in either direction since the raw heading text (from the parsed
// reply) and the rendered text should be identical but this is cheap
// insurance against incidental whitespace/punctuation drift.
function findHeadingElement(container: Element, headingText: string): HTMLElement | null {
  const needle = headingText.trim()
  if (!needle) return null
  const strongs = container.querySelectorAll('strong')
  for (const el of Array.from(strongs)) {
    const text = (el.textContent ?? '').trim()
    if (text && (text === needle || text.startsWith(needle) || needle.startsWith(text))) {
      return el as HTMLElement
    }
  }
  return null
}

// Dims the whole viewport except a glowing cutout around either the current
// `data-demo-target` element (the standard onboarding-tour spotlight) or, when
// `sectionHeading` is given, a specific sub-region WITHIN that element — the
// vertical span from that heading down to the next section's heading (or the
// element's own bottom edge, if this is the last section). Used for Scene 6's
// plan walkthrough: the real AI reply is one long chat bubble, and reading the
// whole thing highlighted uniformly for every point being narrated doesn't
// tell the viewer WHERE on the page that point is — this lets each narrated
// point highlight just its own part of the real, rendered plan.
//
// The rect is tracked every frame (cheap, short-lived) so it stays correct
// through scroll/resize, and is deliberately reset to null whenever the
// target changes: this component is NOT remounted between beats, so without
// that reset the previous beat's (or previous section's) rect stays on screen
// while the new one is still mounting/rendering — which is exactly the
// "spotlight is on the wrong thing" symptom, since a lookup miss used to leave
// the last-known rect in place indefinitely rather than clearing it.
export function SpotlightOverlay({
  targetSelector,
  sectionHeading,
  nextSectionHeading,
}: {
  targetSelector: string
  sectionHeading?: string
  nextSectionHeading?: string
}) {
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    // New target/section — drop the old rect immediately rather than letting
    // it linger over content this beat isn't talking about anymore.
    setRect(null)

    let cancelled = false
    let raf = 0
    let scrolled = false

    function update() {
      if (cancelled) return
      const el = document.querySelector(`[data-demo-target="${targetSelector}"]`)
      if (!el) {
        // Target genuinely gone (route changed, element unmounted) — hide
        // rather than keep highlighting whatever used to be there.
        setRect(null)
        raf = requestAnimationFrame(update)
        return
      }

      if (sectionHeading) {
        const startEl = findHeadingElement(el, sectionHeading)
        if (startEl) {
          const startRect = startEl.getBoundingClientRect()
          const containerRect = el.getBoundingClientRect()
          const endEl = nextSectionHeading ? findHeadingElement(el, nextSectionHeading) : null
          const endRect = endEl?.getBoundingClientRect()
          const top = startRect.top
          const bottom = endRect && endRect.top > top ? endRect.top : containerRect.bottom
          if (bottom - top > 4) {
            if (!scrolled) {
              scrolled = true
              startEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            setRect({ top, left: containerRect.left, width: containerRect.width, height: bottom - top })
          }
          // If not found yet (still rendering this frame), keep the previous
          // rect rather than collapsing to nothing for a frame.
        }
        raf = requestAnimationFrame(update)
        return
      }

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
      raf = requestAnimationFrame(update)
    }
    update()
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [targetSelector, sectionHeading, nextSectionHeading])

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
