-- Adds RLS policies for the 11 tables that had RLS ENABLED (via
-- 00000000000001_baseline_rls.sql) but ZERO policies — silently deny-all
-- to anon/authenticated-key access. See docs/enterprise-readiness/
-- ASSESSMENT.md P1-1 for the full audit.
--
-- This is defense-in-depth, not a behavior change for the app today: every
-- API route reads/writes these tables exclusively through the service-role
-- client, which bypasses RLS entirely (the same pattern the baseline
-- migration's own comments describe for the tables it already covers). The
-- gap stops being purely academic the moment any of these tables is queried
-- with an anon/authenticated key — e.g. a future Supabase Realtime
-- subscription (00000000000033 already registered several other tables for
-- Realtime, which relies on RLS to filter what a client can see).
--
-- Forward-only: this does not edit 00000000000001, per the engagement rule
-- against editing an already-applied migration as the only RLS fix.

-- agent_actions — the AI action/audit log. Own org, own bank, or strike_admin.
CREATE POLICY "agent_actions_scoped" ON public.agent_actions
  AS PERMISSIVE FOR ALL
  TO public
  USING (((org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()));

-- ai_limits — daily/monthly AI usage caps. Global limits are non-sensitive
-- reference numbers; scoped limits are visible only to their own scope.
CREATE POLICY "ai_limits_scoped" ON public.ai_limits
  AS PERMISSIVE FOR ALL
  TO public
  USING ((
    is_strike_admin()
    OR scope = 'global'
    OR (scope = 'user' AND scope_id = auth.uid())
    OR (scope = 'org' AND scope_id = current_org_id())
    OR (scope = 'bank' AND scope_id = current_bank_id())
  ));

-- ai_negotiation_state — confirmed orphaned (zero reads/writes anywhere in
-- the app, per apps/web/CLAUDE.md; agent_negotiations is the real table).
-- Policy added for completeness/consistency, scoped via the deal it names.
CREATE POLICY "ai_negotiation_state_scoped" ON public.ai_negotiation_state
  AS PERMISSIVE FOR ALL
  TO public
  USING ((
    is_strike_admin()
    OR EXISTS (
      SELECT 1 FROM public.deals
      WHERE deals.id = ai_negotiation_state.deal_id
        AND (deals.buyer_org_id = current_org_id() OR deals.supplier_org_id = current_org_id())
    )
  ));

-- ai_usage — per-call token/cost logging. Own user, own org, own bank, or strike_admin.
CREATE POLICY "ai_usage_scoped" ON public.ai_usage
  AS PERMISSIVE FOR ALL
  TO public
  USING ((
    user_id = auth.uid()
    OR org_id = current_org_id()
    OR bank_id = current_bank_id()
    OR is_strike_admin()
  ));

-- banks — own bank's users, any org whose organizations.primary_bank_id points
-- at this bank (orgs need to read their own bank's public info), or strike_admin.
CREATE POLICY "banks_scoped" ON public.banks
  AS PERMISSIVE FOR ALL
  TO public
  USING ((
    id = current_bank_id()
    OR is_strike_admin()
    OR EXISTS (
      SELECT 1 FROM public.organizations
      WHERE organizations.id = current_org_id() AND organizations.primary_bank_id = banks.id
    )
  ));

-- credit_decision_records — own org's decisions, own bank's decisions, or strike_admin.
CREATE POLICY "credit_decision_records_scoped" ON public.credit_decision_records
  AS PERMISSIVE FOR ALL
  TO public
  USING (((org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()));

-- credit_scores — own org, own org's servicing bank (via organizations.primary_bank_id), or strike_admin.
CREATE POLICY "credit_scores_scoped" ON public.credit_scores
  AS PERMISSIVE FOR ALL
  TO public
  USING ((
    org_id = current_org_id()
    OR is_strike_admin()
    OR EXISTS (
      SELECT 1 FROM public.organizations
      WHERE organizations.id = credit_scores.org_id AND organizations.primary_bank_id = current_bank_id()
    )
  ));

-- market_signals — non-tenant-scoped reference data (country risk, commodity
-- indices) read by both bank and org risk-scoring flows. Any authenticated
-- user may read; only strike_admin/service-role should write (writes happen
-- exclusively via the service-role cron sync today, which bypasses RLS).
CREATE POLICY "market_signals_authenticated_read" ON public.market_signals
  AS PERMISSIVE FOR ALL
  TO public
  USING ((auth.uid() IS NOT NULL));

-- recommendations — own bank's or own org's recommendations, or strike_admin.
CREATE POLICY "recommendations_scoped" ON public.recommendations
  AS PERMISSIVE FOR ALL
  TO public
  USING (((bank_id = current_bank_id()) OR (org_id = current_org_id()) OR is_strike_admin()));

-- supplier_performance — own org, own servicing bank, or strike_admin.
CREATE POLICY "supplier_performance_scoped" ON public.supplier_performance
  AS PERMISSIVE FOR ALL
  TO public
  USING (((org_id = current_org_id()) OR (bank_id = current_bank_id()) OR is_strike_admin()));

-- supply_graph_edges — either endpoint org, the originating bank, or strike_admin.
CREATE POLICY "supply_graph_edges_scoped" ON public.supply_graph_edges
  AS PERMISSIVE FOR ALL
  TO public
  USING ((
    from_org_id = current_org_id()
    OR to_org_id = current_org_id()
    OR from_bank_id = current_bank_id()
    OR is_strike_admin()
  ));
