'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { TRANSACTION_REFERRER_KEY } from '@/lib/transaction-referrer'
import { PortalShell, Topbar, Icon } from '@/components/portal-shell'

interface Transaction {
  id: string
  status: string
  type: string | null
  financing_type: string | null
  invoice_amount: number | null
  financing_amount_requested: number | null
  financing_amount_approved: number | null
  apr: number | null
  financing_rate_apr: number | null
  tenor_days: number | null
  fee_amount: number | null
  net_proceeds: number | null
  repayment_due_date: string | null
  disbursed_at: string | null
  disbursement_reference: string | null
  repaid_at: string | null
  invoice_number: string | null
  invoice_date: string | null
  invoice_due_date: string | null
  description: string | null
  bank_approval_notes: string | null
  program_id: string | null
  program_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  anchor_id: string | null
  anchor_name: string | null
  bank_name: string | null
  created_at: string
  updated_at: string
}

interface TransactionEvent {
  id: string
  event_type: string
  actor: string | null
  actor_name: string
  action: string
  to_status: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface CollateralItem {
  id: string
  level: string
  org_id: string | null
  transaction_id: string | null
  required_by_user_id: string | null
  collateral_type: string
  description: string
  required_value: number | null
  deadline: string | null
  status: string
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by_user_id: string | null
  rejection_reason: string | null
  waiver_note: string | null
  released_at: string | null
  released_by_user_id: string | null
  created_at: string
  updated_at: string
}

interface WireInfo {
  bank_name?: string
  account_number?: string
  routing_number?: string
  reference?: string
}

function parseWireInfo(raw: string | null): WireInfo | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as WireInfo
    return null
  } catch { return null }
}

function formatCollateralType(type: string): string {
  const labels: Record<string, string> = {
    post_dated_cheque:         'Post-dated Cheque',
    personal_guarantee:        'Personal Guarantee',
    assignment_of_receivables: 'Assignment of Receivables',
    cash_collateral:           'Cash Collateral',
    asset_pledge:              'Asset Pledge',
    other:                     'Other',
  }
  return labels[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function collateralStatusBadge(status: string): string {
  switch (status) {
    case 'pending':   return 'badge-pending'
    case 'submitted': return 'badge-active'
    case 'accepted':  return 'badge-funded'
    case 'rejected':  return 'badge-rejected'
    case 'waived':    return 'badge-draft'
    case 'released':  return 'badge-draft'
    default:          return 'badge-draft'
  }
}

// Status order for stepper
const RF_STEPPER_STEPS = [
  { key: 'pending_anchor_approval',          label: 'Anchor Review' },
  { key: 'pending_bank_review',              label: 'Bank Review' },
  { key: 'pending_supplier_counter_review',  label: 'Supplier Review' },
  { key: 'financing_approved',              label: 'Approved' },
  { key: 'funded',                           label: 'Disbursed' },
  { key: 'completed',                        label: 'Repaid' },
]

const RF_STATUS_ORDER = RF_STEPPER_STEPS.map(s => s.key)

const IF_STEPPER_STEPS = [
  { key: 'pending_bank_review',              label: 'Bank Review' },
  { key: 'pending_supplier_counter_review',  label: 'Supplier Review' },
  { key: 'financing_approved',               label: 'Approved' },
  { key: 'funded',                           label: 'Disbursed' },
  { key: 'completed',                        label: 'Repaid' },
]

const IF_STATUS_ORDER = IF_STEPPER_STEPS.map(s => s.key)

function ifStepperState(stepKey: string, status: string): 'done' | 'current' | 'todo' {
  let eff = status
  if (status === 'rejected')            eff = 'pending_bank_review'
  if (status === 'more_info_requested') eff = 'pending_bank_review'

  const stepIdx    = IF_STATUS_ORDER.indexOf(stepKey)
  const currentIdx = IF_STATUS_ORDER.indexOf(eff)

  if (currentIdx === -1) return 'todo'
  if (stepIdx < currentIdx)  return 'done'
  if (stepIdx === currentIdx) return 'current'
  return 'todo'
}

function rfStepperState(stepKey: string, status: string): 'done' | 'current' | 'todo' {
  // Map intermediate/terminal statuses to their nearest stepper position
  let eff = status
  if (status === 'rejected')            eff = 'pending_bank_review'
  if (status === 'more_info_requested') eff = 'pending_bank_review'

  const stepIdx    = RF_STATUS_ORDER.indexOf(stepKey)
  const currentIdx = RF_STATUS_ORDER.indexOf(eff)

  if (currentIdx === -1) return 'todo'
  if (stepIdx < currentIdx)  return 'done'
  if (stepIdx === currentIdx) return 'current'
  return 'todo'
}

const PO_STEPPER_STEPS = [
  { key: 'pending_bank_review',          label: 'PO Submitted' },
  { key: 'financing_approved',           label: 'Financing Approved' },
  { key: 'funded',                       label: 'Disbursed' },
  { key: 'pending_anchor_confirmation',  label: 'Invoice Submitted' },
  { key: 'repayment_due',               label: 'Repayment Due' },
  { key: 'completed',                    label: 'Completed' },
]

const PO_STATUS_ORDER = PO_STEPPER_STEPS.map(s => s.key)

function poStepperState(stepKey: string, status: string): 'done' | 'current' | 'todo' {
  let eff = status
  if (status === 'rejected')                       eff = 'pending_bank_review'
  if (status === 'more_info_requested')            eff = 'pending_bank_review'
  if (status === 'pending_supplier_counter_review') eff = 'pending_bank_review'
  if (status === 'in_dispute')                     eff = 'pending_anchor_confirmation'

  const stepIdx    = PO_STATUS_ORDER.indexOf(stepKey)
  const currentIdx = PO_STATUS_ORDER.indexOf(eff)

  if (currentIdx === -1) return 'todo'
  if (stepIdx < currentIdx)  return 'done'
  if (stepIdx === currentIdx) return 'current'
  return 'todo'
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pending_anchor_approval':         return 'badge-pending'
    case 'pending_bank_review':             return 'badge-active'
    case 'pending_supplier_counter_review': return 'badge-pending'
    case 'more_info_requested':             return 'badge-pending'
    case 'financing_approved':              return 'badge-funded'
    case 'funded':                          return 'badge-funded'
    case 'pending_anchor_confirmation':     return 'badge-pending'
    case 'repayment_due':                   return 'badge-active'
    case 'in_dispute':                      return 'badge-rejected'
    case 'completed':                       return 'badge-completed'
    case 'rejected':                        return 'badge-rejected'
    default:                                return 'badge-draft'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending_anchor_approval':         return 'Pending Approval'
    case 'pending_bank_review':             return 'Pending Bank Review'
    case 'pending_supplier_counter_review': return 'Counter-offer Pending'
    case 'more_info_requested':             return 'More Info Needed'
    case 'financing_approved':              return 'Approved'
    case 'funded':                          return 'Funded'
    case 'pending_anchor_confirmation':     return 'Awaiting Anchor Confirmation'
    case 'repayment_due':                   return 'Repayment Due'
    case 'in_dispute':                      return 'In Dispute'
    case 'completed':                       return 'Completed'
    case 'rejected':                        return 'Rejected'
    default:                                return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(s: string): string {
  const d = new Date(s)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} at ${time}`
}

function fmtAmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString()
}

function humanizeType(t: string | null): string {
  if (!t) return '—'
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function humanizeEvent(e: TransactionEvent): string {
  switch (e.event_type) {
    case 'transaction_submitted':    return 'Submitted transaction'
    case 'created':                  return 'Transaction created'
    case 'anchor_approved':          return 'Approved invoice'
    case 'anchor_rejected':          return 'Rejected invoice'
    case 'bank_approved':            return 'Approved financing'
    case 'bank_rejected':            return 'Rejected transaction'
    case 'bank_requested_info':      return 'Requested more information'
    case 'more_info_provided':       return 'Provided additional information'
    case 'counter_offer_submitted':  return 'Submitted counter-offer'
    case 'counter_offer_accepted':   return 'Accepted counter-offer'
    case 'counter_offer_rejected':   return 'Declined counter-offer'
    case 'wire_info_sent':           return 'Sent wire transfer info to supplier'
    case 'repayment_info_sent':      return 'Sent repayment instructions to anchor'
    case 'disbursement_marked':      return 'Disbursed funds to supplier'
    case 'repayment_marked':         return 'Marked as repaid'
    case 'disbursed':                return 'Disbursed funds to supplier'
    case 'repaid':                   return 'Recorded repayment'
    case 'funded':                   return 'Transaction funded'
    case 'completed':                return 'Transaction completed'
    case 'document_uploaded':        return 'Uploaded document'
    case 'collateral_updated':       return 'Updated collateral requirement'
    case 'status_change':
    case 'status_changed':
      if (e.notes === 'Invoice submitted after delivery') return 'Submitted invoice after delivery'
      return e.to_status ? `Status updated to ${statusLabel(e.to_status)}` : 'Status updated'
    default:
      return (e.action || e.event_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

// ── Bank action panel (reverse factoring) ──────────────────────────────────

function BankActionPanel({
  transaction,
  onAction,
  acting,
  txnId,
  onRefresh,
  isInvoiceFactoring,
  isPOFinancing,
}: {
  transaction: Transaction
  onAction: (body: Record<string, unknown>) => Promise<void>
  acting: boolean
  txnId: string
  onRefresh: () => void
  isInvoiceFactoring?: boolean
  isPOFinancing?: boolean
}) {
  const { status } = transaction
  const invoiceAmt = transaction.invoice_amount ?? 0

  // Supplier's offered rate (read-only for bank during approval)
  const supplierRatePct = invoiceAmt > 0 && transaction.financing_amount_requested
    ? ((transaction.financing_amount_requested / invoiceAmt) * 100).toFixed(1)
    : '0'
  const supplierRateNum    = parseFloat(supplierRatePct) || 0
  const supplierDisburseAmt = invoiceAmt * (supplierRateNum / 100)

  const [mode, setMode]             = useState<'idle' | 'counter' | 'reject'>('idle')
  const [counterRate, setCounterRate]   = useState(supplierRatePct)
  const [counterNotes, setCounterNotes] = useState('')
  const [rejectNote, setRejectNote]     = useState('')

  // Wire transfer (shown at financing_approved, separate step)
  const [wireInfo, setWireInfo]         = useState({ bank_name: '', account_number: '', routing_number: '', reference: '' })
  const [sendingWire, setSendingWire]   = useState(false)
  const [wireError, setWireError]       = useState<string | null>(null)
  const [wireSent, setWireSent]         = useState(false)

  // Disbursement
  const [disbRef, setDisbRef]           = useState('')
  const [disbursing, setDisbursing]     = useState(false)
  const [disbError, setDisbError]       = useState<string | null>(null)

  // Repayment info
  const [repaymentAmount, setRepaymentAmount]               = useState('')
  const [repaymentDueDate, setRepaymentDueDate]             = useState('')
  const [repaymentInstructions, setRepaymentInstructions]   = useState('')
  const [sendingRepayment, setSendingRepayment]             = useState(false)
  const [repaymentError, setRepaymentError]                 = useState<string | null>(null)
  const [repaymentSent, setRepaymentSent]                   = useState(false)

  // Mark as repaid
  const [markingRepaid, setMarkingRepaid]   = useState(false)
  const [repaidError, setRepaidError]       = useState<string | null>(null)

  const counterRateNum    = parseFloat(counterRate) || 0
  const counterDisburseAmt = invoiceAmt * (counterRateNum / 100)

  // ── financing_approved: wire transfer info + disbursement ──────────────────
  if (status === 'financing_approved') {
    const existingWire = parseWireInfo(transaction.disbursement_reference)
    const hasWire = existingWire && Object.values(existingWire).some(Boolean)

    const handleSendWire = async () => {
      setSendingWire(true)
      setWireError(null)
      try {
        const res = await fetch(`/api/transactions/${txnId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send_wire_info', wire_transfer_info: wireInfo }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
        setWireSent(true)
        onRefresh()
      } catch (err) {
        setWireError(err instanceof Error ? err.message : 'Failed to send wire info')
      } finally {
        setSendingWire(false)
      }
    }

    const handleDisburse = async () => {
      setDisbursing(true)
      setDisbError(null)
      try {
        const b: Record<string, unknown> = {}
        if (disbRef.trim()) b.disbursement_reference = disbRef.trim()
        const res = await fetch(`/api/transactions/${txnId}/disburse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(b),
        })
        const data = await res.json()
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
        onRefresh()
      } catch (err) {
        setDisbError(err instanceof Error ? err.message : 'Failed to disburse')
      } finally {
        setDisbursing(false)
      }
    }

    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-ink-1)', margin: 0 }}>
          Offer approved — disbursement pending
        </p>
        <div className="calc-panel">
          <div className="calc-row">
            <span>Approved amount</span>
            <span>{fmtAmt(transaction.financing_amount_approved)}</span>
          </div>
          {(transaction.apr ?? transaction.financing_rate_apr) != null && (
            <div className="calc-row">
              <span>Advance rate</span>
              <span>{transaction.apr ?? transaction.financing_rate_apr}%</span>
            </div>
          )}
          {transaction.fee_amount != null && (
            <div className="calc-row">
              <span>Discount fee</span>
              <span>{fmtAmt(transaction.fee_amount)}</span>
            </div>
          )}
        </div>

        {/* Wire transfer info — separate step, visible only to bank + supplier */}
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-2)', marginTop: 4 }}>
          Wire transfer info (for supplier)
        </div>
        {hasWire ? (
          <div className="calc-panel">
            <div style={{ fontSize: 11, color: 'var(--color-green)', marginBottom: 4 }}>Sent to supplier</div>
            {existingWire!.bank_name      && <div className="calc-row"><span>Bank</span><span>{existingWire!.bank_name}</span></div>}
            {existingWire!.account_number && <div className="calc-row"><span>Account</span><span className="mono">{existingWire!.account_number}</span></div>}
            {existingWire!.routing_number && <div className="calc-row"><span>Routing</span><span className="mono">{existingWire!.routing_number}</span></div>}
            {existingWire!.reference      && <div className="calc-row"><span>Reference</span><span className="mono">{existingWire!.reference}</span></div>}
          </div>
        ) : wireSent ? (
          <div style={{ fontSize: 12, color: 'var(--color-green)' }}>Wire info sent to supplier</div>
        ) : (
          <>
            {(['bank_name', 'account_number', 'routing_number', 'reference'] as const).map(field => (
              <div key={field}>
                <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>
                  {field === 'bank_name' ? 'Bank name' : field === 'account_number' ? 'Account number' : field === 'routing_number' ? 'Routing number' : 'Reference / memo'}
                </div>
                <input
                  className="form-input"
                  style={{ width: '100%' }}
                  value={wireInfo[field]}
                  onChange={e => setWireInfo(w => ({ ...w, [field]: e.target.value }))}
                />
              </div>
            ))}
            {wireError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{wireError}</div>}
            <button
              className="btn btn-ghost btn-full"
              type="button"
              disabled={sendingWire || !Object.values(wireInfo).some(v => v.trim())}
              onClick={handleSendWire}
            >
              {sendingWire ? 'Sending…' : 'Send wire info to supplier'}
            </button>
          </>
        )}

        {/* Disbursement */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Reference / wire number (optional)</div>
          <input
            className="input"
            placeholder="e.g. WIRE-20240509-001"
            value={disbRef}
            onChange={e => setDisbRef(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        {disbError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{disbError}</div>}
        <button className="btn btn-primary btn-full" type="button" disabled={disbursing} onClick={handleDisburse}>
          {disbursing ? 'Processing…' : 'Mark as disbursed'}
        </button>
      </div>
    )
  }

  // ── funded: PO passive / RF repayment form ───────────────────────────────
  if (status === 'funded' && isPOFinancing) {
    return (
      <div className="action-passive muted">
        Waiting for supplier to deliver goods and submit invoice
      </div>
    )
  }

  if (status === 'funded') {
    const repaymentAlreadySent = !!transaction.repayment_due_date

    const handleSendRepayment = async () => {
      setSendingRepayment(true)
      setRepaymentError(null)
      try {
        const res = await fetch(`/api/transactions/${txnId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:                'send_repayment_info',
            repayment_amount:      repaymentAmount ? parseFloat(repaymentAmount) : null,
            repayment_due_date:    repaymentDueDate || null,
            repayment_instructions: repaymentInstructions || null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
        setRepaymentSent(true)
        onRefresh()
      } catch (err) {
        setRepaymentError(err instanceof Error ? err.message : 'Failed to send')
      } finally {
        setSendingRepayment(false)
      }
    }

    const handleMarkRepaid = async () => {
      setMarkingRepaid(true)
      setRepaidError(null)
      try {
        const res = await fetch(`/api/transactions/${txnId}/repay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json()
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
        onRefresh()
      } catch (err) {
        setRepaidError(err instanceof Error ? err.message : 'Failed to mark as repaid')
      } finally {
        setMarkingRepaid(false)
      }
    }

    if (repaymentAlreadySent || repaymentSent) {
      return (
        <div className="action-block">
          <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-green)', margin: 0 }}>
            Repayment instructions sent to anchor
          </p>
          <div className="calc-panel">
            {transaction.repayment_due_date && (
              <div className="calc-row">
                <span>Due date</span>
                <span>{fmtDate(transaction.repayment_due_date)}</span>
              </div>
            )}
            {transaction.bank_approval_notes && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>Instructions</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
                  {transaction.bank_approval_notes}
                </span>
              </div>
            )}
          </div>
          {repaidError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{repaidError}</div>}
          <button
            className="btn btn-primary btn-full"
            type="button"
            disabled={markingRepaid}
            onClick={handleMarkRepaid}
          >
            {markingRepaid ? 'Processing…' : 'Mark as repaid'}
          </button>
        </div>
      )
    }

    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-ink-1)', margin: 0 }}>
          Send repayment instructions to anchor
        </p>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Repayment amount ($)</div>
          <input
            className="input mono"
            placeholder="0.00"
            value={repaymentAmount}
            onChange={e => setRepaymentAmount(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Repayment due date</div>
          <input
            type="date"
            className="input"
            value={repaymentDueDate}
            onChange={e => setRepaymentDueDate(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Instructions / wire details</div>
          <textarea
            className="form-input"
            rows={3}
            placeholder="IBAN, wire instructions, or payment reference…"
            value={repaymentInstructions}
            onChange={e => setRepaymentInstructions(e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>
        {repaymentError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{repaymentError}</div>}
        <button
          className="btn btn-primary btn-full"
          type="button"
          disabled={sendingRepayment || !repaymentDueDate}
          onClick={handleSendRepayment}
        >
          {sendingRepayment ? 'Sending…' : 'Send to anchor'}
        </button>
      </div>
    )
  }

  // ── PO: pending_anchor_confirmation / repayment_due ──────────────────────
  if (isPOFinancing && status === 'pending_anchor_confirmation') {
    return <div className="action-passive muted">Anchor is confirming receipt of goods</div>
  }

  if (isPOFinancing && status === 'repayment_due') {
    const repaymentAlreadySent = !!transaction.repayment_due_date

    const handleSendRepaymentPO = async () => {
      setSendingRepayment(true)
      setRepaymentError(null)
      try {
        const res = await fetch(`/api/transactions/${txnId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:                 'send_repayment_info',
            repayment_amount:       repaymentAmount ? parseFloat(repaymentAmount) : null,
            repayment_due_date:     repaymentDueDate || null,
            repayment_instructions: repaymentInstructions || null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
        setRepaymentSent(true)
        onRefresh()
      } catch (err) {
        setRepaymentError(err instanceof Error ? err.message : 'Failed to send')
      } finally {
        setSendingRepayment(false)
      }
    }

    const handleMarkRepaidPO = async () => {
      setMarkingRepaid(true)
      setRepaidError(null)
      try {
        const res = await fetch(`/api/transactions/${txnId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_repaid' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
        onRefresh()
      } catch (err) {
        setRepaidError(err instanceof Error ? err.message : 'Failed to mark as repaid')
      } finally {
        setMarkingRepaid(false)
      }
    }

    if (repaymentAlreadySent || repaymentSent) {
      return (
        <div className="action-block">
          <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-green)', margin: 0 }}>
            Repayment instructions sent to anchor
          </p>
          <div className="calc-panel">
            {transaction.repayment_due_date && (
              <div className="calc-row">
                <span>Due date</span>
                <span>{fmtDate(transaction.repayment_due_date)}</span>
              </div>
            )}
            {transaction.bank_approval_notes && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>Instructions</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{transaction.bank_approval_notes}</span>
              </div>
            )}
          </div>
          {repaidError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{repaidError}</div>}
          <button className="btn btn-primary btn-full" type="button" disabled={markingRepaid} onClick={handleMarkRepaidPO}>
            {markingRepaid ? 'Processing…' : 'Mark as repaid'}
          </button>
        </div>
      )
    }

    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-ink-1)', margin: 0 }}>
          Send repayment instructions to anchor
        </p>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Repayment amount ($)</div>
          <input className="input mono" placeholder="0.00" value={repaymentAmount} onChange={e => setRepaymentAmount(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Repayment due date</div>
          <input type="date" className="input" value={repaymentDueDate} onChange={e => setRepaymentDueDate(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Instructions / wire details</div>
          <textarea className="form-input" rows={3} placeholder="IBAN, wire instructions, or payment reference…" value={repaymentInstructions} onChange={e => setRepaymentInstructions(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
        </div>
        {repaymentError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{repaymentError}</div>}
        <button className="btn btn-primary btn-full" type="button" disabled={sendingRepayment || !repaymentDueDate} onClick={handleSendRepaymentPO}>
          {sendingRepayment ? 'Sending…' : 'Send to anchor'}
        </button>
      </div>
    )
  }

  if (status !== 'pending_bank_review' && status !== 'more_info_requested') {
    return (
      <div className="action-passive muted">
        {status === 'rejected'   ? 'This transaction was rejected.'
          : status === 'completed' ? 'Transaction completed.'
          : `Awaiting ${status.replace(/_/g, ' ')}`}
      </div>
    )
  }

  // ── pending_bank_review / more_info_requested ──────────────────────────────
  if (mode === 'reject') {
    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, color: 'var(--color-ink-2)', margin: 0 }}>Rejection reason</p>
        <textarea
          className="form-input"
          rows={4}
          placeholder="Reason for rejection (optional)…"
          value={rejectNote}
          onChange={e => setRejectNote(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <button
          className="btn btn-danger btn-full"
          type="button"
          disabled={acting}
          onClick={() => onAction({ action: 'reject', rejection_reason: rejectNote.trim() })}
        >
          {acting ? 'Processing…' : 'Confirm rejection'}
        </button>
        <button className="btn btn-ghost btn-full" type="button" onClick={() => { setMode('idle'); setRejectNote('') }}>
          Cancel
        </button>
      </div>
    )
  }

  const isCounter = mode === 'counter'

  return (
    <div className="action-block">
      <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-ink-1)', margin: 0 }}>
        {isCounter ? 'Counter-offer' : isPOFinancing ? 'Supplier submitted a purchase order for financing' : isInvoiceFactoring ? 'Supplier submitted this invoice directly for financing' : 'Review financing offer'}
      </p>

      {/* Supplier's offer — always shown (read-only for bank) */}
      <div className="calc-panel">
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 8 }}>Supplier&apos;s offer</div>
        <div className="calc-row">
          <span>Invoice amount</span>
          <span>{fmtAmt(transaction.invoice_amount)}</span>
        </div>
        <div className="calc-row">
          <span>Requested advance rate</span>
          <span>{supplierRatePct}%</span>
        </div>
        <div className="calc-row">
          <span>Requested amount</span>
          <span>{fmtAmt(transaction.financing_amount_requested)}</span>
        </div>
      </div>

      {/* Counter rate — only shown in counter mode */}
      {isCounter && (
        <>
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Counter advance rate (%)</div>
            <div style={{ position: 'relative' }}>
              <input
                className="form-input mono"
                style={{ width: '100%', paddingRight: 32 }}
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={counterRate}
                onChange={e => setCounterRate(e.target.value)}
              />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-3)', fontSize: 14, pointerEvents: 'none' }}>%</span>
            </div>
          </div>
          {counterRateNum > 0 && (
            <div className="calc-row">
              <span>Counter amount</span>
              <strong style={{ color: 'var(--color-green)' }}>{fmtAmt(parseFloat(counterDisburseAmt.toFixed(2)))}</strong>
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Notes (optional)</div>
            <textarea
              className="form-input"
              rows={2}
              value={counterNotes}
              onChange={e => setCounterNotes(e.target.value)}
              style={{ width: '100%', resize: 'vertical' }}
              placeholder="Reason for counter-offer…"
            />
          </div>
          <button
            className="btn btn-primary btn-full"
            type="button"
            disabled={acting || !counterRateNum}
            onClick={() => onAction({
              action:                    'counter_offer',
              apr:                       counterRateNum,
              financing_amount_approved: parseFloat(counterDisburseAmt.toFixed(2)),
              ...(counterNotes.trim() ? { counter_offer_notes: counterNotes.trim() } : {}),
            })}
          >
            {acting ? 'Sending…' : 'Send counter-offer'}
          </button>
          <button className="btn btn-ghost btn-full" type="button" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </>
      )}

      {/* Approve / counter / reject buttons (non-counter mode) */}
      {!isCounter && (
        <>
          <button
            className="btn btn-primary btn-full"
            type="button"
            disabled={acting || !supplierRateNum}
            onClick={() => onAction({
              action:                    'approve',
              apr:                       supplierRateNum,
              financing_amount_approved: parseFloat(supplierDisburseAmt.toFixed(2)),
            })}
          >
            {acting ? 'Processing…' : 'Approve offer'}
          </button>
          <button className="btn btn-ghost btn-full" type="button" disabled={acting} onClick={() => setMode('counter')}>
            Counter-offer
          </button>
          <button className="btn btn-danger btn-full" type="button" disabled={acting} onClick={() => setMode('reject')}>
            Reject
          </button>
        </>
      )}
    </div>
  )
}

// ── Anchor action panel ────────────────────────────────────────────────────

function AnchorActionPanel({
  transaction,
  onAction,
  acting,
  onSuccess,
  isInvoiceFactoring,
  isPOFinancing,
}: {
  transaction: Transaction
  onAction: (body: Record<string, unknown>) => Promise<void>
  acting: boolean
  onSuccess: (msg: string) => void
  isInvoiceFactoring?: boolean
  isPOFinancing?: boolean
}) {
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason]     = useState('')
  const [disputeReason, setDisputeReason]   = useState('')
  const [showDisputeForm, setShowDisputeForm] = useState(false)

  // PO financing: passive until pending_anchor_confirmation
  if (isPOFinancing && transaction.status !== 'pending_anchor_confirmation' && transaction.status !== 'repayment_due' && transaction.status !== 'completed' && transaction.status !== 'rejected' && transaction.status !== 'in_dispute') {
    return <div className="action-passive muted">Supplier is fulfilling the order</div>
  }

  // PO financing: anchor confirms goods receipt
  if (isPOFinancing && transaction.status === 'pending_anchor_confirmation') {
    if (showDisputeForm) {
      return (
        <div className="action-block">
          <p style={{ fontSize: 12.5, color: 'var(--color-ink-2)', margin: 0 }}>Dispute reason</p>
          <textarea
            className="form-input"
            rows={4}
            placeholder="Describe the dispute reason (optional)…"
            value={disputeReason}
            onChange={e => setDisputeReason(e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
          <button
            className="btn btn-danger btn-full"
            type="button"
            disabled={acting}
            onClick={() => onAction({ action: 'reject', notes: disputeReason.trim() })}
          >
            {acting ? 'Processing…' : 'Submit dispute'}
          </button>
          <button className="btn btn-ghost btn-full" type="button" disabled={acting} onClick={() => { setShowDisputeForm(false); setDisputeReason('') }}>
            Cancel
          </button>
        </div>
      )
    }

    return (
      <div className="action-block">
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-1)', margin: 0 }}>
          Confirm goods received
        </p>
        <div className="calc-panel">
          {transaction.invoice_number && (
            <div className="calc-row">
              <span>Invoice #</span>
              <span>{transaction.invoice_number}</span>
            </div>
          )}
          {transaction.invoice_amount != null && (
            <div className="calc-row">
              <span>Amount</span>
              <span>{fmtAmt(transaction.invoice_amount)}</span>
            </div>
          )}
          {transaction.invoice_date && (
            <div className="calc-row">
              <span>Date</span>
              <span>{fmtDate(transaction.invoice_date)}</span>
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-full"
          type="button"
          disabled={acting}
          onClick={async () => {
            await onAction({ action: 'approve' })
            onSuccess('Goods confirmed — transaction moved to repayment')
          }}
        >
          {acting ? 'Processing…' : 'Confirm receipt'}
        </button>
        <button className="btn btn-danger btn-full" type="button" disabled={acting} onClick={() => setShowDisputeForm(true)}>
          Dispute
        </button>
      </div>
    )
  }

  // PO financing: repayment_due — show repayment info if sent
  if (isPOFinancing && transaction.status === 'repayment_due') {
    return (
      <div className="action-block">
        <div className="action-passive muted" style={{ marginBottom: 8 }}>Transaction in repayment</div>
        {transaction.repayment_due_date ? (
          <div className="calc-panel">
            <div className="calc-row">
              <span>Repayment due</span>
              <span>{fmtDate(transaction.repayment_due_date)}</span>
            </div>
            {transaction.bank_approval_notes && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>Instructions</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{transaction.bank_approval_notes}</span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 8 }}>
            Awaiting repayment instructions from bank
          </p>
        )}
      </div>
    )
  }

  if (transaction.status === 'funded') {
    return (
      <div className="action-block">
        <div className="action-passive muted">Transaction funded.</div>
        {transaction.repayment_due_date ? (
          <div className="calc-panel" style={{ marginTop: 8 }}>
            <div className="calc-row">
              <span>Repayment due</span>
              <span>{fmtDate(transaction.repayment_due_date)}</span>
            </div>
            {transaction.financing_amount_approved != null && (
              <div className="calc-row">
                <span>Amount</span>
                <span>{fmtAmt(transaction.financing_amount_approved)}</span>
              </div>
            )}
            {/* bank_approval_notes (repayment instructions) shown only to anchor */}
            {transaction.bank_approval_notes && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>Instructions</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
                  {transaction.bank_approval_notes}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 8 }}>
            Awaiting repayment instructions from bank
          </p>
        )}
      </div>
    )
  }

  if (isInvoiceFactoring) {
    return (
      <div className={`action-passive ${transaction.status === 'rejected' ? '' : 'muted'}`}>
        {transaction.status === 'rejected'
          ? 'This transaction was rejected.'
          : transaction.status === 'pending_bank_review'
            || transaction.status === 'more_info_requested'
            || transaction.status === 'pending_supplier_counter_review'
          ? 'Invoice is under bank review.'
          : transaction.status === 'financing_approved'
          ? 'Financing approved — supplier will receive payment shortly.'
          : transaction.status === 'completed'
          ? 'Transaction completed.'
          : 'Awaiting next step.'}
      </div>
    )
  }

  if (transaction.status !== 'pending_anchor_approval') {
    return (
      <div className={`action-passive ${transaction.status === 'rejected' ? '' : 'muted'}`}>
        {transaction.status === 'rejected'
          ? 'This transaction was rejected.'
          : transaction.status === 'pending_bank_review'
            || transaction.status === 'more_info_requested'
            || transaction.status === 'pending_supplier_counter_review'
          ? 'Invoice approved — awaiting bank review.'
          : transaction.status === 'financing_approved'
          ? 'Financing approved — supplier will receive payment shortly.'
          : transaction.status === 'completed'
          ? 'Transaction completed.'
          : 'Awaiting next step.'}
      </div>
    )
  }

  async function handleApprove() {
    await onAction({ action: 'approve' })
    onSuccess('Invoice approved — sent to bank for review')
  }

  if (showRejectForm) {
    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, color: 'var(--color-ink-2)', margin: 0 }}>Rejection reason</p>
        <textarea
          className="form-input"
          rows={4}
          placeholder="Reason for rejection (optional)…"
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <button
          className="btn btn-danger btn-full"
          type="button"
          disabled={acting}
          onClick={() => onAction({ action: 'reject', notes: rejectReason.trim() })}
        >
          {acting ? 'Processing…' : 'Confirm rejection'}
        </button>
        <button
          className="btn btn-ghost btn-full"
          type="button"
          disabled={acting}
          onClick={() => { setShowRejectForm(false); setRejectReason('') }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="action-block">
      <p style={{ fontSize: 12.5, color: 'var(--color-ink-2)', margin: 0 }}>
        Review and confirm this invoice before it is sent to the bank for financing.
      </p>
      <button className="btn btn-primary btn-full" type="button" disabled={acting} onClick={handleApprove}>
        {acting ? 'Processing…' : 'Approve invoice'}
      </button>
      <button className="btn btn-danger btn-full" type="button" disabled={acting} onClick={() => setShowRejectForm(true)}>
        Reject
      </button>
    </div>
  )
}

// ── Supplier action panel ──────────────────────────────────────────────────

function SupplierActionPanel({
  transaction,
  onAction,
  acting,
  isInvoiceFactoring,
  isPOFinancing,
}: {
  transaction: Transaction
  onAction: (body: Record<string, unknown>) => Promise<void>
  acting: boolean
  isInvoiceFactoring?: boolean
  isPOFinancing?: boolean
}) {
  const [counterMode, setCounterMode] = useState(false)
  const [counterRate, setCounterRate] = useState('')
  const [counterNotes, setCounterNotes] = useState('')
  const [invoiceNum, setInvoiceNum]         = useState('')
  const [invoiceAmt2, setInvoiceAmt2]       = useState('')
  const [invoiceDateVal, setInvoiceDateVal] = useState('')
  const [invError, setInvError]             = useState<string | null>(null)

  const invoiceAmt     = transaction.invoice_amount ?? 0
  const counterRateNum = parseFloat(counterRate) || 0
  const counterAmt     = invoiceAmt * (counterRateNum / 100)

  switch (transaction.status) {
    case 'pending_anchor_approval':
      return <div className="action-passive muted">Waiting for anchor to review</div>

    case 'pending_bank_review':
      return <div className="action-passive muted">{isPOFinancing ? 'Your PO is under bank review' : isInvoiceFactoring ? 'Your invoice is under bank review' : 'Anchor approved — awaiting bank review'}</div>

    case 'pending_supplier_counter_review': {
      const rate = transaction.apr ?? transaction.financing_rate_apr

      if (counterMode) {
        return (
          <div className="action-block">
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-1)', margin: 0 }}>
              Your counter-offer
            </p>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Your advance rate (%)</div>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input mono"
                  style={{ width: '100%', paddingRight: 32 }}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={counterRate}
                  onChange={e => setCounterRate(e.target.value)}
                  placeholder={rate != null ? String(rate) : ''}
                />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-3)', fontSize: 14, pointerEvents: 'none' }}>%</span>
              </div>
            </div>
            {counterRateNum > 0 && (
              <div className="calc-row">
                <span>Amount you&apos;d receive</span>
                <strong style={{ color: 'var(--color-green)' }}>{fmtAmt(parseFloat(counterAmt.toFixed(2)))}</strong>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Notes (optional)</div>
              <textarea
                className="form-input"
                rows={2}
                value={counterNotes}
                onChange={e => setCounterNotes(e.target.value)}
                style={{ width: '100%', resize: 'vertical' }}
                placeholder="Reason for counter-offer…"
              />
            </div>
            <button
              className="btn btn-primary btn-full"
              type="button"
              disabled={acting || !counterRateNum}
              onClick={() => onAction({
                action:        'supplier_counter',
                apr:           counterRateNum,
                ...(counterNotes.trim() ? { counter_notes: counterNotes.trim() } : {}),
              })}
            >
              {acting ? 'Sending…' : 'Send counter-offer to bank'}
            </button>
            <button className="btn btn-ghost btn-full" type="button" onClick={() => setCounterMode(false)}>
              Cancel
            </button>
          </div>
        )
      }

      return (
        <div className="action-block">
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-1)', margin: 0 }}>
            Bank has made a counter-offer
          </p>
          <div className="calc-panel">
            {rate != null && (
              <div className="calc-row">
                <span>Advance rate</span>
                <span>{rate}%</span>
              </div>
            )}
            {transaction.financing_amount_approved != null && (
              <div className="calc-row">
                <span>Amount you&apos;ll receive</span>
                <strong style={{ color: 'var(--color-green)' }}>{fmtAmt(transaction.financing_amount_approved)}</strong>
              </div>
            )}
            {transaction.fee_amount != null && (
              <div className="calc-row">
                <span>Discount fee</span>
                <span>{fmtAmt(transaction.fee_amount)}</span>
              </div>
            )}
          </div>
          <button
            className="btn btn-primary btn-full"
            type="button"
            disabled={acting}
            onClick={() => onAction({ action: 'accept_counter' })}
          >
            {acting ? 'Processing…' : 'Accept offer'}
          </button>
          <button
            className="btn btn-ghost btn-full"
            type="button"
            disabled={acting}
            onClick={() => setCounterMode(true)}
          >
            Make counter-offer
          </button>
          <button
            className="btn btn-danger btn-full"
            type="button"
            disabled={acting}
            onClick={() => onAction({ action: 'reject_counter' })}
          >
            Decline offer
          </button>
        </div>
      )
    }

    case 'financing_approved': {
      const wireInfo = parseWireInfo(transaction.disbursement_reference)
      const hasWire  = wireInfo && Object.values(wireInfo).some(Boolean)
      return (
        <div className="action-block">
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-green)', margin: 0 }}>
            Financing approved
          </p>
          {hasWire ? (
            <>
              <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-ink-1)', margin: 0 }}>
                Wire transfer details
              </p>
              <div className="calc-panel">
                {wireInfo!.bank_name       && <div className="calc-row"><span>Bank</span><span>{wireInfo!.bank_name}</span></div>}
                {wireInfo!.account_number  && <div className="calc-row"><span>Account</span><span className="mono">{'••••' + wireInfo!.account_number.slice(-4)}</span></div>}
                {wireInfo!.routing_number  && <div className="calc-row"><span>Routing</span><span className="mono">{wireInfo!.routing_number}</span></div>}
                {wireInfo!.reference       && <div className="calc-row"><span>Reference</span><span className="mono">{wireInfo!.reference}</span></div>}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--color-ink-3)', margin: 0 }}>
              Wire transfer details will be sent shortly
            </p>
          )}
        </div>
      )
    }

    case 'funded':
      if (isPOFinancing) {
        const handleSubmitInvoice = async () => {
          if (!invoiceNum.trim() || !invoiceAmt2 || !invoiceDateVal) {
            setInvError('All invoice fields are required')
            return
          }
          setInvError(null)
          await onAction({
            action:         'submit_invoice',
            invoice_number: invoiceNum.trim(),
            invoice_amount: parseFloat(invoiceAmt2),
            invoice_date:   invoiceDateVal,
          })
        }

        return (
          <div className="action-block">
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink-1)', margin: 0 }}>
              Goods delivered? Submit your invoice
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-ink-3)', margin: 0 }}>
              Once the anchor has received the goods, submit the invoice to proceed.
            </p>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Invoice number</div>
              <input className="form-input" style={{ width: '100%' }} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} placeholder="INV-001" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Invoice amount ($)</div>
              <input className="form-input mono" style={{ width: '100%' }} value={invoiceAmt2} onChange={e => setInvoiceAmt2(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Invoice date</div>
              <input type="date" className="form-input" style={{ width: '100%' }} value={invoiceDateVal} onChange={e => setInvoiceDateVal(e.target.value)} />
            </div>
            {invError && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{invError}</div>}
            <button className="btn btn-primary btn-full" type="button" disabled={acting} onClick={handleSubmitInvoice}>
              {acting ? 'Submitting…' : 'Submit Invoice'}
            </button>
          </div>
        )
      }

      return (
        <div className="action-block">
          <div className="action-passive green" style={{ marginBottom: 8 }}>
            <Icon name="check" size={14} />
            Payment disbursed
          </div>
          {transaction.disbursed_at && (
            <div className="calc-panel">
              <div className="calc-row">
                <span>Disbursed on</span>
                <span>{fmtDate(transaction.disbursed_at)}</span>
              </div>
            </div>
          )}
        </div>
      )

    case 'pending_anchor_confirmation':
      return <div className="action-passive muted">Invoice submitted — awaiting anchor confirmation</div>

    case 'repayment_due':
      return <div className="action-passive muted">Repayment due — transaction completing</div>

    case 'in_dispute':
      return <div className="action-passive" style={{ color: 'var(--color-red)' }}>Invoice in dispute.</div>

    case 'completed':
      return (
        <div className="action-block">
          <div className="action-passive muted">
            <Icon name="check" size={14} />
            Transaction completed
          </div>
        </div>
      )

    case 'rejected':
      return <div className="action-passive" style={{ color: 'var(--color-red)' }}>Transaction rejected.</div>

    default:
      return <div className="action-passive muted">Awaiting update</div>
  }
}

// ── Collateral submission form (supplier) ──────────────────────────────────

function SupplierCollateralSubmitForm({
  item,
  txnId,
  onDone,
}: {
  item: CollateralItem
  txnId: string
  onDone: () => void
}) {
  const [notes, setNotes]         = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const fileRef                   = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('action', 'submit')
      if (notes.trim()) form.append('submission_notes', notes.trim())
      if (file) form.append('file', file)

      const res = await fetch(`/api/collateral/${item.id}`, { method: 'PATCH', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Submit failed')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0' }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Details / notes</div>
        <textarea
          className="input"
          rows={3}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Describe what you are submitting…"
          style={{ width: '100%', resize: 'none' }}
        />
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Supporting document (optional)</div>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span>{file.name}</span>
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-3)', fontSize: 14 }} onClick={() => setFile(null)}>×</button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => fileRef.current?.click()}>
            Attach file
          </button>
        )}
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={handleSubmit}>
          {saving ? 'Submitting…' : 'Submit collateral'}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function TransactionDetailPage() {
  const portal = usePortal()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [transaction, setTransaction]       = useState<Transaction | null>(null)
  const [events, setEvents]                 = useState<TransactionEvent[]>([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)
  const [acting, setActing]                 = useState(false)
  const [actionError, setActionError]       = useState<string | null>(null)
  const [actionSuccess, setActionSuccess]   = useState<string | null>(null)

  const [documents, setDocuments] = useState<{
    id: string; name: string; document_kind: string; mime_type: string
    size_bytes: number; storage_path: string; signed_url: string | null; created_at: string
  }[]>([])

  const [collateral, setCollateral]                   = useState<CollateralItem[]>([])
  const [showAddCollateral, setShowAddCollateral]     = useState(false)
  const [reviewingCollateral, setReviewingCollateral] = useState<CollateralItem | null>(null)
  const [waiverNote, setWaiverNote]                   = useState('')
  const [rejectionReason, setRejectionReason]         = useState('')
  const [submittingCollateral, setSubmittingCollateral] = useState<CollateralItem | null>(null)
  const [addCollForm, setAddCollForm]                 = useState({
    collateral_type: 'post_dated_cheque',
    description:     '',
    required_value:  '',
    deadline:        '',
  })
  const [addCollError, setAddCollError]     = useState<string | null>(null)
  const [addCollSuccess, setAddCollSuccess] = useState(false)
  const [addCollSaving, setAddCollSaving]   = useState(false)

  const [backPath, setBackPath] = useState('/transactions')

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(TRANSACTION_REFERRER_KEY)
      if (stored) setBackPath(stored)
    } catch {}
  }, [])

  const portalLabel = portal === 'bank' ? 'Bank Portal' : portal === 'anchor' ? 'Anchor Portal' : 'Supplier Portal'

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      fetch(`/api/transactions/${id}`)
        .then(r => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json() }),
      fetch(`/api/collateral?transaction_id=${id}`)
        .then(r => r.ok ? r.json() : { collateral: [] })
        .catch(() => ({ collateral: [] })),
      fetch(`/api/transactions/${id}/documents`)
        .then(r => r.ok ? r.json() : { documents: [] })
        .catch(() => ({ documents: [] })),
    ])
      .then(([txnData, collData, docsData]) => {
        setTransaction(txnData.transaction)
        setEvents(txnData.events ?? [])
        setCollateral(collData.collateral ?? [])
        setDocuments(docsData.documents ?? [])
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load')
        setLoading(false)
      })
  }, [id])

  useEffect(() => { load() }, [load])

  const handleAction = useCallback(async (body: Record<string, unknown>) => {
    setActing(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { error?: string; transaction?: Transaction }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const updatedTxn = data.transaction
      if (updatedTxn) {
        setTransaction(prev => prev ? { ...prev, ...updatedTxn } : prev)
      }
      setActionSuccess('Done')
      setTimeout(() => setActionSuccess(null), 2000)
      load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(false)
    }
  }, [id, load])

  function handleSuccess(msg: string) {
    setActionSuccess(msg)
    setTimeout(() => setActionSuccess(null), 2000)
  }

  const refreshCollateral = useCallback(() => {
    fetch(`/api/collateral?transaction_id=${id}`)
      .then(r => r.ok ? r.json() : { collateral: [] })
      .then(d => setCollateral(d.collateral ?? []))
      .catch(() => {})
  }, [id])

  const handleCollateralAction = useCallback(async (itemId: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/collateral/${itemId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (res.ok) {
      setReviewingCollateral(null)
      setWaiverNote('')
      setRejectionReason('')
      refreshCollateral()
    }
  }, [refreshCollateral])

  const handleAddCollateral = useCallback(async () => {
    setAddCollSaving(true)
    setAddCollError(null)
    try {
      const body: Record<string, unknown> = {
        level:           'transaction',
        transaction_id:  id,
        collateral_type: addCollForm.collateral_type,
        description:     addCollForm.description,
        deadline:        addCollForm.deadline,
      }
      if (addCollForm.required_value.trim()) {
        body.required_value = parseFloat(addCollForm.required_value)
      }
      const res  = await fetch('/api/collateral', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
      setAddCollSuccess(true)
      setAddCollForm({ collateral_type: 'post_dated_cheque', description: '', required_value: '', deadline: '' })
      setTimeout(() => { setAddCollSuccess(false); setShowAddCollateral(false) }, 1500)
      refreshCollateral()
    } catch (err) {
      setAddCollError(err instanceof Error ? err.message : 'Failed to add requirement')
    } finally {
      setAddCollSaving(false)
    }
  }, [id, addCollForm, refreshCollateral])

  const txn = transaction

  const isPOFinancing = txn?.financing_type === 'po_financing'
  const isInvoiceFactoring = txn?.type === 'invoice_factoring' || txn?.financing_type === 'invoice_factoring'

  const typeLabel = humanizeType(txn?.type ?? txn?.financing_type ?? null)
  const subtitle = txn
    ? [txn.supplier_name, txn.anchor_name, txn.program_name, txn.bank_name].filter(Boolean).join(' · ')
    : ''

  const displayAdvanceRate = txn
    ? (txn.apr ?? txn.financing_rate_apr)
      ?? (txn.invoice_amount && txn.financing_amount_requested
          ? parseFloat(((txn.financing_amount_requested / txn.invoice_amount) * 100).toFixed(1))
          : null)
    : null

  // Wire info for supplier (disbursement_reference is nulled for anchor by API)
  const wireInfoForSummary = txn ? parseWireInfo(txn.disbursement_reference) : null

  return (
    <PortalShell activeSection="transactions">
      <Topbar
        onBack={() => {
          try { sessionStorage.removeItem(TRANSACTION_REFERRER_KEY) } catch {}
          router.push(backPath)
        }}
        crumbs={[
          { label: portalLabel },
          { label: 'Transactions', onClick: () => router.push('/transactions') },
          { label: loading ? '…' : (txn?.id ?? 'Transaction') },
        ]}
      />

      <div className="page">
        {loading ? (
          <div className="page-header">
            <div style={{ height: 28, width: 240, background: 'var(--color-border)', borderRadius: 6 }} />
            <div style={{ height: 16, width: 320, background: 'var(--color-border)', borderRadius: 4, marginTop: 8 }} />
          </div>
        ) : error ? (
          <div className="alert alert-error" style={{ marginBottom: 24 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">Failed to load transaction: {error}</div>
          </div>
        ) : txn ? (
          <>
            <div className="page-header">
              <h1 className="page-id-title">
                <span className="id-text">{txn.invoice_number}</span>
                <span className={`badge ${statusBadge(txn.status)}`}>{statusLabel(txn.status)}</span>
                {(txn.type ?? txn.financing_type) && (
                  <span className="badge badge-active">{typeLabel}</span>
                )}
              </h1>
              {subtitle && (
                <div className="subtitle" style={{ marginTop: 6 }}>{subtitle}</div>
              )}
            </div>

            <div className="split-65">
              {/* ── LEFT column ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Financial summary */}
                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">Financial summary</h3>
                  </div>
                  <div className="fs-grid">
                    <div className="fs-cell">
                      <span className="fs-label">Invoice amount</span>
                      <span className="fs-value">{fmtAmt(txn.invoice_amount)}</span>
                    </div>
                    <div className="fs-cell">
                      <span className="fs-label">Advance rate</span>
                      <span className="fs-value">
                        {displayAdvanceRate != null ? `${displayAdvanceRate}%` : '—'}
                      </span>
                    </div>
                    <div className="fs-cell">
                      <span className="fs-label">Amount disbursed</span>
                      <span className={`fs-value ${txn.financing_amount_approved != null ? 'green' : ''}`}>
                        {fmtAmt(txn.financing_amount_approved)}
                      </span>
                    </div>
                    <div className="fs-cell">
                      <span className="fs-label">Discount fee</span>
                      <span className="fs-value">{fmtAmt(txn.fee_amount)}</span>
                    </div>
                  </div>
                  {/* Wire info in summary — only for supplier (API nulls it for anchor) */}
                  {portal === 'supplier' && wireInfoForSummary && Object.values(wireInfoForSummary).some(Boolean) && (
                    <>
                      {wireInfoForSummary.bank_name && (
                        <div className="fs-extra-row">
                          <span className="k">Wire bank</span>
                          <span className="v">{wireInfoForSummary.bank_name}</span>
                        </div>
                      )}
                      {wireInfoForSummary.account_number && (
                        <div className="fs-extra-row">
                          <span className="k">Account</span>
                          <span className="v mono">
                            {'••••' + wireInfoForSummary.account_number.slice(-4)}
                          </span>
                        </div>
                      )}
                      {wireInfoForSummary.reference && (
                        <div className="fs-extra-row">
                          <span className="k">Reference</span>
                          <span className="v mono">{wireInfoForSummary.reference}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Invoice details */}
                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">Invoice details</h3>
                  </div>
                  <div className="kv-rows">
                    {txn.invoice_number && (
                      <div className="kv-row">
                        <span className="k">Invoice number</span>
                        <span className="v">{txn.invoice_number}</span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="k">Invoice date</span>
                      <span className="v plain">{fmtDate(txn.invoice_date)}</span>
                    </div>
                    <div className="kv-row">
                      <span className="k">Invoice due date</span>
                      <span className="v plain">{fmtDate(txn.invoice_due_date)}</span>
                    </div>
                    {txn.description && (
                      <div className="kv-row" style={{ alignItems: 'flex-start' }}>
                        <span className="k" style={{ paddingTop: 2 }}>Description</span>
                        <span className="v plain" style={{ maxWidth: '60%', textAlign: 'right' }}>
                          {txn.description}
                        </span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="k">Program</span>
                      <span className="v plain">{txn.program_name ?? '—'}</span>
                    </div>
                    <div className="kv-row">
                      <span className="k">Supplier</span>
                      <span className="v plain">{txn.supplier_name ?? '—'}</span>
                    </div>
                    <div className="kv-row">
                      <span className="k">Anchor</span>
                      <span className="v plain">{txn.anchor_name ?? '—'}</span>
                    </div>
                    {txn.bank_name && (
                      <div className="kv-row">
                        <span className="k">Bank</span>
                        <span className="v plain">{txn.bank_name}</span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="k">Submitted</span>
                      <span className="v plain">{fmtDate(txn.created_at)}</span>
                    </div>
                    {txn.disbursed_at && (
                      <div className="kv-row">
                        <span className="k">Disbursed</span>
                        <span className="v plain">{fmtDate(txn.disbursed_at)}</span>
                      </div>
                    )}
                    {txn.repaid_at && (
                      <div className="kv-row">
                        <span className="k">Repaid</span>
                        <span className="v plain">{fmtDate(txn.repaid_at)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Collateral */}
                {(collateral.length > 0 || portal === 'bank') && (
                  <div className="card">
                    <div className="card-head">
                      <span>Collateral</span>
                      {portal === 'bank' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => setShowAddCollateral(s => !s)}
                        >
                          {showAddCollateral ? 'Cancel' : 'Add'}
                        </button>
                      )}
                    </div>

                    {collateral.length === 0
                      ? portal === 'bank' && (
                          <div className="card-body">
                            <p style={{ fontSize: 13, color: 'var(--color-ink-3)', margin: 0 }}>
                              No collateral requirements
                            </p>
                          </div>
                        )
                      : collateral.map(item => (
                          <div key={item.id}>
                            <div className="collateral-row">
                              <div className="cdot" style={{
                                background: item.status === 'accepted'
                                  ? 'var(--color-green)'
                                  : item.status === 'rejected'
                                  ? 'var(--color-red)'
                                  : item.status === 'submitted'
                                  ? 'var(--color-accent)'
                                  : 'var(--color-amber)',
                              }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 500 }}>
                                  {formatCollateralType(item.collateral_type)}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                                  {item.description}
                                </div>
                              </div>
                              <span className={`badge ${collateralStatusBadge(item.status)}`}>
                                {item.status}
                              </span>
                              {portal === 'supplier' && item.status === 'pending' && (
                                submittingCollateral?.id === item.id ? null : (
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => setSubmittingCollateral(item)}
                                  >
                                    Submit
                                  </button>
                                )
                              )}
                              {portal === 'bank' && item.status === 'submitted' && (
                                <button
                                  className="btn btn-primary btn-sm"
                                  type="button"
                                  onClick={() => setReviewingCollateral(item)}
                                >
                                  Review
                                </button>
                              )}
                              {portal === 'bank' && item.status === 'accepted' && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  type="button"
                                  onClick={() => handleCollateralAction(item.id, { action: 'release' })}
                                >
                                  Release
                                </button>
                              )}
                            </div>
                            {/* Supplier submission form */}
                            {portal === 'supplier' && submittingCollateral?.id === item.id && (
                              <div className="card-body" style={{ borderTop: '1px solid var(--color-border)' }}>
                                <SupplierCollateralSubmitForm
                                  item={item}
                                  txnId={id}
                                  onDone={() => {
                                    setSubmittingCollateral(null)
                                    refreshCollateral()
                                    load()
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ))
                    }

                    {reviewingCollateral && (
                      <div className="card-body" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
                          Review: {formatCollateralType(reviewingCollateral.collateral_type)}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            onClick={() => handleCollateralAction(reviewingCollateral.id, { action: 'accept' })}
                          >
                            Accept
                          </button>
                          <textarea
                            className="input"
                            placeholder="Waiver note (required to waive)"
                            value={waiverNote}
                            onChange={e => setWaiverNote(e.target.value)}
                            style={{ height: 60, resize: 'none', width: '100%' }}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => handleCollateralAction(reviewingCollateral.id, { action: 'waive', waiver_note: waiverNote })}
                          >
                            Waive
                          </button>
                          <textarea
                            className="input"
                            placeholder="Rejection reason (required)"
                            value={rejectionReason}
                            onChange={e => setRejectionReason(e.target.value)}
                            style={{ height: 60, resize: 'none', width: '100%' }}
                          />
                          <button
                            className="btn btn-danger btn-sm"
                            type="button"
                            disabled={!rejectionReason.trim()}
                            onClick={() => handleCollateralAction(reviewingCollateral.id, { action: 'reject', rejection_reason: rejectionReason })}
                          >
                            Reject
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => setReviewingCollateral(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {showAddCollateral && (
                      <div className="card-body" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Type</div>
                            <select
                              className="input"
                              value={addCollForm.collateral_type}
                              onChange={e => setAddCollForm(f => ({ ...f, collateral_type: e.target.value }))}
                              style={{ width: '100%' }}
                            >
                              <option value="post_dated_cheque">Post-dated Cheque</option>
                              <option value="personal_guarantee">Personal Guarantee</option>
                              <option value="assignment_of_receivables">Assignment of Receivables</option>
                              <option value="cash_collateral">Cash Collateral</option>
                              <option value="asset_pledge">Asset Pledge</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Description *</div>
                            <textarea
                              className="input"
                              value={addCollForm.description}
                              onChange={e => setAddCollForm(f => ({ ...f, description: e.target.value }))}
                              placeholder="Describe the collateral requirement…"
                              style={{ width: '100%', height: 72, resize: 'none' }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Required value (optional)</div>
                            <input
                              className="input mono"
                              value={addCollForm.required_value}
                              onChange={e => setAddCollForm(f => ({ ...f, required_value: e.target.value }))}
                              placeholder="0.00"
                              style={{ width: '100%' }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--color-ink-4)', marginBottom: 4 }}>Deadline *</div>
                            <input
                              type="date"
                              className="input"
                              value={addCollForm.deadline}
                              onChange={e => setAddCollForm(f => ({ ...f, deadline: e.target.value }))}
                              style={{ width: '100%' }}
                            />
                          </div>
                          {addCollError && (
                            <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{addCollError}</div>
                          )}
                          {addCollSuccess && (
                            <div style={{ fontSize: 12, color: 'var(--color-green)' }}>Requirement added</div>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              type="button"
                              disabled={addCollSaving}
                              onClick={handleAddCollateral}
                            >
                              {addCollSaving ? 'Adding…' : 'Add'}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              onClick={() => { setShowAddCollateral(false); setAddCollError(null) }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Documents */}
                {(portal !== 'supplier' || documents.length > 0) && (
                  <div className="card">
                    <div className="card-head">
                      <h3 className="t-card-head">Documents</h3>
                    </div>
                    {documents.length === 0 ? (
                      <div className="card-body">
                        <p style={{ fontSize: 13, color: 'var(--color-ink-4)', margin: 0 }}>
                          No documents uploaded
                        </p>
                      </div>
                    ) : (
                      <div className="kv-rows">
                        {documents.map((doc) => (
                          <div key={doc.id} className="doc-row">
                            <span className="doc-icon">
                              <svg width="14" height="14" viewBox="0 0 16 16">
                                <use href="#i-doc" />
                              </svg>
                            </span>
                            <span className="doc-name">{doc.name}</span>
                            <span className="doc-date">
                              {new Date(doc.created_at).toLocaleDateString('en-US', {
                                month: 'short', day: 'numeric', year: 'numeric',
                              })}
                            </span>
                            {doc.signed_url && (
                              <a
                                href={doc.signed_url}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-ghost btn-sm"
                                style={{ textDecoration: 'none' }}
                              >
                                Download
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Event history */}
                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">History</h3>
                  </div>
                  {events.length === 0 ? (
                    <div className="card-body" style={{ color: 'var(--color-ink-4)', fontSize: 12 }}>
                      No events yet
                    </div>
                  ) : (
                    <div className="timeline">
                      {[...events].reverse().map((e) => {
                        const actor = (e.actor as string) ?? 'system'
                        const dotColor =
                          actor === 'bank'     ? 'blue'   :
                          actor === 'anchor'   ? 'amber'  :
                          actor === 'supplier' ? 'purple' : 'gray'
                        return (
                          <div key={e.id} className="tl-item">
                            <span className={`tl-dot ${dotColor}`} />
                            <span className="tl-line" />
                            <div className="tl-body">
                              <div className="tl-actor-row">
                                <span className={`tl-actor-pill ${actor}`}>
                                  {actor.charAt(0).toUpperCase() + actor.slice(1)}
                                </span>
                                <span className="tl-actor-name">{e.actor_name}</span>
                                <span className="tl-action">{humanizeEvent(e)}</span>
                              </div>
                              {e.notes && (
                                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-ink-3)' }}>
                                  {e.notes}
                                </div>
                              )}
                            </div>
                            <span className="tl-time">{fmtDateTime(e.created_at)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ── RIGHT column (sticky) ── */}
              <div style={{ position: 'sticky', top: 62, alignSelf: 'flex-start' }}>
                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">Status tracker</h3>
                  </div>

                  <div className="stepper">
                    {(isPOFinancing ? PO_STEPPER_STEPS : isInvoiceFactoring ? IF_STEPPER_STEPS : RF_STEPPER_STEPS).map((step, i) => {
                      const state = isPOFinancing
                        ? poStepperState(step.key, txn.status)
                        : isInvoiceFactoring
                        ? ifStepperState(step.key, txn.status)
                        : rfStepperState(step.key, txn.status)
                      return (
                        <div key={step.key} className={`step ${state}`}>
                          <span className={`step-circle ${state}`}>
                            {state === 'done' ? <Icon name="check" size={11} /> : i + 1}
                          </span>
                          <span className={`step-line ${state === 'done' ? 'done' : ''}`} />
                          <div className="step-body">
                            <span className="step-name">{step.label}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {actionSuccess && (
                    <div style={{ padding: '8px 16px' }}>
                      <div style={{
                        background: 'var(--color-green-bg)',
                        color: 'var(--color-green)',
                        borderRadius: 6,
                        padding: '8px 12px',
                        fontSize: 13,
                      }}>
                        ✓ {actionSuccess}
                      </div>
                    </div>
                  )}

                  {actionError && (
                    <div style={{ padding: '8px 16px', color: 'var(--color-red)', fontSize: 12 }}>
                      {actionError}
                    </div>
                  )}

                  {portal === 'bank' && (
                    <BankActionPanel
                      transaction={txn}
                      onAction={handleAction}
                      acting={acting}
                      txnId={id}
                      onRefresh={load}
                      isInvoiceFactoring={isInvoiceFactoring}
                      isPOFinancing={isPOFinancing}
                    />
                  )}
                  {portal === 'anchor' && (
                    <AnchorActionPanel
                      transaction={txn}
                      onAction={handleAction}
                      acting={acting}
                      onSuccess={handleSuccess}
                      isInvoiceFactoring={isInvoiceFactoring}
                      isPOFinancing={isPOFinancing}
                    />
                  )}
                  {portal === 'supplier' && (
                    <SupplierActionPanel
                      transaction={txn}
                      onAction={handleAction}
                      acting={acting}
                      isInvoiceFactoring={isInvoiceFactoring}
                      isPOFinancing={isPOFinancing}
                    />
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </PortalShell>
  )
}
