import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getNetworkAccess } from '@/lib/networks/access'
import { getNetworkListings } from '@/lib/networks/listings'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/networks/[id]/listings — recent active listings scoped to this
// network, for the detail page's "Recent Listings" section. Owner or active
// member only.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })
  if (!me.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { network, hasAccess } = await getNetworkAccess(adminClient, id, me.org_id)
  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? 10), 50)

  const listings = await getNetworkListings(adminClient, id, limit)

  return NextResponse.json({ listings })
}
