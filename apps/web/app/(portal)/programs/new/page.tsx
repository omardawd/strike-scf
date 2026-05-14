'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'

const FIN_TYPES = [
  { id: 'reverse_factoring', icon: 'refresh', label: 'Reverse Factoring', desc: 'Bank pays supplier, anchor repays' },
  { id: 'invoice_factoring', icon: 'invoice', label: 'Invoice Factoring',  desc: 'Supplier submits invoice, no anchor step' },
  { id: 'po_financing',      icon: 'box',     label: 'PO Financing',       desc: 'Pre-shipment capital for purchase orders' },
]

function parseMoney(raw: string): number {
  return Number(raw.replace(/[^0-9]/g, '')) || 0
}

export default function NewProgramPage() {
  const user = useUser()
  const router = useRouter()

  const [name, setName] = useState('')
  const [finType, setFinType] = useState('reverse_factoring')
  const [limitMode, setLimitMode] = useState('fixed')
  const [programLimit, setProgramLimit] = useState(25000000)
  const [supplierSub, setSupplierSub] = useState(2500000)
  const [minDeal, setMinDeal] = useState(50000)
  const [maxDeal, setMaxDeal] = useState(2000000)
  const [maxAge, setMaxAge] = useState(90)
  const [tenor, setTenor] = useState(60)
  const [maxFulfill, setMaxFulfill] = useState(120)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (user && user.role !== 'bank_admin') {
      router.replace('/programs')
    }
  }, [user, router])

  const overflow = limitMode === 'fixed' && maxDeal > programLimit
  const finLabel = FIN_TYPES.find((f) => f.id === finType)?.label ?? '—'

  async function handleSubmit(asDraft: boolean) {
    setSubmitError(null)
    if (!name.trim()) {
      setSubmitError('Program name is required')
      return
    }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        financing_types: [finType],
        standard_tenor_days: tenor,
        currency: 'USD',
        status: asDraft ? 'draft' : 'active',
      }
      if (limitMode === 'fixed') {
        body.program_limit = programLimit
        body.per_supplier_sublimit = supplierSub
        body.min_deal_size = minDeal
        body.max_deal_size = maxDeal
      }

      const res = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      router.push(`/programs/${data.program_id}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed')
      setSubmitting(false)
    }
  }

  if (user && user.role !== 'bank_admin') return null

  return (
    <PortalShell activeSection="programs">
      <Topbar
        onBack={() => router.push('/programs')}
        crumbs={[
          { label: 'Bank Portal' },
          { label: 'My Programs', onClick: () => router.push('/programs') },
          { label: 'New Program' },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title" style={{ fontSize: 20 }}>Create program</h1>
          <div className="subtitle">Set up a new SCF program and invite counterparties</div>
        </div>

        {submitError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">{submitError}</div>
          </div>
        )}

        <div className="form-split">
          {/* ── Left: form ── */}
          <div className="card form-card">
            <div className="form-card-body">

              {/* Program name */}
              <div className="form-field">
                <label className="form-label">Program name</label>
                <input
                  className="form-input"
                  placeholder="e.g. Factoring Program — Q3 2026"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Financing type */}
              <div className="form-field">
                <label className="form-label">Financing type</label>
                <div className="fin-type-grid">
                  {FIN_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`fin-type-card ${finType === t.id ? 'selected' : ''}`}
                      onClick={() => setFinType(t.id)}
                    >
                      <Icon name={t.icon} size={20} className="fin-type-icon" />
                      <div className="fin-type-label">{t.label}</div>
                      <div className="fin-type-desc">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Limit structure */}
              <div className="form-field">
                <label className="form-label">Limit structure</label>
                <div className="radio-cards">
                  <button
                    type="button"
                    className={`radio-card lg ${limitMode === 'fixed' ? 'selected' : ''}`}
                    onClick={() => setLimitMode('fixed')}
                  >
                    <div className="radio-card-radio" />
                    <div>
                      <div className="radio-card-title">Fixed limit</div>
                      <div className="radio-card-desc">Set a maximum program exposure</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`radio-card lg ${limitMode === 'open' ? 'selected' : ''}`}
                    onClick={() => setLimitMode('open')}
                  >
                    <div className="radio-card-radio" />
                    <div>
                      <div className="radio-card-title">Open account</div>
                      <div className="radio-card-desc">Approve each deal at discretion</div>
                    </div>
                  </button>
                </div>
              </div>

              {limitMode === 'fixed' && (
                <>
                  {/* Program limit */}
                  <div className="form-field">
                    <label className="form-label">Program limit</label>
                    <div className="currency-input-wrap">
                      <input
                        className="currency-input"
                        value={'$' + programLimit.toLocaleString()}
                        onChange={(e) => setProgramLimit(parseMoney(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-field">
                      <label className="form-label">Per-supplier sublimit</label>
                      <input
                        className="form-input mono"
                        value={'$' + supplierSub.toLocaleString()}
                        onChange={(e) => setSupplierSub(parseMoney(e.target.value))}
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">Min deal size</label>
                      <input
                        className="form-input mono"
                        value={'$' + minDeal.toLocaleString()}
                        onChange={(e) => setMinDeal(parseMoney(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-field">
                      <label className="form-label">Max deal size</label>
                      <input
                        className="form-input mono"
                        value={'$' + maxDeal.toLocaleString()}
                        onChange={(e) => setMaxDeal(parseMoney(e.target.value))}
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">Max invoice age (days)</label>
                      <input
                        className="form-input mono"
                        value={maxAge}
                        onChange={(e) => setMaxAge(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                      />
                    </div>
                  </div>

                  {finType !== 'reverse_factoring' && (
                    <div className="form-row-2">
                      <div className="form-field">
                        <label className="form-label">Standard tenor (days)</label>
                        <input
                          className="form-input mono"
                          value={tenor}
                          onChange={(e) => setTenor(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                        />
                      </div>
                      {finType === 'po_financing' && (
                        <div className="form-field">
                          <label className="form-label">Max PO fulfillment (days)</label>
                          <input
                            className="form-input mono"
                            value={maxFulfill}
                            onChange={(e) => setMaxFulfill(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {limitMode === 'open' && finType !== 'reverse_factoring' && (
                <div className="form-field">
                  <label className="form-label">Standard tenor (days)</label>
                  <input
                    className="form-input mono"
                    value={tenor}
                    onChange={(e) => setTenor(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                  />
                </div>
              )}

              <div className="info-box" style={{ margin: '16px 0 0', fontStyle: 'italic' }}>
                <Icon name="info" size={14} className="info-box-icon" />
                <span>Program limits are internal only — counterparties never see these figures.</span>
              </div>
            </div>
          </div>

          {/* ── Right: summary ── */}
          <div className="card form-summary">
            <div className="card-head">
              <h3 className="t-card-head">Program summary</h3>
            </div>
            <div className="kv-list">
              <div className="kv-row">
                <span className="k">Program name</span>
                <span className="v plain">{name || '—'}</span>
              </div>
              <div className="kv-row">
                <span className="k">Type</span>
                <span className="v plain">{finLabel}</span>
              </div>
              <div className="kv-row">
                <span className="k">Limit structure</span>
                <span className="v plain">
                  {limitMode === 'fixed' ? `Fixed · ${fmtMoney(programLimit)}` : 'Open account'}
                </span>
              </div>
              {limitMode === 'fixed' && (
                <>
                  <div className="kv-row">
                    <span className="k">Per-supplier cap</span>
                    <span className="v mono">{fmtMoney(supplierSub)}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Deal range</span>
                    <span className="v mono">{fmtMoney(minDeal)} – {fmtMoney(maxDeal)}</span>
                  </div>
                  <div className="kv-row">
                    <span className="k">Invoice age max</span>
                    <span className="v plain">{maxAge} days</span>
                  </div>
                </>
              )}
              {finType !== 'reverse_factoring' && (
                <div className="kv-row">
                  <span className="k">Tenor</span>
                  <span className="v plain">{tenor} days</span>
                </div>
              )}
              <div className="kv-row">
                <span className="k">Status</span>
                <span className="v">
                  <span className="badge badge-draft">Draft</span>
                </span>
              </div>
            </div>

            {overflow && (
              <div className="warn-box">
                <Icon name="alert" size={14} />
                <span>Max deal size exceeds program limit</span>
              </div>
            )}

            <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-primary btn-block"
                type="button"
                disabled={overflow || !name.trim() || submitting}
                style={{ height: 40 }}
                onClick={() => handleSubmit(false)}
              >
                {submitting ? 'Creating…' : 'Activate program'}
              </button>
              <button
                className="btn btn-ghost btn-block"
                type="button"
                disabled={submitting}
                onClick={() => handleSubmit(true)}
              >
                Save as draft
              </button>
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  )
}
