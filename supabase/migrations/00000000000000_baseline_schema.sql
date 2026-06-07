-- Baseline schema for Strike SCF — generated from the live Supabase DB (project dthkgrnhlxkzvkegvure).
-- Source of truth was Supabase Studio; this captures enums, tables, constraints, indexes,
-- functions, triggers and comments. RLS lives in the companion baseline_rls migration.
-- Regenerate via the catalog dump in TASKS.md T1.2; do not hand-edit drift back in.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ===== Enum types =====
CREATE TYPE public.agent_action_type AS ENUM ('offer_analyzed', 'counter_suggested', 'contract_drafted', 'financing_ranked', 'passport_flagged', 'auto_rejected', 'room_moderation', 'document_extracted', 'fraud_flagged', 'passport_narrative_generated', 'listing_optimized');
CREATE TYPE public.agent_preference_type AS ENUM ('rate_floor', 'rate_ceiling', 'min_passport_score', 'max_deal_value_auto', 'blacklist_countries', 'preferred_incoterms', 'auto_reject_below_score', 'preferred_tenor_days', 'max_financing_rate');
CREATE TYPE public.bank_status AS ENUM ('setup_pending', 'active', 'suspended');
CREATE TYPE public.collateral_status AS ENUM ('pending', 'submitted', 'accepted', 'rejected', 'waived', 'released');
CREATE TYPE public.deal_source AS ENUM ('marketplace', 'imported', 'direct');
CREATE TYPE public.deal_status AS ENUM ('negotiating', 'agreed', 'documents_pending', 'active', 'financing_requested', 'financing_active', 'completed', 'disputed', 'cancelled');
CREATE TYPE public.document_entity_type AS ENUM ('organization', 'transaction', 'deal', 'financing_request', 'room');
CREATE TYPE public.enrollment_status AS ENUM ('invited', 'onboarding', 'active', 'suspended');
CREATE TYPE public.financing_request_status AS ENUM ('open', 'offers_received', 'accepted', 'funded', 'expired', 'cancelled');
CREATE TYPE public.financing_structure AS ENUM ('preset', 'custom', 'open');
CREATE TYPE public.financing_type AS ENUM ('reverse_factoring', 'invoice_factoring', 'po_financing', 'dynamic_discounting');
CREATE TYPE public.kyb_status AS ENUM ('not_started', 'in_progress', 'submitted', 'ai_reviewing', 'under_review', 'approved', 'rejected', 'more_info_requested');
CREATE TYPE public.listing_status AS ENUM ('draft', 'active', 'matched', 'closed', 'expired', 'cancelled');
CREATE TYPE public.listing_type AS ENUM ('po_request', 'product_service');
CREATE TYPE public.notification_channel AS ENUM ('in_app', 'email', 'both');
CREATE TYPE public.offer_status AS ENUM ('pending', 'accepted', 'countered', 'rejected', 'withdrawn', 'expired');
CREATE TYPE public.org_status AS ENUM ('pending_kyb', 'kyb_in_progress', 'kyb_submitted', 'kyb_ai_reviewing', 'active', 'suspended', 'rejected');
CREATE TYPE public.org_type AS ENUM ('anchor', 'supplier');
CREATE TYPE public.passport_view_context AS ENUM ('offer_review', 'listing_browse', 'financing_review', 'room_participant', 'general');
CREATE TYPE public.program_status AS ENUM ('draft', 'active', 'paused', 'closed');
CREATE TYPE public.risk_tier AS ENUM ('green', 'amber', 'red');
CREATE TYPE public.room_message_status AS ENUM ('pending_review', 'visible', 'flagged', 'removed');
CREATE TYPE public.room_message_type AS ENUM ('message', 'system', 'ai_suggestion', 'document_share', 'offer_update', 'contract_draft');
CREATE TYPE public.room_participant_role AS ENUM ('owner', 'participant', 'observer');
CREATE TYPE public.room_status AS ENUM ('active', 'archived');
CREATE TYPE public.room_type AS ENUM ('public', 'private');
CREATE TYPE public.transaction_source AS ENUM ('program', 'marketplace');
CREATE TYPE public.transaction_status AS ENUM ('draft', 'pending_anchor_approval', 'pending_bank_review', 'pending_supplier_counter_review', 'financing_approved', 'funded', 'pending_anchor_confirmation', 'repayment_due', 'completed', 'rejected', 'in_dispute', 'cancelled');
CREATE TYPE public.user_role AS ENUM ('bank_admin', 'bank_credit_officer', 'org_admin', 'org_member', 'strike_admin');

-- ===== Tables =====
CREATE TABLE public.agent_actions (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "org_id" uuid,
  "bank_id" uuid,
  "action_type" agent_action_type NOT NULL,
  "entity_type" text,
  "entity_id" uuid,
  "reasoning" text,
  "input_summary" text,
  "output_summary" text,
  "outcome" text,
  "requires_approval" boolean DEFAULT false NOT NULL,
  "human_approved" boolean,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "model" text,
  "tokens_used" integer,
  "latency_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.agent_preferences (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "org_id" uuid NOT NULL,
  "preference_type" agent_preference_type NOT NULL,
  "value" jsonb NOT NULL,
  "label" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "set_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ai_limits (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "scope" text NOT NULL,
  "scope_id" uuid,
  "feature" text NOT NULL,
  "daily_limit" integer DEFAULT 100 NOT NULL,
  "monthly_limit" integer DEFAULT 2000 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ai_negotiation_state (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "deal_id" uuid NOT NULL,
  "current_round" integer DEFAULT 1 NOT NULL,
  "last_offer_snapshot" jsonb,
  "negotiation_history" jsonb,
  "agent_recommendation" text,
  "agent_confidence" numeric,
  "market_context" text,
  "suggested_counter" jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ai_usage (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "user_id" uuid,
  "org_id" uuid,
  "bank_id" uuid,
  "feature" text NOT NULL,
  "tokens_input" integer DEFAULT 0 NOT NULL,
  "tokens_output" integer DEFAULT 0 NOT NULL,
  "tokens_total" integer DEFAULT 0 NOT NULL,
  "model" text DEFAULT 'claude-sonnet-4-20250514'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.banks (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "legal_name" text NOT NULL,
  "display_name" text NOT NULL,
  "institution_type" text NOT NULL,
  "primary_contact_name" text NOT NULL,
  "primary_contact_email" text NOT NULL,
  "logo_url" text,
  "website" text,
  "routing_number" text,
  "swift_code" text,
  "jurisdiction" text,
  "status" bank_status DEFAULT 'setup_pending'::bank_status NOT NULL,
  "marketplace_tier" text,
  "marketplace_active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.collateral_requirements (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "level" text NOT NULL,
  "org_id" uuid,
  "transaction_id" uuid,
  "required_by_user_id" uuid,
  "collateral_type" text NOT NULL,
  "description" text NOT NULL,
  "required_value" numeric,
  "deadline" date NOT NULL,
  "status" collateral_status DEFAULT 'pending'::collateral_status NOT NULL,
  "submitted_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "reviewed_by_user_id" uuid,
  "released_by_user_id" uuid,
  "rejection_reason" text,
  "waiver_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.credit_decision_records (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "org_id" uuid NOT NULL,
  "credit_score_id" uuid,
  "bank_id" uuid,
  "decision" text NOT NULL,
  "decided_by_user_id" uuid,
  "decided_by_ai" boolean DEFAULT false NOT NULL,
  "ai_reasoning" text,
  "countersigned_by_user_id" uuid,
  "score_at_decision" numeric,
  "risk_tier_at_decision" risk_tier,
  "override_reason" text,
  "rejection_reason" text,
  "info_request_message" text,
  "decided_by_user_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.credit_scores (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "org_id" uuid NOT NULL,
  "score_business_longevity" numeric DEFAULT 0 NOT NULL,
  "score_revenue_scale" numeric DEFAULT 0 NOT NULL,
  "score_document_completeness" numeric DEFAULT 0 NOT NULL,
  "score_financial_health" numeric DEFAULT 0 NOT NULL,
  "score_program_fit" numeric DEFAULT 0 NOT NULL,
  "score_counterparty_tenure" numeric DEFAULT 0 NOT NULL,
  "total_score" numeric DEFAULT 0 NOT NULL,
  "risk_tier" risk_tier,
  "financial_health_notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.deals (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "listing_id" uuid,
  "offer_id" uuid,
  "buyer_org_id" uuid NOT NULL,
  "supplier_org_id" uuid NOT NULL,
  "agreed_price" numeric NOT NULL,
  "agreed_quantity" numeric,
  "agreed_unit" text,
  "agreed_currency" text DEFAULT 'USD'::text NOT NULL,
  "agreed_delivery_date" date,
  "agreed_incoterms" text,
  "agreed_payment_terms" text,
  "goods_description" text,
  "status" deal_status DEFAULT 'negotiating'::deal_status NOT NULL,
  "room_id" uuid,
  "po_document_id" uuid,
  "invoice_document_id" uuid,
  "contract_document_id" uuid,
  "ai_contract_draft" text,
  "ai_po_draft" text,
  "ai_invoice_draft" text,
  "documents_generated_at" timestamp with time zone,
  "financing_requested" boolean DEFAULT false NOT NULL,
  "financing_requested_at" timestamp with time zone,
  "financing_request_id" uuid,
  "agreed_at" timestamp with time zone,
  "active_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancellation_reason" text,
  "deal_source" deal_source DEFAULT 'marketplace'::deal_source NOT NULL,
  "counterparty_confirmed" boolean DEFAULT false NOT NULL,
  "counterparty_confirmed_at" timestamp with time zone,
  "counterparty_confirmation_token" text,
  "imported_by_org_id" uuid,
  "import_notes" text,
  "total_value" numeric,
  "payment_days_actual" numeric,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.documents (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "org_id" uuid,
  "bank_id" uuid,
  "entity_type" document_entity_type NOT NULL,
  "entity_id" uuid NOT NULL,
  "document_kind" text NOT NULL,
  "name" text NOT NULL,
  "storage_path" text NOT NULL,
  "file_size_bytes" bigint,
  "mime_type" text,
  "ai_extracted" boolean DEFAULT false NOT NULL,
  "ai_extraction" jsonb,
  "ai_fraud_score" numeric,
  "ai_fraud_flags" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.financing_request_offers (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "request_id" uuid NOT NULL,
  "bank_id" uuid NOT NULL,
  "offered_rate_apr" numeric NOT NULL,
  "offered_amount" numeric NOT NULL,
  "offered_tenor_days" integer NOT NULL,
  "structure_type" financing_type NOT NULL,
  "conditions" text,
  "notes" text,
  "status" offer_status DEFAULT 'pending'::offer_status NOT NULL,
  "ai_score" numeric,
  "ai_score_reasoning" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.financing_requests (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "deal_id" uuid NOT NULL,
  "requesting_org_id" uuid NOT NULL,
  "structure_type" financing_structure DEFAULT 'open'::financing_structure NOT NULL,
  "financing_type" financing_type,
  "amount_requested" numeric NOT NULL,
  "preferred_tenor_days" integer,
  "preferred_rate_max" numeric,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "custom_terms" jsonb,
  "status" financing_request_status DEFAULT 'open'::financing_request_status NOT NULL,
  "expires_at" timestamp with time zone,
  "ai_market_context" text,
  "ai_risk_assessment" text,
  "ai_recommended_structure" text,
  "accepted_offer_id" uuid,
  "accepted_bank_id" uuid,
  "accepted_at" timestamp with time zone,
  "offer_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.market_signals (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "signal_type" text NOT NULL,
  "country_code" text,
  "commodity" text,
  "value" numeric,
  "metadata" jsonb,
  "source" text,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.marketplace_listings (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "org_id" uuid NOT NULL,
  "listing_type" listing_type NOT NULL,
  "status" listing_status DEFAULT 'draft'::listing_status NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text,
  "subcategory" text,
  "tags" jsonb,
  "quantity" numeric,
  "unit" text,
  "target_price" numeric,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "incoterms" text,
  "delivery_location" text,
  "delivery_deadline" date,
  "payment_terms" text,
  "origin_country" text,
  "ai_summary" text,
  "ai_category_tags" jsonb,
  "ai_price_benchmark" jsonb,
  "network_visible" boolean DEFAULT true NOT NULL,
  "featured" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp with time zone,
  "matched_deal_id" uuid,
  "view_count" integer DEFAULT 0 NOT NULL,
  "offer_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.marketplace_offers (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "listing_id" uuid NOT NULL,
  "from_org_id" uuid NOT NULL,
  "offered_price" numeric NOT NULL,
  "offered_quantity" numeric,
  "proposed_delivery_date" date,
  "proposed_incoterms" text,
  "proposed_payment_terms" text,
  "notes" text,
  "status" offer_status DEFAULT 'pending'::offer_status NOT NULL,
  "current_round" integer DEFAULT 1 NOT NULL,
  "offer_rounds" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ai_analysis" text,
  "ai_recommendation" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notifications (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "user_id" uuid NOT NULL,
  "channel" notification_channel DEFAULT 'both'::notification_channel NOT NULL,
  "event" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "deep_link" text DEFAULT '/'::text NOT NULL,
  "metadata" jsonb,
  "read" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone,
  "email_sent" boolean DEFAULT false NOT NULL,
  "email_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.organizations (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "type" org_type NOT NULL,
  "status" org_status DEFAULT 'pending_kyb'::org_status NOT NULL,
  "legal_name" text,
  "doing_business_as" text,
  "ein" text,
  "business_type" text,
  "state_of_incorporation" text,
  "country_of_incorporation" text DEFAULT 'US'::text NOT NULL,
  "industry_naics" text,
  "website" text,
  "description" text,
  "address_line1" text,
  "address_line2" text,
  "city" text,
  "state" text,
  "zip" text,
  "country" text DEFAULT 'US'::text NOT NULL,
  "primary_contact_name" text,
  "primary_contact_title" text,
  "primary_contact_phone" text,
  "primary_contact_email" text,
  "years_in_operation" integer,
  "annual_revenue_range" text,
  "employee_count_range" text,
  "bank_account_last4" text,
  "bank_routing_number" text,
  "bank_account_type" text,
  "country_of_origin" text,
  "sourcing_countries" jsonb,
  "product_categories" jsonb,
  "kyb_status" kyb_status DEFAULT 'not_started'::kyb_status NOT NULL,
  "kyb_submitted_at" timestamp with time zone,
  "kyb_ai_reviewed_at" timestamp with time zone,
  "kyb_approved_at" timestamp with time zone,
  "kyb_rejection_reason" text,
  "risk_score" integer,
  "risk_tier" risk_tier,
  "risk_flags" jsonb,
  "tariff_exposure" jsonb,
  "credit_score" integer,
  "performance_score" integer,
  "performance_tier" text,
  "network_visible" boolean DEFAULT false NOT NULL,
  "passport_published_at" timestamp with time zone,
  "passport_score" integer,
  "passport_score_updated_at" timestamp with time zone,
  "passport_narrative" text,
  "passport_narrative_updated_at" timestamp with time zone,
  "trade_count_total" integer DEFAULT 0 NOT NULL,
  "trade_volume_total" numeric DEFAULT 0 NOT NULL,
  "avg_payment_days" numeric,
  "dispute_rate_network" numeric,
  "banks_transacted_with" jsonb,
  "primary_bank_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.passport_peer_reviews (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "reviewing_org_id" uuid NOT NULL,
  "reviewed_org_id" uuid NOT NULL,
  "deal_id" uuid,
  "rating" integer NOT NULL,
  "category_scores" jsonb,
  "comment" text,
  "is_public" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.passport_views (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "viewer_org_id" uuid,
  "viewer_bank_id" uuid,
  "viewed_org_id" uuid NOT NULL,
  "context" passport_view_context DEFAULT 'general'::passport_view_context NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.program_enrollments (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "program_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "anchor_org_id" uuid,
  "enrolled_by_user_id" uuid,
  "status" enrollment_status DEFAULT 'onboarding'::enrollment_status NOT NULL,
  "suspension_reason" text,
  "enrolled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.programs (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "bank_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "name" text NOT NULL,
  "financing_types" financing_type[] NOT NULL,
  "program_limit" numeric,
  "per_supplier_sublimit" numeric,
  "min_deal_size" numeric,
  "max_deal_size" numeric,
  "max_invoice_age_days" integer,
  "max_po_fulfillment_days" integer,
  "standard_tenor_days" integer DEFAULT 60 NOT NULL,
  "currency" text DEFAULT 'USD'::text NOT NULL,
  "is_open_account" boolean DEFAULT false NOT NULL,
  "status" program_status DEFAULT 'draft'::program_status NOT NULL,
  "activated_at" timestamp with time zone,
  "discount_schedule" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.recommendations (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "bank_id" uuid,
  "org_id" uuid,
  "transaction_id" uuid,
  "deal_id" uuid,
  "priority" text NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "action_label" text,
  "action_url" text,
  "estimated_impact" text,
  "dismissed" boolean DEFAULT false NOT NULL,
  "actioned" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.room_messages (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "room_id" uuid NOT NULL,
  "user_id" uuid,
  "org_id" uuid,
  "bank_id" uuid,
  "content" text NOT NULL,
  "message_type" room_message_type DEFAULT 'message'::room_message_type NOT NULL,
  "status" room_message_status DEFAULT 'pending_review'::room_message_status NOT NULL,
  "moderated_at" timestamp with time zone,
  "moderation_reason" text,
  "metadata" jsonb,
  "reply_to_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.room_participants (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "room_id" uuid NOT NULL,
  "org_id" uuid,
  "bank_id" uuid,
  "user_id" uuid NOT NULL,
  "role" room_participant_role DEFAULT 'participant'::room_participant_role NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_read_at" timestamp with time zone
);

CREATE TABLE public.room_reports (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "room_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "reported_by_user_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "notes" text,
  "resolved" boolean DEFAULT false NOT NULL,
  "resolved_by_user_id" uuid,
  "resolved_at" timestamp with time zone,
  "resolution" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.rooms (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "room_type" room_type NOT NULL,
  "status" room_status DEFAULT 'active'::room_status NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "category" text,
  "tags" jsonb,
  "created_by_org_id" uuid,
  "created_by_user_id" uuid,
  "deal_id" uuid,
  "is_moderated" boolean DEFAULT true NOT NULL,
  "rules" text,
  "participant_count" integer DEFAULT 0 NOT NULL,
  "message_count" integer DEFAULT 0 NOT NULL,
  "last_message_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.supplier_performance (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "org_id" uuid NOT NULL,
  "bank_id" uuid,
  "on_time_payment_rate" numeric,
  "dispute_rate" numeric,
  "financing_utilization_rate" numeric,
  "avg_advance_rate" numeric,
  "total_transactions" integer DEFAULT 0 NOT NULL,
  "total_financed" numeric DEFAULT 0 NOT NULL,
  "total_deals" integer DEFAULT 0 NOT NULL,
  "total_deal_volume" numeric DEFAULT 0 NOT NULL,
  "performance_tier" text,
  "performance_score" integer,
  "last_calculated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.supply_graph_edges (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "from_org_id" uuid,
  "from_bank_id" uuid,
  "to_org_id" uuid,
  "edge_type" text NOT NULL,
  "program_id" uuid,
  "deal_count" integer DEFAULT 0 NOT NULL,
  "total_volume" numeric DEFAULT 0 NOT NULL,
  "risk_weight" numeric DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transaction_events (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "transaction_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "from_status" transaction_status,
  "to_status" transaction_status,
  "actor_id" uuid,
  "actor_type" text,
  "notes" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transactions (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "program_id" uuid,
  "bank_id" uuid NOT NULL,
  "anchor_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "source" transaction_source DEFAULT 'program'::transaction_source NOT NULL,
  "deal_id" uuid,
  "financing_request_id" uuid,
  "type" financing_type NOT NULL,
  "anchor_initiated" boolean DEFAULT false NOT NULL,
  "status" transaction_status DEFAULT 'draft'::transaction_status NOT NULL,
  "invoice_number" text,
  "invoice_date" date,
  "invoice_due_date" date,
  "po_number" text,
  "po_date" date,
  "expected_fulfillment_date" date,
  "po_value" numeric,
  "invoice_amount" numeric NOT NULL,
  "financing_amount_requested" numeric NOT NULL,
  "financing_amount_approved" numeric,
  "financing_rate_apr" numeric,
  "tenor_days" integer,
  "fee_amount" numeric,
  "net_proceeds" numeric,
  "anchor_repayment_amount" numeric,
  "repayment_due_date" date,
  "original_due_date" date,
  "requested_extension_days" integer,
  "goods_services_description" text,
  "rejection_reason" text,
  "bank_approval_notes" text,
  "supplier_notes" text,
  "anchor_confirmed_at" timestamp with time zone,
  "anchor_confirmed_by_user_id" uuid,
  "disbursed_at" timestamp with time zone,
  "disbursed_by_user_id" uuid,
  "disbursement_reference" text,
  "supplier_paid_at" timestamp with time zone,
  "repaid_at" timestamp with time zone,
  "repaid_by_user_id" uuid,
  "repayment_reference" text,
  "early_repayment" boolean DEFAULT false NOT NULL,
  "actual_fee_amount" numeric,
  "esign_document_id" text,
  "esign_document_url" text,
  "bank_signed_at" timestamp with time zone,
  "anchor_signed_at" timestamp with time zone,
  "supplier_signed_at" timestamp with time zone,
  "esign_completed_at" timestamp with time zone,
  "discount_rate" numeric,
  "early_payment_date" date,
  "discount_amount" numeric,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
  "id" uuid NOT NULL,
  "email" text NOT NULL,
  "full_name" text,
  "role" user_role NOT NULL,
  "bank_id" uuid,
  "org_id" uuid,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamp with time zone,
  "avatar_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ===== Constraints =====
ALTER TABLE public.agent_actions ADD CONSTRAINT "agent_actions_pkey" PRIMARY KEY (id);
ALTER TABLE public.agent_preferences ADD CONSTRAINT "agent_preferences_pkey" PRIMARY KEY (id);
ALTER TABLE public.ai_limits ADD CONSTRAINT "ai_limits_pkey" PRIMARY KEY (id);
ALTER TABLE public.ai_negotiation_state ADD CONSTRAINT "ai_negotiation_state_pkey" PRIMARY KEY (id);
ALTER TABLE public.ai_usage ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY (id);
ALTER TABLE public.banks ADD CONSTRAINT "banks_pkey" PRIMARY KEY (id);
ALTER TABLE public.collateral_requirements ADD CONSTRAINT "collateral_requirements_pkey" PRIMARY KEY (id);
ALTER TABLE public.credit_decision_records ADD CONSTRAINT "credit_decision_records_pkey" PRIMARY KEY (id);
ALTER TABLE public.credit_scores ADD CONSTRAINT "credit_scores_pkey" PRIMARY KEY (id);
ALTER TABLE public.deals ADD CONSTRAINT "deals_pkey" PRIMARY KEY (id);
ALTER TABLE public.documents ADD CONSTRAINT "documents_pkey" PRIMARY KEY (id);
ALTER TABLE public.financing_request_offers ADD CONSTRAINT "financing_request_offers_pkey" PRIMARY KEY (id);
ALTER TABLE public.financing_requests ADD CONSTRAINT "financing_requests_pkey" PRIMARY KEY (id);
ALTER TABLE public.market_signals ADD CONSTRAINT "market_signals_pkey" PRIMARY KEY (id);
ALTER TABLE public.marketplace_listings ADD CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY (id);
ALTER TABLE public.marketplace_offers ADD CONSTRAINT "marketplace_offers_pkey" PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);
ALTER TABLE public.organizations ADD CONSTRAINT "organizations_pkey" PRIMARY KEY (id);
ALTER TABLE public.passport_peer_reviews ADD CONSTRAINT "passport_peer_reviews_pkey" PRIMARY KEY (id);
ALTER TABLE public.passport_views ADD CONSTRAINT "passport_views_pkey" PRIMARY KEY (id);
ALTER TABLE public.program_enrollments ADD CONSTRAINT "program_enrollments_pkey" PRIMARY KEY (id);
ALTER TABLE public.programs ADD CONSTRAINT "programs_pkey" PRIMARY KEY (id);
ALTER TABLE public.recommendations ADD CONSTRAINT "recommendations_pkey" PRIMARY KEY (id);
ALTER TABLE public.room_messages ADD CONSTRAINT "room_messages_pkey" PRIMARY KEY (id);
ALTER TABLE public.room_participants ADD CONSTRAINT "room_participants_pkey" PRIMARY KEY (id);
ALTER TABLE public.room_reports ADD CONSTRAINT "room_reports_pkey" PRIMARY KEY (id);
ALTER TABLE public.rooms ADD CONSTRAINT "rooms_pkey" PRIMARY KEY (id);
ALTER TABLE public.supplier_performance ADD CONSTRAINT "supplier_performance_pkey" PRIMARY KEY (id);
ALTER TABLE public.supply_graph_edges ADD CONSTRAINT "supply_graph_edges_pkey" PRIMARY KEY (id);
ALTER TABLE public.transaction_events ADD CONSTRAINT "transaction_events_pkey" PRIMARY KEY (id);
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public.users ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE public.ai_negotiation_state ADD CONSTRAINT "ai_negotiation_state_deal_id_key" UNIQUE (deal_id);
ALTER TABLE public.financing_request_offers ADD CONSTRAINT "financing_request_offers_request_id_bank_id_key" UNIQUE (request_id, bank_id);
ALTER TABLE public.passport_peer_reviews ADD CONSTRAINT "passport_peer_reviews_reviewing_org_id_deal_id_key" UNIQUE (reviewing_org_id, deal_id);
ALTER TABLE public.room_participants ADD CONSTRAINT "room_participants_room_id_user_id_key" UNIQUE (room_id, user_id);
ALTER TABLE public.supplier_performance ADD CONSTRAINT "supplier_performance_org_id_bank_id_key" UNIQUE (org_id, bank_id);
ALTER TABLE public.users ADD CONSTRAINT "users_email_key" UNIQUE (email);
ALTER TABLE public.deals ADD CONSTRAINT "buyer_not_supplier" CHECK ((buyer_org_id <> supplier_org_id));
ALTER TABLE public.passport_peer_reviews ADD CONSTRAINT "no_self_review" CHECK ((reviewing_org_id <> reviewed_org_id));
ALTER TABLE public.passport_peer_reviews ADD CONSTRAINT "passport_peer_reviews_rating_check" CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE public.room_participants ADD CONSTRAINT "participant_context" CHECK ((((org_id IS NOT NULL) AND (bank_id IS NULL)) OR ((bank_id IS NOT NULL) AND (org_id IS NULL))));
ALTER TABLE public.users ADD CONSTRAINT "users_context_check" CHECK ((((bank_id IS NOT NULL) AND (org_id IS NULL)) OR ((org_id IS NOT NULL) AND (bank_id IS NULL)) OR (role = 'strike_admin'::user_role)));
ALTER TABLE public.agent_actions ADD CONSTRAINT "agent_actions_approved_by_user_id_fkey" FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.agent_actions ADD CONSTRAINT "agent_actions_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.agent_actions ADD CONSTRAINT "agent_actions_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.agent_preferences ADD CONSTRAINT "agent_preferences_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.agent_preferences ADD CONSTRAINT "agent_preferences_set_by_user_id_fkey" FOREIGN KEY (set_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.ai_negotiation_state ADD CONSTRAINT "ai_negotiation_state_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE public.ai_usage ADD CONSTRAINT "ai_usage_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE SET NULL;
ALTER TABLE public.ai_usage ADD CONSTRAINT "ai_usage_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.ai_usage ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.collateral_requirements ADD CONSTRAINT "collateral_requirements_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.collateral_requirements ADD CONSTRAINT "collateral_requirements_released_by_user_id_fkey" FOREIGN KEY (released_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.collateral_requirements ADD CONSTRAINT "collateral_requirements_required_by_user_id_fkey" FOREIGN KEY (required_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.collateral_requirements ADD CONSTRAINT "collateral_requirements_reviewed_by_user_id_fkey" FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.collateral_requirements ADD CONSTRAINT "collateral_requirements_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
ALTER TABLE public.credit_decision_records ADD CONSTRAINT "credit_decision_records_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE SET NULL;
ALTER TABLE public.credit_decision_records ADD CONSTRAINT "credit_decision_records_countersigned_by_user_id_fkey" FOREIGN KEY (countersigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.credit_decision_records ADD CONSTRAINT "credit_decision_records_credit_score_id_fkey" FOREIGN KEY (credit_score_id) REFERENCES credit_scores(id) ON DELETE SET NULL;
ALTER TABLE public.credit_decision_records ADD CONSTRAINT "credit_decision_records_decided_by_user_id_fkey" FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.credit_decision_records ADD CONSTRAINT "credit_decision_records_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.credit_scores ADD CONSTRAINT "credit_scores_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.deals ADD CONSTRAINT "deals_buyer_org_id_fkey" FOREIGN KEY (buyer_org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.deals ADD CONSTRAINT "deals_imported_by_org_id_fkey" FOREIGN KEY (imported_by_org_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.deals ADD CONSTRAINT "deals_listing_id_fkey" FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE SET NULL;
ALTER TABLE public.deals ADD CONSTRAINT "deals_offer_id_fkey" FOREIGN KEY (offer_id) REFERENCES marketplace_offers(id) ON DELETE SET NULL;
ALTER TABLE public.deals ADD CONSTRAINT "deals_supplier_org_id_fkey" FOREIGN KEY (supplier_org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.deals ADD CONSTRAINT "fk_deal_financing_request" FOREIGN KEY (financing_request_id) REFERENCES financing_requests(id) ON DELETE SET NULL;
ALTER TABLE public.deals ADD CONSTRAINT "fk_deal_room" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD CONSTRAINT "documents_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.documents ADD CONSTRAINT "documents_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.financing_request_offers ADD CONSTRAINT "financing_request_offers_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.financing_request_offers ADD CONSTRAINT "financing_request_offers_request_id_fkey" FOREIGN KEY (request_id) REFERENCES financing_requests(id) ON DELETE CASCADE;
ALTER TABLE public.financing_requests ADD CONSTRAINT "financing_requests_accepted_bank_id_fkey" FOREIGN KEY (accepted_bank_id) REFERENCES banks(id) ON DELETE SET NULL;
ALTER TABLE public.financing_requests ADD CONSTRAINT "financing_requests_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE public.financing_requests ADD CONSTRAINT "financing_requests_requesting_org_id_fkey" FOREIGN KEY (requesting_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.financing_requests ADD CONSTRAINT "fk_accepted_offer" FOREIGN KEY (accepted_offer_id) REFERENCES financing_request_offers(id) ON DELETE SET NULL;
ALTER TABLE public.marketplace_listings ADD CONSTRAINT "fk_matched_deal" FOREIGN KEY (matched_deal_id) REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE public.marketplace_listings ADD CONSTRAINT "marketplace_listings_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.marketplace_offers ADD CONSTRAINT "marketplace_offers_from_org_id_fkey" FOREIGN KEY (from_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.marketplace_offers ADD CONSTRAINT "marketplace_offers_listing_id_fkey" FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.organizations ADD CONSTRAINT "organizations_primary_bank_id_fkey" FOREIGN KEY (primary_bank_id) REFERENCES banks(id) ON DELETE SET NULL;
ALTER TABLE public.passport_peer_reviews ADD CONSTRAINT "fk_review_deal" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE public.passport_peer_reviews ADD CONSTRAINT "passport_peer_reviews_reviewed_org_id_fkey" FOREIGN KEY (reviewed_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.passport_peer_reviews ADD CONSTRAINT "passport_peer_reviews_reviewing_org_id_fkey" FOREIGN KEY (reviewing_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.passport_views ADD CONSTRAINT "passport_views_viewed_org_id_fkey" FOREIGN KEY (viewed_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.passport_views ADD CONSTRAINT "passport_views_viewer_bank_id_fkey" FOREIGN KEY (viewer_bank_id) REFERENCES banks(id) ON DELETE SET NULL;
ALTER TABLE public.passport_views ADD CONSTRAINT "passport_views_viewer_org_id_fkey" FOREIGN KEY (viewer_org_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.program_enrollments ADD CONSTRAINT "program_enrollments_anchor_org_id_fkey" FOREIGN KEY (anchor_org_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.program_enrollments ADD CONSTRAINT "program_enrollments_enrolled_by_user_id_fkey" FOREIGN KEY (enrolled_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.program_enrollments ADD CONSTRAINT "program_enrollments_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.program_enrollments ADD CONSTRAINT "program_enrollments_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
ALTER TABLE public.programs ADD CONSTRAINT "programs_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.programs ADD CONSTRAINT "programs_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.recommendations ADD CONSTRAINT "recommendations_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.recommendations ADD CONSTRAINT "recommendations_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE public.recommendations ADD CONSTRAINT "recommendations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.recommendations ADD CONSTRAINT "recommendations_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
ALTER TABLE public.room_messages ADD CONSTRAINT "room_messages_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE SET NULL;
ALTER TABLE public.room_messages ADD CONSTRAINT "room_messages_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.room_messages ADD CONSTRAINT "room_messages_reply_to_id_fkey" FOREIGN KEY (reply_to_id) REFERENCES room_messages(id) ON DELETE SET NULL;
ALTER TABLE public.room_messages ADD CONSTRAINT "room_messages_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public.room_messages ADD CONSTRAINT "room_messages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.room_participants ADD CONSTRAINT "room_participants_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.room_participants ADD CONSTRAINT "room_participants_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.room_participants ADD CONSTRAINT "room_participants_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public.room_participants ADD CONSTRAINT "room_participants_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.room_reports ADD CONSTRAINT "room_reports_message_id_fkey" FOREIGN KEY (message_id) REFERENCES room_messages(id) ON DELETE CASCADE;
ALTER TABLE public.room_reports ADD CONSTRAINT "room_reports_reported_by_user_id_fkey" FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.room_reports ADD CONSTRAINT "room_reports_resolved_by_user_id_fkey" FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.room_reports ADD CONSTRAINT "room_reports_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public.rooms ADD CONSTRAINT "rooms_created_by_org_id_fkey" FOREIGN KEY (created_by_org_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.rooms ADD CONSTRAINT "rooms_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.rooms ADD CONSTRAINT "rooms_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE public.supplier_performance ADD CONSTRAINT "supplier_performance_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.supplier_performance ADD CONSTRAINT "supplier_performance_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.supply_graph_edges ADD CONSTRAINT "supply_graph_edges_from_bank_id_fkey" FOREIGN KEY (from_bank_id) REFERENCES banks(id) ON DELETE CASCADE;
ALTER TABLE public.supply_graph_edges ADD CONSTRAINT "supply_graph_edges_from_org_id_fkey" FOREIGN KEY (from_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.supply_graph_edges ADD CONSTRAINT "supply_graph_edges_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE public.supply_graph_edges ADD CONSTRAINT "supply_graph_edges_to_org_id_fkey" FOREIGN KEY (to_org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public.transaction_events ADD CONSTRAINT "transaction_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.transaction_events ADD CONSTRAINT "transaction_events_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_anchor_confirmed_by_user_id_fkey" FOREIGN KEY (anchor_confirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_anchor_id_fkey" FOREIGN KEY (anchor_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE RESTRICT;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_disbursed_by_user_id_fkey" FOREIGN KEY (disbursed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_financing_request_id_fkey" FOREIGN KEY (financing_request_id) REFERENCES financing_requests(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_repaid_by_user_id_fkey" FOREIGN KEY (repaid_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD CONSTRAINT "transactions_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.users ADD CONSTRAINT "users_bank_id_fkey" FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- ===== Functions =====
CREATE OR REPLACE FUNCTION public.current_bank_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT bank_id FROM users WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT org_id FROM users WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.increment_fin_request_offer_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE financing_requests SET
    offer_count = offer_count + 1,
    status = CASE WHEN status = 'open' THEN 'offers_received'::financing_request_status ELSE status END
  WHERE id = NEW.request_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_listing_offer_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE marketplace_listings SET offer_count = offer_count + 1 WHERE id = NEW.listing_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_strike_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role = 'strike_admin' FROM users WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.prevent_self_offer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE id = NEW.listing_id AND org_id = NEW.from_org_id
  ) THEN
    RAISE EXCEPTION 'Organizations cannot submit offers on their own listings';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_room_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'visible' THEN
    UPDATE rooms SET
      message_count = message_count + 1,
      last_message_at = NEW.created_at
    WHERE id = NEW.room_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_room_participant_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE rooms SET participant_count = participant_count + 1 WHERE id = NEW.room_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE rooms SET participant_count = GREATEST(participant_count - 1, 0) WHERE id = OLD.room_id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- ===== Triggers =====
CREATE TRIGGER trg_agent_prefs_updated_at BEFORE UPDATE ON public.agent_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_fin_offers_updated_at BEFORE UPDATE ON public.financing_request_offers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_fin_request_offer_count AFTER INSERT ON public.financing_request_offers FOR EACH ROW EXECUTE FUNCTION increment_fin_request_offer_count();
CREATE TRIGGER trg_fin_requests_updated_at BEFORE UPDATE ON public.financing_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_listings_updated_at BEFORE UPDATE ON public.marketplace_listings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_listing_offer_count AFTER INSERT ON public.marketplace_offers FOR EACH ROW EXECUTE FUNCTION increment_listing_offer_count();
CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON public.marketplace_offers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_prevent_self_offer BEFORE INSERT ON public.marketplace_offers FOR EACH ROW EXECUTE FUNCTION prevent_self_offer();
CREATE TRIGGER trg_orgs_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_programs_updated_at BEFORE UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_room_message_stats AFTER INSERT OR UPDATE OF status ON public.room_messages FOR EACH ROW EXECUTE FUNCTION update_room_on_message();
CREATE TRIGGER trg_room_participant_count AFTER INSERT OR DELETE ON public.room_participants FOR EACH ROW EXECUTE FUNCTION update_room_participant_count();
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_supplier_perf_updated_at BEFORE UPDATE ON public.supplier_performance FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===== Event triggers =====
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

-- ===== Indexes =====
CREATE INDEX idx_agent_actions_entity ON public.agent_actions USING btree (entity_type, entity_id);
CREATE INDEX idx_agent_actions_org ON public.agent_actions USING btree (org_id);
CREATE INDEX idx_ai_usage_org ON public.ai_usage USING btree (org_id, created_at DESC);
CREATE INDEX idx_deals_buyer ON public.deals USING btree (buyer_org_id);
CREATE INDEX idx_deals_imported ON public.deals USING btree (deal_source, counterparty_confirmed) WHERE (deal_source = 'imported'::deal_source);
CREATE INDEX idx_deals_room ON public.deals USING btree (room_id);
CREATE INDEX idx_deals_source ON public.deals USING btree (deal_source);
CREATE INDEX idx_deals_status ON public.deals USING btree (status);
CREATE INDEX idx_deals_supplier ON public.deals USING btree (supplier_org_id);
CREATE INDEX idx_fin_offers_bank ON public.financing_request_offers USING btree (bank_id);
CREATE INDEX idx_fin_offers_request ON public.financing_request_offers USING btree (request_id);
CREATE INDEX idx_fin_requests_deal ON public.financing_requests USING btree (deal_id);
CREATE INDEX idx_fin_requests_open ON public.financing_requests USING btree (status, created_at DESC) WHERE (status = 'open'::financing_request_status);
CREATE INDEX idx_fin_requests_status ON public.financing_requests USING btree (status);
CREATE INDEX idx_listings_active ON public.marketplace_listings USING btree (status, created_at DESC) WHERE (status = 'active'::listing_status);
CREATE INDEX idx_listings_category ON public.marketplace_listings USING btree (category);
CREATE INDEX idx_listings_org ON public.marketplace_listings USING btree (org_id);
CREATE INDEX idx_listings_search ON public.marketplace_listings USING gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(description, ''::text))));
CREATE INDEX idx_listings_status ON public.marketplace_listings USING btree (status);
CREATE INDEX idx_listings_type ON public.marketplace_listings USING btree (listing_type);
CREATE INDEX idx_offers_from_org ON public.marketplace_offers USING btree (from_org_id);
CREATE INDEX idx_offers_listing ON public.marketplace_offers USING btree (listing_id);
CREATE INDEX idx_offers_status ON public.marketplace_offers USING btree (status);
CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id, read, created_at DESC);
CREATE INDEX idx_orgs_network_visible ON public.organizations USING btree (network_visible) WHERE (network_visible = true);
CREATE INDEX idx_orgs_passport_score ON public.organizations USING btree (passport_score DESC NULLS LAST);
CREATE INDEX idx_orgs_primary_bank ON public.organizations USING btree (primary_bank_id);
CREATE INDEX idx_orgs_status ON public.organizations USING btree (status);
CREATE INDEX idx_orgs_type ON public.organizations USING btree (type);
CREATE INDEX idx_passport_reviews_reviewed ON public.passport_peer_reviews USING btree (reviewed_org_id);
CREATE INDEX idx_passport_views_viewed ON public.passport_views USING btree (viewed_org_id, created_at DESC);
CREATE INDEX idx_room_messages_pending ON public.room_messages USING btree (status) WHERE (status = 'pending_review'::room_message_status);
CREATE INDEX idx_room_messages_room ON public.room_messages USING btree (room_id, created_at);
CREATE INDEX idx_room_messages_status ON public.room_messages USING btree (status);
CREATE INDEX idx_rooms_category ON public.rooms USING btree (category);
CREATE INDEX idx_rooms_deal ON public.rooms USING btree (deal_id);
CREATE INDEX idx_rooms_status ON public.rooms USING btree (status);
CREATE INDEX idx_rooms_type ON public.rooms USING btree (room_type);
CREATE INDEX idx_transactions_anchor ON public.transactions USING btree (anchor_id);
CREATE INDEX idx_transactions_bank ON public.transactions USING btree (bank_id);
CREATE INDEX idx_transactions_deal ON public.transactions USING btree (deal_id);
CREATE INDEX idx_transactions_source ON public.transactions USING btree (source);
CREATE INDEX idx_transactions_status ON public.transactions USING btree (status);
CREATE INDEX idx_transactions_supplier ON public.transactions USING btree (supplier_id);
