// ============================================================
// STRIKE SCF v2 — TypeScript Types
// Mirrors the Postgres schema exactly.
// Place in packages/types/index.ts in the Turborepo.
// ============================================================

// ---- ENUMS -------------------------------------------------

export type OrgType = 'anchor' | 'supplier'

export type OrgStatus =
  | 'pending_kyb'
  | 'kyb_in_progress'
  | 'kyb_submitted'
  | 'kyb_ai_reviewing'
  | 'active'
  | 'suspended'
  | 'rejected'

export type KybStatus =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'ai_reviewing'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'more_info_requested'

export type RiskTier = 'green' | 'amber' | 'red'

export type UserRole =
  | 'bank_admin'
  | 'bank_credit_officer'
  | 'org_admin'
  | 'org_member'
  | 'strike_admin'

export type BankStatus = 'setup_pending' | 'active' | 'suspended'

export type ListingType = 'po_request' | 'product_service'

export type ListingStatus = 'draft' | 'active' | 'matched' | 'closed' | 'expired' | 'cancelled'

export type OfferStatus = 'pending' | 'accepted' | 'countered' | 'rejected' | 'withdrawn' | 'expired'

export type DealSource = 'marketplace' | 'imported' | 'direct'

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
  | 'active'              // legacy — treat as confirmed in UI
  | 'financing_requested'
  | 'financing_active'
  | 'completed'
  | 'disputed'            // legacy alias for in_dispute
  | 'cancelled'

export type RoomType = 'public' | 'private'
export type RoomStatus = 'active' | 'archived'

export type RoomMessageType =
  | 'message'
  | 'system'
  | 'ai_suggestion'
  | 'document_share'
  | 'offer_update'
  | 'contract_draft'

export type RoomMessageStatus = 'pending_review' | 'visible' | 'flagged' | 'removed'

export type RoomParticipantRole = 'owner' | 'participant' | 'observer'

export type FinancingStructure = 'preset' | 'custom' | 'open'

export type FinancingType =
  | 'reverse_factoring'
  | 'invoice_factoring'
  | 'po_financing'
  | 'dynamic_discounting'

export type FinancingRequestStatus =
  | 'open'
  | 'offers_received'
  | 'accepted'
  | 'funded'
  | 'expired'
  | 'cancelled'

export type TransactionStatus =
  | 'draft'
  | 'pending_anchor_approval'
  | 'pending_bank_review'
  | 'pending_supplier_counter_review'
  | 'financing_approved'
  | 'funded'
  | 'pending_anchor_confirmation'
  | 'repayment_due'
  | 'completed'
  | 'rejected'
  | 'in_dispute'
  | 'cancelled'

export type TransactionSource = 'program' | 'marketplace'

export type AgentPreferenceType =
  | 'rate_floor'
  | 'rate_ceiling'
  | 'min_passport_score'
  | 'max_deal_value_auto'
  | 'blacklist_countries'
  | 'preferred_incoterms'
  | 'auto_reject_below_score'
  | 'preferred_tenor_days'
  | 'max_financing_rate'

export type AgentActionType =
  | 'offer_analyzed'
  | 'counter_suggested'
  | 'contract_drafted'
  | 'financing_ranked'
  | 'passport_flagged'
  | 'auto_rejected'
  | 'room_moderation'
  | 'document_extracted'
  | 'fraud_flagged'
  | 'passport_narrative_generated'
  | 'listing_optimized'

export type PassportViewContext =
  | 'offer_review'
  | 'listing_browse'
  | 'financing_review'
  | 'room_participant'
  | 'general'

export type DocumentEntityType =
  | 'organization'
  | 'transaction'
  | 'deal'
  | 'financing_request'
  | 'room'

// ---- CORE TABLES -------------------------------------------

export interface Bank {
  id: string
  legal_name: string
  display_name: string
  institution_type: string
  primary_contact_name: string
  primary_contact_email: string
  logo_url: string | null
  website: string | null
  routing_number: string | null
  swift_code: string | null
  jurisdiction: string | null
  status: BankStatus
  marketplace_tier: string | null
  marketplace_active: boolean
  created_at: string
  updated_at: string
}

export interface Organization {
  id: string
  type: OrgType
  status: OrgStatus
  legal_name: string | null
  doing_business_as: string | null
  ein: string | null
  business_type: string | null
  state_of_incorporation: string | null
  country_of_incorporation: string
  industry_naics: string | null
  website: string | null
  description: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string
  primary_contact_name: string | null
  primary_contact_title: string | null
  primary_contact_phone: string | null
  primary_contact_email: string | null
  years_in_operation: number | null
  annual_revenue_range: string | null
  employee_count_range: string | null
  bank_account_last4: string | null
  bank_routing_number: string | null
  bank_account_type: string | null
  country_of_origin: string | null
  sourcing_countries: string[] | null
  product_categories: string[] | null
  kyb_status: KybStatus
  kyb_submitted_at: string | null
  kyb_ai_reviewed_at: string | null
  kyb_approved_at: string | null
  kyb_rejection_reason: string | null
  risk_score: number | null
  risk_tier: RiskTier | null
  risk_flags: string[] | null
  tariff_exposure: Record<string, unknown> | null
  credit_score: number | null
  performance_score: number | null
  performance_tier: 'preferred' | 'standard' | 'under_review' | null
  network_visible: boolean
  passport_published_at: string | null
  passport_score: number | null
  passport_score_updated_at: string | null
  passport_narrative: string | null
  passport_narrative_updated_at: string | null
  trade_count_total: number
  trade_volume_total: number
  avg_payment_days: number | null
  dispute_rate_network: number | null
  banks_transacted_with: string[] | null
  primary_bank_id: string | null
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
  last_seen_at: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

// ---- PASSPORT ----------------------------------------------

export interface PassportPeerReview {
  id: string
  reviewing_org_id: string
  reviewed_org_id: string
  deal_id: string | null
  rating: number
  category_scores: {
    payment_speed: number
    communication: number
    accuracy: number
    reliability: number
  } | null
  comment: string | null
  is_public: boolean
  created_at: string
}

// Computed/derived type for the full Passport view (assembled from multiple tables)
export interface PassportProfile {
  org: Organization
  peer_reviews: PassportPeerReview[]
  avg_rating: number | null
  review_count: number
  recent_deals: number        // last 12 months
  view_count_30d: number      // how many times viewed in 30 days
  bank_view_count_30d: number // how many banks viewed in 30 days
}

// ---- MARKETPLACE -------------------------------------------

export interface MarketplaceListing {
  id: string
  org_id: string
  listing_type: ListingType
  status: ListingStatus
  title: string
  description: string | null
  category: string | null
  subcategory: string | null
  tags: string[] | null
  quantity: number | null
  unit: string | null
  target_price: number | null
  currency: string
  incoterms: string | null
  shipping_cost: number | null
  delivery_location: string | null
  delivery_deadline: string | null
  payment_terms: string | null
  origin_country: string | null
  ai_summary: string | null
  ai_category_tags: string[] | null
  ai_price_benchmark: {
    median: number
    range_low: number
    range_high: number
  } | null
  network_visible: boolean
  featured: boolean
  expires_at: string | null
  matched_deal_id: string | null
  view_count: number
  offer_count: number
  created_at: string
  updated_at: string
}

export interface OfferRound {
  round: number
  offered_price: number
  offered_quantity: number | null
  proposed_delivery_date: string | null
  proposed_incoterms: string | null
  proposed_payment_terms: string | null
  shipping_cost: number | null
  notes: string | null
  by_org_id: string
  at: string
}

export interface MarketplaceOffer {
  id: string
  listing_id: string
  from_org_id: string
  deal_id: string | null
  offered_price: number
  offered_quantity: number | null
  proposed_delivery_date: string | null
  proposed_incoterms: string | null
  proposed_payment_terms: string | null
  shipping_cost: number | null
  notes: string | null
  status: OfferStatus
  current_round: number
  offer_rounds: OfferRound[]
  ai_analysis: string | null
  ai_recommendation: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Deal {
  id: string
  listing_id: string | null
  offer_id: string | null
  buyer_org_id: string
  supplier_org_id: string
  agreed_price: number
  agreed_quantity: number | null
  agreed_unit: string | null
  agreed_currency: string
  agreed_delivery_date: string | null
  agreed_incoterms: string | null
  agreed_payment_terms: string | null
  shipping_cost: number | null
  goods_description: string | null
  status: DealStatus
  room_id: string | null
  po_document_id: string | null
  invoice_document_id: string | null
  contract_document_id: string | null
  ai_contract_draft: string | null
  ai_po_draft: string | null
  ai_invoice_draft: string | null
  documents_generated_at: string | null
  deal_source: DealSource
  counterparty_confirmed: boolean
  counterparty_confirmed_at: string | null
  counterparty_confirmation_token: string | null
  imported_by_org_id: string | null
  import_notes: string | null
  financing_requested: boolean
  financing_requested_at: string | null
  financing_request_id: string | null
  agreed_at: string | null
  active_at: string | null
  confirmed_at: string | null
  in_preparation_at: string | null
  shipped_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_reason: string | null
  total_value: number | null
  payment_days_actual: number | null
  // Shipment (G1.2)
  shipment_tracking_ref: string | null
  shipment_carrier: string | null
  shipment_estimated_delivery: string | null
  commercial_invoice_id: string | null
  commercial_invoice_issued_at: string | null
  // Payment instructions (seller's bank — direct payment)
  payment_bank_name: string | null
  payment_account_number: string | null
  payment_routing_number: string | null
  payment_swift_iban: string | null
  payment_account_name: string | null
  payment_reference: string | null
  payment_instructions_set_at: string | null
  payment_instructions_set_by: string | null
  // Financing fork
  financing_payment_active: boolean
  // Payment confirmation (buyer-side)
  payment_confirmed_at: string | null
  payment_confirmed_by: string | null
  payment_amount: number | null
  payment_currency: string | null
  payment_external_reference: string | null
  // Overdue
  payment_due_date: string | null
  overdue_notified_at: string | null
  // Amendments
  amendment_history: AmendmentRecord[] | null
  // External counterparty (imported deals)
  external_counterparty_email: string | null
  external_counterparty_name: string | null
  external_counterparty_country: string | null
  // Dispute
  disputed_at: string | null
  disputed_by: string | null
  dispute_reason: string | null
  dispute_category: string | null
  dispute_resolved_at: string | null
  dispute_resolved_by: string | null
  dispute_resolution: string | null
  created_at: string
  updated_at: string
}

export interface AmendmentRecord {
  id: string
  proposed_by: string
  proposed_at: string
  field: string
  current_value: string | number | null
  proposed_value: string | number | null
  reason: string
  status: 'pending' | 'accepted' | 'rejected'
  responded_at: string | null
  response: string | null
}

export interface DealEvent {
  id: string
  deal_id: string
  event_type: string
  actor_user_id: string | null
  actor_org_id: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface FinancingRequest {
  id: string
  deal_id: string
  requesting_org_id: string
  structure_type: FinancingStructure
  financing_type: FinancingType | null
  amount_requested: number
  preferred_tenor_days: number | null
  preferred_rate_max: number | null
  currency: string
  custom_terms: Record<string, unknown> | null
  status: FinancingRequestStatus
  expires_at: string | null
  ai_market_context: string | null
  ai_risk_assessment: string | null
  ai_recommended_structure: string | null
  accepted_offer_id: string | null
  accepted_bank_id: string | null
  accepted_at: string | null
  offer_count: number
  created_at: string
  updated_at: string
}

export interface FinancingRequestOffer {
  id: string
  request_id: string
  bank_id: string
  offered_rate_apr: number
  offered_amount: number
  offered_tenor_days: number
  structure_type: FinancingType
  conditions: string | null
  notes: string | null
  status: OfferStatus
  ai_score: number | null
  ai_score_reasoning: string | null
  submitted_at: string
  updated_at: string
}

// ---- ROOMS -------------------------------------------------

export interface Room {
  id: string
  room_type: RoomType
  status: RoomStatus
  name: string
  description: string | null
  category: string | null
  tags: string[] | null
  created_by_org_id: string | null
  created_by_user_id: string | null
  deal_id: string | null
  is_moderated: boolean
  rules: string | null
  participant_count: number
  message_count: number
  last_message_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface RoomParticipant {
  id: string
  room_id: string
  org_id: string | null
  bank_id: string | null
  user_id: string
  role: RoomParticipantRole
  joined_at: string
  last_read_at: string | null
}

export interface RoomMessage {
  id: string
  room_id: string
  user_id: string | null
  org_id: string | null
  bank_id: string | null
  content: string
  message_type: RoomMessageType
  status: RoomMessageStatus
  moderated_at: string | null
  moderation_reason: string | null
  metadata: Record<string, unknown> | null
  reply_to_id: string | null
  created_at: string
}

// ---- AI / AGENT --------------------------------------------

export interface AgentPreference {
  id: string
  org_id: string
  preference_type: AgentPreferenceType
  value: unknown   // number | string[] | number — depends on preference_type
  label: string | null
  is_active: boolean
  set_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface AgentAction {
  id: string
  org_id: string | null
  bank_id: string | null
  action_type: AgentActionType
  entity_type: string | null
  entity_id: string | null
  reasoning: string | null
  input_summary: string | null
  output_summary: string | null
  outcome: string | null
  requires_approval: boolean
  human_approved: boolean | null
  approved_by_user_id: string | null
  approved_at: string | null
  model: string | null
  tokens_used: number | null
  latency_ms: number | null
  created_at: string
}

export interface AINegotiationState {
  id: string
  deal_id: string
  current_round: number
  last_offer_snapshot: Record<string, unknown> | null
  negotiation_history: unknown[] | null
  agent_recommendation: string | null
  agent_confidence: number | null
  market_context: string | null
  suggested_counter: Record<string, unknown> | null
  updated_at: string
}

// ---- COMPOSITE TYPES (API responses) -----------------------

// What a listing card shows (listing + poster's Passport summary)
export interface ListingWithPassport {
  listing: MarketplaceListing
  poster_org: Pick<Organization, 'id' | 'legal_name' | 'doing_business_as' | 'type' | 'passport_score' | 'risk_tier' | 'trade_count_total' | 'trade_volume_total' | 'country_of_origin' | 'description'>
  poster_passport_narrative: string | null
}

// What an offer card shows (offer + offeror's Passport summary)
export interface OfferWithPassport {
  offer: MarketplaceOffer
  offeror_org: Pick<Organization, 'id' | 'legal_name' | 'doing_business_as' | 'type' | 'passport_score' | 'risk_tier' | 'trade_count_total' | 'avg_payment_days' | 'dispute_rate_network'>
  ai_analysis: string | null
  ai_recommendation: string | null
}

// What banks see on a financing request
export interface FinancingRequestWithContext {
  request: FinancingRequest
  deal: Pick<Deal, 'id' | 'agreed_price' | 'agreed_currency' | 'goods_description' | 'agreed_delivery_date' | 'agreed_incoterms'>
  buyer_passport: Pick<Organization, 'id' | 'legal_name' | 'passport_score' | 'risk_tier' | 'trade_count_total' | 'avg_payment_days' | 'dispute_rate_network'>
  supplier_passport: Pick<Organization, 'id' | 'legal_name' | 'passport_score' | 'risk_tier' | 'trade_count_total' | 'avg_payment_days' | 'dispute_rate_network'>
  my_offer: FinancingRequestOffer | null
  all_offers_count: number
}

// Room message with sender info
export interface RoomMessageWithSender extends RoomMessage {
  sender_name: string | null
  sender_org_name: string | null
}

// ---- API ROUTE PAYLOADS ------------------------------------

export interface ImportDealPayload {
  // Step 1 — deal basics
  initiating_side: 'buyer' | 'supplier'           // which side is the importing org?
  counterparty_org_id?: string                     // if counterparty is already on Strike
  counterparty_name?: string                       // if counterparty is NOT on Strike
  counterparty_country?: string
  counterparty_email?: string                      // to send confirmation invite
  goods_description: string
  total_value: number
  currency: string
  agreed_delivery_date?: string
  agreed_incoterms?: string
  agreed_payment_terms?: string
  po_number?: string
  import_notes?: string

  // Step 2 — document upload handled separately via /api/documents/upload
  // Step 3 — confirmation handled via /api/deals/[id]/confirm-counterparty
}

export interface ConfirmImportedDealPayload {
  deal_id: string
  token: string    // the counterparty_confirmation_token from the email link
}

export interface CreateListingPayload {
  listing_type: ListingType
  title: string
  description?: string
  category?: string
  subcategory?: string
  tags?: string[]
  quantity?: number
  unit?: string
  target_price?: number
  currency?: string
  incoterms?: string
  shipping_cost?: number
  delivery_location?: string
  delivery_deadline?: string
  payment_terms?: string
  origin_country?: string
  expires_at?: string
}

export interface SubmitOfferPayload {
  listing_id: string
  offered_price: number
  offered_quantity?: number
  proposed_delivery_date?: string
  proposed_incoterms?: string
  proposed_payment_terms?: string
  shipping_cost?: number
  notes?: string
  bank_account_id?: string
  offer_items?: unknown[]
}

export interface CounterOfferPayload {
  offer_id: string
  offered_price: number
  offered_quantity?: number
  proposed_delivery_date?: string
  proposed_incoterms?: string
  proposed_payment_terms?: string
  shipping_cost?: number
  notes?: string
}

export interface CreateFinancingRequestPayload {
  deal_id: string
  structure_type: FinancingStructure
  financing_type?: FinancingType
  amount_requested: number
  preferred_tenor_days?: number
  preferred_rate_max?: number
  currency?: string
  custom_terms?: Record<string, unknown>
}

export interface SubmitFinancingOfferPayload {
  request_id: string
  offered_rate_apr: number
  offered_amount: number
  offered_tenor_days: number
  structure_type: FinancingType
  conditions?: string
  notes?: string
  program_id?: string | null
}

export interface SendRoomMessagePayload {
  room_id: string
  content: string
  message_type?: RoomMessageType
  metadata?: Record<string, unknown>
  reply_to_id?: string
}

// ---- ANCHOR NETWORKS ----------------------------------------

export type ListingVisibility = 'public' | 'network_only'

export interface AnchorNetwork {
  id: string
  anchor_org_id: string
  name: string
  description: string | null
  visibility_default: ListingVisibility
  member_count: number
  created_at: string
  updated_at: string
}

export interface AnchorNetworkMember {
  id: string
  network_id: string
  supplier_org_id: string
  status: 'invited' | 'active' | 'declined' | 'suspended' | 'removed'
  invited_at: string
  invited_by_user_id: string | null
  joined_at: string | null
  declined_at: string | null
  removed_at: string | null
  removed_by_user_id: string | null
  buyer_notes: string | null
  organization?: {
    legal_name: string
    passport_score: number | null
    kyb_status: string
    country: string | null
  }
}

export interface NetworkInviteToken {
  id: string
  token: string
  network_id: string
  anchor_org_id: string
  invited_email: string
  prefill_company_name: string | null
  prefill_country: string | null
  status: 'pending' | 'accepted' | 'expired' | 'cancelled'
  expires_at: string
  accepted_at: string | null
  accepted_by_org_id: string | null
}