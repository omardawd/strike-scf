# Subprocessors

Third parties that process Strike SCF data as part of operating the platform. **DPA status column is UNVERIFIED for every row** — this engagement had no access to Strike's vendor/legal records. This list itself is derived from code inspection (what the app actually calls), which is a reliable way to know *what* subprocessors exist, but not whether contractual data-protection terms are in place with each.

| Subprocessor | Purpose | Data categories involved | DPA on file? |
|---|---|---|---|
| Supabase | Database (Postgres), Auth, Storage, Realtime | All data categories — this is the primary data store | UNVERIFIED |
| Vercel | Application hosting, edge network, cron (via GitHub Actions, not Vercel's own cron — see `apps/web/CLAUDE.md`'s cron section) | All data categories pass through at request time; Vercel does not persist application data itself beyond logs | UNVERIFIED |
| Anthropic | AI/LLM processing (Claude) — KYB scoring, document generation, chat, negotiation | Confidential/Restricted-adjacent data per feature — see `docs/security/AI_GOVERNANCE.md` for specifics | UNVERIFIED |
| Resend | Transactional email delivery | Email addresses, names, and content of transactional emails (KYB status updates, invitations, etc.) | UNVERIFIED |
| Tavily | Web search (Strike AI's `search_web` tool) | Search queries only — not customer financial/KYB data by design, though a user could in principle include sensitive text in a chat message that triggers a search | UNVERIFIED |

## Not currently subprocessors (confirmed by code inspection)

- No SMS/phone provider is integrated.
- No separate analytics/tracking vendor (no Segment, Mixpanel, Google Analytics, etc. found in dependencies or code).
- No error-tracking vendor is currently active — `apps/web/lib/error-tracking.ts` is a disabled-by-default abstraction; it makes zero external calls until `ERROR_TRACKING_DSN` is configured (`docs/enterprise-readiness/ASSESSMENT.md`, observability finding). If/when a provider (e.g. Sentry) is wired up, it must be added to this table.
- No CDN/image-processing vendor beyond what Vercel provides natively.

## ERP integrations (customer-configured, not Strike-operated)

Distinct from the subprocessors above: when an organization connects their own ERPNext/Odoo/NetSuite/SAP/Dynamics instance (`app/api/erp/connect`), that system is *the customer's own vendor relationship*, not Strike's subprocessor — Strike's app calls out to it on the customer's behalf, using credentials the customer provided. Worth noting in customer-facing documentation so this distinction is clear (Strike is a data controller/processor for its own subprocessors above; for ERP connections, the customer is bringing their own already-contracted vendor).

## Action items

1. Confirm DPA status for each row above with whoever holds the vendor relationships (Owner: *[Assign — likely Legal/Ops]*).
2. Decide whether this document (or a customer-facing equivalent) should be published/shared as part of pilot-customer due diligence — common for enterprise security questionnaires to ask for exactly this list.
3. Keep this list current as subprocessors are added or removed — treat "add a new external API dependency" as requiring a corresponding update here, similar to how `apps/web/.env.production.example` must be updated when a new env var is added (`apps/web/CLAUDE.md`'s own rule).
