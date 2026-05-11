'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import {
  stashTransactionReferrer,
  TRANSACTION_NEW_REFERRER_KEY,
} from '@/lib/transaction-referrer'
import { PortalShell, Topbar, fmtMoney } from '@/components/portal-shell'

const SUPPLIER_ROLES = ['supplier_admin', 'supplier_member']
const STEPS = ['Select Program', 'Invoice Details', 'Review & Submit']

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
}

function fmtFinancingType(t: string) {
  return t.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const errStyle: React.CSSProperties = { color: 'var(--color-red)', fontSize: 12, marginTop: 4 }

function HStepper({ step }: { step: number }) {
  return (
    <div className="h-stepper" style={{ marginBottom: 32 }}>
      {STEPS.map((label, i) => {
        const done = step > i
        const current = step === i
        return (
          <React.Fragment key={i}>
            {i > 0 && <div className={`h-stepper-line${done ? ' done' : ''}`} />}
            <div className="h-stepper-step">
              <div
                className={`h-stepper-dot${done ? ' state-done' : current ? ' state-current' : ''}`}
              >
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

interface Step1Props {
  programs: Program[]
  loading: boolean
  onSelect: (p: Program) => void
}

function StepPrograms({ programs, loading, onSelect }: Step1Props) {
  if (loading) return <p style={{ color: 'var(--color-text-2)' }}>Loading programs…</p>
  if (!programs.length) {
    return (
      <p style={{ color: 'var(--color-text-2)' }}>
        No programs available. Contact your anchor to enroll.
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
      {programs.map((p) => (
        <div
          key={p.id}
          onClick={() => onSelect(p)}
          style={{
            border: '1.5px solid var(--color-border)',
            borderRadius: 10,
            padding: '16px 20px',
            cursor: 'pointer',
            background: 'var(--color-card)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
            {p.status && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 20,
                background: p.status === 'active' ? 'var(--color-green-subtle, #e6f9f0)' : 'var(--color-surface-2, #f4f4f5)',
                color: p.status === 'active' ? 'var(--color-green, #16a34a)' : 'var(--color-ink-4, #9ca3af)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {p.status}
              </span>
            )}
          </div>
          {p.bank_name && (
            <div style={{ fontSize: 12, color: 'var(--color-text-2)', marginBottom: 10 }}>{p.bank_name}</div>
          )}
          <div style={{ borderTop: '1px solid var(--color-border)', marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-2)', marginBottom: 2 }}>Type</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {(p.financing_types ?? []).map(fmtFinancingType).join(', ') || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-2)', marginBottom: 2 }}>Tenor</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {p.standard_tenor_days ? `${p.standard_tenor_days} days` : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-2)', marginBottom: 2 }}>Limit</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {p.program_limit ? fmtMoney(p.program_limit) : 'No limit'}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface Step2Props {
  invoiceNumber: string
  invoiceDate: string
  invoiceDueDate: string
  invoiceAmount: string
  financingAmount: string
  description: string
  errors: Record<string, string>
  onChange: (field: string, value: string) => void
}

function StepInvoice({
  invoiceNumber,
  invoiceDate,
  invoiceDueDate,
  invoiceAmount,
  financingAmount,
  description,
  errors,
  onChange,
}: Step2Props) {
  const invoiceAmt = parseFloat(invoiceAmount) || 0
  const financingAmt = parseFloat(financingAmount) || 0
  const estimatedNet = financingAmt

  return (
    <div className="form-split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-field">
          <label className="form-label">Invoice Number</label>
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
            <label className="form-label">Invoice Date</label>
            <input
              className="form-input"
              type="date"
              value={invoiceDate}
              onChange={(e) => onChange('invoiceDate', e.target.value)}
            />
            {errors.invoiceDate && <div style={errStyle}>{errors.invoiceDate}</div>}
          </div>
          <div className="form-field">
            <label className="form-label">Due Date</label>
            <input
              className="form-input"
              type="date"
              value={invoiceDueDate}
              onChange={(e) => onChange('invoiceDueDate', e.target.value)}
            />
            {errors.invoiceDueDate && <div style={errStyle}>{errors.invoiceDueDate}</div>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-field">
            <label className="form-label">Invoice Amount ($)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={invoiceAmount}
              onChange={(e) => onChange('invoiceAmount', e.target.value)}
              placeholder="100000"
            />
            {errors.invoiceAmount && <div style={errStyle}>{errors.invoiceAmount}</div>}
          </div>
          <div className="form-field">
            <label className="form-label">Financing Requested ($)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={financingAmount}
              onChange={(e) => onChange('financingAmount', e.target.value)}
              placeholder="95000"
            />
            {errors.financingAmount && <div style={errStyle}>{errors.financingAmount}</div>}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Goods / Services Description</label>
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
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Financing Summary</div>
          <div className="calc-row">
            <span>Invoice Amount</span>
            <span>{invoiceAmt > 0 ? fmtMoney(invoiceAmt) : '—'}</span>
          </div>
          <div className="calc-row">
            <span>Financing Requested</span>
            <span>{financingAmt > 0 ? fmtMoney(financingAmt) : '—'}</span>
          </div>
          <div className="calc-row">
            <span>Estimated Fee</span>
            <span>$0</span>
          </div>
          <div style={{ borderTop: '1px solid var(--color-border)', margin: '10px 0' }} />
          <div className="calc-row" style={{ fontWeight: 600 }}>
            <span>Est. Net Proceeds</span>
            <span>{financingAmt > 0 ? fmtMoney(estimatedNet) : '—'}</span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-2)', marginTop: 10 }}>
          Fee and rate are set by your bank upon approval.
        </p>
      </div>
    </div>
  )
}

interface Step3Props {
  program: Program
  invoiceNumber: string
  invoiceDate: string
  invoiceDueDate: string
  invoiceAmount: string
  financingAmount: string
  description: string
  submitError: string | null
}

function StepReview({
  program,
  invoiceNumber,
  invoiceDate,
  invoiceDueDate,
  invoiceAmount,
  financingAmount,
  description,
  submitError,
}: Step3Props) {
  const invoiceAmt = parseFloat(invoiceAmount) || 0
  const financingAmt = parseFloat(financingAmount) || 0

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><span className="t-card-head">Program</span></div>
        <div className="kv-rows">
          <div className="kv-row">
            <span className="k">Name</span>
            <span className="v plain">{program.name}</span>
          </div>
          <div className="kv-row">
            <span className="k">Type</span>
            <span className="v plain">{(program.financing_types ?? []).join(', ')}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><span className="t-card-head">Invoice details</span></div>
        <div className="kv-rows">
          <div className="kv-row">
            <span className="k">Invoice #</span>
            <span className="v">{invoiceNumber}</span>
          </div>
          <div className="kv-row">
            <span className="k">Invoice date</span>
            <span className="v plain">{invoiceDate}</span>
          </div>
          <div className="kv-row">
            <span className="k">Due date</span>
            <span className="v plain">{invoiceDueDate}</span>
          </div>
          <div className="kv-row">
            <span className="k">Invoice amount</span>
            <span className="v">{fmtMoney(invoiceAmt)}</span>
          </div>
          <div className="kv-row">
            <span className="k">Financing requested</span>
            <span className="v">{fmtMoney(financingAmt)}</span>
          </div>
          {description && (
            <div className="kv-row" style={{ alignItems: 'flex-start' }}>
              <span className="k" style={{ paddingTop: 2 }}>Description</span>
              <span className="v plain" style={{ textAlign: 'right', maxWidth: '60%' }}>{description}</span>
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

  const [step, setStep] = React.useState(0)
  const [programs, setPrograms] = React.useState<Program[]>([])
  const [programsLoading, setProgramsLoading] = React.useState(true)
  const [selectedProgram, setSelectedProgram] = React.useState<Program | null>(null)

  const [invoiceNumber, setInvoiceNumber] = React.useState('')
  const [invoiceDate, setInvoiceDate] = React.useState('')
  const [invoiceDueDate, setInvoiceDueDate] = React.useState('')
  const [invoiceAmount, setInvoiceAmount] = React.useState('')
  const [financingAmount, setFinancingAmount] = React.useState('')
  const [description, setDescription] = React.useState('')

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
      case 'invoiceNumber':   setInvoiceNumber(value);   break
      case 'invoiceDate':     setInvoiceDate(value);     break
      case 'invoiceDueDate':  setInvoiceDueDate(value);  break
      case 'invoiceAmount':   setInvoiceAmount(value);   break
      case 'financingAmount': setFinancingAmount(value); break
      case 'description':     setDescription(value);     break
    }
  }

  function validateStep2(): boolean {
    const e: Record<string, string> = {}
    const invoiceAmt = parseFloat(invoiceAmount) || 0
    const financingAmt = parseFloat(financingAmount) || 0

    if (!invoiceNumber.trim()) e.invoiceNumber = 'Invoice number is required'
    if (!invoiceDate) e.invoiceDate = 'Invoice date is required'
    if (!invoiceDueDate) e.invoiceDueDate = 'Due date is required'
    if (!invoiceAmount || invoiceAmt <= 0) e.invoiceAmount = 'Invoice amount must be greater than 0'
    if (!financingAmount || financingAmt <= 0) {
      e.financingAmount = 'Financing amount must be greater than 0'
    } else if (financingAmt > invoiceAmt) {
      e.financingAmount = 'Financing amount cannot exceed invoice amount'
    }
    if (!description.trim()) e.description = 'Description is required'

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program_id: selectedProgram!.id,
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate,
          invoice_due_date: invoiceDueDate,
          invoice_amount: parseFloat(invoiceAmount),
          financing_amount_requested: parseFloat(financingAmount),
          goods_services_description: description.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error || 'Failed to submit transaction')
        return
      }
      const txnId = data.transaction_id
      if (docFiles.length > 0) {
        await Promise.all(
          docFiles.map((file) => {
            const form = new FormData()
            form.append('file', file)
            form.append('document_kind', 'supporting_document')
            return fetch(`/api/transactions/${txnId}/documents`, { method: 'POST', body: form })
          })
        )
      }
      stashTransactionReferrer()
      router.push('/transactions/' + txnId)
    } catch {
      setSubmitError('Network error. Please try again.')
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
          { label: 'Supplier Portal', onClick: () => router.push('/dashboard') },
          { label: 'Transactions', onClick: () => router.push('/transactions') },
          { label: 'New Transaction' },
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
              setStep(1)
            }}
          />
        )}

        {step === 1 && (
          <>
            <StepInvoice
              invoiceNumber={invoiceNumber}
              invoiceDate={invoiceDate}
              invoiceDueDate={invoiceDueDate}
              invoiceAmount={invoiceAmount}
              financingAmount={financingAmount}
              description={description}
              errors={errors}
              onChange={handleFieldChange}
            />

            <div style={{ marginTop: 24, maxWidth: 640 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Supporting Documents</div>
              <p style={{ fontSize: 12, color: 'var(--color-text-2)', marginBottom: 12 }}>
                Optional. Attach invoice PDF, purchase order, or delivery confirmation.
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
                + Attach Files
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
                Back
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  if (validateStep2()) setStep(2)
                }}
              >
                Continue to Review
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
              financingAmount={financingAmount}
              description={description}
              submitError={submitError}
            />
            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : 'Submit for Anchor Approval'}
              </button>
            </div>
          </>
        )}
      </div>
    </PortalShell>
  )
}
