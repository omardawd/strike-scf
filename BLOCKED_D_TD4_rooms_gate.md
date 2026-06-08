# BLOCKED (coordination) — TD.4 unlock gap in rooms create gate

**Owner of fix:** Track G (or whoever owns `apps/web/app/api/rooms/route.ts`).
**Raised by:** Track D (TD.4 — platform unlock on submission, not approval).
**Severity:** low — ghost orgs already can't reach the rooms UI (the central
GhostGate locks `/rooms`). This only affects a SUBMITTED-but-not-yet-AI-approved
org, which TD.4 says should be unlocked.

## Problem
`apps/web/app/api/rooms/route.ts` (~line 29) gates room creation on:

```ts
if (!org || org.status !== 'active') {
  return NextResponse.json({ error: 'Organization must be active to create rooms' }, { status: 403 })
}
```

Under the new two-tier model, an org becomes usable on Passport **submission**
(`network_visible=true`, `kyb_status='submitted'`, `status='kyb_submitted'`).
`status` only becomes `'active'` later, on AI/bank approval. So a legitimately
unlocked (submitted) org is wrongly blocked from creating rooms.

## One-line fix (matches the pattern Track D applied to marketplace listings/offers)
Replace the `status !== 'active'` check with the unlock signal:

```ts
const { data: org } = await adminClient
  .from('organizations')
  .select('id, status, kyb_status, network_visible')   // add kyb_status, network_visible
  .eq('id', userData.org_id)
  .single()
if (!org || !org.network_visible || org.kyb_status === 'not_started') {
  return NextResponse.json({ error: 'Activate your Passport to create rooms' }, { status: 403 })
}
```

I did NOT edit this file to avoid a concurrent-edit collision with Track G.
