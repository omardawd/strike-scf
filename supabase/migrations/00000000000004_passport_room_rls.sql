-- Add RLS policies to the last 3 tables that had RLS enabled but NO policies
-- (deny-all gap found in T1.2): passport_peer_reviews, passport_views, room_reports.
-- Policies mirror how the service-role routes already query each table.

-- ===== passport_peer_reviews — public reviews; author and subject see their own =====
-- Profile reads reviewed_org_id + is_public=true; author checks reviewing_org_id.
-- Writes stay service-role only (no write policy).
CREATE POLICY "peer_reviews_read" ON public.passport_peer_reviews
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    (is_public = true)
    OR (reviewing_org_id = current_org_id())
    OR (reviewed_org_id = current_org_id())
    OR is_strike_admin()
  );

-- ===== passport_views — subject sees who viewed them; viewer sees own rows =====
-- Read as viewed_org_id for owner analytics; inserts via service role (no write policy).
CREATE POLICY "passport_views_read" ON public.passport_views
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    (viewed_org_id = current_org_id())
    OR (viewer_org_id = current_org_id())
    OR (viewer_bank_id = current_bank_id())
    OR is_strike_admin()
  );

-- ===== room_reports — admin reads/resolves; reporters see and file their own =====
-- Future-proofed for a not-yet-built "report a message" UI so it can run without
-- the service role: a user may file (INSERT) and read their own reports; strike_admin
-- reads all and resolves (UPDATE).
CREATE POLICY "room_reports_admin_read" ON public.room_reports
  AS PERMISSIVE FOR SELECT
  TO public
  USING (is_strike_admin() OR (reported_by_user_id = auth.uid()));

CREATE POLICY "room_reports_insert_own" ON public.room_reports
  AS PERMISSIVE FOR INSERT
  TO public
  WITH CHECK (reported_by_user_id = auth.uid());

CREATE POLICY "room_reports_admin_update" ON public.room_reports
  AS PERMISSIVE FOR UPDATE
  TO public
  USING (is_strike_admin())
  WITH CHECK (is_strike_admin());
