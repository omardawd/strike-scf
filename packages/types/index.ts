// ── Enums ─────────────────────────────────────────────────

export type UserRole =
  | 'bank_admin'
  | 'bank_credit_officer'
  | 'anchor_admin'
  | 'anchor_member'
  | 'supplier_admin'
  | 'supplier_member'

export type OrgType = 'anchor' | 'supplier'

export type OrgStatus =
  | 'invited'
  | 'in_progress'
  | 'submitted'
  | 'under_review'
  | 'approved_pending_collateral'
  | 'approved_pending_signature'
  | 'approved'
  | 'rejected'
  | 'suspended'

export type BankStatus = 'setup_pending' | 'active' | 'suspended'
export type InstitutionType = 'commercial_bank' | 'fund' | 'fintech_lender'
export type BusinessType = 'corporation' | 'llc' | 'partnership' | 'sole_proprietor'

export type KYBStatus =
  | 'not_started' | 'in_progress' | 'submitted' | 'under_review'
  | 'more_info_requested' | 'approved' | 'rejected'

export type RiskTier = 'A' | 'B' | 'C' | 'D'

export type CreditDecision =
  | 'approved' | 'override_approved' | 'more_info_requested'
  | 'rejected' | 'pending_countersign'

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'
export type InvitationRole = 'anchor' | 'supplier'
export type ProgramStatus = 'draft' | 'active' | 'paused' | 'closed'
export type EnrollmentStatus = 'invited' | 'onboarding' | 'active' | 'suspended'
export type FinancingType = 'factoring' | 'reverse_factoring' | 'po_financing' | 'open'

export type TransactionStatus =
  | 'draft'
  | 'pending_anchor_initiation'
  | 'pending_anchor_approval'
  | 'pending_anchor_confirmation'
  | 'pending_bank_review'
  | 'more_info_requested'
  | 'financing_approved_pending_collateral'
  | 'financing_approved'
  | 'funded'
  | 'pending_delivery_confirmation'
  | 'delivery_confirmed'
  | 'repayment_due'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'in_dispute'
  | 'bad_debt'

export type TransactionEventType =
  | 'created' | 'status_change' | 'document_uploaded' | 'rate_set'
  | 'collateral_updated' | 'disbursement_marked' | 'supplier_paid_marked'
  | 'repayment_marked' | 'early_repayment_marked' | 'note_added'
  | 'offer_submitted' | 'offer_accepted' | 'counter_offer_submitted'
  | 'negotiation_lapsed' | 'dispute_raised' | 'dispute_resolved'

export type CollateralType =
  | 'post_dated_cheque' | 'personal_guarantee' | 'assignment_of_receivables'
  | 'cash_collateral' | 'asset_pledge' | 'other'

export type CollateralStatus =
  | 'pending' | 'submitted' | 'accepted' | 'rejected' | 'waived' | 'released'

export type CollateralLevel = 'onboarding' | 'transaction'
export type DocumentEntityType = 'kyb' | 'transaction' | 'collateral' | 'confirmation'

// ── Entities ──────────────────────────────────────────────

export interface Bank {
  id: string
  legal_name: string
  display_name: string
  institution_type: InstitutionType
  primary_contact_name: string
  primary_contact_email: string
  logo_url: string | null
  website: string | null
  routing_number: string
  status: BankStatus
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  bank_id: string | null
  org_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Invitation {
  id: string
  email: string
  role: InvitationRole
  invited_by_user_id: string
  invited_by_actor_type: 'bank' | 'anchor'
  bank_id: string
  program_id: string | null
  anchor_org_id: string | null
  company_name_hint: string | null
  token: string
  status: InvitationStatus
  expires_at: string
  accepted_at: string | null
  created_at: string
}

export interface Organization {
  id: string
  bank_id: string
  type: OrgType
  status: OrgStatus
  legal_name: string | null
  doing_business_as: string | null
  ein: string | null
  business_type: BusinessType | null
  state_of_incorporation: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  years_in_operation: number | null
  annual_revenue_range: string | null
  industry_naics: string | null
  primary_contact_name: string | null
  primary_contact_title: string | null
  primary_contact_phone: string | null
  bank_account_last4: string | null
  bank_routing_number: string | null
  bank_account_type: 'checking' | 'savings' | null
  kyb_status: KYBStatus
  kyb_submitted_at: string | null
  credit_score: number | null
  risk_tier: RiskTier | null
  credit_reviewed_at: string | null
  next_review_date: string | null
  invitation_id: string | null
  created_at: string
  updated_at: string
}

export interface CreditScore {
  id: string
  org_id: string
  score_business_longevity: number | null
  score_revenue_scale: number | null
  score_document_completeness: number | null
  score_financial_health: number | null
  score_program_fit: number | null
  score_counterparty_tenure: number | null
  total_score: number | null
  risk_tier: RiskTier | null
  financial_health_notes: string | null
  created_at: string
}

export interface CreditDecisionRecord {
  id: string
  org_id: string
  credit_score_id: string
  decision: CreditDecision
  decided_by_user_id: string
  countersigned_by_user_id: string | null
  score_at_decision: number
  risk_tier_at_decision: RiskTier
  override_reason: string | null
  rejection_reason: string | null
  info_request_message: string | null
  created_at: string
}

export interface Program {
  id: string
  bank_id: string
  created_by_user_id: string
  name: string
  financing_types: FinancingType[]
  program_limit: string | null
  per_supplier_sublimit: string | null
  min_deal_size: string | null
  max_deal_size: string | null
  max_invoice_age_days: number | null
  max_po_fulfillment_days: number | null
  standard_tenor_days: number
  currency: string
  is_open_account: boolean
  status: ProgramStatus
  activated_at: string | null
  created_at: string
  updated_at: string
}

export interface ProgramEnrollment {
  id: string
  program_id: string
  org_id: string
  anchor_org_id: string | null
  enrolled_by_user_id: string
  status: EnrollmentStatus
  suspension_reason: string | null
  enrolled_at: string | null
  created_at: string
  updated_at: string
}

export interface Transaction {
  id: string
  program_id: string
  bank_id: string
  anchor_id: string
  supplier_id: string
  created_by_user_id: string
  type: FinancingType
  anchor_initiated: boolean
  status: TransactionStatus
  invoice_number: string | null
  invoice_date: string | null
  invoice_due_date: string | null
  po_number: string | null
  po_date: string | null
  expected_fulfillment_date: string | null
  po_value: string | null
  invoice_amount: string
  financing_amount_requested: string
  financing_amount_approved: string | null
  financing_rate_apr: string | null
  tenor_days: number | null
  fee_amount: string | null
  net_proceeds: string | null
  anchor_repayment_amount: string | null
  repayment_due_date: string | null
  original_due_date: string | null
  requested_extension_days: number | null
  goods_services_description: string | null
  rejection_reason: string | null
  bank_approval_notes: string | null
  supplier_notes: string | null
  anchor_confirmed_at: string | null
  anchor_confirmed_by_user_id: string | null
  disbursed_at: string | null
  disbursed_by_user_id: string | null
  disbursement_reference: string | null
  supplier_paid_at: string | null
  repaid_at: string | null
  repaid_by_user_id: string | null
  repayment_reference: string | null
  early_repayment: boolean
  actual_fee_amount: string | null
  esign_document_id: string | null
  esign_document_url: string | null
  bank_signed_at: string | null
  anchor_signed_at: string | null
  supplier_signed_at: string | null
  esign_completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TransactionEvent {
  id: string
  transaction_id: string
  event_type: TransactionEventType
  from_status: TransactionStatus | null
  to_status: TransactionStatus | null
  actor_id: string | null
  actor_type: 'supplier' | 'anchor' | 'bank' | 'system'
  notes: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface CollateralRequirement {
  id: string
  level: CollateralLevel
  org_id: string | null
  transaction_id: string | null
  required_by_user_id: string
  collateral_type: CollateralType
  description: string
  required_value: string | null
  deadline: string
  status: CollateralStatus
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by_user_id: string | null
  rejection_reason: string | null
  waiver_note: string | null
  released_at: string | null
  released_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface Document {
  id: string
  name: string
  storage_path: string
  mime_type: string
  size_bytes: number
  uploaded_by_user_id: string
  entity_type: DocumentEntityType
  entity_id: string
  document_kind: string
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  event: string
  title: string
  body: string
  deep_link: string
  read: boolean
  read_at: string | null
  email_sent: boolean
  email_sent_at: string | null
  created_at: string
}

// ── Composite types for API responses ─────────────────────

export interface TransactionWithParties extends Transaction {
  supplier: Pick<Organization, 'id' | 'legal_name' | 'type'>
  anchor: Pick<Organization, 'id' | 'legal_name' | 'type'>
  program: Pick<Program, 'id' | 'name' | 'financing_types' | 'standard_tenor_days'>
  events?: TransactionEvent[]
}

export interface ProgramWithStats extends Program {
  enrollment_count: number
  active_transaction_count: number
  total_outstanding: string
}

export interface OrgWithCredit extends Organization {
  latest_credit_score?: CreditScore
  latest_decision?: CreditDecisionRecord
}