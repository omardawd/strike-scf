'use client'
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/portal-shell'
import { PassportScoreRing } from '@/components/passport-score-ring'
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'
import { createClient } from '@/lib/supabase/client'
import { CreateProgramFlow } from '@/components/create-program-flow'
import type { FinancingRequest } from '@strike-scf/types'

// ── Types ──────────────────────────────────────────────────────────────────────
interface OrgPassport {
  id: string
  legal_name: string
  passport_score: number | null
  risk_tier: string | null
  trade_count_total: number
  avg_payment_days: number | null
  dispute_rate_network: number | null
  country_of_origin?: string | null
}

interface DealSummary {
  id: string
  agreed_price: number
  agreed_currency: string
  goods_description: string | null
  agreed_delivery_date: string | null
  agreed_incoterms: string | null
  total_value?: number | null
}

interface BankRequestItem {
  request:           FinancingRequest
  deal:              DealSummary | null
  buyer_passport:    OrgPassport | null
  supplier_passport: OrgPassport | null
  my_offer:          any | null
  all_offers_count:  number
}

interface OrgRequestItem extends FinancingRequest {
  deal: DealSummary | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtCompact(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--gray)'
  if (score >= 70) return 'var(--color-green)'
  if (score >= 45) return 'var(--color-amber)'
  return 'var(--color-red)'
}

function scoreBg(score: number | null | undefined): string {
  if (score == null) return 'var(--offwhite)'
  if (score >= 70) return 'var(--color-green-bg)'
  if (score >= 45) return 'var(--color-amber-bg)'
  return 'var(--color-red-bg, var(--color-danger-bg))'
}

// Type code + badge class for RF / IF / PO / DD / Custom / Open
function typeMeta(req: FinancingRequest): { code: string; cls: string; label: string } {
  const ft = req.financing_type
  if (ft === 'reverse_factoring')  return { code: 'RF', cls: 't-rf',  label: 'Reverse Factoring' }
  if (ft === 'invoice_factoring')  return { code: 'IF', cls: 't-if',  label: 'Invoice Factoring' }
  if (ft === 'po_financing')       return { code: 'PO', cls: 't-po',  label: 'PO Financing' }
  if (ft === 'dynamic_discounting') return { code: 'DD', cls: 't-dd', label: 'Dynamic Discounting' }
  // fall back to structure type
  if (req.structure_type === 'custom') return { code: 'CUS', cls: 't-custom', label: 'Custom' }
  return { code: 'OPN', cls: 't-open', label: 'Open' }
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'open':            return 'var(--color-green)'
    case 'offers_received': return 'var(--blue)'
    case 'accepted':        return 'var(--color-purple)'
    case 'funded':          return 'var(--color-green)'
    default:                return 'var(--gray-soft)'
  }
}

const TYPE_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'reverse_factoring', label: 'RF · Reverse Factoring' },
  { value: 'invoice_factoring', label: 'IF · Invoice Factoring' },
  { value: 'po_financing', label: 'PO · PO Financing' },
  { value: 'dynamic_discounting', label: 'DD · Dynamic Discounting' },
  { value: 'custom', label: 'Custom' },
  { value: 'open', label: 'Open' },
]

type SortKey = 'posted' | 'amount' | 'tenor' | 'rate' | 'score'
type SortDir = 'asc' | 'desc'

// ── Trading terminal (BANK) ──────────────────────────────────────────────────────
function TradingTerminal({
  items,
  newIds,
  onClearNew,
  onRefresh,
}: {
  items: BankRequestItem[]
  newIds: Set<string>
  onClearNew: (id: string) => void
  onRefresh: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const user = useUser()

  // Filters (pre-filled from query string for TC.4 program → Strike Place linkage)
  const [fType, setFType]       = useState(searchParams.get('type') ?? '')
  const [fCurrency, setFCurrency] = useState(searchParams.get('currency') ?? '')
  const [fMinAmt, setFMinAmt]   = useState('')
  const [fMaxAmt, setFMaxAmt]   = useState('')
  const [fGeo, setFGeo]         = useState('')
  const [fScore, setFScore]     = useState('')
  const [fSince, setFSince]     = useState('')
  const [sortKey, setSortKey]   = useState<SortKey>('posted')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Create-program mid-flow state (TC.5)
  const [cpOpen, setCpOpen]     = useState(false)
  const [cpSeed, setCpSeed]     = useState<{ financingType: string; currency: string } | null>(null)

  // Programs this bank already has (for mismatch detection) — loaded once
  const [programs, setPrograms] = useState<Array<{ id: string; name: string; financing_types: string[]; currency: string; status: string }>>([])
  useEffect(() => {
    fetch('/api/programs')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.programs) setPrograms(d.programs) })
      .catch(() => {})
  }, [])

  const selected = useMemo(
    () => items.find(i => i.request.id === selectedId) ?? null,
    [items, selectedId]
  )

  // Auto-select first row once data lands (keeps the panel populated)
  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0]!.request.id)
  }, [items, selectedId])

  // Build geography option list from data
  const geoOptions = useMemo(() => {
    const set = new Set<string>()
    for (const i of items) {
      const g = i.supplier_passport?.country_of_origin ?? i.buyer_passport?.country_of_origin
      if (g) set.add(g)
    }
    return [...set].sort()
  }, [items])

  function reqGeo(i: BankRequestItem): string | null {
    return i.supplier_passport?.country_of_origin ?? i.buyer_passport?.country_of_origin ?? null
  }
  function reqScore(i: BankRequestItem): number | null {
    // floor = the lower of the two counterparties' scores (worst-case)
    const s = i.supplier_passport?.passport_score
    const b = i.buyer_passport?.passport_score
    if (s == null) return b ?? null
    if (b == null) return s
    return Math.min(s, b)
  }

  const filtered = useMemo(() => {
    const minAmt = fMinAmt ? parseFloat(fMinAmt) : null
    const maxAmt = fMaxAmt ? parseFloat(fMaxAmt) : null
    const scoreFloor = fScore ? parseFloat(fScore) : null
    const sinceTs = fSince ? new Date(fSince).getTime() : null

    const out = items.filter(i => {
      const r = i.request
      if (fType) {
        if (fType === 'custom' || fType === 'open') {
          if (r.financing_type) return false
          if (r.structure_type !== fType) return false
        } else if (r.financing_type !== fType) {
          return false
        }
      }
      if (fCurrency && (r.currency ?? 'USD') !== fCurrency) return false
      if (minAmt != null && (r.amount_requested ?? 0) < minAmt) return false
      if (maxAmt != null && (r.amount_requested ?? 0) > maxAmt) return false
      if (fGeo && reqGeo(i) !== fGeo) return false
      if (scoreFloor != null) {
        const sc = reqScore(i)
        if (sc == null || sc < scoreFloor) return false
      }
      if (sinceTs != null && new Date(r.created_at).getTime() < sinceTs) return false
      return true
    })

    const dir = sortDir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      switch (sortKey) {
        case 'amount': return dir * ((a.request.amount_requested ?? 0) - (b.request.amount_requested ?? 0))
        case 'tenor':  return dir * ((a.request.preferred_tenor_days ?? 0) - (b.request.preferred_tenor_days ?? 0))
        case 'rate':   return dir * ((a.request.preferred_rate_max ?? 0) - (b.request.preferred_rate_max ?? 0))
        case 'score':  return dir * ((reqScore(a) ?? -1) - (reqScore(b) ?? -1))
        default:       return dir * (new Date(a.request.created_at).getTime() - new Date(b.request.created_at).getTime())
      }
    })
    return out
  }, [items, fType, fCurrency, fMinAmt, fMaxAmt, fGeo, fScore, fSince, sortKey, sortDir])

  // Currencies present in the dataset
  const currencyOptions = useMemo(() => {
    const set = new Set<string>()
    for (const i of items) set.add(i.request.currency ?? 'USD')
    return [...set].sort()
  }, [items])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  function sortArrow(key: SortKey) {
    if (sortKey !== key) return null
    return <span className="term-sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  function resetFilters() {
    setFType(''); setFCurrency(''); setFMinAmt(''); setFMaxAmt('')
    setFGeo(''); setFScore(''); setFSince('')
  }

  // Live stats — recalc on every items change (TC.3)
  const stats = useMemo(() => {
    const active = items.filter(i => ['open', 'offers_received'].includes(i.request.status))
    const totalVolume = active.reduce((s, i) => s + (i.request.amount_requested ?? 0), 0)
    const ratesWithGuidance = active.map(i => i.request.preferred_rate_max).filter((r): r is number => r != null)
    const avgRate = ratesWithGuidance.length
      ? ratesWithGuidance.reduce((s, r) => s + r, 0) / ratesWithGuidance.length
      : null
    const openOffers = items.reduce((s, i) => s + (i.all_offers_count ?? 0), 0)
    return { activeCount: active.length, avgRate, totalVolume, openOffers }
  }, [items])

  // TC.5 — Submit Offer with mismatch detection
  function handleSubmitOffer(item: BankRequestItem) {
    const r = item.request
    const reqType = r.financing_type ?? null
    const reqCurrency = r.currency ?? 'USD'

    // If the request has a concrete financing type, check for a matching active program.
    if (reqType) {
      const match = programs.find(p =>
        p.status !== 'closed' &&
        Array.isArray(p.financing_types) &&
        p.financing_types.includes(reqType) &&
        (p.currency ?? 'USD') === reqCurrency
      )
      if (!match) {
        // No matching program → open Strike AI "Create Program" mid-flow (no error).
        setCpSeed({ financingType: reqType, currency: reqCurrency })
        setCpOpen(true)
        return
      }
    }
    // Has a matching program (or open/custom structure) → go straight to the offer form.
    router.push(`/marketplace/financing/${r.id}`)
  }

  function handleProgramCreated(program: { id: string }) {
    setCpOpen(false)
    // Refresh local program list so the same request no longer triggers the mid-flow.
    fetch('/api/programs').then(r => r.ok ? r.json() : null).then(d => { if (d?.programs) setPrograms(d.programs) }).catch(() => {})
    // Return to the offer form with the new program preselected.
    if (selectedId) router.push(`/marketplace/financing/${selectedId}?program=${program.id}`)
  }

  return (
    <div className="term-page" data-page-name="Strike Place" data-ai-context={JSON.stringify({ active: stats.activeCount, avg_rate: stats.avgRate, volume: stats.totalVolume })}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="t-page-title">Strike Place</h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray)', margin: '2px 0 0' }}>
            Live financing order book
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-green)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-green)' }} /> Live
          </span>
        </div>
      </div>

      {/* Stats bar (TC.2 top bar) */}
      <div className="term-statbar">
        <div className="term-stat">
          <span className="term-stat-label">Active Requests</span>
          <span className="term-stat-value">{stats.activeCount}</span>
        </div>
        <div className="term-stat">
          <span className="term-stat-label">Avg Rate Guidance</span>
          <span className="term-stat-value is-blue">{stats.avgRate != null ? `${stats.avgRate.toFixed(2)}%` : '—'}</span>
        </div>
        <div className="term-stat">
          <span className="term-stat-label">Total Volume</span>
          <span className="term-stat-value">{fmtCompact(stats.totalVolume)}</span>
        </div>
        <div className="term-stat">
          <span className="term-stat-label">Open Offers</span>
          <span className="term-stat-value is-green">{stats.openOffers}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="term-filters">
        <div className="term-filter">
          <span className="term-filter-label">Type</span>
          <select className="term-select" value={fType} onChange={e => setFType(e.target.value)}>
            {TYPE_FILTERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="term-filter">
          <span className="term-filter-label">Currency</span>
          <select className="term-select" value={fCurrency} onChange={e => setFCurrency(e.target.value)}>
            <option value="">All</option>
            {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="term-filter">
          <span className="term-filter-label">Min Amt</span>
          <input className="term-input" inputMode="numeric" placeholder="0" value={fMinAmt} onChange={e => setFMinAmt(e.target.value.replace(/[^0-9.]/g, ''))} style={{ minWidth: 80 }} />
        </div>
        <div className="term-filter">
          <span className="term-filter-label">Max Amt</span>
          <input className="term-input" inputMode="numeric" placeholder="∞" value={fMaxAmt} onChange={e => setFMaxAmt(e.target.value.replace(/[^0-9.]/g, ''))} style={{ minWidth: 80 }} />
        </div>
        <div className="term-filter">
          <span className="term-filter-label">Geography</span>
          <select className="term-select" value={fGeo} onChange={e => setFGeo(e.target.value)}>
            <option value="">All</option>
            {geoOptions.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="term-filter">
          <span className="term-filter-label">Score Floor</span>
          <input className="term-input" inputMode="numeric" placeholder="0" value={fScore} onChange={e => setFScore(e.target.value.replace(/[^0-9]/g, ''))} style={{ minWidth: 64 }} />
        </div>
        <div className="term-filter">
          <span className="term-filter-label">Posted Since</span>
          <input className="term-input" type="date" value={fSince} onChange={e => setFSince(e.target.value)} style={{ minWidth: 120 }} />
        </div>
        <div className="term-filters-spacer" />
        {(fType || fCurrency || fMinAmt || fMaxAmt || fGeo || fScore || fSince) && (
          <button className="term-filter-reset" onClick={resetFilters}>Reset</button>
        )}
        <span className="term-count">{filtered.length} / {items.length}</span>
      </div>

      {/* Split view */}
      <div className="term-split">
        {/* LEFT — order book table */}
        <div className="term-board">
          <table className="term-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Requestor</th>
                <th className="num is-sortable" onClick={() => toggleSort('amount')}>Amount{sortArrow('amount')}</th>
                <th className="num is-sortable" onClick={() => toggleSort('tenor')}>Term{sortArrow('tenor')}</th>
                <th className="num is-sortable" onClick={() => toggleSort('rate')}>Rate Gd.{sortArrow('rate')}</th>
                <th>Geo</th>
                <th className="num is-sortable" onClick={() => toggleSort('posted')}>Posted{sortArrow('posted')}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="term-empty">
                      <div className="term-empty-title">No matching requests</div>
                      <div className="term-empty-sub">Adjust filters · new requests stream in live</div>
                    </div>
                  </td>
                </tr>
              ) : filtered.map(item => {
                const r = item.request
                const tm = typeMeta(r)
                const sc = reqScore(item)
                const cp = item.supplier_passport ?? item.buyer_passport
                const isNew = newIds.has(r.id)
                return (
                  <tr
                    key={r.id}
                    className={`term-row${item.request.id === selectedId ? ' is-selected' : ''}${isNew ? ' is-new' : ''}`}
                    onClick={() => { setSelectedId(r.id); if (isNew) onClearNew(r.id) }}
                    onAnimationEnd={() => { if (isNew) onClearNew(r.id) }}
                  >
                    <td><span className={`term-tbadge ${tm.cls}`}>{tm.code}</span></td>
                    <td>
                      <div className="term-requestor">
                        <span className="term-pscore" style={{ color: scoreColor(sc), background: scoreBg(sc) }}>{sc ?? '—'}</span>
                        <span className="term-requestor-name">{cp?.legal_name ?? 'Verified counterparty'}</span>
                      </div>
                    </td>
                    <td className="num">{fmtCompact(r.amount_requested, r.currency)}</td>
                    <td className="num">{r.preferred_tenor_days ? `${r.preferred_tenor_days}d` : '—'}</td>
                    <td className="num">{r.preferred_rate_max != null ? `${r.preferred_rate_max}%` : <span className="term-cell-muted">mkt</span>}</td>
                    <td className="term-cell-muted">{reqGeo(item) ?? '—'}</td>
                    <td className="num term-cell-muted">{timeAgo(r.created_at)}</td>
                    <td>
                      <span className="term-status">
                        <span className="term-status-dot" style={{ background: statusDotColor(r.status) }} />
                        {r.status === 'offers_received' ? `${item.all_offers_count} off` : r.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* RIGHT — detail panel */}
        <aside className="term-aside">
          {!selected ? (
            <div className="term-detail">
              <div className="term-detail-empty">
                <span className="term-detail-empty-mark">◧</span>
                <span className="term-detail-empty-text">Select a request to inspect</span>
              </div>
            </div>
          ) : (
            <DetailPanel
              item={selected}
              onSubmitOffer={() => handleSubmitOffer(selected)}
              onOpenRoom={() => router.push(`/marketplace/financing/${selected.request.id}`)}
            />
          )}
        </aside>
      </div>

      {/* TC.5 — Strike AI create-program mid-flow overlay */}
      {cpOpen && cpSeed && (
        <CreateProgramFlow
          seed={cpSeed}
          onCancel={() => setCpOpen(false)}
          onCreated={handleProgramCreated}
        />
      )}
    </div>
  )
}

// ── Detail panel ─────────────────────────────────────────────────────────────────
function DetailPanel({
  item,
  onSubmitOffer,
  onOpenRoom,
}: {
  item: BankRequestItem
  onSubmitOffer: () => void
  onOpenRoom: () => void
}) {
  const r = item.request
  const tm = typeMeta(r)
  const cp = item.supplier_passport ?? item.buyer_passport
  const cur = r.currency ?? 'USD'

  return (
    <div className="term-detail">
      <div className="term-detail-head">
        <span className="term-detail-sub"><span className={`term-tbadge ${tm.cls}`}>{tm.code}</span> &nbsp;{tm.label}</span>
        <span className="term-detail-amount">{fmt(r.amount_requested, cur)}</span>
        <span className="term-detail-sub">Request #{r.id.slice(0, 8).toUpperCase()} · {timeAgo(r.created_at)} ago</span>
      </div>

      <div className="term-detail-body">
        {/* Counterparty PassportScore widget */}
        {cp && (
          <div>
            <div className="term-detail-section-label">Counterparty</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <PassportScoreRing score={cp.passport_score} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cp.legal_name}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--gray)', display: 'flex', gap: 10, marginTop: 2 }}>
                  {cp.trade_count_total > 0 && <span>{cp.trade_count_total} trades</span>}
                  {cp.avg_payment_days != null && <span>{cp.avg_payment_days}d avg pay</span>}
                  {cp.country_of_origin && <span>{cp.country_of_origin}</span>}
                </div>
                <Link href={`/passport/${cp.id}`} style={{ fontSize: 11, color: 'var(--blue)', fontFamily: 'var(--font-body)' }}>View Passport →</Link>
              </div>
            </div>
          </div>
        )}

        {/* Both counterparties when both exist */}
        {item.buyer_passport && item.supplier_passport && (
          <div>
            <div className="term-detail-section-label">Scores</div>
            <div className="term-kv">
              <span className="term-kv-k">Buyer</span>
              <span className="term-kv-v" style={{ color: scoreColor(item.buyer_passport.passport_score) }}>{item.buyer_passport.passport_score ?? '—'}</span>
            </div>
            <div className="term-kv">
              <span className="term-kv-k">Supplier</span>
              <span className="term-kv-v" style={{ color: scoreColor(item.supplier_passport.passport_score) }}>{item.supplier_passport.passport_score ?? '—'}</span>
            </div>
          </div>
        )}

        {/* Terms */}
        <div>
          <div className="term-detail-section-label">Request Terms</div>
          <div className="term-kv"><span className="term-kv-k">Amount</span><span className="term-kv-v">{fmt(r.amount_requested, cur)}</span></div>
          <div className="term-kv"><span className="term-kv-k">Preferred Tenor</span><span className="term-kv-v">{r.preferred_tenor_days ? `${r.preferred_tenor_days}d` : '—'}</span></div>
          <div className="term-kv"><span className="term-kv-k">Max Rate</span><span className="term-kv-v">{r.preferred_rate_max != null ? `${r.preferred_rate_max}%` : 'Market'}</span></div>
          <div className="term-kv"><span className="term-kv-k">Structure</span><span className="term-kv-v">{r.structure_type}</span></div>
          <div className="term-kv"><span className="term-kv-k">Offers</span><span className="term-kv-v">{item.all_offers_count}</span></div>
          {r.expires_at && <div className="term-kv"><span className="term-kv-k">Expires</span><span className="term-kv-v">{fmtDate(r.expires_at)}</span></div>}
        </div>

        {/* Deal context */}
        {item.deal && (
          <div>
            <div className="term-detail-section-label">Underlying Deal</div>
            <div className="term-kv"><span className="term-kv-k">Deal Value</span><span className="term-kv-v">{fmt(item.deal.total_value ?? item.deal.agreed_price, item.deal.agreed_currency)}</span></div>
            {item.deal.goods_description && (
              <div className="term-kv"><span className="term-kv-k">Goods</span><span className="term-kv-v" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.deal.goods_description}</span></div>
            )}
            <div className="term-kv"><span className="term-kv-k">Delivery</span><span className="term-kv-v">{fmtDate(item.deal.agreed_delivery_date)}</span></div>
          </div>
        )}

        {/* AI market intelligence */}
        {(r.ai_market_context || r.ai_risk_assessment) && (
          <div className="term-ai-note">
            <span className="term-ai-note-label">Strike AI · Market Intel</span>
            {r.ai_market_context && <p style={{ margin: 0 }}>{r.ai_market_context}</p>}
            {r.ai_risk_assessment && <p style={{ margin: '6px 0 0', opacity: 0.85 }}>{r.ai_risk_assessment}</p>}
          </div>
        )}

        {/* Actions */}
        <div className="term-detail-actions">
          <button className={`btn btn-sm ${item.my_offer ? 'btn-ghost' : 'btn-blue'}`} onClick={onSubmitOffer}>
            {item.my_offer ? `Edit Offer · ${item.my_offer.offered_rate_apr}% APR` : 'Submit Offer'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onOpenRoom}>Open Room</button>
        </div>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────────
function TerminalSkeleton() {
  return (
    <div className="term-page">
      <div style={{ height: 26, width: 180, background: 'var(--border)', borderRadius: 6, marginBottom: 14, animation: 'term-skel 1.6s ease infinite' }} />
      <div className="term-statbar">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="term-stat">
            <div className="term-skel-bar" style={{ width: 70 }} />
            <div className="term-skel-bar" style={{ width: 50, height: 18 }} />
          </div>
        ))}
      </div>
      <div className="term-split">
        <div className="term-board">
          <table className="term-table">
            <tbody>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <tr key={i} className="term-skel-row"><td colSpan={8}><div className="term-skel-bar" /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="term-aside">
          <div className="term-detail"><div className="term-detail-body"><div className="term-skel-bar" style={{ height: 120 }} /></div></div>
        </aside>
      </div>
    </div>
  )
}

// ── Org list (unchanged behavior — non-bank requestor view) ─────────────────────────
function structureBadge(s: string) {
  return <span className="badge badge-draft" style={{ textTransform: 'none', fontSize: 10 }}>{s}</span>
}
function statusBadge(status: string) {
  const map: Record<string, string> = {
    open: 'badge badge-active', offers_received: 'badge badge-offer',
    accepted: 'badge badge-funded', funded: 'badge badge-funded',
    expired: 'badge badge-rejected', cancelled: 'badge badge-rejected',
  }
  return map[status] ?? 'badge badge-draft'
}

function OrgList({ items }: { items: OrgRequestItem[] }) {
  const router = useRouter()

  if (items.length === 0) {
    return (
      <div className="mp-empty-state">
        <div className="mp-empty-title">No financing requests yet</div>
        <div className="mp-empty-sub">
          Go to your deals to request financing from competing banks.{' '}
          <Link href="/deals" style={{ color: 'var(--blue)', fontWeight: 500 }}>View deals →</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mp-listing-feed">
      {items.map(item => (
        <div key={item.id} className="listing-card" onClick={() => router.push(`/marketplace/financing/${item.id}`)}>
          <div className="listing-card-head">
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
              {fmt(item.amount_requested, item.currency)}
            </span>
            {structureBadge(item.financing_type ?? item.structure_type)}
            <span className={statusBadge(item.status)} style={{ marginLeft: 4 }}>{item.status.replace(/_/g, ' ')}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gray-soft)', fontFamily: 'var(--font-body)' }}>{timeAgo(item.created_at)}</span>
          </div>
          <div className="listing-card-body" style={{ gap: 8 }}>
            {item.deal?.goods_description && (
              <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>{item.deal.goods_description}</p>
            )}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div className="listing-detail-item">
                <span className="listing-detail-label">Max Rate</span>
                <span className="listing-detail-value">{item.preferred_rate_max ? `${item.preferred_rate_max}%` : '—'}</span>
              </div>
            </div>
          </div>
          <div className="listing-card-footer">
            <div className="listing-offer-badge">
              <span className="listing-offer-badge-count">{item.offer_count}</span>
              {' '}offer{item.offer_count !== 1 ? 's' : ''}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--blue)', fontWeight: 500 }}>View →</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function FinancingMarketplacePage() {
  const portal = usePortal()
  const user   = useUser()
  const router = useRouter()
  const isBank = portal === 'bank'

  const [loading, setLoading] = useState(true)
  const [items, setItems]     = useState<any[]>([])
  const [newIds, setNewIds]   = useState<Set<string>>(new Set())
  const channelRef = useRef<any>(null)

  const load = useCallback(() => {
    fetch('/api/marketplace/financing')
      .then(r => r.json())
      .then(d => { setItems(d.requests ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const clearNew = useCallback((id: string) => {
    setNewIds(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // TC.3 — Supabase Realtime on financing_requests (bank terminal only).
  // Matches the rooms/[id] subscription pattern: gracefully degrades if WS is blocked.
  useEffect(() => {
    if (!isBank || !user) return

    let supabase: ReturnType<typeof createClient> | null = null
    let channel: any = null
    try {
      supabase = createClient()
      channel = supabase
        .channel('strike-place:financing_requests')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financing_requests' }, () => {
          // A new request landed — re-pull the enriched list (deal + passports) and flash it.
          fetch('/api/marketplace/financing')
            .then(r => r.json())
            .then(d => {
              const incoming: BankRequestItem[] = d.requests ?? []
              setItems(prev => {
                const prevIds = new Set(prev.map((p: BankRequestItem) => p.request.id))
                const freshIds = incoming.filter(i => !prevIds.has(i.request.id)).map(i => i.request.id)
                if (freshIds.length) setNewIds(s => { const n = new Set(s); freshIds.forEach(id => n.add(id)); return n })
                return incoming
              })
            })
            .catch(() => {})
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'financing_requests' }, (payload: any) => {
          // In-place update (status change / new offer count). Stats recalc via memo.
          const updated = payload.new as FinancingRequest
          setItems(prev => prev.map((p: BankRequestItem) =>
            p.request.id === updated.id ? { ...p, request: { ...p.request, ...updated } } : p
          ))
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'financing_request_offers' }, () => {
          // New competing offer somewhere — refresh counts.
          fetch('/api/marketplace/financing').then(r => r.json()).then(d => setItems(d.requests ?? [])).catch(() => {})
        })
        .subscribe()
      channelRef.current = channel
    } catch {
      // Realtime unavailable; terminal still works via REST initial load.
    }

    return () => {
      if (supabase && channel) supabase.removeChannel(channel)
    }
  }, [isBank, user])

  // ── BANK: trading terminal ──
  if (isBank) {
    return (
      <>
        <Topbar crumbs={[
          { label: 'Strike Place', onClick: () => router.push('/marketplace') },
          { label: 'Financing Order Book' },
        ]} />
        {loading
          ? <TerminalSkeleton />
          : <TradingTerminal items={items} newIds={newIds} onClearNew={clearNew} onRefresh={load} />}
      </>
    )
  }

  // ── ORG: requestor view ──
  return (
    <>
      <Topbar crumbs={[
        { label: 'Strike Place', onClick: () => router.push('/marketplace') },
        { label: 'My Financing Requests' },
      ]} />
      <div className="mp-page page">
        <div className="page-header" style={{ marginBottom: 20 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            My Financing Requests
          </h1>
        </div>
        {loading ? (
          <div className="mp-listing-feed">{[0, 1, 2].map(i => <div key={i} className="mp-skeleton-card" />)}</div>
        ) : (
          <OrgList items={items} />
        )}
      </div>
    </>
  )
}
