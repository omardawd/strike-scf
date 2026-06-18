-- Allow listing owners to require a minimum PassportScore to submit an offer
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS min_passport_score INTEGER
    CHECK (min_passport_score IS NULL OR (min_passport_score >= 0 AND min_passport_score <= 100));
