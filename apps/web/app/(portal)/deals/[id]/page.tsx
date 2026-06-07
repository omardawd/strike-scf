'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { useUser } from '@/lib/user-context'
import type { Deal, Organization, Room, FinancingRequest, FinancingStructure, FinancingType } from '@strike-scf/types'

interface DealDoc {
  id: string
  name: string
  document_kind: string
  mime_type: string
  created_at: string
}

interface AiDoc {
  kind: 'ai_po' | 'ai_invoice' | 'ai_contract'
  content: string
  generated_at: string | null
}

interface UploadedDoc {
  id: string
  kind: string
  name: string
  url: string | null
  created_at: string
}

interface DealDetail {
  deal: Deal & { agreed_price?: number }
  buyer_org: Organization | null
  supplier_org: Organization | null
  room: { id: string; name: string } | null
  financing_request: FinancingRequest | null
  documents: DealDoc[]
  user_role: 'buyer' | 'supplier'
}

const AI_DOC_LABELS: Record<string, string> = {
  ai_po:       'PURCHASE ORDER',
  ai_invoice:  'COMMERCIAL INVOICE',
  ai_contract: 'TRADE AGREEMENT',
}

const DEAL_STATUSES: { key: string; label: string }[] = [
  { key: 'negotiating',         label: 'Negotiating' },
  { key: 'agreed',              label: 'Agreed' },
  { key: 'documents_pending',   label: 'Documents Pending' },
  { key: 'active',              label: 'Active' },
  { key: 'financing_requested', label: 'Financing Requested' },
  { key: 'financing_active',    label: 'Financing Active' },
  { key: 'completed',           label: 'Completed' },
]

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'negotiating':         return 'badge badge-draft'
    case 'agreed':              return 'badge badge-signing'
    case 'documents_pending':   return 'badge badge-pending'
    case 'active':              return 'badge badge-active'
    case 'financing_requested': return 'badge badge-offer'
    case 'financing_active':    return 'badge badge-funded'
    case 'completed':           return 'badge badge-completed'
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

function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

function DealTimeline({ status }: { status: string }) {
  const currentIdx = DEAL_STATUSES.findIndex(s => s.key === status)
  return (
    <div className="deal-timeline">
      {DEAL_STATUSES.map((s, i) => {
        const isPast    = i < currentIdx
        const isCurrent = i === currentIdx
        const isFuture  = i > currentIdx
        return (
          <div key={s.key} className="deal-tl-item">
            <div className="deal-tl-rail">
              <div
                className={
                  isCurrent ? 'deal-tl-dot deal-tl-dot-current' :
                  isPast    ? 'deal-tl-dot deal-tl-dot-green' :
                              'deal-tl-dot deal-tl-dot-gray'
                }
              />
              <div className="deal-tl-line" />
            </div>
            <div className="deal-tl-body">
              <div
                className="deal-tl-event"
                style={{ color: isFuture ? 'var(--gray-soft)' : 'var(--ink)', fontWeight: isCurrent ? 500 : 400 }}
              >
                {s.label}
              </div>
              {isCurrent && (
                <div className="deal-tl-actor" style={{ color: 'var(--color-green)', fontSize: 11 }}>
                  Current status
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DocumentRow({ doc }: { doc: DealDoc }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/documents/${doc.id}/url`)
      .then(r => r.json())
      .then(d => { if (d.url) setUrl(d.url) })
      .catch(() => {})
  }, [doc.id])

  return (
    <div className="doc-row">
      <svg className="doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 1h6l4 4v10H4V1z" /><path d="M10 1v4h4" />
      </svg>
      <span className="doc-name">{doc.name}</span>
      <span className="doc-date">{fmtDate(doc.created_at)}</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a>
      ) : (
        <span className="doc-link" style={{ color: 'var(--gray-soft)' }}>—</span>
      )}
    </div>
  )
}

function AiDocCard({ doc }: { doc: AiDoc }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const label = AI_DOC_LABELS[doc.kind] ?? doc.kind.toUpperCase()

  function downloadTxt() {
    const blob = new Blob([doc.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${label.toLowerCase().replace(/ /g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(doc.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div
        className="card-head"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{label}</span>
          <span className="badge badge-active" style={{ fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>
            AI Generated
          </span>
          {doc.generated_at && (
            <span style={{ fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0, color: 'var(--gray)', fontSize: 11 }}>
              {fmtDate(doc.generated_at)}
            </span>
          )}
        </div>
        <svg
          width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s' }}
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {expanded && (
        <>
          <div style={{ padding: '0 24px' }}>
            <pre style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              lineHeight: 1.65,
              color: 'var(--ink)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 400,
              overflowY: 'auto',
              margin: '16px 0',
              background: 'var(--offwhite)',
              border: '1px solid var(--border)',
              padding: '16px',
            }}>
              {doc.content}
            </pre>
          </div>
          <div style={{ padding: '0 24px 16px', display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={downloadTxt}>Download .txt</button>
            <button className="btn btn-secondary btn-sm" onClick={copyText}>
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function DealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const user = useUser()
  const id = params?.id as string

  const [data, setData] = useState<DealDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const [showFinancingForm,  setShowFinancingForm]  = useState(false)
  const [finStructure,       setFinStructure]        = useState<FinancingStructure>('open')
  const [finType,            setFinType]             = useState<FinancingType | ''>('')
  const [finAmount,          setFinAmount]           = useState('')
  const [finTenor,           setFinTenor]            = useState('90')
  const [finRateMax,         setFinRateMax]          = useState('')
  const [finSubmitting,      setFinSubmitting]       = useState(false)
  const [finError,           setFinError]            = useState<string | null>(null)

  const [alreadyReviewed, setAlreadyReviewed] = useState(false)

  const [aiDocs, setAiDocs] = useState<AiDoc[]>([])
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  const generateTriggered = useRef(false)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/deals/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError('Failed to load deal'))
      .finally(() => setLoading(false))
  }, [id])

  const loadDocs = useCallback(() => {
    fetch(`/api/deals/${id}/documents`)
      .then(r => r.json())
      .then(d => {
        if (!d.error) {
          setAiDocs(d.ai_documents ?? [])
          setUploadedDocs(d.uploaded_documents ?? [])
        }
      })
      .catch(() => {})
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!data || data.deal.status !== 'completed') return
    fetch(`/api/passport/reviews/check?deal_id=${id}`)
      .then(r => r.json())
      .then(d => { if (d.already_reviewed) setAlreadyReviewed(true) })
      .catch(() => {})
  }, [data, id])

  useEffect(() => {
    if (!data) return
    const deal = data.deal

    if (deal.status === 'agreed' && deal.documents_generated_at) {
      loadDocs()
      return
    }

    if (deal.status === 'agreed' && !deal.documents_generated_at) {
      if (!generateTriggered.current) {
        generateTriggered.current = true
        setDocsLoading(true)
        fetch(`/api/deals/${id}/generate-documents`, { method: 'POST' })
          .catch(() => {})
      }

      if (!pollInterval.current) {
        pollInterval.current = setInterval(() => {
          fetch(`/api/deals/${id}`)
            .then(r => r.json())
            .then(d => {
              if (d.deal?.documents_generated_at) {
                clearInterval(pollInterval.current!)
                pollInterval.current = null
                setDocsLoading(false)
                setData(d)
                loadDocs()
              }
            })
            .catch(() => {})
        }, 3000)
      }
    } else if (aiDocs.length === 0 && uploadedDocs.length === 0) {
      loadDocs()
    }

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current)
        pollInterval.current = null
      }
    }
  }, [data, id, loadDocs, aiDocs.length, uploadedDocs.length])

  async function submitFinancingRequest() {
    if (!data) return
    setFinSubmitting(true)
    setFinError(null)
    try {
      const res = await fetch('/api/marketplace/financing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id:             id,
          structure_type:      finStructure,
          financing_type:      finType || undefined,
          amount_requested:    parseFloat(finAmount),
          preferred_tenor_days: finTenor ? parseInt(finTenor) : undefined,
          preferred_rate_max:  finRateMax ? parseFloat(finRateMax) : undefined,
          currency:            data.deal.agreed_currency ?? 'USD',
        }),
      })
      const json = await res.json()
      if (!res.ok) { setFinError(json.error ?? 'Submission failed'); return }
      setShowFinancingForm(false)
      router.push(`/marketplace/financing/${json.financing_request.id}`)
    } finally {
      setFinSubmitting(false)
    }
  }

  async function transitionStatus(newStatus: string) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? 'Action failed'); return }
      load()
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <>
        <Topbar crumbs={[{ label: 'My Deals', onClick: () => router.push('/deals') }, { label: 'Loading…' }]} />
        <div className="page" style={{ maxWidth: 1280 }}>
          <div style={{ display: 'flex', gap: 20 }}>
            {[0, 1].map(i => (
              <div key={i} className="card" style={{ flex: i === 0 ? 1 : '0 0 340px', height: 400, animation: 'skeleton-pulse 1.8s ease infinite' }} />
            ))}
          </div>
        </div>
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        <Topbar crumbs={[{ label: 'My Deals', onClick: () => router.push('/deals') }, { label: 'Error' }]} />
        <div className="page" style={{ maxWidth: 1280 }}>
          <div className="alert alert-error">{error ?? 'Deal not found'}</div>
        </div>
      </>
    )
  }

  const { deal, buyer_org, supplier_org, room, financing_request, documents, user_role } = data
  const counterparty = user_role === 'buyer' ? supplier_org : buyer_org
  const dealValue = deal.total_value ?? deal.agreed_price ?? null
  const currency = deal.agreed_currency ?? 'USD'

  const isGenerating = deal.status === 'agreed' && !deal.documents_generated_at && docsLoading
  const hasAiDocs    = aiDocs.length > 0
  const hasUploaded  = uploadedDocs.length > 0 || documents.filter(d => !['ai_po','ai_invoice','ai_contract'].includes(d.document_kind)).length > 0

  // Quick action for this status + role
  function QuickActions() {
    if (actionLoading) {
      return <button className="btn btn-secondary btn-full" disabled>Loading…</button>
    }
    if (deal.status === 'agreed' && user_role === 'buyer') {
      return (
        <button
          className="btn btn-primary btn-full"
          onClick={() => transitionStatus('active')}
        >
          Confirm Goods Received
        </button>
      )
    }
    if (['agreed', 'active'].includes(deal.status) && !deal.financing_requested) {
      return (
        <button
          className="btn btn-blue btn-full"
          onClick={() => {
            setFinAmount(String(dealValue ?? ''))
            setShowFinancingForm(true)
          }}
        >
          Request Financing
        </button>
      )
    }
    if (deal.status === 'completed' && !alreadyReviewed && counterparty) {
      return (
        <Link
          href={`/passport/review/${counterparty.id}`}
          className="btn btn-ghost btn-full"
          style={{ display: 'inline-flex', justifyContent: 'center' }}
        >
          Leave a Review
        </Link>
      )
    }
    return null
  }

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'My Deals', onClick: () => router.push('/deals') },
          { label: `Deal #${shortId(deal.id)}` },
        ]}
        actions={
          <div className="topbar-right">
            {room && (
              <Link href={`/rooms/${room.id}`} className="btn btn-ghost btn-sm">
                Open Deal Room →
              </Link>
            )}
          </div>
        }
      />

      <div className="page" style={{ maxWidth: 1280 }}>
        {/* Deal header */}
        <div className="page-header" style={{ marginBottom: 24 }}>
          <div className="page-id-title">
            <span className="id-text">Deal #{shortId(deal.id)}</span>
            <span className={statusBadgeClass(deal.status)}>{deal.status.replace(/_/g, ' ')}</span>
            <span className={sourceBadgeClass(deal.deal_source)}>{deal.deal_source}</span>
          </div>
          <p className="subtitle" style={{ marginTop: 4 }}>
            {user_role === 'buyer' ? 'You are the buyer' : 'You are the supplier'} on this deal
            {counterparty && ` with ${counterparty.legal_name}`}
          </p>
        </div>

        <div className="split-panel">
          {/* ── Main panel ── */}
          <div className="split-panel-main">

            {/* Timeline */}
            <div className="card">
              <div className="card-head">Deal Progress</div>
              <div className="card-body" style={{ padding: '20px 24px' }}>
                <DealTimeline status={deal.status} />
              </div>
            </div>

            {/* Agreed Terms */}
            <div className="card">
              <div className="card-head">Agreed Terms</div>
              <div className="kv-list">
                <div className="kv-row">
                  <span className="k">Goods</span>
                  <span className="v plain">{deal.goods_description ?? '—'}</span>
                </div>
                {deal.agreed_quantity != null && (
                  <div className="kv-row">
                    <span className="k">Quantity</span>
                    <span className="v">{deal.agreed_quantity} {deal.agreed_unit ?? ''}</span>
                  </div>
                )}
                <div className="kv-row">
                  <span className="k">Price</span>
                  <span className="v">{fmt(deal.agreed_price, currency)}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Currency</span>
                  <span className="v">{currency}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Delivery Date</span>
                  <span className="v">{fmtDate(deal.agreed_delivery_date)}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Incoterms</span>
                  <span className="v">{deal.agreed_incoterms ?? '—'}</span>
                </div>
                <div className="kv-row">
                  <span className="k">Payment Terms</span>
                  <span className="v plain">{deal.agreed_payment_terms ?? '—'}</span>
                </div>
                {deal.import_notes && (
                  <div className="kv-row">
                    <span className="k">Notes</span>
                    <span className="v plain" style={{ fontSize: 12 }}>{deal.import_notes}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Documents */}
            <div>
              <div className="card" style={{ marginBottom: hasAiDocs ? 0 : 0 }}>
                <div className="card-head">
                  Documents
                  {hasAiDocs && (
                    <span style={{ color: 'var(--color-green)', fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 0 }}>
                      {aiDocs.length} AI doc{aiDocs.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {isGenerating ? (
                  <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--blue)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    <span style={{ fontSize: 13, color: 'var(--gray)' }}>Strike AI is drafting your documents…</span>
                  </div>
                ) : !hasAiDocs && !hasUploaded ? (
                  <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: 'var(--gray)' }}>
                    No documents attached yet.
                  </div>
                ) : null}
              </div>

              {hasAiDocs && (
                <div style={{ marginTop: 12 }}>
                  {aiDocs.map(doc => <AiDocCard key={doc.kind} doc={doc} />)}
                </div>
              )}

              {hasUploaded && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card-head">Uploaded Documents</div>
                  {uploadedDocs.map(doc => (
                    <div key={doc.id} className="doc-row">
                      <svg className="doc-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 1h6l4 4v10H4V1z" /><path d="M10 1v4h4" />
                      </svg>
                      <span className="doc-name">{doc.name}</span>
                      <span className="doc-date">{fmtDate(doc.created_at)}</span>
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a>
                      ) : (
                        <span className="doc-link" style={{ color: 'var(--gray-soft)' }}>—</span>
                      )}
                    </div>
                  ))}
                  {documents
                    .filter(d => !['ai_po','ai_invoice','ai_contract'].includes(d.document_kind))
                    .map(doc => <DocumentRow key={doc.id} doc={doc} />)
                  }
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`badge ${financing_request.status === 'funded' ? 'badge-funded' : financing_request.status === 'open' || financing_request.status === 'offers_received' ? 'badge-active' : 'badge-draft'}`}>
                          {financing_request.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 24 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)' }}>Amount</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
                          {fmt(financing_request.amount_requested, financing_request.currency)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)' }}>Offers</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
                          {financing_request.offer_count}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <Link href={`/marketplace/financing/${financing_request.id}`} className="btn btn-ghost btn-sm">
                      View Financing Request →
                    </Link>
                  </div>
                </div>
              ) : showFinancingForm ? (
                <div className="card-body">
                  {finError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{finError}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="form-row-2">
                      <div className="form-field">
                        <label className="field-label">Structure Type</label>
                        <select
                          className="input form-select"
                          value={finStructure}
                          onChange={e => setFinStructure(e.target.value as FinancingStructure)}
                        >
                          <option value="open">Open (any structure)</option>
                          <option value="preset">Preset</option>
                          <option value="custom">Custom</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label className="field-label">Financing Type (optional)</label>
                        <select
                          className="input form-select"
                          value={finType}
                          onChange={e => setFinType(e.target.value as FinancingType | '')}
                        >
                          <option value="">No preference</option>
                          <option value="reverse_factoring">Reverse Factoring</option>
                          <option value="invoice_factoring">Invoice Factoring</option>
                          <option value="po_financing">PO Financing</option>
                          <option value="dynamic_discounting">Dynamic Discounting</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-row-2">
                      <div className="form-field">
                        <label className="field-label">Amount Requested ({currency})</label>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          required
                          value={finAmount}
                          onChange={e => setFinAmount(e.target.value)}
                        />
                      </div>
                      <div className="form-field">
                        <label className="field-label">Preferred Tenor (days)</label>
                        <input
                          className="input"
                          type="number"
                          min="1"
                          value={finTenor}
                          onChange={e => setFinTenor(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-field" style={{ maxWidth: 200 }}>
                      <label className="field-label">Max Rate APR % (optional)</label>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        min="0"
                        value={finRateMax}
                        onChange={e => setFinRateMax(e.target.value)}
                        placeholder="e.g. 6.0"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-blue btn-sm"
                        disabled={finSubmitting || !finAmount}
                        onClick={submitFinancingRequest}
                      >
                        {finSubmitting ? 'Posting to Marketplace…' : 'Post to Marketplace'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={finSubmitting}
                        onClick={() => { setShowFinancingForm(false); setFinError(null) }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6 }}>
                      Ready to unlock early payment? Post this deal to the financing marketplace and receive competitive offers from banks.
                    </div>
                    <button
                      className="btn btn-blue btn-sm"
                      style={{ alignSelf: 'flex-start' }}
                      onClick={() => {
                        setFinAmount(String(dealValue ?? ''))
                        setShowFinancingForm(true)
                      }}
                      disabled={!['agreed', 'active'].includes(deal.status) || deal.financing_requested}
                    >
                      Request Financing
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* ── Aside panel ── */}
          <div className="split-panel-aside">

            {/* Counterparty passport */}
            {counterparty && (
              <div className="card">
                <div className="card-head">Counterparty</div>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingBottom: 20 }}>
                  <PassportScoreRing score={counterparty.passport_score} size="md" showLabel />
                  <div style={{ width: '100%' }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 4, textAlign: 'center' }}>
                      {counterparty.legal_name}
                    </div>
                    <div style={{ textAlign: 'center', marginBottom: 12 }}>
                      <span className="badge badge-draft" style={{ fontSize: 9 }}>{counterparty.type}</span>
                    </div>
                    <div className="kv-list">
                      {counterparty.avg_payment_days != null && (
                        <div className="kv-row" style={{ padding: '8px 16px' }}>
                          <span className="k" style={{ fontSize: 10 }}>Avg Payment Days</span>
                          <span className="v">{counterparty.avg_payment_days}d</span>
                        </div>
                      )}
                      {counterparty.trade_count_total > 0 && (
                        <div className="kv-row" style={{ padding: '8px 16px' }}>
                          <span className="k" style={{ fontSize: 10 }}>Total Trades</span>
                          <span className="v">{counterparty.trade_count_total}</span>
                        </div>
                      )}
                      {counterparty.dispute_rate_network != null && (
                        <div className="kv-row" style={{ padding: '8px 16px' }}>
                          <span className="k" style={{ fontSize: 10 }}>Dispute Rate</span>
                          <span className="v">{(counterparty.dispute_rate_network * 100).toFixed(1)}%</span>
                        </div>
                      )}
                      {counterparty.country && (
                        <div className="kv-row" style={{ padding: '8px 16px' }}>
                          <span className="k" style={{ fontSize: 10 }}>Country</span>
                          <span className="v plain">{counterparty.country}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/passport/${counterparty.id}`}
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    View Passport
                  </Link>
                </div>
              </div>
            )}

            {/* Deal value */}
            <div className="card">
              <div className="card-head">Deal Value</div>
              <div className="card-body" style={{ textAlign: 'center', padding: '20px 24px' }}>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                  color: '#C9A84C',
                  lineHeight: 1,
                }}>
                  {fmt(dealValue, currency)}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', marginTop: 6 }}>
                  {currency}
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="card">
              <div className="card-head">Actions</div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <QuickActions />
                {room && (
                  <Link
                    href={`/rooms/${room.id}`}
                    className="btn btn-secondary btn-full"
                    style={{ justifyContent: 'center' }}
                  >
                    Open Deal Room →
                  </Link>
                )}
                {!['completed', 'cancelled', 'disputed'].includes(deal.status) && !cancelConfirm && (
                  <button
                    className="btn btn-danger btn-sm btn-full"
                    style={{ justifyContent: 'center', marginTop: 8 }}
                    onClick={() => setCancelConfirm(true)}
                    disabled={actionLoading}
                  >
                    Cancel Deal
                  </button>
                )}
                {!['completed', 'cancelled', 'disputed'].includes(deal.status) && cancelConfirm && (
                  <div style={{ marginTop: 8, border: '1px solid var(--color-red)', background: 'rgba(220,38,38,0.04)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <p style={{ fontSize: 12, color: 'var(--ink)', margin: 0, lineHeight: 1.5 }}>
                      Are you sure? This cannot be undone.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-danger btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => { setCancelConfirm(false); transitionStatus('cancelled') }}
                        disabled={actionLoading}
                      >
                        Confirm Cancel
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => setCancelConfirm(false)}
                        disabled={actionLoading}
                      >
                        Keep Deal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Counterparty confirmation status */}
            {deal.deal_source === 'imported' && (
              <div className={`alert ${deal.counterparty_confirmed ? 'alert-info' : 'alert-warn'}`} style={{ fontSize: 12 }}>
                <span className="alert-icon">
                  {deal.counterparty_confirmed ? '✓' : '⏳'}
                </span>
                <span className="alert-body">
                  {deal.counterparty_confirmed
                    ? 'Counterparty has confirmed this deal.'
                    : 'Awaiting counterparty confirmation.'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}
