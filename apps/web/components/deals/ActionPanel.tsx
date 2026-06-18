'use client'
// G4.2 — Financing-aware action panel. Receives FinancingContext as props.
// Zero financing logic inside — all logic comes from props and availableActions.
import React, { useState, useRef } from 'react'
import type { FinancingContext } from '@/lib/deals/financing-context'
import type { AvailableAction } from '@/app/api/deals/[id]/available-actions/route'

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Financing Active Warning Banner ───────────────────────────────────────────

function FinancingActiveBanner({ fc }: { fc: FinancingContext }) {
  if (!fc.isActive || fc.structure === 'dynamic_discounting') return null

  const badgeColor = fc.structure === 'reverse_factoring' ? 'var(--blue)'
    : fc.structure === 'invoice_factoring' ? 'var(--blue)'
    : 'var(--blue)'

  return (
    <div style={{ padding: '14px 16px', background: 'rgba(20,40,204,0.06)', border: '1.5px solid rgba(20,40,204,0.22)', borderRadius: 10, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--blue-light)', color: badgeColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          ⚠ {fc.financingBadgeLabel} FINANCING ACTIVE
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.6 }}>
        {fc.paymentWarningMessage}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12 }}>
        <div><span style={{ color: 'var(--gray)' }}>Pay to: </span><strong>{fc.paymentRecipientName}</strong></div>
        <div><span style={{ color: 'var(--gray)' }}>Amount: </span><strong style={{ fontFamily: 'var(--font-mono)' }}>{fmt(fc.paymentAmount, fc.paymentCurrency)}</strong></div>
        {fc.paymentDueDate && <div><span style={{ color: 'var(--gray)' }}>Due: </span><strong>{fmtDate(fc.paymentDueDate)}</strong></div>}
      </div>
    </div>
  )
}

// ── DD Offer Calculator ───────────────────────────────────────────────────────

function DDOfferForm({ fc, action, onSubmit, loading }: {
  fc: FinancingContext
  action: AvailableAction
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  loading: boolean
}) {
  const [discountRate, setDiscountRate] = useState('')
  const [earlyDate, setEarlyDate] = useState('')

  const fullAmount = fc.ddFullAmount ?? fc.paymentAmount
  const originalDue = fc.paymentDueDate

  let preview: { daysEarly: number; discountAmt: number; payAmt: number } | null = null
  if (discountRate && earlyDate && originalDue) {
    const rate = parseFloat(discountRate)
    const daysEarly = Math.max(0, Math.ceil((new Date(originalDue).getTime() - new Date(earlyDate).getTime()) / 86400000))
    const discountAmt = fullAmount * (rate / 100) * (daysEarly / 360)
    preview = { daysEarly, discountAmt, payAmt: fullAmount - discountAmt }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Offer Early Payment</div>
      <div style={{ padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>
        <div><span style={{ color: 'var(--gray)' }}>Invoice amount: </span><strong style={{ fontFamily: 'var(--font-mono)' }}>{fmt(fullAmount, fc.paymentCurrency)}</strong></div>
        {originalDue && <div><span style={{ color: 'var(--gray)' }}>Original due: </span>{fmtDate(originalDue)}</div>}
      </div>
      <div className="form-row-2">
        <div className="form-field">
          <label className="field-label">Discount Rate (% annualized) *</label>
          <input className="input" type="number" step="0.01" min="0" value={discountRate} onChange={e => setDiscountRate(e.target.value)} placeholder="e.g. 5.0" />
        </div>
        <div className="form-field">
          <label className="field-label">Early Payment Date *</label>
          <input className="input" type="date" value={earlyDate} onChange={e => setEarlyDate(e.target.value)} />
        </div>
      </div>
      {preview && (
        <div style={{ padding: '12px 14px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>Preview</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div><span style={{ color: 'var(--gray)' }}>Days early: </span>{preview.daysEarly}</div>
            <div><span style={{ color: 'var(--gray)' }}>Discount amount: </span><span style={{ color: 'var(--color-red)' }}>-{fmt(preview.discountAmt, fc.paymentCurrency)}</span></div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 2 }}>
              <span style={{ color: 'var(--gray)' }}>Supplier receives: </span>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-green)' }}>{fmt(preview.payAmt, fc.paymentCurrency)}</strong>
            </div>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--gray)', fontStyle: 'italic' }}>
            At {discountRate}% annualized, supplier receives {fmt(preview.payAmt, fc.paymentCurrency)} on {fmtDate(earlyDate)} instead of {fmt(fullAmount, fc.paymentCurrency)} on {fmtDate(originalDue)}.
          </div>
        </div>
      )}
      <button
        className="btn btn-primary btn-sm"
        disabled={loading || !discountRate || !earlyDate}
        onClick={() => onSubmit({ discount_rate: parseFloat(discountRate), early_payment_date: earlyDate })}
      >
        {loading ? 'Presenting…' : 'Present Offer to Supplier'}
      </button>
    </div>
  )
}

// ── NOA Acknowledgment ────────────────────────────────────────────────────────

function NOAAcknowledgmentForm({ fc, onSubmit, loading }: {
  fc: FinancingContext
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  loading: boolean
}) {
  const [scrolled, setScrolled] = useState(false)
  const [checked, setChecked] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) {
      if (!scrolled) {
        timerRef.current = setTimeout(() => setScrolled(true), 500)
      }
    }
  }

  React.useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Acknowledge Notice of Assignment</div>
      <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.6 }}>
        {fc.paymentRecipientName} has been assigned this invoice. You must acknowledge receipt before payment instructions are shown.
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ maxHeight: 200, overflowY: 'auto', padding: '12px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.8, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}
      >
        {`NOTICE OF ASSIGNMENT

This invoice has been assigned to ${fc.paymentRecipientName}.

Invoice Amount: ${fc.paymentCurrency} ${fc.paymentAmount}
Due Date: ${fmtDate(fc.paymentDueDate)}

Payment must be made directly to ${fc.paymentRecipientName}.
Payment to the original supplier will not discharge this obligation.

By acknowledging, you confirm that you have read and understood
this Notice of Assignment and that your payment obligation has
transferred to ${fc.paymentRecipientName}.`}
      </div>
      {fc.noaDocumentId && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => window.open(`/api/documents/${fc.noaDocumentId}/url`, '_blank')}
        >
          Download NOA Document
        </button>
      )}
      <label style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--ink)',
        cursor: scrolled ? 'pointer' : 'not-allowed', opacity: scrolled ? 1 : 0.5,
      }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => setChecked(e.target.checked)}
          disabled={!scrolled}
          style={{ marginTop: 2, flexShrink: 0 }}
        />
        I acknowledge receipt of this Notice of Assignment and understand that payment must be made to {fc.paymentRecipientName}.
      </label>
      {!scrolled && (
        <div style={{ fontSize: 11, color: 'var(--gray)', fontStyle: 'italic' }}>
          Scroll to the bottom of the NOA to enable acknowledgment.
        </div>
      )}
      <button
        className="btn btn-primary btn-sm"
        disabled={loading || !checked || !scrolled}
        onClick={() => onSubmit({ acknowledged: true })}
      >
        {loading ? 'Acknowledging…' : 'Acknowledge & Unlock Payment Instructions'}
      </button>
    </div>
  )
}

// ── DD Respond Form ───────────────────────────────────────────────────────────

function DDRespondForm({ fc, onAccept, onDecline, loading }: {
  fc: FinancingContext
  onAccept: () => Promise<void>
  onDecline: () => Promise<void>
  loading: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Early Payment Offer</div>
      <div style={{ padding: '14px 16px', background: 'rgba(16,185,129,0.06)', border: '1.5px solid rgba(16,185,129,0.2)', borderRadius: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--gray)' }}>Invoice amount</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmt(fc.ddFullAmount, fc.paymentCurrency)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--gray)' }}>Early payment date</span>
            <span>{fmtDate(fc.ddEarlyPaymentDate)}</span>
          </div>
          {fc.ddDiscountRate != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--gray)' }}>Discount rate</span>
              <span>{fc.ddDiscountRate}% annualized</span>
            </div>
          )}
          {fc.ddDiscountAmount != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--gray)' }}>Discount amount</span>
              <span style={{ color: 'var(--color-red)' }}>-{fmt(fc.ddDiscountAmount, fc.paymentCurrency)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(16,185,129,0.2)', paddingTop: 6, marginTop: 2 }}>
            <span style={{ fontWeight: 600 }}>You receive</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-green)' }}>{fmt(fc.paymentAmount, fc.paymentCurrency)}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={loading} onClick={onAccept}>
          {loading ? 'Processing…' : 'Accept Early Payment'}
        </button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} disabled={loading} onClick={onDecline}>
          Decline
        </button>
      </div>
    </div>
  )
}

// ── Generic Action Form ───────────────────────────────────────────────────────

function GenericActionForm({ action, onSubmit, loading, error }: {
  action: AvailableAction
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  loading: boolean
  error: string | null
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({})

  function setValue(name: string, value: string | boolean) {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  function buildPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const field of action.requiredFields) {
      if (values[field.name] !== undefined) out[field.name] = values[field.name]
    }
    return out
  }

  const canSubmit = action.requiredFields
    .filter(f => f.required)
    .every(f => {
      const v = values[f.name]
      if (f.type === 'checkbox') return v === true
      return v !== undefined && v !== ''
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
      {action.requiredFields.map(field => (
        <div key={field.name} className="form-field">
          <label className="field-label">{field.label}{field.required ? ' *' : ''}</label>
          {field.type === 'select' ? (
            <select className="input form-select" value={values[field.name] as string ?? ''} onChange={e => setValue(field.name, e.target.value)}>
              <option value="">Select…</option>
              {(field.options ?? []).map(opt => (
                <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
              ))}
            </select>
          ) : field.type === 'checkbox' ? (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, cursor: 'pointer', fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={values[field.name] as boolean ?? false}
                onChange={e => setValue(field.name, e.target.checked)}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              {field.label}
            </label>
          ) : field.type === 'date' ? (
            <input className="input" type="date" value={values[field.name] as string ?? ''} onChange={e => setValue(field.name, e.target.value)} />
          ) : field.type === 'number' ? (
            <input className="input" type="number" step="0.01" value={values[field.name] as string ?? ''} onChange={e => setValue(field.name, e.target.value)} />
          ) : (
            <input className="input" value={values[field.name] as string ?? ''} onChange={e => setValue(field.name, e.target.value)} placeholder={field.label} />
          )}
        </div>
      ))}
      <button
        className={`btn btn-sm ${action.isDestructive ? 'btn-danger' : 'btn-primary'}`}
        disabled={loading || !canSubmit}
        onClick={() => onSubmit(buildPayload())}
      >
        {loading ? 'Processing…' : action.label}
      </button>
    </div>
  )
}

// ── Contract Submit Form ──────────────────────────────────────────────────────

type ContractPhase = 'form' | 'generating' | 'preview' | 'uploading'

function ContractSubmitForm({ dealId, onSubmit, loading }: {
  dealId: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  loading: boolean
}) {
  const [phase, setPhase]             = useState<ContractPhase>('form')
  const [previewText, setPreviewText] = useState<string>('')
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [file, setFile]               = useState<File | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [showUpload, setShowUpload]   = useState(false)

  async function generatePreview() {
    setError(null)
    setPhase('generating')
    try {
      const res = await fetch(`/api/deals/${dealId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Generation failed'); setPhase('form'); return }
      setPreviewText(json.content ?? '')
      setPreviewDocId(json.document_id ?? null)
      setPhase('preview')
    } catch {
      setError('Failed to generate contract')
      setPhase('form')
    }
  }

  async function downloadPdf() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/deals/${dealId}/download-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'contract' }),
      })
      if (!res.ok) { alert('Failed to generate PDF'); return }
      const buf = await res.arrayBuffer()
      const blob = new Blob([buf], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trade-agreement-${dealId.slice(0, 8).toUpperCase()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  async function sendToSupplier() {
    if (!previewDocId) return
    await onSubmit({ generate_contract: false, contract_document_id: previewDocId })
  }

  async function handleUpload() {
    if (!file) { setError('Please select a contract document'); return }
    setUploadingFile(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('document_kind', 'trade_contract')
      const res = await fetch(`/api/deals/${dealId}/upload-document`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Upload failed'); return }
      await onSubmit({ generate_contract: false, contract_document_id: json.document.id })
    } catch {
      setError('Upload failed')
    } finally {
      setUploadingFile(false)
    }
  }

  // ── Generating spinner ──
  if (phase === 'generating') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Generating Contract…</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--gray)', lineHeight: 1.6 }}>
          <span style={{ color: 'var(--blue)', flexShrink: 0 }}>✦</span>
          Strike AI is drafting your trade agreement from the deal terms. This takes 10–20 seconds.
        </div>
      </div>
    )
  }

  // ── Preview ──
  if (phase === 'preview') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Contract Preview</span>
          <span className="badge badge-active" style={{ fontSize: 9, fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0 }}>AI Generated</span>
        </div>
        <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.65, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 340, overflowY: 'auto', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', margin: 0 }}>
          {previewText}
        </pre>
        <div style={{ fontSize: 11, color: 'var(--gray)', lineHeight: 1.5 }}>
          Review the contract above before sending. The supplier will see the same document.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-blue btn-sm" disabled={downloading} onClick={downloadPdf}>
            {downloading ? '✦ Generating…' : '✦ Download PDF'}
          </button>
          <button className="btn btn-primary btn-sm" disabled={loading} onClick={sendToSupplier}>
            {loading ? 'Sending…' : 'Send to Supplier →'}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={loading} onClick={() => { setPhase('form'); setPreviewDocId(null); setPreviewText('') }}>
            Regenerate
          </button>
        </div>
      </div>
    )
  }

  // ── Upload mode ──
  if (showUpload) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Upload Contract</div>
        <div className="form-field">
          <label className="field-label">Contract Document *</label>
          <input
            className="input"
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            style={{ paddingTop: 6 }}
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>{file.name}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={loading || uploadingFile || !file} onClick={handleUpload}>
            {uploadingFile ? 'Uploading…' : loading ? 'Submitting…' : 'Submit Contract'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowUpload(false); setError(null) }}>
            ← Back
          </button>
        </div>
      </div>
    )
  }

  // ── Default form ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Generate Contract</div>
      <div style={{ padding: '12px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: 'var(--gray)' }}>
        <span style={{ color: 'var(--blue)', marginRight: 6 }}>✦</span>
        Strike AI will draft a trade agreement from your deal terms. You'll see a full preview before it's sent to the supplier.
      </div>
      <button className="btn btn-primary btn-sm" onClick={generatePreview}>
        Generate Contract with AI
      </button>
      <button
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 11, alignSelf: 'flex-start' }}
        onClick={() => { setShowUpload(true); setError(null) }}
      >
        Upload your own document instead
      </button>
    </div>
  )
}

// ── Contract Sign Form ────────────────────────────────────────────────────────

function ContractSignForm({ onSubmit, loading }: {
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  loading: boolean
}) {
  const [signature, setSignature] = useState('')
  const [bankAccounts, setBankAccounts] = useState<any[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
    fetch('/api/settings/bank-accounts')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.accounts) {
          setBankAccounts(d.accounts)
          const primary = d.accounts.find((a: any) => a.is_primary)
          if (primary) setSelectedAccountId(primary.id)
          else if (d.accounts.length > 0) setSelectedAccountId(d.accounts[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAccounts(false))
  }, [])

  async function handleSubmit() {
    if (!signature.trim()) { setError('Signature is required'); return }
    if (!selectedAccountId) { setError('Please select a bank account to receive payment'); return }
    setError(null)
    await onSubmit({ contract_supplier_signature: signature.trim(), receiving_bank_account_id: selectedAccountId })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Sign Contract</div>
      <div className="form-field">
        <label className="field-label">Receiving Bank Account *</label>
        {loadingAccounts ? (
          <div style={{ fontSize: 12, color: 'var(--gray)' }}>Loading accounts…</div>
        ) : bankAccounts.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-orange)', padding: '8px 12px', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: 8 }}>
            No bank accounts found. <a href="/settings" style={{ color: 'var(--blue)' }}>Add one in Settings</a> before signing.
          </div>
        ) : (
          <select className="input form-select" value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}>
            <option value="">Select account…</option>
            {bankAccounts.map((acct: any) => (
              <option key={acct.id} value={acct.id}>
                {acct.nickname || acct.bank_name} — {acct.account_holder_name} ****{acct.account_number?.slice(-4) ?? ''}
                {acct.is_primary ? ' (Primary)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="form-field">
        <label className="field-label">Typed Signature (Full Legal Name) *</label>
        <input
          className="input"
          type="text"
          value={signature}
          onChange={e => setSignature(e.target.value)}
          placeholder="Enter your full legal name"
        />
        <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>By typing your name you electronically sign this contract.</div>
      </div>
      <button
        className="btn btn-primary btn-sm"
        disabled={loading || !signature.trim() || !selectedAccountId || loadingAccounts || bankAccounts.length === 0}
        onClick={handleSubmit}
      >
        {loading ? 'Signing…' : 'Sign Contract'}
      </button>
    </div>
  )
}

// ── Main ActionPanel ──────────────────────────────────────────────────────────

export interface ActionPanelProps {
  dealId: string
  availableActions: AvailableAction[]
  financingContext: FinancingContext
  currentUserRole: 'buyer' | 'supplier' | 'bank'
  hasDDOffer?: boolean
  onActionSubmit: (action: string, payload: Record<string, unknown>) => Promise<void>
  onRefresh: () => void
}

export function ActionPanel({
  dealId,
  availableActions,
  financingContext: fc,
  currentUserRole: userRole,
  hasDDOffer,
  onActionSubmit,
}: ActionPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedAction, setExpandedAction] = useState<string | null>(null)

  async function handleSubmit(action: string, payload: Record<string, unknown>) {
    setLoading(true)
    setError(null)
    try {
      await onActionSubmit(action, payload)
      setExpandedAction(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setLoading(false)
    }
  }

  // Special: DD respond (supplier side, active DD offer)
  if (hasDDOffer && fc.structure === 'dynamic_discounting' && !fc.isActive && userRole === 'supplier') {
    return (
      <div>
        <FinancingActiveBanner fc={fc} />
        <DDRespondForm
          fc={fc}
          loading={loading}
          onAccept={() => handleSubmit('dd_accept', {})}
          onDecline={() => handleSubmit('dd_decline', {})}
        />
        {error && <div className="alert alert-error" style={{ fontSize: 12, marginTop: 10 }}>{error}</div>}
      </div>
    )
  }

  const availableOnes = availableActions.filter(a => a.available)
  const blockedOnes   = availableActions.filter(a => !a.available)

  if (availableOnes.length === 0 && blockedOnes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-amber)', flexShrink: 0, animation: 'pulse-dot 2s ease infinite' }} />
        <span style={{ fontSize: 13, color: 'var(--gray)' }}>Waiting for counterparty action.</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FinancingActiveBanner fc={fc} />

      {availableOnes.map(action => {
        const isExpanded = expandedAction === action.action
        const isDDPresent = action.action === 'present_dd_offer'
        const isNOA = action.action === 'acknowledge_noa'
        const isContractSubmit = action.action === 'submit_contract'
        const isContractSign = action.action === 'sign_contract'
        const hasFields = action.requiredFields.length > 0

        return (
          <div key={action.action}>
            {!isExpanded ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  className={`btn btn-sm ${action.isDestructive ? 'btn-danger' : 'btn-primary'}`}
                  onClick={() => {
                    if (hasFields || isDDPresent || isNOA || isContractSubmit || isContractSign) {
                      setExpandedAction(action.action)
                    } else {
                      handleSubmit(action.action, {})
                    }
                  }}
                  disabled={loading}
                >
                  {loading ? 'Processing…' : action.label}
                </button>
                {action.description && (
                  <div style={{ fontSize: 11, color: 'var(--gray)', lineHeight: 1.5 }}>{action.description}</div>
                )}
                {action.financingNote && (
                  <div style={{ fontSize: 11, color: 'var(--blue)', fontStyle: 'italic', lineHeight: 1.5 }}>{action.financingNote}</div>
                )}
              </div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                {isDDPresent ? (
                  <DDOfferForm
                    fc={fc}
                    action={action}
                    onSubmit={p => handleSubmit(action.action, p)}
                    loading={loading}
                  />
                ) : isNOA ? (
                  <NOAAcknowledgmentForm
                    fc={fc}
                    onSubmit={p => handleSubmit(action.action, p)}
                    loading={loading}
                  />
                ) : isContractSubmit ? (
                  <ContractSubmitForm
                    dealId={dealId}
                    onSubmit={p => handleSubmit(action.action, p)}
                    loading={loading}
                  />
                ) : isContractSign ? (
                  <ContractSignForm
                    onSubmit={p => handleSubmit(action.action, p)}
                    loading={loading}
                  />
                ) : (
                  <GenericActionForm
                    action={action}
                    onSubmit={p => handleSubmit(action.action, p)}
                    loading={loading}
                    error={error}
                  />
                )}
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setExpandedAction(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )
      })}

      {blockedOnes.map(action => (
        <div key={action.action} style={{ padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--gray)', opacity: 0.7 }}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{action.label}</div>
          {action.unavailableReason && <div>{action.unavailableReason}</div>}
        </div>
      ))}

      {error && <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>}
    </div>
  )
}
