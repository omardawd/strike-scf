'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { useUser } from '@/lib/user-context'
import type { Deal, Organization, Room, FinancingRequest, FinancingStructure, FinancingType, AmendmentRecord } from '@strike-scf/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealDoc { id: string; name: string; document_kind: string; mime_type: string; created_at: string }
interface AiDoc   { kind: 'ai_po' | 'ai_invoice' | 'ai_contract'; content: string; generated_at: string | null }
interface UploadedDoc { id: string; kind: string; name: string; url: string | null; created_at: string }

interface LinkedTransaction {
  id: string
  status: string
  financing_amount_approved: number | null
  repayment_due_date: string | null
  tenor_days: number | null
  financing_rate_apr: number | null
  bank?: { id: string; display_name: string; legal_name: string } | null
}

interface DealDetail {
  deal: Deal & { agreed_price?: number }
  buyer_org: Organization | null
  supplier_org: Organization | null
  room: { id: string; name: string } | null
  financing_request: FinancingRequest | null
  linked_transaction: LinkedTransaction | null
  documents: DealDoc[]
  user_role: 'buyer' | 'supplier'
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROADMAP_STEPS = [
  { key: 'agreed',             label: 'Agreed' },
  { key: 'documents_pending',  label: 'Documents' },
  { key: 'confirmed',          label: 'Confirmed' },
  { key: 'in_preparation',     label: 'Preparation' },
  { key: 'shipped',            label: 'Shipped' },
  { key: 'delivery_confirmed', label: 'Delivered' },
  { key: 'payment',            label: 'Payment' },
  { key: 'completed',          label: 'Completed' },
]

function statusToStepIndex(status: string): number {
  switch (status) {
    case 'negotiating':         return -1
    case 'agreed':              return 0
    case 'documents_pending':   return 1
    case 'confirmed':
    case 'active':              return 2
    case 'in_preparation':      return 3
    case 'shipped':             return 4
    case 'delivery_confirmed':
    case 'payment_due':
    case 'payment_overdue':     return 5
    case 'payment_confirmed':   return 6
    case 'completed':           return 7
    default:                    return -1
  }
}

const AI_DOC_LABELS: Record<string, string> = {
  ai_po: 'PURCHASE ORDER', ai_invoice: 'COMMERCIAL INVOICE', ai_contract: 'TRADE AGREEMENT',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function shortId(id: string): string { return id.slice(0, 8).toUpperCase() }

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'negotiating':         return 'badge badge-draft'
    case 'agreed':              return 'badge badge-signing'
    case 'documents_pending':   return 'badge badge-pending'
    case 'confirmed':
    case 'active':              return 'badge badge-active'
    case 'in_preparation':      return 'badge badge-offer'
    case 'shipped':             return 'badge badge-active'
    case 'delivery_confirmed':
    case 'payment_due':         return 'badge badge-active'
    case 'payment_overdue':     return 'badge badge-overdue'
    case 'payment_confirmed':   return 'badge badge-funded'
    case 'financing_requested': return 'badge badge-offer'
    case 'financing_active':    return 'badge badge-funded'
    case 'completed':           return 'badge badge-completed'
    case 'in_dispute':
    case 'disputed':            return 'badge badge-overdue'
    case 'cancelled':           return 'badge badge-rejected'
    default:                    return 'badge badge-draft'
  }
}

function sourceBadgeClass(source: string): string {
  switch (source) {
    case 'marketplace': return 'badge badge-active'
    case 'imported':    return 'badge badge-pending'
    default:            return 'badge badge-draft'
  }
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

// ─── Roadmap (G2.1) ───────────────────────────────────────────────────────────

function DealRoadmap({ status, financingActive, bankName }: {
  status: string; financingActive: boolean; bankName?: string | null
}) {
  const currentIdx  = statusToStepIndex(status)
  const isDispute   = ['in_dispute', 'disputed'].includes(status)
  const isCancelled = status === 'cancelled'

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 480 }}>
        {ROADMAP_STEPS.map((step, i) => {
          const isPast    = i < currentIdx
          const isCurrent = i === currentIdx
          const isLast    = i === ROADMAP_STEPS.length - 1
          const isPayment = step.key === 'payment'
          const isPayOverdue = isCurrent && ['payment_due', 'payment_overdue'].includes(status)
          const dotBg = isCancelled
            ? 'var(--border-strong)'
            : isDispute && isCurrent
            ? 'var(--color-red)'
            : isPayOverdue
            ? '#F59E0B'
            : isCurrent
            ? 'var(--blue)'
            : isPast
            ? 'var(--color-green)'
            : 'var(--offwhite)'
          const dotBorder = (isPast || isCurrent) ? 'none' : '2px solid var(--border-strong)'
          const lineColor = isPast ? 'var(--color-green)' : 'var(--border)'
          return (
            <div key={step.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: isLast ? '0 0 auto' : 1, minWidth: 64 }}>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {i > 0 && <div style={{ flex: 1, height: 2, background: lineColor }} />}
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: dotBg, border: dotBorder,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: isCurrent && !isCancelled ? `0 0 0 4px ${isPayOverdue ? 'rgba(245,158,11,0.18)' : 'var(--blue-light)'}` : 'none',
                }}>
                  {isPast && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {isCurrent && isDispute && <span style={{ fontSize: 10, color: 'white', fontWeight: 700 }}>!</span>}
                </div>
                {!isLast && <div style={{ flex: 1, height: 2, background: lineColor }} />}
              </div>
              <div style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase',
                color: isCancelled ? 'var(--gray-soft)' : isCurrent ? 'var(--ink)' : isPast ? 'var(--color-green)' : 'var(--gray-soft)',
                fontWeight: isCurrent ? 700 : 400, marginTop: 7, textAlign: 'center', whiteSpace: 'nowrap',
              }}>{step.label}</div>
              {isPayment && financingActive && bankName && isCurrent && (
                <div style={{ fontSize: 9, color: 'var(--blue)', fontFamily: 'var(--font-body)', marginTop: 2, textAlign: 'center', maxWidth: 72 }}>
                  Via {bankName}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {isCancelled && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 8, fontSize: 12, color: 'var(--color-red)', textAlign: 'center' }}>
          This deal was cancelled
        </div>
      )}
      {isDispute && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 8, fontSize: 12, color: 'var(--color-red)', textAlign: 'center' }}>
          This deal is in dispute
        </div>
      )}
    </div>
  )
}

// ─── Action Panel (G2.2) ─────────────────────────────────────────────────────

function Waiting({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-amber)', flexShrink: 0, animation: 'pulse-dot 2s ease infinite' }} />
      <span style={{ fontSize: 13, color: 'var(--gray)' }}>{msg}</span>
    </div>
  )
}

function ActionPanel({ deal, userRole, counterparty, linkedTransaction, onRefresh }: {
  deal: Deal; userRole: 'buyer' | 'supplier'
  counterparty: Organization | null; linkedTransaction: LinkedTransaction | null
  onRefresh: () => void
}) {
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [showPayInstr, setShowPayInstr]     = useState(false)
  const [piBank, setPiBank]                 = useState('')
  const [piAccountName, setPiAccountName]   = useState('')
  const [piAccountNumber, setPiAccountNumber] = useState('')
  const [piRouting, setPiRouting]           = useState('')
  const [piSwift, setPiSwift]               = useState('')
  const [piRef, setPiRef]                   = useState('')
  const [piCurrency, setPiCurrency]         = useState(deal.agreed_currency ?? 'USD')
  const [showShipForm, setShowShipForm]     = useState(false)
  const [shipTracking, setShipTracking]     = useState('')
  const [shipCarrier, setShipCarrier]       = useState('')
  const [shipEstDelivery, setShipEstDelivery] = useState('')
  const [shipFile, setShipFile]             = useState<File | null>(null)
  const [shipDocId, setShipDocId]           = useState<string | null>(null)
  const [shipDocUploading, setShipDocUploading] = useState(false)
  const [showDeliveryForm, setShowDeliveryForm] = useState(false)
  const [disputeCategory, setDisputeCategory]   = useState('')
  const [disputeReason, setDisputeReason]       = useState('')
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [payDate, setPayDate]   = useState('')
  const [payRef, setPayRef]     = useState('')
  const [payAmount, setPayAmount] = useState('')

  const id = deal.id
  const financingActive = deal.financing_payment_active ?? false
  const bankName = linkedTransaction?.bank?.display_name ?? linkedTransaction?.bank?.legal_name ?? null
  const repaymentAmount = linkedTransaction?.financing_amount_approved ?? null
  const repaymentDue = linkedTransaction?.repayment_due_date ?? null
  const cp = counterparty?.legal_name ?? 'counterparty'
  const dueInDays = daysUntil(deal.payment_due_date)
  const isOverdue = deal.payment_due_date ? new Date(deal.payment_due_date) < new Date() : false
  const status = deal.status

  async function post(path: string, body: Record<string, unknown>): Promise<boolean> {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/deals/${id}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Action failed'); return false }
      onRefresh(); return true
    } catch { setError('Network error'); return false }
    finally { setLoading(false) }
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/deals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Action failed'); return false }
      onRefresh(); return true
    } catch { setError('Network error'); return false }
    finally { setLoading(false) }
  }

  async function uploadShipDoc(file: File): Promise<string | null> {
    setShipDocUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('document_kind', 'commercial_invoice')
      const res = await fetch(`/api/deals/${id}/upload-document`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Upload failed'); return null }
      return json.document?.id ?? null
    } finally { setShipDocUploading(false) }
  }

  async function submitPaymentInstructions() {
    const ok = await post('/payment-instructions', {
      payment_bank_name: piBank, payment_account_name: piAccountName,
      payment_account_number: piAccountNumber || undefined,
      payment_routing_number: piRouting || undefined,
      payment_swift_iban: piSwift || undefined,
      payment_reference: piRef || undefined, payment_currency: piCurrency,
    })
    if (ok) setShowPayInstr(false)
  }

  async function submitShipment() {
    let docId = shipDocId
    if (shipFile && !docId) { docId = await uploadShipDoc(shipFile); if (!docId) return; setShipDocId(docId) }
    const ok = await post('/ship', { shipment_tracking_ref: shipTracking, shipment_carrier: shipCarrier, shipment_estimated_delivery: shipEstDelivery || undefined, commercial_invoice_id: docId })
    if (ok) setShowShipForm(false)
  }

  async function raiseDispute() {
    if (!disputeCategory || !disputeReason) { setError('Category and reason are required'); return }
    const ok = await post('/delivery', { action: 'dispute', dispute_category: disputeCategory, dispute_reason: disputeReason })
    if (ok) setShowDeliveryForm(false)
  }

  async function submitPayment() {
    const ok = await post('/payment', { action: 'buyer_confirm', payment_date: payDate || undefined, payment_external_reference: payRef || undefined, payment_amount: payAmount ? parseFloat(payAmount) : undefined })
    if (ok) setShowPaymentForm(false)
  }

  function OverdueBanner() {
    if (!deal.payment_due_date) return null
    if (status === 'payment_overdue' || isOverdue) {
      return <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 12, color: 'var(--color-red)', marginBottom: 12 }}>Payment was due on {fmtDate(deal.payment_due_date)} — now overdue.</div>
    }
    if (dueInDays !== null && dueInDays <= 3) {
      return <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, fontSize: 12, color: '#92400e', marginBottom: 12 }}>Payment due in {dueInDays} day{dueInDays !== 1 ? 's' : ''} ({fmtDate(deal.payment_due_date)}).</div>
    }
    return null
  }

  function FinancingNotice() {
    if (!financingActive || !bankName) return null
    return (
      <div style={{ padding: '12px 14px', background: 'rgba(20,40,204,0.06)', border: '1.5px solid rgba(20,40,204,0.18)', borderRadius: 8, fontSize: 12, color: 'var(--ink)', marginBottom: 12, lineHeight: 1.6 }}>
        <strong>Financing is active on this deal.</strong><br/>
        {userRole === 'buyer'
          ? `${cp} received an advance from ${bankName}. Payment must be made to ${bankName}, not ${cp}. Paying the seller directly will not satisfy your financing obligation.`
          : `You received an advance from ${bankName}. Repayment is the buyer's obligation.`}
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="alert alert-error" style={{ fontSize: 12 }}>{error}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
      </div>
    )
  }

  // AGREED / DOCUMENTS_PENDING ─ Seller
  if (['agreed', 'documents_pending'].includes(status) && userRole === 'supplier') {
    const hasInstr = !!deal.payment_instructions_set_at
    if (hasInstr) return <Waiting msg={`Awaiting buyer to upload their Purchase Order`} />
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Set payment instructions</div>
        <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.6 }}>Provide your bank details so the buyer knows where to send payment.</div>
        {!showPayInstr ? (
          <button className="btn btn-primary btn-sm" onClick={() => setShowPayInstr(true)}>Set Payment Instructions</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-field"><label className="field-label">Bank Name *</label><input className="input" value={piBank} onChange={e => setPiBank(e.target.value)} placeholder="e.g. Chase" /></div>
            <div className="form-field"><label className="field-label">Account Holder Name *</label><input className="input" value={piAccountName} onChange={e => setPiAccountName(e.target.value)} /></div>
            <div className="form-row-2">
              <div className="form-field"><label className="field-label">Account Number</label><input className="input" value={piAccountNumber} onChange={e => setPiAccountNumber(e.target.value)} /></div>
              <div className="form-field"><label className="field-label">Routing / SWIFT / IBAN</label><input className="input" value={piSwift || piRouting} onChange={e => { setPiSwift(e.target.value); setPiRouting('') }} /></div>
            </div>
            <div className="form-row-2">
              <div className="form-field"><label className="field-label">Payment Reference</label><input className="input" value={piRef} onChange={e => setPiRef(e.target.value)} placeholder="e.g. invoice number" /></div>
              <div className="form-field"><label className="field-label">Currency</label><input className="input" value={piCurrency} onChange={e => setPiCurrency(e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={loading || !piBank || !piAccountName} onClick={submitPaymentInstructions}>{loading ? 'Saving…' : 'Save & Submit'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPayInstr(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // AGREED / DOCUMENTS_PENDING ─ Buyer
  if (['agreed', 'documents_pending'].includes(status) && userRole === 'buyer') {
    if (!deal.payment_instructions_set_at) return <Waiting msg={`Waiting for ${cp} to issue proforma invoice and payment instructions`} />
    if (status === 'documents_pending') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Upload your Purchase Order</div>
          <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.6 }}>Review the seller&apos;s terms and upload your PO to confirm the deal. You can attach files in the Documents section.</div>
          <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => patch({ status: 'confirmed' })}>{loading ? 'Confirming…' : 'Confirm & Proceed'}</button>
        </div>
      )
    }
    return <Waiting msg={`Waiting for ${cp} to issue proforma invoice`} />
  }

  // CONFIRMED ─ Seller
  if (status === 'confirmed' && userRole === 'supplier') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6 }}>Deal confirmed. Start preparing the order.</div>
        <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => patch({ status: 'in_preparation' })}>{loading ? 'Updating…' : 'Start Preparation'}</button>
      </div>
    )
  }

  if (status === 'confirmed' && userRole === 'buyer') return <Waiting msg="Deal confirmed. Waiting for seller to begin preparation." />

  // IN_PREPARATION ─ Seller
  if (status === 'in_preparation' && userRole === 'supplier') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!showShipForm ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--gray)' }}>Order is in preparation. Mark it shipped when ready.</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowShipForm(true)}>Mark as Shipped</button>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Shipment details</div>
            <div className="form-field"><label className="field-label">Tracking Reference *</label><input className="input" value={shipTracking} onChange={e => setShipTracking(e.target.value)} placeholder="e.g. MSKU1234567" /></div>
            <div className="form-field"><label className="field-label">Carrier *</label><input className="input" value={shipCarrier} onChange={e => setShipCarrier(e.target.value)} placeholder="e.g. Maersk, FedEx Freight" /></div>
            <div className="form-field"><label className="field-label">Estimated Delivery Date</label><input className="input" type="date" value={shipEstDelivery} onChange={e => setShipEstDelivery(e.target.value)} /></div>
            <div className="form-field">
              <label className="field-label">Commercial Invoice</label>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>This document will be used for any financing requests.</div>
              {shipDocId ? <div style={{ fontSize: 12, color: 'var(--color-green)' }}>✓ Uploaded</div>
                : <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={e => setShipFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={loading || shipDocUploading || !shipTracking || !shipCarrier} onClick={submitShipment}>
                {shipDocUploading ? 'Uploading…' : loading ? 'Submitting…' : 'Confirm Shipment'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowShipForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (status === 'in_preparation' && userRole === 'buyer') {
    return <div style={{ fontSize: 13, color: 'var(--gray)' }}>Order in preparation.{deal.shipment_estimated_delivery ? <> Est. ship: <strong>{fmtDate(deal.shipment_estimated_delivery)}</strong></> : null}</div>
  }

  // SHIPPED ─ Seller
  if (status === 'shipped' && userRole === 'supplier') return <Waiting msg={`Waiting for ${cp} to confirm delivery`} />

  // SHIPPED ─ Buyer
  if (status === 'shipped' && userRole === 'buyer') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {deal.shipment_tracking_ref && (
          <div style={{ padding: '10px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ color: 'var(--gray)', marginBottom: 3 }}>Tracking</div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{deal.shipment_tracking_ref}</div>
            {deal.shipment_carrier && <div style={{ color: 'var(--gray)', marginTop: 2 }}>{deal.shipment_carrier}</div>}
            {deal.shipment_estimated_delivery && <div style={{ color: 'var(--gray)', marginTop: 2 }}>Est. delivery: {fmtDate(deal.shipment_estimated_delivery)}</div>}
          </div>
        )}
        {!showDeliveryForm ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => post('/delivery', { action: 'confirm' })}>{loading ? 'Confirming…' : 'Confirm Delivery'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowDeliveryForm(true)}>Raise a Dispute</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-red)' }}>Raise a dispute</div>
            <div className="form-field">
              <label className="field-label">Category *</label>
              <select className="input form-select" value={disputeCategory} onChange={e => setDisputeCategory(e.target.value)}>
                <option value="">Select category</option>
                <option value="non_delivery">Non-delivery</option>
                <option value="wrong_goods">Wrong goods</option>
                <option value="quality_issue">Quality issue</option>
                <option value="document_dispute">Document dispute</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="form-field">
              <label className="field-label">Describe the issue *</label>
              <textarea className="input" rows={3} value={disputeReason} onChange={e => setDisputeReason(e.target.value)} placeholder="Describe what happened" style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-danger btn-sm" disabled={loading || !disputeCategory || !disputeReason} onClick={raiseDispute}>{loading ? 'Submitting…' : 'Submit Dispute'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDeliveryForm(false)}>Back</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // DELIVERY_CONFIRMED / PAYMENT_DUE / PAYMENT_OVERDUE ─ Seller
  if (['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(status) && userRole === 'supplier') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FinancingNotice />
        {financingActive && bankName
          ? <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6 }}>Your advance of {fmt(repaymentAmount, deal.agreed_currency)} was received from {bankName}. Repayment is the buyer&apos;s obligation.</div>
          : <Waiting msg={`Waiting for ${cp} to send payment`} />}
        {deal.payment_due_date && <div style={{ fontSize: 12, color: 'var(--gray)' }}>Payment due: {fmtDate(deal.payment_due_date)}</div>}
      </div>
    )
  }

  // DELIVERY_CONFIRMED / PAYMENT_DUE / PAYMENT_OVERDUE ─ Buyer
  if (['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(status) && userRole === 'buyer') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <OverdueBanner />
        <FinancingNotice />
        {!financingActive && deal.payment_bank_name && (
          <div style={{ padding: '12px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>Payment Instructions</div>
            {deal.payment_bank_name && <div style={{ fontSize: 13, marginBottom: 4 }}>{deal.payment_bank_name}</div>}
            {deal.payment_account_name && <div style={{ fontSize: 12, color: 'var(--gray)' }}>Account: {deal.payment_account_name}</div>}
            {deal.payment_account_number && <div style={{ fontSize: 12, color: 'var(--gray)' }}>Acct #: ****{deal.payment_account_number.slice(-4)}</div>}
            {(deal.payment_swift_iban ?? deal.payment_routing_number) && <div style={{ fontSize: 12, color: 'var(--gray)' }}>SWIFT/Routing: {deal.payment_swift_iban ?? deal.payment_routing_number}</div>}
            {deal.payment_reference && <div style={{ fontSize: 12, color: 'var(--gray)' }}>Ref: {deal.payment_reference}</div>}
          </div>
        )}
        {financingActive && bankName && (
          <div style={{ padding: '12px 14px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>Repayment to {bankName}</div>
            {repaymentAmount && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{fmt(repaymentAmount, deal.agreed_currency)}</div>}
            {repaymentDue && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>Due: {fmtDate(repaymentDue)}</div>}
          </div>
        )}
        {!showPaymentForm ? (
          <button className="btn btn-primary btn-sm" onClick={() => setShowPaymentForm(true)}>
            {financingActive && bankName ? `Confirm Repayment Sent to ${bankName}` : 'Confirm Payment Sent'}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-row-2">
              <div className="form-field"><label className="field-label">Payment Date</label><input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
              <div className="form-field"><label className="field-label">Amount Sent</label><input className="input" type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} /></div>
            </div>
            <div className="form-field"><label className="field-label">Bank Reference Number</label><input className="input" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Your bank's transaction ID" /></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={loading} onClick={submitPayment}>{loading ? 'Submitting…' : 'Confirm Payment'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPaymentForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // PAYMENT_CONFIRMED ─ Seller
  if (status === 'payment_confirmed' && userRole === 'supplier') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {deal.payment_external_reference && <div style={{ fontSize: 12, color: 'var(--gray)' }}>Buyer reference: <strong>{deal.payment_external_reference}</strong></div>}
        <div style={{ fontSize: 13, color: 'var(--gray)' }}>Confirm that you have received the payment to complete this deal.</div>
        <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => post('/payment', { action: 'seller_confirm' })}>{loading ? 'Completing…' : 'Confirm Payment Received'}</button>
      </div>
    )
  }

  if (status === 'payment_confirmed' && userRole === 'buyer') return <Waiting msg={`Payment sent. Waiting for ${cp} to confirm receipt.`} />

  // IN_DISPUTE
  if (['in_dispute', 'disputed'].includes(status)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--color-red)', fontWeight: 600 }}>Dispute in progress</div>
        <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.6 }}>Submit evidence below. Strike Admin will mediate.</div>
        {financingActive && bankName && (
          <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 8, fontSize: 12, color: 'var(--color-red)', lineHeight: 1.6 }}>
            Repayment of {fmt(repaymentAmount, deal.agreed_currency)} to {bankName} is still due{repaymentDue ? ` on ${fmtDate(repaymentDue)}` : ''}. The dispute does not pause this obligation.
          </div>
        )}
      </div>
    )
  }

  if (status === 'completed') return <div style={{ fontSize: 13, color: 'var(--color-green)', fontWeight: 600 }}>Deal complete.</div>
  if (status === 'cancelled') return <div style={{ fontSize: 13, color: 'var(--gray)' }}>Deal was cancelled.{deal.cancellation_reason ? ` Reason: ${deal.cancellation_reason}` : ''}</div>

  return null
}

// ─── Amendment Banner ─────────────────────────────────────────────────────────

function AmendmentBanner({ deal, userRole, onRefresh }: { deal: Deal; userRole: 'buyer' | 'supplier'; onRefresh: () => void }) {
  const [responding, setResponding] = useState(false)
  const history: AmendmentRecord[] = Array.isArray(deal.amendment_history) ? deal.amendment_history : []
  const pending = history.find(a => a.status === 'pending')
  if (!pending) return null

  const iAmProposed = false // simplified — server enforces who can respond

  async function respond(accepted: boolean) {
    if (!pending) return
    setResponding(true)
    try {
      await fetch(`/api/deals/${deal.id}/amendment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amendment_id: pending.id, response: accepted ? 'accepted' : 'rejected' }),
      })
      onRefresh()
    } finally { setResponding(false) }
  }

  return (
    <div style={{ padding: '14px 16px', background: 'rgba(20,40,204,0.04)', border: '1.5px solid rgba(20,40,204,0.2)', borderRadius: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 8 }}>Amendment Pending</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <div><span style={{ color: 'var(--gray)' }}>Field: </span>{pending.field.replace(/_/g, ' ')}</div>
        <div><span style={{ color: 'var(--gray)' }}>From: </span>{String(pending.current_value ?? '—')}</div>
        <div><span style={{ color: 'var(--blue)', fontWeight: 600 }}>To: </span>{String(pending.proposed_value ?? '—')}</div>
      </div>
      {pending.reason && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>Reason: {pending.reason}</div>}
      {!iAmProposed && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" disabled={responding} onClick={() => respond(true)}>Accept</button>
          <button className="btn btn-ghost btn-sm" disabled={responding} onClick={() => respond(false)}>Reject</button>
        </div>
      )}
    </div>
  )
}

// ─── Propose Amendment Form ───────────────────────────────────────────────────

function ProposeAmendmentForm({ deal, onRefresh }: { deal: Deal; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState('')
  const [proposedValue, setProposedValue] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (deal.financing_payment_active) return null
  if (!['confirmed', 'in_preparation', 'active'].includes(deal.status)) return null

  const FIELDS = [
    { key: 'agreed_quantity', label: 'Quantity', current: String(deal.agreed_quantity ?? '—') },
    { key: 'agreed_price', label: 'Unit Price', current: String(deal.agreed_price) },
    { key: 'agreed_delivery_date', label: 'Delivery Date', current: String(deal.agreed_delivery_date ?? '—') },
    { key: 'agreed_payment_terms', label: 'Payment Terms', current: String(deal.agreed_payment_terms ?? '—') },
    { key: 'import_notes', label: 'Notes', current: String(deal.import_notes ?? '—') },
  ]

  async function submit() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/deals/${deal.id}/amendment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, proposed_value: proposedValue, reason }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed'); return }
      setOpen(false); setField(''); setProposedValue(''); setReason(''); onRefresh()
    } finally { setLoading(false) }
  }

  return (
    <div>
      {!open ? (
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--gray)' }} onClick={() => setOpen(true)}>Propose Amendment</button>
      ) : (
        <div style={{ padding: '14px 16px', border: '1px solid var(--border)', borderRadius: 12, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>Propose Amendment</div>
          {error && <div className="alert alert-error" style={{ fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div className="form-field" style={{ marginBottom: 10 }}>
            <label className="field-label">Field to amend</label>
            <select className="input form-select" value={field} onChange={e => { setField(e.target.value); setProposedValue('') }}>
              <option value="">Select field</option>
              {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label} (current: {f.current})</option>)}
            </select>
          </div>
          {field && <div className="form-field" style={{ marginBottom: 10 }}><label className="field-label">New value</label><input className="input" value={proposedValue} onChange={e => setProposedValue(e.target.value)} /></div>}
          <div className="form-field" style={{ marginBottom: 10 }}><label className="field-label">Reason *</label><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this change needed?" /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={loading || !field || !proposedValue || !reason} onClick={submit}>{loading ? 'Submitting…' : 'Propose'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Dispute Evidence Panel ───────────────────────────────────────────────────

function DisputeEvidencePanel({ deal, onRefresh }: { deal: Deal; onRefresh: () => void }) {
  const [statement, setStatement] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  if (!['in_dispute', 'disputed'].includes(deal.status)) return null
  async function submit() {
    if (!statement.trim()) return
    setLoading(true)
    try {
      await fetch(`/api/deals/${deal.id}/dispute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit_evidence', statement }) })
      setSubmitted(true); onRefresh()
    } finally { setLoading(false) }
  }
  return (
    <div className="card">
      <div className="card-head">Submit Evidence</div>
      <div className="card-body">
        {submitted ? (
          <div style={{ fontSize: 13, color: 'var(--color-green)' }}>Evidence submitted.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--gray)', lineHeight: 1.6 }}>Provide your account of events and any supporting information.</div>
            <div className="form-field"><label className="field-label">Statement</label><textarea className="input" rows={4} value={statement} onChange={e => setStatement(e.target.value)} placeholder="Describe your position…" style={{ resize: 'vertical' }} /></div>
            <button className="btn btn-primary btn-sm" disabled={loading || !statement.trim()} onClick={submit}>{loading ? 'Submitting…' : 'Submit Evidence'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── AI Doc Cards ─────────────────────────────────────────────────────────────

function AiDocCard({ doc }: { doc: AiDoc }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied]     = useState(false)
  const label = AI_DOC_LABELS[doc.kind] ?? doc.kind.toUpperCase()
  function downloadTxt() {
    const blob = new Blob([doc.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${label.toLowerCase().replace(/ /g, '-')}.txt`; a.click(); URL.revokeObjectURL(url)
  }
  async function copyText() {
    try { await navigator.clipboard.writeText(doc.content); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpanded(e => !e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{label}</span>
          <span className="badge badge-active" style={{ fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>AI Generated</span>
          {doc.generated_at && <span style={{ fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0, color: 'var(--gray)', fontSize: 11 }}>{fmtDate(doc.generated_at)}</span>}
        </div>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s' }}>
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {expanded && (
        <>
          <div style={{ padding: '0 24px' }}>
            <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.65, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflowY: 'auto', margin: '16px 0', background: 'var(--offwhite)', border: '1px solid var(--border)', padding: '16px' }}>{doc.content}</pre>
          </div>
          <div style={{ padding: '0 24px 16px', display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={downloadTxt}>Download .txt</button>
            <button className="btn btn-secondary btn-sm" onClick={copyText}>{copied ? 'Copied!' : 'Copy to clipboard'}</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Document Row ─────────────────────────────────────────────────────────────

function DocumentRow({ doc }: { doc: DealDoc }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/documents/${doc.id}/url`).then(r => r.json()).then(d => { if (d.url) setUrl(d.url) }).catch(() => {})
  }, [doc.id])
  return (
    <div className="doc-row">
      <svg className="doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
      <span className="doc-name">{doc.name}</span>
      <span className="doc-date">{fmtDate(doc.created_at)}</span>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a> : <span className="doc-link" style={{ color: 'var(--gray-soft)' }}>—</span>}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const _user = useUser()
  const id = params?.id as string

  const [data, setData] = useState<DealDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiDocs, setAiDocs] = useState<AiDoc[]>([])
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [showFinancingForm, setShowFinancingForm] = useState(false)
  const [finStructure, setFinStructure] = useState<FinancingStructure>('open')
  const [finType, setFinType] = useState<FinancingType | ''>('')
  const [finAmount, setFinAmount] = useState('')
  const [finRateMax, setFinRateMax] = useState('')
  const [finSubmitting, setFinSubmitting] = useState(false)
  const [finError, setFinError] = useState<string | null>(null)
  const [alreadyReviewed, setAlreadyReviewed] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)

  const generateTriggered = useRef(false)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const financeActionTriggered = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/deals/${id}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(() => setError('Failed to load deal'))
      .finally(() => setLoading(false))
  }, [id])

  const loadDocs = useCallback(() => {
    fetch(`/api/deals/${id}/documents`).then(r => r.json()).then(d => {
      if (!d.error) { setAiDocs(d.ai_documents ?? []); setUploadedDocs(d.uploaded_documents ?? []) }
    }).catch(() => {})
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!data || financeActionTriggered.current) return
    if (typeof window === 'undefined') return
    const wantsFinance = new URLSearchParams(window.location.search).get('action') === 'finance'
    if (!wantsFinance) return
    const d = data.deal
    if (['agreed', 'active', 'confirmed'].includes(d.status) && !d.financing_requested) {
      financeActionTriggered.current = true
      setFinAmount(String(d.total_value ?? d.agreed_price ?? ''))
      setShowFinancingForm(true)
    }
  }, [data])

  useEffect(() => {
    if (!data || data.deal.status !== 'completed') return
    fetch(`/api/passport/reviews/check?deal_id=${id}`).then(r => r.json()).then(d => { if (d.already_reviewed) setAlreadyReviewed(true) }).catch(() => {})
  }, [data, id])

  useEffect(() => {
    if (!data) return
    const deal = data.deal
    if (deal.status === 'agreed' && deal.documents_generated_at) { loadDocs(); return }
    if (deal.status === 'agreed' && !deal.documents_generated_at) {
      if (!generateTriggered.current) {
        generateTriggered.current = true; setDocsLoading(true)
        fetch(`/api/deals/${id}/generate-documents`, { method: 'POST' }).catch(() => {})
      }
      if (!pollInterval.current) {
        pollInterval.current = setInterval(() => {
          fetch(`/api/deals/${id}`).then(r => r.json()).then(d => {
            if (d.deal?.documents_generated_at) {
              clearInterval(pollInterval.current!); pollInterval.current = null; setDocsLoading(false); setData(d); loadDocs()
            }
          }).catch(() => {})
        }, 3000)
      }
    } else if (aiDocs.length === 0 && uploadedDocs.length === 0) {
      loadDocs()
    }
    return () => { if (pollInterval.current) { clearInterval(pollInterval.current); pollInterval.current = null } }
  }, [data, id, loadDocs, aiDocs.length, uploadedDocs.length])

  async function submitFinancingRequest() {
    if (!data) return
    setFinSubmitting(true); setFinError(null)
    try {
      const res = await fetch('/api/marketplace/financing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deal_id: id, structure_type: finStructure, financing_type: finType || undefined, amount_requested: parseFloat(finAmount), preferred_rate_max: finRateMax ? parseFloat(finRateMax) : undefined, currency: data.deal.agreed_currency ?? 'USD' }) })
      const json = await res.json()
      if (!res.ok) { setFinError(json.error ?? 'Submission failed'); return }
      setShowFinancingForm(false); router.push(`/marketplace/financing/${json.financing_request.id}`)
    } finally { setFinSubmitting(false) }
  }

  async function cancelDeal() {
    setCancelLoading(true)
    try {
      const res = await fetch(`/api/deals/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancellation_reason: cancelReason || undefined, confirmed: cancelConfirmed }) })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Cancel failed'); return }
      setShowCancel(false); load()
    } finally { setCancelLoading(false) }
  }

  if (loading) {
    return (
      <>
        <Topbar crumbs={[{ label: 'My Deals', onClick: () => router.push('/deals') }, { label: 'Loading…' }]} />
        <div className="page" style={{ maxWidth: 1280 }}>
          <div style={{ display: 'flex', gap: 20 }}>
            {[0, 1].map(i => <div key={i} className="card" style={{ flex: i === 0 ? 1 : '0 0 340px', height: 400, animation: 'skeleton-pulse 1.8s ease infinite' }} />)}
          </div>
        </div>
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <Topbar crumbs={[{ label: 'My Deals', onClick: () => router.push('/deals') }, { label: 'Error' }]} />
        <div className="page" style={{ maxWidth: 1280 }}><div className="alert alert-error">{error ?? 'Deal not found'}</div></div>
      </>
    )
  }

  const { deal, buyer_org, supplier_org, room, financing_request, linked_transaction, documents, user_role } = data
  const counterparty = user_role === 'buyer' ? supplier_org : buyer_org
  const dealValue = deal.total_value ?? deal.agreed_price ?? null
  const currency = deal.agreed_currency ?? 'USD'
  const financingActive = deal.financing_payment_active ?? false
  const bankName = linked_transaction?.bank?.display_name ?? null
  const isGenerating = deal.status === 'agreed' && !deal.documents_generated_at && docsLoading
  const hasAiDocs   = aiDocs.length > 0
  const hasUploaded = uploadedDocs.length > 0 || documents.filter(d => !['ai_po','ai_invoice','ai_contract'].includes(d.document_kind)).length > 0
  const CANCELLABLE = ['negotiating', 'agreed', 'documents_pending', 'confirmed', 'in_preparation', 'active']
  const canCancel   = CANCELLABLE.includes(deal.status) && !deal.financing_payment_active
  const canFinance  = ['agreed', 'active', 'confirmed', 'in_preparation'].includes(deal.status) && !deal.financing_requested
  const canAmend    = ['confirmed', 'in_preparation', 'active'].includes(deal.status) && !deal.financing_payment_active
  const isActive    = !['completed', 'cancelled', 'in_dispute', 'disputed'].includes(deal.status)

  return (
    <>
      <Topbar
        crumbs={[{ label: 'My Deals', onClick: () => router.push('/deals') }, { label: `Deal #${shortId(deal.id)}` }]}
        actions={<div className="topbar-right">{room && <Link href={`/rooms/${room.id}`} className="btn btn-ghost btn-sm">Open Deal Room →</Link>}</div>}
      />
      <div className="page" style={{ maxWidth: 1280 }}>
        {/* Header */}
        <div className="page-header" style={{ marginBottom: 24 }}>
          <div className="page-id-title">
            <span className="id-text">Deal #{shortId(deal.id)}</span>
            <span className={statusBadgeClass(deal.status)}>{deal.status.replace(/_/g, ' ')}</span>
            <span className={sourceBadgeClass(deal.deal_source)}>{deal.deal_source}</span>
          </div>
          <p className="subtitle" style={{ marginTop: 4 }}>
            {user_role === 'buyer' ? 'You are the buyer' : 'You are the supplier'} on this deal{counterparty && ` with ${counterparty.legal_name}`}
          </p>
        </div>

        {/* Amendment banner */}
        {canAmend && <AmendmentBanner deal={deal} userRole={user_role} onRefresh={load} />}

        <div className="split-panel">
          {/* ── Main panel ── */}
          <div className="split-panel-main">
            {/* Roadmap */}
            <div className="card">
              <div className="card-head">Deal Progress</div>
              <div className="card-body" style={{ padding: '20px 24px' }}>
                <DealRoadmap status={deal.status} financingActive={financingActive} bankName={bankName} />
              </div>
            </div>

            {/* Action Required */}
            {isActive && (
              <div className="card" style={{ border: '1.5px solid var(--blue-light)' }}>
                <div className="card-head" style={{ color: 'var(--blue)' }}>Action Required</div>
                <div className="card-body">
                  <ActionPanel deal={deal} userRole={user_role} counterparty={counterparty} linkedTransaction={linked_transaction} onRefresh={load} />
                </div>
              </div>
            )}

            {/* Dispute evidence */}
            <DisputeEvidencePanel deal={deal} onRefresh={load} />

            {/* Agreed Terms */}
            <div className="card">
              <div className="card-head">
                Agreed Terms
                {canAmend && <ProposeAmendmentForm deal={deal} onRefresh={load} />}
              </div>
              <div className="kv-list">
                <div className="kv-row"><span className="k">Goods</span><span className="v plain">{deal.goods_description ?? '—'}</span></div>
                {deal.agreed_quantity != null && <div className="kv-row"><span className="k">Quantity</span><span className="v">{deal.agreed_quantity} {deal.agreed_unit ?? ''}</span></div>}
                <div className="kv-row"><span className="k">Price</span><span className="v">{fmt(deal.agreed_price, currency)}</span></div>
                <div className="kv-row"><span className="k">Currency</span><span className="v">{currency}</span></div>
                <div className="kv-row"><span className="k">Delivery Date</span><span className="v">{fmtDate(deal.agreed_delivery_date)}</span></div>
                <div className="kv-row"><span className="k">Incoterms</span><span className="v">{deal.agreed_incoterms ?? '—'}</span></div>
                <div className="kv-row"><span className="k">Payment Terms</span><span className="v plain">{deal.agreed_payment_terms ?? '—'}</span></div>
                {deal.payment_due_date && <div className="kv-row"><span className="k">Payment Due</span><span className="v">{fmtDate(deal.payment_due_date)}</span></div>}
                {deal.import_notes && <div className="kv-row"><span className="k">Notes</span><span className="v plain" style={{ fontSize: 12 }}>{deal.import_notes}</span></div>}
              </div>
            </div>

            {/* Shipment info */}
            {deal.shipment_tracking_ref && (
              <div className="card">
                <div className="card-head">Shipment</div>
                <div className="kv-list">
                  <div className="kv-row"><span className="k">Tracking</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{deal.shipment_tracking_ref}</span></div>
                  {deal.shipment_carrier && <div className="kv-row"><span className="k">Carrier</span><span className="v plain">{deal.shipment_carrier}</span></div>}
                  {deal.shipment_estimated_delivery && <div className="kv-row"><span className="k">Est. Delivery</span><span className="v">{fmtDate(deal.shipment_estimated_delivery)}</span></div>}
                  {deal.shipped_at && <div className="kv-row"><span className="k">Shipped</span><span className="v">{fmtDate(deal.shipped_at)}</span></div>}
                </div>
              </div>
            )}

            {/* Dispute info */}
            {['in_dispute', 'disputed'].includes(deal.status) && (
              <div className="card">
                <div className="card-head" style={{ color: 'var(--color-red)' }}>Dispute Details</div>
                <div className="kv-list">
                  {deal.dispute_category && <div className="kv-row"><span className="k">Category</span><span className="v plain">{deal.dispute_category.replace(/_/g, ' ')}</span></div>}
                  {deal.dispute_reason && <div className="kv-row"><span className="k">Reason</span><span className="v plain" style={{ fontSize: 12 }}>{deal.dispute_reason}</span></div>}
                  {deal.disputed_at && <div className="kv-row"><span className="k">Raised</span><span className="v">{fmtDate(deal.disputed_at)}</span></div>}
                </div>
              </div>
            )}

            {/* Documents */}
            <div>
              <div className="card">
                <div className="card-head">
                  Documents
                  {hasAiDocs && <span style={{ color: 'var(--color-green)', fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0 }}>{aiDocs.length} AI doc{aiDocs.length !== 1 ? 's' : ''}</span>}
                </div>
                {isGenerating ? (
                  <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--blue)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    <span style={{ fontSize: 13, color: 'var(--gray)' }}>Strike AI is drafting your documents…</span>
                  </div>
                ) : !hasAiDocs && !hasUploaded ? (
                  <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>No documents attached yet.</div>
                ) : null}
              </div>
              {hasAiDocs && <div style={{ marginTop: 12 }}>{aiDocs.map(doc => <AiDocCard key={doc.kind} doc={doc} />)}</div>}
              {hasUploaded && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card-head">Uploaded Documents</div>
                  {uploadedDocs.map(doc => (
                    <div key={doc.id} className="doc-row">
                      <svg className="doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
                      <span className="doc-name">{doc.name}</span>
                      <span className="doc-date">{fmtDate(doc.created_at)}</span>
                      {doc.url ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a> : <span className="doc-link" style={{ color: 'var(--gray-soft)' }}>—</span>}
                    </div>
                  ))}
                  {documents.filter(d => !['ai_po','ai_invoice','ai_contract'].includes(d.document_kind)).map(doc => <DocumentRow key={doc.id} doc={doc} />)}
                </div>
              )}
            </div>

            {/* Financing */}
            <div className="card">
              <div className="card-head">Financing</div>
              {financing_request ? (
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--gray)' }}>Financing Request</span>
                      <span className={`badge ${financing_request.status === 'funded' ? 'badge-funded' : 'badge-active'}`}>{financing_request.status.replace(/_/g, ' ')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 24 }}>
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)' }}>Amount</div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500 }}>{fmt(financing_request.amount_requested, financing_request.currency)}</div></div>
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)' }}>Offers</div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500 }}>{financing_request.offer_count}</div></div>
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}><Link href={`/marketplace/financing/${financing_request.id}`} className="btn btn-ghost btn-sm">View Financing Request →</Link></div>
                </div>
              ) : showFinancingForm ? (
                <div className="card-body">
                  {finError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{finError}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="form-row-2">
                      <div className="form-field"><label className="field-label">Structure Type</label><select className="input form-select" value={finStructure} onChange={e => setFinStructure(e.target.value as FinancingStructure)}><option value="open">Open (any structure)</option><option value="preset">Preset</option><option value="custom">Custom</option></select></div>
                      <div className="form-field"><label className="field-label">Financing Type (optional)</label><select className="input form-select" value={finType} onChange={e => setFinType(e.target.value as FinancingType | '')}><option value="">No preference</option><option value="reverse_factoring">Reverse Factoring</option><option value="invoice_factoring">Invoice Factoring</option><option value="po_financing">PO Financing</option><option value="dynamic_discounting">Dynamic Discounting</option></select></div>
                    </div>
                    <div className="form-field" style={{ maxWidth: 260 }}><label className="field-label">Amount Requested ({currency})</label><input className="input" type="number" min="0" required value={finAmount} onChange={e => setFinAmount(e.target.value)} /></div>
                    <div className="form-field" style={{ maxWidth: 200 }}><label className="field-label">Max Rate APR % (optional)</label><input className="input" type="number" step="0.01" min="0" value={finRateMax} onChange={e => setFinRateMax(e.target.value)} placeholder="e.g. 6.0" /></div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-blue btn-sm" disabled={finSubmitting || !finAmount} onClick={submitFinancingRequest}>{finSubmitting ? 'Submitting…' : 'Submit Financing Request'}</button>
                      <button className="btn btn-ghost btn-sm" disabled={finSubmitting} onClick={() => { setShowFinancingForm(false); setFinError(null) }}>Cancel</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card-body">
                  <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 12 }}>Ready to unlock early payment? Submit this deal to Strike Place and receive competitive financing offers from banks.</div>
                  <button className="btn btn-blue btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setFinAmount(String(dealValue ?? '')); setShowFinancingForm(true) }} disabled={!canFinance}>Request Financing</button>
                </div>
              )}
            </div>
          </div>

          {/* ── Aside panel ── */}
          <div className="split-panel-aside">
            {/* Counterparty */}
            {counterparty && (
              <div className="card">
                <div className="card-head">Counterparty</div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingBottom: 20 }}>
                  <PassportScoreRing score={counterparty.passport_score} size="md" showLabel />
                  <div style={{ width: '100%' }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 4, textAlign: 'center' }}>{counterparty.legal_name}</div>
                    <div style={{ textAlign: 'center', marginBottom: 12 }}><span className="badge badge-draft" style={{ fontSize: 9 }}>{counterparty.type}</span></div>
                    <div className="kv-list">
                      {counterparty.avg_payment_days != null && <div className="kv-row" style={{ padding: '8px 16px' }}><span className="k" style={{ fontSize: 10 }}>Avg Payment Days</span><span className="v">{counterparty.avg_payment_days}d</span></div>}
                      {counterparty.trade_count_total > 0 && <div className="kv-row" style={{ padding: '8px 16px' }}><span className="k" style={{ fontSize: 10 }}>Total Trades</span><span className="v">{counterparty.trade_count_total}</span></div>}
                      {counterparty.dispute_rate_network != null && <div className="kv-row" style={{ padding: '8px 16px' }}><span className="k" style={{ fontSize: 10 }}>Dispute Rate</span><span className="v">{(counterparty.dispute_rate_network * 100).toFixed(1)}%</span></div>}
                      {counterparty.country && <div className="kv-row" style={{ padding: '8px 16px' }}><span className="k" style={{ fontSize: 10 }}>Country</span><span className="v plain">{counterparty.country}</span></div>}
                    </div>
                  </div>
                  <Link href={`/passport/${counterparty.id}`} className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }}>View Passport</Link>
                </div>
              </div>
            )}

            {/* Deal value */}
            <div className="card">
              <div className="card-head">Deal Value</div>
              <div className="card-body" style={{ textAlign: 'center', padding: '20px 24px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em', color: '#C9A84C', lineHeight: 1 }}>{fmt(dealValue, currency)}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginTop: 6 }}>{currency}</div>
              </div>
            </div>

            {/* Review CTA */}
            {deal.status === 'completed' && !alreadyReviewed && counterparty && (
              <Link href={`/passport/review/${counterparty.id}`} className="btn btn-ghost btn-full" style={{ display: 'inline-flex', justifyContent: 'center' }}>Leave a Review</Link>
            )}

            {/* Room link */}
            {room && <Link href={`/rooms/${room.id}`} className="btn btn-secondary btn-full" style={{ display: 'inline-flex', justifyContent: 'center' }}>Open Deal Room →</Link>}

            {/* Cancel */}
            {canCancel && (
              <div>
                {!showCancel ? (
                  <button className="btn btn-danger btn-sm btn-full" style={{ justifyContent: 'center' }} onClick={() => setShowCancel(true)}>Cancel Deal</button>
                ) : (
                  <div style={{ border: '1px solid var(--color-red)', background: 'rgba(220,38,38,0.04)', padding: '14px 16px', borderRadius: 12 }}>
                    <p style={{ fontSize: 12, color: 'var(--ink)', margin: '0 0 10px', lineHeight: 1.5, fontWeight: 600 }}>Cancel this deal?</p>
                    <div className="form-field" style={{ marginBottom: 10 }}><label className="field-label">Reason{deal.status === 'in_preparation' ? ' *' : ' (optional)'}</label><input className="input" value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason for cancellation" /></div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--ink)', marginBottom: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={cancelConfirmed} onChange={e => setCancelConfirmed(e.target.checked)} style={{ marginTop: 2 }} />
                      I understand this action cannot be undone.
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-danger btn-sm" style={{ flex: 1 }} disabled={cancelLoading || !cancelConfirmed} onClick={cancelDeal}>{cancelLoading ? 'Cancelling…' : 'Confirm Cancel'}</button>
                      <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => { setShowCancel(false); setCancelReason(''); setCancelConfirmed(false) }}>Keep Deal</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Counterparty confirmation */}
            {deal.deal_source === 'imported' && (
              <div className={`alert ${deal.counterparty_confirmed ? 'alert-info' : 'alert-warn'}`} style={{ fontSize: 12 }}>
                <span className="alert-icon">{deal.counterparty_confirmed ? '✓' : '⏳'}</span>
                <span className="alert-body">{deal.counterparty_confirmed ? 'Counterparty has confirmed this deal.' : 'Awaiting counterparty confirmation.'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </>
  )
}
