# RESOLVED — TD.4 unlock gap in rooms create gate

**Status: RESOLVED.** The fix described below has been applied to `apps/web/app/api/rooms/route.ts`.

`/api/rooms` (POST, room creation) now checks `org.network_visible && org.kyb_status !== 'not_started'` instead of `org.status === 'active'`, matching the unlock model applied by Track D to all other feature gates.

---

**Original blocker (for reference):**

**Raised by:** Track D (TD.4 — platform unlock on submission, not approval).

The old gate `org.status !== 'active'` was blocking submitted-but-not-yet-approved orgs from creating rooms. Fixed to use the `network_visible + kyb_status` unlock signal consistent with the rest of the platform.
