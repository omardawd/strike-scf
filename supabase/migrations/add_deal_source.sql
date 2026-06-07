-- Run this in the Supabase SQL editor (Studio > SQL Editor) if the deals table
-- is missing the deal_source column and related counterparty confirmation fields.
--
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS guards throughout).

CREATE TYPE IF NOT EXISTS deal_source AS ENUM ('marketplace', 'imported', 'direct');

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  deal_source deal_source NOT NULL DEFAULT 'marketplace';

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  counterparty_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  counterparty_confirmed_at timestamptz;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  counterparty_confirmation_token text;
