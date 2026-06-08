-- ============================================================
-- Migration 00000000000008 — Anchor Supplier Networks
-- ============================================================

-- G1.1 anchor_networks
CREATE TABLE IF NOT EXISTS anchor_networks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  visibility_default    TEXT NOT NULL DEFAULT 'public'
                        CHECK (visibility_default IN ('public', 'network_only')),
  member_count          INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchor_networks_anchor_org ON anchor_networks(anchor_org_id);

-- G1.2 anchor_network_members
CREATE TABLE IF NOT EXISTS anchor_network_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id            UUID NOT NULL REFERENCES anchor_networks(id) ON DELETE CASCADE,
  supplier_org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited', 'active', 'declined', 'suspended', 'removed')),
  invited_at            TIMESTAMPTZ DEFAULT NOW(),
  invited_by_user_id    UUID REFERENCES users(id),
  joined_at             TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  removed_at            TIMESTAMPTZ,
  removed_by_user_id    UUID REFERENCES users(id),
  buyer_notes           TEXT,
  UNIQUE(network_id, supplier_org_id)
);

CREATE INDEX IF NOT EXISTS idx_network_members_network  ON anchor_network_members(network_id);
CREATE INDEX IF NOT EXISTS idx_network_members_supplier ON anchor_network_members(supplier_org_id);
CREATE INDEX IF NOT EXISTS idx_network_members_status   ON anchor_network_members(network_id, status);

-- G1.3 network_invite_tokens
CREATE TABLE IF NOT EXISTS network_invite_tokens (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token                 TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  network_id            UUID NOT NULL REFERENCES anchor_networks(id) ON DELETE CASCADE,
  anchor_org_id         UUID NOT NULL REFERENCES organizations(id),
  invited_email         TEXT NOT NULL,
  invited_by_user_id    UUID REFERENCES users(id),
  prefill_company_name  TEXT,
  prefill_country       TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at            TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  accepted_at           TIMESTAMPTZ,
  accepted_by_org_id    UUID REFERENCES organizations(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_tokens_token   ON network_invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_network ON network_invite_tokens(network_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_email   ON network_invite_tokens(invited_email);

-- G1.4 marketplace_listings visibility columns
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'network_only')),
  ADD COLUMN IF NOT EXISTS network_id UUID REFERENCES anchor_networks(id);

CREATE INDEX IF NOT EXISTS idx_listings_network ON marketplace_listings(network_id)
  WHERE network_id IS NOT NULL;

-- G1.5 financing_requests visibility columns
ALTER TABLE financing_requests
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'network_only')),
  ADD COLUMN IF NOT EXISTS network_id UUID REFERENCES anchor_networks(id);

-- G1.6 RLS policies
ALTER TABLE anchor_networks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'anchor_networks' AND policyname = 'anchor_networks_owner'
  ) THEN
    CREATE POLICY "anchor_networks_owner" ON anchor_networks
      USING (anchor_org_id IN (
        SELECT org_id FROM users WHERE id = auth.uid()
      ));
  END IF;
END $$;

ALTER TABLE anchor_network_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'anchor_network_members' AND policyname = 'network_members_anchor'
  ) THEN
    CREATE POLICY "network_members_anchor" ON anchor_network_members
      USING (network_id IN (
        SELECT id FROM anchor_networks WHERE anchor_org_id IN (
          SELECT org_id FROM users WHERE id = auth.uid()
        )
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'anchor_network_members' AND policyname = 'network_members_supplier_own'
  ) THEN
    CREATE POLICY "network_members_supplier_own" ON anchor_network_members
      USING (supplier_org_id IN (
        SELECT org_id FROM users WHERE id = auth.uid()
      ));
  END IF;
END $$;

ALTER TABLE network_invite_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'network_invite_tokens' AND policyname = 'invite_tokens_anchor'
  ) THEN
    CREATE POLICY "invite_tokens_anchor" ON network_invite_tokens
      USING (anchor_org_id IN (
        SELECT org_id FROM users WHERE id = auth.uid()
      ));
  END IF;
END $$;
