'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePortal } from '@/lib/portal-context'
import { PortalShell, Topbar, Icon, NotifBell, fmtMoney } from '@/components/portal-shell'

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

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active:  'badge-active',
    draft:   'badge-draft',
    closed:  'badge-draft',
    pending: 'badge-pending',
  }
  return map[status] ?? 'badge-draft'
}

function typeLabel(program: Program): string {
  return program.financing_types?.length > 0
    ? program.financing_types[0]!.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'SCF'
}

const STATUS_BORDER: Record<string, string> = {
  active:  'var(--color-green, #16a34a)',
  draft:   'var(--color-amber, #d97706)',
  pending: 'var(--color-amber, #d97706)',
}

const TYPE_PILL_COLOR: Record<string, { bg: string; color: string }> = {
  'supply chain finance': { bg: 'rgba(37,99,235,0.08)',  color: 'var(--color-accent, #2563eb)' },
  'reverse factoring':    { bg: 'rgba(124,58,237,0.08)', color: '#7c3aed' },
  'dynamic discounting':  { bg: 'rgba(5,150,105,0.08)',  color: '#059669' },
  'invoice factoring':    { bg: 'rgba(234,88,12,0.08)',  color: '#ea580c' },
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
  const [hovered, setHovered] = useState(false)
  const label = typeLabel(program)
  const statusStr = program.status.charAt(0).toUpperCase() + program.status.slice(1)
  const borderColor = STATUS_BORDER[program.status] ?? 'var(--color-ink-4)'
  const pillStyle = TYPE_PILL_COLOR[label.toLowerCase()] ?? { bg: 'var(--color-bg-2)', color: 'var(--color-ink-3)' }

  const stats = portal === 'bank'
    ? [
        { label: 'Limit',    value: fmtMoney(program.program_limit) },
        { label: 'Currency', value: program.currency ?? 'USD' },
      ]
    : [
        { label: 'Type',   value: label },
        { label: 'Status', value: statusStr },
      ]

  return (
    <div
      className="program-card"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor:      'pointer',
        borderTop:   `3px solid ${borderColor}`,
        boxShadow:   hovered ? '0 4px 12px rgba(0,0,0,0.08)' : undefined,
        transition:  'box-shadow 0.15s',
      }}
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
        <div className="program-stats">
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
  return (
    <div className="program-card" style={{ opacity: 0.5, pointerEvents: 'none' }}>
      <div className="program-card-inner">
        <div className="program-top">
          <span className="program-name" style={{ background: 'var(--color-border)', borderRadius: 4, color: 'transparent', minWidth: 140 }}>Loading</span>
          <span className="badge badge-draft" style={{ background: 'var(--color-border)', color: 'transparent' }}>Draft</span>
        </div>
        <span className="program-type-pill" style={{ background: 'var(--color-border)', color: 'transparent' }}>Type</span>
        <div className="program-divider" />
        <div className="program-stats">
          {[0, 1].map(i => (
            <div key={i}>
              <div className="program-stat-label" style={{ background: 'var(--color-border)', borderRadius: 3, color: 'transparent' }}>Label</div>
              <div className="program-stat-value" style={{ background: 'var(--color-border)', borderRadius: 3, color: 'transparent', marginTop: 4 }}>—</div>
            </div>
          ))}
        </div>
      </div>
      <div className="utilization-bar" />
    </div>
  )
}

export default function ProgramsPage() {
  const portal = usePortal()
  const router = useRouter()
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const visiblePrograms = programs

  useEffect(() => {
    fetch('/api/programs')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        setPrograms(data.programs ?? [])
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const emptyMessage =
    portal === 'bank'
      ? 'Create your first SCF program to get started.'
      : portal === 'anchor'
        ? 'You are not enrolled in any programs yet. Contact your bank to get enrolled.'
        : 'You are not enrolled in any programs yet.'

  return (
    <PortalShell activeSection="programs">
      <Topbar
        crumbs={[{ label: 'My Programs' }]}
        actions={
          <>
            {portal === 'bank' && (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => router.push('/programs/new')}
              >
                <Icon name="plus" size={14} /> New Program
              </button>
            )}
            <NotifBell />
          </>
        }
      />

      <div className="page">
        <div className="page-header">
          <h1 className="t-page-title">My Programs</h1>
          {!loading && !error && visiblePrograms.length > 0 && (
            <div className="subtitle">
              {visiblePrograms.length} program{visiblePrograms.length !== 1 ? 's' : ''}
              {' · '}
              {visiblePrograms.filter(p => p.status === 'active').length} active
            </div>
          )}
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 24 }}>
            <Icon name="error" size={16} className="alert-icon" />
            <div className="alert-body">Failed to load programs: {error}</div>
          </div>
        )}

        {loading ? (
          <div className="program-grid">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : visiblePrograms.length === 0 ? (
          <div className="card">
            <div className="card-body" style={{ padding: 48, textAlign: 'center' }}>
              <div style={{ color: 'var(--color-ink-4)', marginBottom: 12 }}>
                <Icon name="programs" size={32} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-ink-1)', marginBottom: 6 }}>
                No programs yet
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-ink-3)', marginBottom: 20 }}>
                {emptyMessage}
              </div>
              {portal === 'bank' && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => router.push('/programs/new')}
                >
                  <Icon name="plus" size={14} /> New Program
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="program-grid">
            {visiblePrograms.map(p => (
              <ProgramCard
                key={p.id}
                program={p}
                portal={portal}
                onClick={() => router.push(`/programs/${p.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </PortalShell>
  )
}
