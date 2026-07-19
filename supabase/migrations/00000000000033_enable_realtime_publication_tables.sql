-- supabase_realtime had ZERO tables registered — every postgres_changes
-- subscription in the frontend (Strike Rooms, marketplace listings/offers,
-- deals, financing requests/offers, agent task chat) was silently a no-op:
-- the client subscribed successfully and no errors were thrown, but the
-- Postgres logical-replication publication never broadcast any change, so
-- nothing ever arrived. Every one of these surfaces was quietly relying on
-- its own poll/refetch fallback (or a manual reload) the whole time.
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_task_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_offers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_listings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.financing_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.financing_request_offers;
