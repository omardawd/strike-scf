-- Extend invitation_status enum with values needed for bank-approval workflow
-- Run this in the Supabase SQL editor or via: supabase db push
ALTER TYPE invitation_status ADD VALUE IF NOT EXISTS 'pending_bank_review';
ALTER TYPE invitation_status ADD VALUE IF NOT EXISTS 'declined';
