'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { useUser } from '@/lib/user-context'
import { DealRoadmap } from '@/components/deals/DealRoadmap'
import { ActionPanel } from '@/components/deals/ActionPanel'
import { FinancingManagementCard, type RequesterBankAccount } from '@/components/deals/FinancingManagementCard'
import { createClient } from '@/lib/supabase/client'
import {
  getFinancingContext,
  type DealForContext,
  type TransactionForContext,
  type BankForContext,
  type OrgForContext,
  type BankAccountForContext,
} from '@/lib/deals/financing-context'
import type { AvailableAction } from '@/app/api/deals/[id]/available-actions/route'
import type { Deal, Organization, FinancingRequest, AmendmentRecord } from '@strike-scf/types'
import { calcProcurementFees, calcBuyerTotalDue, calcSupplierNetReceivable, calcFinancingFees, calcNetDisbursement } from '@/lib/deals/fees'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiDoc   { kind: 'ai_po' | 'ai_invoice' | 'ai_contract'; content: string; generated_at: string | null }
interface UploadedDoc { id: string; kind: string; name: string; url: string | null; created_at: string }
interface DealDoc { id: string; name: string; document_kind: string; mime_type: string; created_at: string }

interface LinkedTransaction {
  id: string
  type: string
  status: string
  financing_amount_approved: number | null
  repayment_due_date: string | null
  tenor_days: number | null
  financing_rate_apr: number | null
  discount_rate: number | null
  discount_amount: number | null
  early_payment_date: string | null
  repayment_routing: string | null
  bank_id: string | null
  bank?: { id: string; display_name: string; legal_name: string } | null
  financing_request_id: string | null
  esign_document_id: string | null
  bank_signed_at: string | null
  anchor_signed_at: string | null
  supplier_signed_at: string | null
  esign_completed_at: string | null
  disbursed_at: string | null
  disbursed_by_user_id: string | null
  disbursement_reference: string | null
  supplier_paid_at: string | null
}

interface DealDetail {
  deal: Deal & {
    agreed_price?: number
    noa_acknowledged_at?: string | null
    noa_document_id?: string | null
    dd_offer_presented_at?: string | null
    dd_offer_accepted_at?: string | null
    dd_offer_declined_at?: string | null
    po_financing_converted_at?: string | null
  }
  buyer_org: Organization | null
  supplier_org: Organization | null
  room: { id: string; name: string } | null
  financing_request: FinancingRequest | null
  linked_transaction: LinkedTransaction | null
  bank_bank_account: BankAccountForContext | null
  requester_bank_account: RequesterBankAccount | null
  documents: DealDoc[]
  user_role: 'buyer' | 'supplier' | 'bank'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AI_DOC_LABELS: Record<string, string> = {
  ai_po: 'PURCHASE ORDER', ai_invoice: 'COMMERCIAL INVOICE', ai_contract: 'TRADE AGREEMENT',
}

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
    case 'goods_received':      return 'badge badge-active'
    case 'delivery_confirmed':
    case 'payment_due':         return 'badge badge-active'
    case 'payment_overdue':     return 'badge badge-overdue'
    case 'payment_info_sent':   return 'badge badge-offer'
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

// ─── Amendment Banner ─────────────────────────────────────────────────────────

function AmendmentBanner({ deal, onRefresh }: { deal: Deal; onRefresh: () => void }) {
  const [responding, setResponding] = useState(false)
  const history: AmendmentRecord[] = Array.isArray(deal.amendment_history) ? deal.amendment_history : []
  const pending = history.find(a => a.status === 'pending')
  if (!pending) return null

  async function respond(accepted: boolean) {
    setResponding(true)
    try {
      await fetch(`/api/deals/${deal.id}/amendment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amendment_id: pending!.id, response: accepted ? 'accepted' : 'rejected' }),
      })
      onRefresh()
    } finally { setResponding(false) }
  }

  return (
    <div style={{ padding: '14px 16px', background: 'rgba(20,40,204,0.04)', border: '1.5px solid rgba(20,40,204,0.2)', borderRadius: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 8 }}>Amendment Pending</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <div><span style={{ color: 'var(--gray)' }}>Field: </span>{pending.field.replace(/_/g, ' ')}</div>
        <div><span style={{ color: 'var(--gray)' }}>From: </span>{String(pending.current_value ?? '—')}</div>
        <div><span style={{ color: 'var(--blue)', fontWeight: 600 }}>To: </span>{String(pending.proposed_value ?? '—')}</div>
      </div>
      {pending.reason && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>Reason: {pending.reason}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-primary btn-sm" disabled={responding} onClick={() => respond(true)}>Accept</button>
        <button className="btn btn-ghost btn-sm" disabled={responding} onClick={() => respond(false)}>Reject</button>
      </div>
    </div>
  )
}

// ─── Propose Amendment Form ───────────────────────────────────────────────────

function ProposeAmendmentForm({ deal, onRefresh }: { deal: Deal & { agreed_price?: number }; onRefresh: () => void }) {
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

// ─── AI Doc Card ──────────────────────────────────────────────────────────────

function AiDocCard({ doc, dealId }: { doc: AiDoc; dealId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied]     = useState(false)
  const [downloading, setDownloading] = useState(false)
  const label = AI_DOC_LABELS[doc.kind] ?? doc.kind.toUpperCase()
  const apiType: 'po' | 'invoice' | null = doc.kind === 'ai_po' ? 'po' : doc.kind === 'ai_invoice' ? 'invoice' : null

  async function downloadDoc() {
    if (apiType) {
      setDownloading(true)
      try {
        const res = await fetch(`/api/deals/${dealId}/download-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: apiType }),
        })
        if (!res.ok) { alert('Failed to generate document'); return }
        const html = await res.text()
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${apiType === 'po' ? 'purchase-order' : 'commercial-invoice'}-${dealId.slice(0, 8).toUpperCase()}.html`
        a.click()
        URL.revokeObjectURL(url)
      } finally { setDownloading(false) }
    } else {
      // Contract: keep as plain text download
      const blob = new Blob([doc.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${label.toLowerCase().replace(/ /g, '-')}.txt`; a.click(); URL.revokeObjectURL(url)
    }
  }

  async function copyText() {
    try { await navigator.clipboard.writeText(doc.content); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="card-head" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpanded(e => !e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
          <span>{label}</span>
          <span className="badge badge-active" style={{ fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0, fontSize: 9 }}>AI</span>
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
            <button className="btn btn-blue btn-sm" disabled={downloading} onClick={downloadDoc}>
              {downloading ? '✦ Generating…' : apiType ? '✦ Download (Strike AI)' : 'Download .txt'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={copyText}>{copied ? 'Copied!' : 'Copy to clipboard'}</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Contract Document Link ───────────────────────────────────────────────────

function ContractDocumentLink({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/documents/${documentId}/url`).then(r => r.json()).then(d => { if (d.url) setUrl(d.url) }).catch(() => {})
  }, [documentId])
  if (!url) return <span style={{ fontSize: 12, color: 'var(--gray)' }}>Loading contract…</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
      View / Download Contract
    </a>
  )
}

// ─── Document Row ─────────────────────────────────────────────────────────────

function DocumentRow({ doc, onDelete }: { doc: DealDoc; onDelete?: (id: string) => void }) {
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
      {onDelete && <button onClick={() => onDelete(doc.id)} style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-red)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Remove</button>}
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
  const [availableActions, setAvailableActions] = useState<AvailableAction[]>([])
  const [showFinancingForm, setShowFinancingForm] = useState(false)
  const [finType, setFinType] = useState('')
  const [finAmount, setFinAmount] = useState('')
  const [finRateMax, setFinRateMax] = useState('')
  const [finSubmitting, setFinSubmitting] = useState(false)
  const [finError, setFinError] = useState<string | null>(null)
  const [alreadyReviewed, setAlreadyReviewed] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [listingLineItems, setListingLineItems] = useState<any[]>([])
  const [listingDocs, setListingDocs] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [revealBankAccount, setRevealBankAccount] = useState(false)
  const [downloadingDoc, setDownloadingDoc] = useState<'po' | 'invoice' | null>(null)

  const [contractData, setContractData] = useState<Record<string, any> | null>(null)
  const [receivingAccount, setReceivingAccount] = useState<BankAccountForContext | null>(null)

  const financeActionTriggered = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/deals/${id}`).then(r => r.json()),
      fetch(`/api/deals/${id}/available-actions`).then(r => r.json()).catch(() => ({ actions: [] })),
    ])
      .then(([dealData, actionsData]) => {
        if (dealData.error) setError(dealData.error)
        else setData(dealData)
        setAvailableActions(actionsData.actions ?? [])
      })
      .catch(() => setError('Failed to load deal'))
      .finally(() => setLoading(false))
  }, [id])

  const loadDocs = useCallback(() => {
    fetch(`/api/deals/${id}/documents`).then(r => r.json()).then(d => {
      if (!d.error) { setAiDocs(d.ai_documents ?? []); setUploadedDocs(d.uploaded_documents ?? []) }
    }).catch(() => {})
  }, [id])

  useEffect(() => { load() }, [load])

  // Fetch contract metadata (+ receiving bank account) whenever deal status changes
  useEffect(() => {
    if (!id) return
    fetch(`/api/deals/${id}/contract`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setContractData(d)
          if (d.receiving_bank_account) setReceivingAccount(d.receiving_bank_account as BankAccountForContext)
        }
      })
      .catch(() => {})
  }, [id, data?.deal?.status])

  // Realtime: re-fetch when the deal row changes (financing acceptance, status update, etc.)
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`deal-detail:${id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'deals',
        filter: `id=eq.${id}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, load])

  useEffect(() => {
    if (!data || financeActionTriggered.current) return
    if (typeof window === 'undefined') return
    const wantsFinance = new URLSearchParams(window.location.search).get('action') === 'finance'
    if (!wantsFinance) return
    const d = data.deal
    if (['agreed', 'active', 'confirmed'].includes(d.status) && !data.financing_request) {
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
    loadDocs()
  }, [data?.deal?.id, loadDocs])

  useEffect(() => {
    const lid = (data?.deal as any)?.listing_id as string | undefined
    if (!lid) return
    Promise.all([
      fetch(`/api/marketplace/listings/${lid}/line-items`).then(r => r.ok ? r.json() : null),
      fetch(`/api/marketplace/listings/${lid}/document`).then(r => r.ok ? r.json() : null),
    ]).then(([liData, docData]) => {
      if (liData?.items) setListingLineItems(liData.items)
      if (docData?.documents) setListingDocs(docData.documents)
    }).catch(() => {})
  }, [(data?.deal as any)?.listing_id])

  // ── Action router — maps action names to the right API endpoints ──────────

  async function handleTransition(action: string, payload: Record<string, unknown>): Promise<void> {
    let url: string
    let body: Record<string, unknown>
    let method = 'POST'

    if (action === 'acknowledge_noa') {
      url = `/api/deals/${id}/acknowledge-noa`
      body = payload
    } else if (action === 'present_dd_offer') {
      url = `/api/deals/${id}/dd-offer`
      body = payload
    } else if (action === 'dd_accept') {
      url = `/api/deals/${id}/dd-respond`
      body = { accepted: true }
    } else if (action === 'dd_decline') {
      url = `/api/deals/${id}/dd-respond`
      body = { accepted: false }
    } else if (action === 'cancel') {
      url = `/api/deals/${id}/cancel`
      body = { cancellation_reason: payload.cancellation_reason, confirmed: true }
    } else if (action === 'confirm') {
      url = `/api/deals/${id}`
      method = 'PATCH'
      body = { status: 'confirmed' }
    } else if (action === 'submit_contract') {
      // Buyer submits contract — go to /contract endpoint
      url = `/api/deals/${id}/contract`
      body = { generate: payload.generate_contract, contract_document_id: payload.contract_document_id }
    } else if (action === 'sign_contract') {
      url = `/api/deals/${id}/contract`
      method = 'PATCH'
      body = { signature: payload.contract_supplier_signature, bank_account_id: payload.receiving_bank_account_id }
    } else if (action === 'submit_bank_contract') {
      url = `/api/deals/${id}/contract`
      body = { action: 'bank', bank_contract_document_id: payload.bank_contract_document_id }
    } else if (action === 'sign_bank_contract') {
      url = `/api/deals/${id}/contract`
      method = 'PATCH'
      body = { action: 'bank_sign', signature: payload.bank_contract_signature }
    } else if (action === 'upload_invoice' || action === 'replace_invoice') {
      url = `/api/deals/${id}/contract`
      method = 'PATCH'
      body = { action: 'upload_invoice', invoice_document_id: payload.invoice_document_id }
    } else {
      url = `/api/deals/${id}/transition`
      body = { action, payload }
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Action failed')
    load()
  }

  async function submitFinancingRequest() {
    if (!data) return
    setFinSubmitting(true); setFinError(null)
    try {
      const res = await fetch('/api/marketplace/financing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: id,
          structure_type: 'open',
          financing_type: finType || undefined,
          amount_requested: parseFloat(finAmount),
          preferred_rate_max: finRateMax ? parseFloat(finRateMax) : undefined,
          currency: data.deal.agreed_currency ?? 'USD',
        }),
      })
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

  async function handleUploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadError(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/deals/${id}/upload-document`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setUploadError(json.error ?? 'Upload failed'); return }
      if (json.warning) setUploadError(json.warning)
      loadDocs()
    } finally { setUploading(false); e.target.value = '' }
  }

  async function handleDeleteDoc(docId: string) {
    if (!confirm('Remove this document?')) return
    const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' })
    if (res.ok) loadDocs()
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

  const { deal, buyer_org, supplier_org, room, financing_request, linked_transaction, bank_bank_account, requester_bank_account, documents, user_role } = data
  const counterparty = user_role === 'buyer' ? supplier_org : buyer_org
  const dealValue = deal.total_value ?? deal.agreed_price ?? null
  const currency = deal.agreed_currency ?? 'USD'
  const shippingCost = deal.shipping_cost ?? null
  const { buyerFee, supplierFee } = calcProcurementFees(dealValue)
  const buyerTotalDue = calcBuyerTotalDue(dealValue, shippingCost, buyerFee)
  const supplierNetReceivable = calcSupplierNetReceivable(dealValue, shippingCost, supplierFee)
  const hasAiDocs   = aiDocs.length > 0
  const uploadedFromDocs = documents.filter(d => !['ai_po','ai_invoice','ai_contract'].includes(d.document_kind))
  const hasUploaded = uploadedDocs.length > 0 || uploadedFromDocs.length > 0 || listingDocs.length > 0

  async function downloadDocument(type: 'po' | 'invoice') {
    setDownloadingDoc(type)
    try {
      const res = await fetch(`/api/deals/${id}/download-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? 'Failed to generate document')
        return
      }
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url2 = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url2
      a.download = `${type === 'po' ? 'purchase-order' : 'commercial-invoice'}-${shortId(id)}.html`
      a.click()
      URL.revokeObjectURL(url2)
    } finally {
      setDownloadingDoc(null)
    }
  }
  const CANCELLABLE = ['negotiating', 'agreed', 'documents_pending', 'confirmed', 'in_preparation', 'active', 'goods_received', 'payment_info_sent']
  const canCancel   = CANCELLABLE.includes(deal.status) && !deal.financing_payment_active
  const canFinance  = user_role !== 'bank' && ['delivery_confirmed', 'shipped', 'goods_received', 'confirmed', 'in_preparation'].includes(deal.status) && !financing_request && !deal.financing_payment_active
  const canAmend    = ['confirmed', 'in_preparation', 'active'].includes(deal.status) && !deal.financing_payment_active
  const isActive    = !['completed', 'cancelled', 'in_dispute', 'disputed'].includes(deal.status)
  const hasPaymentInfo = !!(deal as any).payment_info_sent_at || !!deal.payment_bank_name

  // Compute financing context (G4.3)
  const txn = linked_transaction
  const txnForCtx: TransactionForContext | null = txn
    ? {
        type: txn.type,
        status: txn.status,
        financing_amount_approved: txn.financing_amount_approved,
        financing_rate_apr: txn.financing_rate_apr,
        tenor_days: txn.tenor_days,
        repayment_due_date: txn.repayment_due_date,
        discount_rate: txn.discount_rate,
        discount_amount: txn.discount_amount,
        early_payment_date: txn.early_payment_date,
        repayment_routing: txn.repayment_routing,
        bank_id: txn.bank_id,
      }
    : null

  const bankOrgForCtx: BankForContext | null = txn?.bank
    ? { id: txn.bank.id, display_name: txn.bank.display_name, legal_name: txn.bank.legal_name }
    : null

  const supplierOrgForCtx: OrgForContext = {
    legal_name: supplier_org?.legal_name ?? null,
    primary_contact_email: supplier_org?.primary_contact_email ?? null,
  }

  const dealForCtx: DealForContext = {
    status: deal.status,
    financing_payment_active: deal.financing_payment_active ?? false,
    total_value: deal.total_value,
    agreed_price: deal.agreed_price,
    agreed_currency: deal.agreed_currency,
    payment_due_date: deal.payment_due_date,
    receiving_bank_account: receivingAccount ?? undefined,
    payment_bank_name: deal.payment_bank_name,
    payment_account_number: deal.payment_account_number,
    payment_account_name: deal.payment_account_name,
    payment_swift_iban: deal.payment_swift_iban,
    payment_routing_number: deal.payment_routing_number,
    payment_reference: deal.payment_reference,
    noa_acknowledged_at: deal.noa_acknowledged_at ?? null,
    noa_document_id: deal.noa_document_id ?? null,
  }

  const financingContext = getFinancingContext(dealForCtx, txnForCtx, null, bankOrgForCtx, supplierOrgForCtx, bank_bank_account)

  // Once financing is active, the buyer owes the bank, not the supplier — show
  // whichever account actually receives the payment.
  const payingBank = financingContext.isActive && financingContext.paymentRecipient === 'bank'
  const displayedAccount = payingBank ? bank_bank_account : receivingAccount

  const hasDDOffer = !!(deal.dd_offer_presented_at && !deal.dd_offer_accepted_at && !deal.dd_offer_declined_at)

  // G5.1 — AI context summary for the overlay
  const recentActions = availableActions.filter(a => a.available).slice(0, 3).map(a => `- ${a.action}: ${a.description}`).join('\n')
  const aiContext = JSON.stringify({
    deal_id: shortId(deal.id),
    status: deal.status,
    user_role,
    buyer: buyer_org?.legal_name ?? null,
    supplier: supplier_org?.legal_name ?? null,
    deal_amount: dealValue ? `${fmt(dealValue, currency)} ${currency}` : null,
    financing_summary: financingContext.aiContextSummary,
    financing_terms: txn ? {
      structure: txn.type,
      rate_apr: txn.financing_rate_apr ?? null,
      tenor_days: txn.tenor_days ?? null,
      amount_approved: txn.financing_amount_approved ?? null,
      txn_status: txn.status,
    } : null,
    can_request_financing: canFinance,
    financing_how_to: canFinance
      ? 'Use the "Request Financing" button on this page to submit a financing request to banks on Strike Place.'
      : null,
    financing_types_available: canFinance ? {
      reverse_factoring: 'Buyer requests bank to pay supplier early; buyer repays bank on original due date.',
      invoice_factoring: 'Supplier sells receivable to bank for immediate cash; bank collects from buyer.',
      po_financing: 'Pre-shipment working capital — bank funds production/inventory before goods ship.',
      dynamic_discounting: 'Anchor (buyer) pays supplier early in exchange for a discount on the invoice.',
    } : null,
    available_actions: availableActions.filter(a => a.available).map(a => ({ action: a.action, description: a.description })),
  })

  return (
    <>
      <Topbar
        crumbs={[{ label: 'My Deals', onClick: () => router.push('/deals') }, { label: `Deal #${shortId(deal.id)}` }]}
        actions={<div className="topbar-right">{room && <Link href={`/rooms/${room.id}`} className="btn btn-ghost btn-sm">Open Deal Room →</Link>}</div>}
      />
      {/* G5.1 — AI context injected via data attribute for ai-overlay.tsx */}
      <div className="page" style={{ maxWidth: 1280 }} data-page-name="deal-detail" data-ai-context={aiContext}>
        {/* Header */}
        <div className="page-header" style={{ marginBottom: 24 }}>
          <div className="page-id-title">
            <span className="id-text">Deal #{shortId(deal.id)}</span>
            <span className={statusBadgeClass(deal.status)}>{deal.status.replace(/_/g, ' ')}</span>
            <span className={sourceBadgeClass(deal.deal_source)}>{deal.deal_source}</span>
            {financingContext.financingBadgeLabel && (
              <span style={{ fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--blue-light)', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {financingContext.financingBadgeLabel}
              </span>
            )}
          </div>
          <p className="subtitle" style={{ marginTop: 4 }}>
            {user_role === 'buyer' ? 'You are the buyer' : user_role === 'supplier' ? 'You are the supplier' : 'Bank view'} on this deal{counterparty && ` with ${counterparty.legal_name}`}
          </p>
        </div>

        {/* Amendment banner */}
        {canAmend && <AmendmentBanner deal={deal} onRefresh={load} />}

        <div className="split-panel">
          {/* ── Main panel ── */}
          <div className="split-panel-main">
            {/* Roadmap — G4.1 */}
            <div className="card">
              <div className="card-head">Deal Progress</div>
              <div className="card-body" style={{ padding: '20px 24px' }}>
                <DealRoadmap
                  status={deal.status}
                  financingContext={financingContext}
                  currentUserRole={user_role}
                />
              </div>
            </div>

            {/* Action Required — G4.2. For the bank, this section is replaced by the
                financing management lifecycle (contract → disbursement → confirm receipt)
                scoped to their own transaction, instead of the buyer/supplier action panel. */}
            {(user_role === 'bank' ? !!(financing_request && linked_transaction) : isActive) && (
              <div className="card" style={{ border: '1.5px solid var(--blue-light)' }}>
                <div className="card-head" style={{ color: 'var(--blue)' }}>
                  {user_role === 'bank' ? 'Financing Management' : 'Action Required'}
                </div>
                <div className="card-body">
                  {user_role === 'bank' ? (
                    <FinancingManagementCard
                      requestId={financing_request!.id}
                      transaction={linked_transaction}
                      requesterBankAccount={requester_bank_account}
                      isBank
                      isRequester={false}
                      isRequesterBuyer={deal.buyer_org_id === financing_request!.requesting_org_id}
                      onReload={load}
                      embedded
                      financingAmount={linked_transaction?.financing_amount_approved ?? financing_request?.amount_requested ?? null}
                      currency={financing_request?.currency ?? currency}
                    />
                  ) : (
                    <>
                      {(deal.status as string) === 'contract_pending' && contractData?.contract?.document_id && (
                        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--offwhite)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--gray)', marginBottom: 4 }}>Contract to Review & Sign</div>
                            <ContractDocumentLink documentId={contractData.contract.document_id} />
                          </div>
                          {contractData.contract.generated_at && (
                            <span className="badge badge-active" style={{ fontSize: 9, fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0, flexShrink: 0 }}>AI Generated</span>
                          )}
                        </div>
                      )}
                      <ActionPanel
                        dealId={deal.id}
                        availableActions={availableActions}
                        financingContext={financingContext}
                        currentUserRole={user_role}
                        hasDDOffer={hasDDOffer}
                        onActionSubmit={handleTransition}
                        onRefresh={load}
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Contract Panel — v2 procurement flow */}
            {contractData?.contract?.submitted_at && (
              <div className="card">
                <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  Trade Contract
                  {contractData.contract.supplier_signed_at
                    ? <span className="badge badge-completed" style={{ fontSize: 10 }}>Signed</span>
                    : <span className="badge badge-pending" style={{ fontSize: 10 }}>Awaiting Signature</span>}
                  {contractData.contract.generated_at && <span className="badge badge-active" style={{ fontSize: 10, fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0 }}>AI Generated</span>}
                </div>
                <div className="kv-list">
                  <div className="kv-row"><span className="k">Submitted</span><span className="v">{fmtDate(contractData.contract.submitted_at)}</span></div>
                  {contractData.contract.supplier_signed_at && (
                    <>
                      <div className="kv-row"><span className="k">Signed</span><span className="v">{fmtDate(contractData.contract.supplier_signed_at)}</span></div>
                      <div className="kv-row"><span className="k">Signature</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{contractData.contract.supplier_signature}</span></div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Invoice Panel — shown after confirmed */}
            {contractData?.invoice?.generated_at && (
              <div className="card">
                <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  Commercial Invoice
                  <span className="badge badge-active" style={{ fontSize: 10, fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0 }}>AI Generated</span>
                </div>
                <div className="kv-list">
                  {contractData.invoice.number && <div className="kv-row"><span className="k">Invoice No.</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)' }}>{contractData.invoice.number}</span></div>}
                  <div className="kv-row"><span className="k">Generated</span><span className="v">{fmtDate(contractData.invoice.generated_at)}</span></div>
                </div>
              </div>
            )}

            {/* Bank Contract Panel */}
            {contractData?.bank_contract?.submitted_at && (
              <div className="card" style={{ border: '1px solid var(--blue-light)' }}>
                <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--blue)' }}>
                  Financing Contract
                  {contractData.bank_contract.signed_at
                    ? <span className="badge badge-completed" style={{ fontSize: 10 }}>Signed</span>
                    : <span className="badge badge-pending" style={{ fontSize: 10 }}>Awaiting Signature</span>}
                </div>
                <div className="kv-list">
                  <div className="kv-row"><span className="k">Submitted</span><span className="v">{fmtDate(contractData.bank_contract.submitted_at)}</span></div>
                  {contractData.bank_contract.signed_at && (
                    <>
                      <div className="kv-row"><span className="k">Signed</span><span className="v">{fmtDate(contractData.bank_contract.signed_at)}</span></div>
                      <div className="kv-row"><span className="k">Signature</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{contractData.bank_contract.signature}</span></div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Receiving Bank Account (shown after confirmed) */}
            {displayedAccount && ['confirmed', 'shipped', 'goods_received', 'delivery_confirmed', 'payment_info_sent', 'payment_confirmed', 'completed'].includes(deal.status) && (
              <div className="card">
                <div className="card-head">
                  Payment Receiving Account{payingBank ? ' (Bank)' : ''}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11 }}
                    onClick={() => setRevealBankAccount(r => !r)}
                  >
                    {revealBankAccount ? 'Hide' : 'Reveal'}
                  </button>
                </div>
                <div className="kv-list">
                  {displayedAccount.nickname && <div className="kv-row"><span className="k">Account Name</span><span className="v plain">{displayedAccount.nickname}</span></div>}
                  <div className="kv-row"><span className="k">Bank</span><span className="v plain">{displayedAccount.bank_name}</span></div>
                  <div className="kv-row"><span className="k">Account Holder</span><span className="v plain">{displayedAccount.account_holder_name}</span></div>
                  {displayedAccount.account_number && (
                    <div className="kv-row">
                      <span className="k">Account</span>
                      <span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, filter: revealBankAccount ? 'none' : 'blur(4px)', userSelect: revealBankAccount ? 'auto' : 'none', transition: 'filter 0.2s' }}>
                        {revealBankAccount ? displayedAccount.account_number : `****${displayedAccount.account_number.slice(-4)}`}
                      </span>
                    </div>
                  )}
                  {displayedAccount.routing_number && (
                    <div className="kv-row">
                      <span className="k">Routing</span>
                      <span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, filter: revealBankAccount ? 'none' : 'blur(4px)', userSelect: revealBankAccount ? 'auto' : 'none', transition: 'filter 0.2s' }}>
                        {displayedAccount.routing_number}
                      </span>
                    </div>
                  )}
                  {displayedAccount.swift_iban && (
                    <div className="kv-row">
                      <span className="k">SWIFT / IBAN</span>
                      <span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, filter: revealBankAccount ? 'none' : 'blur(4px)', userSelect: revealBankAccount ? 'auto' : 'none', transition: 'filter 0.2s' }}>
                        {displayedAccount.swift_iban}
                      </span>
                    </div>
                  )}
                  <div className="kv-row"><span className="k">Type</span><span className="v plain">{displayedAccount.account_type}</span></div>
                </div>
              </div>
            )}

            {/* Dispute evidence */}
            <DisputeEvidencePanel deal={deal} onRefresh={load} />

            {/* Agreed Terms */}
            <div className="card">
              <div className="card-head">
                Agreed Terms
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {canAmend && <ProposeAmendmentForm deal={deal} onRefresh={load} />}
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={downloadingDoc !== null} onClick={() => downloadDocument('po')}>
                    {downloadingDoc === 'po' ? '✦ Generating…' : 'Download PO'}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={downloadingDoc !== null} onClick={() => downloadDocument('invoice')}>
                    {downloadingDoc === 'invoice' ? '✦ Generating…' : 'Download Invoice'}
                  </button>
                </div>
              </div>
              <div className="kv-list">
                <div className="kv-row"><span className="k">Delivery Date</span><span className="v">{fmtDate(deal.agreed_delivery_date)}</span></div>
                <div className="kv-row"><span className="k">Incoterms</span><span className="v">{deal.agreed_incoterms ?? '—'}</span></div>
                <div className="kv-row"><span className="k">Payment Terms</span><span className="v plain">{deal.agreed_payment_terms ?? '—'}</span></div>
                {deal.payment_due_date && <div className="kv-row"><span className="k">Payment Due</span><span className="v">{fmtDate(deal.payment_due_date)}</span></div>}
                {deal.import_notes && <div className="kv-row"><span className="k">Notes</span><span className="v plain" style={{ fontSize: 12 }}>{deal.import_notes}</span></div>}
              </div>
              {listingLineItems.length > 0 ? (
                <div style={{ padding: '0 24px 20px' }}>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 10 }}>Item Breakdown</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '6px 16px', fontSize: 12 }}>
                    <span style={{ color: 'var(--gray)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Item</span>
                    <span style={{ color: 'var(--gray)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Qty</span>
                    <span style={{ color: 'var(--gray)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Unit</span>
                    <span style={{ color: 'var(--gray)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Unit Price</span>
                    {listingLineItems.map((item: any) => (
                      <React.Fragment key={item.id}>
                        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{item.name ?? item.description ?? '—'}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 500 }}>{item.quantity ?? '—'}</span>
                        <span style={{ color: 'var(--gray)' }}>{item.unit ?? ''}</span>
                        <span style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 500, color: item.unit_price ? 'var(--ink)' : 'var(--gray)' }}>{item.unit_price ? fmt(item.unit_price, item.currency ?? currency) : '—'}</span>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--gray)', fontFamily: 'var(--font-body)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Agreed</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#C9A84C' }}>{fmt(deal.agreed_price, currency)}</span>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 24px 16px' }}>
                  <div className="kv-row"><span className="k">Goods</span><span className="v plain">{deal.goods_description ?? '—'}</span></div>
                  {deal.agreed_quantity != null && <div className="kv-row"><span className="k">Quantity</span><span className="v">{deal.agreed_quantity} {(deal as any).agreed_unit ?? ''}</span></div>}
                  <div className="kv-row"><span className="k">Price</span><span className="v">{fmt(deal.agreed_price, currency)}</span></div>
                  <div className="kv-row"><span className="k">Currency</span><span className="v">{currency}</span></div>
                </div>
              )}
            </div>

            {/* Approved financing — accepted but not yet disbursed */}
            {!financingContext.isActive && txn && ['financing_approved', 'financing_approved_pending_collateral', 'funded'].includes(txn.status) && (
              <div className="card">
                <div className="card-head" style={{ color: 'var(--blue)' }}>
                  Financing Approved
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--blue-light)', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.04em', marginLeft: 8 }}>
                    {txn.type.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="kv-list">
                  <div className="kv-row"><span className="k">Structure</span><span className="v plain">{txn.type.replace(/_/g, ' ')}</span></div>
                  {txn.financing_rate_apr != null && (
                    <div className="kv-row"><span className="k">Rate APR</span><span className="v" style={{ fontWeight: 700, color: 'var(--color-green)' }}>{txn.financing_rate_apr}%</span></div>
                  )}
                  {txn.tenor_days != null && (
                    <div className="kv-row"><span className="k">Tenor</span><span className="v">{txn.tenor_days}d</span></div>
                  )}
                  {txn.financing_amount_approved != null && (
                    <div className="kv-row"><span className="k">Financed Amount</span><span className="v" style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{fmt(txn.financing_amount_approved, currency)}</span></div>
                  )}
                  <div className="kv-row">
                    <span className="k">Status</span>
                    <span className="badge badge-active" style={{ fontSize: 10 }}>Contract &amp; Disbursement Pending</span>
                  </div>
                </div>
              </div>
            )}

            {/* Financing context details (replaces old inline financing info) */}
            {financingContext.isActive && (
              <div className="card">
                <div className="card-head">
                  Active Financing
                  {financingContext.financingBadgeLabel && (
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--blue-light)', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {financingContext.financingBadgeLabel}
                    </span>
                  )}
                </div>
                <div className="kv-list">
                  <div className="kv-row"><span className="k">Structure</span><span className="v plain">{financingContext.structure?.replace(/_/g, ' ') ?? '—'}</span></div>
                  <div className="kv-row"><span className="k">Payment to</span><span className="v plain">{financingContext.paymentRecipientName}</span></div>
                  <div className="kv-row"><span className="k">Amount</span><span className="v" style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{fmt(financingContext.paymentAmount, financingContext.paymentCurrency)}</span></div>
                  {financingContext.paymentDueDate && <div className="kv-row"><span className="k">Due Date</span><span className="v">{fmtDate(financingContext.paymentDueDate)}</span></div>}
                  {financingContext.ddDiscountRate != null && <div className="kv-row"><span className="k">Discount Rate</span><span className="v">{financingContext.ddDiscountRate}% annualized</span></div>}
                  {financingContext.ddDiscountAmount != null && <div className="kv-row"><span className="k">Discount Amount</span><span className="v" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--color-red)' }}>-{fmt(financingContext.ddDiscountAmount, financingContext.paymentCurrency)}</span></div>}
                  {financingContext.noaRequired && (
                    <div className="kv-row">
                      <span className="k">NOA Status</span>
                      <span className={`badge ${financingContext.noaAcknowledged ? 'badge-completed' : 'badge-pending'}`} style={{ fontSize: 10 }}>
                        {financingContext.noaAcknowledged ? 'Acknowledged' : 'Pending'}
                      </span>
                    </div>
                  )}
                  {financingContext.structure === 'po_financing' && (
                    <div className="kv-row">
                      <span className="k">PO Status</span>
                      <span className={`badge ${financingContext.poFinancingConverted ? 'badge-completed' : 'badge-offer'}`} style={{ fontSize: 10 }}>
                        {financingContext.poFinancingConverted ? 'Converted' : 'Pre-Shipment'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

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

            {/* Goods receipt info */}
            {((deal as any).goods_received_at || (deal as any).goods_confirmed_at) && (
              <div className="card">
                <div className="card-head">Goods Receipt</div>
                <div className="kv-list">
                  {(deal as any).goods_received_at && <div className="kv-row"><span className="k">Received</span><span className="v">{fmtDate((deal as any).goods_received_at)}</span></div>}
                  {(deal as any).goods_confirmed_at && <div className="kv-row"><span className="k">Accepted</span><span className="v">{fmtDate((deal as any).goods_confirmed_at)}</span></div>}
                </div>
              </div>
            )}

            {/* Payment details (shown after payment info submitted, to buyer and bank) */}
            {hasPaymentInfo && !financingContext.isActive && (
              <div className="card">
                <div className="card-head">Payment Details</div>
                <div className="kv-list">
                  {deal.payment_bank_name && <div className="kv-row"><span className="k">Bank</span><span className="v plain">{deal.payment_bank_name}</span></div>}
                  {deal.payment_account_name && <div className="kv-row"><span className="k">Account Name</span><span className="v plain">{deal.payment_account_name}</span></div>}
                  {deal.payment_account_number && <div className="kv-row"><span className="k">Account</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>****{deal.payment_account_number.slice(-4)}</span></div>}
                  {(deal.payment_swift_iban || deal.payment_routing_number) && <div className="kv-row"><span className="k">SWIFT / IBAN</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{deal.payment_swift_iban ?? deal.payment_routing_number}</span></div>}
                  {deal.payment_reference && <div className="kv-row"><span className="k">Reference</span><span className="v plain" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{deal.payment_reference}</span></div>}
                  {(deal as any).payment_info_sent_at && <div className="kv-row"><span className="k">Submitted</span><span className="v">{fmtDate((deal as any).payment_info_sent_at)}</span></div>}
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

            {/* Documents — combined AI + uploaded in one card */}
            <div className="card">
              <div className="card-head">
                Documents
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {hasAiDocs && <span style={{ color: 'var(--color-green)', fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0 }}>{aiDocs.length} AI</span>}
                  <label htmlFor="deal-doc-upload" className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', fontSize: 11 }}>
                    {uploading ? 'Uploading…' : '+ Upload'}
                  </label>
                  <input id="deal-doc-upload" type="file" style={{ display: 'none' }} onChange={handleUploadDoc} disabled={uploading} />
                </div>
              </div>
              {uploadError && <div style={{ padding: '8px 24px', fontSize: 12, color: 'var(--color-orange)', background: 'rgba(251,146,60,0.08)', borderBottom: '1px solid var(--border)' }}>{uploadError}</div>}
              {!hasAiDocs && !hasUploaded ? (
                <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>No documents attached yet.</div>
              ) : (
                <>
                  {hasAiDocs && aiDocs.map(doc => <AiDocCard key={doc.kind} doc={doc} dealId={id} />)}
                  {listingDocs.map((doc: any) => (
                    <div key={doc.id} className="doc-row">
                      <svg className="doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
                      <span className="doc-name">{doc.name}</span>
                      <span className="doc-date">{fmtDate(doc.created_at)}</span>
                      <span className="badge badge-draft" style={{ fontSize: 9, marginRight: 4 }}>Listing</span>
                      {doc.url ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a> : <span className="doc-link" style={{ color: 'var(--gray-soft)' }}>—</span>}
                    </div>
                  ))}
                  {uploadedDocs.map(doc => (
                    <div key={doc.id} className="doc-row">
                      <svg className="doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 1h6l4 4v10H4V1z"/><path d="M10 1v4h4"/></svg>
                      <span className="doc-name">{doc.name}</span>
                      <span className="doc-date">{fmtDate(doc.created_at)}</span>
                      {doc.url ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a> : <span className="doc-link" style={{ color: 'var(--gray-soft)' }}>—</span>}
                      <button onClick={() => handleDeleteDoc(doc.id)} style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-red)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Remove</button>
                    </div>
                  ))}
                  {uploadedFromDocs.map(doc => <DocumentRow key={doc.id} doc={doc} onDelete={handleDeleteDoc} />)}
                </>
              )}
            </div>

            {/* Financing request panel (org parties) */}
            {user_role !== 'bank' && (
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
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>Amount</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{fmt(financing_request.amount_requested, financing_request.currency)}</div></div>
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)' }}>Offers</div><div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{financing_request.offer_count}</div></div>
                    </div>
                  </div>
                  {(() => {
                    const financedAmount = linked_transaction?.financing_amount_approved ?? financing_request.amount_requested
                    const { requesterFee } = calcFinancingFees(financedAmount)
                    const net = calcNetDisbursement(financedAmount, requesterFee)
                    return requesterFee != null ? (
                      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--gray)' }}>
                        Strike Service Fee (0.15%): {fmt(requesterFee, financing_request.currency)} · You'll net {fmt(net, financing_request.currency)}
                      </div>
                    ) : null
                  })()}
                  <div style={{ marginTop: 16 }}><Link href={`/marketplace/financing/${financing_request.id}`} className="btn btn-ghost btn-sm">View Financing Request →</Link></div>
                </div>
              ) : showFinancingForm ? (
                <div className="card-body">
                  {finError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{finError}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="form-field">
                      <label className="field-label">Financing Type (optional)</label>
                      <select className="input form-select" value={finType} onChange={e => setFinType(e.target.value)}>
                        <option value="">No preference (open to all)</option>
                        <option value="reverse_factoring">Reverse Factoring</option>
                        <option value="invoice_factoring">Invoice Factoring</option>
                        <option value="po_financing">PO Financing</option>
                      </select>
                    </div>
                    <div className="form-field" style={{ maxWidth: 260 }}><label className="field-label">Amount Requested ({currency})</label><input className="input" type="number" min="0" required value={finAmount} onChange={e => setFinAmount(e.target.value)} /></div>
                    <div className="form-field" style={{ maxWidth: 200 }}><label className="field-label">Max Rate APR % (optional)</label><input className="input" type="number" step="0.01" min="0" value={finRateMax} onChange={e => setFinRateMax(e.target.value)} placeholder="e.g. 6.0" /></div>
                    {finType === 'reverse_factoring' && !['delivery_confirmed', 'payment_due', 'payment_overdue'].includes(deal.status) && (
                      <div className="alert alert-warn" style={{ fontSize: 12 }}>Reverse Factoring requires delivery confirmation first.</div>
                    )}
                    {finType === 'po_financing' && !['confirmed', 'in_preparation'].includes(deal.status) && (
                      <div className="alert alert-warn" style={{ fontSize: 12 }}>PO Financing must be requested before shipment.</div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-blue btn-sm" disabled={finSubmitting || !finAmount} onClick={submitFinancingRequest}>{finSubmitting ? 'Submitting…' : 'Submit Financing Request'}</button>
                      <button className="btn btn-ghost btn-sm" disabled={finSubmitting} onClick={() => { setShowFinancingForm(false); setFinError(null) }}>Cancel</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card-body">
                  <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 12 }}>Ready to unlock early payment? Submit this deal to Strike Place and receive competitive financing offers from banks.</div>
                  <button
                    className="btn btn-blue btn-sm"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => { setFinAmount(String(dealValue ?? '')); setShowFinancingForm(true) }}
                    disabled={!canFinance}
                  >
                    Request Financing
                  </button>
                </div>
              )}
            </div>
            )}
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
              <div className="card-body" style={{ textAlign: 'center', padding: '20px 24px 8px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, letterSpacing: '-0.025em', color: '#C9A84C', lineHeight: 1 }}>{fmt(dealValue, currency)}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--gray)', marginTop: 6 }}>{currency} · Goods Value</div>
                {financingContext.isActive && financingContext.structure !== 'dynamic_discounting' && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--blue)' }}>
                    Repayment: {fmt(financingContext.paymentAmount, currency)} to {financingContext.paymentRecipientName}
                  </div>
                )}
              </div>
              <div className="kv-list">
                {shippingCost != null && (
                  <div className="kv-row"><span className="k">Shipping Cost</span><span className="v">{fmt(shippingCost, currency)}</span></div>
                )}
                {user_role === 'bank' ? (
                  <>
                    <div className="kv-row"><span className="k">Strike Service Fee — Buyer (0.3%)</span><span className="v">{fmt(buyerFee, currency)}</span></div>
                    <div className="kv-row"><span className="k">Buyer Total Payable</span><span className="v" style={{ fontWeight: 700 }}>{fmt(buyerTotalDue, currency)}</span></div>
                    <div className="kv-row"><span className="k">Strike Service Fee — Supplier (0.3%)</span><span className="v">-{fmt(supplierFee, currency)}</span></div>
                    <div className="kv-row"><span className="k">Supplier Net Receivable</span><span className="v" style={{ fontWeight: 700 }}>{fmt(supplierNetReceivable, currency)}</span></div>
                  </>
                ) : user_role === 'buyer' ? (
                  <>
                    <div className="kv-row"><span className="k">Strike Service Fee (0.3%)</span><span className="v">{fmt(buyerFee, currency)}</span></div>
                    <div className="kv-row"><span className="k">Total Payable</span><span className="v" style={{ fontWeight: 700 }}>{fmt(buyerTotalDue, currency)}</span></div>
                  </>
                ) : (
                  <>
                    <div className="kv-row"><span className="k">Strike Service Fee (0.3%)</span><span className="v">-{fmt(supplierFee, currency)}</span></div>
                    <div className="kv-row"><span className="k">Net Receivable</span><span className="v" style={{ fontWeight: 700 }}>{fmt(supplierNetReceivable, currency)}</span></div>
                  </>
                )}
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

            {/* Counterparty confirmation (imported deals) */}
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
