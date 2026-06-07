'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { pushTransactionDetail, pushTransactionNew } from '@/lib/transaction-referrer'
import { PortalShell, Topbar, Icon, NotifBell } from '@/components/portal-shell'
import { AIInsightCard } from '@/components/ai-insight-card'

interface Transaction {
  id: string
  status: string
  financing_type: string | null
  invoice_amount: number | null
  financing_amount_requested: number | null
  financing_amount_approved: number | null
  supplier_name: string | null
  anchor_name: string | null
  bank_name: string | null
  program_name: string | null
  created_at: string
}

type FilterKey = 'all' | 'pending' | 'approved' | 'funded' | 'rejected'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'funded',   label: 'Funded' },
  { key: 'rejected', label: 'Rejected' },
]

function matchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === 'all') return true
  if (filter === 'pending') return ['pending_anchor_approval', 'pending_bank_review', 'more_info_requested'].includes(status)
  if (filter === 'approved') return status === 'financing_approved'
  if (filter === 'funded') return status === 'funded' || status === 'completed'
  if (filter === 'rejected') return status === 'rejected'
  return false
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pending_anchor_approval': return 'badge-pending'
    case 'pending_bank_review':     return 'badge-active'
    case 'more_info_requested':     return 'badge-pending'
    case 'financing_approved':      return 'badge-funded'
    case 'funded':                  return 'badge-funded'
    case 'completed':               return 'badge-completed'
    case 'rejected':                return 'badge-rejected'
    default:                        return 'badge-draft'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending_anchor_approval': return 'Pending Approval'
    case 'pending_bank_review':     return 'Pending Bank Review'
    case 'more_info_requested':     return 'More Info Needed'
    case 'financing_approved':      return 'Approved'
    case 'funded':                  return 'Funded'
    case 'completed':               return 'Completed'
    case 'rejected':                return 'Rejected'
    default:                        return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

function fmtAmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString()
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortId(id: string): string {
  if (id.startsWith('STK-') || id.length < 20) return id
  return id.slice(0, 8).toUpperCase()
}

export default function TransactionsPage() {
  const portal = usePortal()
  const router = useRouter()
  const [txns, setTxns] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  useEffect(() => {
    fetch('/api/transactions')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        setTxns(data.transactions ?? [])
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const visible = txns.filter(t => matchesFilter(t.status, filter))

  function counterparty(t: Transaction): string {
    if (portal === 'supplier') return t.anchor_name ?? '—'
    if (portal === 'anchor')   return t.supplier_name ?? '—'
    const parts = [t.supplier_name, t.anchor_name].filter(Boolean)
    return parts.length > 0 ? parts.join(' → ') : '—'
  }

  return (
    <PortalShell activeSection="transactions">
      <Topbar
        crumbs={[{ label: 'Transactions' }]}
        actions={
          <>
            <NotifBell />
            {portal === 'supplier' && (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => pushTransactionNew(router)}
              >
                <Icon name="plus" size={14} /> New Transaction
              </button>
            )}
          </>
        }
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title">Transactions</h1>
          {!loading && !error && (
            <div className="subtitle">
              {txns.length} transaction{txns.length !== 1 ? 's' : ''}
              {txns.length > 0 && (
                <>
                  {' '}·{' '}
                  {txns.filter(t => matchesFilter(t.status, 'pending')).length} pending
                </>
              )}
            </div>
          )}
        </div>

        {!loading && !error && txns.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <AIInsightCard
              variant="banner"
              portal={portal}
              page="transactions"
              context={{
                transactionCount: txns.length,
                pendingCount: txns.filter(t => t.status.includes('pending')).length,
                totalValue: txns.reduce((s, t) => s + (t.invoice_amount ?? 0), 0),
              }}
            />
          </div>
        )}

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {FILTERS.map(f => {
            const cnt = f.key === 'all' ? txns.length : txns.filter(t => matchesFilter(t.status, f.key)).length
            return (
              <button
                key={f.key}
                type="button"
                className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {cnt > 0 && (
                  <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.65 }}>
                    ({cnt})
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">Failed to load transactions: {error}</div>
          </div>
        )}

        {loading ? (
          <div className="card">
            <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', opacity: 0.6 }}>
              Loading transactions…
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="card">
            <div className="card-body" style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ color: 'var(--gray)', marginBottom: 12 }}>
                <Icon name="invoice" size={32} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
                {filter !== 'all' ? `No ${filter} transactions` : 'No transactions yet'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 20 }}>
                {portal === 'supplier'
                  ? 'Submit your first invoice to get started'
                  : 'Transactions will appear here'}
              </div>
              {portal === 'supplier' && filter === 'all' && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => pushTransactionNew(router)}
                >
                  <Icon name="plus" size={14} /> New Transaction
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>
                    {portal === 'bank' ? 'Supplier · Anchor' : portal === 'supplier' ? 'Anchor' : 'Supplier'}
                  </th>
                  <th className="amount">Invoice Amount</th>
                  <th className="amount">Financing Req.</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="row-actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map(t => (
                  <tr
                    key={t.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => pushTransactionDetail(router, t.id)}
                  >
                    <td className="strike-id">{shortId(t.id)}</td>
                    <td style={{ color: 'var(--ink)' }}>{counterparty(t)}</td>
                    <td className="amount">{fmtAmt(t.invoice_amount)}</td>
                    <td className="amount">{fmtAmt(t.financing_amount_requested)}</td>
                    <td>
                      <span className={`badge ${statusBadge(t.status)}`}>
                        {statusLabel(t.status)}
                      </span>
                    </td>
                    <td className="mono">{fmtDate(t.created_at)}</td>
                    <td className="row-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={e => { e.stopPropagation(); pushTransactionDetail(router, t.id) }}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PortalShell>
  )
}
