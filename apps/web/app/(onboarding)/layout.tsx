'use client'

import Image from 'next/image'
import { WizardContext, WIZARD_STEPS, TOTAL_STEPS } from './wizard-context'
import { useState } from 'react'

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5L6.5 11.5L12.5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState(1)

  return (
    <WizardContext.Provider value={{ step, setStep }}>
      <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '260px 1fr', fontFamily: 'var(--font-body)' }}>
        {/* ── Left rail: dark journey sidebar ── */}
        <aside style={{
          background: 'var(--ink)',
          display: 'flex',
          flexDirection: 'column',
          padding: '32px 24px 28px',
          position: 'sticky',
          top: 0,
          height: '100vh',
          width: 260,
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          {/* Logo */}
          <div style={{ marginBottom: 48 }}>
            <Image
              src="/strike_white_nobg.png"
              alt="Strike SCF"
              width={120}
              height={38}
              style={{ objectFit: 'contain', objectPosition: 'left center', maxWidth: '100%', height: 'auto' }}
              priority
            />
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 10, fontWeight: 600,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.4)', marginBottom: 6,
            }}>
              Getting started
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: '#fff', lineHeight: 1.35 }}>
              Activate your Passport
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginTop: 6, lineHeight: 1.55 }}>
              Complete verification to unlock the full platform.
            </div>
          </div>

          {/* Step tracker */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {WIZARD_STEPS.map((label, i) => {
              const n = i + 1
              const isDone    = n < step
              const isCurrent = n === step
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, position: 'relative', paddingBottom: n < TOTAL_STEPS ? 24 : 0 }}>
                  {/* Connector line */}
                  {n < TOTAL_STEPS && (
                    <div style={{
                      position: 'absolute',
                      left: 12, top: 28,
                      width: 2,
                      bottom: 0,
                      background: isDone ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.1)',
                    }} />
                  )}

                  {/* Circle */}
                  <div style={{
                    width: 26, height: 26,
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 12, fontWeight: 600,
                    background: isDone ? '#10B981' : isCurrent ? '#fff' : 'transparent',
                    border: isDone ? '2px solid #10B981' : isCurrent ? '2px solid #fff' : '1.5px solid rgba(255,255,255,0.22)',
                    color: isDone ? '#fff' : isCurrent ? 'var(--ink)' : 'rgba(255,255,255,0.38)',
                    zIndex: 1,
                    transition: 'all 0.2s ease',
                  }}>
                    {isDone ? <CheckIcon /> : n}
                  </div>

                  {/* Label */}
                  <div style={{
                    paddingTop: 3,
                    fontSize: 13,
                    fontWeight: isCurrent ? 600 : 400,
                    color: isDone ? 'rgba(255,255,255,0.65)' : isCurrent ? '#fff' : 'rgba(255,255,255,0.38)',
                    lineHeight: 1.35,
                    transition: 'color 0.2s ease',
                  }}>
                    {label}
                    {isCurrent && (
                      <div style={{
                        fontSize: 10.5, fontWeight: 400,
                        color: 'rgba(255,255,255,0.45)',
                        marginTop: 2,
                      }}>
                        Current step
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer note */}
          <div style={{
            marginTop: 'auto',
            paddingTop: 28,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M8 2l4.5 1.65v3.5C12.5 10.2 10.5 12.5 8 13.75 5.5 12.5 3.5 10.2 3.5 7.15V3.65L8 2z" stroke="rgba(255,255,255,0.3)" strokeWidth="1.3" fill="none"/>
            </svg>
            <div style={{ fontSize: 11, lineHeight: 1.55, color: 'rgba(255,255,255,0.3)' }}>
              Your data is encrypted and never shared without your consent.
            </div>
          </div>
        </aside>

        {/* ── Right: step content ── */}
        <main style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '36px 52px 52px',
          minHeight: '100vh',
          background: 'var(--offwhite)',
        }}>
          <div style={{ width: '100%', maxWidth: 920 }}>
            {children}
          </div>
        </main>
      </div>
    </WizardContext.Provider>
  )
}
