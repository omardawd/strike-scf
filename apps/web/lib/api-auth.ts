import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export { adminClient }

export async function requireAuth(
  request: Request
): Promise<{
  session: any
  userRow: any
  error?: NextResponse
}> {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { session }, error: sessionError } =
    await supabase.auth.getSession()

  if (sessionError || !session) {
    return {
      session: null,
      userRow: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const { data: userRow } = await adminClient
    .from('users')
    .select('*')
    .eq('id', session.user.id)
    .single()

  if (!userRow) {
    return {
      session: null,
      userRow: null,
      error: NextResponse.json({ error: 'User not found' }, { status: 401 }),
    }
  }

  if (!userRow.is_active) {
    return {
      session: null,
      userRow: null,
      error: NextResponse.json({ error: 'Account suspended' }, { status: 403 }),
    }
  }

  return { session, userRow }
}

export function requireRole(
  userRow: any,
  allowedRoles: string[]
): NextResponse | null {
  if (!allowedRoles.includes(userRow.role)) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    )
  }
  return null
}

export function requireBankAccess(
  userRow: any,
  bankId: string
): NextResponse | null {
  if (userRow.bank_id !== bankId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  return null
}

export function requireOrgAccess(
  userRow: any,
  orgId: string
): NextResponse | null {
  if (
    userRow.org_id !== orgId &&
    !['bank_admin', 'bank_credit_officer'].includes(userRow.role)
  ) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  return null
}
