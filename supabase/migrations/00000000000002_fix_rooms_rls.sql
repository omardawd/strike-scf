-- Fix the self-referential predicate in the rooms_private RLS policy.
-- The baseline captured the live DB's buggy policy, which tested
-- `room_participants.room_id = room_participants.id` — that never matches a real
-- participant row, so private-room access was effectively denied to participants
-- (only strike_admin could reach private rooms). Corrected to join on rooms.id.

DROP POLICY IF EXISTS "rooms_private" ON public.rooms;

CREATE POLICY "rooms_private" ON public.rooms
  AS PERMISSIVE FOR ALL
  TO public
  USING (
    (
      ( SELECT count(*) AS count
          FROM room_participants
         WHERE ((room_participants.room_id = rooms.id) AND (room_participants.user_id = auth.uid()))
      ) > 0
    )
    OR is_strike_admin()
  );
