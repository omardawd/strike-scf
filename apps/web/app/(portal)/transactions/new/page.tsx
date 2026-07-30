'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import {
  stashTransactionReferrer,
  TRANSACTION_NEW_REFERRER_KEY,
} from '@/lib/transaction-referrer'
import { PortalShell, Topbar, fmtMoney } from '@/components/portal-shell'
import { LiquidityRouting } from '@/components/liquidity-routing'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

const SUPPLIER_ROLES = ['org_admin', 'org_member']

function steps(t: TFn): string[] {
  return [t('newTransaction.selectProgram'), t('newTransaction.invoiceDetails'), t('newTransaction.reviewSubmit')]
}

interface Program {
  id: string
  name: string
  status?: string
  bank_name?: string | null
  financing_types: string[]
  standard_tenor_days: number | null
  program_limit?: number | null
  max_invoice_amount: number | null
  min_invoice_amount: number | null
  max_financing_pct: number | null
  discount_schedule?: string | null
}

function fmtFinancingType(t: string) {
  return t.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const errStyle: React.CSSProperties = { color: '#DC2626', fontSize: 12, marginTop: 4 }

function formatNumberWithCommas(value: string): string {
  if (!value) return ''

  const parts = value.split('.')
  const whole = parts[0] ?? ''
  const decimal = parts[1]

  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return decimal !== undefined
    ? `${formattedWhole}.${decimal}`
    : formattedWhole
}

function sanitizeNumericInput(value: string): string {
  return value.replace(/,/g, '').replace(/[^\d.]/g, '')
}

function HStepper({ step }: { step: number }) {
  const t = useT()
  return (
    <div className="h-stepper" style={{ marginBottom: 32 }}>
      {steps(t).map((label, i) => {
        const done = step > i
        const current = step === i
        return (
          <React.Fragment key={i}>
            {i > 0 && <div className={`h-stepper-line${done ? ' done' : ''}`} />}
            <div className="h-stepper-step">
              <div className={`h-stepper-dot${done ? ' state-done' : current ? ' state-current' : ''}`}>
                {done ? '✓' : i + 1}
              </div>
              <div className="h-stepper-label">{label}</div>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function StepPrograms({ programs, loading, onSelect }: {
  programs: Program[]
  loading: boolean
  onSelect: (p: Program) => void
}) {
  const t = useT()
  const eligiblePrograms = programs.filter(p => {
    const types = p.financing_types ?? []
    return types.some(ft => ft === 'reverse_factoring' || ft === 'invoice_factoring' || ft === 'po_financing' || ft === 'dynamic_discounting')
  })
  if (loading) return <p style={{ color: 'var(--color-text-2)' }}>{t('newTransaction.loadingPrograms')}</p>
  if (!eligiblePrograms.length) {
    return (
      <p style={{ color: 'var(--color-text-2)' }}>
        {t('newTransaction.noProgramsAvailable')}
      </p>
    )
  }
  return (
    <div style={{ display: 'grid', gap: '1px', background: 'var(--border)', maxWidth: 640 }}>
      {eligiblePrograms.map((p) => (
        <div
          key={p.id}
          onClick={() => onSelect(p)}
          style={{
            background: 'var(--white)',
            padding: '16px 20px',
            cursor: 'pointer',
            transition: 'box-shadow 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(20,40,204,0.2)' }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{p.name}</div>
            {p.status && (
              <span style={{
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 9px',
                border: '1px solid currentColor',
                borderRadius: 'var(--radius-badge)',
                color: p.status === 'active' ? 'var(--color-green)' : 'var(--gray)',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.04em',
              }}>
                {p.status}
              </span>
            )}
          </div>
          {p.bank_name && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>{p.bank_name}</div>
          )}
          <div style={{ borderTop: '1px solid var(--border)', marginBottom: 12 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 4 }}>{t('newTransaction.type')}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                {(p.financing_types ?? []).map(fmtFinancingType).join(', ') || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 4 }}>{t('newTransaction.limit')}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                {p.program_limit ? fmtMoney(p.program_limit) : t('newTransaction.noLimit')}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function StepInvoice({
  invoiceNumber, invoiceDate, invoiceDueDate, invoiceAmount, offerRate, description, errors, onChange,
}: {
  invoiceNumber: string
  invoiceDate: string
  invoiceDueDate: string
  invoiceAmount: string
  offerRate: string
  description: string
  errors: Record<string, string>
  onChange: (field: string, value: string) => void
}) {
  const t = useT()
  const invoiceAmt = parseFloat(invoiceAmount) || 0
  const rate = parseFloat(offerRate) || 0
  const advanceAmount = invoiceAmt * (rate / 100)

  return (
    <div className="form-split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-field">
          <label className="form-label">{t('newTransaction.invoiceNumber')}</label>
          <input
            className="form-input"
            value={invoiceNumber}
            onChange={(e) => onChange('invoiceNumber', e.target.value)}
            placeholder="INV-001"
          />
          {errors.invoiceNumber && <div style={errStyle}>{errors.invoiceNumber}</div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-field">
            <label className="form-label">{t('newTransaction.invoiceDate')}</label>
            <input
              className="form-input"
              type="date"
              value={invoiceDate}
              max={invoiceDueDate || undefined}
              onChange={(e) => onChange('invoiceDate', e.target.value)}
            />
            {errors.invoiceDate && <div style={errStyle}>{errors.invoiceDate}</div>}
          </div>
          <div className="form-field">
            <label className="form-label">{t('newTransaction.invoiceDueDate')}</label>
            <input
              className="form-input"
              type="date"
              value={invoiceDueDate}
              onChange={(e) => onChange('invoiceDueDate', e.target.value)}
            />
            {errors.invoiceDueDate && <div style={errStyle}>{errors.invoiceDueDate}</div>}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.invoiceAmountLabel')}</label>
          <input
              className="form-input"
              type="text"
              inputMode="decimal"
              value={formatNumberWithCommas(invoiceAmount)}
              onChange={(e) => {
                const raw = sanitizeNumericInput(e.target.value)
                onChange('invoiceAmount', raw)
            }}
          placeholder="100,000"
          />
          {errors.invoiceAmount && <div style={errStyle}>{errors.invoiceAmount}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.yourOfferLabel')}</label>
          <div style={{ position: 'relative' }}>
            <input
              className="form-input"
              type="number"
              min="1"
              max="100"
              step="0.1"
              value={offerRate}
              onChange={(e) => onChange('offerRate', e.target.value)}
              placeholder="95"
              style={{ paddingRight: 36 }}
            />
            <span style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--gray)', fontSize: 14, pointerEvents: 'none',
            }}>%</span>
          </div>
          {errors.offerRate && <div style={errStyle}>{errors.offerRate}</div>}
          {invoiceAmt > 0 && rate > 0 && (
            <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>
              {t('newTransaction.youAreRequesting')}: ${' '}
              <strong style={{ color: 'var(--color-green)' }}>
                {advanceAmount.toLocaleString('en-US', {
                  maximumFractionDigits: 2,
                  })}
              </strong>
            </div>
          )}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.goodsServicesDescription')}</label>
          <textarea
            className="form-input"
            rows={3}
            value={description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Steel components Q1 2026"
            style={{ resize: 'vertical' }}
          />
          {errors.description && <div style={errStyle}>{errors.description}</div>}
        </div>
      </div>

      <div className="form-summary">
        <div className="calc-panel">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('newTransaction.financingSummary')}</div>
          <div className="calc-row">
            <span>{t('newTransaction.invoiceAmount')}</span>
            <span>{invoiceAmt > 0 ? invoiceAmt : '—'}</span>
          </div>
          <div className="calc-row">
            <span>{t('newTransaction.advanceRate')}</span>
            <span>{rate > 0 ? `${rate}%` : '—'}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />
          <div className="calc-row" style={{ fontWeight: 600 }}>
            <span>{t('newTransaction.youReceiveUpfront')}</span>
            <span style={{ color: 'var(--color-green)' }}>
            {advanceAmount > 0
  ? advanceAmount.toLocaleString('en-US', {
      maximumFractionDigits: 2,
    })
  : '—'}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-2)', marginTop: 10 }}>
          {t('newTransaction.finalRateHint')}
        </p>
      </div>
    </div>
  )
}

function StepPODetails({
  poNumber, poValue, expectedDeliveryDate, poInvoiceDueDate, offerRate, description, errors, onChange,
}: {
  poNumber: string
  poValue: string
  expectedDeliveryDate: string
  poInvoiceDueDate: string
  offerRate: string
  description: string
  errors: Record<string, string>
  onChange: (field: string, value: string) => void
}) {
  const t = useT()
  const poAmt = parseFloat(poValue) || 0
  const rate = parseFloat(offerRate) || 0
  const advanceAmount = poAmt * (rate / 100)

  return (
    <div className="form-split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-field">
          <label className="form-label">{t('newTransaction.poNumber')}</label>
          <input
            className="form-input"
            value={poNumber}
            onChange={(e) => onChange('poNumber', e.target.value)}
            placeholder="PO-2024-001"
          />
          {errors.poNumber && <div style={errStyle}>{errors.poNumber}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.poValue')}</label>
          <input
            className="form-input"
            type="text"
            inputMode="decimal"
            value={formatNumberWithCommas(poValue)}
            onChange={(e) => {
              const raw = sanitizeNumericInput(e.target.value)
              onChange('poValue', raw)
            }}
            placeholder="100,000"
          />
          {errors.poValue && <div style={errStyle}>{errors.poValue}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.expectedDeliveryDate')}</label>
          <input
            className="form-input"
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => onChange('expectedDeliveryDate', e.target.value)}
          />
          {errors.expectedDeliveryDate && <div style={errStyle}>{errors.expectedDeliveryDate}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.expectedPaymentDate')}</label>
          <input
            className="form-input"
            type="date"
            value={poInvoiceDueDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => onChange('poInvoiceDueDate', e.target.value)}
          />
          <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 4 }}>
            {t('newTransaction.whenAnchorExpectedToPay')}
          </div>
          {errors.poInvoiceDueDate && <div style={errStyle}>{errors.poInvoiceDueDate}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.descriptionOfGoodsServices')}</label>
          <textarea
            className="form-input"
            rows={3}
            value={description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Steel components Q1 2026"
            style={{ resize: 'vertical' }}
          />
          {errors.description && <div style={errStyle}>{errors.description}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.advanceRateInitialOffer')}</label>
          <div style={{ position: 'relative' }}>
            <input
              className="form-input"
              type="number"
              min="1"
              max="100"
              step="0.1"
              value={offerRate}
              onChange={(e) => onChange('offerRate', e.target.value)}
              placeholder="95"
              style={{ paddingRight: 36 }}
            />
            <span style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--gray)', fontSize: 14, pointerEvents: 'none',
            }}>%</span>
          </div>
          {errors.offerRate && <div style={errStyle}>{errors.offerRate}</div>}
          {poAmt > 0 && rate > 0 && (
            <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>
              {t('newTransaction.youWillReceiveApprox')}{' '}
              <strong style={{ color: 'var(--color-green)' }}>
                ${advanceAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </strong>
            </div>
          )}
        </div>
      </div>

      <div className="form-summary">
        <div className="calc-panel">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('newTransaction.financingSummary')}</div>
          <div className="calc-row">
            <span>{t('newTransaction.poValueLabel')}</span>
            <span>{poAmt > 0 ? poAmt.toLocaleString() : '—'}</span>
          </div>
          <div className="calc-row">
            <span>{t('newTransaction.advanceRate')}</span>
            <span>{rate > 0 ? `${rate}%` : '—'}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />
          <div className="calc-row" style={{ fontWeight: 600 }}>
            <span>{t('newTransaction.youReceiveUpfront')}</span>
            <span style={{ color: 'var(--color-green)' }}>
              {advanceAmount > 0
                ? advanceAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })
                : '—'}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-2)', marginTop: 10 }}>
          {t('newTransaction.finalRateHint')}
        </p>
      </div>
    </div>
  )
}

function StepDDInvoice({
  invoiceNumber, invoiceDate, invoiceAmount, description, errors, onChange,
  schedule, selectedTier, onSelectTier,
}: {
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: string
  description: string
  errors: Record<string, string>
  onChange: (field: string, value: string) => void
  schedule: Array<{ days: number; rate: number }>
  selectedTier: { days: number; rate: number } | null
  onSelectTier: (tier: { days: number; rate: number }) => void
}) {
  const t = useT()
  const invoiceAmt = parseFloat(invoiceAmount) || 0

  return (
    <div className="form-split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-field">
          <label className="form-label">{t('newTransaction.invoiceNumber')}</label>
          <input
            className="form-input"
            value={invoiceNumber}
            onChange={(e) => onChange('invoiceNumber', e.target.value)}
            placeholder="INV-001"
          />
          {errors.invoiceNumber && <div style={errStyle}>{errors.invoiceNumber}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.invoiceDate')}</label>
          <input
            className="form-input"
            type="date"
            value={invoiceDate}
            onChange={(e) => onChange('invoiceDate', e.target.value)}
          />
          {errors.invoiceDate && <div style={errStyle}>{errors.invoiceDate}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.invoiceAmountLabel')}</label>
          <input
            className="form-input"
            type="text"
            inputMode="decimal"
            value={formatNumberWithCommas(invoiceAmount)}
            onChange={(e) => onChange('invoiceAmount', sanitizeNumericInput(e.target.value))}
            placeholder="100,000"
          />
          {errors.invoiceAmount && <div style={errStyle}>{errors.invoiceAmount}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.goodsServicesDescription')}</label>
          <textarea
            className="form-input"
            rows={3}
            value={description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Steel components Q1 2026"
            style={{ resize: 'vertical' }}
          />
          {errors.description && <div style={errStyle}>{errors.description}</div>}
        </div>

        <div className="form-field">
          <label className="form-label">{t('newTransaction.whenPaid')}</label>
          <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>
            {t('newTransaction.earlierPaymentHint')}
          </div>
          {schedule.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--gray)' }}>{t('newTransaction.noPaymentTiers')}</div>
          ) : (
            schedule.map((tier, i) => (
              <div
                key={i}
                onClick={() => onSelectTier(tier)}
                style={{
                  border: '1.5px solid',
                  borderColor: selectedTier?.days === tier.days ? 'var(--blue)' : 'var(--border)',
                  background: selectedTier?.days === tier.days ? 'rgba(20,40,204,0.03)' : 'var(--white)',
                  padding: '16px 20px',
                  cursor: 'pointer',
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 16, fontWeight: 600,
                      color: 'var(--ink)',
                    }}>
                      {t('newTransaction.payWithinDays', { days: tier.days })}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--gray)',
                      marginTop: 4,
                    }}>
                      {t('newTransaction.discountApplied', { rate: tier.rate })}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 20, fontWeight: 700,
                      color: 'var(--blue)',
                    }}>
                      {invoiceAmt > 0
                        ? fmtMoney(invoiceAmt * (1 - tier.rate / 100))
                        : '—'}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--gray)',
                      marginTop: 2,
                    }}>{t('newTransaction.youReceive')}</div>
                  </div>
                </div>
              </div>
            ))
          )}
          {errors.selectedTier && <div style={errStyle}>{errors.selectedTier}</div>}
        </div>
      </div>

      <div className="form-summary">
        <div className="calc-panel">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('newTransaction.paymentSummary')}</div>
          <div className="calc-row">
            <span>{t('newTransaction.invoiceAmount')}</span>
            <span>{invoiceAmt > 0 ? fmtMoney(invoiceAmt) : '—'}</span>
          </div>
          <div className="calc-row">
            <span>{t('newTransaction.discountRate')}</span>
            <span>{selectedTier ? `${selectedTier.rate}%` : '—'}</span>
          </div>
          <div className="calc-row">
            <span>{t('newTransaction.paymentTimeline')}</span>
            <span>{selectedTier ? t('newTransaction.nDays', { count: selectedTier.days }) : '—'}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />
          <div className="calc-row" style={{ fontWeight: 600 }}>
            <span>{t('newTransaction.youReceive')}</span>
            <span style={{ color: 'var(--blue)' }}>
              {selectedTier && invoiceAmt > 0
                ? fmtMoney(invoiceAmt * (1 - selectedTier.rate / 100))
                : '—'}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-2)', marginTop: 10 }}>
          {t('newTransaction.ddNoBankHint')}
        </p>
      </div>
    </div>
  )
}

function StepReview({
  program, invoiceNumber, invoiceDate, invoiceDueDate, invoiceAmount, offerRate, description, docFiles, submitError, isInvoiceFactoring,
  isPOFinancing, poNumber, poValue, expectedDeliveryDate, poInvoiceDueDate,
  isDynamicDiscounting, selectedTier,
}: {
  program: Program
  invoiceNumber: string
  invoiceDate: string
  invoiceDueDate: string
  invoiceAmount: string
  offerRate: string
  description: string
  docFiles: File[]
  submitError: string | null
  isInvoiceFactoring: boolean
  isPOFinancing: boolean
  poNumber: string
  poValue: string
  expectedDeliveryDate: string
  poInvoiceDueDate: string
  isDynamicDiscounting?: boolean
  selectedTier?: { days: number; rate: number } | null
}) {
  const t = useT()
  const baseAmt = isPOFinancing ? (parseFloat(poValue) || 0) : (parseFloat(invoiceAmount) || 0)
  const rate = parseFloat(offerRate) || 0
  const advanceAmount = baseAmt * (rate / 100)

  if (isDynamicDiscounting && selectedTier) {
    const invoiceAmt = parseFloat(invoiceAmount) || 0
    const receiveAmt = invoiceAmt * (1 - selectedTier.rate / 100)
    const discountAmt = invoiceAmt * (selectedTier.rate / 100)
    const payDate = new Date()
    payDate.setDate(payDate.getDate() + selectedTier.days)
    const payDateStr = payDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    return (
      <div style={{ maxWidth: 560 }}>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head"><span className="t-card-head">{t('newTransaction.program')}</span></div>
          <div className="kv-rows">
            <div className="kv-row"><span className="k">{t('newTransaction.name')}</span><span className="v plain">{program.name}</span></div>
            <div className="kv-row"><span className="k">{t('newTransaction.type')}</span><span className="v plain">{t('newTransaction.dynamicDiscounting')}</span></div>
            <div className="kv-row"><span className="k">{t('newTransaction.nextStep')}</span><span className="v plain">{t('newTransaction.anchorApproval')}</span></div>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head"><span className="t-card-head">{t('newTransaction.invoice')}</span></div>
          <div className="kv-rows">
            <div className="kv-row"><span className="k">{t('newTransaction.invoiceHash')}</span><span className="v">{invoiceNumber}</span></div>
            <div className="kv-row"><span className="k">{t('newTransaction.invoiceAmount')}</span><span className="v">{fmtMoney(invoiceAmt)}</span></div>
            <div className="kv-row"><span className="k">{t('newTransaction.invoiceDate')}</span><span className="v plain">{invoiceDate}</span></div>
            {description && <div className="kv-row"><span className="k">{t('listingDetail.description')}</span><span className="v plain">{description}</span></div>}
          </div>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head"><span className="t-card-head">{t('newTransaction.paymentTier')}</span></div>
          <div className="kv-rows">
            <div className="kv-row"><span className="k">{t('newTransaction.paymentTimeline')}</span><span className="v">{t('newTransaction.payInDaysAtDiscount', { days: selectedTier.days, rate: selectedTier.rate })}</span></div>
            <div className="kv-row"><span className="k">{t('newTransaction.youReceive')}</span><span className="v" style={{ color: 'var(--blue)', fontWeight: 600 }}>{fmtMoney(receiveAmt)}</span></div>
            <div className="kv-row"><span className="k">{t('newTransaction.discountAmount')}</span><span className="v">{fmtMoney(discountAmt)}</span></div>
            <div className="kv-row"><span className="k">{t('newTransaction.expectedPayment')}</span><span className="v plain">{payDateStr}</span></div>
          </div>
        </div>
        {submitError && <div className="alert" style={{ marginTop: 12 }}>{submitError}</div>}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><span className="t-card-head">{t('newTransaction.program')}</span></div>
        <div className="kv-rows">
          <div className="kv-row">
            <span className="k">{t('newTransaction.name')}</span>
            <span className="v plain">{program.name}</span>
          </div>
          <div className="kv-row">
            <span className="k">{t('newTransaction.financingType')}</span>
            <span className="v plain">{isPOFinancing ? t('newTransaction.purchaseOrderFinancing') : (program.financing_types ?? []).map(fmtFinancingType).join(', ')}</span>
          </div>
          <div className="kv-row">
            <span className="k">{t('newTransaction.nextStep')}</span>
            <span className="v plain">{(isInvoiceFactoring || isPOFinancing) ? t('newTransaction.bankReview') : t('newTransaction.anchorReview')}</span>
          </div>
          {program.bank_name && (
            <div className="kv-row">
              <span className="k">{t('newTransaction.bank')}</span>
              <span className="v plain">{program.bank_name}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><span className="t-card-head">{isPOFinancing ? t('newTransaction.purchaseOrder') : t('newTransaction.invoice')}</span></div>
        <div className="kv-rows">
          {isPOFinancing ? (
            <>
              <div className="kv-row">
                <span className="k">{t('newTransaction.poHash')}</span>
                <span className="v">{poNumber}</span>
              </div>
              <div className="kv-row">
                <span className="k">{t('newTransaction.poValueLabel')}</span>
                <span className="v">{fmtMoney(parseFloat(poValue) || 0)}</span>
              </div>
              <div className="kv-row">
                <span className="k">{t('newTransaction.expectedDelivery')}</span>
                <span className="v plain">{expectedDeliveryDate}</span>
              </div>
              {poInvoiceDueDate && (
                <div className="kv-row">
                  <span className="k">{t('newTransaction.expectedPayment')}</span>
                  <span className="v plain">{poInvoiceDueDate}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="kv-row">
                <span className="k">{t('newTransaction.invoiceHash')}</span>
                <span className="v">{invoiceNumber}</span>
              </div>
              <div className="kv-row">
                <span className="k">{t('newTransaction.invoiceAmount')}</span>
                <span className="v">{fmtMoney(baseAmt)}</span>
              </div>
              <div className="kv-row">
                <span className="k">{t('newTransaction.invoiceDate')}</span>
                <span className="v plain">{invoiceDate}</span>
              </div>
              <div className="kv-row">
                <span className="k">{t('newTransaction.dueDate')}</span>
                <span className="v plain">{invoiceDueDate}</span>
              </div>
            </>
          )}
          {description && (
            <div className="kv-row" style={{ alignItems: 'flex-start' }}>
              <span className="k" style={{ paddingTop: 2 }}>{t('listingDetail.description')}</span>
              <span className="v plain" style={{ textAlign: 'right', maxWidth: '60%' }}>{description}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><span className="t-card-head">{t('newTransaction.yourOffer')}</span></div>
        <div className="kv-rows">
          <div className="kv-row">
            <span className="k">{t('newTransaction.advanceRate')}</span>
            <span className="v">{rate}%</span>
          </div>
          <div className="kv-row">
            <span className="k">{t('newTransaction.amountRequested')}</span>
            <span className="v">{fmtMoney(advanceAmount)}</span>
          </div>
          <div className="kv-row">
            <span className="k">{t('newTransaction.youReceiveUpfront')}</span>
            <span className="v" style={{ color: 'var(--color-green)', fontWeight: 600 }}>{fmtMoney(advanceAmount)}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><span className="t-card-head">{t('newTransaction.document')}</span></div>
        <div className="kv-rows">
          {docFiles.length > 0 ? (
            docFiles.map((f, i) => (
              <div key={i} className="kv-row">
                <span className="k">{isPOFinancing ? t('newTransaction.purchaseOrder') : t('newTransaction.invoiceDocument')}</span>
                <span className="v plain" style={{ maxWidth: '65%', textAlign: 'right', wordBreak: 'break-all' }}>{f.name}</span>
              </div>
            ))
          ) : (
            <div className="kv-row">
              <span className="k" style={{ color: 'var(--gray)' }}>{t('newTransaction.noDocumentAttached')}</span>
            </div>
          )}
        </div>
      </div>

      {submitError && (
        <div className="alert" style={{ marginTop: 12 }}>
          {submitError}
        </div>
      )}
    </div>
  )
}

export default function NewTransactionPage() {
  const router = useRouter()
  const user = useUser()
  const t = useT()

  const [step, setStep] = React.useState(0)
  const [programs, setPrograms] = React.useState<Program[]>([])
  const [programsLoading, setProgramsLoading] = React.useState(true)
  const [selectedProgram, setSelectedProgram] = React.useState<Program | null>(null)

  const [invoiceNumber, setInvoiceNumber] = React.useState('')
  const [invoiceDate, setInvoiceDate] = React.useState('')
  const [invoiceDueDate, setInvoiceDueDate] = React.useState('')
  const [invoiceAmount, setInvoiceAmount] = React.useState('')
  const [offerRate, setOfferRate] = React.useState('')
  const [description, setDescription] = React.useState('')

  // PO financing fields
  const [poNumber, setPoNumber] = React.useState('')
  const [poValue, setPoValue] = React.useState('')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = React.useState('')
  const [poInvoiceDueDate, setPoInvoiceDueDate] = React.useState('')

  const isPOFinancing        = selectedProgram?.financing_types?.includes('po_financing') ?? false
  const isDynamicDiscounting = selectedProgram?.financing_types?.includes('dynamic_discounting') ?? false

  const ddSchedule: Array<{ days: number; rate: number }> = React.useMemo(() => {
    try { return JSON.parse(selectedProgram?.discount_schedule ?? '[]') } catch { return [] }
  }, [selectedProgram?.discount_schedule])

  const [selectedTier, setSelectedTier] = React.useState<{ days: number; rate: number } | null>(null)

  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [docFiles, setDocFiles] = React.useState<File[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const [newTxBackPath, setNewTxBackPath] = React.useState('/transactions')

  // Do not remove storage on read (React Strict Mode runs twice in dev).
  React.useEffect(() => {
    try {
      const stored = sessionStorage.getItem(TRANSACTION_NEW_REFERRER_KEY)
      if (stored) setNewTxBackPath(stored)
    } catch {}
  }, [])

  React.useEffect(() => {
    if (user && !SUPPLIER_ROLES.includes(user.role)) {
      router.replace('/dashboard')
    }
  }, [user, router])

  React.useEffect(() => {
    fetch('/api/programs')
      .then((r) => r.json())
      .then((d) => setPrograms(d.programs ?? []))
      .catch(() => setPrograms([]))
      .finally(() => setProgramsLoading(false))
  }, [])

  function handleFieldChange(field: string, value: string) {
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
    switch (field) {
      case 'invoiceNumber':  setInvoiceNumber(value);  break
      case 'invoiceDate':    setInvoiceDate(value);    break
      case 'invoiceDueDate': setInvoiceDueDate(value); break
      case 'invoiceAmount':  setInvoiceAmount(value);  break
      case 'offerRate': {
  setOfferRate(value)

  const rate = parseFloat(value)

  setErrors((prev) => {
    const next = { ...prev }

    if (value && rate > 100) {
      next.offerRate = t('newTransaction.advanceRateExceeds100')
    } else {
      delete next.offerRate
    }

    return next
  })

  break
}
      case 'description':         setDescription(value);         break
      case 'poNumber':            setPoNumber(value);            break
      case 'poValue':             setPoValue(value);             break
      case 'expectedDeliveryDate': setExpectedDeliveryDate(value); break
      case 'poInvoiceDueDate':    setPoInvoiceDueDate(value);    break
    }
  }

  function validateStep2PO(): boolean {
    const e: Record<string, string> = {}
    const poAmt = parseFloat(poValue) || 0
    const rate = parseFloat(offerRate) || 0
    const todayStr = new Date().toISOString().slice(0, 10)

    if (!poNumber.trim()) e.poNumber = t('newTransaction.errPoNumberRequired')
    if (!poValue || poAmt <= 0) e.poValue = t('newTransaction.errPoValuePositive')
    if (!expectedDeliveryDate) {
      e.expectedDeliveryDate = t('newTransaction.errExpectedDeliveryRequired')
    } else if (expectedDeliveryDate <= todayStr) {
      e.expectedDeliveryDate = t('newTransaction.errExpectedDeliveryFuture')
    }
    if (!description.trim()) e.description = t('newTransaction.errDescriptionRequired')
    if (!offerRate || rate <= 0) {
      e.offerRate = t('newTransaction.errAdvanceRateRequired')
    } else if (rate > 100) {
      e.offerRate = t('newTransaction.advanceRateExceeds100')
    }
    if (poInvoiceDueDate && new Date(poInvoiceDueDate) <= new Date()) {
      e.poInvoiceDueDate = t('newTransaction.errExpectedPaymentFuture')
    }

    setErrors(e)
    return Object.keys(e).length === 0
  }

  function validateStep2(): boolean {
    const e: Record<string, string> = {}
    const invoiceAmt = parseFloat(invoiceAmount) || 0
    const rate = parseFloat(offerRate) || 0

    if (!invoiceNumber.trim()) e.invoiceNumber = t('newTransaction.errInvoiceNumberRequired')
    if (!invoiceDate) e.invoiceDate = t('newTransaction.errInvoiceDateRequired')
    if (!invoiceDueDate) e.invoiceDueDate = t('newTransaction.errDueDateRequired')
    if (!invoiceAmount || invoiceAmt <= 0) e.invoiceAmount = t('newTransaction.errInvoiceAmountPositive')
    if (!offerRate || rate <= 0) {
      e.offerRate = t('newTransaction.errAdvanceRateRequired')
    } else if (rate > 100) {
      e.offerRate = t('newTransaction.advanceRateExceeds100')
    }
    if (!description.trim()) e.description = t('newTransaction.errDescriptionRequired')
    const todayStr = new Date().toISOString().slice(0, 10)

    if (!invoiceDate) {
      e.invoiceDate = t('newTransaction.errInvoiceDateRequired')
    } else if (invoiceDate > todayStr) {
      e.invoiceDate = t('newTransaction.errInvoiceDateFuture')
    }

    if (!invoiceDueDate) {
      e.invoiceDueDate = t('newTransaction.errDueDateRequired')
    } else if (invoiceDate && new Date(invoiceDate) >= new Date(invoiceDueDate)) {
      e.invoiceDate = t('newTransaction.errInvoiceDateBeforeDue')
    }
    

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      let body: Record<string, unknown>
      let docKind: string

      if (isDynamicDiscounting && selectedTier) {
        const invoiceAmt = parseFloat(invoiceAmount)
        const d = new Date()
        d.setDate(d.getDate() + selectedTier.days)
        const earlyPaymentDate = d.toISOString().split('T')[0]
        body = {
          program_id: selectedProgram!.id,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate,
          invoice_due_date: earlyPaymentDate,
          invoice_amount: invoiceAmt,
          financing_amount_requested: parseFloat((invoiceAmt * (1 - selectedTier.rate / 100)).toFixed(2)),
          goods_services_description: description.trim(),
          discount_rate: selectedTier.rate,
          early_payment_date: earlyPaymentDate,
          discount_amount: parseFloat((invoiceAmt * (selectedTier.rate / 100)).toFixed(2)),
        }
        docKind = 'invoice_pdf'
      } else if (isPOFinancing) {
        const poAmt = parseFloat(poValue)
        const rate = parseFloat(offerRate)
        const financingAmtRequested = parseFloat((poAmt * (rate / 100)).toFixed(2))
        const todayStr = new Date().toISOString().slice(0, 10)
        body = {
          program_id: selectedProgram!.id,
          invoice_number: poNumber.trim(),
          invoice_date: todayStr,
          invoice_due_date: poInvoiceDueDate || expectedDeliveryDate,
          invoice_amount: poAmt,
          financing_amount_requested: financingAmtRequested,
          goods_services_description: description.trim(),
        }
        docKind = 'purchase_order'
      } else {
        const invoiceAmt = parseFloat(invoiceAmount)
        const rate = parseFloat(offerRate)
        const financingAmtRequested = parseFloat((invoiceAmt * (rate / 100)).toFixed(2))
        body = {
          program_id: selectedProgram!.id,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate,
          invoice_due_date: invoiceDueDate,
          invoice_amount: invoiceAmt,
          financing_amount_requested: financingAmtRequested,
          goods_services_description: description.trim(),
        }
        docKind = 'invoice_pdf'
      }

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error || t('newTransaction.failedToSubmit'))
        return
      }
      const txnId = data.transaction_id
      if (docFiles.length > 0) {
        await Promise.all(
          docFiles.map((file) => {
            const form = new FormData()
            form.append('file', file)
            form.append('document_kind', docKind)
            return fetch(`/api/transactions/${txnId}/documents`, { method: 'POST', body: form })
          })
        )
      }
      stashTransactionReferrer()
      router.push('/transactions/' + txnId)
    } catch {
      setSubmitError(t('newTransaction.networkErrorRetry'))
    } finally {
      setSubmitting(false)
    }
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1)
    else {
      try {
        sessionStorage.removeItem(TRANSACTION_NEW_REFERRER_KEY)
      } catch {}
      router.push(newTxBackPath)
    }
  }

  return (
    <PortalShell activeSection="transactions">
      <Topbar
        crumbs={[
          { label: t('transactionsPage.title'), onClick: () => router.push('/transactions') },
          { label: t('transactionsPage.newTransaction') },
        ]}
        onBack={handleBack}
      />

      <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
        <HStepper step={step} />

        {step === 0 && (
          <StepPrograms
            programs={programs}
            loading={programsLoading}
            onSelect={(p) => {
              setSelectedProgram(p)
              setSelectedTier(null)
              setStep(1)
            }}
          />
        )}

        {step === 1 && isDynamicDiscounting && (
          <>
            <StepDDInvoice
              invoiceNumber={invoiceNumber}
              invoiceDate={invoiceDate}
              invoiceAmount={invoiceAmount}
              description={description}
              errors={errors}
              onChange={handleFieldChange}
              schedule={ddSchedule}
              selectedTier={selectedTier}
              onSelectTier={(tier) => {
                setSelectedTier(tier)
                setErrors(prev => { const n = { ...prev }; delete n.selectedTier; return n })
              }}
            />
            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button className="btn btn-outline" type="button" onClick={() => setStep(0)}>{t('common.back')}</button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  const e: Record<string, string> = {}
                  if (!invoiceNumber.trim()) e.invoiceNumber = t('newTransaction.errInvoiceNumberRequired')
                  if (!invoiceDate) e.invoiceDate = t('newTransaction.errInvoiceDateRequired')
                  const todayStr = new Date().toISOString().slice(0, 10)
                  if (invoiceDate && invoiceDate > todayStr) e.invoiceDate = t('newTransaction.errInvoiceDateFuture')
                  const invoiceAmt = parseFloat(invoiceAmount) || 0
                  if (!invoiceAmount || invoiceAmt <= 0) e.invoiceAmount = t('newTransaction.errInvoiceAmountPositive')
                  if (!description.trim()) e.description = t('newTransaction.errDescriptionRequired')
                  if (!selectedTier) e.selectedTier = t('newTransaction.errSelectPaymentTier')
                  setErrors(e)
                  if (Object.keys(e).length === 0) setStep(2)
                }}
              >
                {t('newTransaction.continueToReview')}
              </button>
            </div>
          </>
        )}

        {step === 1 && !isDynamicDiscounting && (
          <>
            {isPOFinancing ? (
              <StepPODetails
                poNumber={poNumber}
                poValue={poValue}
                expectedDeliveryDate={expectedDeliveryDate}
                poInvoiceDueDate={poInvoiceDueDate}
                offerRate={offerRate}
                description={description}
                errors={errors}
                onChange={handleFieldChange}
              />
            ) : (
              <>
                <LiquidityRouting
                  program={selectedProgram}
                  orgId={user?.org_id ?? ''}
                  invoiceAmount={Number(invoiceAmount) || undefined}
                  onSuggestion={(rate) => setOfferRate(String(rate))}
                />
                <div style={{ marginTop: 16 }}>
                  <StepInvoice
                    invoiceNumber={invoiceNumber}
                    invoiceDate={invoiceDate}
                    invoiceDueDate={invoiceDueDate}
                    invoiceAmount={invoiceAmount}
                    offerRate={offerRate}
                    description={description}
                    errors={errors}
                    onChange={handleFieldChange}
                  />
                </div>
              </>
            )}

            <div style={{ marginTop: 24, maxWidth: 640 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{isPOFinancing ? t('newTransaction.uploadPurchaseOrder') : t('newTransaction.invoiceDocumentHeading')}</div>
              <p style={{ fontSize: 12, color: 'var(--color-text-2)', marginBottom: 12 }}>
                {isPOFinancing ? t('newTransaction.attachPoHint') : t('newTransaction.attachInvoiceHint')}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const incoming = Array.from(e.target.files ?? [])
                  setDocFiles((prev) => {
                    const names = new Set(prev.map((f) => f.name))
                    return [...prev, ...incoming.filter((f) => !names.has(f.name))]
                  })
                  e.target.value = ''
                }}
              />
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ marginBottom: docFiles.length ? 12 : 0 }}
              >
                + {t('newTransaction.attachFiles')}
              </button>
              {docFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {docFiles.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--color-surface-2, #f4f4f5)',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setDocFiles((prev) => prev.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-2)', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button className="btn btn-outline" type="button" onClick={() => setStep(0)}>
                {t('common.back')}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => { if (isPOFinancing ? validateStep2PO() : validateStep2()) setStep(2) }}
              >
                {t('newTransaction.continueToReview')}
              </button>
            </div>
          </>
        )}


        {step === 2 && selectedProgram && (
          <>
            <StepReview
              program={selectedProgram}
              invoiceNumber={invoiceNumber}
              invoiceDate={invoiceDate}
              invoiceDueDate={invoiceDueDate}
              invoiceAmount={invoiceAmount}
              offerRate={offerRate}
              description={description}
              docFiles={docFiles}
              submitError={submitError}
              isInvoiceFactoring={selectedProgram.financing_types?.includes('invoice_factoring') ?? false}
              isPOFinancing={isPOFinancing}
              poNumber={poNumber}
              poValue={poValue}
              expectedDeliveryDate={expectedDeliveryDate}
              poInvoiceDueDate={poInvoiceDueDate}
              isDynamicDiscounting={isDynamicDiscounting}
              selectedTier={selectedTier}
            />
            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                {t('common.back')}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? t('newTransaction.submitting')
                  : isDynamicDiscounting ? t('newTransaction.requestEarlyPayment')
                  : isPOFinancing ? t('newTransaction.submitPoForFinancing')
                  : (selectedProgram.financing_types?.includes('invoice_factoring') ? t('newTransaction.submitForBankReview') : t('newTransaction.submitToAnchorForApproval'))}
              </button>
            </div>
          </>
        )}
      </div>
    </PortalShell>
  )
}
