'use client'

import { useState } from 'react'
import { WizardContext, WIZARD_STEPS, TOTAL_STEPS } from './wizard-context'

function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 8 L7 11 L12 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState(1)

  return (
    <WizardContext.Provider value={{ step, setStep }}>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          gridTemplateColumns: '300px 1fr',
          background: 'var(--color-bg)',
          fontFamily: 'var(--font-body)',
        }}
      >
        {/* ── Left rail: brand + step tracker ─────────────────── */}
        <aside
          style={{
            background: 'var(--color-card)',
            borderRight: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            padding: '28px 24px',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
            <div
              style={{
                width: 30,
                height: 30,
                background: 'var(--blue)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 15,
                fontFamily: 'var(--font-display)',
              }}
            >
              S
            </div>
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: 'var(--color-ink-1)',
              }}
            >
              Strike SCF
            </span>
          </div>

          <div className="stepper" style={{ padding: 0 }}>
            {WIZARD_STEPS.map((label, i) => {
              const n = i + 1
              const stateClass = n < step ? 'done' : n === step ? 'current' : ''
              return (
                <div className="step" key={label}>
                  <div className={`step-circle ${stateClass}`.trim()}>
                    {n < step ? <CheckMark /> : n}
                  </div>
                  <div className="step-body">
                    <div className="step-name">{label}</div>
                  </div>
                  {n < TOTAL_STEPS && (
                    <div className={`step-line ${n < step ? 'done' : ''}`.trim()} />
                  )}
                </div>
              )
            })}
          </div>

          <div
            style={{
              marginTop: 'auto',
              paddingTop: 24,
              fontSize: 11,
              lineHeight: 1.5,
              color: 'var(--color-ink-4)',
            }}
          >
            Your data is encrypted and never shared without your consent.
          </div>
        </aside>

        {/* ── Right side: step content ────────────────────────── */}
        <main
          style={{
            overflowY: 'auto',
            display: 'flex',
            justifyContent: 'center',
            padding: '48px 40px',
          }}
        >
          <div style={{ width: '100%', maxWidth: 640 }}>{children}</div>
        </main>
      </div>
    </WizardContext.Provider>
  )
}
