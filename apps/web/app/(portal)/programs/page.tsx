'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'
import { AIInsightCard } from '@/components/ai-insight-card'
import { useT } from '@/lib/i18n/locale-context'

type TFn = (key: string, vars?: Record<string, string | number>) => string

interface Program {
  id: string
  name: string
  financing_types: string[]
  status: string
  program_limit: number | null
  per_supplier_sublimit: number | null
  min_deal_size: number | null
  max_deal_size: number | null
  standard_tenor_days: number
  currency: string
  created_at: string
}

function statusLabel(status: string, t: TFn): string {
  switch (status) {
    case 'active':  return t('programsPage.status.active')
    case 'draft':   return t('programsPage.status.draft')
    case 'closed':  return t('programsPage.status.closed')
    case 'pending': return t('programsPage.status.pending')
    default:        return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active:  'badge-active',
    draft:   'badge-draft',
    closed:  'badge-draft',
    pending: 'badge-pending',
  }
  return map[status] ?? 'badge-draft'
}

function typeLabel(program: Program, t: TFn): string {
  const raw = program.financing_types?.[0]
  if (!raw) return t('programsPage.scf')
  switch (raw) {
    case 'reverse_factoring':    return t('financing.type.reverseFactoring')
    case 'invoice_factoring':    return t('financing.type.invoiceFactoring')
    case 'po_financing':         return t('financing.type.poFinancing')
    case 'dynamic_discounting':  return t('financing.type.dynamicDiscounting')
    default: return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
}

const STATUS_BORDER: Record<string, string> = {
  active:  'var(--color-green, #16a34a)',
  draft:   'var(--color-amber, #d97706)',
  pending: 'var(--color-amber, #d97706)',
}

const TYPE_PILL_COLOR: Record<string, { bg: string; color: string }> = {
  supply_chain_finance: { bg: 'rgba(37,99,235,0.08)',  color: 'var(--blue)' },
  reverse_factoring:    { bg: 'rgba(124,58,237,0.08)', color: '#7c3aed' },
  dynamic_discounting:  { bg: 'rgba(5,150,105,0.08)',  color: '#059669' },
  invoice_factoring:    { bg: 'rgba(234,88,12,0.08)',  color: '#ea580c' },
  po_financing:         { bg: 'rgba(37,99,235,0.08)',  color: 'var(--blue)' },
}

function ProgramCard({
  program,
  portal,
  onClick,
}: {
  program: Program
  portal: string
  onClick: () => void
}) {
  const t = useT()
  const label     = typeLabel(program, t)
  const statusStr = statusLabel(program.status, t)
  const borderColor = STATUS_BORDER[program.status] ?? 'var(--border-strong, rgba(0,0,0,.12))'
  const pillStyle = TYPE_PILL_COLOR[program.financing_types?.[0] ?? ''] ?? { bg: 'var(--blue-light)', color: 'var(--blue)' }

  const stats = portal === 'bank'
    ? [
        { label: t('programsPage.limit'),    value: program.program_limit ? fmtMoney(program.program_limit) : t('programsPage.unlimited') },
        { label: t('programsPage.currency'), value: program.currency ?? 'USD' },
        { label: t('programsPage.tenor'),    value: `${program.standard_tenor_days ?? 60}${t('programsPage.daysSuffix')}` },
      ]
    : [
        { label: t('newTransaction.type'),   value: label },
        { label: t('deals.col.status'), value: statusStr },
      ]

  return (
    <div
      className="program-card"
      onClick={onClick}
      style={{ borderTop: `3px solid ${borderColor}` }}
    >
      <div className="program-card-inner">
        <div className="program-top">
          <span className="program-name">{program.name}</span>
          <span className={`badge ${statusBadge(program.status)}`}>{statusStr}</span>
        </div>
        <span
          className="program-type-pill"
          style={{ background: pillStyle.bg, color: pillStyle.color }}
        >
          {label}
        </span>
        <div className="program-divider" />
        <div className="program-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
          {stats.map(s => (
            <div key={s.label}>
              <div className="program-stat-label">{s.label}</div>
              <div className="program-stat-value plain">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="utilization-bar">
        <div className="utilization-fill util-low" style={{ width: '0%' }} />
      </div>
    </div>
  )
}

function SkeletonCard() {
  const t = useT()
  return (
    <div className="program-card" style={{ opacity: 0.45, pointerEvents: 'none' }}>
      <div className="program-card-inner">
        <div className="program-top">
          <span className="program-name" style={{ background: 'var(--border)', borderRadius: 4, color: 'transparent', minWidth: 140 }}>{t('common.loading')}</span>
          <span className="badge badge-draft" style={{ background: 'var(--border)', color: 'transparent' }}>{t('programsPage.status.draft')}</span>
        </div>
        <span className="program-type-pill" style={{ background: 'var(--border)', color: 'transparent' }}>{t('newTransaction.type')}</span>
        <div className="program-divider" />
        <div className="program-stats">
          {[0, 1, 2].map(i => (
            <div key={i}>
              <div className="program-stat-label" style={{ background: 'var(--border)', borderRadius: 3, color: 'transparent' }}>{t('programsPage.limit')}</div>
              <div className="program-stat-value" style={{ background: 'var(--border)', borderRadius: 3, color: 'transparent', marginTop: 4 }}>—</div>
            </div>
          ))}
        </div>
      </div>
      <div className="utilization-bar" />
    </div>
  )
}

const CARD_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
}

export default function ProgramsPage() {
  const portal  = usePortal()
  const router  = useRouter()
  const t = useT()
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const activePrograms   = programs.filter(p => p.status === 'active')
  const inactivePrograms = programs.filter(p => p.status !== 'active')

  useEffect(() => {
    fetch('/api/programs')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => { setPrograms(data.programs ?? []); setLoading(false) })
      .catch(err  => { setError(err.message);           setLoading(false) })
  }, [])

  const emptyMessage =
    portal === 'bank'
      ? t('programsPage.emptyBank')
      : portal === 'anchor'
        ? t('programsPage.emptyAnchor')
        : t('programsPage.emptySupplier')

  return (
    <PortalShell activeSection="programs">
      <Topbar
        crumbs={[{ label: t('programsPage.title') }]}
        actions={
          <>
            {(portal === 'bank' || portal === 'anchor') && (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => router.push('/programs/new')}
              >
                <Icon name="plus" size={14} /> {t('programsPage.newProgram')}
              </button>
            )}
            <NotifBell />
          </>
        }
      />

      <div className="page" data-page-name="Programs" data-ai-context={JSON.stringify({ role: portal, total_programs: programs.length, active_programs: programs.filter((p: any) => p.status === 'active').length, inactive_programs: programs.filter((p: any) => p.status !== 'active').length })}>
        <div className="page-header">
          <h1 className="t-page-title">{t('programsPage.title')}</h1>
          {!loading && !error && programs.length > 0 && (
            <p className="subtitle">
              {programs.length === 1 ? t('programsPage.oneProgram') : t('programsPage.nPrograms', { count: programs.length })} · {t('programsPage.nActive', { count: activePrograms.length })}
            </p>
          )}
        </div>

        {!loading && !error && programs.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <AIInsightCard
              variant="banner"
              portal={portal}
              page="programs"
              context={{ programCount: programs.length, activePrograms: activePrograms.length }}
            />
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 24 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">{t('programsPage.failedToLoad', { error })}</div>
          </div>
        )}

        {loading ? (
          <div style={CARD_GRID}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : programs.length === 0 ? (
          <div className="card">
            <div className="card-body" style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ color: 'var(--gray)', marginBottom: 12 }}>
                <Icon name="programs" size={32} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                {t('programsPage.noProgramsYet')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 20, maxWidth: 360, margin: '0 auto 20px' }}>
                {emptyMessage}
              </div>
              {(portal === 'bank' || portal === 'anchor') && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => router.push('/programs/new')}
                >
                  <Icon name="plus" size={14} /> {t('programsPage.newProgram')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {activePrograms.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <div className="section-title" style={{ marginBottom: 12 }}>
                  {t('programsPage.status.active')} · {activePrograms.length}
                </div>
                <div style={CARD_GRID}>
                  {activePrograms.map(p => (
                    <ProgramCard
                      key={p.id}
                      program={p}
                      portal={portal}
                      onClick={() => router.push('/programs/' + p.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {inactivePrograms.length > 0 && (
              <div style={{ opacity: 0.65 }}>
                <div className="section-title" style={{ marginBottom: 12 }}>
                  {t('programsPage.inactive')} · {inactivePrograms.length}
                </div>
                <div style={CARD_GRID}>
                  {inactivePrograms.map(p => (
                    <ProgramCard
                      key={p.id}
                      program={p}
                      portal={portal}
                      onClick={() => router.push('/programs/' + p.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PortalShell>
  )
}
