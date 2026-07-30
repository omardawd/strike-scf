'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { pushTransactionDetail, pushTransactionNew } from '@/lib/transaction-referrer'
import { PortalShell, Topbar, Icon, NotifBell } from '@/components/portal-shell'
import { AIInsightCard } from '@/components/ai-insight-card'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

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

function filters(t: TFn): { key: FilterKey; label: string }[] {
  return [
    { key: 'all',      label: t('common.all') },
    { key: 'pending',  label: t('transactionsPage.pending') },
    { key: 'approved', label: t('transactionsPage.approved') },
    { key: 'funded',   label: t('transactionsPage.funded') },
    { key: 'rejected', label: t('transactionsPage.rejected') },
  ]
}

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

function statusLabel(status: string, t: TFn): string {
  switch (status) {
    case 'pending_anchor_approval': return t('transactionsPage.pendingApproval')
    case 'pending_bank_review':     return t('transactionsPage.pendingBankReview')
    case 'more_info_requested':     return t('transactionsPage.moreInfoNeeded')
    case 'financing_approved':      return t('transactionsPage.approved')
    case 'funded':                  return t('transactionsPage.funded')
    case 'completed':               return t('deals.status.completed')
    case 'rejected':                return t('transactionsPage.rejected')
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
  const t = useT()
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

  const visible = txns.filter(tx => matchesFilter(tx.status, filter))

  function counterparty(txn: Transaction): string {
    if (portal === 'supplier') return txn.anchor_name ?? '—'
    if (portal === 'anchor')   return txn.supplier_name ?? '—'
    const parts = [txn.supplier_name, txn.anchor_name].filter(Boolean)
    return parts.length > 0 ? parts.join(' → ') : '—'
  }

  return (
    <PortalShell activeSection="transactions">
      <Topbar
        crumbs={[{ label: t('transactionsPage.title') }]}
        actions={
          <>
            <NotifBell />
            {portal === 'supplier' && (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => pushTransactionNew(router)}
              >
                <Icon name="plus" size={14} /> {t('transactionsPage.newTransaction')}
              </button>
            )}
          </>
        }
      />

      <div className="page" data-page-name="Transactions" data-ai-context={JSON.stringify({ role: portal, total: txns.length, pending: txns.filter(tx => matchesFilter(tx.status, 'pending')).length, approved: txns.filter(tx => matchesFilter(tx.status, 'approved')).length, funded: txns.filter(tx => matchesFilter(tx.status, 'funded')).length, rejected: txns.filter(tx => matchesFilter(tx.status, 'rejected')).length, active_filter: filter })}>
        <div className="page-header">
          <h1 className="t-page-title">{t('transactionsPage.title')}</h1>
          {!loading && !error && (
            <div className="subtitle">
              {txns.length === 1 ? t('transactionsPage.oneTransaction') : t('transactionsPage.nTransactions', { count: txns.length })}
              {txns.length > 0 && (
                <>
                  {' '}·{' '}
                  {t('transactionsPage.nPending', { count: txns.filter(tx => matchesFilter(tx.status, 'pending')).length })}
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
                pendingCount: txns.filter(tx => tx.status.includes('pending')).length,
                totalValue: txns.reduce((s, tx) => s + (tx.invoice_amount ?? 0), 0),
              }}
            />
          </div>
        )}

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {filters(t).map(f => {
            const cnt = f.key === 'all' ? txns.length : txns.filter(tx => matchesFilter(tx.status, f.key)).length
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
            <div className="alert-body">{t('transactionsPage.failedToLoad', { error })}</div>
          </div>
        )}

        {loading ? (
          <div className="card">
            <div className="card-body" style={{ padding: 32, textAlign: 'center', color: 'var(--gray)', opacity: 0.6 }}>
              {t('transactionsPage.loadingTransactions')}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="card">
            <div className="card-body" style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ color: 'var(--gray)', marginBottom: 12 }}>
                <Icon name="invoice" size={32} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', marginBottom: 6 }}>
                {filter !== 'all' ? t('transactionsPage.noFilteredTransactions', { filter: filters(t).find(f => f.key === filter)?.label ?? filter }) : t('transactionsPage.noTransactionsYet')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 20 }}>
                {portal === 'supplier'
                  ? t('transactionsPage.submitFirstInvoice')
                  : t('transactionsPage.willAppearHere')}
              </div>
              {portal === 'supplier' && filter === 'all' && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => pushTransactionNew(router)}
                >
                  <Icon name="plus" size={14} /> {t('transactionsPage.newTransaction')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('transactionsPage.transactionId')}</th>
                  <th>
                    {portal === 'bank' ? t('transactionsPage.supplierAnchor') : portal === 'supplier' ? t('transactionsPage.anchor') : t('transactionsPage.supplier')}
                  </th>
                  <th className="amount">{t('transactionsPage.invoiceAmount')}</th>
                  <th className="amount">{t('transactionsPage.financingReq')}</th>
                  <th>{t('deals.col.status')}</th>
                  <th>{t('transactionsPage.created')}</th>
                  <th className="row-actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map(txn => (
                  <tr
                    key={txn.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => pushTransactionDetail(router, txn.id)}
                  >
                    <td className="strike-id">{shortId(txn.id)}</td>
                    <td style={{ color: 'var(--ink)' }}>{counterparty(txn)}</td>
                    <td className="amount">{fmtAmt(txn.invoice_amount)}</td>
                    <td className="amount">{fmtAmt(txn.financing_amount_requested)}</td>
                    <td>
                      <span className={`badge ${statusBadge(txn.status)}`}>
                        {statusLabel(txn.status, t)}
                      </span>
                    </td>
                    <td className="mono">{fmtDate(txn.created_at)}</td>
                    <td className="row-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={e => { e.stopPropagation(); pushTransactionDetail(router, txn.id) }}
                      >
                        {t('financing.viewArrow')}
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
