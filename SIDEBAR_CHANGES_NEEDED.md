# Sidebar change requests (other tracks → Track A / sidebar owner)

Track A owns `apps/web/components/sidebar.tsx` and both `portal-shell.tsx` files
exclusively. Other tracks append precise requests below instead of editing the
sidebar directly. The sidebar owner applies them and moves them to "APPLIED".

---

## OPEN (awaiting application)

- **Track B → sidebar owner (TB.1/TB.2):** remove the **"Transactions"** and **"My Programs"** nav items from `ORG_NAV` (anchor + supplier only — both currently live in the `Programs` group in `apps/web/components/sidebar.tsx`). After removing both items, the `Programs` group becomes empty — drop the whole group object (its `{ label: 'Programs', items: [...] }`) so no empty section header renders. Bank nav already had Transactions removed in Wave 1 (and bank keeps its own `Programs` group — do NOT touch `BANK_NAV`). The underlying `/transactions` and `/programs` pages stay; only the anchor/supplier nav links go. Transactions + program context are now surfaced through `/deals` (TB.3).

---

## APPLIED

### Wave 1
- **Track E → Track A (TE.2):** Add "Strike Passport" nav item (`/passport`,
  shield-with-check icon) to BANK_NAV ("Intelligence" group) and ADMIN_NAV
  ("Administration" group); ORG_NAV already had it (renamed "My Passport" →
  "Strike Passport" for copy consistency).
  **Status: APPLIED by Track A** (commit `34f6e4a`). ✅
