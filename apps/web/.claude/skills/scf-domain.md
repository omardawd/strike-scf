# Skill: scf-domain

## When to use this skill
Read this before building anything involving transactions, programs, KYB, risk scoring, or financing calculations. Supply Chain Finance has specific terminology that Claude must use correctly.

---

## SCF glossary (use exact terms in code and UI)

| Term | Meaning in Strike |
|------|------------------|
| **Program** | A bank-created financing facility. Has a limit, tenor, currency, and financing type(s). |
| **Enrollment** | When an anchor or supplier joins a program. Status: invited → onboarding → active. |
| **Transaction** | A financing request. Supplier submits invoice → anchor approves → bank funds. |
| **Anchor** | Large buyer (e.g. Pacific Dynamics). Approves invoices, initiates transactions. |
| **Supplier** | SMB seller (e.g. Westcoast Fabricators). Submits invoices, receives early payment. |
| **Bank** | Funder (e.g. Atlas Bank). Creates programs, reviews KYB, disburses funds. |
| **Reverse Factoring** | Bank pays supplier early; anchor repays bank on invoice due date. |
| **Factoring** | Supplier sells receivable to bank at a discount. Anchor pays bank directly. |
| **PO Financing** | Bank finances purchase orders, not invoices. |
| **Tenor** | Number of days from funding to repayment due date. |
| **Discount Rate** | Annualized rate charged for early payment. Applied pro-rata to tenor. |
| **KYB** | Know Your Business — compliance verification for organizations. |
| **Collateral** | Security documents pledged against financing. |
| **Risk Tier** | green (score ≥70), amber (45–69), red (<45). Computed from 4 components. |

---

## Transaction flow (who does what)

```
Supplier submits invoice
  ↓ status: pending_anchor_initiation
Anchor initiates (or rejects)
  ↓ status: pending_anchor_approval
Anchor approves invoice amount
  ↓ status: pending_anchor_confirmation
Anchor confirms supplier identity
  ↓ status: pending_bank_review
Bank credit officer reviews
  ↓ (may request more info → more_info_requested)
Bank approves financing
  ↓ status: financing_approved_pending_collateral (if needed)
  ↓ status: financing_approved
Bank disburses funds
  ↓ status: funded
Goods delivered
  ↓ status: pending_delivery_confirmation → delivery_confirmed
Repayment date arrives
  ↓ status: repayment_due → completed
```

Failure states at any point: `rejected`, `cancelled`, `in_dispute`.

---

## Financing calculation

```typescript
// Amount financed (typically 80-95% of invoice)
const financed = invoiceAmount * (maxFinancingPct / 100)

// Discount fee charged to supplier
// Standard formula: annualized rate × tenor / 360
const discountFee = financed * (discountRate / 100) * (tenorDays / 360)

// Supplier receives:
const supplierProceeds = financed - discountFee

// Example: $100,000 invoice, 90% financing, 3.5% rate, 60 days
// financed = $90,000
// fee = $90,000 × 0.035 × (60/360) = $525
// supplier gets = $89,475
```

Always display these calculations transparently in the UI.

---

## Risk scoring components

The risk score is 0–100, composed of four 25-point buckets:

```typescript
// 1. KYB/Compliance (25 pts)
kyb_status === 'approved'    → 25
kyb_status === 'submitted'   → 15
kyb_status === 'in_progress' → 5
otherwise                    → 0

// 2. Tariff/Geo exposure (25 pts)
// Based on market_signals.value (country risk 0-100, higher = riskier)
tariffScore = Math.round(25 * (1 - countrySignal.value / 100))
// No signal → default 12 (neutral)

// 3. Transaction performance (25 pts)
onTimeRate = (totalTransactions - rejectedTransactions) / totalTransactions
performanceScore = Math.round(25 * onTimeRate)
// No history → default 12

// 4. Financial health (25 pts)
creditScore > 70  → 25
creditScore ≥ 50  → 15
creditScore < 50  → 5
null              → 12
```

Risk flags are attached: tariff_exposed, geo_risk, single_source, kyb_rejected, kyb_incomplete, no_history.

---

## Program structure

```typescript
interface Program {
  id: string
  bank_id: string
  name: string
  financing_types: FinancingType[]  // ['reverse_factoring', 'factoring', ...]
  status: 'draft' | 'active' | 'paused' | 'closed'
  program_limit: number             // Total pool in USD
  per_supplier_sublimit: number     // Max per supplier
  min_deal_size: number
  max_deal_size: number
  standard_tenor_days: number
  currency: string                  // 'USD' typically
}
```

---

## KYB document types

```
articles_of_incorporation
certificate_of_good_standing
beneficial_ownership
financial_statements
bank_statements
tax_id_document
proof_of_address
```

---

## Invitation flow

1. Bank/Anchor invites by email → `invitations` table, status: `pending`
2. Invitee clicks link → `/invite?token=...`
3. If new user: signup with invite token
4. If existing user: accept invite
5. `invitations.status` → `accepted`
6. `program_enrollments` row created for supplier invites

Invitation roles: `anchor` (bank invites anchor to platform) or `supplier` (anchor invites supplier to program).

---

## Reporting metrics

The `/api/reporting` endpoint returns:
- Monthly volume (invoice amount, financing amount, count by month)
- Status breakdown (count per transaction status)
- Program breakdown (volume per program)
- Portfolio summary (total outstanding, avg rate, total repaid)

For bank portal: all programs under bank.
For anchor portal: programs where enrolled.
For supplier portal: own transactions only.

---

## Collateral types

Collateral is pledged by suppliers during the `financing_approved_pending_collateral` stage:
- `invoice_copy`
- `purchase_order`
- `delivery_receipt`
- `insurance_certificate`
- `guaranty_letter`
