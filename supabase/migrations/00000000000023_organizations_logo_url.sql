-- organizations.logo_url was referenced by app/api/settings/logo/route.ts but never
-- actually existed as a column — every org (non-bank) logo upload silently failed
-- to persist because the route didn't check the update() error before reporting
-- success back to the user. banks.logo_url already exists; add the equivalent here.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text;
