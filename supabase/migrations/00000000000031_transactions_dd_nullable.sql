-- Dynamic Discounting transactions are a direct anchor-to-supplier early
-- payment with no bank involved (repayment_routing = 'direct'), but
-- transactions.bank_id and financing_amount_requested were NOT NULL with no
-- default, inherited from the bank-financing-only original design. This made
-- every DD offer insert fail with a not-null violation.
ALTER TABLE public.transactions ALTER COLUMN bank_id DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN financing_amount_requested DROP NOT NULL;
