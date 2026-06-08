# Sidebar change requests (other tracks → Track A / sidebar owner)

Track A owns `apps/web/components/sidebar.tsx` and both `portal-shell.tsx` files
exclusively. Other tracks append precise requests below instead of editing the
sidebar directly. The sidebar owner applies them and moves them to "APPLIED".

---

## OPEN (awaiting application)

### Wave 3
- **Track C → sidebar owner (TC.1):** In `BANK_NAV`, rename the "Financing Requests"
  nav item label to **"Strike Place"** (keep its `href` — the route stays
  `/marketplace/financing`; no alias needed, deep links unaffected). Swap its icon to
  the exchange / columns-building "marketplace" icon already used for the org
  "Strike Place" item (the `NAV_ICONS` entry the org nav references for Strike Place —
  reuse that same icon key for the bank item so both portals match). No other
  `BANK_NAV` items change. The page header, breadcrumbs, and bank dashboard widget
  were already renamed to "Strike Place" in TC.1/TC.2/TC.6 commits; only the sidebar
  label + icon remain (owned by Track A).

---

## APPLIED

### Wave 2
- **Track B → sidebar owner (TB.1/TB.2):** removed the "Transactions" and "My Programs"
  nav items from `ORG_NAV`, then dropped the now-empty `Programs` group object so no empty
  section header renders. `BANK_NAV`'s own Programs group was left untouched; the
  `/transactions` and `/programs` pages stay (surfaced via `/deals`, TB.3).
  **APPLIED (commit `999c60f`).** ✅
- **Track F → sidebar owner (TF.3):** removed the "Strike AI" nav item from all three nav
  configs (`ORG_NAV`, `BANK_NAV`, `ADMIN_NAV`). Each first (unlabeled) section keeps
  Dashboard, so no empty-group cleanup was needed. The `/ai` page stays (reachable via the
  always-present floating trigger, TF.2). The unreferenced `'ai'` entry in `NAV_ICONS` was
  left in place (harmless).
  **APPLIED (commit `37e491c`).** ✅
- **Track G → sidebar owner (TG.3):** added a LIVE unread-count badge to the "Strike Rooms"
  item in `ORG_NAV` only. `useRoomsUnread()` (from `@/lib/use-rooms-unread`) is called
  unconditionally at the top of the `Sidebar` component and is safe for every portal
  (bank/admin/non-room orgs get `0`, no error — the hook + its `/api/rooms/unread` backend
  key off `room_participants.user_id`). The rooms item's badge is computed at render time:
  `count > 99 ? '99+' : String(count)` when `count > 0`, otherwise no badge. Collapsed
  (icon-only) mode shows a small `--blue` dot overlay on the rooms icon (`.nav-badge` is
  hidden when collapsed). No badge added to `BANK_NAV`/`ADMIN_NAV`.
  **APPLIED (commit `3e2cb13`).** ✅

### Wave 1
- **Track E → Track A (TE.2):** Add "Strike Passport" nav item (`/passport`,
  shield-with-check icon) to BANK_NAV ("Intelligence" group) and ADMIN_NAV
  ("Administration" group); ORG_NAV already had it (renamed "My Passport" →
  "Strike Passport" for copy consistency).
  **Status: APPLIED by Track A** (commit `34f6e4a`). ✅
