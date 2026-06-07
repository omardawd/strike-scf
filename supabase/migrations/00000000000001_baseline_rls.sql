-- Baseline row-level security for Strike SCF — generated from the live Supabase DB.
-- Enables RLS on every public table and recreates all policies. Apply after baseline_schema.

-- ===== Enable RLS =====
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_negotiation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collateral_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_request_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_peer_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ===== Policies =====

-- agent_preferences
CREATE POLICY "agent_prefs_own" ON public.agent_preferences
  AS PERMISSIVE FOR ALL
  TO public
  USING (((org_id = current_org_id()) OR is_strike_admin()));

-- deals
CREATE POLICY "deals_parties" ON public.deals
  AS PERMISSIVE FOR ALL
  TO public
  USING (((buyer_org_id = current_org_id()) OR (supplier_org_id = current_org_id()) OR is_strike_admin()));

-- financing_request_offers
CREATE POLICY "fin_offers_access" ON public.financing_request_offers
  AS PERMISSIVE FOR ALL
  TO public
  USING (((bank_id = current_bank_id()) OR (( SELECT financing_requests.requesting_org_id
   FROM financing_requests
  WHERE (financing_requests.id = financing_request_offers.request_id)) = current_org_id()) OR is_strike_admin()));

-- financing_requests
CREATE POLICY "fin_requests_banks" ON public.financing_requests
  AS PERMISSIVE FOR SELECT
  TO public
  USING (((status = 'open'::financing_request_status) AND (current_bank_id() IS NOT NULL)));
CREATE POLICY "fin_requests_parties" ON public.financing_requests
  AS PERMISSIVE FOR ALL
  TO public
  USING (((requesting_org_id = current_org_id()) OR (( SELECT deals.buyer_org_id
   FROM deals
  WHERE (deals.id = financing_requests.deal_id)) = current_org_id()) OR (( SELECT deals.supplier_org_id
   FROM deals
  WHERE (deals.id = financing_requests.deal_id)) = current_org_id()) OR is_strike_admin()));

-- marketplace_listings
CREATE POLICY "listings_own" ON public.marketplace_listings
  AS PERMISSIVE FOR ALL
  TO public
  USING (((org_id = current_org_id()) OR is_strike_admin()));
CREATE POLICY "listings_public" ON public.marketplace_listings
  AS PERMISSIVE FOR SELECT
  TO public
  USING (((status = 'active'::listing_status) AND (network_visible = true)));

-- marketplace_offers
CREATE POLICY "offers_access" ON public.marketplace_offers
  AS PERMISSIVE FOR ALL
  TO public
  USING (((from_org_id = current_org_id()) OR (( SELECT marketplace_listings.org_id
   FROM marketplace_listings
  WHERE (marketplace_listings.id = marketplace_offers.listing_id)) = current_org_id()) OR is_strike_admin()));

-- notifications
CREATE POLICY "notifications_own" ON public.notifications
  AS PERMISSIVE FOR ALL
  TO public
  USING ((user_id = auth.uid()));

-- organizations
CREATE POLICY "orgs_own_data" ON public.organizations
  AS PERMISSIVE FOR ALL
  TO public
  USING (((id = current_org_id()) OR is_strike_admin()));
CREATE POLICY "orgs_passport_public" ON public.organizations
  AS PERMISSIVE FOR SELECT
  TO public
  USING (((network_visible = true) AND (status = 'active'::org_status)));

-- programs
CREATE POLICY "programs_bank" ON public.programs
  AS PERMISSIVE FOR ALL
  TO public
  USING (((bank_id = current_bank_id()) OR is_strike_admin()));

-- room_messages
CREATE POLICY "room_messages_insert" ON public.room_messages
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (((user_id = auth.uid()) AND ((( SELECT rooms.room_type
   FROM rooms
  WHERE (rooms.id = room_messages.room_id)) = 'public'::room_type) OR (( SELECT count(*) AS count
   FROM room_participants
  WHERE ((room_participants.room_id = room_messages.room_id) AND (room_participants.user_id = auth.uid()))) > 0))));
CREATE POLICY "room_messages_visible" ON public.room_messages
  AS PERMISSIVE FOR SELECT
  TO public
  USING (((status = 'visible'::room_message_status) AND ((( SELECT rooms.room_type
   FROM rooms
  WHERE (rooms.id = room_messages.room_id)) = 'public'::room_type) OR (( SELECT count(*) AS count
   FROM room_participants
  WHERE ((room_participants.room_id = room_messages.room_id) AND (room_participants.user_id = auth.uid()))) > 0))));

-- rooms
CREATE POLICY "rooms_private" ON public.rooms
  AS PERMISSIVE FOR ALL
  TO public
  USING (((( SELECT count(*) AS count
   FROM room_participants
  WHERE ((room_participants.room_id = room_participants.id) AND (room_participants.user_id = auth.uid()))) > 0) OR is_strike_admin()));
CREATE POLICY "rooms_public" ON public.rooms
  AS PERMISSIVE FOR SELECT
  TO public
  USING (((room_type = 'public'::room_type) AND (status = 'active'::room_status)));

-- transactions
CREATE POLICY "transactions_anchor" ON public.transactions
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((anchor_id = current_org_id()));
CREATE POLICY "transactions_bank" ON public.transactions
  AS PERMISSIVE FOR ALL
  TO public
  USING (((bank_id = current_bank_id()) OR is_strike_admin()));
CREATE POLICY "transactions_supplier" ON public.transactions
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((supplier_id = current_org_id()));
