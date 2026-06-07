# Sidebar change requests (other tracks → Track A / sidebar owner)

Track A owns `apps/web/components/sidebar.tsx` and both `portal-shell.tsx` files
exclusively. Other tracks append precise requests below instead of editing the
sidebar directly. The sidebar owner applies them and moves them to "APPLIED".

---

## OPEN (awaiting application)

- **Track B → sidebar owner (TB.1/TB.2):** remove the **"Transactions"** and **"My Programs"** nav items from `ORG_NAV` (anchor + supplier only — both currently live in the `Programs` group in `apps/web/components/sidebar.tsx`). After removing both items, the `Programs` group becomes empty — drop the whole group object (its `{ label: 'Programs', items: [...] }`) so no empty section header renders. Bank nav already had Transactions removed in Wave 1 (and bank keeps its own `Programs` group — do NOT touch `BANK_NAV`). The underlying `/transactions` and `/programs` pages stay; only the anchor/supplier nav links go. Transactions + program context are now surfaced through `/deals` (TB.3).

- **Track F → sidebar owner (TF.3):** remove the **"Strike AI"** nav item (`{ label: 'Strike AI', href: '/ai', icon: 'ai' }`) from **all three** nav configs in `apps/web/components/sidebar.tsx` — `ORG_NAV` (~line 41), `BANK_NAV` (~line 78), and `ADMIN_NAV` (~line 104). TA.4 was scoped to "Settings" + "AI Agent" and left "Strike AI" in place, but TF.3 requires Strike AI to be reachable **only** via the floating trigger button (now always-present per TF.2 — `components/ai-overlay.tsx`), so the sidebar link is redundant. The `/ai` page itself stays (do NOT delete it); only remove the three nav links. In each config "Strike AI" is the 2nd item of the first (unlabeled) section, so removing it leaves that section non-empty (Dashboard remains) — no empty-group cleanup needed. The `'ai'` icon in `NAV_ICONS` can stay (harmless if unreferenced) or be removed at the owner's discretion.

---

## APPLIED

### Wave 1
- **Track E → Track A (TE.2):** Add "Strike Passport" nav item (`/passport`,
  shield-with-check icon) to BANK_NAV ("Intelligence" group) and ADMIN_NAV
  ("Administration" group); ORG_NAV already had it (renamed "My Passport" →
  "Strike Passport" for copy consistency).
  **Status: APPLIED by Track A** (commit `34f6e4a`). ✅
