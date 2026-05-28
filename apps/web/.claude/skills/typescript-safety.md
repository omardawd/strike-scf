# Skill: typescript-safety

## When to use this skill
Read this when writing new TypeScript, fixing type errors, or touching `packages/types/index.ts`.

---

## Import types from the shared package

**Always** import shared types from `packages/types`:

```typescript
import type {
  UserRole, OrgType, OrgStatus, KYBStatus,
  TransactionStatus, ProgramStatus, EnrollmentStatus,
  FinancingType, RiskTier, CreditDecision,
  InvitationStatus
} from '@strike/types'
// or from the internal path:
import type { UserRole } from '../../../packages/types'
```

**Never** re-define these types inline. If a type is missing, add it to `packages/types/index.ts` and import from there.

---

## API route response types

Every API route should have typed request and response shapes:

```typescript
// Define at top of the route file
interface CreateTransactionRequest {
  program_id: string
  invoice_amount: number
  invoice_number: string
  due_date: string
  description?: string
}

interface TransactionResponse {
  transaction: {
    id: string
    status: TransactionStatus
    invoice_amount: number
    // ... only fields the client needs
  }
}

export async function POST(request: Request): Promise<NextResponse<TransactionResponse | { error: string }>> {
  let body: CreateTransactionRequest
  try {
    body = await request.json() as CreateTransactionRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Validate required fields
  if (!body.program_id || !body.invoice_amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  // ...
}
```

---

## Supabase row types

Supabase queries return `any` by default. Type the result explicitly:

```typescript
// Type the .single() result
const { data: org } = await adminClient
  .from('organizations')
  .select('id, legal_name, kyb_status, risk_tier, risk_score')
  .eq('id', org_id)
  .single()

// Cast to your interface
interface OrgRow {
  id: string
  legal_name: string
  kyb_status: KYBStatus
  risk_tier: 'green' | 'amber' | 'red' | null
  risk_score: number | null
}

const org = data as OrgRow | null
```

For complex joins, type the nested result:
```typescript
interface TransactionWithProgram {
  id: string
  status: TransactionStatus
  invoice_amount: number
  programs: {
    name: string
    currency: string
  } | null
}
```

---

## React component props

Always type props explicitly — no implicit `any`:

```typescript
// Good
interface SupplierCardProps {
  supplier: {
    id: string
    legal_name: string
    risk_tier: 'green' | 'amber' | 'red' | null
    risk_score: number | null
  }
  onSelect: (id: string) => void
}

export function SupplierCard({ supplier, onSelect }: SupplierCardProps) { ... }

// Bad — implicit any
export function SupplierCard({ supplier, onSelect }: any) { ... }
```

---

## Null safety patterns

Supabase can return null on many fields. Handle it:

```typescript
// Nullish coalescing for display
const name = userData?.full_name ?? 'Unknown'
const score = org?.risk_score ?? null

// Optional chaining for nested access
const tier = response?.data?.org?.risk_tier

// Type narrowing before use
if (!userData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
// After this line, userData is non-null

// Arrays that might be null
const flags = Array.isArray(org.risk_flags) ? org.risk_flags : []
const countries = Array.isArray(org.sourcing_countries) ? org.sourcing_countries : []
```

---

## Event handler types

```typescript
// Form inputs
onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}

// Button clicks
onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleClick()}

// Select
onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRole(e.target.value as UserRole)}
```

---

## useState with complex types

```typescript
// Always provide explicit type when initial state is null
const [program, setProgram] = useState<Program | null>(null)
const [transactions, setTransactions] = useState<Transaction[]>([])
const [loading, setLoading] = useState(false)  // bool inferred fine

// For fetch state
const [data, setData] = useState<{
  programs: Program[]
  total: number
} | null>(null)
```

---

## Running the type checker

```bash
# Always run from apps/web, not from the monorepo root
cd apps/web
npx tsc --noEmit

# If you get module resolution errors, check tsconfig.json paths
# The '@/' alias maps to apps/web/ (configured in tsconfig.json)
```

Fix ALL errors before finishing a task. A passing type check is the definition of done.

---

## Common error patterns and fixes

**"Property does not exist on type 'never'"**
→ The preceding if-check already narrowed to `never`. Check your condition logic.

**"Type 'string | null' is not assignable to type 'string'"**
→ Add null check: `if (!value) return` or use `value ?? ''`

**"Cannot find module '@/lib/...'"**  
→ Run from `apps/web/`, not monorepo root. Check `tsconfig.json` paths.

**"Property '...' does not exist on type 'any'"**
→ Good — TypeScript is telling you the type is `any`. Add an explicit type cast.

**"Object is possibly 'null'"**
→ Add a null guard before the access.
