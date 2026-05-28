# Skill: strike-ui

## When to use this skill
Read this before building ANY UI component, page layout, or styling in Strike SCF.

---

## The design system

Strike uses a hand-built CSS design system. There is NO Shadcn, no Tailwind, no MUI.
All tokens live in `apps/web/app/globals.css`. All shared components live in `apps/web/components/`.

---

## CSS tokens (use these, never hardcode)

```css
/* Colors */
--white: #FFFFFF          --offwhite: #F7F8FA
--ink: #111318             --ink-soft: #1A1D24
--gray: #6B7280            --gray-soft: #9AA0AB
--border: #E5E7EB          --border-strong: #D1D5DB
--blue: #0052FF            --blue-hover: #0040C8

/* Semantic */
--color-green: #059669     --color-green-bg: rgba(5,150,105,0.08)
--color-amber: #D97706     --color-amber-bg: rgba(217,119,6,0.08)
--color-red: #DC2626       --color-red-bg: rgba(220,38,38,0.08)
--color-purple: #7C3AED    --color-purple-bg: rgba(124,58,237,0.08)

/* Typography */
--font-display: "Space Grotesk"   /* headings, numbers, metrics */
--font-body: "DM Sans"            /* all body text */
--font-mono: "IBM Plex Mono"      /* code, amounts, IDs */
```

Dark mode is toggled via `data-theme="dark"` on `:root`. Always verify dark mode works — use CSS variables, not hardcoded hex.

---

## Component inventory (check before building)

From `components/portal-shell.tsx`:
- `PortalShell` — pass-through wrapper (deprecated, use layout.tsx)
- `Topbar` — page header with breadcrumbs and actions
- `NotifBell` — notification bell with popover
- `Icon` — SVG sprite icons: `<Icon name="back" size={16} />`

From `components/`:
- `AIPanel` — sliding AI chat panel
- `AIInsight` — inline AI insight card
- `RiskBadge` — green/amber/red risk tier badge
- `Charts` — `VolumeChart`, `ProgramPieChart`, `PeriodToggle`
- `SupplyGraph` — supply chain network graph
- `RecommendationsPanel` — AI recommendations list
- `PerformanceScorecard` — supplier performance metrics
- `LiquidityRouting` — liquidity routing visualization
- `BulkInviteModal` — bulk supplier invite modal
- `DocGenerator` — AI document generation

**Always check this list first.** Build new only when nothing here fits.

---

## Page shell pattern

Every portal page uses this exact structure:

```tsx
'use client'
import { PortalShell, Topbar } from '@/components/portal-shell'

export default function MyPage() {
  return (
    <PortalShell>
      <Topbar
        crumbs={[
          { label: 'Programs', onClick: () => router.push('/programs') },
          { label: 'Program Name' },
        ]}
        actions={
          <button className="btn btn-primary" onClick={handleAction}>
            Action
          </button>
        }
      />
      <div className="page-content">
        {/* page body */}
      </div>
    </PortalShell>
  )
}
```

---

## Standard CSS class patterns

Check `globals.css` for these — use them as-is:

```css
/* Buttons */
.btn               /* base */
.btn-primary       /* blue fill */
.btn-secondary     /* outlined */
.btn-ghost         /* text-only */
.btn-danger        /* red */
.btn-sm / .btn-lg  /* sizes */

/* Cards */
.card              /* white card with border */
.card-header
.card-body

/* Forms */
.form-group
.form-label
.form-input        /* text input */
.form-select
.form-error

/* Tables */
.data-table
.data-table th / td

/* Status badges */
.badge .badge-green / .badge-amber / .badge-red / .badge-blue / .badge-gray

/* Layout */
.page-content      /* main content area with padding */
.section-header
.empty-state       /* for empty lists */

/* Risk/status specific */
.risk-green / .risk-amber / .risk-red
```

---

## Role-conditional UI

Always gate UI sections by portal/role using context:

```tsx
import { usePortal } from '@/lib/portal-context'
import { useUser } from '@/lib/user-context'

export default function MyPage() {
  const portal = usePortal()  // 'bank' | 'anchor' | 'supplier'
  const user = useUser()      // { role, org_id, bank_id, ... }

  return (
    <>
      {portal === 'bank' && <BankSection />}
      {portal === 'anchor' && <AnchorSection />}
      {portal === 'supplier' && <SupplierSection />}

      {/* Or by specific role */}
      {user.role === 'bank_admin' && <AdminOnlyAction />}
    </>
  )
}
```

---

## Loading and error states

Every page in `app/(portal)/` needs sibling files:

```
page.tsx
loading.tsx   ← shown by Next.js during navigation
error.tsx     ← shown by Next.js on thrown errors
```

Minimal `loading.tsx`:
```tsx
export default function Loading() {
  return (
    <div className="page-content">
      <div className="loading-skeleton" />
    </div>
  )
}
```

Minimal `error.tsx`:
```tsx
'use client'
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page-content">
      <div className="empty-state">
        <p>{error.message || 'Something went wrong'}</p>
        <button className="btn btn-secondary" onClick={reset}>Try again</button>
      </div>
    </div>
  )
}
```

---

## Number formatting

Use these helpers from `components/portal-shell.tsx`:
```typescript
// Already exported:
fmtMoney(amount: number, currency = 'USD') // → "$1,234,567"
fmtPct(rate: number)                        // → "3.25%"
fmtDate(dateStr: string)                    // → "May 27, 2026"
```

For inline formatting when not in a component context:
```typescript
new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
```

Never display raw floating point numbers. Always format.

---

## Reference designs

`apps/web/reference/` contains the original UI mockups:
- `app.jsx` — full app prototype
- `dashboards.jsx` — dashboard screens
- `design-system.html` — component showcase
- `new-program.jsx` — program creation flow
- `onboarding.jsx` — onboarding flow

When building a new screen, check here first. The visual target is already defined.

---

## Adding AI context to a page

To give the AI panel awareness of what's on screen:

```tsx
import { AIPanel, type AIPanelContext } from '@/components/ai-panel'

const aiContext: AIPanelContext = {
  portal: portal,           // from usePortal()
  page: 'Transaction Detail',
  entityType: 'transaction',
  entityData: transaction,  // the fetched data object
  userName: user.full_name,
  orgName: user.org_name,
}
```

Pass `entityData` only after it's loaded. Passing null is fine — AI will say it doesn't have context.
