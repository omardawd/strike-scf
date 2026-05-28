# Skill: supabase-patterns

## When to use this skill
Read this before writing ANY Supabase query, API route, or auth check in Strike SCF.

---

## The dual-client rule (Strike-specific)

Strike uses TWO Supabase clients with completely different purposes:

```typescript
// CLIENT 1: anon client — session/auth only
// lib/supabase/server.ts
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
// Use this for getUser() — it respects RLS as the authenticated user.
// Can also be used for SELECT queries where RLS policies should apply.

// CLIENT 2: admin client — bypasses RLS entirely
// Initialized at module level in each API route
import { createClient as createAdmin } from '@supabase/supabase-js'
const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
// Bypasses ALL RLS policies. Use only when you need to act across
// org/bank boundaries (e.g. bank admin reading all orgs, seeding, migrations).
```

**RLS is enabled on all tables.** Policies are defined in Supabase (not in this repo).
The API routes use the admin client for most queries because they need to read across
org/bank boundaries after doing role checks in code. If you're writing a query that
should respect RLS naturally (e.g. a supplier reading only their own data), you can
use the anon client with the authenticated user's session — but confirm the policy
covers that case first.

---

## Standard API route auth flow

```typescript
export async function GET() {
  // Step 1: verify session (anon client — validates JWT)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Step 2: fetch full user row (admin client — need role/org regardless of RLS)
  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()

  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // Step 3: role gate
  if (!BANK_ROLES.includes(userData.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Step 4: scoped query (admin client, manual scope)
  const { data, error } = await adminClient
    .from('programs')
    .select('*')
    .eq('bank_id', userData.bank_id)    // ← always scope to user's bank/org
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  return NextResponse.json({ programs: data ?? [] })
}
```

---

## Role constants (copy into every route file that needs them)

```typescript
const BANK_ROLES     = ['bank_admin', 'bank_credit_officer']
const ANCHOR_ROLES   = ['anchor_admin', 'anchor_member']
const SUPPLIER_ROLES = ['supplier_admin', 'supplier_member']
```

---

## Reusable auth helpers

`lib/api-auth.ts` exports these — use them to DRY up routes:

```typescript
import { requireAuth, requireRole, adminClient } from '@/lib/api-auth'

export async function POST(request: Request) {
  const { userRow, error } = await requireAuth(request)
  if (error) return error

  const roleError = requireRole(userRow, BANK_ROLES)
  if (roleError) return roleError

  // userRow is now typed, safe to use
}
```

---

## RLS — what you need to know

RLS policies are defined in Supabase Studio (not committed to this repo).
Before writing a query, ask: does the existing RLS policy cover this access pattern?

Common policy shapes in this codebase:
- `users` table: users can read/update their own row (`auth.uid() = id`)
- `organizations` table: users can read orgs they belong to via `org_id` or `bank_id`
- `transactions`, `programs`: scoped by `bank_id` or `org_id`

**If in doubt, use the admin client** and add a manual `.eq()` scope. This is safe
because the role check in step 3 ensures the user can only request their own data.
Never use the admin client without a manual scope filter — that would return all rows.

**When writing new tables**: define RLS policies before using the anon client.
Until policies exist, use admin client with explicit scoping only.

---

## Query patterns

**Single row:**
```typescript
// Throws if 0 rows — use for required lookups
const { data, error } = await adminClient.from('organizations').select('*').eq('id', id).single()

// Returns null if not found — use for optional data
const { data } = await adminClient.from('credit_scores').select('*').eq('org_id', id).maybeSingle()
```

**Filtered list with join:**
```typescript
const { data: transactions } = await adminClient
  .from('transactions')
  .select('*, programs(name, currency)')   // nested select = join
  .eq('supplier_id', userData.org_id)
  .in('status', ['funded', 'repayment_due'])
  .order('created_at', { ascending: false })
  .limit(50)
```

**Count without fetching rows:**
```typescript
const { count } = await adminClient
  .from('transactions')
  .select('*', { count: 'exact', head: true })
  .eq('supplier_id', org_id)
```

**Upsert / update:**
```typescript
await adminClient
  .from('organizations')
  .update({ risk_score: 75, risk_tier: 'green' })
  .eq('id', org_id)
```

---

## Client-side data fetching

Pages call `/api/...` routes — never import Supabase clients in `'use client'` components:

```typescript
'use client'
export default function MyPage() {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetch('/api/my-resource').then(r => r.json()).then(setData)
  }, [])
}
```

---

## File upload (Supabase Storage)

```typescript
const { data: uploadData, error } = await adminClient.storage
  .from('kyb-documents')
  .upload(`${org_id}/${filename}`, fileBuffer, {
    contentType: mimeType,
    upsert: false,
  })

// Signed URL for download (1 hour)
const { data: urlData } = await adminClient.storage
  .from('kyb-documents')
  .createSignedUrl(storagePath, 3600)
```

---

## Error handling

```typescript
const { data, error } = await adminClient.from('...').select('*')
if (error) {
  console.error('[route-name] query failed:', error)
  return NextResponse.json({ error: 'Descriptive message' }, { status: 500 })
}
```

Always prefix `console.error` with the route name so logs are searchable.
