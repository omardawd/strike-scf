# Skill: scf-domain

## When to use this skill
Read this before building anything involving transactions, programs, KYB, risk scoring, credit decisions, collateral, or supplier performance.

---

## SCF glossary

| Term | Meaning in Strike |
|------|------------------|
| **Program** | A bank-created financing facility. Has a limit, tenor, currency, financing types, discount schedule. |
| **Enrollment** | When an anchor or supplier joins a program (`program_enrollments`). |
| **Transaction** | A financing request. Supplier submits invoice → anchor approves → bank funds. |
| **Anchor** | Large buyer (e.g. Pacific Dynamics). Approves invoices, initiates transactions. |
| **Supplier** | SMB seller. Submits invoices, receives early payment. |
| **Bank** | Funder (e.g. Atlas Bank). Creates programs, reviews KYB, makes credit decisions, disburses funds. |
| **Reverse Factoring** | Bank pays supplier early; anchor repays bank on invoice due date. |
| **Factoring** | Supplier sells receivable to bank at a discount. |
| **PO Financing** | Bank finances purchase orders, not invoices. |
| **Tenor** | Days from funding (`disbursed_at`) to repayment due (`repayment_due_date`). |
| **Discount Rate** | Annualized rate. Field: `transactions.discount_rate` (also `financing_rate_apr`). |
| **KYB** | Know Your Business — compliance verification for organizations. |
| **Collateral** | Security requirements tracked in `collateral_requirements`. Documents stored in `documents` table. |
| **Risk Tier** | `organizations.risk_tier`: `A|B|C|D` (formal credit tier). Separate from display tiers (green/amber/red) from risk score. |
| **Credit Decision** | Bank's formal go/no-go on an org, logged in `credit_decision_records`. |
| **Transaction Event** | Every status change is logged to `transaction_events`. |

---

## Transaction flow

```
Supplier submits invoice
  → status: pending_anchor_initiation
Anchor initiates
  → status: pending_anchor_approval
Anchor approves invoice amount
  → status: pending_anchor_confirmation
Anchor confirms supplier identity
  → status: pending_bank_review
Bank credit officer reviews
  → (may request more info → more_info_requested)
Bank approves financing
  → status: financing_approved_pending_collateral (if collateral required)
  → status: financing_approved
Bank disburses funds  [disbursed_at, disbursed_by_user_id set]
  → status: funded
Goods delivered
  → status: pending_delivery_confirmation → delivery_confirmed
Repayment date arrives
  → status: repayment_due → completed  [repaid_at, repayment_reference set]

Failure states: rejected | cancelled | in_dispute
```

Every transition is logged to `transaction_events` with `event_type`, `from_status`, `to_status`, `actor_id`, `actor_type`.

---

## Key transaction fields

```typescript
// Two separate amounts — always use the right one
transactions.financing_amount_requested  // what supplier asked for
transactions.financing_amount_approved   // what bank approved (may be less)

// Two due dates — different purposes
transactions.invoice_due_date    // original invoice due date
transactions.repayment_due_date  // when bank gets repaid by anchor

// Fee fields
transactions.fee_amount          // estimated fee
transactions.actual_fee_amount   // final fee at repayment
transactions.net_proceeds        // what supplier actually receives
transactions.anchor_repayment_amount  // what anchor owes bank

// e-sign fields
transactions.esign_document_id, esign_document_url
transactions.bank_signed_at, anchor_signed_at, supplier_signed_at, esign_completed_at
```

---

## Financing calculation

```typescript
// Amount supplier receives:
// net_proceeds = financing_amount_approved - fee_amount
// fee = financing_amount_approved × (discount_rate / 100) × (tenor_days / 360)

// Example: $100k invoice, $90k approved, 3.5% rate, 60 days
// fee = $90,000 × 0.035 × (60/360) = $525
// net_proceeds = $89,475
```

---

## Risk scoring (from /api/risk/score)

Four 25-point components → total 0–100:

```
1. KYB/Compliance       from organizations.kyb_status
2. Tariff/Geo exposure  from market_signals WHERE signal_type='country_risk' AND country_code=org.country_of_origin
3. Transaction perf.    (total - rejected) / total transactions for supplier
4. Financial health     from credit_scores.total_score or organizations.credit_score
```

Display tiers: green ≥70, amber 45–69, red <45
Stored on: `organizations.risk_score`, `organizations.risk_flags` (jsonb), `organizations.tariff_exposure` (jsonb)

Formal credit tier: `organizations.risk_tier` — values `A|B|C|D` — set via the credit decision process, NOT by the risk scoring API.

---

## Credit score components (credit_scores table)

```
score_business_longevity       (from years_in_operation)
score_revenue_scale            (from annual_revenue_range)
score_document_completeness    (from KYB documents)
score_financial_health         (from financials)
score_program_fit              (fit with program parameters)
score_counterparty_tenure      (history with anchor)
total_score                    (sum)
risk_tier                      (A|B|C|D derived from total)
```

Credit decisions (`credit_decision_records`) reference a `credit_score_id` and record the formal approved/rejected/override outcome.

---

## Documents (unified table)

There is ONE `documents` table for all files in the system. No separate kyb_documents or collateral table.

```typescript
// entity_type tells you what the document belongs to:
// 'organization' → KYB documents (entity_id = org_id)
// 'transaction'  → transaction documents (entity_id = transaction_id)
// 'collateral'   → collateral submissions (entity_id = collateral_requirement_id)

// Fetch KYB docs for an org:
await adminClient
  .from('documents')
  .select('*')
  .eq('entity_type', 'organization')
  .eq('entity_id', org_id)

// document_kind examples: 'articles_of_incorporation', 'financial_statements',
// 'invoice', 'purchase_order', 'delivery_receipt', 'collateral_pledge'
```

---

## Collateral requirements

`collateral_requirements` tracks what collateral is needed and its status:
- `level` — whether it's org-level or transaction-level
- `collateral_type` — type of security
- `status`: pending → submitted → approved | rejected | waived | released
- Documents submitted as collateral are stored in the `documents` table with `entity_type='collateral'`

---

## Supplier performance (supplier_performance table)

Separate from `organizations.performance_score`. The `supplier_performance` table has the full computed metrics:
```
on_time_payment_rate, dispute_rate, financing_utilization_rate,
avg_advance_rate, total_transactions, total_financed,
performance_tier (preferred|standard|under_review), performance_score
```
`organizations.performance_score` and `organizations.performance_tier` mirror the latest values for quick access.

---

## Supply graph

`supply_graph_edges` tracks relationships between organizations:
- `from_org_id` → `to_org_id` with `edge_type`
- `transaction_count`, `total_volume`, `risk_weight` — computed metrics
- Used by `components/supply-graph.tsx` for the network visualization

---

## Invitations

```typescript
// Key fields to know:
invitations.anchor_org_id   // which anchor org is inviting (NOT org_id)
invitations.role            // 'anchor' (bank invites anchor) or 'supplier' (anchor invites supplier)
invitations.invited_by_actor_type  // 'bank' or 'anchor'
invitations.invitation_mode // 'standard' | 'known_counterparty' | 'custom_kyb'
invitations.prefilled_kyb   // jsonb — pre-fill KYB form for known counterparties
invitations.required_documents // jsonb — custom doc requirements
```

---

## AI limits

Limits are checked from `ai_limits` table before falling back to hardcoded defaults:
- `scope`: user | org | bank | global
- `scope_id`: the relevant user_id, org_id, or bank_id
- Bank-level limits override global; user-level limits override bank-level