# Access Control

Covers both **application-level** access control (who can do what inside Strike SCF) and **infrastructure-level** access control (who can touch Vercel/Supabase/GitHub). See `docs/enterprise-readiness/AUTHORIZATION_MATRIX.md` for the detailed role-by-resource matrix — this document is the policy layer above it.

## Application roles

Defined in `packages/types/index.ts`: `bank_admin`, `bank_credit_officer`, `org_admin`, `org_member`, `strike_admin`. Portal type (bank/anchor/supplier/admin) is derived from role + `organizations.type`, not a separate field. Full detail in `apps/web/CLAUDE.md`'s "Role system" section and `docs/enterprise-readiness/AUTHORIZATION_MATRIX.md`.

### How authorization is enforced today

- **Primary control**: per-route, hand-implemented (`getUser()` → service-role user lookup → role gate → manually scoped query). Sampled and found correct in the large majority of the ~161 route files (`docs/enterprise-readiness/ASSESSMENT.md`, executive summary).
- **Centralized helpers** (new, this engagement): `apps/web/lib/auth/session.ts` (`getSessionContext()` — also enforces that a deactivated user, `is_active=false`, is treated as unauthenticated), `apps/web/lib/auth/require.ts`, `apps/web/lib/auth/resource-access.ts`. Migrated to 2 of ~161 routes so far — see `docs/enterprise-readiness/ROADMAP.md` 1.D for the rollout plan. **Do not assume every route uses these yet.**
- **RLS (Row-Level Security)**: enabled on all 45+ tables, with policies on all of them as of this engagement (previously 11 tables had RLS enabled with zero policies — fixed, `docs/enterprise-readiness/ASSESSMENT.md` P1-1). RLS is **defense-in-depth today, not the primary control** — the app's service-role client bypasses it for almost every query, matching a pattern the codebase's own migration comments describe intentionally.

### Provisioning and deprovisioning

- **Bank accounts**: provisioned manually by Strike — there is no self-service bank signup (`apps/web/CLAUDE.md`, "Signup flow"). Owner: *[Assign — whoever handles new bank customer onboarding]*.
- **Org users** (anchor/supplier): self-register (`/signup`) or via invitation. `org_admin` can deactivate (`is_active=false`, not delete) team members via Settings → Team.
- **Strike admin** (`strike_admin` role): the highest-privilege role, full cross-tenant access. **No documented process today for who gets this role or how it's reviewed** — this should be tightened before pilot launch: treat `strike_admin` grants as requiring the same rigor as a cloud-provider root account.
- **Deactivation**: setting `is_active=false` now actually blocks API access for any route migrated to `lib/auth/session.ts` (previously it didn't block anything — `docs/enterprise-readiness/ASSESSMENT.md` P1-9). For non-migrated routes, deactivation is currently cosmetic. There is no automatic Supabase Auth session revocation on deactivation — a deactivated user's existing session token itself isn't invalidated, only subsequent authorization checks (on migrated routes) now correctly deny them.

## Infrastructure access

All **UNVERIFIED** — dashboard access was not available during this engagement. See `docs/enterprise-readiness/MANUAL_INFRA_CHECKLIST.md` for the full checklist; summarized here:

- **Vercel**: who has project access, at what role (viewer/member/admin), whether MFA is enforced team-wide.
- **Supabase**: who has project access (this determines who can read/write production data directly, bypassing the app entirely — the highest-privilege access in the whole system), whether MFA is enforced.
- **GitHub**: who can push to `main` / merge PRs, whether branch protection requires review, who holds admin/owner rights on the repository or org.
- **Anthropic, Resend, Tavily**: who holds API console access for each (lower blast radius than the above, but still credential-bearing).

**Principle to apply once verified**: access to production data (Supabase) and the ability to deploy (Vercel, or merge to `main` if Vercel auto-deploys from it) should be the smallest set of people consistent with actually operating the product — not "everyone on the team" by default.

## Periodic review

**Not yet established.** Recommended cadence once there are real customers: quarterly review of who holds `strike_admin`, who has Supabase/Vercel/GitHub admin access, and whether it's still needed. Owner: *[Assign]*.
