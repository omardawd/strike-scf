import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Columns the self-registration wizard is allowed to write to `organizations`.
// Kept in sync with the Organization type in @strike-scf/types — any field not
// listed here is silently ignored so a stray key can never break the update.
const ALLOWED_FIELDS = [
  'legal_name',
  'doing_business_as',
  'business_type',
  'country_of_incorporation',
  'state_of_incorporation',
  'years_in_operation',
  'industry_naics',
  'website',
  'description',
  'primary_contact_name',
  'primary_contact_title',
  'primary_contact_phone',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'country',
  'annual_revenue_range',
  'employee_count_range',
  'ein',
  'country_of_origin',
  'sourcing_countries',
  'product_categories',
  'network_visible',
] as const

async function resolveOrgId(userId: string): Promise<string | null> {
  const { data } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', userId)
    .single()
  return data?.org_id ?? null
}

// GET — return the current user's organization so the wizard can hydrate/resume.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = await resolveOrgId(user.id)
  if (!orgId) return NextResponse.json({ org: null })

  const { data: org, error } = await adminClient
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 })
  }
  return NextResponse.json({ org })
}

// PATCH — persist a single wizard step. Body: { step, data }.
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { step?: number; data?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const orgId = await resolveOrgId(user.id)
  if (!orgId) {
    return NextResponse.json({ error: 'No organization associated with this user' }, { status: 400 })
  }

  const incoming = body.data ?? {}
  const update: Record<string, unknown> = {}
  for (const key of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      update[key] = incoming[key]
    }
  }

  // years_in_operation is numeric in the schema; the form sends a string.
  if ('years_in_operation' in update) {
    const n = Number(update.years_in_operation)
    update.years_in_operation = Number.isFinite(n) ? n : null
  }

  // Reflect that the applicant is actively filling out KYB.
  update.kyb_status = 'in_progress'
  update.status = 'kyb_in_progress'

  const { data: org, error } = await adminClient
    .from('organizations')
    .update(update)
    .eq('id', orgId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to save progress' }, { status: 500 })
  }
  return NextResponse.json({ org })
}
