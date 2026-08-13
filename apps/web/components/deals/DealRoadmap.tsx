'use client'
// G4.1 — Financing-aware deal roadmap. Receives FinancingContext as props.
// Zero financing/data-fetching logic inside — all logic comes from props;
// the only local state is which stage's custom-checkpoint details are
// expanded (pure UI state, same category as FlowBoard's expandedColumnId).
import React, { useState } from 'react'
import type { FinancingContext } from '@/lib/deals/financing-context'
import type { DealFlowNode, DealFlowCycleOccurrence, DealFlowRoadmapStage } from '@strike-scf/types'

const ROADMAP_STEPS: { key: DealFlowRoadmapStage; label: string }[] = [
  { key: 'agreed',             label: 'Agreed' },
  { key: 'contract_pending',   label: 'Contract' },
  { key: 'confirmed',          label: 'In Business' },
  { key: 'shipped',            label: 'Shipped' },
  { key: 'goods_received',     label: 'Received' },
  { key: 'delivery_confirmed', label: 'Accepted' },
  { key: 'payment_confirmed',  label: 'Paid' },
  { key: 'completed',          label: 'Completed' },
]

function statusToStepIndex(status: string): number {
  switch (status) {
    case 'negotiating':         return -1
    case 'agreed':              return 0
    case 'documents_pending':   return 0  // legacy: show at agreed step
    case 'contract_pending':    return 1
    case 'confirmed':
    case 'active':
    case 'in_preparation':      return 2  // confirmed + legacy in_preparation
    case 'shipped':             return 3
    case 'goods_received':      return 4
    case 'delivery_confirmed':
    case 'payment_due':
    case 'payment_overdue':
    case 'payment_info_sent':   return 5
    case 'payment_confirmed':   return 6
    case 'completed':           return 7
    default:                    return -1
  }
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export interface DealRoadmapProps {
  status: string
  financingContext: FinancingContext
  currentUserRole: 'buyer' | 'supplier' | 'bank'
  flowNodesByStage?: Partial<Record<DealFlowRoadmapStage, DealFlowNode[]>>
  occurrencesByNode?: Record<string, DealFlowCycleOccurrence[]>
  onRespondNode?: (nodeId: string, response: 'accepted' | 'declined') => void
  onCompleteNode?: (nodeId: string) => void
  onCompleteOccurrence?: (occurrenceId: string) => void
}

export function DealRoadmap({
  status, financingContext, currentUserRole,
  flowNodesByStage, occurrencesByNode, onRespondNode, onCompleteNode, onCompleteOccurrence,
}: DealRoadmapProps) {
  const [expandedStage, setExpandedStage] = useState<DealFlowRoadmapStage | null>(null)
  const currentIdx  = statusToStepIndex(status)
  const isDispute   = ['in_dispute', 'disputed'].includes(status)
  const isCancelled = status === 'cancelled'
  const fc          = financingContext

  // Derive step-level badges and labels from financing context (no inline logic)
  const paymentStepLabel = fc.isActive ? fc.paymentStepLabel : 'Payment'
  const paymentBadge     = fc.financingBadgeLabel
  const poPreShipBadge   = fc.structure === 'po_financing' && fc.isPOFinancingPreShipment
  const poConvertedBadge = fc.structure === 'po_financing' && fc.poFinancingConverted
  const noaBadge         = fc.structure === 'invoice_factoring' && fc.noaRequired && !fc.noaAcknowledged
  const ddDate           = fc.ddEarlyPaymentDate
  const paymentSubLabel  = noaBadge
    ? 'NOA Required'
    : ddDate
    ? fmtDate(ddDate)
    : null

  const expandedNodes = expandedStage ? (flowNodesByStage?.[expandedStage] ?? []) : []

  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 480 }}>
          {ROADMAP_STEPS.map((step, i) => {
            const isPast    = i < currentIdx
            const isCurrent = i === currentIdx
            const isLast    = i === ROADMAP_STEPS.length - 1
            const isPayStep = step.key === 'payment_confirmed'
            const isPrepStep = step.key === 'confirmed'
            const isPayOverdue = isCurrent && ['payment_due', 'payment_overdue'].includes(status)
            const stageNodes = flowNodesByStage?.[step.key] ?? []
            const isExpanded = expandedStage === step.key

            const dotBg = isCancelled
              ? 'var(--border-strong)'
              : isDispute && isCurrent
              ? 'var(--color-red)'
              : isPayOverdue
              ? '#F59E0B'
              : isCurrent
              ? 'var(--blue)'
              : isPast
              ? 'var(--color-green)'
              : 'var(--offwhite)'
            const dotBorder = (isPast || isCurrent) ? 'none' : '2px solid var(--border-strong)'
            const lineColor = isPast ? 'var(--color-green)' : 'var(--border)'

            return (
              <div
                key={step.key}
                onClick={() => setExpandedStage(prev => (prev === step.key ? null : step.key))}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: isLast ? '0 0 auto' : 1, minWidth: 64, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  {i > 0 && <div style={{ flex: 1, height: 2, background: lineColor }} />}
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: dotBg, border: isExpanded ? '2px solid var(--blue)' : dotBorder,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isCurrent && !isCancelled
                      ? `0 0 0 4px ${isPayOverdue ? 'rgba(245,158,11,0.18)' : 'var(--blue-light)'}`
                      : 'none',
                  }}>
                    {isPast && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {isCurrent && isDispute && <span style={{ fontSize: 10, color: 'white', fontWeight: 700 }}>!</span>}
                  </div>
                  {!isLast && <div style={{ flex: 1, height: 2, background: lineColor }} />}
                </div>

                {/* Step label */}
                <div style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase',
                  color: isCancelled ? 'var(--gray-soft)' : isCurrent ? 'var(--ink)' : isPast ? 'var(--color-green)' : 'var(--gray-soft)',
                  fontWeight: isCurrent ? 700 : 400, marginTop: 7, textAlign: 'center', maxWidth: 90,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {isPayStep ? paymentStepLabel : step.label}
                  {stageNodes.length > 0 && (
                    <span style={{
                      fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, textTransform: 'none',
                      background: isExpanded ? 'var(--blue)' : 'var(--blue-light)', color: isExpanded ? '#fff' : 'var(--blue)',
                      borderRadius: 999, minWidth: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                    }}>
                      {stageNodes.length}
                    </span>
                  )}
                </div>

                {/* Financing badge on payment step */}
                {isPayStep && paymentBadge && (
                  <div style={{
                    marginTop: 3, fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                    padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase',
                    background: noaBadge ? 'rgba(245,158,11,0.12)' : fc.structure === 'dynamic_discounting' ? 'rgba(16,185,129,0.12)' : 'var(--blue-light)',
                    color: noaBadge ? '#92400e' : fc.structure === 'dynamic_discounting' ? 'var(--color-green)' : 'var(--blue)',
                    whiteSpace: 'nowrap',
                  }}>
                    {paymentBadge}
                  </div>
                )}

                {/* NOA warning badge */}
                {isPayStep && noaBadge && (
                  <div style={{ marginTop: 2, fontSize: 9, color: '#92400e', fontFamily: 'var(--font-body)', textAlign: 'center', maxWidth: 80 }}>
                    NOA Required
                  </div>
                )}

                {/* Payment date sub-label for DD */}
                {isPayStep && paymentSubLabel && !noaBadge && (
                  <div style={{ fontSize: 9, color: 'var(--color-green)', fontFamily: 'var(--font-body)', marginTop: 2, textAlign: 'center', maxWidth: 80 }}>
                    {paymentSubLabel}
                  </div>
                )}

                {/* PO Financing badge on preparation step */}
                {isPrepStep && poPreShipBadge && (
                  <div style={{ marginTop: 3, fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'var(--blue-light)', color: 'var(--blue)', textTransform: 'uppercase' }}>
                    PO Funded
                  </div>
                )}
                {isPrepStep && poConvertedBadge && (
                  <div style={{ marginTop: 3, fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: 'var(--color-green)', textTransform: 'uppercase' }}>
                    Production Funded
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {isCancelled && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 8, fontSize: 12, color: 'var(--color-red)', textAlign: 'center' }}>
            This deal was cancelled
          </div>
        )}
        {isDispute && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 8, fontSize: 12, color: 'var(--color-red)', textAlign: 'center' }}>
            This deal is in dispute
          </div>
        )}
      </div>

      {expandedStage && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {ROADMAP_STEPS.find(s => s.key === expandedStage)?.label} — custom checkpoints
          </div>
          {expandedNodes.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--gray-soft)' }}>No custom checkpoints for this stage yet. Use "Customize deal" to add one.</div>
          ) : expandedNodes.map(node => (
            <FlowNodeRow
              key={node.id}
              node={node}
              occurrences={occurrencesByNode?.[node.id] ?? []}
              currentUserRole={currentUserRole}
              onRespond={onRespondNode}
              onComplete={onCompleteNode}
              onCompleteOccurrence={onCompleteOccurrence}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FlowNodeRow({
  node, occurrences, currentUserRole, onRespond, onComplete, onCompleteOccurrence,
}: {
  node: DealFlowNode
  occurrences: DealFlowCycleOccurrence[]
  currentUserRole: 'buyer' | 'supplier' | 'bank'
  onRespond?: (nodeId: string, response: 'accepted' | 'declined') => void
  onComplete?: (nodeId: string) => void
  onCompleteOccurrence?: (occurrenceId: string) => void
}) {
  const [showOccurrences, setShowOccurrences] = useState(false)
  const completedOccurrences = occurrences.filter(o => o.status === 'completed').length

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{node.title}</strong>
        {node.node_type === 'cycle' && <span className="badge badge-draft" style={{ fontSize: 9 }}>CYCLE</span>}
        <span className={`badge ${node.status === 'completed' ? 'badge-completed' : node.status === 'declined' ? 'badge-rejected' : node.status === 'accepted' ? 'badge-active' : 'badge-pending'}`} style={{ fontSize: 9 }}>{node.status}</span>
        <span className="badge badge-draft" style={{ fontSize: 9 }}>{node.responsible_party}</span>
      </div>
      {node.description && <p style={{ margin: '6px 0 0', color: 'var(--gray)', fontSize: 12, lineHeight: 1.5 }}>{node.description}</p>}
      <div style={{ marginTop: 6, display: 'flex', gap: 12, color: 'var(--gray-soft)', fontSize: 10 }}>
        {node.due_at && <span>Due {new Date(node.due_at).toLocaleDateString()}</span>}
        {node.requires_document && <span>Document required</span>}
        {node.node_type === 'cycle' && (
          <span>{node.repeat_count}× every {node.repeat_interval_days}d — {completedOccurrences}/{node.repeat_count} done</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {currentUserRole === 'supplier' && node.status === 'proposed' && (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => onRespond?.(node.id, 'accepted')}>Accept</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onRespond?.(node.id, 'declined')}>Decline</button>
          </>
        )}
        {currentUserRole !== 'bank' && node.node_type === 'step' && node.status === 'accepted' && (
          <button className="btn btn-ghost btn-sm" onClick={() => onComplete?.(node.id)}>Mark complete</button>
        )}
        {node.node_type === 'cycle' && occurrences.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowOccurrences(v => !v)}>
            {showOccurrences ? 'Hide occurrences' : 'View occurrences'}
          </button>
        )}
      </div>

      {showOccurrences && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
          {occurrences.map(o => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={o.status === 'completed'}
                disabled={o.status === 'completed' || currentUserRole === 'bank'}
                onChange={() => onCompleteOccurrence?.(o.id)}
              />
              #{o.occurrence_index} — due {new Date(o.due_at).toLocaleDateString()}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
