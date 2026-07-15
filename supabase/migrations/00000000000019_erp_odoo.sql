-- Add extra_config to erp_connections for provider-specific fields (e.g. Odoo db_name)
-- Also expand erp_type to include 'odoo'

ALTER TABLE erp_connections
  ADD COLUMN IF NOT EXISTS extra_config jsonb DEFAULT '{}';
