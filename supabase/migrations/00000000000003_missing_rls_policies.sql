-- Add RLS policies to 6 tables that had RLS enabled but NO policies (deny-all gap
-- found in T1.2). Every API route uses the service-role client, which bypasses RLS,
-- so these are defense-in-depth: they mirror the manual .eq() scoping the routes do.
--
-- Helpers current_org_id() / current_bank_id() / is_strike_admin() (from the baseline)
-- are SECURITY DEFINER and bypass RLS, so subqueries through them do not recurse.
-- current_org_id() is NULL for bank users and current_bank_id() is NULL for org users,
-- so the cross-role predicates naturally evaluate false rather than matching.
--
-- is_strike_admin() is OR'd into every SELECT policy to match the convention of the
-- 19 existing policies (the platform super-role). Org/bank scoping is unchanged by it.

-- Avoids "infinite recursion detected in policy" — a room_participants policy cannot
-- subquery room_participants directly; this SECURITY DEFINER lookup runs RLS-free.
CREATE OR REPLACE FUNCTION public.is_room_participant(p_room_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM room_participants
    WHERE room_id = p_room_id AND user_id = auth.uid()
  );
$function$;

-- ===== users — read + update own row only (no insert: handled by auth trigger; no delete) =====
CREATE POLICY "users_select_own" ON public.users
  AS PERMISSIVE FOR SELECT
  TO public
  USING ((id = auth.uid()) OR is_strike_admin());

CREATE POLICY "users_update_own" ON public.users
  AS PERMISSIVE FOR UPDATE
  TO public
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ===== room_participants — co-participants of a room; banks tied to the room's deal =====
CREATE POLICY "room_participants_read" ON public.room_participants
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    is_room_participant(room_id)
    OR EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = room_participants.room_id
        AND r.deal_id IS NOT NULL
        AND (
          EXISTS (SELECT 1 FROM transactions t
                   WHERE t.deal_id = r.deal_id AND t.bank_id = current_bank_id())
          OR EXISTS (SELECT 1 FROM financing_requests fr
                      WHERE fr.deal_id = r.deal_id AND fr.accepted_bank_id = current_bank_id())
        )
    )
    OR is_strike_admin()
  );

-- ===== documents — org reads its own; bank reads docs for orgs enrolled in its programs =====
-- (no INSERT/UPDATE/DELETE policy → writes are service-role only, by design)
CREATE POLICY "documents_read" ON public.documents
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    (org_id = current_org_id())
    OR (org_id IN (
      SELECT pe.org_id FROM program_enrollments pe
      JOIN programs p ON p.id = pe.program_id
      WHERE p.bank_id = current_bank_id()
    ))
    OR is_strike_admin()
  );

-- ===== transaction_events — parties to the transaction; the financing bank =====
-- "transactions in their programs" is implemented as transactions.bank_id (always set,
-- and broader than program_id which is NULL for marketplace-sourced transactions).
CREATE POLICY "transaction_events_read" ON public.transaction_events
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.id = transaction_events.transaction_id
        AND (
          t.anchor_id = current_org_id()
          OR t.supplier_id = current_org_id()
          OR t.bank_id = current_bank_id()
        )
    )
    OR is_strike_admin()
  );

-- ===== program_enrollments — org reads its own; bank reads enrollments in its programs =====
CREATE POLICY "program_enrollments_read" ON public.program_enrollments
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    (org_id = current_org_id())
    OR (program_id IN (SELECT id FROM programs WHERE bank_id = current_bank_id()))
    OR is_strike_admin()
  );

-- ===== collateral_requirements — org reads its own; bank reads collateral in its programs =====
-- Covers both transaction-level (via transactions.bank_id) and org-level collateral
-- (via the org's enrollment in one of the bank's programs).
CREATE POLICY "collateral_requirements_read" ON public.collateral_requirements
  AS PERMISSIVE FOR SELECT
  TO public
  USING (
    (org_id = current_org_id())
    OR (transaction_id IN (SELECT id FROM transactions WHERE bank_id = current_bank_id()))
    OR (org_id IN (
      SELECT pe.org_id FROM program_enrollments pe
      JOIN programs p ON p.id = pe.program_id
      WHERE p.bank_id = current_bank_id()
    ))
    OR is_strike_admin()
  );
