'use client'

import { useState } from 'react'

// Small inline icon set for the audio-gate scene (scene 0) — stroke-based,
// matching the sidebar's NAV_ICONS convention rather than emoji.
function SpeakerIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}
// Same arrow shape DemoCursor.tsx draws for the tour's actual on-screen
// cursor — reused here (plus small radiating click ticks) so this "you'll
// see a cursor click things" icon visually matches the cursor it's
// introducing, rather than being an unrelated, hard-to-parse glyph.
function ClickIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2.5 L4 18.5 L8.2 14.8 L10.7 20.5 L13.2 19.4 L10.8 13.7 L16.3 13.2 Z" fill="currentColor" stroke="none" />
      <path d="M18.5 2.5l1.6 1.6M22 8h2.2M18.5 13.5l1.6-1.6" />
    </svg>
  )
}

function IconChip({ dark, delay, children }: { dark?: boolean; delay: number; children: React.ReactNode }) {
  return (
    <div
      className="demo-ts-chip"
      style={{
        width: 72, height: 72, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: dark ? 'rgba(255,255,255,0.08)' : 'var(--blue-light)',
        color: dark ? 'var(--white)' : 'var(--blue)',
        animationDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

export type TextSceneIconSet = 'audio'

interface TextSceneProps {
  title?: string
  /** Supporting line under the title — this is the scene's spoken dialogue, so
   *  every text beat keeps a visible caption instead of going silent after the
   *  headline lands. */
  subtitle?: string
  /** Renders the real Strike wordmark image after `title`'s words instead of
   *  spelling "Strike SCF" out in text — only the welcome beat uses this. */
  logoInTitle?: boolean
  dark?: boolean
  aiGradient?: boolean
  iconSet?: TextSceneIconSet
  requireClick?: boolean
  onReady?: () => void
  onSkip: () => void
}

// Full-screen narrated text scene — powers the audio gate, welcome title, the
// scene 5 dark "twist" beat, the scene 6 capability lines, and the closing.
// Type-led: the headline animates in word by word over a slow ambient
// background so a plain sentence still reads as a deliberate cinematic beat.
export function TextScene({ title, subtitle, logoInTitle, dark, aiGradient, iconSet, requireClick, onReady, onSkip }: TextSceneProps) {
  const [clicked, setClicked] = useState(false)

  function handleClick() {
    if (!requireClick || clicked) return
    setClicked(true)
    onReady?.()
  }

  const background = dark
    ? 'radial-gradient(120% 90% at 50% 40%, #1a1a20 0%, var(--ink) 62%)'
    : aiGradient
      ? 'radial-gradient(120% 90% at 50% 42%, #F2F1FF 0%, var(--white) 68%)'
      : 'var(--white)'

  const words = (title ?? '').split(' ')
  // Headlines in this tour range from "This is Strike." to "It sources. It
  // vets. It negotiates. It closes. It finances." — one fixed size can't serve
  // both, so step the display size down as the line gets longer rather than
  // letting a long headline overflow the viewport.
  const titleLen = (title ?? '').length
  const titleSize =
    titleLen > 46 ? 'clamp(28px, 4.4vw, 54px)'
    : titleLen > 26 ? 'clamp(34px, 5.8vw, 70px)'
    : 'clamp(40px, 7.4vw, 92px)'
  // Headline finishes landing before the supporting line arrives, so the two
  // read as one sentence delivered in sequence rather than a wall of text.
  const subtitleDelay = 260 + words.length * 85

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 9997,
        background,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 24, padding: '32px 40px', textAlign: 'center',
        cursor: requireClick && !clicked ? 'pointer' : 'default',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes demo-ts-word {
          from { opacity: 0; transform: translate3d(0, 0.5em, 0); filter: blur(6px); }
          to   { opacity: 1; transform: translate3d(0, 0, 0);     filter: blur(0); }
        }
        @keyframes demo-ts-rise {
          from { opacity: 0; transform: translate3d(0, 14px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes demo-ts-chip-in {
          from { opacity: 0; transform: scale(.82); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes demo-ts-drift1 {
          0%,100% { transform: translate3d(0,0,0) scale(1); }
          50%     { transform: translate3d(70px,34px,0) scale(1.16); }
        }
        @keyframes demo-ts-drift2 {
          0%,100% { transform: translate3d(0,0,0) scale(1); }
          50%     { transform: translate3d(-62px,40px,0) scale(1.2); }
        }
        @keyframes demo-ts-hairline {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        .demo-ts-word {
          display: inline-block; white-space: pre;
          animation: demo-ts-word 900ms cubic-bezier(.2,.8,.2,1) both;
        }
        .demo-ts-sub  { animation: demo-ts-rise 760ms cubic-bezier(.2,.8,.2,1) both; }
        .demo-ts-chip { animation: demo-ts-chip-in 700ms cubic-bezier(.2,.8,.2,1) both; }
        .demo-ts-orb  { position: absolute; border-radius: 50%; filter: blur(64px); pointer-events: none; }
        .demo-ts-hairline {
          height: 1px; width: min(360px, 42vw); transform-origin: center;
          animation: demo-ts-hairline 1100ms cubic-bezier(.2,.8,.2,1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .demo-ts-word, .demo-ts-sub, .demo-ts-chip, .demo-ts-hairline {
            animation-duration: 1ms !important; animation-delay: 0ms !important; filter: none !important;
          }
          .demo-ts-orb { animation: none !important; }
        }
      `}</style>

      {/* Ambient drift — keeps a full-bleed type slide from reading as a blank page */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <span
          className="demo-ts-orb"
          style={{
            width: 620, height: 440, left: '6%', top: '14%',
            background: dark
              ? 'radial-gradient(circle, rgba(20,40,204,.34), transparent 70%)'
              : 'radial-gradient(circle, rgba(20,40,204,.16), transparent 70%)',
            animation: 'demo-ts-drift1 24s ease-in-out infinite',
          }}
        />
        <span
          className="demo-ts-orb"
          style={{
            width: 540, height: 400, right: '8%', bottom: '12%',
            background: dark
              ? 'radial-gradient(circle, rgba(124,58,237,.30), transparent 70%)'
              : 'radial-gradient(circle, rgba(124,58,237,.15), transparent 70%)',
            animation: 'demo-ts-drift2 29s ease-in-out infinite',
          }}
        />
      </div>

      {iconSet === 'audio' && (
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 20, marginBottom: 8 }}>
          <IconChip dark={dark} delay={0}><SpeakerIcon /></IconChip>
          <IconChip dark={dark} delay={140}><ClickIcon /></IconChip>
        </div>
      )}

      {title && (
        <h1
          style={{
            position: 'relative', zIndex: 1, margin: 0,
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: titleSize,
            lineHeight: 1.06,
            letterSpacing: '-0.035em',
            maxWidth: 'min(19ch, 90vw)',
            ...(logoInTitle
              ? { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '0.05em 0.32em' }
              : {}),
            ...(aiGradient
              ? {
                  background: 'linear-gradient(102deg, var(--blue) 0%, #7C3AED 52%, var(--blue) 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }
              : { color: dark ? 'var(--white)' : 'var(--ink)' }),
          }}
        >
          {words.map((w, i) => (
            <span key={i} className="demo-ts-word" style={{ animationDelay: `${i * 85}ms` }}>
              {w}{!logoInTitle && i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
          {logoInTitle && (
            // /logo-wordmark.png is a tightly-cropped version of the shared
            // /logo.png asset — the original has a huge transparent margin
            // around the mark (its own bounding box is only ~⅓ of the canvas
            // height), so sizing by height against the untrimmed file rendered
            // the wordmark visibly smaller than the "Welcome to"/"This is"
            // text next to it no matter how large the height clamp went.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/logo-wordmark.png"
              alt="Strike SCF"
              className="demo-ts-word"
              style={{
                height: 'clamp(44px, 7.6vw, 96px)', width: 'auto',
                animationDelay: `${words.length * 85}ms`,
              }}
            />
          )}
        </h1>
      )}

      {title && subtitle && (
        <div
          className="demo-ts-hairline"
          aria-hidden="true"
          style={{
            position: 'relative', zIndex: 1,
            animationDelay: `${subtitleDelay - 120}ms`,
            background: dark
              ? 'linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent)'
              : 'linear-gradient(90deg, transparent, var(--border-strong), transparent)',
          }}
        />
      )}

      {subtitle && (
        <p
          className="demo-ts-sub"
          style={{
            position: 'relative', zIndex: 1, margin: 0,
            animationDelay: `${title ? subtitleDelay : 120}ms`,
            fontSize: title ? 'clamp(16px, 1.9vw, 22px)' : 'clamp(18px, 2.4vw, 27px)',
            lineHeight: 1.55,
            fontWeight: title ? 400 : 500,
            maxWidth: 620,
            color: dark ? 'rgba(255,255,255,0.72)' : 'var(--gray)',
          }}
        >
          {subtitle}
        </p>
      )}

      {requireClick && !clicked && (
        <div
          className="demo-ts-sub"
          style={{
            position: 'relative', zIndex: 1,
            animationDelay: '900ms',
            fontSize: 13.5, letterSpacing: '.02em',
            color: dark ? 'rgba(255,255,255,0.5)' : 'var(--gray-soft)',
          }}
        >
          Click anywhere to begin
        </div>
      )}

      <button
        type="button"
        onClick={e => { e.stopPropagation(); onSkip() }}
        style={{
          position: 'fixed', bottom: 24, zIndex: 2, background: 'none', border: 'none',
          color: dark ? 'rgba(255,255,255,0.4)' : 'var(--gray-soft)',
          fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        Skip demo
      </button>
    </div>
  )
}
