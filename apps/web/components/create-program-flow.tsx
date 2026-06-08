'use client'
import React, { useState } from 'react'

// TC.5 — Strike AI "Create Program" mid-flow.
// Opened from the bank Strike Place when a credit officer clicks "Submit Offer"
// on a financing request whose financing type + currency has no matching program.
// Rather than erroring, Strike AI offers to create the program inline, guiding
// name → limit → rate → terms → confirm, then POSTs /api/programs (which logs the
// action to agent_actions with agent_origin='strike_ai_inline'). On success the
// caller returns the user to the offer form with the new program preselected.

const TYPE_LABELS: Record<string, string> = {
  reverse_factoring: 'Reverse Factoring',
  invoice_factoring: 'Invoice Factoring',
  po_financing:      'PO Financing',
  dynamic_discounting: 'Dynamic Discounting',
}

type Step = 'intro' | 'name' | 'limit' | 'rate' | 'terms' | 'confirm' | 'creating' | 'error'

export function CreateProgramFlow({
  seed,
  onCancel,
  onCreated,
}: {
  seed: { financingType: string; currency: string }
  onCancel: () => void
  onCreated: (program: { id: string; name: string }) => void
}) {
  const typeLabel = TYPE_LABELS[seed.financingType] ?? seed.financingType.replace(/_/g, ' ')

  const [step, setStep] = useState<Step>('intro')
  const [name, setName]   = useState(`${typeLabel} — ${seed.currency}`)
  const [limit, setLimit] = useState('')
  const [rate, setRate]   = useState('')
  const [tenor, setTenor] = useState('60')
  const [error, setError] = useState<string | null>(null)

  async function createProgram() {
    setStep('creating')
    setError(null)
    try {
      const res = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          financing_types: [seed.financingType],
          currency: seed.currency,
          standard_tenor_days: parseInt(tenor, 10) || 60,
          program_limit: limit ? Number(limit) : null,
          // rate guidance is captured as the program's discount schedule anchor
          discount_schedule: rate ? { base_rate_apr: Number(rate) } : null,
          status: 'active',
          agent_origin: 'strike_ai_inline',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create program')
        setStep('error')
        return
      }
      onCreated({ id: data.program_id ?? data.program?.id, name: name.trim() })
    } catch {
      setError('Network error creating program')
      setStep('error')
    }
  }

  return (
    <div className="term-cp-backdrop" onClick={onCancel}>
      <div className="term-cp-modal" onClick={e => e.stopPropagation()}>
        <div className="term-cp-head">
          <span className="term-cp-head-mark">✦</span>
          <span className="term-cp-head-title">Strike AI</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 18, lineHeight: 1 }}
          >×</button>
        </div>

        <div className="term-cp-body">
          {step === 'intro' && (
            <>
              <div className="term-cp-bubble">
                You don&apos;t have a <b>{typeLabel}</b> program in <b>{seed.currency}</b> yet.
                I can create one for you right now — it takes about 2 minutes. Want to proceed?
              </div>
            </>
          )}

          {step === 'name' && (
            <>
              <div className="term-cp-bubble">First, what should we call this program?</div>
              <div>
                <label className="field-label">Program name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
            </>
          )}

          {step === 'limit' && (
            <>
              <div className="term-cp-bubble">What overall credit limit should this program carry? (Optional — leave blank for no cap.)</div>
              <div>
                <label className="field-label">Program limit ({seed.currency})</label>
                <input className="input" inputMode="numeric" placeholder="e.g. 5000000" value={limit} onChange={e => setLimit(e.target.value.replace(/[^0-9.]/g, ''))} autoFocus />
              </div>
            </>
          )}

          {step === 'rate' && (
            <>
              <div className="term-cp-bubble">What base rate (APR %) should anchor your offers on this program?</div>
              <div>
                <label className="field-label">Base rate APR (%)</label>
                <input className="input" inputMode="decimal" placeholder="e.g. 4.50" value={rate} onChange={e => setRate(e.target.value.replace(/[^0-9.]/g, ''))} autoFocus />
              </div>
            </>
          )}

          {step === 'terms' && (
            <>
              <div className="term-cp-bubble">Finally, what standard payment tenor applies?</div>
              <div>
                <label className="field-label">Standard tenor (days)</label>
                <select className="input" value={tenor} onChange={e => setTenor(e.target.value)}>
                  {['30', '45', '60', '90', '120'].map(d => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
            </>
          )}

          {step === 'confirm' && (
            <>
              <div className="term-cp-bubble">Here&apos;s your new program. Confirm to create it and return to your offer.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <Row k="Name" v={name} />
                <Row k="Type" v={typeLabel} />
                <Row k="Currency" v={seed.currency} />
                <Row k="Limit" v={limit ? Number(limit).toLocaleString() : 'No cap'} />
                <Row k="Base Rate" v={rate ? `${rate}% APR` : 'Set per offer'} />
                <Row k="Tenor" v={`${tenor} days`} />
              </div>
            </>
          )}

          {step === 'creating' && (
            <div className="term-cp-bubble">Creating <b>{name}</b>…</div>
          )}

          {step === 'error' && (
            <div className="term-cp-bubble" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              {error ?? 'Something went wrong.'}
            </div>
          )}
        </div>

        <div className="term-cp-foot">
          {step === 'intro' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{ flex: 1 }}>Not now</button>
              <button className="btn btn-blue btn-sm" onClick={() => setStep('name')} style={{ flex: 1 }}>Yes, proceed</button>
            </>
          )}
          {step === 'name' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('intro')} style={{ flex: 1 }}>Back</button>
              <button className="btn btn-blue btn-sm" onClick={() => setStep('limit')} disabled={!name.trim()} style={{ flex: 1 }}>Next</button>
            </>
          )}
          {step === 'limit' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('name')} style={{ flex: 1 }}>Back</button>
              <button className="btn btn-blue btn-sm" onClick={() => setStep('rate')} style={{ flex: 1 }}>Next</button>
            </>
          )}
          {step === 'rate' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('limit')} style={{ flex: 1 }}>Back</button>
              <button className="btn btn-blue btn-sm" onClick={() => setStep('terms')} style={{ flex: 1 }}>Next</button>
            </>
          )}
          {step === 'terms' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('rate')} style={{ flex: 1 }}>Back</button>
              <button className="btn btn-blue btn-sm" onClick={() => setStep('confirm')} style={{ flex: 1 }}>Review</button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('terms')} style={{ flex: 1 }}>Back</button>
              <button className="btn btn-blue btn-sm" onClick={createProgram} style={{ flex: 1 }}>Create & continue</button>
            </>
          )}
          {step === 'error' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{ flex: 1 }}>Close</button>
              <button className="btn btn-blue btn-sm" onClick={() => setStep('confirm')} style={{ flex: 1 }}>Retry</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)' }}>{k}</span>
      <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{v}</span>
    </div>
  )
}
