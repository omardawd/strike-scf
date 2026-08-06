'use client'
import { useRouter } from 'next/navigation'
import { PassportScoreRing } from '@/components/passport-score-ring'

export interface NetworkMemberOrg {
  legal_name: string | null
  passport_score: number | null
  kyb_status: string | null
  country: string | null
  logo_url?: string | null
}

export interface NetworkMemberRow {
  id: string
  supplier_org_id: string
  status: string
  joined_at: string | null
  buyer_notes: string | null
  organization: NetworkMemberOrg | null
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:    { bg: '#edfaf4', text: '#10B981' },
  invited:   { bg: '#fffbeb', text: '#F59E0B' },
  suspended: { bg: '#fee2e2', text: '#EF4444' },
  declined:  { bg: '#f3f4f6', text: '#6B7280' },
  removed:   { bg: '#f3f4f6', text: '#9CA3AF' },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: '#f3f4f6', text: '#6B7280' }
  return (
    <span style={{
      display: 'inline-block', borderRadius: 'var(--radius-badge)',
      padding: '3px 10px', fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.text,
    }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// A grid "box" for a single network member — PassportScore, identity, and
// status. Clicking navigates to their public passport. Owner-only management
// actions (suspend/reactivate/remove) render as small buttons that stop
// propagation so they don't also trigger the navigation.
export function MemberCard({
  member,
  isOwner,
  onSuspend,
  onReactivate,
  onRemove,
}: {
  member: NetworkMemberRow
  isOwner: boolean
  onSuspend?: (orgId: string) => void
  onReactivate?: (orgId: string) => void
  onRemove?: (orgId: string) => void
}) {
  const router = useRouter()
  const org = member.organization

  return (
    <div
      className="card card-interactive"
      style={{ padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}
      onClick={() => router.push(`/passport/${member.supplier_org_id}`)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <PassportScoreRing score={org?.passport_score} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {org?.legal_name ?? '—'}
          </div>
          {org?.country && (
            <div style={{ fontSize: 12, color: 'var(--gray)' }}>{org.country}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusBadge status={member.status} />
        {org?.kyb_status && <StatusBadge status={org.kyb_status} />}
      </div>

      <div style={{ fontSize: 11, color: 'var(--gray-soft)' }}>
        {member.joined_at
          ? `Member since ${new Date(member.joined_at).toLocaleDateString()}`
          : 'Not yet joined'}
      </div>

      {isOwner && (member.status === 'active' || member.status === 'suspended') && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }} onClick={e => e.stopPropagation()}>
          {member.status === 'active' && onSuspend && (
            <button
              onClick={() => onSuspend(member.supplier_org_id)}
              style={{
                padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-button)',
                border: '1.5px solid var(--border)', background: 'none', cursor: 'pointer',
              }}
            >
              Suspend
            </button>
          )}
          {member.status === 'suspended' && onReactivate && (
            <button
              onClick={() => onReactivate(member.supplier_org_id)}
              style={{
                padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-button)',
                border: '1.5px solid var(--border)', background: 'none', cursor: 'pointer',
              }}
            >
              Reactivate
            </button>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(member.supplier_org_id)}
              style={{
                padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-button)',
                border: '1.5px solid #fecaca', background: '#fee2e2', color: '#dc2626', cursor: 'pointer',
              }}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}
