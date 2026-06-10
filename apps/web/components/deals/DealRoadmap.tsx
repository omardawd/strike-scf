'use client'
// G4.1 — Financing-aware deal roadmap. Receives FinancingContext as props.
// Zero financing logic inside — all logic comes from props.
import React from 'react'
import type { FinancingContext } from '@/lib/deals/financing-context'

const ROADMAP_STEPS = [
  { key: 'agreed',             label: 'Agreed' },
  { key: 'confirmed',          label: 'Confirmed' },
  { key: 'shipped',            label: 'Shipped' },
  { key: 'goods_received',     label: 'Received' },
  { key: 'delivery_confirmed', label: 'Accepted' },
  { key: 'payment_info_sent',  label: 'Pay Info' },
  { key: 'payment_confirmed',  label: 'Paid' },
  { key: 'completed',          label: 'Completed' },
]

function statusToStepIndex(status: string): number {
  switch (status) {
    case 'negotiating':         return -1
    case 'agreed':              return 0
    case 'documents_pending':   return 0  // legacy: show at agreed step
    case 'confirmed':
    case 'active':
    case 'in_preparation':      return 1  // legacy in_preparation maps to confirmed step
    case 'shipped':             return 2
    case 'goods_received':      return 3
    case 'delivery_confirmed':
    case 'payment_due':
    case 'payment_overdue':     return 4
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
}

export function DealRoadmap({ status, financingContext, currentUserRole: _role }: DealRoadmapProps) {
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

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 480 }}>
        {ROADMAP_STEPS.map((step, i) => {
          const isPast    = i < currentIdx
          const isCurrent = i === currentIdx
          const isLast    = i === ROADMAP_STEPS.length - 1
          const isPayStep = step.key === 'payment_confirmed'
          const isPrepStep = step.key === 'confirmed'
          const isPayOverdue = isCurrent && ['payment_due', 'payment_overdue'].includes(status)

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
            <div key={step.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: isLast ? '0 0 auto' : 1, minWidth: 64 }}>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {i > 0 && <div style={{ flex: 1, height: 2, background: lineColor }} />}
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: dotBg, border: dotBorder,
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
                fontWeight: isCurrent ? 700 : 400, marginTop: 7, textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                {isPayStep ? paymentStepLabel : step.label}
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
  )
}
