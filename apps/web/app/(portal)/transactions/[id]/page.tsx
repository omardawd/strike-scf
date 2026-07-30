'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { TRANSACTION_REFERRER_KEY } from '@/lib/transaction-referrer'
import { PortalShell, Topbar, Icon } from '@/components/portal-shell'
import { AIInsight } from '@/components/ai-insight'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

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
  discount_rate: number | null
  early_payment_date: string | null
  discount_amount: number | null
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
    return { reference: raw }
  } catch { return { reference: raw } }
}

function getRepaymentInstructions(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed.repayment_instructions === 'string' ? parsed.repayment_instructions : null
  } catch { return raw }
}

function formatCollateralType(type: string, t: TFn): string {
  const labels: Record<string, string> = {
    post_dated_cheque:         t('txnDetail.collateral.postDatedCheque'),
    personal_guarantee:        t('txnDetail.collateral.personalGuarantee'),
    assignment_of_receivables: t('txnDetail.collateral.assignmentOfReceivables'),
    cash_collateral:           t('txnDetail.collateral.cashCollateral'),
    asset_pledge:              t('txnDetail.collateral.assetPledge'),
    other:                     t('txnDetail.collateral.other'),
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
function rfStepperSteps(t: TFn) {
  return [
    { key: 'pending_anchor_approval',          label: t('txnDetail.stepper.anchorReview') },
    { key: 'pending_bank_review',              label: t('txnDetail.stepper.bankReview') },
    { key: 'pending_supplier_counter_review',  label: t('txnDetail.stepper.supplierReview') },
    { key: 'financing_approved',              label: t('transactionsPage.approved') },
    { key: 'funded',                           label: t('txnDetail.stepper.disbursed') },
    { key: 'completed',                        label: t('txnDetail.stepper.repaid') },
  ]
}

const RF_STATUS_ORDER = ['pending_anchor_approval', 'pending_bank_review', 'pending_supplier_counter_review', 'financing_approved', 'funded', 'completed']

function ifStepperSteps(t: TFn) {
  return [
    { key: 'pending_bank_review',              label: t('txnDetail.stepper.bankReview') },
    { key: 'pending_supplier_counter_review',  label: t('txnDetail.stepper.supplierReview') },
    { key: 'financing_approved',               label: t('transactionsPage.approved') },
    { key: 'funded',                           label: t('txnDetail.stepper.disbursed') },
    { key: 'completed',                        label: t('txnDetail.stepper.repaid') },
  ]
}

const IF_STATUS_ORDER = ['pending_bank_review', 'pending_supplier_counter_review', 'financing_approved', 'funded', 'completed']

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

const PO_STEPPER_KEYS = ['po_submitted', 'pending_bank_review', 'financing_approved', 'funded', 'invoice_submitted', 'pending_anchor_confirmation', 'repayment_due', 'completed']

function poStepperSteps(t: TFn) {
  return [
    { key: 'po_submitted',                label: t('txnDetail.stepper.poSubmitted') },
    { key: 'pending_bank_review',         label: t('txnDetail.stepper.bankReview') },
    { key: 'financing_approved',          label: t('txnDetail.stepper.financingApproved') },
    { key: 'funded',                      label: t('txnDetail.stepper.disbursed') },
    { key: 'invoice_submitted',           label: t('txnDetail.stepper.invoiceSubmitted') },
    { key: 'pending_anchor_confirmation', label: t('txnDetail.stepper.anchorConfirmation') },
    { key: 'repayment_due',              label: t('txnDetail.stepper.repaymentDue') },
    { key: 'completed',                   label: t('deals.status.completed') },
  ]
}

function poStatusToStepIndex(status: string): number {
  switch (status) {
    case 'pending_bank_review':
    case 'pending_supplier_counter_review':
    case 'more_info_requested':
    case 'rejected':
      return 1
    case 'financing_approved':
      return 2
    case 'funded':
      return 3
    case 'pending_anchor_confirmation':
    case 'in_dispute':
      return 5
    case 'repayment_due':
      return 6
    case 'completed':
      return 7
    default:
      return -1
  }
}

function poStepperState(stepKey: string, status: string): 'done' | 'current' | 'todo' {
  const stepIdx    = PO_STEPPER_KEYS.indexOf(stepKey)
  const currentIdx = poStatusToStepIndex(status)

  if (currentIdx === -1 || stepIdx === -1) return 'todo'
  if (stepIdx < currentIdx)  return 'done'
  if (stepIdx === currentIdx) return 'current'
  return 'todo'
}

function ddStepperSteps(t: TFn) {
  return [
    { key: 'pending_anchor_approval', label: t('txnDetail.stepper.anchorReview') },
    { key: 'funded',                  label: t('txnDetail.stepper.paymentApproved') },
    { key: 'completed',               label: t('deals.status.completed') },
  ]
}

const DD_STATUS_ORDER = ['pending_anchor_approval', 'funded', 'completed']

function ddStepperState(stepKey: string, status: string): 'done' | 'current' | 'todo' {
  let eff = status
  if (status === 'rejected') eff = 'pending_anchor_approval'
  const stepIdx    = DD_STATUS_ORDER.indexOf(stepKey)
  const currentIdx = DD_STATUS_ORDER.indexOf(eff)
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

function statusLabel(status: string, t: TFn): string {
  switch (status) {
    case 'pending_anchor_approval':         return t('transactionsPage.pendingApproval')
    case 'pending_bank_review':             return t('transactionsPage.pendingBankReview')
    case 'pending_supplier_counter_review': return t('txnDetail.status.counterOfferPending')
    case 'more_info_requested':             return t('transactionsPage.moreInfoNeeded')
    case 'financing_approved':              return t('transactionsPage.approved')
    case 'funded':                          return t('transactionsPage.funded')
    case 'pending_anchor_confirmation':     return t('txnDetail.status.awaitingAnchorConfirmation')
    case 'repayment_due':                   return t('txnDetail.status.repaymentDue')
    case 'in_dispute':                      return t('txnDetail.status.inDispute')
    case 'completed':                       return t('deals.status.completed')
    case 'rejected':                        return t('transactionsPage.rejected')
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

function frequencyLabel(structure: string | undefined, t: TFn): string {
  switch (structure) {
    case 'weekly':    return t('txnDetail.frequency.weekly')
    case 'biweekly':  return t('txnDetail.frequency.biweekly')
    case 'monthly':   return t('txnDetail.frequency.monthly')
    case 'quarterly': return t('txnDetail.frequency.quarterly')
    default:          return structure ?? ''
  }
}

function humanizeEvent(e: TransactionEvent, t: TFn): string {
  switch (e.event_type) {
    case 'transaction_submitted':    return t('txnDetail.event.submittedTransaction')
    case 'created': {
      const rateMatch = e.notes?.match(/(\d+(?:\.\d+)?)%/)
      return rateMatch?.[1] ? t('txnDetail.event.submittedInvoiceRate', { rate: rateMatch[1] }) : t('txnDetail.event.transactionCreated')
    }
    case 'anchor_approved':          return t('txnDetail.event.approvedInvoice')
    case 'anchor_rejected':          return t('txnDetail.event.rejectedInvoice')
    case 'bank_approved':            return t('txnDetail.event.approvedFinancing')
    case 'bank_rejected':            return t('txnDetail.event.rejectedTransaction')
    case 'bank_requested_info':      return t('txnDetail.event.requestedMoreInfo')
    case 'more_info_provided':       return t('txnDetail.event.providedAdditionalInfo')
    case 'counter_offer_submitted': {
      const base = e.actor === 'bank' ? t('txnDetail.event.sentCounterToSupplier') : t('txnDetail.event.sentCounterToBank')
      const rateMatch = e.notes?.match(/(\d+(?:\.\d+)?)%/)
      return rateMatch?.[1] ? `${base} — ${t('txnDetail.event.advanceRatePct', { rate: rateMatch[1] })}` : base
    }
    case 'counter_offer_accepted':   return t('txnDetail.event.acceptedCounterOffer')
    case 'counter_offer_rejected':   return t('txnDetail.event.declinedCounterOffer')
    case 'wire_info_sent':                         return t('txnDetail.event.sentWireInfo')
    case 'repayment_info_sent':                    return t('txnDetail.event.sentRepaymentInstructions')
    case 'anchor_repayment_extension_requested':   return t('txnDetail.event.requestedRepaymentExtension')
    case 'anchor_repayment_installment_requested': return t('txnDetail.event.requestedInstallmentStructure')
    case 'anchor_accepted_repayment_counter':      return t('txnDetail.event.acceptedBankRepaymentCounter')
    case 'anchor_rejected_repayment_counter':      return t('txnDetail.event.declinedBankRepaymentCounter')
    case 'anchor_repayment_approved':              return t('txnDetail.event.bankApprovedRepaymentRequest')
    case 'anchor_repayment_rejected':              return t('txnDetail.event.bankDeclinedRepaymentRequest')
    case 'anchor_repayment_countered':             return t('txnDetail.event.bankCounterProposedRepayment')
    case 'disbursement_marked':                    return t('txnDetail.event.disbursedFunds')
    case 'repayment_marked':         return t('txnDetail.event.markedAsRepaid')
    case 'disbursed':                return t('txnDetail.event.disbursedFunds')
    case 'repaid':                   return t('txnDetail.event.recordedRepayment')
    case 'funded':                   return t('txnDetail.event.transactionFunded')
    case 'completed':                return t('txnDetail.event.transactionCompleted')
    case 'document_uploaded':        return t('txnDetail.event.uploadedDocument')
    case 'collateral_updated':       return t('txnDetail.event.updatedCollateralRequirement')
    case 'status_change':
    case 'status_changed':
      if (e.notes === 'Invoice submitted after delivery') return t('txnDetail.event.submittedInvoiceAfterDelivery')
      return e.to_status ? t('txnDetail.event.statusUpdatedTo', { status: statusLabel(e.to_status, t) }) : t('txnDetail.event.statusUpdated')
    default:
      return (e.action || e.event_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

// ── Anchor standalone repayment request section (RF only, always visible) ──

type RepaymentRequest = {
  type?: string; status?: string; requested_date?: string;
  count?: number; structure?: string; notes?: string;
  bank_counter?: { date?: string; count?: number; structure?: string };
  rejection_reason?: string;
}

function AnchorStandaloneRepaymentSection({
  transaction,
  onAction,
  acting,
}: {
  transaction: Transaction
  onAction: (body: Record<string, unknown>) => Promise<void>
  acting: boolean
}) {
  const t = useT()
  const [mode, setMode]           = useState<'none'|'extension'|'installment'>('none')
  const [extDate, setExtDate]     = useState('')
  const [extNotes, setExtNotes]   = useState('')
  const [instCount, setInstCount] = useState(2)
  const [instStructure, setInstStructure] = useState<'weekly'|'biweekly'|'monthly'|'quarterly'>('monthly')
  const [instNotes, setInstNotes] = useState('')

  const negState   = (() => { try { return JSON.parse(transaction.bank_approval_notes ?? '{}') } catch { return {} } })()
  const repRequest = negState.anchor_repayment_request as RepaymentRequest | undefined

  const isTerminal = ['rejected', 'cancelled', 'completed'].includes(transaction.status)
  if (isTerminal && !repRequest) return null

  if (mode === 'extension') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('txnDetail.requestRepaymentExtension')}</div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.requestedDate')}</div>
          <input type="date" className="input" value={extDate} onChange={e => setExtDate(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.notesOptional')}</div>
          <textarea className="form-input" rows={2} value={extNotes} onChange={e => setExtNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" type="button" disabled={!extDate || acting}
            onClick={async () => { await onAction({ action: 'request_extension', extension_date: extDate, ...(extNotes ? { notes: extNotes } : {}) }); setMode('none') }}>
            {acting ? t('txnDetail.sending') : t('txnDetail.submitRequest')}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('none')}>{t('common.cancel')}</button>
        </div>
      </div>
    )
  }

  if (mode === 'installment') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('txnDetail.requestInstallmentStructure')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.installments')}</div>
            <input type="number" className="input" min="2" max="52" value={instCount} onChange={e => setInstCount(Number(e.target.value))} onWheel={e => (e.target as HTMLInputElement).blur()} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.frequency.label')}</div>
            <select className="input" value={instStructure} onChange={e => setInstStructure(e.target.value as 'weekly'|'biweekly'|'monthly'|'quarterly')}>
              <option value="weekly">{t('txnDetail.frequency.weekly')}</option>
              <option value="biweekly">{t('txnDetail.frequency.biweekly')}</option>
              <option value="monthly">{t('txnDetail.frequency.monthly')}</option>
              <option value="quarterly">{t('txnDetail.frequency.quarterly')}</option>
            </select>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.notesOptional')}</div>
          <textarea className="form-input" rows={2} value={instNotes} onChange={e => setInstNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" type="button" disabled={acting}
            onClick={async () => { await onAction({ action: 'request_installment', count: instCount, structure: instStructure, ...(instNotes ? { notes: instNotes } : {}) }); setMode('none') }}>
            {acting ? t('txnDetail.sending') : t('txnDetail.submitRequest')}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('none')}>{t('common.cancel')}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {repRequest?.status === 'rejected' ? (
        <div style={{
          padding: '10px 14px',
          background: 'var(--offwhite)',
          borderRadius: 8,
          fontSize: 13,
          color: 'var(--gray)',
        }}>
          {t('txnDetail.repaymentRequestDeclinedHint')}
        </div>
      ) : !repRequest ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--gray)' }}>
            {t('txnDetail.requestExtensionOrInstallmentHint')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('extension')}>{t('txnDetail.requestExtension')}</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setMode('installment')}>{t('txnDetail.requestInstallments')}</button>
          </div>
        </div>
      ) : repRequest.status === 'pending_bank_review' ? (
        <div>
          <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.awaitingBankReview')}</div>
          {repRequest.type === 'extension' && repRequest.requested_date && (
            <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{t('txnDetail.requestedDate')}: {repRequest.requested_date}</div>
          )}
          {repRequest.type === 'installment' && repRequest.count && (
            <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{t('txnDetail.countInstallments', { count: repRequest.count, frequency: frequencyLabel(repRequest.structure, t) })}</div>
          )}
        </div>
      ) : repRequest.status === 'bank_countered' ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-amber)', marginBottom: 6 }}>{t('txnDetail.bankHasCounterProposal')}</div>
          {repRequest.bank_counter?.date && (
            <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>{t('txnDetail.counterDate')}: {repRequest.bank_counter.date}</div>
          )}
          {repRequest.bank_counter?.count != null && (
            <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>
              {t('txnDetail.counterCountInstallments', { count: repRequest.bank_counter.count, frequency: frequencyLabel(repRequest.bank_counter.structure, t) })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" type="button" disabled={acting}
              onClick={() => onAction({ action: 'accept_repayment_counter' })}>
              {acting ? t('txnDetail.processing') : t('listingDetail.accept')}
            </button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={acting}
              onClick={() => onAction({ action: 'reject_repayment_counter' })}>
              {t('txnDetail.decline')}
            </button>
          </div>
        </div>
      ) : repRequest.status === 'approved' ? (
        <div style={{ fontSize: 12.5, color: 'var(--color-green)' }}>{t('txnDetail.repaymentRequestApproved')} ✓</div>
      ) : null}
    </div>
  )
}

// ── Bank anchor repayment request card (shown independently on bank portal) ──

function BankAnchorRepaymentRequestCard({
  transaction,
  onAction,
  acting,
}: {
  transaction: Transaction
  onAction: (body: Record<string, unknown>) => Promise<void>
  acting: boolean
}) {
  const t = useT()
  const [counterMode, setCounterMode]       = useState(false)
  const [counterDate, setCounterDate]       = useState('')
  const [counterCount, setCounterCount]     = useState(2)
  const [counterStructure, setCounterStructure] = useState<'weekly'|'biweekly'|'monthly'|'quarterly'>('monthly')
  const [rejectReason, setRejectReason]     = useState('')

  const negState   = (() => { try { return JSON.parse(transaction.bank_approval_notes ?? '{}') } catch { return {} } })()
  const repRequest = negState.anchor_repayment_request as RepaymentRequest | undefined

  if (!repRequest) return null

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-amber)', marginBottom: 8 }}>{t('txnDetail.anchorRepaymentRequest')}</div>

      {repRequest.type === 'extension' && repRequest.requested_date && (
        <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>{t('txnDetail.extensionTo')}: {repRequest.requested_date}</div>
      )}
      {repRequest.type === 'installment' && repRequest.count != null && (
        <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>{t('txnDetail.countInstallments', { count: repRequest.count, frequency: frequencyLabel(repRequest.structure, t) })}</div>
      )}
      {repRequest.notes && (
        <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 8 }}>{t('txnDetail.notesLabel')}: {repRequest.notes}</div>
      )}

      {repRequest.status === 'pending_bank_review' && !counterMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" type="button" disabled={acting}
            onClick={() => onAction({ action: 'review_repayment_request', decision: 'approve' })}>
            {acting ? t('txnDetail.processing') : t('txnDetail.approveRequest')}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCounterMode(true)}>{t('txnDetail.counterOffer')}</button>
          <div>
            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.rejectionReasonOptional')}</div>
            <input className="input" style={{ width: '100%' }} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder={t('txnDetail.reasonPlaceholder')} />
          </div>
          <button className="btn btn-danger btn-sm" type="button" disabled={acting}
            onClick={() => onAction({ action: 'review_repayment_request', decision: 'reject', rejection_reason: rejectReason })}>
            {t('txnDetail.decline')}
          </button>
        </div>
      )}

      {repRequest.status === 'pending_bank_review' && counterMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {repRequest.type === 'extension' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.counterDate')}</div>
              <input type="date" className="input" value={counterDate} onChange={e => setCounterDate(e.target.value)} style={{ width: '100%' }} />
            </div>
          )}
          {repRequest.type === 'installment' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.installments')}</div>
                <input type="number" className="input" min="2" value={counterCount} onChange={e => setCounterCount(Number(e.target.value))} onWheel={e => (e.target as HTMLInputElement).blur()} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.frequency.label')}</div>
                <select className="input" value={counterStructure} onChange={e => setCounterStructure(e.target.value as 'weekly'|'biweekly'|'monthly'|'quarterly')}>
                  <option value="weekly">{t('txnDetail.frequency.weekly')}</option>
                  <option value="biweekly">{t('txnDetail.frequency.biweekly')}</option>
                  <option value="monthly">{t('txnDetail.frequency.monthly')}</option>
                  <option value="quarterly">{t('txnDetail.frequency.quarterly')}</option>
                </select>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" type="button"
              disabled={acting || (repRequest.type === 'extension' && !counterDate)}
              onClick={() => onAction({
                action: 'review_repayment_request', decision: 'counter',
                ...(repRequest.type === 'extension' ? { counter_date: counterDate } : { counter_count: counterCount, counter_structure: counterStructure }),
              })}>
              {acting ? t('txnDetail.sending') : t('txnDetail.submitCounter')}
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCounterMode(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {repRequest.status === 'bank_countered' && (
        <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 4 }}>
          {t('txnDetail.counterOfferSentAwaitingAnchor')}
          {repRequest.bank_counter?.date && <div style={{ marginTop: 4 }}>{t('txnDetail.counterDate')}: {repRequest.bank_counter.date}</div>}
          {repRequest.bank_counter?.count != null && (
            <div style={{ marginTop: 4 }}>{t('txnDetail.counterCountInstallments', { count: repRequest.bank_counter.count, frequency: frequencyLabel(repRequest.bank_counter.structure, t) })}</div>
          )}
        </div>
      )}

      {repRequest.status === 'approved' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', background: 'rgba(var(--color-green-rgb, 34,197,94), 0.08)', borderRadius: 8, marginTop: 4 }}>
          <span style={{ fontSize: 12.5, color: 'var(--color-green)', fontWeight: 500 }}>{t('txnDetail.repaymentRequestApproved')} ✓</span>
        </div>
      )}

      {repRequest.status === 'rejected' && (
        <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 4 }}>
          {t('txnDetail.requestDeclined')}{repRequest.rejection_reason ? ` — ${repRequest.rejection_reason}` : ''}
        </div>
      )}
    </div>
  )
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
  const t = useT()
  const { status } = transaction
  const invoiceAmt = transaction.invoice_amount ?? 0

  // Parse parallel negotiation state
  const negotiationState = (() => {
    try { return JSON.parse(transaction.bank_approval_notes ?? '{}') } catch { return {} }
  })()
  const supplierNeg = negotiationState.supplier_negotiation as {
    status?: string
    bank_offer?: { advance_rate?: number; amount?: number; fee?: number }
    bank_counter_rate?: number
    supplier_counter?: { advance_rate?: number; amount?: number; submitted_at?: string }
  } | undefined
  const anchorNeg   = negotiationState.anchor_negotiation   as {
    type?: string; status?: string;
    anchor_request?: { date?: string; count?: number; structure?: string; notes?: string };
    bank_counter?:   { date?: string; count?: number; structure?: string };
  } | undefined

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
  const [discountFee, setDiscountFee]   = useState(0)
  const [counterError, setCounterError] = useState<string | null>(null)

  // Anchor negotiation counter form state
  const [anchorCounterMode, setAnchorCounterMode]           = useState(false)
  const [anchorCounterDate, setAnchorCounterDate]           = useState('')
  const [anchorCounterCount, setAnchorCounterCount]         = useState(2)
  const [anchorCounterStructure, setAnchorCounterStructure] = useState<'weekly'|'biweekly'|'monthly'|'quarterly'>('monthly')

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

  // ── financing_approved: send wire reference + mark as disbursed ───────────
  if (status === 'financing_approved') {
    const handleDisburse = async () => {
      setDisbursing(true)
      setDisbError(null)
      try {
        const res = await fetch(`/api/transactions/${txnId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disburse', disbursement_reference: disbRef.trim() || null }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
        onRefresh()
      } catch (err) {
        setDisbError(err instanceof Error ? err.message : t('txnDetail.failedToDisburse'))
      } finally {
        setDisbursing(false)
      }
    }

    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
          {t('txnDetail.sendWireTransferToSupplier')}
        </p>
        <div className="calc-panel">
          <div className="calc-row">
            <span>{t('txnDetail.approvedAmount')}</span>
            <span>{fmtAmt(transaction.financing_amount_approved)}</span>
          </div>
          {(transaction.apr ?? transaction.financing_rate_apr) != null && (
            <div className="calc-row">
              <span>{t('newTransaction.advanceRate')}</span>
              <span>{transaction.apr ?? transaction.financing_rate_apr}%</span>
            </div>
          )}
          {transaction.fee_amount != null && (
            <div className="calc-row">
              <span>{t('txnDetail.discountFee')}</span>
              <span>{fmtAmt(transaction.fee_amount)}</span>
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.wireReferenceMemo')}</div>
          <input
            className="input"
            placeholder={t('txnDetail.wireReferencePlaceholder')}
            value={disbRef}
            onChange={e => setDisbRef(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        {disbError && <div style={{ fontSize: 12, color: '#DC2626' }}>{disbError}</div>}
        <button className="btn btn-primary btn-full" type="button" disabled={disbursing} onClick={handleDisburse}>
          {disbursing ? t('txnDetail.processing') : t('txnDetail.markAsDisbursed')}
        </button>
      </div>
    )
  }

  // ── funded: PO passive / RF repayment form ───────────────────────────────
  if (status === 'funded' && isPOFinancing) {
    return (
      <div className="action-passive muted">
        {t('txnDetail.waitingForSupplierToDeliver')}
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
        setRepaymentError(err instanceof Error ? err.message : t('txnDetail.failedToSend'))
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
        setRepaidError(err instanceof Error ? err.message : t('txnDetail.failedToMarkAsRepaid'))
      } finally {
        setMarkingRepaid(false)
      }
    }

    if (repaymentAlreadySent || repaymentSent) {
      return (
        <div className="action-block">
          <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-green)', margin: 0 }}>
            {t('txnDetail.repaymentInstructionsSent')}
          </p>
          <div className="calc-panel">
            {transaction.repayment_due_date && (
              <div className="calc-row">
                <span>{t('txnDetail.dueDate')}</span>
                <span>{fmtDate(transaction.repayment_due_date)}</span>
              </div>
            )}
            {getRepaymentInstructions(transaction.bank_approval_notes) && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>{t('txnDetail.instructions')}</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
                  {getRepaymentInstructions(transaction.bank_approval_notes)}
                </span>
              </div>
            )}
          </div>
          {repaidError && <div style={{ fontSize: 12, color: '#DC2626' }}>{repaidError}</div>}
          <button
            className="btn btn-primary btn-full"
            type="button"
            disabled={markingRepaid}
            onClick={handleMarkRepaid}
          >
            {markingRepaid ? t('txnDetail.processing') : t('txnDetail.markAsRepaid')}
          </button>
        </div>
      )
    }

    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
          {t('txnDetail.sendRepaymentInstructionsToAnchor')}
        </p>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.repaymentAmountLabel')}</div>
          <input
            className="input mono"
            placeholder="0.00"
            value={repaymentAmount}
            onChange={e => setRepaymentAmount(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.repaymentDueDate')}</div>
          <input
            type="date"
            className="input"
            value={repaymentDueDate}
            onChange={e => setRepaymentDueDate(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.instructionsWireDetails')}</div>
          <textarea
            className="form-input"
            rows={3}
            placeholder={t('txnDetail.wireInstructionsPlaceholder')}
            value={repaymentInstructions}
            onChange={e => setRepaymentInstructions(e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>
        {repaymentError && <div style={{ fontSize: 12, color: '#DC2626' }}>{repaymentError}</div>}
        <button
          className="btn btn-primary btn-full"
          type="button"
          disabled={sendingRepayment || !repaymentDueDate}
          onClick={handleSendRepayment}
        >
          {sendingRepayment ? t('txnDetail.sending') : t('txnDetail.sendToAnchor')}
        </button>
      </div>
    )
  }

  // ── PO: pending_anchor_confirmation / repayment_due ──────────────────────
  if (isPOFinancing && status === 'pending_anchor_confirmation') {
    return <div className="action-passive muted">{t('txnDetail.anchorConfirmingReceipt')}</div>
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
        setRepaymentError(err instanceof Error ? err.message : t('txnDetail.failedToSend'))
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
        setRepaidError(err instanceof Error ? err.message : t('txnDetail.failedToMarkAsRepaid'))
      } finally {
        setMarkingRepaid(false)
      }
    }

    if (repaymentAlreadySent || repaymentSent) {
      return (
        <div className="action-block">
          <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--color-green)', margin: 0 }}>
            {t('txnDetail.repaymentInstructionsSent')}
          </p>
          <div className="calc-panel">
            {transaction.repayment_due_date && (
              <div className="calc-row">
                <span>{t('txnDetail.dueDate')}</span>
                <span>{fmtDate(transaction.repayment_due_date)}</span>
              </div>
            )}
            {getRepaymentInstructions(transaction.bank_approval_notes) && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>{t('txnDetail.instructions')}</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{getRepaymentInstructions(transaction.bank_approval_notes)}</span>
              </div>
            )}
          </div>
          {repaidError && <div style={{ fontSize: 12, color: '#DC2626' }}>{repaidError}</div>}
          <button className="btn btn-primary btn-full" type="button" disabled={markingRepaid} onClick={handleMarkRepaidPO}>
            {markingRepaid ? t('txnDetail.processing') : t('txnDetail.markAsRepaid')}
          </button>
        </div>
      )
    }

    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
          {t('txnDetail.sendRepaymentInstructionsToAnchor')}
        </p>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.repaymentAmountLabel')}</div>
          <input className="input mono" placeholder="0.00" value={repaymentAmount} onChange={e => setRepaymentAmount(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.repaymentDueDate')}</div>
          <input type="date" className="input" value={repaymentDueDate} onChange={e => setRepaymentDueDate(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.instructionsWireDetails')}</div>
          <textarea className="form-input" rows={3} placeholder={t('txnDetail.wireInstructionsPlaceholder')} value={repaymentInstructions} onChange={e => setRepaymentInstructions(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
        </div>
        {repaymentError && <div style={{ fontSize: 12, color: '#DC2626' }}>{repaymentError}</div>}
        <button className="btn btn-primary btn-full" type="button" disabled={sendingRepayment || !repaymentDueDate} onClick={handleSendRepaymentPO}>
          {sendingRepayment ? t('txnDetail.sending') : t('txnDetail.sendToAnchor')}
        </button>
      </div>
    )
  }

  if (status !== 'pending_bank_review' && status !== 'more_info_requested') {
    return (
      <div className="action-passive muted">
        {status === 'rejected'   ? t('txnDetail.transactionWasRejectedPeriod')
          : status === 'completed' ? t('txnDetail.transactionCompletedPeriod')
          : t('txnDetail.awaitingStatus', { status: status.replace(/_/g, ' ') })}
      </div>
    )
  }

  // ── pending_bank_review / more_info_requested ──────────────────────────────
  // Supplier reject form (returns early so it can use full width)
  if (mode === 'reject') {
    return (
      <div className="action-block">
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{t('txnDetail.supplierFinancingRejectionReason')}</p>
        <textarea
          className="form-input"
          rows={4}
          placeholder={t('txnDetail.reasonForRejectionOptional')}
          value={rejectNote}
          onChange={e => setRejectNote(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
        <button
          className="btn btn-danger btn-full"
          type="button"
          disabled={acting}
          onClick={() => onAction({ action: 'reject', negotiation_target: 'supplier', rejection_reason: rejectNote.trim() })}
        >
          {acting ? t('txnDetail.processing') : t('txnDetail.confirmRejection')}
        </button>
        <button className="btn btn-ghost btn-full" type="button" onClick={() => { setMode('idle'); setRejectNote('') }}>
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  const isCounter = mode === 'counter'

  return (
    <>
      <AIInsight
        title={t('txnDetail.riskAnalysis')}
        prompt="Analyze this transaction and provide a brief risk assessment. Consider the advance rate requested, invoice amount, counterparty history if available, and recommend whether to approve, counter, or flag for review."
        context={{
          invoice_amount: transaction.invoice_amount,
          advance_rate_requested: transaction.financing_rate_apr,
          amount_requested: transaction.financing_amount_requested,
          invoice_due_date: transaction.invoice_due_date,
          supplier: transaction.supplier_id,
          program_type: transaction.type,
          description: transaction.description,
        }}
        collapsed={true}
      />
      <div className="action-block">

      {/* ── Panel 1: Supplier financing offer ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('txnDetail.supplierFinancingOffer')}</div>

        {supplierNeg?.status === 'approved' ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-green)' }}>{t('txnDetail.financingApproved')} ✓</div>
        ) : (supplierNeg?.status === 'counter_offered' || supplierNeg?.status === 'supplier_countered') ? (
          supplierNeg.supplier_counter ? (
            <>
              <div className="calc-panel">
                <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>{t('txnDetail.supplierCounterOffer')}</div>
                <div className="calc-row">
                  <span>{t('txnDetail.suppliersCounterRate')}</span>
                  <span style={{ fontWeight: 600 }}>{supplierNeg.supplier_counter.advance_rate}%</span>
                </div>
                {supplierNeg.bank_counter_rate != null && (
                  <div className="calc-row">
                    <span>{t('txnDetail.banksOffer')}</span>
                    <span style={{ color: 'var(--gray)', textDecoration: 'line-through', fontSize: 12 }}>
                      {supplierNeg.bank_counter_rate}%
                    </span>
                  </div>
                )}
                {supplierNeg.supplier_counter.amount != null && (
                  <div className="calc-row">
                    <span>{t('txnDetail.counterAmount')}</span>
                    <span>{fmtAmt(supplierNeg.supplier_counter.amount)}</span>
                  </div>
                )}
              </div>
              {isCounter ? (
                <>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.counterAdvanceRate')}</div>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input mono"
                        style={{ width: '100%', paddingRight: 32 }}
                        type="number" min={0.01} max={100} step={0.01}
                        value={counterRate}
                        onChange={e => setCounterRate(e.target.value)}
                        onWheel={e => (e.target as HTMLInputElement).blur()}
                      />
                      <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray)', fontSize: 14, pointerEvents: 'none' }}>%</span>
                    </div>
                  </div>
                  {counterRateNum > 0 && (
                    <div className="calc-row">
                      <span>{t('txnDetail.counterAmount')}</span>
                      <strong style={{ color: 'var(--color-green)' }}>{fmtAmt(parseFloat(counterDisburseAmt.toFixed(2)))}</strong>
                    </div>
                  )}
                  <div>
                    <label className="field-label">{t('txnDetail.discountFeeLabel')}</label>
                    <div className="input-group">
                      <input className="input" type="number" placeholder="0.00" value={discountFee} onChange={e => setDiscountFee(Number(e.target.value))} onWheel={e => (e.target as HTMLInputElement).blur()} />
                      <span className="input-suffix">USD</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.notesOptional')}</div>
                    <textarea className="form-input" rows={2} value={counterNotes} onChange={e => setCounterNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} placeholder={t('txnDetail.reasonForCounterOffer')} />
                  </div>
                  {counterError && <div style={{ fontSize: 12, color: '#DC2626' }}>{counterError}</div>}
                  <button
                    className="btn btn-primary btn-full"
                    type="button"
                    disabled={acting || !counterRateNum || discountFee < 0}
                    onClick={() => {
                      if (counterRateNum > 100 || counterRateNum <= 0) {
                        setCounterError(t('txnDetail.advanceRateRangeError'))
                        return
                      }
                      setCounterError(null)
                      onAction({
                        action: 'counter_offer', negotiation_target: 'supplier',
                        apr: counterRateNum,
                        financing_amount_approved: parseFloat(counterDisburseAmt.toFixed(2)),
                        discount_fee: discountFee, fee_amount: discountFee,
                        ...(counterNotes.trim() ? { counter_offer_notes: counterNotes.trim() } : {}),
                      })
                    }}
                  >
                    {acting ? t('txnDetail.sending') : t('txnDetail.sendCounterOffer')}
                  </button>
                  <button className="btn btn-ghost btn-full" type="button" onClick={() => setMode('idle')}>{t('common.cancel')}</button>
                </>
              ) : (
                <>
                  <div>
                    <label className="field-label">{t('txnDetail.discountFeeLabel')}</label>
                    <div className="input-group">
                      <input className="input" type="number" placeholder="0.00" value={discountFee} onChange={e => setDiscountFee(Number(e.target.value))} onWheel={e => (e.target as HTMLInputElement).blur()} />
                      <span className="input-suffix">USD</span>
                    </div>
                  </div>
                  {counterError && <div style={{ fontSize: 12, color: '#DC2626' }}>{counterError}</div>}
                  <button
                    className="btn btn-primary btn-full"
                    type="button"
                    disabled={acting || discountFee < 0}
                    onClick={() => {
                      const scRate = supplierNeg.supplier_counter!.advance_rate ?? 0
                      const scAmt  = supplierNeg.supplier_counter!.amount ?? 0
                      if (scRate > 100 || scRate <= 0) {
                        setCounterError(t('txnDetail.advanceRateRangeError'))
                        return
                      }
                      setCounterError(null)
                      onAction({
                        action: 'approve', negotiation_target: 'supplier',
                        apr: scRate,
                        financing_amount_approved: scAmt,
                        discount_fee: discountFee, fee_amount: discountFee,
                      })
                    }}
                  >
                    {acting ? t('txnDetail.processing') : t('txnDetail.approveCounterOffer')}
                  </button>
                  <button className="btn btn-ghost btn-full" type="button" disabled={acting} onClick={() => setMode('counter')}>{t('txnDetail.counterAgain')}</button>
                  <button className="btn btn-danger btn-full" type="button" disabled={acting} onClick={() => setMode('reject')}>{t('txnDetail.reject')}</button>
                </>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>{t('txnDetail.counterOfferSentAwaitingSupplier')}</div>
          )
        ) : (
          <>
            {/* Supplier's offer */}
            <div className="calc-panel">
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 8 }}>{t('txnDetail.suppliersOffer')}</div>
              <div className="calc-row"><span>{t('newTransaction.invoiceAmount')}</span><span>{fmtAmt(transaction.invoice_amount)}</span></div>
              <div className="calc-row"><span>{t('txnDetail.requestedAdvanceRate')}</span><span>{supplierRatePct}%</span></div>
              <div className="calc-row"><span>{t('txnDetail.requestedAmount')}</span><span>{fmtAmt(transaction.financing_amount_requested)}</span></div>
            </div>

            {isCounter ? (
              <>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.counterAdvanceRate')}</div>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input mono"
                      style={{ width: '100%', paddingRight: 32 }}
                      type="number" min={0.01} max={100} step={0.01}
                      value={counterRate}
                      onChange={e => setCounterRate(e.target.value)}
                      onWheel={e => (e.target as HTMLInputElement).blur()}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray)', fontSize: 14, pointerEvents: 'none' }}>%</span>
                  </div>
                </div>
                {counterRateNum > 0 && (
                  <div className="calc-row">
                    <span>{t('txnDetail.counterAmount')}</span>
                    <strong style={{ color: 'var(--color-green)' }}>{fmtAmt(parseFloat(counterDisburseAmt.toFixed(2)))}</strong>
                  </div>
                )}
                <div>
                  <label className="field-label">{t('txnDetail.discountFeeLabel')}</label>
                  <div className="input-group">
                    <input className="input" type="number" placeholder="0.00" value={discountFee} onChange={e => setDiscountFee(Number(e.target.value))} onWheel={e => (e.target as HTMLInputElement).blur()} />
                    <span className="input-suffix">USD</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.notesOptional')}</div>
                  <textarea className="form-input" rows={2} value={counterNotes} onChange={e => setCounterNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} placeholder={t('txnDetail.reasonForCounterOffer')} />
                </div>
                {counterError && <div style={{ fontSize: 12, color: '#DC2626' }}>{counterError}</div>}
                <button
                  className="btn btn-primary btn-full"
                  type="button"
                  disabled={acting || !counterRateNum || discountFee < 0}
                  onClick={() => {
                    if (counterRateNum > 100 || counterRateNum <= 0) {
                      setCounterError(t('txnDetail.advanceRateRangeError'))
                      return
                    }
                    setCounterError(null)
                    onAction({
                      action: 'counter_offer', negotiation_target: 'supplier',
                      apr: counterRateNum,
                      financing_amount_approved: parseFloat(counterDisburseAmt.toFixed(2)),
                      discount_fee: discountFee, fee_amount: discountFee,
                      ...(counterNotes.trim() ? { counter_offer_notes: counterNotes.trim() } : {}),
                    })
                  }}
                >
                  {acting ? t('txnDetail.sending') : t('txnDetail.sendCounterOffer')}
                </button>
                <button className="btn btn-ghost btn-full" type="button" onClick={() => { setMode('idle'); setCounterError(null) }}>{t('common.cancel')}</button>
              </>
            ) : (
              <>
                <div>
                  <label className="field-label">{t('txnDetail.discountFeeLabel')}</label>
                  <div className="input-group">
                    <input className="input" type="number" placeholder="0.00" value={discountFee} onChange={e => setDiscountFee(Number(e.target.value))} onWheel={e => (e.target as HTMLInputElement).blur()} />
                    <span className="input-suffix">USD</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--gray)', marginTop: 4 }}>{t('txnDetail.feeChargedForEarlyPayment')}</div>
                </div>
                {counterError && <div style={{ fontSize: 12, color: '#DC2626' }}>{counterError}</div>}
                <button
                  className="btn btn-primary btn-full"
                  type="button"
                  disabled={acting || !supplierRateNum || discountFee < 0}
                  onClick={() => {
                    if (supplierRateNum > 100 || supplierRateNum <= 0) {
                      setCounterError(t('txnDetail.advanceRateRangeError'))
                      return
                    }
                    setCounterError(null)
                    onAction({
                      action: 'approve', negotiation_target: 'supplier',
                      apr: supplierRateNum,
                      financing_amount_approved: parseFloat(supplierDisburseAmt.toFixed(2)),
                      discount_fee: discountFee, fee_amount: discountFee,
                    })
                  }}
                >
                  {acting ? t('txnDetail.processing') : t('txnDetail.approveOffer')}
                </button>
                <button className="btn btn-ghost btn-full" type="button" disabled={acting} onClick={() => setMode('counter')}>{t('txnDetail.counterOffer')}</button>
                <button className="btn btn-danger btn-full" type="button" disabled={acting} onClick={() => setMode('reject')}>{t('txnDetail.reject')}</button>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Panel 2: Anchor repayment request (only if anchor requested something) ── */}
      {anchorNeg?.type && (
        <div style={{ border: '1px solid var(--color-amber)', borderRadius: 8, padding: '12px 14px', background: 'rgba(180,83,9,0.04)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-amber)' }}>{t('txnDetail.anchorRepaymentRequest')}</div>

          {/* Request details */}
          {anchorNeg.type === 'extension' && anchorNeg.anchor_request?.date && (
            <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{t('txnDetail.requestedRepaymentDate')}: {anchorNeg.anchor_request.date}</div>
          )}
          {anchorNeg.type === 'installment' && anchorNeg.anchor_request && (
            <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{t('txnDetail.requestedCountInstallments', { count: anchorNeg.anchor_request.count ?? 0, frequency: frequencyLabel(anchorNeg.anchor_request.structure, t) })}</div>
          )}
          {anchorNeg.anchor_request?.notes && (
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>{t('txnDetail.notesLabel')}: {anchorNeg.anchor_request.notes}</div>
          )}

          {anchorNeg.status === 'pending' && !anchorCounterMode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className="btn btn-primary btn-sm" type="button" disabled={acting}
                onClick={() => onAction({ action: 'approve', negotiation_target: 'anchor' })}>
                {acting ? t('txnDetail.processing') : t('txnDetail.approveRequest')}
              </button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={acting} onClick={() => setAnchorCounterMode(true)}>
                {t('txnDetail.counterOffer')}
              </button>
              <button className="btn btn-danger btn-sm" type="button" disabled={acting}
                onClick={() => onAction({ action: 'reject', negotiation_target: 'anchor' })}>
                {t('txnDetail.decline')}
              </button>
            </div>
          )}

          {anchorNeg.status === 'pending' && anchorCounterMode && (
            <>
              {anchorNeg.type === 'extension' && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.counterRepaymentDate')}</div>
                  <input type="date" className="input" value={anchorCounterDate} onChange={e => setAnchorCounterDate(e.target.value)} style={{ width: '100%' }} />
                </div>
              )}
              {anchorNeg.type === 'installment' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.numberOfInstallments')}</div>
                    <input type="number" className="input" min="2" max="52" value={anchorCounterCount} onChange={e => setAnchorCounterCount(Number(e.target.value))} onWheel={e => (e.target as HTMLInputElement).blur()} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.frequency.label')}</div>
                    <select className="input" value={anchorCounterStructure} onChange={e => setAnchorCounterStructure(e.target.value as 'weekly'|'biweekly'|'monthly'|'quarterly')}>
                      <option value="weekly">{t('txnDetail.frequency.weekly')}</option>
                      <option value="biweekly">{t('txnDetail.frequency.biweekly')}</option>
                      <option value="monthly">{t('txnDetail.frequency.monthly')}</option>
                      <option value="quarterly">{t('txnDetail.frequency.quarterly')}</option>
                    </select>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={acting || (anchorNeg.type === 'extension' && !anchorCounterDate)}
                  onClick={() => onAction({
                    action: 'counter_offer', negotiation_target: 'anchor',
                    ...(anchorNeg.type === 'extension' ? { counter_date: anchorCounterDate } : { counter_count: anchorCounterCount, counter_structure: anchorCounterStructure }),
                  })}
                >
                  {acting ? t('txnDetail.sending') : t('txnDetail.submitCounter')}
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setAnchorCounterMode(false)}>{t('common.cancel')}</button>
              </div>
            </>
          )}

          {anchorNeg.status === 'counter_offered' && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{t('txnDetail.counterOfferSentAwaitingAnchor')}</div>
              {anchorNeg.bank_counter?.date && <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 4 }}>{t('txnDetail.counterDate')}: {anchorNeg.bank_counter.date}</div>}
              {anchorNeg.bank_counter?.count != null && <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 4 }}>{t('txnDetail.counterCountInstallments', { count: anchorNeg.bank_counter.count, frequency: frequencyLabel(anchorNeg.bank_counter.structure, t) })}</div>}
            </div>
          )}

          {anchorNeg.status === 'approved' && (
            <div style={{ fontSize: 12.5, color: 'var(--color-green)' }}>{t('txnDetail.repaymentTermsAgreed')} ✓</div>
          )}

          {anchorNeg.status === 'rejected' && (
            <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>{t('txnDetail.standardRepaymentTermsApply')}</div>
          )}
        </div>
      )}
    </div>
    </>
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
  isDynamicDiscounting,
}: {
  transaction: Transaction
  onAction: (body: Record<string, unknown>) => Promise<void>
  acting: boolean
  onSuccess: (msg: string) => void
  isInvoiceFactoring?: boolean
  isPOFinancing?: boolean
  isDynamicDiscounting?: boolean
}) {
  const t = useT()
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason]     = useState('')
  const [disputeReason, setDisputeReason]   = useState('')
  const [showDisputeForm, setShowDisputeForm] = useState(false)

  // ── Dynamic Discounting: 2-party state machine ────────────────────────────
  if (isDynamicDiscounting) {
    if (transaction.status === 'funded') {
      return (
        <div className="action-block">
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-green)', margin: 0 }}>
            {t('txnDetail.earlyPaymentApproved')}
          </p>
          <p style={{ fontSize: 12, color: 'var(--gray)', margin: 0 }}>
            {t('txnDetail.sendPaymentThenMark')}
          </p>
          {transaction.financing_amount_requested != null && (
            <div className="calc-panel">
              <div className="calc-row">
                <span>{t('txnDetail.amountToSend')}</span>
                <strong style={{ color: 'var(--blue)' }}>{fmtAmt(transaction.financing_amount_requested)}</strong>
              </div>
              {transaction.invoice_due_date && (
                <div className="calc-row">
                  <span>{t('txnDetail.payBy')}</span>
                  <span>{fmtDate(transaction.invoice_due_date)}</span>
                </div>
              )}
            </div>
          )}
          <button className="btn btn-primary btn-full" type="button" disabled={acting}
            onClick={() => { onAction({ action: 'mark_paid' }); onSuccess(t('txnDetail.paymentMarkedAsSent')) }}>
            {acting ? t('txnDetail.processing') : t('txnDetail.markPaymentAsSent')}
          </button>
        </div>
      )
    }
    if (transaction.status === 'completed') {
      return <div className="action-passive muted">{t('txnDetail.paymentSentTransactionCompleted')}</div>
    }
    if (transaction.status === 'rejected') {
      return <div className="action-passive" style={{ color: '#DC2626' }}>{t('txnDetail.requestDeclinedPeriod')}</div>
    }
    // pending_anchor_approval: fall through to approve/reject below
  }

  // PO financing: passive until pending_anchor_confirmation
  if (isPOFinancing && transaction.status !== 'pending_anchor_confirmation' && transaction.status !== 'repayment_due' && transaction.status !== 'completed' && transaction.status !== 'rejected' && transaction.status !== 'in_dispute') {
    return <div className="action-passive muted">{t('txnDetail.waitingForSupplierToFulfill')}</div>
  }

  // PO financing: anchor confirms goods receipt
  if (isPOFinancing && transaction.status === 'pending_anchor_confirmation') {
    if (showDisputeForm) {
      return (
        <div className="action-block">
          <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: 0 }}>{t('txnDetail.rejectionReason')}</p>
          <textarea
            className="form-input"
            rows={4}
            placeholder={t('txnDetail.reasonForRejectionOptional')}
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
            {acting ? t('txnDetail.processing') : t('txnDetail.confirmRejection')}
          </button>
          <button className="btn btn-ghost btn-full" type="button" disabled={acting} onClick={() => { setShowDisputeForm(false); setDisputeReason('') }}>
            {t('common.cancel')}
          </button>
        </div>
      )
    }

    // PO financing: anchor simple approve/reject only
    // Extend/installment is reverse factoring only
    return (
      <div className="action-block">
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
          {t('txnDetail.invoiceReadyForApproval')}
        </p>
        <div className="calc-panel">
          {transaction.invoice_number && (
            <div className="calc-row">
              <span>{t('newTransaction.invoiceHash')}</span>
              <span>{transaction.invoice_number}</span>
            </div>
          )}
          {transaction.invoice_amount != null && (
            <div className="calc-row">
              <span>{t('txnDetail.amount')}</span>
              <span>{fmtAmt(transaction.invoice_amount)}</span>
            </div>
          )}
          {transaction.invoice_date && (
            <div className="calc-row">
              <span>{t('txnDetail.date')}</span>
              <span>{fmtDate(transaction.invoice_date)}</span>
            </div>
          )}
          {transaction.description && (
            <div className="calc-row">
              <span>{t('listingDetail.description')}</span>
              <span>{transaction.description}</span>
            </div>
          )}
        </div>
        <button
          className="btn btn-primary btn-full"
          type="button"
          disabled={acting}
          onClick={async () => {
            await onAction({ action: 'approve', transaction_type: 'po_financing' })
            onSuccess(t('txnDetail.invoiceApprovedMovedToRepayment'))
          }}
        >
          {acting ? t('txnDetail.processing') : t('txnDetail.approveInvoice')}
        </button>
        <button className="btn btn-danger btn-full" type="button" disabled={acting} onClick={() => setShowDisputeForm(true)}>
          {t('txnDetail.reject')}
        </button>
      </div>
    )
  }

  // PO financing: repayment_due — show repayment info if sent
  if (isPOFinancing && transaction.status === 'repayment_due') {
    return (
      <div className="action-block">
        <div className="action-passive muted" style={{ marginBottom: 8 }}>{t('txnDetail.transactionInRepayment')}</div>
        {transaction.repayment_due_date ? (
          <div className="calc-panel">
            <div className="calc-row">
              <span>{t('txnDetail.repaymentDue')}</span>
              <span>{fmtDate(transaction.repayment_due_date)}</span>
            </div>
            {getRepaymentInstructions(transaction.bank_approval_notes) && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>{t('txnDetail.instructions')}</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{getRepaymentInstructions(transaction.bank_approval_notes)}</span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8 }}>
            {t('txnDetail.awaitingRepaymentInstructionsFromBank')}
          </p>
        )}
      </div>
    )
  }

  if (transaction.status === 'funded') {
    return (
      <div className="action-block">
        <div className="action-passive muted">{t('txnDetail.transactionFundedPeriod')}</div>
        {transaction.repayment_due_date ? (
          <div className="calc-panel" style={{ marginTop: 8 }}>
            <div className="calc-row">
              <span>{t('txnDetail.repaymentDue')}</span>
              <span>{fmtDate(transaction.repayment_due_date)}</span>
            </div>
            {transaction.financing_amount_approved != null && (
              <div className="calc-row">
                <span>{t('txnDetail.amount')}</span>
                <span>{fmtAmt(transaction.financing_amount_approved)}</span>
              </div>
            )}
            {getRepaymentInstructions(transaction.bank_approval_notes) && (
              <div className="calc-row" style={{ alignItems: 'flex-start' }}>
                <span>{t('txnDetail.instructions')}</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
                  {getRepaymentInstructions(transaction.bank_approval_notes)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8 }}>
            {t('txnDetail.awaitingRepaymentInstructionsFromBank')}
          </p>
        )}
      </div>
    )
  }

  if (isInvoiceFactoring) {
    return (
      <div className={`action-passive ${transaction.status === 'rejected' ? '' : 'muted'}`}>
        {transaction.status === 'rejected'
          ? t('txnDetail.transactionWasRejectedPeriod')
          : transaction.status === 'pending_bank_review'
            || transaction.status === 'more_info_requested'
            || transaction.status === 'pending_supplier_counter_review'
          ? t('txnDetail.invoiceUnderBankReview')
          : transaction.status === 'financing_approved'
          ? t('txnDetail.financingApprovedSupplierWillReceive')
          : transaction.status === 'completed'
          ? t('txnDetail.transactionCompletedPeriod')
          : t('txnDetail.awaitingNextStep')}
      </div>
    )
  }

  // At pending_bank_review / more_info_requested: show two-card view
  if (transaction.status === 'pending_bank_review' || transaction.status === 'more_info_requested') {
    const negState   = (() => { try { return JSON.parse(transaction.bank_approval_notes ?? '{}') } catch { return {} } })()
    const anchorNegV = negState.anchor_negotiation as {
      type?: string; status?: string;
      anchor_request?: { date?: string; count?: number; structure?: string; notes?: string };
      bank_counter?:   { date?: string; count?: number; structure?: string };
    } | undefined

    return (
      <div className="action-block">
        {/* Card 1: Invoice approval — read-only */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{t('txnDetail.yourInvoiceApproval')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-green)' }}>{t('txnDetail.approvedAwaitingBankReview')}</div>
        </div>

        {/* Card 2: Repayment request (only when anchor requested something) */}
        {anchorNegV?.type && (
          <div style={{ border: '1px solid var(--color-amber)', borderRadius: 8, padding: '12px 14px', background: 'rgba(180,83,9,0.04)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-amber)', marginBottom: 8 }}>{t('txnDetail.yourRepaymentRequest')}</div>

            {anchorNegV.type === 'extension' && anchorNegV.anchor_request?.date && (
              <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>
                {t('txnDetail.requestedDate')}: {anchorNegV.anchor_request.date}
              </div>
            )}
            {anchorNegV.type === 'installment' && anchorNegV.anchor_request && (
              <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>
                {t('txnDetail.requestedCountInstallments', { count: anchorNegV.anchor_request.count ?? 0, frequency: frequencyLabel(anchorNegV.anchor_request.structure, t) })}
              </div>
            )}
            {anchorNegV.anchor_request?.notes && (
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 8 }}>
                {t('txnDetail.notesLabel')}: {anchorNegV.anchor_request.notes}
              </div>
            )}

            {anchorNegV.status === 'pending' && (
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{t('txnDetail.awaitingBankDecision')}</div>
            )}

            {anchorNegV.status === 'counter_offered' && (
              <>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>{t('txnDetail.bankCounterProposal')}:</div>
                {anchorNegV.bank_counter?.date && (
                  <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>{t('txnDetail.counterDate')}: {anchorNegV.bank_counter.date}</div>
                )}
                {anchorNegV.bank_counter?.count != null && (
                  <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>
                    {t('txnDetail.counterCountInstallments', { count: anchorNegV.bank_counter.count, frequency: frequencyLabel(anchorNegV.bank_counter.structure, t) })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" type="button" disabled={acting}
                    onClick={() => onAction({ action: 'accept_anchor_counter' })}>
                    {acting ? t('txnDetail.processing') : t('listingDetail.accept')}
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" disabled={acting}
                    onClick={() => onAction({ action: 'reject_anchor_counter' })}>
                    {t('txnDetail.decline')}
                  </button>
                </div>
              </>
            )}

            {anchorNegV.status === 'approved' && (
              <div style={{ fontSize: 12.5, color: 'var(--color-green)' }}>{t('txnDetail.repaymentRequestApproved')}</div>
            )}
            {anchorNegV.status === 'rejected' && (
              <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>{t('txnDetail.bankDeclinedStandardTerms')}</div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (transaction.status !== 'pending_anchor_approval') {
    return (
      <div className={`action-passive ${transaction.status === 'rejected' ? '' : 'muted'}`}>
        {transaction.status === 'rejected'
          ? t('txnDetail.transactionWasRejectedPeriod')
          : transaction.status === 'pending_supplier_counter_review'
          ? t('txnDetail.invoiceApprovedAwaitingBank')
          : transaction.status === 'financing_approved'
          ? t('txnDetail.financingApprovedSupplierWillReceive')
          : transaction.status === 'completed'
          ? t('txnDetail.transactionCompletedPeriod')
          : t('txnDetail.awaitingNextStep')}
      </div>
    )
  }

  if (showRejectForm) {
    return (
      <div className="action-block">
        <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: 0 }}>{t('txnDetail.rejectionReason')}</p>
        <textarea
          className="form-input"
          rows={4}
          placeholder={t('txnDetail.reasonForRejectionOptional')}
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
          {acting ? t('txnDetail.processing') : t('txnDetail.confirmRejection')}
        </button>
        <button
          className="btn btn-ghost btn-full"
          type="button"
          disabled={acting}
          onClick={() => { setShowRejectForm(false); setRejectReason('') }}
        >
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="action-block">
      <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: 0 }}>
        {isDynamicDiscounting
          ? t('txnDetail.reviewEarlyPaymentRequestHint')
          : t('txnDetail.reviewConfirmInvoiceHint')}
      </p>
      <AIInsight
        title={t('txnDetail.invoiceAssessment')}
        prompt="Assess this invoice submission. Is the requested advance rate reasonable? What should the anchor consider before approving or rejecting?"
        context={{
          invoice_number: transaction.invoice_number,
          invoice_amount: transaction.invoice_amount,
          advance_rate_requested: transaction.financing_rate_apr,
          due_date: transaction.invoice_due_date,
          description: transaction.description,
        }}
        collapsed={true}
      />
      <button
        className="btn btn-primary btn-full"
        type="button"
        disabled={acting}
        onClick={async () => {
          await onAction({ action: 'approve' })
          onSuccess(isDynamicDiscounting ? t('txnDetail.earlyPaymentApproved') : t('txnDetail.invoiceApprovedSentToBank'))
        }}
      >
        {acting ? t('txnDetail.processing') : isDynamicDiscounting ? t('txnDetail.approveEarlyPayment') : t('listingDetail.accept')}
      </button>
      <button className="btn btn-danger btn-full" type="button" disabled={acting} onClick={() => setShowRejectForm(true)}>
        {t('txnDetail.reject')}
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
  isDynamicDiscounting,
  txnId,
  onRefresh,
}: {
  transaction: Transaction
  onAction: (body: Record<string, unknown>) => Promise<void>
  acting: boolean
  isInvoiceFactoring?: boolean
  isPOFinancing?: boolean
  isDynamicDiscounting?: boolean
  txnId: string
  onRefresh: () => void
}) {
  const t = useT()
  const [counterMode, setCounterMode] = useState(false)
  const [counterRate, setCounterRate] = useState('')
  const [counterNotes, setCounterNotes] = useState('')
  const [counterError, setCounterError] = useState<string | null>(null)
  const [invoiceNum, setInvoiceNum]         = useState('')
  const [invoiceAmt2, setInvoiceAmt2]       = useState('')
  const [invoiceDateVal, setInvoiceDateVal] = useState('')
  const [invoiceFile, setInvoiceFile]       = useState<File | null>(null)
  const [invError, setInvError]             = useState<string | null>(null)

  const invoiceAmt     = transaction.invoice_amount ?? 0
  const counterRateNum = parseFloat(counterRate) || 0
  const counterAmt     = invoiceAmt * (counterRateNum / 100)

  switch (transaction.status) {
    case 'pending_anchor_approval':
      return <div className="action-passive muted">{t('txnDetail.waitingForAnchorToReview')}</div>

    case 'pending_bank_review':
      return <div className="action-passive muted">{isPOFinancing ? t('txnDetail.poUnderBankReview') : isInvoiceFactoring ? t('txnDetail.invoiceUnderBankReviewYours') : t('txnDetail.anchorApprovedAwaitingBank')}</div>

    case 'pending_supplier_counter_review': {
      const rate = transaction.apr ?? transaction.financing_rate_apr
      const negotiationState = (() => { try { return JSON.parse(transaction.bank_approval_notes ?? '{}') } catch { return {} } })()

      if (counterMode) {
        return (
          <div className="action-block">
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
              {t('txnDetail.yourCounterOffer')}
            </p>
            <div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.yourAdvanceRate')}</div>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input mono"
                  style={{ width: '100%', paddingRight: 32 }}
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={counterRate}
                  onChange={e => setCounterRate(e.target.value)}
                  placeholder={rate != null ? String(rate) : ''}
                  onWheel={e => (e.target as HTMLInputElement).blur()}
                />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray)', fontSize: 14, pointerEvents: 'none' }}>%</span>
              </div>
            </div>
            {counterRateNum > 0 && (
              <div className="calc-row">
                <span>{t('txnDetail.amountYouReceive')}</span>
                <strong style={{ color: 'var(--color-green)' }}>{fmtAmt(parseFloat(counterAmt.toFixed(2)))}</strong>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.notesOptional')}</div>
              <textarea
                className="form-input"
                rows={2}
                value={counterNotes}
                onChange={e => setCounterNotes(e.target.value)}
                style={{ width: '100%', resize: 'vertical' }}
                placeholder={t('txnDetail.reasonForCounterOffer')}
              />
            </div>
            {counterError && <div style={{ fontSize: 12, color: '#DC2626' }}>{counterError}</div>}
            <button
              className="btn btn-primary btn-full"
              type="button"
              disabled={acting || !counterRateNum}
              onClick={() => {
                if (counterRateNum > 100 || counterRateNum <= 0) {
                  setCounterError(t('txnDetail.advanceRateRangeError'))
                  return
                }
                setCounterError(null)
                onAction({
                  action:        'supplier_counter',
                  apr:           counterRateNum,
                  ...(counterNotes.trim() ? { counter_notes: counterNotes.trim() } : {}),
                })
              }}
            >
              {acting ? t('txnDetail.sending') : t('txnDetail.sendCounterOfferToBank')}
            </button>
            <button className="btn btn-ghost btn-full" type="button" onClick={() => { setCounterMode(false); setCounterError(null) }}>
              {t('common.cancel')}
            </button>
          </div>
        )
      }

      return (
        <div className="action-block">
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
            {t('txnDetail.bankHasMadeCounterOffer')}
          </p>
          <div className="calc-panel">
            {rate != null && (
              <div className="calc-row">
                <span>{t('newTransaction.advanceRate')}</span>
                <span>{rate}%</span>
              </div>
            )}
            {transaction.financing_amount_approved != null && (
              <div className="calc-row">
                <span>{t('txnDetail.amountYoullReceive')}</span>
                <strong style={{ color: 'var(--color-green)' }}>{fmtAmt(transaction.financing_amount_approved)}</strong>
              </div>
            )}
            {transaction.fee_amount != null && (
              <div className="calc-row">
                <span>{t('txnDetail.discountFee')}</span>
                <span>{fmtAmt(transaction.fee_amount)}</span>
              </div>
            )}
          </div>
          <AIInsight
            title={t('txnDetail.offerAnalysis')}
            prompt="The bank has made a counter-offer. Analyze whether the supplier should accept this offer or negotiate further. Consider the advance rate, fees, and market context."
            context={{
              original_rate: transaction.financing_rate_apr,
              bank_counter: (negotiationState as { supplier_negotiation?: { bank_offer?: unknown } })?.supplier_negotiation?.bank_offer,
              invoice_amount: transaction.invoice_amount,
              fee_amount: transaction.fee_amount,
            }}
            collapsed={true}
          />
          <button
            className="btn btn-primary btn-full"
            type="button"
            disabled={acting}
            onClick={() => onAction({ action: 'accept_counter' })}
          >
            {acting ? t('txnDetail.processing') : t('txnDetail.acceptOffer')}
          </button>
          <button
            className="btn btn-ghost btn-full"
            type="button"
            disabled={acting}
            onClick={() => setCounterMode(true)}
          >
            {t('txnDetail.makeCounterOffer')}
          </button>
          <button
            className="btn btn-danger btn-full"
            type="button"
            disabled={acting}
            onClick={() => onAction({ action: 'reject_counter' })}
          >
            {t('txnDetail.declineOffer')}
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
            {t('txnDetail.financingApproved')}
          </p>
          {hasWire ? (
            <>
              <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                {t('txnDetail.wireTransferDetails')}
              </p>
              <div className="calc-panel">
                {wireInfo!.reference && <div className="calc-row"><span>{t('txnDetail.reference')}</span><span className="mono">{wireInfo!.reference}</span></div>}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--gray)', margin: 0 }}>
              {t('txnDetail.wireDetailsSentShortly')}
            </p>
          )}
        </div>
      )
    }

    case 'funded':
      if (isDynamicDiscounting) {
        return (
          <div className="action-block">
            <div className="action-passive green" style={{ marginBottom: 8 }}>
              <Icon name="check" size={14} />
              {t('txnDetail.earlyPaymentApproved')}
            </div>
            <p style={{ fontSize: 12, color: 'var(--gray)', margin: 0 }}>
              {t('txnDetail.anchorProcessingPayment')}
            </p>
            {transaction.financing_amount_requested != null && (
              <div className="calc-panel" style={{ marginTop: 8 }}>
                <div className="calc-row">
                  <span>{t('txnDetail.youWillReceive')}</span>
                  <strong style={{ color: 'var(--blue)' }}>{fmtAmt(transaction.financing_amount_requested)}</strong>
                </div>
              </div>
            )}
          </div>
        )
      }
      if (isPOFinancing) {
        const handleSubmitInvoice = async () => {
          if (!invoiceNum.trim() || !invoiceAmt2 || !invoiceDateVal) {
            setInvError(t('txnDetail.allInvoiceFieldsRequired'))
            return
          }
          setInvError(null)
          await onAction({
            action:         'submit_invoice',
            invoice_number: invoiceNum.trim(),
            invoice_amount: parseFloat(invoiceAmt2),
            invoice_date:   invoiceDateVal,
          })
          if (invoiceFile) {
            const fd = new FormData()
            fd.append('file', invoiceFile)
            fd.append('document_kind', 'invoice_pdf')
            await fetch(`/api/transactions/${txnId}/documents`, { method: 'POST', body: fd })
          }
          onRefresh()
        }

        return (
          <div className="action-block">
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
              {t('txnDetail.goodsDeliveredSubmitInvoice')}
            </p>
            <p style={{ fontSize: 12, color: 'var(--gray)', margin: 0 }}>
              {t('txnDetail.onceAnchorReceivedGoods')}
            </p>
            <div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('newTransaction.invoiceNumber')}</div>
              <input className="form-input" style={{ width: '100%' }} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} placeholder="INV-001" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('newTransaction.invoiceAmountLabel')}</div>
              <input className="form-input mono" style={{ width: '100%' }} value={invoiceAmt2} onChange={e => setInvoiceAmt2(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('newTransaction.invoiceDate')}</div>
              <input type="date" className="form-input" style={{ width: '100%' }} value={invoiceDateVal} onChange={e => setInvoiceDateVal(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.uploadInvoiceDocument')}</div>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={e => setInvoiceFile(e.target.files?.[0] ?? null)}
                style={{ display: 'none' }}
                id="invoice-upload"
              />
              <label
                htmlFor="invoice-upload"
                className="btn btn-ghost btn-sm"
                style={{ cursor: 'pointer', display: 'inline-block' }}
              >
                {invoiceFile ? invoiceFile.name : t('txnDetail.chooseFile')}
              </label>
            </div>
            {invError && <div style={{ fontSize: 12, color: '#DC2626' }}>{invError}</div>}
            <button className="btn btn-primary btn-full" type="button" disabled={acting} onClick={handleSubmitInvoice}>
              {acting ? t('txnDetail.submitting') : t('txnDetail.submitInvoice')}
            </button>
          </div>
        )
      }

      return (
        <div className="action-block">
          <div className="action-passive green" style={{ marginBottom: 8 }}>
            <Icon name="check" size={14} />
            {t('txnDetail.paymentDisbursed')}
          </div>
          {transaction.disbursed_at && (
            <div className="calc-panel">
              <div className="calc-row">
                <span>{t('txnDetail.disbursedOn')}</span>
                <span>{fmtDate(transaction.disbursed_at)}</span>
              </div>
            </div>
          )}
        </div>
      )

    case 'pending_anchor_confirmation':
      return <div className="action-passive muted">{t('txnDetail.invoiceSubmittedAwaitingAnchor')}</div>

    case 'repayment_due':
      return <div className="action-passive muted">{t('txnDetail.repaymentDueTransactionCompleting')}</div>

    case 'in_dispute':
      return <div className="action-passive" style={{ color: '#DC2626' }}>{t('txnDetail.invoiceInDispute')}</div>

    case 'completed':
      return (
        <div className="action-block">
          <div className="action-passive muted">
            <Icon name="check" size={14} />
            {t('txnDetail.transactionCompleted')}
          </div>
        </div>
      )

    case 'rejected':
      return <div className="action-passive" style={{ color: '#DC2626' }}>{t('txnDetail.transactionRejectedPeriod')}</div>

    default:
      return <div className="action-passive muted">{t('txnDetail.awaitingUpdate')}</div>
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
  const t = useT()
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
      if (!res.ok) throw new Error((data as { error?: string }).error ?? t('txnDetail.submitFailed'))
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('txnDetail.failedToSubmitGeneric'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0' }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.detailsNotes')}</div>
        <textarea
          className="input"
          rows={3}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t('txnDetail.describeWhatSubmitting')}
          style={{ width: '100%', resize: 'none' }}
        />
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.supportingDocumentOptional')}</div>
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
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray)', fontSize: 14 }} onClick={() => setFile(null)}>×</button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => fileRef.current?.click()}>
            {t('txnDetail.attachFile')}
          </button>
        )}
      </div>
      {error && <div style={{ fontSize: 12, color: '#DC2626' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={handleSubmit}>
          {saving ? t('txnDetail.submitting') : t('txnDetail.submitCollateral')}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onDone}>
          {t('common.cancel')}
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
  const t = useT()

  const [transaction, setTransaction]       = useState<Transaction | null>(null)
  const [events, setEvents]                 = useState<TransactionEvent[]>([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)
  const [acting, setActing]                 = useState(false)
  const [actionError, setActionError]       = useState<string | null>(null)
  const [actionSuccess, setActionSuccess]   = useState<string | null>(null)

  const [documents, setDocuments] = useState<{
    id: string; name: string; document_kind: string; mime_type: string
    storage_path: string; signed_url: string | null; created_at: string
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
        setError(err instanceof Error ? err.message : t('txnDetail.failedToLoadGeneric'))
        setLoading(false)
      })
  }, [id, t])

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
      setActionSuccess(t('txnDetail.done'))
      setTimeout(() => setActionSuccess(null), 2000)
      load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('txnDetail.actionFailed'))
    } finally {
      setActing(false)
    }
  }, [id, load, t])

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
      setAddCollError(err instanceof Error ? err.message : t('txnDetail.failedToAddRequirement'))
    } finally {
      setAddCollSaving(false)
    }
  }, [id, addCollForm, refreshCollateral, t])

  const txn = transaction

  const isPOFinancing        = txn?.type === 'po_financing'        || txn?.financing_type === 'po_financing'
  const isInvoiceFactoring   = txn?.type === 'invoice_factoring'   || txn?.financing_type === 'invoice_factoring'
  const isDynamicDiscounting = txn?.type === 'dynamic_discounting' || txn?.financing_type === 'dynamic_discounting'

  const txnNegState = (() => { try { return JSON.parse(txn?.bank_approval_notes ?? '{}') } catch { return {} } })()
  const txnAnchorNeg = txnNegState.anchor_negotiation as { type?: string; status?: string } | undefined
  const hasAnchorRepaymentRequest = !!txnAnchorNeg?.type

  const repaymentRequest = (() => {
    try {
      const state = JSON.parse(txn?.bank_approval_notes ?? '{}')
      return state.anchor_repayment_request as {
        status?: string; type?: string; requested_date?: string; count?: number; structure?: string;
        agreed_date?: string; agreed_count?: number; agreed_structure?: string;
      } | undefined
    } catch { return undefined }
  })()

  const repaymentInstructionsText = getRepaymentInstructions(txn?.bank_approval_notes ?? null)

  const rejectionEvent = events.find(e => e.event_type === 'status_change' && e.to_status === 'rejected')
    ?? events.find(e => e.to_status === 'rejected')
  const txnRejectionReason = rejectionEvent?.notes ?? null

  const showFinancials = txn ? !['rejected', 'cancelled'].includes(txn.status) : true

  const showApprovedFinancials = txn != null &&
    ['financing_approved', 'funded', 'pending_anchor_confirmation', 'repayment_due', 'completed']
    .includes(txn.status)

  const amountDisbursed = showApprovedFinancials && txn
    ? (txn.invoice_amount ?? 0) * ((txn.apr ?? txn.financing_rate_apr ?? 0) / 100) - (txn.fee_amount ?? 0)
    : null

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
          { label: t('transactionsPage.title'), onClick: () => router.push('/transactions') },
          { label: loading ? '…' : (txn?.id ?? t('txnDetail.transaction')) },
        ]}
      />

      <div className="page" data-page-name="Transaction Detail" data-ai-context={JSON.stringify({ role: portal, transaction_id: txn?.id ?? null, status: txn?.status ?? null, financing_type: txn?.financing_type ?? null, invoice_amount: txn?.invoice_amount ?? null, financing_amount_requested: txn?.financing_amount_requested ?? null, financing_amount_approved: txn?.financing_amount_approved ?? null, rate_apr: txn?.financing_rate_apr ?? txn?.apr ?? null, tenor_days: txn?.tenor_days ?? null, supplier: txn?.supplier_name ?? null, anchor: txn?.anchor_name ?? null, bank: txn?.bank_name ?? null, program: txn?.program_name ?? null })}>
        {loading ? (
          <div className="page-header">
            <div style={{ height: 28, width: 240, background: 'var(--border)', borderRadius: 6 }} />
            <div style={{ height: 16, width: 320, background: 'var(--border)', borderRadius: 4, marginTop: 8 }} />
          </div>
        ) : error ? (
          <div className="alert alert-error" style={{ marginBottom: 24 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">{t('txnDetail.failedToLoad', { error })}</div>
          </div>
        ) : txn ? (
          <>
            <div className="page-header">
              <h1 className="page-id-title">
                <span className="id-text">{txn.invoice_number}</span>
                <span className={`badge ${statusBadge(txn.status)}`}>{statusLabel(txn.status, t)}</span>
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
                    <h3 className="t-card-head">{t('txnDetail.financialSummary')}</h3>
                  </div>
                  {isDynamicDiscounting ? (
                    <div className="fs-grid">
                      <div className="fs-cell">
                        <span className="fs-label">{t('newTransaction.invoiceAmount')}</span>
                        <span className="fs-value">{fmtAmt(txn.invoice_amount)}</span>
                      </div>
                      <div className="fs-cell">
                        <span className="fs-label">{t('newTransaction.discountRate')}</span>
                        <span className="fs-value">{txn.discount_rate != null ? `${txn.discount_rate}%` : '—'}</span>
                      </div>
                      <div className="fs-cell">
                        <span className="fs-label">{t('txnDetail.youReceive')}</span>
                        <span className="fs-value blue">
                          {txn.financing_amount_requested != null ? fmtAmt(txn.financing_amount_requested) : '—'}
                        </span>
                      </div>
                      <div className="fs-cell">
                        <span className="fs-label">{t('newTransaction.discountAmount')}</span>
                        <span className="fs-value">{txn.discount_amount != null ? fmtAmt(txn.discount_amount) : '—'}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: 'var(--border)', border: '1px solid var(--border)' }}>
                      {([
                        [t('newTransaction.invoiceAmount'), fmtAmt(txn.invoice_amount)],
                        [t('newTransaction.advanceRate'), showApprovedFinancials && displayAdvanceRate != null ? `${displayAdvanceRate}%` : '—'],
                        [t('txnDetail.amountDisbursed'), showApprovedFinancials ? fmtAmt(txn.financing_amount_approved) : '—'],
                        [t('txnDetail.discountFee'), showApprovedFinancials ? fmtAmt(txn.fee_amount) : '—'],
                      ] as [string, string][]).map(([label, value]) => (
                        <div key={label} style={{ background: 'var(--white)', padding: '16px 20px' }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 6 }}>{label}</div>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Invoice details */}
                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">{t('txnDetail.invoiceDetails')}</h3>
                  </div>
                  <div className="kv-rows">
                    {txn.invoice_number && (
                      <div className="kv-row">
                        <span className="k">{t('txnDetail.invoiceNumberLower')}</span>
                        <span className="v">{txn.invoice_number}</span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="k">{t('txnDetail.invoiceDateLower')}</span>
                      <span className="v plain">{fmtDate(txn.invoice_date)}</span>
                    </div>
                    {/* Wire info in summary — only for supplier and bank */}
                  {(portal === 'supplier' || portal === 'bank') && wireInfoForSummary?.reference && (
                    <div className="kv-row">
                      <span className="k">{t('txnDetail.wireReference')}</span>
                      <span className="v plain">{wireInfoForSummary.reference}</span>
                    </div>
                  )}
                    <div className="kv-row">
                      <span className="k">{t('txnDetail.invoiceDueDateLower')}</span>
                      <span className="v plain">{fmtDate(txn.invoice_due_date)}</span>
                    </div>
                    {txn.description && (
                      <div className="kv-row" style={{ alignItems: 'flex-start' }}>
                        <span className="k" style={{ paddingTop: 2 }}>{t('listingDetail.description')}</span>
                        <span className="v plain" style={{ maxWidth: '60%', textAlign: 'right' }}>
                          {txn.description}
                        </span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="k">{t('newTransaction.program')}</span>
                      <span className="v plain">{txn.program_name ?? '—'}</span>
                    </div>
                    <div className="kv-row">
                      <span className="k">{t('transactionsPage.supplier')}</span>
                      <span className="v plain">{txn.supplier_name ?? '—'}</span>
                    </div>
                    <div className="kv-row">
                      <span className="k">{t('transactionsPage.anchor')}</span>
                      <span className="v plain">{txn.anchor_name ?? '—'}</span>
                    </div>
                    {txn.bank_name && (
                      <div className="kv-row">
                        <span className="k">{t('newTransaction.bank')}</span>
                        <span className="v plain">{txn.bank_name}</span>
                      </div>
                    )}
                    <div className="kv-row">
                      <span className="k">{t('txnDetail.submitted')}</span>
                      <span className="v plain">{fmtDate(txn.created_at)}</span>
                    </div>
                    {txn.disbursed_at && (
                      <div className="kv-row">
                        <span className="k">{t('txnDetail.disbursed')}</span>
                        <span className="v plain">{fmtDate(txn.disbursed_at)}</span>
                      </div>
                    )}
                    {txn.repaid_at && (
                      <div className="kv-row">
                        <span className="k">{t('txnDetail.repaid')}</span>
                        <span className="v plain">{fmtDate(txn.repaid_at)}</span>
                      </div>
                    )}
                    {repaymentInstructionsText && (portal === 'bank' || portal === 'anchor') && (
                      <div className="kv-row">
                        <span className="k">{t('txnDetail.repaymentInstructions')}</span>
                        <span className="v plain" style={{ fontSize: 12, lineHeight: 1.5 }}>
                          {repaymentInstructionsText}
                        </span>
                      </div>
                    )}
                    {txn.repayment_due_date && (portal === 'bank' || portal === 'anchor') && (
                      <div className="kv-row">
                        <span className="k">{t('txnDetail.repaymentDue')}</span>
                        <span className="v plain">{fmtDate(txn.repayment_due_date)}</span>
                      </div>
                    )}
                    {repaymentRequest?.status === 'approved' && (portal === 'bank' || portal === 'anchor') && (
                      <>
                        <div className="kv-row">
                          <span className="k">{t('txnDetail.repaymentArrangement')}</span>
                          <span className="v plain">
                            {repaymentRequest.type === 'extension'
                              ? t('txnDetail.extendedPaymentDate')
                              : t('txnDetail.countInstallments', { count: repaymentRequest.agreed_count ?? repaymentRequest.count ?? 0, frequency: frequencyLabel(repaymentRequest.agreed_structure ?? repaymentRequest.structure, t) })}
                          </span>
                        </div>
                        {repaymentRequest.type === 'extension' && (
                          <div className="kv-row">
                            <span className="k">{t('txnDetail.newPaymentDate')}</span>
                            <span className="v plain">
                              {repaymentRequest.agreed_date ?? repaymentRequest.requested_date}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Collateral */}
                {(collateral.length > 0 || portal === 'bank') && (
                  <div className="card">
                    <div className="card-head">
                      <span>{t('txnDetail.collateral')}</span>
                      {portal === 'bank' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => setShowAddCollateral(s => !s)}
                        >
                          {showAddCollateral ? t('common.cancel') : t('txnDetail.add')}
                        </button>
                      )}
                    </div>

                    {collateral.length === 0
                      ? portal === 'bank' && (
                          <div className="card-body">
                            <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>
                              {t('txnDetail.noCollateralRequirements')}
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
                                  ? '#DC2626'
                                  : item.status === 'submitted'
                                  ? 'var(--color-accent)'
                                  : 'var(--color-amber)',
                              }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 500 }}>
                                  {formatCollateralType(item.collateral_type, t)}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                                  {item.description}
                                </div>
                              </div>
                              <span className={`badge ${collateralStatusBadge(item.status)}`}>
                                {t(`collateral.status.${item.status}`)}
                              </span>
                              {portal === 'supplier' && item.status === 'pending' && (
                                submittingCollateral?.id === item.id ? null : (
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => setSubmittingCollateral(item)}
                                  >
                                    {t('txnDetail.submit')}
                                  </button>
                                )
                              )}
                              {portal === 'bank' && item.status === 'submitted' && (
                                <button
                                  className="btn btn-primary btn-sm"
                                  type="button"
                                  onClick={() => setReviewingCollateral(item)}
                                >
                                  {t('txnDetail.review')}
                                </button>
                              )}
                              {portal === 'bank' && item.status === 'accepted' && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  type="button"
                                  onClick={() => handleCollateralAction(item.id, { action: 'release' })}
                                >
                                  {t('txnDetail.release')}
                                </button>
                              )}
                            </div>
                            {/* Supplier submission form */}
                            {portal === 'supplier' && submittingCollateral?.id === item.id && (
                              <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
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
                      <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
                          {t('txnDetail.review')}: {formatCollateralType(reviewingCollateral.collateral_type, t)}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            onClick={() => handleCollateralAction(reviewingCollateral.id, { action: 'accept' })}
                          >
                            {t('listingDetail.accept')}
                          </button>
                          <textarea
                            className="input"
                            placeholder={t('txnDetail.waiverNotePlaceholder')}
                            value={waiverNote}
                            onChange={e => setWaiverNote(e.target.value)}
                            style={{ height: 60, resize: 'none', width: '100%' }}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => handleCollateralAction(reviewingCollateral.id, { action: 'waive', waiver_note: waiverNote })}
                          >
                            {t('txnDetail.waive')}
                          </button>
                          <textarea
                            className="input"
                            placeholder={t('txnDetail.rejectionReasonRequiredPlaceholder')}
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
                            {t('txnDetail.reject')}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => setReviewingCollateral(null)}
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    )}

                    {showAddCollateral && (
                      <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('newTransaction.type')}</div>
                            <select
                              className="input"
                              value={addCollForm.collateral_type}
                              onChange={e => setAddCollForm(f => ({ ...f, collateral_type: e.target.value }))}
                              style={{ width: '100%' }}
                            >
                              <option value="post_dated_cheque">{t('txnDetail.collateral.postDatedCheque')}</option>
                              <option value="personal_guarantee">{t('txnDetail.collateral.personalGuarantee')}</option>
                              <option value="assignment_of_receivables">{t('txnDetail.collateral.assignmentOfReceivables')}</option>
                              <option value="cash_collateral">{t('txnDetail.collateral.cashCollateral')}</option>
                              <option value="asset_pledge">{t('txnDetail.collateral.assetPledge')}</option>
                              <option value="other">{t('txnDetail.collateral.other')}</option>
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.descriptionRequired')}</div>
                            <textarea
                              className="input"
                              value={addCollForm.description}
                              onChange={e => setAddCollForm(f => ({ ...f, description: e.target.value }))}
                              placeholder={t('txnDetail.describeCollateralRequirement')}
                              style={{ width: '100%', height: 72, resize: 'none' }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.requiredValueOptional')}</div>
                            <input
                              className="input mono"
                              value={addCollForm.required_value}
                              onChange={e => setAddCollForm(f => ({ ...f, required_value: e.target.value }))}
                              placeholder="0.00"
                              style={{ width: '100%' }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 4 }}>{t('txnDetail.deadlineRequired')}</div>
                            <input
                              type="date"
                              className="input"
                              value={addCollForm.deadline}
                              onChange={e => setAddCollForm(f => ({ ...f, deadline: e.target.value }))}
                              style={{ width: '100%' }}
                            />
                          </div>
                          {addCollError && (
                            <div style={{ fontSize: 12, color: '#DC2626' }}>{addCollError}</div>
                          )}
                          {addCollSuccess && (
                            <div style={{ fontSize: 12, color: 'var(--color-green)' }}>{t('txnDetail.requirementAdded')}</div>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              type="button"
                              disabled={addCollSaving}
                              onClick={handleAddCollateral}
                            >
                              {addCollSaving ? t('txnDetail.adding') : t('txnDetail.add')}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              onClick={() => { setShowAddCollateral(false); setAddCollError(null) }}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Documents */}
                {documents.length > 0 && (
                  <div className="card">
                    <div className="card-head">
                      <h3 className="t-card-head">{t('txnDetail.documents')}</h3>
                    </div>
                    {documents.length === 0 ? (
                      <div className="card-body">
                        <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>
                          {t('txnDetail.noDocumentsUploaded')}
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
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={async () => {
                                  try {
                                    const res = await fetch(doc.signed_url!)
                                    const blob = await res.blob()
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = doc.name || 'document'
                                    document.body.appendChild(a)
                                    a.click()
                                    document.body.removeChild(a)
                                    URL.revokeObjectURL(url)
                                  } catch {}
                                }}
                              >
                                {t('txnDetail.download')}
                              </button>
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
                    <h3 className="t-card-head">{t('txnDetail.history')}</h3>
                  </div>
                  {events.length === 0 ? (
                    <div className="card-body" style={{ color: 'var(--gray)', fontSize: 12 }}>
                      {t('txnDetail.noEventsYet')}
                    </div>
                  ) : (
                    <div className="timeline">
                      {[...events].reverse().map((e) => {
                        const actor = (e.actor as string) ?? 'system'
                        const dotColor =
                          actor === 'bank'     ? 'blue'   :
                          actor === 'anchor'   ? 'amber'  :
                          actor === 'supplier' ? 'purple' : 'gray'
                        const isWireEvent = e.event_type === 'disbursement_marked' || e.event_type === 'wire_info_sent' || (e.notes?.toLowerCase().includes('wire') ?? false)
                        const displayAction = isWireEvent ? t('txnDetail.event.bankSubmittedWireDetails') : humanizeEvent(e, t)
                        const displayNotes = isWireEvent ? null : e.notes
                        return (
                          <div key={e.id} className="tl-item">
                            <span className={`tl-dot ${dotColor}`} />
                            <span className="tl-line" />
                            <div className="tl-body">
                              <div className="tl-actor-row">
                                <span className={`tl-actor-pill ${actor}`}>
                                  {actor === 'bank' ? t('newTransaction.bank') : actor === 'anchor' ? t('transactionsPage.anchor') : actor === 'supplier' ? t('transactionsPage.supplier') : t('txnDetail.system')}
                                </span>
                                <span className="tl-actor-name">{e.actor_name}</span>
                                <span className="tl-action">{displayAction}</span>
                              </div>
                              {displayNotes && (
                                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--gray)' }}>
                                  {displayNotes}
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
                {txn.status === 'rejected' && (
                  <div style={{
                    background: 'rgba(220,38,38,0.08)',
                    border: '1px solid #DC2626',
                    borderRadius: 8, padding: '10px 14px',
                    fontSize: 13, color: '#DC2626',
                    fontWeight: 500, marginBottom: 12,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    ✕ {t('txnDetail.transactionWasRejected')}
                    {txnRejectionReason && ` — ${txnRejectionReason}`}
                  </div>
                )}
                <div className="card">
                  <div className="card-head">
                    <h3 className="t-card-head">{t('txnDetail.statusTracker')}</h3>
                  </div>

                  <div className="stepper">
                    {(() => {
                      // For RF transactions with an anchor repayment request, inject a dynamic step
                      let steps = isDynamicDiscounting ? ddStepperSteps(t) : isPOFinancing ? poStepperSteps(t) : isInvoiceFactoring ? ifStepperSteps(t) : rfStepperSteps(t)
                      type StepDef = { key: string; label: string; stateOverride?: 'done'|'current'|'todo' }
                      let stepsWithOverride: StepDef[] = steps

                      if (!isDynamicDiscounting && !isPOFinancing && !isInvoiceFactoring && hasAnchorRepaymentRequest) {
                        const anchorStepState: 'done'|'current'|'todo' =
                          txn.status === 'pending_anchor_approval' ? 'todo'
                          : txnAnchorNeg?.status === 'pending' || txnAnchorNeg?.status === 'counter_offered' ? 'current'
                          : txnAnchorNeg?.status === 'approved' || txnAnchorNeg?.status === 'rejected' ? 'done'
                          : 'todo'

                        stepsWithOverride = [
                          { key: 'pending_anchor_approval', label: t('txnDetail.stepper.anchorReview') },
                          { key: 'anchor_repayment_negotiation', label: t('txnDetail.stepper.repaymentRequest'), stateOverride: anchorStepState },
                          ...rfStepperSteps(t).slice(1),
                        ]
                      }

                      return stepsWithOverride.map((step, i) => {
                      const state: 'done'|'current'|'todo' = (step as StepDef).stateOverride ?? (
                        isDynamicDiscounting
                          ? ddStepperState(step.key, txn.status)
                          : isPOFinancing
                          ? poStepperState(step.key, txn.status)
                          : isInvoiceFactoring
                          ? ifStepperState(step.key, txn.status)
                          : rfStepperState(step.key, txn.status)
                      )
                      const isRejectedStep = (txn.status === 'rejected' || txn.status === 'in_dispute') && (state === 'done' || state === 'current')
                      return (
                        <div key={step.key} className={`step ${state}`}>
                          {isRejectedStep ? (
                            <div style={{
                              width: 22, height: 22, borderRadius: '50%',
                              background: '#DC2626',
                              display: 'flex', alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white', fontSize: 11, fontWeight: 700,
                              flexShrink: 0,
                            }}>✕</div>
                          ) : (
                            <span className={`step-circle ${state}`}>
                              {state === 'done' ? <Icon name="check" size={11} /> : i + 1}
                            </span>
                          )}
                          <span className={`step-line ${state === 'done' ? 'done' : ''}`} />
                          <div className="step-body">
                            <span className="step-name">{step.label}</span>
                          </div>
                        </div>
                      )
                    })
                    })()}
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
                    <div style={{ padding: '8px 16px', color: '#DC2626', fontSize: 12 }}>
                      {actionError}
                    </div>
                  )}

                  {portal === 'bank' && !isDynamicDiscounting && (
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
                  {portal === 'bank' && !isDynamicDiscounting && !isInvoiceFactoring && !isPOFinancing && (
                    <BankAnchorRepaymentRequestCard
                      transaction={txn}
                      onAction={handleAction}
                      acting={acting}
                    />
                  )}
                  {portal === 'bank' && isDynamicDiscounting && (
                    <div className="action-passive muted" style={{ padding: '12px 16px' }}>
                      {t('txnDetail.ddNoBankInvolvement')}
                    </div>
                  )}
                  {portal === 'anchor' && (
                    <AnchorActionPanel
                      transaction={txn}
                      onAction={handleAction}
                      acting={acting}
                      onSuccess={handleSuccess}
                      isInvoiceFactoring={isInvoiceFactoring}
                      isPOFinancing={isPOFinancing}
                      isDynamicDiscounting={isDynamicDiscounting}
                    />
                  )}
                  {portal === 'supplier' && (
                    <SupplierActionPanel
                      transaction={txn}
                      onAction={handleAction}
                      acting={acting}
                      isInvoiceFactoring={isInvoiceFactoring}
                      isPOFinancing={isPOFinancing}
                      isDynamicDiscounting={isDynamicDiscounting}
                      txnId={id}
                      onRefresh={load}
                    />
                  )}
                </div>
                {portal === 'anchor' && !isInvoiceFactoring && !isPOFinancing && !isDynamicDiscounting &&
                  !['draft', 'rejected', 'cancelled', 'completed'].includes(txn.status) && (
                  <div className="card" style={{ width: '100%', marginTop: 12 }}>
                    <div className="card-head">
                      <span>{t('txnDetail.repaymentRequest')}</span>
                    </div>
                    <div className="card-body">
                      <AnchorStandaloneRepaymentSection
                        transaction={txn}
                        onAction={handleAction}
                        acting={acting}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </PortalShell>
  )
}
