'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

function finTypes(t: TFn) {
  return [
    { id: 'reverse_factoring',   icon: 'refresh', label: t('financing.type.reverseFactoring'),   desc: t('newProgram.descReverseFactoring') },
    { id: 'invoice_factoring',   icon: 'invoice', label: t('financing.type.invoiceFactoring'),    desc: t('newProgram.descInvoiceFactoring') },
    { id: 'po_financing',        icon: 'box',     label: t('financing.type.poFinancing'),         desc: t('newProgram.descPoFinancing') },
    { id: 'dynamic_discounting', icon: 'clock',   label: t('financing.type.dynamicDiscounting'),  desc: t('newProgram.descDynamicDiscounting') },
  ]
}

function parseMoney(raw: string): number {
  return Number(raw.replace(/[^0-9]/g, '')) || 0
}

type ScheduleTier = { days: number; rate: number }

export default function NewProgramPage() {
  const user   = useUser()
  const router = useRouter()
  const t = useT()

  // Any org creating a program here can only self-fund Dynamic Discounting
  // (direct anchor-to-supplier, no bank involved) — the other financing types
  // require a bank to originate. This is an org-vs-bank distinction, not an
  // anchor-vs-supplier one.
  const isOrgCreator = user?.role === 'org_admin' || user?.role === 'org_member'
  const allFinTypes = finTypes(t)
  const visibleFinTypes = isOrgCreator
    ? allFinTypes.filter(ft => ft.id === 'dynamic_discounting')
    : allFinTypes.filter(ft => ft.id !== 'dynamic_discounting')

  const [name, setName]           = useState('')
  const [finType, setFinType]     = useState('reverse_factoring')
  const [limitMode, setLimitMode] = useState('fixed')
  const [programLimit, setProgramLimit]   = useState(25000000)
  const [supplierSub, setSupplierSub]     = useState(2500000)
  const [minDeal, setMinDeal]             = useState(50000)
  const [maxDeal, setMaxDeal]             = useState(2000000)
  const [maxAge, setMaxAge]               = useState(90)
  const [tenor, setTenor]                 = useState(60)
  const [maxFulfill, setMaxFulfill]       = useState(120)
  const [submitting, setSubmitting]       = useState(false)
  const [submitError, setSubmitError]     = useState<string | null>(null)

  const [schedule, setSchedule] = useState<ScheduleTier[]>([
    { days: 10, rate: 2.0 },
    { days: 20, rate: 1.5 },
    { days: 30, rate: 1.0 },
  ])

  // Set defaults when creator type is known
  useEffect(() => {
    if (isOrgCreator) setFinType('dynamic_discounting')
  }, [isOrgCreator])

  useEffect(() => {
    if (user && user.role !== 'bank_admin' && user.role !== 'org_admin') {
      router.replace('/programs')
    }
  }, [user, router])

  const isDD    = finType === 'dynamic_discounting'
  const overflow = !isDD && limitMode === 'fixed' && maxDeal > programLimit
  const finLabel = allFinTypes.find((f) => f.id === finType)?.label ?? '—'

  // Schedule validation
  const scheduleValid = isDD
    ? schedule.length >= 1 &&
      schedule.every((t, i) => i === 0 || t.days > schedule[i - 1]!.days) &&
      schedule.every((t, i) => i === 0 || t.rate < schedule[i - 1]!.rate)
    : true

  function addTier() {
    const last = schedule[schedule.length - 1]
    const newDays = last ? last.days + 10 : 10
    const newRate = last ? Math.max(0.1, last.rate - 0.5) : 2.0
    setSchedule(prev => [...prev, { days: newDays, rate: newRate }])
  }

  function removeTier(i: number) {
    setSchedule(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateTier(i: number, field: 'days' | 'rate', val: number) {
    setSchedule(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: val } : t))
  }

  async function handleSubmit(asDraft: boolean) {
    setSubmitError(null)
    if (!name.trim()) {
      setSubmitError(t('newProgram.errNameRequired'))
      return
    }
    if (isDD && schedule.length === 0) {
      setSubmitError(t('newProgram.errAtLeastOneTier'))
      return
    }
    if (isDD && !scheduleValid) {
      setSubmitError(t('newProgram.errDaysAscendingRatesDescending'))
      return
    }

    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        financing_types: [finType],
        standard_tenor_days: isDD ? 0 : tenor,
        currency: 'USD',
        status: asDraft ? 'draft' : 'active',
      }
      if (!isDD && limitMode === 'fixed') {
        body.program_limit        = programLimit
        body.per_supplier_sublimit = supplierSub
        body.min_deal_size        = minDeal
        body.max_deal_size        = maxDeal
      }
      if (isDD) {
        body.discount_schedule = schedule
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
      setSubmitError(err instanceof Error ? err.message : t('newProgram.submissionFailed'))
      setSubmitting(false)
    }
  }

  if (user && user.role !== 'bank_admin' && user.role !== 'org_admin') return null

  return (
    <PortalShell activeSection="programs">
      <Topbar
        onBack={() => router.push('/programs')}
        crumbs={[
          { label: t('programsPage.title'), onClick: () => router.push('/programs') },
          { label: t('programsPage.newProgram') },
        ]}
        actions={<NotifBell />}
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title" style={{ fontSize: 20 }}>{t('newProgram.createProgram')}</h1>
          <div className="subtitle">
            {isOrgCreator
              ? t('newProgram.setupDdSubtitle')
              : t('newProgram.setupScfSubtitle')}
          </div>
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
                <label className="form-label">{t('newProgram.programName')}</label>
                <input
                  className="form-input"
                  placeholder={t('newProgram.programNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Financing type */}
              <div className="form-field">
                <label className="form-label">{t('newProgram.financingType')}</label>
                <div className="fin-type-grid">
                  {visibleFinTypes.map((ft) => (
                    <button
                      key={ft.id}
                      type="button"
                      className={`fin-type-card ${finType === ft.id ? 'selected' : ''}`}
                      onClick={() => setFinType(ft.id)}
                    >
                      <Icon name={ft.icon} size={20} className="fin-type-icon" />
                      <div className="fin-type-label">{ft.label}</div>
                      <div className="fin-type-desc">{ft.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Discount Schedule (DD only) ── */}
              {isDD && (
                <div className="form-field">
                  <label className="form-label">{t('newProgram.discountSchedule')}</label>
                  <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>
                    {t('newProgram.discountScheduleHint')}
                  </div>

                  {schedule.map((tier, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gray)', minWidth: 68 }}>
                        {t('newProgram.payWithin')}
                      </span>
                      <input
                        className="form-input mono"
                        type="number"
                        min={1}
                        max={90}
                        value={tier.days}
                        onChange={(e) => updateTier(i, 'days', Number(e.target.value))}
                        style={{ width: 72 }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gray)' }}>{t('newProgram.days')}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gray)', marginLeft: 8 }}>{t('newProgram.discount')}</span>
                      <input
                        className="form-input mono"
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.01}
                        value={tier.rate}
                        onChange={(e) => updateTier(i, 'rate', Number(e.target.value))}
                        style={{ width: 72 }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gray)' }}>%</span>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 18, padding: '0 4px', lineHeight: 1 }}
                        onClick={() => removeTier(i)}
                        disabled={schedule.length <= 1}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={addTier}
                    style={{ marginTop: 4 }}
                  >
                    + {t('newProgram.addTier')}
                  </button>

                  {!scheduleValid && schedule.length > 0 && (
                    <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>
                      {t('newProgram.tiersOrderHint')}
                    </div>
                  )}
                </div>
              )}

              {/* ── Limit structure (non-DD only) ── */}
              {!isDD && (
                <>
                  <div className="form-field">
                    <label className="form-label">{t('newProgram.limitStructure')}</label>
                    <div className="radio-cards">
                      <button
                        type="button"
                        className={`radio-card lg ${limitMode === 'fixed' ? 'selected' : ''}`}
                        onClick={() => setLimitMode('fixed')}
                      >
                        <div className="radio-card-radio" />
                        <div>
                          <div className="radio-card-title">{t('newProgram.fixedLimit')}</div>
                          <div className="radio-card-desc">{t('newProgram.fixedLimitDesc')}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        className={`radio-card lg ${limitMode === 'open' ? 'selected' : ''}`}
                        onClick={() => setLimitMode('open')}
                      >
                        <div className="radio-card-radio" />
                        <div>
                          <div className="radio-card-title">{t('newProgram.openAccount')}</div>
                          <div className="radio-card-desc">{t('newProgram.openAccountDesc')}</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {limitMode === 'fixed' && (
                    <>
                      <div className="form-field">
                        <label className="form-label">{t('newProgram.programLimit')}</label>
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
                          <label className="form-label">{t('newProgram.perSupplierSublimit')}</label>
                          <input
                            className="form-input mono"
                            value={'$' + supplierSub.toLocaleString()}
                            onChange={(e) => setSupplierSub(parseMoney(e.target.value))}
                          />
                        </div>
                        <div className="form-field">
                          <label className="form-label">{t('newProgram.minDealSize')}</label>
                          <input
                            className="form-input mono"
                            value={'$' + minDeal.toLocaleString()}
                            onChange={(e) => setMinDeal(parseMoney(e.target.value))}
                          />
                        </div>
                      </div>

                      <div className="form-row-2">
                        <div className="form-field">
                          <label className="form-label">{t('newProgram.maxDealSize')}</label>
                          <input
                            className="form-input mono"
                            value={'$' + maxDeal.toLocaleString()}
                            onChange={(e) => setMaxDeal(parseMoney(e.target.value))}
                          />
                        </div>
                        <div className="form-field">
                          <label className="form-label">{t('newProgram.maxInvoiceAge')}</label>
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
                            <label className="form-label">{t('newProgram.standardTenor')}</label>
                            <input
                              className="form-input mono"
                              value={tenor}
                              onChange={(e) => setTenor(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                            />
                          </div>
                          {finType === 'po_financing' && (
                            <div className="form-field">
                              <label className="form-label">{t('newProgram.maxPoFulfillment')}</label>
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
                      <label className="form-label">{t('newProgram.standardTenor')}</label>
                      <input
                        className="form-input mono"
                        value={tenor}
                        onChange={(e) => setTenor(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
                      />
                    </div>
                  )}

                  <div className="info-box" style={{ margin: '16px 0 0', fontStyle: 'italic' }}>
                    <Icon name="info" size={14} className="info-box-icon" />
                    <span>{t('newProgram.internalOnlyHint')}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Right: summary ── */}
          <div className="card form-summary">
            <div className="card-head">
              <h3 className="t-card-head">{t('newProgram.programSummary')}</h3>
            </div>
            <div className="kv-list">
              <div className="kv-row">
                <span className="k">{t('newProgram.programName')}</span>
                <span className="v plain">{name || '—'}</span>
              </div>
              <div className="kv-row">
                <span className="k">{t('newTransaction.type')}</span>
                <span className="v plain">{finLabel}</span>
              </div>
              {!isDD && (
                <>
                  <div className="kv-row">
                    <span className="k">{t('newProgram.limitStructure')}</span>
                    <span className="v plain">
                      {limitMode === 'fixed' ? `${t('newProgram.fixedLimit')} · ${fmtMoney(programLimit)}` : t('newProgram.openAccount')}
                    </span>
                  </div>
                  {limitMode === 'fixed' && (
                    <>
                      <div className="kv-row">
                        <span className="k">{t('newProgram.perSupplierCap')}</span>
                        <span className="v mono">{fmtMoney(supplierSub)}</span>
                      </div>
                      <div className="kv-row">
                        <span className="k">{t('newProgram.dealRange')}</span>
                        <span className="v mono">{fmtMoney(minDeal)} – {fmtMoney(maxDeal)}</span>
                      </div>
                      <div className="kv-row">
                        <span className="k">{t('newProgram.invoiceAgeMax')}</span>
                        <span className="v plain">{t('newProgram.nDays', { count: maxAge })}</span>
                      </div>
                    </>
                  )}
                  {finType !== 'reverse_factoring' && (
                    <div className="kv-row">
                      <span className="k">{t('newProgram.tenor')}</span>
                      <span className="v plain">{t('newProgram.nDays', { count: tenor })}</span>
                    </div>
                  )}
                </>
              )}
              {isDD && schedule.length > 0 && (
                <div className="kv-row" style={{ alignItems: 'flex-start' }}>
                  <span className="k">{t('newProgram.discountTiers')}</span>
                  <div className="v plain" style={{ textAlign: 'right' }}>
                    {schedule.map((tier, i) => (
                      <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {tier.days}{t('programsPage.daysSuffix')} → {tier.rate}%
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="kv-row">
                <span className="k">{t('deals.col.status')}</span>
                <span className="v">
                  <span className="badge badge-draft">{t('programsPage.status.draft')}</span>
                </span>
              </div>
            </div>

            {overflow && (
              <div className="warn-box">
                <Icon name="alert" size={14} />
                <span>{t('newProgram.maxDealExceedsLimit')}</span>
              </div>
            )}

            <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                className="btn btn-primary btn-block"
                type="button"
                disabled={overflow || !name.trim() || submitting || (isDD && !scheduleValid)}
                style={{ height: 40 }}
                onClick={() => handleSubmit(false)}
              >
                {submitting ? t('newProgram.creating') : t('newProgram.activateProgram')}
              </button>
              <button
                className="btn btn-ghost btn-block"
                type="button"
                disabled={submitting}
                onClick={() => handleSubmit(true)}
              >
                {t('newProgram.saveAsDraft')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  )
}
