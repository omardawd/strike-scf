// G2.1 — Permitted state transition map.
// Every valid (current_status, action, role) → next_status mapping lives here.

import type { FinancingContext } from './financing-context'

export type DealStatus =
  | 'negotiating'
  | 'agreed'
  | 'documents_pending'
  | 'confirmed'
  | 'in_preparation'
  | 'shipped'
  | 'delivery_confirmed'
  | 'in_dispute'
  | 'payment_due'
  | 'payment_overdue'
  | 'payment_confirmed'
  | 'completed'
  | 'cancelled'
  | 'active'
  | 'financing_requested'
  | 'financing_active'
  | 'disputed'

export type UserRole =
  | 'bank_admin'
  | 'bank_credit_officer'
  | 'org_admin'
  | 'org_member'
  | 'strike_admin'
  | 'system'

export type SideEffect =
  | 'notify_counterparty'
  | 'notify_bank'
  | 'notify_admin'
  | 'generate_noa'
  | 'send_noa_email'
  | 'convert_po_financing'
  | 'recalculate_passport_score'
  | 'update_supplier_performance'
  | 'prompt_peer_review'
  | 'create_deal_event'
  | 'send_email'
  | 'create_signal'
  | 'flag_fraud'

export interface TransitionRule {
  nextStatus: DealStatus
  allowedRoles: UserRole[]
  requiresFinancingStructure?: string[]
  blockedWhenFinancingActive?: boolean
  requiredFields?: string[]
  sideEffects: SideEffect[]
}

const ORG_ROLES: UserRole[] = ['org_admin', 'org_member']
const ALL_ROLES: UserRole[] = ['bank_admin', 'bank_credit_officer', 'org_admin', 'org_member', 'strike_admin']

export const PERMITTED_TRANSITIONS: Record<string, TransitionRule> = {
  'agreed:upload_documents': {
    nextStatus: 'documents_pending',
    allowedRoles: ORG_ROLES,
    requiredFields: ['payment_bank_name', 'payment_account_name'],
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
  'documents_pending:confirm': {
    nextStatus: 'confirmed',
    allowedRoles: ORG_ROLES,
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
  'confirmed:begin_preparation': {
    nextStatus: 'in_preparation',
    allowedRoles: ORG_ROLES,
    sideEffects: ['notify_counterparty', 'create_deal_event'],
  },
  'in_preparation:mark_shipped': {
    nextStatus: 'shipped',
    allowedRoles: ORG_ROLES,
    requiredFields: ['shipment_tracking_ref', 'shipment_carrier'],
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email', 'convert_po_financing'],
  },
  'shipped:confirm_delivery': {
    nextStatus: 'delivery_confirmed',
    allowedRoles: ORG_ROLES,
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
  'shipped:raise_dispute': {
    nextStatus: 'in_dispute',
    allowedRoles: ORG_ROLES,
    requiredFields: ['dispute_category', 'dispute_reason'],
    sideEffects: ['notify_counterparty', 'notify_admin', 'notify_bank', 'create_deal_event', 'send_email', 'create_signal'],
  },
  'delivery_confirmed:set_payment_due': {
    nextStatus: 'payment_due',
    allowedRoles: ['system'],
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
  'payment_due:confirm_payment_sent': {
    nextStatus: 'payment_confirmed',
    allowedRoles: ORG_ROLES,
    requiredFields: ['payment_external_reference', 'payment_confirmed_at'],
    sideEffects: ['notify_counterparty', 'notify_bank', 'create_deal_event', 'send_email'],
  },
  'delivery_confirmed:confirm_payment_sent': {
    nextStatus: 'payment_confirmed',
    allowedRoles: ORG_ROLES,
    requiredFields: ['payment_external_reference'],
    sideEffects: ['notify_counterparty', 'notify_bank', 'create_deal_event', 'send_email'],
  },
  'payment_overdue:confirm_payment_sent': {
    nextStatus: 'payment_confirmed',
    allowedRoles: ORG_ROLES,
    requiredFields: ['payment_external_reference'],
    sideEffects: ['notify_counterparty', 'notify_bank', 'create_deal_event', 'send_email'],
  },
  'payment_confirmed:confirm_receipt': {
    nextStatus: 'completed',
    allowedRoles: [...ORG_ROLES, 'bank_admin', 'bank_credit_officer'],
    sideEffects: [
      'notify_counterparty', 'create_deal_event', 'send_email',
      'recalculate_passport_score', 'update_supplier_performance', 'prompt_peer_review',
    ],
  },
  // Cancellations — blocked if financing active
  'agreed:cancel': {
    nextStatus: 'cancelled',
    allowedRoles: ORG_ROLES,
    blockedWhenFinancingActive: true,
    requiredFields: ['cancellation_reason'],
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
  'documents_pending:cancel': {
    nextStatus: 'cancelled',
    allowedRoles: ORG_ROLES,
    blockedWhenFinancingActive: true,
    requiredFields: ['cancellation_reason'],
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
  'confirmed:cancel': {
    nextStatus: 'cancelled',
    allowedRoles: ORG_ROLES,
    blockedWhenFinancingActive: true,
    requiredFields: ['cancellation_reason'],
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
  'in_preparation:cancel': {
    nextStatus: 'cancelled',
    allowedRoles: ORG_ROLES,
    blockedWhenFinancingActive: true,
    requiredFields: ['cancellation_reason'],
    sideEffects: ['notify_counterparty', 'create_deal_event', 'send_email'],
  },
}

export function getPermittedTransition(
  currentStatus: string,
  action: string,
  userRole: UserRole,
  financingContext: FinancingContext
): TransitionRule | null {
  const key = `${currentStatus}:${action}`
  const rule = PERMITTED_TRANSITIONS[key]
  if (!rule) return null

  if (!rule.allowedRoles.includes(userRole)) return null

  if (rule.blockedWhenFinancingActive && financingContext.isActive) return null

  if (rule.requiresFinancingStructure && financingContext.structure) {
    if (!rule.requiresFinancingStructure.includes(financingContext.structure)) return null
  }

  return rule
}
