# Strike SCF — Authorization Matrix

Companion to [`ASSESSMENT.md`](./ASSESSMENT.md). Roles per `packages/types/index.ts`: `bank_admin`, `bank_credit_officer`, `org_admin`, `org_member`, `strike_admin`. Portal type (`bank|anchor|supplier|admin`) is derived from role + `organizations.type`, not stored separately. "Own tenant" means own `bank_id` (bank roles) or own `org_id` (org roles).

Legend: ✅ Allow · ❌ Deny · 🟡 Allow with conditions (noted) · ❓ Currently unverified/needs a test to confirm actual behavior matches this table

---

## Organizations

| Actor | List/search orgs | Read own org | Read other org (same bank) | Read other org (different bank) | Update own org | Update other org | Approve/reject KYB |
|---|---|---|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member (own org) | 🟡 network-visible orgs only | ✅ | ❌ | ❌ | 🟡 own org fields only | ❌ | ❌ |
| bank_admin/bank_credit_officer | 🟡 network-visible + own bank's orgs | ✅ (own bank's orgs) | ✅ | ❌ | ❌ | ❌ | 🟡 own bank's orgs only |
| strike_admin | ✅ | ✅ | ✅ | ✅ | 🟡 admin actions only | 🟡 admin actions only | ✅ |

**Negative test cases required:** org_admin at Org A cannot read/update Org B's non-public fields; bank_admin at Bank X cannot approve/reject KYB for an org belonging to Bank Y (`app/api/kyb/[org_id]/decision/route.ts:46` — confirmed implemented correctly, needs a regression test).

## Banks

| Actor | Read own bank | Read other bank | Update own bank | Update other bank |
|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member | 🟡 limited public info (name, logo) | 🟡 same, if counterparty | ❌ | ❌ |
| bank_admin/bank_credit_officer | ✅ | ❌ | 🟡 admin fields only | ❌ |
| strike_admin | ✅ | ✅ | ✅ | ✅ |

**Note:** `banks` table has RLS enabled with zero policies (P1-1) — access today is entirely via service-role scoping in route code, not RLS. A negative test must confirm this holds, since RLS provides no backstop here yet.

## Programs

| Actor | List programs | Read program (own bank) | Read program (other bank) | Create/update program |
|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member (enrolled) | 🟡 own enrollments only | ✅ (if enrolled) | ❌ | ❌ |
| bank_admin/bank_credit_officer | ✅ own bank | ✅ | ❌ | ✅ own bank only |
| strike_admin | ✅ | ✅ | ✅ | 🟡 admin actions |

## Deals

| Actor | List deals (own) | Read deal (party) | Read deal (non-party) | Transition deal status | Cancel deal |
|---|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member (buyer or supplier party, per `deals.buyer_org_id`/`supplier_org_id` — never `organizations.type`) | ✅ | ✅ | ❌ | 🟡 per `PERMITTED_TRANSITIONS`/role/financing-context | 🟡 blocked ≥ shipped or financing_payment_active |
| bank_admin/bank_credit_officer (financing bank on the deal's transaction) | 🟡 if financing relationship exists | ✅ | ❌ | 🟡 financing-lifecycle actions only | ❌ |
| bank_admin/bank_credit_officer (unrelated bank) | ❌ | ❌ | ❌ | ❌ | ❌ |
| strike_admin | ✅ | ✅ | ✅ | 🟡 dispute resolution only | 🟡 admin override |

**Negative test cases required:** a supplier not party to a deal cannot read it (404, not 403 — network-visibility pattern applies elsewhere too, verify deals follow the same non-disclosure convention); a bank with no financing relationship to a deal cannot read or act on it.

## Marketplace listings / offers

| Actor | Browse public listings | Browse network-only listings (member) | Browse network-only listings (non-member) | Create listing | Submit offer | View others' offers on own listing | View others' offers on others' listing |
|---|---|---|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member (network_visible=true) | ✅ | ✅ | ❌ (404, not 403 — per `lib/networks/visibility.ts`) | ✅ own org | ✅ | ✅ own listing | ❌ |
| org_admin/org_member (ghost, network_visible=false) | ✅ read-only | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| bank_admin/bank_credit_officer | 🟡 financing-relevant view only | ❌ (banks never in networks) | ❌ | ❌ | ❌ | ❌ | ❌ |
| strike_admin | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |

**Negative test cases required:** a non-member org requesting a network-only listing by ID gets 404, not 403 (confirm this doesn't leak existence); a ghost-mode org cannot appear in any counterparty's browse results (verify `.eq('network_visible', true)` filter is present on every relevant route, not just some).

## Strike Rooms

| Actor | List own rooms | Read room (participant) | Read room (non-participant) | Post message (participant) | Post message (non-participant) |
|---|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member | ✅ | ✅ | ❌ | ✅ | ❌ |
| bank_admin/bank_credit_officer | ✅ (if participant) | ✅ (if participant) | ❌ | ✅ (if participant) | ❌ |
| strike_admin | ✅ | ✅ | ✅ (moderation) | 🟡 moderation only | — |

**Negative test cases required — highest priority given the historical bug:** a non-participant cannot read a private room's messages. This is the exact scenario the `rooms_private` policy bug (fixed in migration `00000000000002`, see ASSESSMENT.md §1) would have broken — a regression test here is the single most directly-motivated test case in this engagement, protecting against that specific class of bug recurring undetected.

## Documents

| Actor | Read own-org document | Read counterparty document (deal/listing/financing_request relationship) | Read unrelated document | Generate signed URL for unrelated document |
|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member | ✅ | 🟡 per `canAccessDocument()` entity-type rules | ❌ | ❌ |
| bank_admin/bank_credit_officer | 🟡 own bank's org documents + financing-relevant | 🟡 per same helper | ❌ | ❌ |
| strike_admin | ✅ | ✅ | ✅ | ✅ |

**Negative test cases required:** the exact IDOR scenario `canAccessDocument()`'s own code comment names ("any logged-in user could mint a signed URL for any document id") — confirm a logged-in user from an unrelated org/bank cannot obtain a signed URL for a document by guessing/enumerating its ID, across all four entity types (organization, deal, listing, financing_request).

## Financing requests & transactions

| Actor | Create financing request (own deal) | View own financing request | View others' financing request | Submit bank offer | Accept bank offer (own request) | Disburse funds |
|---|---|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member | ✅ | ✅ | ❌ (unless network-visible public) | ❌ | ✅ | ❌ |
| bank_admin/bank_credit_officer | ❌ | 🟡 if own bank offered/accepted | 🟡 network-scoped browse | ✅ own bank | ❌ | ✅ own bank's accepted request |
| strike_admin | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |

## Bank accounts

| Actor | Read own entity's accounts | Read other entity's accounts | Create/update own entity's account | Create/update other entity's account |
|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member | ✅ own org | ❌ | ✅ own org (org_admin only) | ❌ |
| bank_admin/bank_credit_officer | ✅ own bank | ❌ | ✅ own bank (bank_admin only) | ❌ |
| strike_admin | ✅ all | ✅ all | 🟡 admin actions | 🟡 admin actions |

**Note:** per CONTROL_MATRIX, changes to this table are not currently audit-logged (P2-3) — a test proving *authorization* is correct does not substitute for the missing audit trail, which is a separate Phase 1.J fix.

## Strike-admin actions

| Actor | Access `/api/admin/*` | View KYB queue (all orgs) | View platform stats | Resolve room reports/disputes |
|---|---|---|---|---|
| Unauthenticated | ❌ | ❌ | ❌ | ❌ |
| org_admin/org_member | ❌ | ❌ | ❌ | ❌ |
| bank_admin/bank_credit_officer | ❌ | ❌ (own bank's KYB queue only, via non-admin routes) | ❌ | ❌ |
| strike_admin | ✅ | ✅ | ✅ | ✅ |

**Negative test cases required:** any non-`strike_admin` role hitting any `/api/admin/*` route gets 403, including a bank_admin who might reasonably be assumed to have elevated access but doesn't.

## Cron / external dispatch / invitation tokens (non-role-based access)

| Access path | Required credential | Scope | Negative test required |
|---|---|---|---|
| Cron routes (`agents/tick`, `agents/scan`, `deals/check-overdue`, `erp/sync`, `risk/refresh-signals`) | `x-cron-secret` header === `CRON_SECRET` | Platform-wide (by design — these are scheduled jobs) | Request without the header, or with a wrong value, returns 401, not a silent pass-through |
| `/api/ai/dispatch` | Bearer `dispatch_token`, matched against `erp_connections.dispatch_token` | Single org (the token's owning org) | A valid token for Org A cannot read/act on Org B's data (route-code scoping should already prevent this — needs an explicit test); an invalid/malformed/missing token is rejected; **after Phase 1.G**, an expired or revoked token is rejected |
| Invitation tokens (`/api/invite/[token]`, `/api/networks/[id]/accept`) | Unique hex token from `invitations`/`network_invite_tokens`, must be unexpired and `status='pending'` | Single invitation | An expired token is rejected; an already-accepted/revoked token cannot be reused; a token for Network A cannot be used to join Network B |
| `/api/agents/tick` (manual trigger path) | Session auth, org_admin role, scoped to caller's own org | Single org | A different org's org_admin cannot trigger a tick for an org they don't own (route already derives org from session per CLAUDE.md — needs a test, not a fix) |
| `/api/demo/*` | Session auth + `isDemoAccount(email)` (hardcoded `demo@demo.com`) or `strike_admin` (reset only) | `DEMO_ALL_ORG_IDS` (hardcoded UUID constants) | **Post Phase 0.4:** with `DEMO_ROUTES_ENABLED` unset, every demo route returns 404 regardless of caller identity — test this explicitly, not just the account gate |

## AI tool authorization (by portal / tool category)

| Tool category | Available to org portal | Available to bank portal | Available to AI overlay (any page) | Available to `/api/ai/dispatch` |
|---|---|---|---|---|
| READ tools (lookup, get_active_deals, get_pricing_insights, etc.) | ✅ | 🟡 bank-relevant subset | 🟡 `search_web` + `get_financing_programs` only | ✅ org-portal set |
| WRITE tools (create_marketplace_listing, submit_marketplace_offer, create_financing_request, create_network, add_network_member) | 🟡 gated by `agent_preferences.require_approval_for_actions` | ❌ | ❌ | 🟡 same gate, plus threat-model concerns in P0-4 |
| NEGOTIATION tools (counter/reject/recommend_finalization) | ❌ (tick-loop only, never general chat) | ❌ | ❌ | ❌ |
| `accept_marketplace_offer` | ❌ — never given a schema anywhere | ❌ | ❌ | ❌ |
| BANK_ONLY tools (proactive_portfolio_alerts) | ❌ | ✅ | ❌ | ❌ |

**Negative test cases required:** an org-portal session cannot invoke a BANK_ONLY tool; `/api/ai/dispatch` cannot be used to invoke `accept_marketplace_offer` (should fail at the tool-schema level, not just be "unlikely" — verify no code path exposes it); a WRITE tool call from an org with `require_approval_for_actions=true` returns `202 requires_approval` rather than executing, for every WRITE tool, not just the ones already spot-checked.

---

## Summary of required negative cross-tenant tests (for Phase 1.C)

This list is the direct input to the Phase 1.C "authorization-matrix test suite" roadmap item — each row above with a "Negative test cases required" note becomes one or more test cases here:

1. Bank A cannot read/write Bank B's organizations, programs, or risk scores (**directly motivated by the confirmed P0-1 bug** — this is the highest-priority test to write).
2. Org A cannot read/act on a deal it is not party to.
3. A non-participant cannot read a private Strike Room (**directly motivated by the historical `rooms_private` bug** — write this even though the bug is already fixed, as a regression guard).
4. A non-member org cannot access a network-only listing/financing request by ID (404, not 403 or 200).
5. An unrelated org/bank cannot obtain a signed document URL by ID guessing, across all four `canAccessDocument()` entity types.
6. A non-`strike_admin` cannot access any `/api/admin/*` route.
7. An invitation/network-invite token cannot be reused, cannot be used cross-network, and expires correctly.
8. A cron route rejects requests with a missing/wrong `x-cron-secret`.
9. An `/api/ai/dispatch` token is scoped to its owning org only; after Phase 1.G, also test expiry/revocation/scope enforcement.
10. `/api/demo/*` routes 404 when `DEMO_ROUTES_ENABLED` is unset (Phase 0.4 regression test).
11. AI WRITE tools respect `require_approval_for_actions` for every WRITE tool, not a sample.
12. AI portal/tool-set boundaries hold (org can't invoke BANK_ONLY tools; nothing can invoke `accept_marketplace_offer`).
13. A deactivated user (`users.is_active=false`) is treated as unauthenticated on every route, not just the ones migrated to `lib/auth/session.ts`'s `getSessionContext()` (**directly motivated by the confirmed P1-9 finding** — done for `risk/score` and `kyb/[org_id]/decision`; write this as each additional route migrates, per ROADMAP.md 1.D).
