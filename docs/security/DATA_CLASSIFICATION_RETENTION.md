# Data Classification and Retention

**Status: First draft.** This classification is derived from the schema and product surface, not from a formal data-governance exercise — treat it as a starting point to refine with Legal/Compliance input before it's relied upon for a customer's due-diligence questionnaire.

## Classification levels

| Level | Definition | Examples in this system |
|---|---|---|
| **Restricted** | Would cause serious harm if disclosed; subject to the strictest handling | Bank account numbers, routing numbers (`bank_accounts.account_number`/`routing_number`, `organizations.bank_account_last4`/`bank_routing_number`), SSN/EIN-equivalent fields, service-role/API keys, dispatch tokens, encrypted password hashes |
| **Confidential** | Business-sensitive; disclosure would harm Strike or a customer's competitive position or trust | KYB documents, financial statements, credit scores/decisions (`credit_scores`, `credit_decision_records`), contract documents, negotiation history, deal terms, PassportScore reasoning |
| **Internal** | Not for public release but lower sensitivity | Org names, user emails, transaction status/metadata, platform usage stats |
| **Public** | Intended to be visible broadly | Passport profile fields an org has explicitly published (`passport_document`/`passport_certification` document kinds, gated on `network_visible`), marketplace listing content the org chose to post |

## Where each level lives

- **Restricted** data is stored in Supabase Postgres (`bank_accounts`, `organizations.bank_account_*`, `erp_connections.api_key`/`api_secret`/`dispatch_token_hash`) and in Vercel's environment variable store (service keys, never in the repository — see `apps/web/.env.production.example` for what's *documented*, not what's *stored*). It must never appear in application logs (`apps/web/lib/logger.ts`'s `redact()` is the automated backstop for structured logs) or in the `audit_events` table's `before_data`/`after_data` (manual discipline — see `docs/security/SECURE_DEVELOPMENT.md`).
- **Confidential** data lives in Supabase Postgres and Supabase Storage (`kyb-documents`, `deal-documents`, `internal-documents` buckets), accessed only via signed URLs with a 5-minute expiry and an authorization check (`app/api/documents/[id]/url/route.ts`'s `canAccessDocument()`).
- **AI processing**: Confidential and Restricted data may be sent to Anthropic (Claude) as part of KYB scoring, document generation, and chat features — see `docs/security/AI_GOVERNANCE.md` for what's sent and what isn't.

## Retention

**Not yet formally defined.** Today the system retains everything indefinitely — there is no automated deletion, archival, or purge process for any data category. Before pilot launch, define (with Legal/Compliance input, and against whatever regulatory regime applies to the pilot customer's jurisdiction):

- How long KYB documents must be retained after an organization is rejected or a relationship ends (financial services regulation often mandates a *minimum* retention period, which may be longer than what a privacy-minded default would suggest — don't assume "delete promptly" is correct here without checking).
- How long transaction/deal records must be retained (again, likely a regulatory minimum, not a data-minimization question).
- Whether/how a user or organization can request deletion, and what's actually deletable vs. what must be retained for compliance (this tension is common in financial services — document the answer rather than assume).
- Backup retention (see `docs/security/BACKUP_AND_RECOVERY.md`) as it interacts with any deletion request — data deleted from the primary database may persist in backups for the backup retention window.

## Data minimization notes (opportunities, not yet acted on)

- `lib/logger.ts`'s redaction list is a reasonable first pass but is pattern-based, not a guarantee — a genuinely new sensitive field name that doesn't match an existing pattern could leak into logs until the pattern list is updated.
- Demo/seed data (`supabase/seed.sql`, `supabase/seed-demo.sql`) uses fabricated data, not real customer information — confirmed by inspection, worth re-confirming if seed files are ever regenerated from a real environment.

## Owner

*[Assign — this document needs a named owner responsible for keeping it current as new data types/features are added, and for driving the retention-policy decisions above with Legal/Compliance before pilot launch]*
