# Strike SCF — Architecture Overview

## System diagram

```
┌─────────────────────────────────────────────────────┐
│                  Vercel (Next.js)                    │
│                                                      │
│  app/(auth)/          ← Public routes               │
│  app/(onboarding)/    ← Pre-approval flow           │
│  app/(portal)/        ← Authenticated portal        │
│    layout.tsx         ← Auth + context providers    │
│    portal-shell.tsx   ← Sidebar + topbar            │
│    dashboard/         ← Role-specific home          │
│    programs/          ← SCF program management      │
│    transactions/      ← Invoice financing           │
│    kyb/               ← KYB review & approval       │
│    collateral/        ← Document pledging           │
│    reporting/         ← Analytics                   │
│    settings/          ← User & org settings         │
│                                                      │
│  app/api/             ← API routes                  │
│    ai/                ← Anthropic proxy             │
│    programs/          ← Program CRUD                │
│    transactions/      ← Transaction lifecycle       │
│    kyb/               ← KYB management              │
│    risk/              ← Risk scoring                │
│    invitations/       ← Invite flow                 │
│    notifications/     ← Bell notifications          │
│    dashboard/         ← Dashboard data              │
│    reporting/         ← Reporting data              │
└─────────────────────────────────────────────────────┘
           │                          │
           ▼                          ▼
   ┌──────────────┐         ┌─────────────────┐
   │   Supabase   │         │   Anthropic API  │
   │              │         │  (Haiku model)   │
   │  PostgreSQL  │         │                 │
   │  Auth        │         │  AI co-pilot    │
   │  Storage     │         │  Risk insights  │
   │  Realtime    │         │  Doc generation │
   └──────────────┘         └─────────────────┘
           │
           ▼
   ┌──────────────┐
   │    Resend    │
   │  (Transact.  │
   │    emails)   │
   └──────────────┘
```

## Data flow

```
Browser → API Route → Supabase (admin client)
                    ↓
                Role check (in-code)
                    ↓
                Scoped query
                    ↓
               JSON response
                    ↓
              React state update
```

## Context providers (wrap all portal pages)

```
PortalProvider    → provides usePortal() → 'bank' | 'anchor' | 'supplier'
  UserProvider    → provides useUser()   → { id, role, org_id, bank_id, ... }
    PortalShell   → renders sidebar + topbar + notification bell
      {children}  → individual page content
```

## Three-portal model

The same codebase serves three completely different user experiences, distinguished by role:

| Portal | Users | Key capabilities |
|--------|-------|-----------------|
| Bank | bank_admin, bank_credit_officer | Create programs, review KYB, approve financing, monitor risk portfolio |
| Anchor | anchor_admin, anchor_member | View enrolled programs, approve supplier invoices, invite suppliers |
| Supplier | supplier_admin, supplier_member | Submit invoices, track financing status, view performance |

## Key architectural decisions

1. **No RLS** — Access control is handled in API route code, not database rules. The admin client (service role key) is used for all queries. Auth is verified first with `getUser()`.

2. **No ORM** — Direct Supabase JS client. Query results are typed manually.

3. **No global state library** — React context only (PortalContext, UserContext). Component-local state with useState/useEffect.

4. **AI as infrastructure** — AI features are proxied through `/api/ai/chat` which handles auth, rate limiting, and usage tracking. All three portals share the same AI panel component with role-aware context injection.

5. **Turborepo for shared packages** — `packages/types` is the critical shared package. `packages/ui` is mostly unused — the web app has its own component system.
